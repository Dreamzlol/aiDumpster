import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// --- Constants ---
const PASTR_VIEW_TYPE = 'pastr-view';
const CONTEXT_FILENAME = 'Pastr.md';
const PAST_EMOJI = '✨ Pastr:';

// --- Interfaces ---
export interface SearchReplaceBlock {
    language: string;
    filePath: string;
    searchContent: string;
    replaceContent: string;
    isNewFile: boolean; // true if searchContent is empty
    lineNumber?: number; // for error reporting
}

export interface ApplyResult {
    success: boolean;
    message: string;
    filesProcessed: number;
    blocksProcessed: number;
    errors: string[];
    warnings: string[];
}

// --- Prompt Generation Sections ---

const PROMPT_ROLE = `
# Instructions

## Role

- Act as an **code editing assistant**: You can fulfill edit requests and chat with the user about code or other questions.

## Output format

**CRITICAL: Your response must ONLY contain the \`<search_replace_blocks>\` XML wrapper with SEARCH/REPLACE blocks inside. NO explanations, NO descriptions, NO additional text before or after the XML wrapper.**
`;

const PROMPT_RULES = `
### SEARCH/REPLACE Block Rules

Every *SEARCH/REPLACE block* must use this format:

1. **The *FULL* file path alone on a line, verbatim.** No bold asterisks, no quotes around it, no escaping of characters, etc.
2. **The opening fence and code language**, eg: \`\`\`python
3. **The start of search block**: \`<<<<<<< SEARCH\`
4. **A contiguous chunk of lines to search for in the existing source code**
5. **The dividing line**: \`=======\`
6. **The lines to replace into the source code**
7. **The end of the replace block**: \`>>>>>>> REPLACE\`
8. **The closing fence**: \`\`\`

#### Critical Rules

- **Your entire response must be ONLY: \`<search_replace_blocks>\` followed by the blocks, then \`</search_replace_blocks>\`. Nothing else.**
- **NO explanations, NO descriptions, NO "Here are the changes", NO "I've analyzed", NO additional text.**
- Use the *FULL* file path, as shown to you by the user.
- Every *SEARCH* section must *EXACTLY MATCH* the existing file content, character for character, including all comments, docstrings, etc.
- If the file contains code or other data wrapped/escaped in json/xml/quotes or other containers, you need to propose edits to the literal contents of the file, including the container markup.
- *SEARCH/REPLACE* blocks will *only* replace the first match occurrence.
- Include multiple unique *SEARCH/REPLACE* blocks if needed.
- Include enough lines in each SEARCH section to uniquely match each set of lines that need to change.
- Keep *SEARCH/REPLACE* blocks concise.
- Break large *SEARCH/REPLACE* blocks into a series of smaller blocks that each change a small portion of the file.
- Include just the changing lines, and a few surrounding lines if needed for uniqueness.
- Do not include long runs of unchanging lines in *SEARCH/REPLACE* blocks.
- Only create *SEARCH/REPLACE* blocks for files that the user has added to the chat!

**To move code within a file**: Use 2 *SEARCH/REPLACE* blocks: 1 to delete it from its current location, 1 to insert it in the new location.

**Pay attention to which filenames** the user wants you to edit, especially if they are asking you to create a new file.

**If you want to put code in a new file**, use a *SEARCH/REPLACE block* with:
- A new file path, including dir name if needed
- An empty \`SEARCH\` section
- The new file's contents in the \`REPLACE\` section
`;

const PROMPT_EXAMPLES = `
## Examples

### Example 1: Modifying Existing Code

**User Request**: "Change get_factorial() to use math.factorial"

**CORRECT Response Format** (NO explanations, ONLY the XML wrapper with blocks):

<search_replace_blocks>
mathweb/flask/app.py
\`\`\`python
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
\`\`\`

mathweb/flask/app.py
\`\`\`python
<<<<<<< SEARCH
def factorial(n):
    "compute factorial"

    if n == 0:
        return 1
    else:
        return n * factorial(n-1)

=======
>>>>>>> REPLACE
\`\`\`

mathweb/flask/app.py
\`\`\`python
<<<<<<< SEARCH
    return str(factorial(n))
=======
    return str(math.factorial(n))
>>>>>>> REPLACE
\`\`\`
</search_replace_blocks>

### Example 2: Creating New File and Refactoring

**User Request**: "Refactor hello() into its own file."

**CORRECT Response Format** (NO explanations, ONLY the XML wrapper with blocks):

<search_replace_blocks>
hello.py
\`\`\`python
<<<<<<< SEARCH
=======
def hello():
    "print a greeting"

    print("hello")
>>>>>>> REPLACE
\`\`\`

main.py
\`\`\`python
<<<<<<< SEARCH
def hello():
    "print a greeting"

    print("hello")
=======
from hello import hello
>>>>>>> REPLACE
\`\`\`
</search_replace_blocks>
`;

