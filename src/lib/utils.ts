import * as path from 'path';

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