import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import parseGitDiff from 'parse-git-diff';

export interface ApplyResult {
    success: boolean;
    message: string;
    filesProcessed: number;
    errors: string[];
}

export interface FileOperation {
    type: 'create' | 'modify' | 'delete' | 'rename';
    path: string;
    pathBefore?: string; // For renames
    content?: string;
    error?: string;
}

export class GitDiffParser {
    private workspacePath: string;

    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;
    }

    /**
     * Parse and apply git diff content with comprehensive error handling
     */
    public async applyDiff(diffContent: string): Promise<ApplyResult> {
        const result: ApplyResult = {
            success: false,
            message: '',
            filesProcessed: 0,
            errors: []
        };

        try {
            // Clean and validate diff content
            const cleanedDiff = this.cleanDiffContent(diffContent);
            if (!cleanedDiff) {
                result.message = 'No valid git diff content found';
                result.errors.push('Empty or invalid diff content');
                return result;
            }

            // Parse the diff using parse-git-diff
            const parsedDiff = parseGitDiff(cleanedDiff);
            if (!parsedDiff || !parsedDiff.files || parsedDiff.files.length === 0) {
                result.message = 'No files found in diff';
                result.errors.push('Failed to parse diff or no files found');
                return result;
            }

            // Process each file in the diff
            const operations: FileOperation[] = [];
            for (const file of parsedDiff.files) {
                try {
                    const operation = await this.processFile(file);
                    operations.push(operation);
                    if (!operation.error) {
                        result.filesProcessed++;
                    } else {
                        result.errors.push(`${operation.path}: ${operation.error}`);
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push(`Failed to process file: ${errorMsg}`);
                }
            }

            // Apply all valid operations
            await this.applyOperations(operations);

            if (result.errors.length === 0) {
                result.success = true;
                result.message = `Successfully applied changes to ${result.filesProcessed} file(s)`;
            } else {
                result.message = `Applied changes to ${result.filesProcessed} file(s) with ${result.errors.length} error(s)`;
                result.success = result.filesProcessed > 0;
            }

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            result.message = `Failed to apply diff: ${errorMsg}`;
            result.errors.push(errorMsg);
        }

        return result;
    }

    /**
     * Clean and validate diff content
     */
    private cleanDiffContent(diffContent: string): string {
        if (!diffContent || typeof diffContent !== 'string') {
            return '';
        }

        // Remove any non-diff content (common AI response artifacts)
        const lines = diffContent.split('\n');
        const diffStartIndex = lines.findIndex(line => line.startsWith('diff --git'));
        
        if (diffStartIndex === -1) {
            return '';
        }

        // Take only the diff content
        const diffLines = lines.slice(diffStartIndex);
        return diffLines.join('\n').trim();
    }

    /**
     * Process a single file from the parsed diff
     */
    private async processFile(file: any): Promise<FileOperation> {
        const operation: FileOperation = {
            type: 'modify',
            path: ''
        };

        try {
            switch (file.type) {
                case 'AddedFile':
                    return await this.handleAddedFile(file);
                case 'DeletedFile':
                    return await this.handleDeletedFile(file);
                case 'RenamedFile':
                    return await this.handleRenamedFile(file);
                case 'ChangedFile':
                    return await this.handleChangedFile(file);
                default:
                    operation.error = `Unsupported file type: ${file.type}`;
                    return operation;
            }
        } catch (error) {
            operation.error = error instanceof Error ? error.message : 'Unknown error';
            return operation;
        }
    }

    /**
     * Handle added files
     */
    private async handleAddedFile(file: any): Promise<FileOperation> {
        const operation: FileOperation = {
            type: 'create',
            path: file.path
        };

        try {
            const fullPath = path.join(this.workspacePath, file.path);
            
            // Check if file already exists
            if (fs.existsSync(fullPath)) {
                operation.error = `File already exists: ${file.path}`;
                return operation;
            }

            // Ensure directory exists
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Build file content from chunks
            const content = this.buildFileContentFromChunks(file.chunks, '');
            operation.content = content;

        } catch (error) {
            operation.error = error instanceof Error ? error.message : 'Failed to create file';
        }

        return operation;
    }

    /**
     * Handle deleted files
     */
    private async handleDeletedFile(file: any): Promise<FileOperation> {
        const operation: FileOperation = {
            type: 'delete',
            path: file.path
        };

        try {
            const fullPath = path.join(this.workspacePath, file.path);
            
            if (!fs.existsSync(fullPath)) {
                operation.error = `File does not exist: ${file.path}`;
                return operation;
            }

        } catch (error) {
            operation.error = error instanceof Error ? error.message : 'Failed to delete file';
        }

        return operation;
    }

    /**
     * Handle renamed files
     */
    private async handleRenamedFile(file: any): Promise<FileOperation> {
        const operation: FileOperation = {
            type: 'rename',
            path: file.pathAfter,
            pathBefore: file.pathBefore
        };

        try {
            const oldPath = path.join(this.workspacePath, file.pathBefore);
            const newPath = path.join(this.workspacePath, file.pathAfter);
            
            if (!fs.existsSync(oldPath)) {
                operation.error = `Source file does not exist: ${file.pathBefore}`;
                return operation;
            }

            if (fs.existsSync(newPath)) {
                operation.error = `Destination file already exists: ${file.pathAfter}`;
                return operation;
            }

            // Ensure destination directory exists
            const dir = path.dirname(newPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // If there are chunks, apply changes during rename
            if (file.chunks && file.chunks.length > 0) {
                const originalContent = fs.readFileSync(oldPath, 'utf-8');
                const modifiedContent = this.buildFileContentFromChunks(file.chunks, originalContent);
                operation.content = modifiedContent;
            }

        } catch (error) {
            operation.error = error instanceof Error ? error.message : 'Failed to rename file';
        }

        return operation;
    }

    /**
     * Handle changed files
     */
    private async handleChangedFile(file: any): Promise<FileOperation> {
        const operation: FileOperation = {
            type: 'modify',
            path: file.path
        };

        try {
            const fullPath = path.join(this.workspacePath, file.path);
            
            if (!fs.existsSync(fullPath)) {
                operation.error = `File does not exist: ${file.path}`;
                return operation;
            }

            const originalContent = fs.readFileSync(fullPath, 'utf-8');
            const modifiedContent = this.buildFileContentFromChunks(file.chunks, originalContent);
            operation.content = modifiedContent;

        } catch (error) {
            operation.error = error instanceof Error ? error.message : 'Failed to modify file';
        }

        return operation;
    }

    /**
     * Build file content from diff chunks
     */
    private buildFileContentFromChunks(chunks: any[], originalContent: string): string {
        if (!chunks || chunks.length === 0) {
            return originalContent;
        }

        const originalLines = originalContent ? originalContent.split('\n') : [];
        const resultLines: string[] = [];
        let originalIndex = 0;

        for (const chunk of chunks) {
            if (chunk.type === 'Chunk') {
                // Process regular chunk
                const fromStart = chunk.fromFileRange.start - 1; // Convert to 0-based
                
                // Add unchanged lines before this chunk
                while (originalIndex < fromStart && originalIndex < originalLines.length) {
                    resultLines.push(originalLines[originalIndex]);
                    originalIndex++;
                }

                // Process changes in this chunk
                for (const change of chunk.changes) {
                    switch (change.type) {
                        case 'UnchangedLine':
                            resultLines.push(change.content);
                            originalIndex++;
                            break;
                        case 'AddedLine':
                            resultLines.push(change.content);
                            break;
                        case 'DeletedLine':
                            originalIndex++; // Skip this line in original
                            break;
                        case 'MessageLine':
                            // Handle special messages like "No newline at end of file"
                            break;
                    }
                }
            } else if (chunk.type === 'CombinedChunk') {
                // Handle merge conflict chunks - skip for now
                // These are typically from merge conflicts and need special handling
                continue;
            }
        }

        // Add remaining unchanged lines
        while (originalIndex < originalLines.length) {
            resultLines.push(originalLines[originalIndex]);
            originalIndex++;
        }

        return resultLines.join('\n');
    }

    /**
     * Apply all file operations
     */
    private async applyOperations(operations: FileOperation[]): Promise<void> {
        for (const operation of operations) {
            if (operation.error) {
                continue; // Skip operations with errors
            }

            const fullPath = path.join(this.workspacePath, operation.path);

            switch (operation.type) {
                case 'create':
                    fs.writeFileSync(fullPath, operation.content || '');
                    break;
                case 'modify':
                    fs.writeFileSync(fullPath, operation.content || '');
                    break;
                case 'delete':
                    fs.unlinkSync(fullPath);
                    break;
                case 'rename':
                    const oldPath = path.join(this.workspacePath, operation.pathBefore!);
                    if (operation.content !== undefined) {
                        // Rename with content changes
                        fs.writeFileSync(fullPath, operation.content);
                        fs.unlinkSync(oldPath);
                    } else {
                        // Simple rename
                        fs.renameSync(oldPath, fullPath);
                    }
                    break;
            }
        }
    }
}
