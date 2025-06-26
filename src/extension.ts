import * as vscode from 'vscode';
import { PastrViewProvider } from './PastrViewProvider';

/**
 * This method is called when the extension is activated.
 * The extension is activated the very first time the command is executed.
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Pastr extension is now active!');

    // Register the webview view provider
    const provider = new PastrViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PastrViewProvider.viewType, provider)
    );

    // Register the command to show the UI (if needed)
    const showUICommand = vscode.commands.registerCommand('pastr.showUI', () => {
        // The webview view will be shown automatically when the user clicks on the activity bar
        // This command can be used to focus the view if needed
        vscode.commands.executeCommand('workbench.view.extension.pastr-view-container');
    });

    context.subscriptions.push(showUICommand);
}

/**
 * This method is called when the extension is deactivated.
 */
export function deactivate() {
    console.log('Pastr extension is now deactivated.');
}
