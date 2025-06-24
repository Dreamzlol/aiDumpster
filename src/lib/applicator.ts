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
export async function applySearchReplaceBlocks(content: string, workspacePath: string): Promise<ApplyResult> {
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
                const validation = validateSearchReplaceBlock(block);
                if (!validation.valid) {
                    result.errors.push(`Block ${block.lineNumber}: ${validation.errors.join(', ')}`);
                    continue;
                }

                // Apply the block
                const blockResult = await applySearchReplaceBlock(block, workspacePath);

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
        throw new Error(`File already exists: ${path.basename(filePath)}`);
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