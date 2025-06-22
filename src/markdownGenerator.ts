import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface MarkdownOptions {
    includeTableOfContents: boolean;
    workspaceName: string;
    exportTimestamp: string;
    totalFiles: number;
}

export interface FileContent {
    relativePath: string;
    content: string;
    language: string;
}

export class MarkdownGenerator {
    private workspacePath: string;

    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;
    }

    /**
     * Generate complete markdown content for the codebase export
     */
    async generateMarkdown(filePaths: string[], options: MarkdownOptions): Promise<string> {
        const fileContents = await this.readFileContents(filePaths);
        
        let markdown = '';
        
        // Add header with metadata
        markdown += this.generateHeader(options);
        
        // Add table of contents if requested
        if (options.includeTableOfContents) {
            markdown += this.generateTableOfContents(fileContents);
        }
        
        // Add file contents
        markdown += this.generateFileContents(fileContents);
        
        return markdown;
    }

    /**
     * Generate the header section with metadata
     */
    private generateHeader(options: MarkdownOptions): string {
        return `# Codebase Export

**Generated:** ${options.exportTimestamp}  
**Workspace:** ${options.workspaceName}  
**Total Files:** ${options.totalFiles}  

---

`;
    }

    /**
     * Generate table of contents
     */
    private generateTableOfContents(fileContents: FileContent[]): string {
        let toc = '## Table of Contents\n\n';
        
        // Sort files by path for better organization
        const sortedFiles = [...fileContents].sort((a, b) => 
            a.relativePath.localeCompare(b.relativePath)
        );
        
        // Group files by directory
        const filesByDirectory = this.groupFilesByDirectory(sortedFiles);
        
        for (const [directory, files] of filesByDirectory) {
            if (directory) {
                toc += `### ${directory}\n\n`;
            }
            
            for (const file of files) {
                const anchor = this.generateAnchor(file.relativePath);
                const fileName = path.basename(file.relativePath);
                toc += `- [${fileName}](#${anchor})\n`;
            }
            
            toc += '\n';
        }
        
        toc += '---\n\n';
        return toc;
    }

    /**
     * Group files by their directory
     */
    private groupFilesByDirectory(files: FileContent[]): Map<string, FileContent[]> {
        const groups = new Map<string, FileContent[]>();
        
        for (const file of files) {
            const directory = path.dirname(file.relativePath);
            const displayDirectory = directory === '.' ? '' : directory;
            
            if (!groups.has(displayDirectory)) {
                groups.set(displayDirectory, []);
            }
            groups.get(displayDirectory)!.push(file);
        }
        
        return groups;
    }

    /**
     * Generate file contents section
     */
    private generateFileContents(fileContents: FileContent[]): string {
        let content = '## Files\n\n';
        
        // Sort files by path
        const sortedFiles = [...fileContents].sort((a, b) => 
            a.relativePath.localeCompare(b.relativePath)
        );
        
        for (const file of sortedFiles) {
            content += this.generateFileSection(file);
        }
        
        return content;
    }

    /**
     * Generate a single file section
     */
    private generateFileSection(file: FileContent): string {
        const anchor = this.generateAnchor(file.relativePath);
        
        return `### ${file.relativePath} {#${anchor}}

\`\`\`${file.language}
${file.content}
\`\`\`

---

`;
    }

    /**
     * Generate anchor for table of contents
     */
    private generateAnchor(filePath: string): string {
        return filePath
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    /**
     * Read file contents and determine language
     */
    private async readFileContents(filePaths: string[]): Promise<FileContent[]> {
        const fileContents: FileContent[] = [];
        
        for (const relativePath of filePaths) {
            try {
                const fullPath = path.join(this.workspacePath, relativePath);
                const content = fs.readFileSync(fullPath, 'utf8');
                const language = this.detectLanguage(relativePath);
                
                fileContents.push({
                    relativePath,
                    content,
                    language
                });
            } catch (error) {
                console.warn(`Failed to read file: ${relativePath}`, error);
                // Add placeholder for failed files
                fileContents.push({
                    relativePath,
                    content: `// Error reading file: ${error}`,
                    language: 'text'
                });
            }
        }
        
        return fileContents;
    }

    /**
     * Detect programming language based on file extension
     */
    private detectLanguage(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        
        const languageMap: { [key: string]: string } = {
            '.js': 'javascript',
            '.jsx': 'jsx',
            '.ts': 'typescript',
            '.tsx': 'tsx',
            '.py': 'python',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.h': 'c',
            '.hpp': 'cpp',
            '.cs': 'csharp',
            '.php': 'php',
            '.rb': 'ruby',
            '.go': 'go',
            '.rs': 'rust',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.clj': 'clojure',
            '.hs': 'haskell',
            '.ml': 'ocaml',
            '.fs': 'fsharp',
            '.vb': 'vbnet',
            '.sql': 'sql',
            '.html': 'html',
            '.htm': 'html',
            '.css': 'css',
            '.scss': 'scss',
            '.sass': 'sass',
            '.less': 'less',
            '.xml': 'xml',
            '.json': 'json',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.md': 'markdown',
            '.txt': 'text',
            '.sh': 'bash',
            '.bat': 'batch',
            '.ps1': 'powershell',
            '.dockerfile': 'dockerfile',
            '.gitignore': 'gitignore',
            '.env': 'bash'
        };
        
        return languageMap[ext] || 'text';
    }

    /**
     * Generate filename for the export
     */
    static generateFileName(template: string, workspaceName: string): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        
        return template
            .replace('{timestamp}', timestamp)
            .replace('{workspace}', workspaceName)
            + '.md';
    }

    /**
     * Get default markdown options from VS Code configuration
     */
    static getDefaultOptions(workspaceName: string): Omit<MarkdownOptions, 'totalFiles'> {
        const config = vscode.workspace.getConfiguration('codebaseExporter');
        
        return {
            includeTableOfContents: config.get('includeTableOfContents', true),
            workspaceName,
            exportTimestamp: new Date().toLocaleString()
        };
    }
}