const PROMPT_FINAL_REMINDERS = `
## Final Reminders

- **YOUR ENTIRE RESPONSE MUST BE ONLY: \`<search_replace_blocks>\` followed by the blocks, then \`</search_replace_blocks>\`. NOTHING ELSE.**
- **NO "Hello", NO "I've analyzed", NO "Here are the changes", NO explanations, NO descriptions, NO additional text.**
- **DO NOT start with greetings, explanations, or analysis.**
- **DO NOT end with "Let me know if you need help" or similar phrases.**
- **ONLY EVER RETURN THE XML WRAPPER WITH SEARCH/REPLACE BLOCKS INSIDE!**
- You are diligent and tireless! You NEVER leave comments describing code without implementing it!
- You always COMPLETELY IMPLEMENT the needed code!
- Do not improve, comment, fix or modify unrelated parts of the code in any way!

**WRONG RESPONSE FORMAT:**
"Hello! I've analyzed your code and here are the changes: <search_replace_blocks>..."

**CORRECT RESPONSE FORMAT:**
<search_replace_blocks>
[blocks here]
</search_replace_blocks>
`;

const getTaskHeader = (prompt: string, fileTree: string): string => `
# Task

- ${prompt}

# File Map

${fileTree}

# Files

- The following files are related to the Task.
`;

// --- Extension Activation ---
export function activate(context: vscode.ExtensionContext) {
    const provider = new PastrViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PASTR_VIEW_TYPE, provider),
        vscode.commands.registerCommand('pastr.showUI', () => {
            vscode.commands.executeCommand(`workbench.view.extension.${PASTR_VIEW_TYPE}`);
        })
    );
}

