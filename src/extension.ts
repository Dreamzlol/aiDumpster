import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const provider = new PastrViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PastrViewProvider.viewType, provider));

    context.subscriptions.push(
        vscode.commands.registerCommand('pastr.showUI', () => {
            vscode.commands.executeCommand('workbench.view.extension.pastr-view');
        })
    );
}

class PastrViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'pastr-view';

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
                case 'generate':
                    {
                        await this.generate(data.prompt);
                        break;
                    }
                case 'apply':
                    {
                        await this.apply(data.diff);
                        break;
                    }
                case 'showError':
                    {
                        vscode.window.showErrorMessage(data.message);
                        break;
                    }
            }
        });
    }

    private async generate(prompt: string) {
        const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => {
            if (tab.input instanceof vscode.TabInputText) {
                return !tab.input.uri.fsPath.endsWith('Pastr.md');
            }
            return false;
        });

        if (tabs.length === 0) {
            vscode.window.showInformationMessage('✨ Pastr: No open files to use as context.');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('✨ Pastr: No workspace folder is open.');
            return;
        }
        const workspacePath = workspaceFolders[0].uri.fsPath;
        const codebaseFilePath = path.join(workspacePath, 'Pastr.md');

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
        let content = `# Task\n\n- ${prompt}\n\n# File Map\n\n${fileTree}\n\n# Output Format\n\n- Respond with a valid git diff format. Do not include any other text or explanations. The diff should be directly applicable with 'git apply'.\n\n# Context\n\n- The following files are related to the Task.\n\n`;

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
        vscode.window.showInformationMessage('✨ Pastr: Context copied to clipboard!');
    }

    private async apply(diffContent: string) {
        if (!diffContent) {
            vscode.window.showInformationMessage('✨ Pastr: No response provided to apply.');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('✨ Pastr: No workspace folder is open.');
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
                    vscode.window.showErrorMessage(`✨ Pastr: File not found: ${fullPath}`);
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
            vscode.window.showInformationMessage('✨ Pastr: Changes applied successfully!');
        } catch (error: any) {
            vscode.window.showErrorMessage(`✨ Pastr: Error applying changes: ${error.message}`);
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
        const generateIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'generate-icon.svg'));
        const applyIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'apply-icon.svg'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
   <html lang="en">
   <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <link href="${styleUri}" rel="stylesheet">
    <title>Pastr</title>
   </head>
   <body class="flex flex-col h-screen text-white">
        <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
            <div class="w-full flex flex-col gap-4 m-auto px-5 min-[370px]:px-10 pt-5">
                <div class="flex flex-col items-center justify-center">
                    <img src="${iconUri}" alt="Pastr Icon" class="text-color-white h-16">
                </div>
                <p class="text-center text-balance max-w-[250px] py-2.5 mx-auto">
                    Generate, refactor, and debug code with AI assistance.
                </p>
                <div class="flex flex-col items-center justify-center px-5 py-2.5 gap-4">
                    <div class="flex items-center gap-2 max-w-[250px]">
                        <span>
                            <span><strong>Context</strong></span>: Open the files you want to include as context in vscode.
                        </span>
                    </div>
                    <div class="flex items-center gap-2 max-w-[250px]">
                        <span>
                            <span><strong>Task</strong></span>: Type your task and click Generate & Copy, it will be copied to the clipboard.
                        </span>
                    </div>
                    <div class="flex items-center gap-2 max-w-[250px]">
                        <span>
                            <span><strong>AI Provider</strong></span>: Paste it into your AI provider's web UI (e.g., Gemini, OpenAI, Anthropic), without any other text or explanations.
                        </span>
                    </div>
                    <div class="flex items-center gap-2 max-w-[250px]">
                        <span>
                            <span><strong>Apply Changes</strong></span>: Copy the response from your AI Provider, paste it into "Paste response here...", and click Apply Changes
                        </span>
                    </div>
                </div>
            </div>
        </div>
        <div class="relative flex flex-col gap-2 m-2 p-1.5 w-[calc(100%-16px)] ml-auto mr-auto box-border">
            <div class="relative">
                 <textarea id="prompt" placeholder="Type your task here..." class="w-full rounded-md py-1.5 px-2 border-1 border-gray-800 focus:border-blue-600 min-h-[90px] resize-none overflow-x-hidden overflow-y-auto pr-2 flex-none border-x flex-grow z-[2] scrollbar-none" style="height: 62px !important;"></textarea>
            </div>
            <button id="btn-generate" class="bg-sky-600 hover:bg-sky-700 rounded-md cursor-pointer text-white py-2 px-4 flex items-center justify-center gap-2">
                <img src="${generateIconUri}" alt="Generate Icon" class="h-6">
                Generate & Copy
            </button>
            <hr class="my-4 border-gray-800 mx-4">
            <div class="relative">
                <textarea id="diff-input" placeholder="Paste response here..." class="w-full rounded-md border-x py-1.5 px-2 border-1 border-gray-800 focus:border-blue-400 min-h-[40px] resize-none overflow-x-hidden overflow-y-auto pr-2 flex-none flex-grow z-[2] scrollbar-none"></textarea>
            </div>
            <button id="btn-apply" class="text-sm bg-green-600 hover:bg-green-700 cursor-pointer rounded-md text-white py-2 px-4 flex items-center justify-center gap-2">
                <img src="${applyIconUri}" alt="Apply Icon" class="h-4">
                Apply Changes
            </button>
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
