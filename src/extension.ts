import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const provider = new CodebaseAiViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CodebaseAiViewProvider.viewType, provider));

    context.subscriptions.push(
        vscode.commands.registerCommand('aidumpster.showUI', () => {
            vscode.commands.executeCommand('workbench.view.extension.codebase-ai-view-container');
        })
    );
}

class CodebaseAiViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'codebase-ai-view';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.command) {
                case 'createCodebase':
                    {
                        await this.createCodebase(data.prompt);
                        break;
                    }
                case 'applyGitDiff':
                    {
                        await this.applyGitDiff(data.diff);
                        break;
                    }
            }
        });
    }

    private async createCodebase(prompt: string) {
        const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => {
            if (tab.input instanceof vscode.TabInputText) {
                return !tab.input.uri.fsPath.endsWith('codebase.md');
            }
            return false;
        });

        if (tabs.length === 0) {
            vscode.window.showInformationMessage('No relevant files are open.');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            return;
        }
        const workspacePath = workspaceFolders[0].uri.fsPath;
        const codebaseFilePath = path.join(workspacePath, 'codebase.md');

        if (fs.existsSync(codebaseFilePath)) {
            fs.unlinkSync(codebaseFilePath);
        }

        const filePaths = tabs.map(tab => {
            if (tab.input instanceof vscode.TabInputText) {
                return vscode.workspace.asRelativePath(tab.input.uri);
            }
            return '';
        }).filter(p => p);


        let fileTree = this.generateFileTree(filePaths, workspacePath);
        let content = `# Task\n\n- ${prompt}\n\n# File Map\n\n${fileTree}\n\n# Codebase\n\nRespond with a valid git diff format. Do not include any other text or explanations. The diff should be directly applicable with 'git apply'.\n\n`;

        for (const tab of tabs) {
            if (tab.input instanceof vscode.TabInputText) {
                const uri = tab.input.uri;
                const document = await vscode.workspace.openTextDocument(uri);
                const filePath = vscode.workspace.asRelativePath(uri);
                const fileContent = document.getText();
                const languageId = document.languageId;

                content += `## ${filePath}\n\n\`\`\`${languageId}\n${fileContent}\n\`\`\`\n\n`;
            }
        }

        fs.writeFileSync(codebaseFilePath, content);
        await vscode.env.clipboard.writeText(content);
        vscode.window.showInformationMessage('codebase.md created and copied to clipboard!');
    }

    private async applyGitDiff(diffContent: string) {
        if (!diffContent) {
            vscode.window.showInformationMessage('No diff content provided.');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            return;
        }
        const workspacePath = workspaceFolders[0].uri.fsPath;

        try {
            const diffs = diffContent.split('--- a/');
            for (const diff of diffs) {
                if (!diff.trim()) continue;

                const lines = diff.split('\n');
                const filePathLine = lines[0];
                const filePath = filePathLine.split(' +++ b/')[0].trim();
                const fullPath = path.join(workspacePath, filePath);

                if (!fs.existsSync(fullPath)) {
                    vscode.window.showErrorMessage(`File not found: ${fullPath}`);
                    continue;
                }

                let fileContent = fs.readFileSync(fullPath, 'utf-8');
                let fileLines = fileContent.split('\n');

                const hunks = diff.split('@@');
                hunks.shift(); 

                let lineOffset = 0;

                for (let i = 0; i < hunks.length; i += 2) {
                    const hunkHeader = hunks[i];
                    const hunkBody = hunks[i + 1];

                    const match = hunkHeader.match(/ -(\d+),?(\d*) \+(\d+),?(\d*) /);
                    if (!match) continue;

                    let startLine = parseInt(match[1], 10) - 1;
                    const hunkLines = hunkBody.split('\n').slice(1, -1);

                    let localOffset = 0;
                    for (const line of hunkLines) {
                        if (line.startsWith('-')) {
                            fileLines.splice(startLine + lineOffset + localOffset, 1);
                        } else if (line.startsWith('+')) {
                            fileLines.splice(startLine + lineOffset + localOffset, 0, line.substring(1));
                            localOffset++;
                        } else {
                            startLine++;
                        }
                    }
                    lineOffset += localOffset - hunkLines.filter(l => l.startsWith('-')).length;
                }
                fs.writeFileSync(fullPath, fileLines.join('\n'));
            }
            vscode.window.showInformationMessage('Git diff applied successfully!');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error applying git diff: ${error.message}`);
        }
    }

    private generateFileTree(files: string[], root: string): string {
        const tree: any = {};

        files.forEach(file => {
            const parts = file.split(path.sep);
            let current = tree;
            parts.forEach(part => {
                if (!current[part]) {
                    current[part] = {};
                }
                current = current[part];
            });
        });

        let result = `${path.basename(root)}\n`;
        const buildTree = (current: any, prefix = '└── '): string => {
            let output = '';
            const keys = Object.keys(current);
            keys.forEach((key, index) => {
                const isLast = index === keys.length - 1;
                output += `${prefix}${isLast ? '└── ' : '├── '}${key}\n`;
                if (Object.keys(current[key]).length > 0) {
                    output += buildTree(current[key], `${prefix}${isLast ? '    ' : '│   '}`);
                }
            });
            return output;
        };

        return result + buildTree(tree);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.svg'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
   <html lang="en">
   <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Codebase AI</title>
   </head>
   <body>
                <div class="main-content">
                    <img src="${iconUri}" alt="Codebase AI Icon">
                    <p class="intro">Generate, refactor, and debug code with AI assistance.</p>
                    <div class="instructions">
                        <h3>How to use:</h3>
                        <p>
                            1. Open the files you want to include as context.<br>
                            2. Enter your prompt and click <strong>"Generate & Copy"</strong><br>
                            3. Paste it into your AI provider's web UI (e.g., Gemini, OpenAI, Anthropic).<br>
                            4. Copy the response, paste it into <strong>"Paste output here..."</strong>, and click <strong>"Apply Changes."</strong>
                        </p>
                    </div>
                </div>
                <div class="input-container">
                    <textarea id="prompt" placeholder="Type your task here..."></textarea>
                    <button id="create-codebase">Generate & Copy</button>
                    <textarea id="diff-input" placeholder="Paste output here..."></textarea>
                    <button id="apply-changes">Apply Changes</button>
                </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
   </body>
   </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() {}
