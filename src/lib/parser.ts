import * as path from 'path';
import type { SearchReplaceBlock } from './types';

/**
 * Robustly parse SEARCH/REPLACE blocks from AI response content.
 * Handles file paths being inside or outside the fenced code block.
 * @param content The raw string response from the AI.
 * @returns An array of parsed `SearchReplaceBlock` objects.
 */
export function parseSearchReplaceBlocks(content: string): SearchReplaceBlock[] {
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
                    const block = extractBlockContent(blockContent, fenceLanguage, filePathForBlock, blockIndex);
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
 * @param blockContent The string content inside a fenced code block.
 * @param language The language of the fenced code block.
 * @param filePath The file path associated with the block.
 * @param blockIndex The index of the block for error reporting.
 * @returns A `SearchReplaceBlock` object or null if parsing fails.
 * @internal
 */
function extractBlockContent(blockContent: string, language: string, filePath: string, blockIndex: number): SearchReplaceBlock | null {
    const lines = blockContent.split('\n');

    // Find SEARCH/REPLACE markers, starting from line 0
    const searchStartIndex = findMarkerIndex(lines, '<<<<<<< SEARCH', 0);
    const dividerIndex = findMarkerIndex(lines, '=======', searchStartIndex + 1);
    const replaceEndIndex = findMarkerIndex(lines, '>>>>>>> REPLACE', dividerIndex + 1);

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
 * @param lines An array of strings to search within.
 * @param marker The marker string to find.
 * @param startIndex The index to start searching from.
 * @returns The line index of the marker, or -1 if not found.
 * @internal
 */
function findMarkerIndex(lines: string[], marker: string, startIndex: number): number {
    for (let i = startIndex; i < lines.length; i++) {
        if (lines[i].trim() === marker) {
            return i;
        }
    }
    return -1;
}

/**
 * Validate a SEARCH/REPLACE block for correctness
 * @param block The `SearchReplaceBlock` to validate.
 * @returns An object containing a validity flag and a list of errors.
 */
export function validateSearchReplaceBlock(block: SearchReplaceBlock): { valid: boolean; errors: string[] } {
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