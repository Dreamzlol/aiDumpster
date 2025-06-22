import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GitDiffParser } from './gitDiffParser';
import { CodebaseExporter } from './codebaseExporter';

// --- Constants ---
const PASTR_VIEW_TYPE = 'pastr-view';
const CONTEXT_FILENAME = 'Pastr.md';
const PAST_EMOJI = '✨ Pastr:';

// --- Extension Activation ---
export function activate(context: vscode.ExtensionContext) {
    const provider = new PastrViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PASTR_VIEW_TYPE, provider),
        vscode.commands.registerCommand('pastr.showUI', () => {
            vscode.commands.executeCommand(`workbench.view.extension.${PASTR_VIEW_TYPE}`);
        }),

        // Codebase Exporter Commands
        vscode.commands.registerCommand('codebaseExporter.export', async () => {
            await handleCodebaseExport(false);
        }),
        vscode.commands.registerCommand('codebaseExporter.exportWithPreview', async () => {
            await handleCodebaseExport(true);
        }),
        vscode.commands.registerCommand('codebaseExporter.configure', async () => {
            await CodebaseExporter.openConfiguration();
        })
    );
}

// --- Main View Provider Class ---
class PastrViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = PASTR_VIEW_TYPE;
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(this.handleMessage.bind(this));
    }

    private async handleMessage(data: { command: string; payload: any }) {
        switch (data.command) {
            case 'generate':
                await this.generateContext(data.payload.prompt);
                break;
            case 'apply':
                await this.applyChanges(data.payload.diff);
                break;
            case 'showError':
                vscode.window.showErrorMessage(`${PAST_EMOJI} ${data.payload.message}`);
                break;
        }
    }

    // --- Core Logic Methods ---

    private async generateContext(prompt: string) {
        const workspacePath = this.getWorkspacePath();
        if (!workspacePath) {
            return;
        }

        const openTabs = this.getOpenEditorTabs();
        if (openTabs.length === 0) {
            vscode.window.showInformationMessage(`${PAST_EMOJI} No open files to use as context.`);
            return;
        }

        try {
            const contextContent = await this.buildContextString(prompt, openTabs, workspacePath);
            const contextFilePath = path.join(workspacePath, CONTEXT_FILENAME);

            fs.writeFileSync(contextFilePath, contextContent);
            await vscode.env.clipboard.writeText(contextContent);

            vscode.window.showInformationMessage(`${PAST_EMOJI} Context copied to clipboard!`);
        } catch (error) {
            vscode.window.showErrorMessage(`${PAST_EMOJI} Failed to generate context: ${error}`);
        }
    }

    private async applyChanges(diffContent: string) {
        if (!diffContent?.trim()) {
            vscode.window.showInformationMessage(`${PAST_EMOJI} No response provided to apply.`);
            return;
        }

        const workspacePath = this.getWorkspacePath();
        if (!workspacePath) {
            return;
        }

        try {
            const parser = new GitDiffParser(workspacePath);
            const result = await parser.applyDiff(diffContent);
            await this.handleApplyResult(result, diffContent);
        } catch (error: any) {
            this.handleApplyError(error);
        }
    }

    // --- Helper & UI Methods ---

    private async buildContextString(prompt: string, tabs: vscode.Tab[], workspacePath: string): Promise<string> {
        const filePaths = tabs.map(tab => vscode.workspace.asRelativePath((tab.input as vscode.TabInputText).uri));
        const fileTree = this.generateFileTree(filePaths, path.basename(workspacePath));
        
        const promptHeader = this.getPromptHeader(prompt, fileTree);
        
        const fileContents = await Promise.all(tabs.map(async tab => {
            const document = await vscode.workspace.openTextDocument((tab.input as vscode.TabInputText).uri);
            const relativePath = vscode.workspace.asRelativePath(document.uri);
            return `## ${relativePath}\n\n\`\`\`${document.languageId}\n${document.getText()}\n\`\`\`\n\n`;
        }));

        return promptHeader + fileContents.join('');
    }

    private getPromptHeader(prompt: string, fileTree: string): string {
        return `# Task\n\n- ${prompt}\n\n# File Map\n\n${fileTree}\n\n# Output Format\n\n- Respond ONLY with a valid git diff format. Do not include any other text, explanations, or markdown code blocks.\n- The diff must be directly applicable and parseable by standard git diff parsers.\n- Use proper git diff headers for each file operation (new, deleted, modified).\n- Include proper hunk headers with line numbers: \`@@ -start,count +start,count @@\`.\n- Prefix added lines with \`+\`, deleted lines with \`-\`, and unchanged context lines with a space.\n- Ensure all file paths are relative to the workspace root.\n\n# Context\n\n- The following files are related to the Task.\n\n`;
    }
    
    private async handleApplyResult(result: { success: boolean, message: string, errors: string[] }, originalDiff: string) {
        if (result.success) {
            vscode.window.showInformationMessage(`${PAST_EMOJI} ${result.message}`);
            if (result.errors.length > 0) {
                const choice = await vscode.window.showWarningMessage(`${PAST_EMOJI} Changes applied with ${result.errors.length} warning(s).`, 'View Details');
                if (choice === 'View Details') {
                    vscode.window.showInformationMessage(`${PAST_EMOJI} Warning details:\n• ${result.errors.join('\n• ')}`);
                }
            }
        } else {
            const choices = ['View Details', 'Retry'];
            const choice = await vscode.window.showErrorMessage(`${PAST_EMOJI} ${result.message}`, ...choices);

            if (choice === 'View Details' && result.errors.length > 0) {
                vscode.window.showErrorMessage(`${PAST_EMOJI} Error details:\n• ${result.errors.join('\n• ')}`);
            } else if (choice === 'Retry') {
                await this.applyChanges(originalDiff);
            }
        }
    }

    private async handleApplyError(error: any) {
        const choice = await vscode.window.showErrorMessage(`${PAST_EMOJI} Unexpected error: ${error.message}`, 'Report Issue');
        if (choice === 'Report Issue') {
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/your-repo/issues/new'));
        }
    }
    
    private getWorkspacePath(): string | undefined {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return folders[0].uri.fsPath;
        }
        vscode.window.showErrorMessage(`${PAST_EMOJI} No workspace folder is open.`);
        return undefined;
    }

    private getOpenEditorTabs(): vscode.Tab[] {
        return vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .filter(tab => tab.input instanceof vscode.TabInputText && !tab.input.uri.path.endsWith(CONTEXT_FILENAME));
    }

    private generateFileTree(files: string[], rootName: string): string {
        const tree: any = {};
        files.forEach(file => {
            let current = tree;
            file.split(path.sep).forEach(part => {
                current = current[part] = current[part] || {};
            });
        });

        const buildTreeString = (current: any, prefix: string): string => {
            let output = '';
            const keys = Object.keys(current);
            keys.forEach((key, index) => {
                const isLast = index === keys.length - 1;
                const connector = isLast ? '└── ' : '├── ';
                output += `${prefix}${connector}${key}\n`;
                if (Object.keys(current[key]).length > 0) {
                    const newPrefix = prefix + (isLast ? '    ' : '│   ');
                    output += buildTreeString(current[key], newPrefix);
                }
            });
            return output;
        };

        return `${rootName}\n` + buildTreeString(tree, '');
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const webviewHtmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.html');
        let html = fs.readFileSync(webviewHtmlPath.fsPath, 'utf8');

        // Replace placeholders with actual URIs
        const toUri = (filePath: string) => webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', filePath));
        html = html.replace(/{{nonce}}/g, getNonce());
        html = html.replace(/{{cspSource}}/g, webview.cspSource);
        html = html.replace(/{{styleUri}}/g, toUri('main.css').toString());
        html = html.replace(/{{scriptUri}}/g, toUri('main.js').toString());
        html = html.replace(/{{iconUri}}/g, toUri('icon.svg').toString());
        html = html.replace(/{{generateIconUri}}/g, toUri('generate-icon.svg').toString());
        html = html.replace(/{{applyIconUri}}/g, toUri('apply-icon.svg').toString());

        return html;
    }
}

