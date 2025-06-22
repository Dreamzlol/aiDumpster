import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FileFilter, FilterOptions } from './fileFilter';
import { MarkdownGenerator, MarkdownOptions } from './markdownGenerator';

export interface ExportOptions {
    showPreview?: boolean;
    customSavePath?: string;
}

export interface ExportResult {
    success: boolean;
    message: string;
    filePath?: string;
    stats?: {
        totalFiles: number;
        includedFiles: number;
        excludedFiles: number;
    };
}

export class CodebaseExporter {
    private workspacePath: string;
    private workspaceName: string;

    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;
        this.workspaceName = path.basename(workspacePath);
    }

    /**
     * Export the codebase to markdown
     */
    async export(options: ExportOptions = {}): Promise<ExportResult> {
        try {
            return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Exporting Codebase",
                cancellable: true
            }, async (progress, token) => {
                return await this.performExport(options, progress, token);
            });
        } catch (error: any) {
            return {
                success: false,
                message: `Export failed: ${error.message}`
            };
        }
    }

    /**
     * Perform the actual export with progress tracking
     */
    private async performExport(
        options: ExportOptions,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ): Promise<ExportResult> {
        // Step 1: Initialize filters
        progress.report({ message: "Initializing file filters...", increment: 10 });
        
        if (token.isCancellationRequested) {
            return { success: false, message: "Export cancelled by user" };
        }

        const fileFilter = new FileFilter(this.workspacePath);
        const filterOptions = FileFilter.getDefaultOptions();

        // Step 2: Filter files
        progress.report({ message: "Scanning and filtering files...", increment: 20 });
        
        const filterResult = await fileFilter.filterFiles(filterOptions);
        
        if (token.isCancellationRequested) {
            return { success: false, message: "Export cancelled by user" };
        }

        if (filterResult.includedFiles.length === 0) {
            return {
                success: false,
                message: "No files found to export. Check your include/exclude patterns."
            };
        }

        // Step 3: Generate markdown
        progress.report({ message: "Generating markdown content...", increment: 30 });
        
        const markdownGenerator = new MarkdownGenerator(this.workspacePath);
        const markdownOptions: MarkdownOptions = {
            ...MarkdownGenerator.getDefaultOptions(this.workspaceName),
            totalFiles: filterResult.includedFiles.length
        };

        const markdownContent = await markdownGenerator.generateMarkdown(
            filterResult.includedFiles,
            markdownOptions
        );

        if (token.isCancellationRequested) {
            return { success: false, message: "Export cancelled by user" };
        }

        // Step 4: Handle preview or save
        progress.report({ message: "Finalizing export...", increment: 20 });

        if (options.showPreview) {
            await this.showPreview(markdownContent, filterResult);
            return {
                success: true,
                message: "Preview generated successfully",
                stats: {
                    totalFiles: filterResult.totalFiles,
                    includedFiles: filterResult.includedFiles.length,
                    excludedFiles: filterResult.excludedFiles.length
                }
            };
        } else {
            const savePath = await this.saveMarkdown(markdownContent, options.customSavePath);
            
            progress.report({ increment: 20 });

            return {
                success: true,
                message: `Codebase exported successfully to ${path.basename(savePath)}`,
                filePath: savePath,
                stats: {
                    totalFiles: filterResult.totalFiles,
                    includedFiles: filterResult.includedFiles.length,
                    excludedFiles: filterResult.excludedFiles.length
                }
            };
        }
    }

    /**
     * Show preview of the markdown content
     */
    private async showPreview(markdownContent: string, filterResult: any): Promise<void> {
        // Create a temporary document for preview
        const doc = await vscode.workspace.openTextDocument({
            content: markdownContent,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside
        });

        // Show summary information
        const choice = await vscode.window.showInformationMessage(
            `Preview generated! Found ${filterResult.includedFiles.length} files to export (${filterResult.excludedFiles.length} excluded).`,
            'Save Export',
            'Configure Settings',
            'Close Preview'
        );

        if (choice === 'Save Export') {
            const savePath = await this.saveMarkdown(markdownContent);
            if (savePath) {
                vscode.window.showInformationMessage(`Codebase exported to ${path.basename(savePath)}`);
            }
        } else if (choice === 'Configure Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'codebaseExporter');
        }
    }

    /**
     * Save markdown content to file
     */
    private async saveMarkdown(content: string, customPath?: string): Promise<string> {
        let savePath: string;

        if (customPath) {
            savePath = customPath;
        } else {
            // Get default save path from configuration
            const config = vscode.workspace.getConfiguration('codebaseExporter');
            const defaultPath = config.get<string>('defaultExportPath', '');
            const fileNameTemplate = config.get<string>('fileNameTemplate', 'codebase-export-{timestamp}');
            
            const fileName = MarkdownGenerator.generateFileName(fileNameTemplate, this.workspaceName);
            
            if (defaultPath && fs.existsSync(defaultPath)) {
                savePath = path.join(defaultPath, fileName);
            } else {
                savePath = path.join(this.workspacePath, fileName);
            }

            // Ask user to confirm or choose different location
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(savePath),
                filters: {
                    'Markdown files': ['md'],
                    'All files': ['*']
                },
                title: 'Save Codebase Export'
            });

            if (!saveUri) {
                throw new Error('Save cancelled by user');
            }

            savePath = saveUri.fsPath;
        }

        // Ensure directory exists
        const directory = path.dirname(savePath);
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }

        // Write file
        fs.writeFileSync(savePath, content, 'utf8');

        return savePath;
    }

    /**
     * Open configuration settings
     */
    static async openConfiguration(): Promise<void> {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'codebaseExporter');
    }

    /**
     * Get workspace path from VS Code
     */
    static getWorkspacePath(): string | undefined {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return folders[0].uri.fsPath;
        }
        return undefined;
    }

    /**
     * Validate workspace before export
     */
    static validateWorkspace(): { valid: boolean; message?: string } {
        const workspacePath = CodebaseExporter.getWorkspacePath();
        
        if (!workspacePath) {
            return {
                valid: false,
                message: 'No workspace folder is open. Please open a folder to export.'
            };
        }

        if (!fs.existsSync(workspacePath)) {
            return {
                valid: false,
                message: 'Workspace folder does not exist or is not accessible.'
            };
        }

        return { valid: true };
    }
}
