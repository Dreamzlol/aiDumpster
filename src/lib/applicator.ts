import * as fs from 'fs';
import * as path from 'path';
import type { ApplyResult, SearchReplaceBlock } from './types';
import { parseSearchReplaceBlocks, validateSearchReplaceBlock } from './parser';

/**
 * Apply SEARCH/REPLACE blocks with comprehensive error handling.
 * @param {string} content The raw response content from the AI.
 * @param {string} workspacePath The absolute path to the VS Code workspace.
 * @returns {Promise<ApplyResult>} A promise that resolves to an `ApplyResult` object.
 */
export async function applySearchReplaceBlocks(content: string, workspacePath:string): Promise<ApplyResult> {
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
        const blocks = parseSearchReplaceBlocks(content);

        if (blocks.length === 0) {
            result.message = 'No valid SEARCH/REPLACE blocks found in the response.';
            result.errors.push('Could not find any fenced code blocks with the SEARCH/REPLACE format.');
            return result;
        }

        const processedFiles = new Set<string>();
        let successfulBlocks = 0;

        // Process each block
        for (const block of blocks) {
            try {
                // Validate block format
                const validation = validateSearchReplaceBlock(block);
                if (!validation.valid) {
                    result.errors.push(`Block ${block.lineNumber} (${block.filePath}): Invalid format - ${validation.errors.join(', ')}`);
                    continue;
                }

                // Apply the block
                const blockResult = await applySearchReplaceBlock(block, workspacePath);

                if (blockResult.success) {
                    successfulBlocks++;
                    processedFiles.add(block.filePath);
                    if (blockResult.warnings.length > 0) {
                        blockResult.warnings.forEach(w => result.warnings.push(`Block ${block.lineNumber} (${block.filePath}): ${w}`));
                    }
                } else {
                    const errorMessage = blockResult.errors.length > 0 ? blockResult.errors.join(' ') : blockResult.message;
                    result.errors.push(`Block ${block.lineNumber} (${block.filePath}): ${errorMessage}`);
                    // Also collect warnings from failed blocks
                    if (blockResult.warnings.length > 0) {
                        blockResult.warnings.forEach(w => result.warnings.push(`Block ${block.lineNumber} (${block.filePath}): ${w}`));
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
                result.message = `Successfully applied ${successfulBlocks} block(s) to ${result.filesProcessed} file(s).`;
            } else {
                result.message = `Applied ${successfulBlocks} block(s) to ${result.filesProcessed} file(s), but ${result.errors.length} error(s) occurred.`;
            }
        } else {
            if (result.errors.length > 0) {
                result.message = `Failed to apply any blocks. ${result.errors.length} error(s) occurred.`;
            } else {
                result.message = `Failed to apply any blocks. No valid blocks were processed.`;
            }
        }

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.message = `Failed to process SEARCH/REPLACE blocks: ${errorMsg}`;
        result.errors.push(errorMsg);
    }

    return result;
}

/**
 * Apply a single SEARCH/REPLACE block.
 * @param {SearchReplaceBlock} block The block to apply.
 * @param {string} workspacePath The absolute path to the VS Code workspace.
 * @returns {Promise<ApplyResult>} A promise that resolves to the result of applying the single block.
 * @internal
 */
async function applySearchReplaceBlock(block: SearchReplaceBlock, workspacePath: string): Promise<ApplyResult> {
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
            await createNewFile(fullPath, block.replaceContent);
            result.success = true;
            result.message = `Created new file: ${block.filePath}`;
            result.filesProcessed = 1;
            result.blocksProcessed = 1;
        } else {
            // Modify existing file
            const modifyResult = await findAndReplaceInFile(fullPath, block.searchContent, block.replaceContent);
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
 * Create a new file with the specified content.
 * @param {string} filePath The absolute path of the file to create.
 * @param {string} content The content to write to the new file.
 * @returns {Promise<void>}
 * @throws {Error} if the file already exists.
 * @internal
 */
async function createNewFile(filePath: string, content: string): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Check if file already exists
    if (fs.existsSync(filePath)) {
        throw new Error(`File already exists`);
    }

    // Write the file
    fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Find and replace content in an existing file.
 * @param {string} filePath The absolute path of the file to modify.
 * @param {string} searchContent The exact content to find.
 * @param {string} replaceContent The content to replace with.
 * @returns {Promise<ApplyResult>} The result of the find and replace operation.
 * @internal
 */
async function findAndReplaceInFile(filePath: string, searchContent: string, replaceContent: string): Promise<ApplyResult> {
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
            result.message = `File not found`;
            result.errors.push(`The specified file does not exist.`);
            return result;
        }

        const currentContent = fs.readFileSync(filePath, 'utf8');
        const newContent = currentContent.replace(searchContent, replaceContent);

        if (newContent === currentContent) {
            // Exact match failed, let's check for whitespace differences
            const currentTrimmed = currentContent.replace(/\s+/g, ' ').trim();
            const searchTrimmed = searchContent.replace(/\s+/g, ' ').trim();

            result.message = `Search content not found`;
            result.errors.push('The content in the SEARCH block did not exactly match any part of the file.');

            if (currentTrimmed.includes(searchTrimmed)) {
                result.warnings.push('A similar block of text was found, but it differs by whitespace (spaces, tabs, or newlines). The SEARCH block must be an exact match.');
            }
            return result;
        }

        fs.writeFileSync(filePath, newContent, 'utf8');
        result.success = true;
        result.message = `Successfully modified file`;

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.message = `Failed to modify file: ${errorMsg}`;
        result.errors.push(errorMsg);
    }

    return result;
}