import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { DEFAULT_EXCLUDE_PATTERNS, BINARY_FILE_EXTENSIONS } from './constants';

/**
 * Generates a random nonce string for Content Security Policy.
 * @returns {string} A 32-character random string.
 */
export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Generates a string representation of a file tree from a list of file paths.
 * @param {string[]} files An array of file paths relative to the root.
 * @param {string} rootName The name of the root directory.
 * @returns {string} A string formatted as a file tree.
 */
export function generateFileTree(files: string[], rootName: string): string {
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

async function readGitignore(workspacePath: string): Promise<string[]> {
    const gitignorePath = path.join(workspacePath, '.gitignore');
    try {
        if (fs.existsSync(gitignorePath)) {
            const content = await fs.promises.readFile(gitignorePath, 'utf8');
            return content.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'));
        }
    } catch (e) {
        console.warn(`Pastr: Could not read .gitignore file. Skipping. Error: ${e}`);
    }
    return [];
}

/**
 * Finds all relevant files in the workspace, respecting .gitignore and default excludes.
 * @param workspacePath The absolute path of the workspace.
 * @returns A promise that resolves to an array of file URIs.
 */
export async function getWorkspaceFiles(workspacePath: string): Promise<vscode.Uri[]> {
    // Check if we're in a VS Code workspace context
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        // Use VS Code's built-in file finding for actual workspace
        const gitignorePatterns = await readGitignore(workspacePath);
        const binaryPatterns = BINARY_FILE_EXTENSIONS.map(ext => `**/*${ext}`);

        const excludePatterns = [
            ...DEFAULT_EXCLUDE_PATTERNS,
            ...gitignorePatterns,
            ...binaryPatterns,
        ];

        const excludeGlob = `{${excludePatterns.join(',')}}`;
        return await vscode.workspace.findFiles('**/*', excludeGlob);
    } else {
        // Fallback for testing or when no workspace is open
        return await getWorkspaceFilesWithGlob(workspacePath);
    }
}

/**
 * Alternative implementation using glob for testing purposes.
 * @param workspacePath The absolute path of the workspace.
 * @returns A promise that resolves to an array of file URIs.
 */
export async function getWorkspaceFilesWithGlob(workspacePath: string): Promise<vscode.Uri[]> {
    const gitignorePatterns = await readGitignore(workspacePath);
    const binaryPatterns = BINARY_FILE_EXTENSIONS.map(ext => `**/*${ext}`);

    const excludePatterns = [
        ...DEFAULT_EXCLUDE_PATTERNS,
        ...gitignorePatterns,
        ...binaryPatterns,
    ];

    // Convert patterns to glob ignore patterns
    const ignorePatterns = excludePatterns.map(pattern => {
        // Handle different pattern types
        if (pattern.startsWith('**/')) {
            return pattern; // Keep as is for glob
        } else if (pattern.endsWith('/')) {
            return `**/${pattern}**`; // Directory patterns
        } else {
            return `**/${pattern}`; // File patterns
        }
    });



    try {
        const files = await glob('**/*', {
            cwd: workspacePath,
            ignore: ignorePatterns,
            nodir: true,
            dot: false
        });

        return files.map(file => vscode.Uri.file(path.join(workspacePath, file)));
    } catch (error) {
        console.warn(`Failed to find files with glob: ${error}`);
        return [];
    }
}