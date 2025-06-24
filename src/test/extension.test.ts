import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import the interfaces from the extension
interface SearchReplaceBlock {
    language: string;
    filePath: string;
    searchContent: string;
    replaceContent: string;
    isNewFile: boolean;
    lineNumber?: number;
}

interface ApplyResult {
    success: boolean;
    message: string;
    filesProcessed: number;
    blocksProcessed: number;
    errors: string[];
    warnings: string[];
}

// Mock implementation for testing the SEARCH/REPLACE functionality
class TestSearchReplaceApplier {
    /**
     * Parse SEARCH/REPLACE blocks from AI response content
     */
    public parseSearchReplaceBlocks(content: string): SearchReplaceBlock[] {
        if (!content || typeof content !== 'string') {
            return [];
        }

        // First, try to extract content from within <search_replace_blocks> tags
        let searchReplaceContent = content;
        const xmlTagRegex = /<search_replace_blocks>([\s\S]*?)<\/search_replace_blocks>/g;
        const xmlMatch = xmlTagRegex.exec(content);

        if (xmlMatch) {
            // Use content within XML tags
            searchReplaceContent = xmlMatch[1];
        }
        // If no XML tags found, fall back to parsing the entire content for backward compatibility

        const blocks: SearchReplaceBlock[] = [];
        const fenceRegex = /```(\w+)?\s*\n([\s\S]*?)\n```/g;
        let match;
        let blockIndex = 0;

        while ((match = fenceRegex.exec(searchReplaceContent)) !== null) {
            blockIndex++;
            const language = match[1] || '';
            const blockContent = match[2];

            try {
                const block = this.extractBlockContent(blockContent, language, blockIndex);
                if (block) {
                    blocks.push(block);
                }
            } catch (error) {
                // Continue parsing other blocks even if one fails
                console.warn(`Failed to parse block ${blockIndex}:`, error);
            }
        }

        return blocks;
    }

    /**
     * Extract content from a single fenced block
     */
    private extractBlockContent(blockContent: string, language: string, blockIndex: number): SearchReplaceBlock | null {
        const lines = blockContent.split('\n');

        if (lines.length < 2) {
            return null; // Not enough content for a valid block
        }

        // First non-empty line should be the file path
        let filePathIndex = -1;
        let filePath = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('<<<<<<< SEARCH') && !line.startsWith('=======') && !line.startsWith('>>>>>>> REPLACE')) {
                filePath = line;
                filePathIndex = i;
                break;
            }
        }

        if (!filePath || filePathIndex === -1) {
            return null; // No valid file path found
        }

        // Find SEARCH/REPLACE markers
        const searchStartIndex = this.findMarkerIndex(lines, '<<<<<<< SEARCH', filePathIndex + 1);
        const dividerIndex = this.findMarkerIndex(lines, '=======', searchStartIndex + 1);
        const replaceEndIndex = this.findMarkerIndex(lines, '>>>>>>> REPLACE', dividerIndex + 1);

        if (searchStartIndex === -1 || dividerIndex === -1 || replaceEndIndex === -1) {
            return null; // Missing required markers
        }

        // Extract SEARCH content (between <<<<<<< SEARCH and =======)
        const searchLines = lines.slice(searchStartIndex + 1, dividerIndex);
        const searchContent = searchLines.join('\n');

        // Extract REPLACE content (between ======= and >>>>>>> REPLACE)
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
    private findMarkerIndex(lines: string[], marker: string, startIndex: number): number {
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
        if (block.filePath.includes('..') || block.filePath.startsWith('/')) {
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
    private async applySearchReplaceBlock(block: SearchReplaceBlock, workspacePath: string): Promise<ApplyResult> {
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
    private async createNewFile(filePath: string, content: string): Promise<void> {
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
    private async findAndReplaceInFile(filePath: string, searchContent: string, replaceContent: string): Promise<ApplyResult> {
        const result: ApplyResult = {
            success: false,
            message: '',
            filesProcessed: 0,
            blocksProcessed: 0,
            errors: [],
            warnings: []
        };

        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                result.message = `File not found: ${filePath}`;
                result.errors.push(`File does not exist: ${filePath}`);
                return result;
            }

            // Read current file content
            const currentContent = fs.readFileSync(filePath, 'utf8');

            // Handle empty replace content (deletion)
            if (replaceContent.trim() === '' && searchContent.trim() !== '') {
                // This is a deletion operation
                if (!currentContent.includes(searchContent)) {
                    result.message = `Search content not found in file: ${path.basename(filePath)}`;
                    result.errors.push('Search content does not match any part of the file');
                    return result;
                }

                const newContent = currentContent.replace(searchContent, '');
                fs.writeFileSync(filePath, newContent, 'utf8');
                result.success = true;
                result.message = `Deleted content from: ${path.basename(filePath)}`;
                return result;
            }

            // Normal search and replace
            if (!currentContent.includes(searchContent)) {
                result.message = `Search content not found in file: ${path.basename(filePath)}`;
                result.errors.push('Search content does not match any part of the file exactly');

                // Provide helpful debugging info
                const lines = currentContent.split('\n');
                const searchLines = searchContent.split('\n');
                if (searchLines.length === 1) {
                    // Single line search - check if it exists with different whitespace
                    const trimmedSearch = searchContent.trim();
                    const matchingLines = lines.filter(line => line.trim() === trimmedSearch);
                    if (matchingLines.length > 0) {
                        result.warnings.push('Search content found with different whitespace. Ensure exact character match including spaces and tabs.');
                    }
                }

                return result;
            }

            // Perform the replacement (only first occurrence as per Aider rules)
            const newContent = currentContent.replace(searchContent, replaceContent);

            // Verify the replacement actually changed something
            if (newContent === currentContent) {
                result.message = `No changes made to file: ${path.basename(filePath)}`;
                result.warnings.push('Search and replace content are identical');
                result.success = true; // Still consider it successful
                return result;
            }

            // Write the modified content back
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
}

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Sample test', () => {
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });
});

