import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PASTR_VIEW_TYPE, CONTEXT_FILENAME, PAST_EMOJI } from './lib/constants';
import { PROMPT_ROLE, PROMPT_RULES, PROMPT_EXAMPLES, PROMPT_FINAL_REMINDERS, getTaskHeader } from './lib/prompts';
import { applySearchReplaceBlocks } from './lib/applicator';
import { getNonce, generateFileTree, getWorkspaceFiles } from './lib/utils';
import type { ApplyResult } from './lib/types';

/**
 * Manages the Pastr webview UI and orchestrates the command logic.
 */
export class PastrViewProvider implements vscode.WebviewViewProvider {
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

        webviewView.webview.onDidReceiveMessage(async (data: { command: string; payload: unknown }) => {
            await this.handleMessage(data);
        });
    }





private async handleMessage(data: { command: string; payload: any }) {
    switch (data.command) {
        case 'generate':
            await this.generateContext(data.payload.prompt, data.payload.mode);
            break;
        case 'apply':
            await this.applyChanges(data.payload.diff);
            break;
        case 'showError':
            vscode.window.showErrorMessage(`${PAST_EMOJI} ${data.payload.message}`);
            break;
    }
}

private async generateContext(prompt: string, mode?: 'clipboard' | 'file') {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) {
        return;
    }

    try {
        // Ensure we handle the mode correctly
        const actualMode = mode || 'clipboard';

        if (actualMode === 'file') {
            await this.generateFileExportContext(prompt, workspacePath);
        } else {
            await this.generateClipboardContext(prompt, workspacePath);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`${PAST_EMOJI} Failed to generate context: ${error}`);
    }
}

private async generateClipboardContext(prompt: string, workspacePath: string) {
    const openTabs = this.getOpenEditorTabs();
    if (openTabs.length === 0) {
        vscode.window.showInformationMessage(`${PAST_EMOJI} No open files to use as context.`);
        return;
    }

    const tabUris = openTabs.map(tab => (tab.input as vscode.TabInputText).uri);
    const contextContent = await this.buildContextStringFromUris(prompt, tabUris, workspacePath);

    await vscode.env.clipboard.writeText(contextContent);
    vscode.window.showInformationMessage(`${PAST_EMOJI} Context copied to clipboard!`);
}

private async generateFileExportContext(prompt: string, workspacePath: string) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Pastr: Exporting codebase...",
        cancellable: false
    }, async (progress) => {
        progress.report({ increment: 0, message: "Finding files..." });

        const allFiles = await getWorkspaceFiles(workspacePath);

        if (allFiles.length === 0) {
            vscode.window.showInformationMessage(`${PAST_EMOJI} No files found in the workspace to export.`);
            return;
        }
        progress.report({ increment: 20, message: `Found ${allFiles.length} files. Building context...` });

        const contextContent = await this.buildContextStringFromUris(prompt, allFiles, workspacePath);

        progress.report({ increment: 80, message: "Saving to file..." });
        const contextFilePath = path.join(workspacePath, CONTEXT_FILENAME);

        fs.writeFileSync(contextFilePath, contextContent);

        progress.report({ increment: 100 });
    });

    const openDoc = await vscode.workspace.openTextDocument(path.join(workspacePath, CONTEXT_FILENAME));
    await vscode.window.showTextDocument(openDoc);
    vscode.window.showInformationMessage(`${PAST_EMOJI} Codebase exported to ${CONTEXT_FILENAME}!`);
}

private async applyChanges(responseContent: string) {
    if (!responseContent?.trim()) {
        vscode.window.showInformationMessage(`${PAST_EMOJI} No response provided to apply.`);
        return;
    }

    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) {
        return;
    }

    try {
        const result = await applySearchReplaceBlocks(responseContent, workspacePath);
        await this.handleApplyResult(result, responseContent);
    } catch (error: any) {
        this.handleApplyError(error);
    }
}

private async buildContextStringFromUris(prompt: string, fileUris: vscode.Uri[], workspacePath: string): Promise<string> {
    const filePaths = fileUris.map(uri => vscode.workspace.asRelativePath(uri));
    const fileTree = generateFileTree(filePaths, path.basename(workspacePath));

    const promptHeader = this.getPromptHeader(prompt, fileTree);

    const fileContents = await Promise.all(fileUris.map(async uri => {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const relativePath = vscode.workspace.asRelativePath(document.uri);
            return `## ${relativePath}\n\n\`\`\`${document.languageId}\n${document.getText()}\n\`\`\`\n\n`;
        } catch (e) {
            console.warn(`Pastr: Could not read file ${uri.fsPath}. Skipping. Error: ${e}`);
            return '';
        }
    }));

    return promptHeader + fileContents.filter(c => c).join('');
}





    private getPromptHeader(prompt: string, fileTree: string): string {
        return [
            PROMPT_ROLE,
            PROMPT_RULES,
            PROMPT_EXAMPLES,
            PROMPT_FINAL_REMINDERS,
            getTaskHeader(prompt, fileTree)
        ].join('');
    }

    private async handleApplyResult(result: ApplyResult, originalContent: string) {
        if (result.success) {
            vscode.window.showInformationMessage(`${PAST_EMOJI} ${result.message}`);

            if (result.warnings.length > 0) {
                const choice = await vscode.window.showWarningMessage(
                    `${PAST_EMOJI} Changes applied with ${result.warnings.length} warning(s).`,
                    'View Warnings'
                );
                if (choice === 'View Warnings') {
                    vscode.window.showInformationMessage(`${PAST_EMOJI} Warning details:\n• ${result.warnings.join('\n• ')}`);
                }
            }

            if (result.errors.length > 0) {
                const choice = await vscode.window.showWarningMessage(
                    `${PAST_EMOJI} Some blocks failed to apply (${result.errors.length} error(s)).`,
                    'View Errors'
                );
                if (choice === 'View Errors') {
                    vscode.window.showErrorMessage(`${PAST_EMOJI} Error details:\n• ${result.errors.join('\n• ')}`);
                }
            }
        } else {
            const choices = ['View Details', 'Retry'];
            const choice = await vscode.window.showErrorMessage(`${PAST_EMOJI} ${result.message}`, ...choices);

            if (choice === 'View Details' && (result.errors.length > 0 || result.warnings.length > 0)) {
                const errorDetails = result.errors.length > 0 ? `Errors:\n• ${result.errors.join('\n• ')}` : '';
                const warningDetails = result.warnings.length > 0 ? `Warnings:\n• ${result.warnings.join('\n• ')}` : '';
                vscode.window.showErrorMessage(`${PAST_EMOJI} Operation failed. Details:\n${errorDetails}\n${warningDetails}`);
            } else if (choice === 'Retry') {
                await this.applyChanges(originalContent);
            }
        }
    }

    private async handleApplyError(error: any) {
        const message = error instanceof Error ? error.message : String(error);
        const choice = await vscode.window.showErrorMessage(`${PAST_EMOJI} Unexpected error: ${message}`, 'Report Issue');
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