// --- Codebase Export Handler ---
async function handleCodebaseExport(showPreview: boolean): Promise<void> {
    // Validate workspace
    const validation = CodebaseExporter.validateWorkspace();
    if (!validation.valid) {
        vscode.window.showErrorMessage(`Codebase Export: ${validation.message}`);
        return;
    }

    const workspacePath = CodebaseExporter.getWorkspacePath()!;
    const exporter = new CodebaseExporter(workspacePath);

    try {
        const result = await exporter.export({ showPreview });

        if (result.success) {
            if (result.stats) {
                const statsMessage = `Exported ${result.stats.includedFiles} files (${result.stats.excludedFiles} excluded from ${result.stats.totalFiles} total)`;

                if (result.filePath) {
                    const choice = await vscode.window.showInformationMessage(
                        `${result.message}\n${statsMessage}`,
                        'Open File',
                        'Show in Explorer'
                    );

                    if (choice === 'Open File') {
                        const doc = await vscode.workspace.openTextDocument(result.filePath);
                        await vscode.window.showTextDocument(doc);
                    } else if (choice === 'Show in Explorer') {
                        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.filePath));
                    }
                } else {
                    vscode.window.showInformationMessage(`${result.message}\n${statsMessage}`);
                }
            } else {
                vscode.window.showInformationMessage(result.message);
            }
        } else {
            vscode.window.showErrorMessage(`Codebase Export: ${result.message}`);
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Codebase Export failed: ${error.message}`);
    }
}

// --- Utility Functions ---
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() { }