suite('SEARCH/REPLACE Block Test Suite', () => {
    let applier: TestSearchReplaceApplier;
    let tempDir: string;

    setup(() => {
        applier = new TestSearchReplaceApplier();
        // Create a temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pastr-test-'));
    });

    teardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('Should parse valid SEARCH/REPLACE blocks (legacy format)', () => {
        const validContent = `\`\`\`python
test.py
<<<<<<< SEARCH
def old_function():
    return "old"
=======
def new_function():
    return "new"
>>>>>>> REPLACE
\`\`\``;

        const blocks = applier.parseSearchReplaceBlocks(validContent);
        assert.strictEqual(blocks.length, 1);
        assert.strictEqual(blocks[0].language, 'python');
        assert.strictEqual(blocks[0].filePath, 'test.py');
        assert.strictEqual(blocks[0].searchContent, 'def old_function():\n    return "old"');
        assert.strictEqual(blocks[0].replaceContent, 'def new_function():\n    return "new"');
        assert.strictEqual(blocks[0].isNewFile, false);
    });

    test('Should parse valid SEARCH/REPLACE blocks with XML wrapper', () => {
        const validContent = `<search_replace_blocks>
\`\`\`python
test.py
<<<<<<< SEARCH
def old_function():
    return "old"
=======
def new_function():
    return "new"
>>>>>>> REPLACE
\`\`\`
</search_replace_blocks>`;

        const blocks = applier.parseSearchReplaceBlocks(validContent);
        assert.strictEqual(blocks.length, 1);
        assert.strictEqual(blocks[0].language, 'python');
        assert.strictEqual(blocks[0].filePath, 'test.py');
        assert.strictEqual(blocks[0].searchContent, 'def old_function():\n    return "old"');
        assert.strictEqual(blocks[0].replaceContent, 'def new_function():\n    return "new"');
        assert.strictEqual(blocks[0].isNewFile, false);
    });

    test('Should handle empty or invalid content', async () => {
        const result1 = await applier.applySearchReplaceBlocks('', tempDir);
        assert.strictEqual(result1.success, false);
        assert.strictEqual(result1.message, 'No valid SEARCH/REPLACE blocks found');

        const result2 = await applier.applySearchReplaceBlocks('invalid content', tempDir);
        assert.strictEqual(result2.success, false);
        assert.strictEqual(result2.message, 'No valid SEARCH/REPLACE blocks found');
    });

    test('Should parse multiple SEARCH/REPLACE blocks (legacy format)', () => {
        const multiBlockContent = `\`\`\`python
file1.py
<<<<<<< SEARCH
def old_func1():
    pass
=======
def new_func1():
    pass
>>>>>>> REPLACE
\`\`\`

\`\`\`javascript
file2.js
<<<<<<< SEARCH
function oldFunc2() {}
=======
function newFunc2() {}
>>>>>>> REPLACE
\`\`\``;

        const blocks = applier.parseSearchReplaceBlocks(multiBlockContent);
        assert.strictEqual(blocks.length, 2);
        assert.strictEqual(blocks[0].filePath, 'file1.py');
        assert.strictEqual(blocks[1].filePath, 'file2.js');
    });

    test('Should parse multiple SEARCH/REPLACE blocks with XML wrapper', () => {
        const multiBlockContent = `<search_replace_blocks>
\`\`\`python
file1.py
<<<<<<< SEARCH
def old_func1():
    pass
=======
def new_func1():
    pass
>>>>>>> REPLACE
\`\`\`

\`\`\`javascript
file2.js
<<<<<<< SEARCH
function oldFunc2() {}
=======
function newFunc2() {}
>>>>>>> REPLACE
\`\`\`
</search_replace_blocks>`;

        const blocks = applier.parseSearchReplaceBlocks(multiBlockContent);
        assert.strictEqual(blocks.length, 2);
        assert.strictEqual(blocks[0].filePath, 'file1.py');
        assert.strictEqual(blocks[1].filePath, 'file2.js');
    });

    test('Should validate SEARCH/REPLACE block format', () => {
        const validBlock: SearchReplaceBlock = {
            language: 'python',
            filePath: 'test.py',
            searchContent: 'old code',
            replaceContent: 'new code',
            isNewFile: false,
            lineNumber: 1
        };

        const invalidBlock: SearchReplaceBlock = {
            language: '',
            filePath: '',
            searchContent: '',
            replaceContent: 'new code',
            isNewFile: false,
            lineNumber: 1
        };

        const validation1 = applier.validateSearchReplaceBlock(validBlock);
        const validation2 = applier.validateSearchReplaceBlock(invalidBlock);

        assert.strictEqual(validation1.valid, true);
        assert.strictEqual(validation2.valid, false);
        assert.strictEqual(validation2.errors.length > 0, true);
    });

    test('Should handle malformed SEARCH/REPLACE blocks - missing markers', () => {
        const malformedContent = `\`\`\`python
test.py
def old_function():
    return "old"
def new_function():
    return "new"
\`\`\``;

        const blocks = applier.parseSearchReplaceBlocks(malformedContent);
        assert.strictEqual(blocks.length, 0);
    });

    test('Should handle malformed SEARCH/REPLACE blocks - missing file path', () => {
        const malformedContent = `\`\`\`python
<<<<<<< SEARCH
def old_function():
    return "old"
=======
def new_function():
    return "new"
>>>>>>> REPLACE
\`\`\``;

        const blocks = applier.parseSearchReplaceBlocks(malformedContent);
        assert.strictEqual(blocks.length, 0);
    });

    test('Should handle new file creation', async () => {
        const newFileContent = `\`\`\`python
new_file.py
<<<<<<< SEARCH
=======
def hello():
    print("Hello, World!")

if __name__ == "__main__":
    hello()
>>>>>>> REPLACE
\`\`\``;

        const result = await applier.applySearchReplaceBlocks(newFileContent, tempDir);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.filesProcessed, 1);
        assert.strictEqual(result.blocksProcessed, 1);

        // Verify file was created
        const filePath = path.join(tempDir, 'new_file.py');
        assert.strictEqual(fs.existsSync(filePath), true);

        const content = fs.readFileSync(filePath, 'utf8');
        assert.strictEqual(content.includes('def hello():'), true);
        assert.strictEqual(content.includes('print("Hello, World!")'), true);
    });

    test('Should handle file modification', async () => {
        // First create a file
        const filePath = path.join(tempDir, 'existing_file.py');
        const originalContent = `def old_function():
    return "old value"

print("test")`;
        fs.writeFileSync(filePath, originalContent, 'utf8');

        // Now modify it
        const modifyContent = `\`\`\`python
existing_file.py
<<<<<<< SEARCH
def old_function():
    return "old value"
=======
def new_function():
    return "new value"
>>>>>>> REPLACE
\`\`\``;

        const result = await applier.applySearchReplaceBlocks(modifyContent, tempDir);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.filesProcessed, 1);
        assert.strictEqual(result.blocksProcessed, 1);

        // Verify file was modified
        const newContent = fs.readFileSync(filePath, 'utf8');
        assert.strictEqual(newContent.includes('def new_function():'), true);
        assert.strictEqual(newContent.includes('return "new value"'), true);
        assert.strictEqual(newContent.includes('print("test")'), true); // Should preserve other content
    });

    test('Should handle content deletion', async () => {
        // First create a file
        const filePath = path.join(tempDir, 'delete_test.py');
        const originalContent = `def function_to_delete():
    return "delete me"

def keep_this():
    return "keep me"`;
        fs.writeFileSync(filePath, originalContent, 'utf8');

        // Now delete part of it
        const deleteContent = `\`\`\`python
delete_test.py
<<<<<<< SEARCH
def function_to_delete():
    return "delete me"

=======
>>>>>>> REPLACE
\`\`\``;

        const result = await applier.applySearchReplaceBlocks(deleteContent, tempDir);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.filesProcessed, 1);
        assert.strictEqual(result.blocksProcessed, 1);

        // Verify content was deleted
        const newContent = fs.readFileSync(filePath, 'utf8');
        assert.strictEqual(newContent.includes('function_to_delete'), false);
        assert.strictEqual(newContent.includes('keep_this'), true);
    });

    test('Should handle complex multi-file operations', async () => {
        // Create an existing file first
        const existingFilePath = path.join(tempDir, 'existing.ts');
        fs.writeFileSync(existingFilePath, `interface User {
  name: string;
}

export { User };`, 'utf8');

        const complexContent = `\`\`\`javascript
new-file.js
<<<<<<< SEARCH
=======
console.log('new file');
export default function() {
  return 'hello';
}
>>>>>>> REPLACE
\`\`\`

\`\`\`typescript
existing.ts
<<<<<<< SEARCH
interface User {
  name: string;
}
=======
interface User {
  name: string;
  email: string;
}
>>>>>>> REPLACE
\`\`\``;

        const result = await applier.applySearchReplaceBlocks(complexContent, tempDir);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.filesProcessed, 2);
        assert.strictEqual(result.blocksProcessed, 2);

        // Verify new file was created
        const newFilePath = path.join(tempDir, 'new-file.js');
        assert.strictEqual(fs.existsSync(newFilePath), true);
        const newFileContent = fs.readFileSync(newFilePath, 'utf8');
        assert.strictEqual(newFileContent.includes('console.log'), true);

        // Verify existing file was modified
        const modifiedContent = fs.readFileSync(existingFilePath, 'utf8');
        assert.strictEqual(modifiedContent.includes('email: string'), true);
    });

    test('Should handle files with special characters and unicode', async () => {
        const unicodeContent = `\`\`\`text
unicode-file.txt
<<<<<<< SEARCH
=======
Hello 世界 🌍
Café résumé naïve
Special chars: @#$%^&*()
>>>>>>> REPLACE
\`\`\``;

        const result = await applier.applySearchReplaceBlocks(unicodeContent, tempDir);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.filesProcessed, 1);

        const filePath = path.join(tempDir, 'unicode-file.txt');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.strictEqual(content.includes('Hello 世界 🌍'), true);
        assert.strictEqual(content.includes('Café résumé naïve'), true);
    });

    test('Should handle files with very long lines', async () => {
        const longLine = 'a'.repeat(1000);
        const longLineContent = `\`\`\`text
long-line.txt
<<<<<<< SEARCH
=======
${longLine}
>>>>>>> REPLACE
\`\`\``;

        const result = await applier.applySearchReplaceBlocks(longLineContent, tempDir);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.filesProcessed, 1);

        const filePath = path.join(tempDir, 'long-line.txt');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.strictEqual(content.length, longLine.length);
    });

    test('Should handle nested directory structures', async () => {
        const nestedContent = `\`\`\`tsx
src/components/ui/Button/Button.tsx
<<<<<<< SEARCH
=======
import React from 'react';

export const Button = () => {
  return <button>Click me</button>;
};
>>>>>>> REPLACE
\`\`\``;

        const result = await applier.applySearchReplaceBlocks(nestedContent, tempDir);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.filesProcessed, 1);

        const filePath = path.join(tempDir, 'src', 'components', 'ui', 'Button', 'Button.tsx');
        assert.strictEqual(fs.existsSync(filePath), true);
        const content = fs.readFileSync(filePath, 'utf8');
        assert.strictEqual(content.includes('import React'), true);
    });

    test('Should handle search content not found error', async () => {
        // Create a file
        const filePath = path.join(tempDir, 'test_file.py');
        fs.writeFileSync(filePath, 'def existing_function():\n    pass', 'utf8');

        const searchNotFoundContent = `\`\`\`python
test_file.py
<<<<<<< SEARCH
def non_existent_function():
    pass
=======
def new_function():
    pass
>>>>>>> REPLACE
\`\`\``;

        const result = await applier.applySearchReplaceBlocks(searchNotFoundContent, tempDir);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.errors.length > 0, true);
        assert.strictEqual(result.errors[0].includes('Search content not found'), true);
    });

    test('Should handle exact whitespace matching requirement', async () => {
        // Create a file with specific whitespace (4 spaces)
        const filePath = path.join(tempDir, 'whitespace_test.js');
        fs.writeFileSync(filePath, 'function test() {\n    return true;\n}', 'utf8');

        // Try to match with different whitespace (2 spaces) - should fail
        const whitespaceContent = `\`\`\`javascript
whitespace_test.js
<<<<<<< SEARCH
function test() {
  return true;
}
=======
function test() {
  return false;
}
>>>>>>> REPLACE
\`\`\``;

        const result = await applier.applySearchReplaceBlocks(whitespaceContent, tempDir);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.errors.length > 0, true);
        assert.strictEqual(result.errors[0].includes('Search content not found'), true);
    });

    test('Should handle file already exists error for new files', async () => {
        // Create a file first
        const filePath = path.join(tempDir, 'existing.py');
        fs.writeFileSync(filePath, 'existing content', 'utf8');

        // Try to create the same file
        const duplicateContent = `\`\`\`python
existing.py
<<<<<<< SEARCH
=======
new content
>>>>>>> REPLACE
\`\`\``;

        const result = await applier.applySearchReplaceBlocks(duplicateContent, tempDir);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.errors.length > 0, true);
        assert.strictEqual(result.errors[0].includes('File already exists'), true);
    });

    test('Should ignore explanatory text outside XML wrapper', () => {
        const contentWithExplanation = `I've analyzed your code and identified several areas for improvement to enhance simplicity, readability, and reusability. Here are the refactoring changes I'll make:

1. **Component Props & Data simplification**:
   - \`About\` and \`Job\` components will be updated to accept data more directly, removing redundant \`title\` properties from the data structures and passing them as props instead.

2. **Reusable \`SocialLinks\` component**:
   - The \`SocialLinks\` component will be refactored to be data-driven, using an array of social links.

Here are the search/replace blocks for the changes:

<search_replace_blocks>
\`\`\`svelte
src/lib/components/about/About.svelte
<<<<<<< SEARCH
<script lang="ts">
	import type { AboutItem } from '$lib/types/about'

	interface Props {
		data: AboutItem[]
	}

	let { data }: Props = $props()
</script>
=======
<script lang="ts">
	import type { AboutItem } from '$lib/types/about'

	interface Props {
		data: AboutItem
		title: string
	}

	let { data, title }: Props = $props()
</script>
>>>>>>> REPLACE
\`\`\`

\`\`\`svelte
src/lib/components/footer/Footer.svelte
<<<<<<< SEARCH
				<p class="text-sm">© 2025 Denis Da Silva Rocha</p>
=======
				<p class="text-sm">© {new Date().getFullYear()} Denis Da Silva Rocha</p>
>>>>>>> REPLACE
\`\`\`
</search_replace_blocks>`;

        const blocks = applier.parseSearchReplaceBlocks(contentWithExplanation);
        assert.strictEqual(blocks.length, 2);
        assert.strictEqual(blocks[0].filePath, 'src/lib/components/about/About.svelte');
        assert.strictEqual(blocks[1].filePath, 'src/lib/components/footer/Footer.svelte');
        assert.strictEqual(blocks[0].language, 'svelte');
        assert.strictEqual(blocks[1].language, 'svelte');
    });

    test('Should handle XML wrapper with mixed content and multiple blocks', async () => {
        // Create test files first
        const aboutFilePath = path.join(tempDir, 'About.svelte');
        const footerFilePath = path.join(tempDir, 'Footer.svelte');

        fs.writeFileSync(aboutFilePath, `<script lang="ts">
	import type { AboutItem } from '$lib/types/about'

	interface Props {
		data: AboutItem[]
	}

	let { data }: Props = $props()
</script>`, 'utf8');

        fs.writeFileSync(footerFilePath, `				<p class="text-sm">© 2025 Denis Da Silva Rocha</p>`, 'utf8');

        const contentWithExplanation = `I've analyzed your code and here are the changes:

<search_replace_blocks>
\`\`\`svelte
About.svelte
<<<<<<< SEARCH
<script lang="ts">
	import type { AboutItem } from '$lib/types/about'

	interface Props {
		data: AboutItem[]
	}

	let { data }: Props = $props()
</script>
=======
<script lang="ts">
	import type { AboutItem } from '$lib/types/about'

	interface Props {
		data: AboutItem
		title: string
	}

	let { data, title }: Props = $props()
</script>
>>>>>>> REPLACE
\`\`\`

\`\`\`svelte
Footer.svelte
<<<<<<< SEARCH
				<p class="text-sm">© 2025 Denis Da Silva Rocha</p>
=======
				<p class="text-sm">© {new Date().getFullYear()} Denis Da Silva Rocha</p>
>>>>>>> REPLACE
\`\`\`
</search_replace_blocks>`;

        const result = await applier.applySearchReplaceBlocks(contentWithExplanation, tempDir);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.filesProcessed, 2);
        assert.strictEqual(result.blocksProcessed, 2);

        // Verify files were modified correctly
        const aboutContent = fs.readFileSync(aboutFilePath, 'utf8');
        const footerContent = fs.readFileSync(footerFilePath, 'utf8');

        assert.strictEqual(aboutContent.includes('title: string'), true);
        assert.strictEqual(footerContent.includes('new Date().getFullYear()'), true);
    });

    test('Should handle problematic LLM output with explanations before and after XML wrapper', () => {
        const problematicOutput = `Hello! As a code editing assistant, I'm happy to help you with your request. I've reviewed your code and identified several areas for improvement to make it more simple, readable, and concise, including creating reusable components as you suggested. Here are the edits I've prepared.

I'll start by refactoring the About component and its data structure to be more direct. Then, I'll adjust the Job component to be more reusable by abstracting its title.

Here are the changes:

<search_replace_blocks>
` + '```' + `svelte
src/lib/components/about/About.svelte
<<<<<<< SEARCH
<script lang="ts">
	import type { AboutItem } from '$lib/types/about'

	interface Props {
		data: AboutItem[]
	}

	let { data }: Props = $props()
</script>
=======
<script lang="ts">
	import type { AboutItem } from '$lib/types/about'

	interface Props {
		data: AboutItem
		title: string
	}

	let { data, title }: Props = $props()
</script>
>>>>>>> REPLACE
` + '```' + `

` + '```' + `svelte
src/lib/components/footer/Footer.svelte
<<<<<<< SEARCH
				<p class="text-sm">© 2025 Denis Da Silva Rocha</p>
=======
				<p class="text-sm">© {new Date().getFullYear()} Denis Da Silva Rocha</p>
>>>>>>> REPLACE
` + '```' + `
</search_replace_blocks>

I hope these changes align with your goals for cleaner and more maintainable code. Let me know if you have any other questions or need further assistance`;

        const blocks = applier.parseSearchReplaceBlocks(problematicOutput);
        assert.strictEqual(blocks.length, 2);
        assert.strictEqual(blocks[0].filePath, 'src/lib/components/about/About.svelte');
        assert.strictEqual(blocks[1].filePath, 'src/lib/components/footer/Footer.svelte');
        assert.strictEqual(blocks[0].language, 'svelte');
        assert.strictEqual(blocks[1].language, 'svelte');

        // Verify the content is parsed correctly despite the surrounding explanatory text
        assert.strictEqual(blocks[0].searchContent.includes('data: AboutItem[]'), true);
        assert.strictEqual(blocks[0].replaceContent.includes('data: AboutItem'), true);
        assert.strictEqual(blocks[0].replaceContent.includes('title: string'), true);
        assert.strictEqual(blocks[1].searchContent.includes('© 2025 Denis Da Silva Rocha'), true);
        assert.strictEqual(blocks[1].replaceContent.includes('new Date().getFullYear()'), true);
    });
});
