import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';

export interface FilterOptions {
    respectGitignore: boolean;
    includePatterns: string[];
    excludePatterns: string[];
    maxFileSize: number;
}

export interface FilterResult {
    includedFiles: string[];
    excludedFiles: { path: string; reason: string }[];
    totalFiles: number;
}

export class FileFilter {
    private workspacePath: string;
    private gitignoreFilter: ReturnType<typeof ignore> | null = null;

    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;
    }

    /**
     * Initialize gitignore filter by reading .gitignore files
     */
    private async initializeGitignoreFilter(): Promise<void> {
        if (this.gitignoreFilter) {
            return;
        }

        this.gitignoreFilter = ignore();
        
        // Read .gitignore from workspace root
        const gitignorePath = path.join(this.workspacePath, '.gitignore');
        if (fs.existsSync(gitignorePath)) {
            try {
                const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
                this.gitignoreFilter.add(gitignoreContent);
            } catch (error) {
                console.warn('Failed to read .gitignore:', error);
            }
        }

        // Add common ignore patterns as fallback
        this.gitignoreFilter.add([
            '.git/',
            'node_modules/',
            '.DS_Store',
            'Thumbs.db',
            '*.log',
            '.env',
            '.env.local',
            '.env.*.local'
        ]);
    }

    /**
     * Check if a file should be ignored based on gitignore rules
     */
    private isIgnoredByGitignore(relativePath: string): boolean {
        if (!this.gitignoreFilter) {
            return false;
        }
        return this.gitignoreFilter.ignores(relativePath);
    }

    /**
     * Check if a file is binary
     */
    private async isBinaryFile(filePath: string): Promise<boolean> {
        try {
            // First check by file extension using dynamic import
            const { default: isBinaryPath } = await import('is-binary-path');
            if (isBinaryPath(filePath)) {
                return true;
            }

            // For files without clear extensions, check content
            const stats = fs.statSync(filePath);
            if (stats.size === 0) {
                return false;
            }

            // Read first 1024 bytes to check for binary content
            const buffer = Buffer.alloc(Math.min(1024, stats.size));
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, buffer.length, 0);
            fs.closeSync(fd);

            // Check for null bytes (common in binary files)
            return buffer.includes(0);
        } catch (error) {
            console.warn(`Failed to check if file is binary: ${filePath}`, error);
            return false;
        }
    }

    /**
     * Check if file matches include patterns
     */
    private matchesIncludePatterns(relativePath: string, patterns: string[]): boolean {
        if (patterns.length === 0) {
            return true;
        }
        return patterns.some(pattern => {
            const regex = this.globToRegex(pattern);
            return regex.test(relativePath);
        });
    }

    /**
     * Check if file matches exclude patterns
     */
    private matchesExcludePatterns(relativePath: string, patterns: string[]): boolean {
        return patterns.some(pattern => {
            const regex = this.globToRegex(pattern);
            return regex.test(relativePath);
        });
    }

    /**
     * Convert glob pattern to regex
     */
    private globToRegex(pattern: string): RegExp {
        // Simple glob to regex conversion
        let regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]');
        
        return new RegExp(`^${regexPattern}$`);
    }

    /**
     * Filter files based on the provided options
     */
    async filterFiles(options: FilterOptions): Promise<FilterResult> {
        const result: FilterResult = {
            includedFiles: [],
            excludedFiles: [],
            totalFiles: 0
        };

        // Initialize gitignore filter if needed
        if (options.respectGitignore) {
            await this.initializeGitignoreFilter();
        }

        // Find all files in workspace
        const allFiles = await vscode.workspace.findFiles('**/*', null);
        result.totalFiles = allFiles.length;

        for (const fileUri of allFiles) {
            const filePath = fileUri.fsPath;
            const relativePath = path.relative(this.workspacePath, filePath);

            try {
                // Check file stats
                const stats = fs.statSync(filePath);
                
                // Skip directories
                if (stats.isDirectory()) {
                    continue;
                }

                // Check file size
                if (stats.size > options.maxFileSize) {
                    result.excludedFiles.push({
                        path: relativePath,
                        reason: `File too large (${stats.size} bytes > ${options.maxFileSize} bytes)`
                    });
                    continue;
                }

                // Check gitignore
                if (options.respectGitignore && this.isIgnoredByGitignore(relativePath)) {
                    result.excludedFiles.push({
                        path: relativePath,
                        reason: 'Ignored by .gitignore'
                    });
                    continue;
                }

                // Check exclude patterns
                if (this.matchesExcludePatterns(relativePath, options.excludePatterns)) {
                    result.excludedFiles.push({
                        path: relativePath,
                        reason: 'Matches exclude pattern'
                    });
                    continue;
                }

                // Check include patterns
                if (!this.matchesIncludePatterns(relativePath, options.includePatterns)) {
                    result.excludedFiles.push({
                        path: relativePath,
                        reason: 'Does not match include pattern'
                    });
                    continue;
                }

                // Check if binary
                if (await this.isBinaryFile(filePath)) {
                    result.excludedFiles.push({
                        path: relativePath,
                        reason: 'Binary file'
                    });
                    continue;
                }

                // File passed all filters
                result.includedFiles.push(relativePath);

            } catch (error) {
                result.excludedFiles.push({
                    path: relativePath,
                    reason: `Error accessing file: ${error}`
                });
            }
        }

        return result;
    }

    /**
     * Get default filter options from VS Code configuration
     */
    static getDefaultOptions(): FilterOptions {
        const config = vscode.workspace.getConfiguration('codebaseExporter');
        
        return {
            respectGitignore: config.get('respectGitignore', true),
            includePatterns: config.get('includePatterns', [
                '**/*.{js,ts,jsx,tsx,py,java,cpp,c,h,cs,php,rb,go,rs,swift,kt,scala,clj,hs,ml,fs,vb,sql,html,css,scss,sass,less,xml,json,yaml,yml,md,txt}'
            ]),
            excludePatterns: config.get('excludePatterns', [
                '**/node_modules/**',
                '**/.git/**',
                '**/build/**',
                '**/dist/**',
                '**/out/**',
                '**/.vscode/**',
                '**/.idea/**',
                '**/target/**',
                '**/bin/**',
                '**/obj/**'
            ]),
            maxFileSize: config.get('maxFileSize', 1048576) // 1MB
        };
    }
}