// --- Main View Provider Class ---
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
            const result = await this.applySearchReplaceBlocks(responseContent, workspacePath);
            await this.handleApplyResult(result, responseContent);
        } catch (error: any) {
            this.handleApplyError(error);
        }
    }


    // --- SEARCH/REPLACE Block Parsing Methods (public for testing) ---

    /**
     * Robustly parse SEARCH/REPLACE blocks from AI response content.
     * Handles file paths being inside or outside the fenced code block.
     */
    public parseSearchReplaceBlocks(content: string): SearchReplaceBlock[] {
        if (!content || typeof content !== 'string') {
            return [];
        }

        let searchReplaceContent = content;
        const xmlTagRegex = /<search_replace_blocks>([\s\S]*?)<\/search_replace_blocks>/g;
        const xmlMatch = xmlTagRegex.exec(content);

        if (xmlMatch) {
            searchReplaceContent = xmlMatch[1];
        }

        const blocks: SearchReplaceBlock[] = [];
        const lines = searchReplaceContent.split('\n');

        let currentFilePath: string | null = null;
        let inFence = false;
        let fenceContentLines: string[] = [];
        let fenceLanguage = '';
        let blockIndex = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.startsWith('```')) {
                if (inFence) {
                    // --- End of a fenced block ---
                    inFence = false;
                    let filePathForBlock = currentFilePath;
                    let blockContent = fenceContentLines.join('\n');

                    // Check if file path is inside the block as the first line
                    const firstLine = fenceContentLines[0]?.trim();
                    if (firstLine && !firstLine.startsWith('<<<<<<< SEARCH')) {
                        filePathForBlock = firstLine;
                        blockContent = fenceContentLines.slice(1).join('\n');
                    }

                    if (filePathForBlock) {
                        blockIndex++;
                        const block = this.extractBlockContent(blockContent, fenceLanguage, filePathForBlock, blockIndex);
                        if (block) {
                            blocks.push(block);
                        }
                    } else {
                        console.warn(`Skipping block ${blockIndex + 1}: no file path found.`);
                    }

                    // Reset for next block
                    fenceContentLines = [];
                } else {
                    // --- Start of a new fenced block ---
                    inFence = true;
                    fenceLanguage = line.substring(3).trim();

                    // The file path is likely the line just before this one.
                    // We check the last non-empty line before the fence.
                    for (let j = i - 1; j >= 0; j--) {
                        const prevLine = lines[j].trim();
                        if (prevLine) {
                            // Heuristic to decide if it's a file path
                            if (prevLine.includes('.') || prevLine.includes('/') || prevLine.includes('\\')) {
                                currentFilePath = prevLine;
                            }
                            break; // Stop after finding the first non-empty line
                        }
                    }
                }
            } else if (inFence) {
                fenceContentLines.push(line);
            }
        }

        return blocks;
    }

    /**
     * Extract content from a single block's content string.
     * Assumes filePath is provided.
     */
    public extractBlockContent(blockContent: string, language: string, filePath: string, blockIndex: number): SearchReplaceBlock | null {
        const lines = blockContent.split('\n');

        // Find SEARCH/REPLACE markers, starting from line 0
        const searchStartIndex = this.findMarkerIndex(lines, '<<<<<<< SEARCH', 0);
        const dividerIndex = this.findMarkerIndex(lines, '=======', searchStartIndex + 1);
        const replaceEndIndex = this.findMarkerIndex(lines, '>>>>>>> REPLACE', dividerIndex + 1);

        if (searchStartIndex === -1 || dividerIndex === -1 || replaceEndIndex === -1) {
            return null; // Missing required markers
        }

        // Extract SEARCH content
        const searchLines = lines.slice(searchStartIndex + 1, dividerIndex);
        const searchContent = searchLines.join('\n');

        // Extract REPLACE content
        const replaceLines = lines.slice(dividerIndex + 1, replaceEndIndex);
        const replaceContent = replaceLines.join('\n');

        return {
            language,
            filePath,
            searchContent,
            replaceContent,
            isNewFile: searchContent.trim() === '',
            lineNumber: blockIndex
        };
    }


    /**
     * Find the index of a marker line starting from a given position
     */
    public findMarkerIndex(lines: string[], marker: string, startIndex: number): number {
        for (let i = startIndex; i < lines.length; i++) {
            if (lines[i].trim() === marker) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Validate a SEARCH/REPLACE block for correctness
     */
    public validateSearchReplaceBlock(block: SearchReplaceBlock): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Validate file path
        if (!block.filePath || block.filePath.trim() === '') {
            errors.push('File path is empty or missing');
        }

        // Check for invalid characters in file path
        if (block.filePath.includes('..') || path.isAbsolute(block.filePath)) {
            errors.push('File path contains invalid characters or is absolute');
        }

        // For existing files, search content cannot be empty unless it's intentionally a new file
        if (!block.isNewFile && block.searchContent.trim() === '') {
            errors.push('Search content is empty for existing file modification');
        }

        // Language should be specified
        if (!block.language || block.language.trim() === '') {
            errors.push('Programming language not specified in fenced block');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // --- SEARCH/REPLACE Block Application Methods (public for testing) ---

    /**
     * Apply SEARCH/REPLACE blocks with comprehensive error handling
     */
    public async applySearchReplaceBlocks(content: string, workspacePath: string): Promise<ApplyResult> {
        const result: ApplyResult = {
            success: false,
            message: '',
            filesProcessed: 0,
            blocksProcessed: 0,
            errors: [],
            warnings: []
        };

        try {
            // Parse blocks from content
            const blocks = this.parseSearchReplaceBlocks(content);

            if (blocks.length === 0) {
                result.message = 'No valid SEARCH/REPLACE blocks found';
                result.errors.push('No fenced code blocks with SEARCH/REPLACE format detected');
                return result;
            }

            const processedFiles = new Set<string>();
            let successfulBlocks = 0;

            // Process each block
            for (const block of blocks) {
                try {
                    // Validate block format
                    const validation = this.validateSearchReplaceBlock(block);
                    if (!validation.valid) {
                        result.errors.push(`Block ${block.lineNumber}: ${validation.errors.join(', ')}`);
                        continue;
                    }

                    // Apply the block
                    const blockResult = await this.applySearchReplaceBlock(block, workspacePath);

                    if (blockResult.success) {
                        successfulBlocks++;
                        processedFiles.add(block.filePath);
                        if (blockResult.warnings.length > 0) {
                            result.warnings.push(...blockResult.warnings);
                        }
                    } else {
                        result.errors.push(`Block ${block.lineNumber} (${block.filePath}): ${blockResult.message}`);
                        // Also collect warnings from failed blocks
                        if (blockResult.warnings.length > 0) {
                            result.warnings.push(...blockResult.warnings);
                        }
                    }

                } catch (error: any) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push(`Block ${block.lineNumber} (${block.filePath}): ${errorMsg}`);
                }
            }

            // Set final result
            result.blocksProcessed = successfulBlocks;
            result.filesProcessed = processedFiles.size;
            result.success = successfulBlocks > 0;

            if (result.success) {
                if (result.errors.length === 0) {
                    result.message = `Successfully applied ${successfulBlocks} block(s) to ${result.filesProcessed} file(s)`;
                } else {
                    result.message = `Applied ${successfulBlocks} block(s) to ${result.filesProcessed} file(s) with ${result.errors.length} error(s)`;
                }
            } else {
                result.message = `Failed to apply any blocks. ${result.errors.length} error(s) occurred`;
            }

        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            result.message = `Failed to process SEARCH/REPLACE blocks: ${errorMsg}`;
            result.errors.push(errorMsg);
        }

        return result;
    }

    /**
     * Apply a single SEARCH/REPLACE block
     */
    public async applySearchReplaceBlock(block: SearchReplaceBlock, workspacePath: string): Promise<ApplyResult> {
        const result: ApplyResult = {
            success: false,
            message: '',
            filesProcessed: 0,
            blocksProcessed: 0,
            errors: [],
            warnings: []
        };

        const fullPath = path.join(workspacePath, block.filePath);

        try {
            if (block.isNewFile) {
                // Create new file
                await this.createNewFile(fullPath, block.replaceContent);
                result.success = true;
                result.message = `Created new file: ${block.filePath}`;
                result.filesProcessed = 1;
                result.blocksProcessed = 1;
            } else {
                // Modify existing file
                const modifyResult = await this.findAndReplaceInFile(fullPath, block.searchContent, block.replaceContent);
                result.success = modifyResult.success;
                result.message = modifyResult.message;
                result.filesProcessed = modifyResult.success ? 1 : 0;
                result.blocksProcessed = modifyResult.success ? 1 : 0;
                result.errors = modifyResult.errors;
                result.warnings = modifyResult.warnings;
            }
        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            result.message = `Failed to apply block: ${errorMsg}`;
            result.errors.push(errorMsg);
        }

        return result;
    }

    /**
     * Create a new file with the specified content
     */
    public async createNewFile(filePath: string, content: string): Promise<void> {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Check if file already exists
        if (fs.existsSync(filePath)) {
            throw new Error(`File already exists: ${filePath}`);
        }

        // Write the file
        fs.writeFileSync(filePath, content, 'utf8');
    }

    /**
     * Find and replace content in an existing file
     */
    public async findAndReplaceInFile(filePath: string, searchContent: string, replaceContent: string): Promise<ApplyResult> {
        const result: ApplyResult = {
            success: false,
            message: '',
            filesProcessed: 0,
            blocksProcessed: 0,
            errors: [],
            warnings: []
        };

        try {
            if (!fs.existsSync(filePath)) {
                result.message = `File not found: ${filePath}`;
                result.errors.push(`File does not exist: ${filePath}`);
                return result;
            }

            const currentContent = fs.readFileSync(filePath, 'utf8');
            const newContent = currentContent.replace(searchContent, replaceContent);

            if (newContent === currentContent) {
                // Exact match failed, let's check for whitespace differences
                const currentTrimmed = currentContent.replace(/\s+/g, ' ').trim();
                const searchTrimmed = searchContent.replace(/\s+/g, ' ').trim();

                if (currentTrimmed.includes(searchTrimmed)) {
                    result.message = `Search content not found in file: ${path.basename(filePath)}`;
                    result.errors.push('Search content does not match any part of the file exactly');
                    result.warnings.push('A similar block was found, but whitespace (spaces, tabs, newlines) does not match. Please ensure the SEARCH block is an exact copy.');
                } else {
                    result.message = `Search content not found in file: ${path.basename(filePath)}`;
                    result.errors.push('Search content does not match any part of the file');
                }
                return result;
            }

            fs.writeFileSync(filePath, newContent, 'utf8');
            result.success = true;
            result.message = `Successfully modified: ${path.basename(filePath)}`;

        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            result.message = `Failed to modify file: ${errorMsg}`;
            result.errors.push(errorMsg);
        }

        return result;
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