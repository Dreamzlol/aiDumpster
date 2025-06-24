import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PASTR_VIEW_TYPE, CONTEXT_FILENAME, PAST_EMOJI } from './lib/constants';
import { PROMPT_ROLE, PROMPT_RULES, PROMPT_EXAMPLES, PROMPT_FINAL_REMINDERS, getTaskHeader } from './lib/prompts';
import { applySearchReplaceBlocks } from './lib/applicator';
import { getNonce, generateFileTree } from './lib/utils';
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

    private async buildContextString(prompt: string, tabs: vscode.Tab[], workspacePath: string): Promise<string> {
        const filePaths = tabs.map(tab => vscode.workspace.asRelativePath((tab.input as vscode.TabInputText).uri));
        const fileTree = generateFileTree(filePaths, path.basename(workspacePath));

        const promptHeader = this.getPromptHeader(prompt, fileTree);

        const fileContents = await Promise.all(tabs.map(async tab => {
            const document = await vscode.workspace.openTextDocument((tab.input as vscode.TabInputText).uri);
            const relativePath = vscode.workspace.asRelativePath(document.uri);
            return `## ${relativePath}\n\n\`\`\`${document.languageId}\n${document.getText()}\n\`\`\`\n\n`;
        }));

        return promptHeader + fileContents.join('');
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
                    'View Details'
                );
                if (choice === 'View Details') {
                    vscode.window.showInformationMessage(`${PAST_EMOJI} Warning details:\n• ${result.warnings.join('\n• ')}`);
                }
            }

            if (result.errors.length > 0) {
                const choice = await vscode.window.showWarningMessage(
                    `${PAST_EMOJI} Some blocks failed to apply (${result.errors.length} error(s)).`,
                    'View Details'
                );
                if (choice === 'View Details') {
                    vscode.window.showErrorMessage(`${PAST_EMOJI} Error details:\n• ${result.errors.join('\n• ')}`);
                }
            }
        } else {
            const choices = ['View Details', 'Retry'];
            let message = `${PAST_EMOJI} ${result.message}`;
            if (result.warnings.length > 0) {
                message += ` (${result.warnings[0]})`;
            }

            const choice = await vscode.window.showErrorMessage(message, ...choices);

            if (choice === 'View Details' && result.errors.length > 0) {
                vscode.window.showErrorMessage(`${PAST_EMOJI} Error details:\n• ${result.errors.join('\n• ')}`);
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