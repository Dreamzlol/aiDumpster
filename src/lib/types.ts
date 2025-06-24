/**
 * Represents a single search/replace operation to be performed on a file.
 */
export interface SearchReplaceBlock {
    /** The programming language of the code block. */
    language: string;
    /** The path to the file to be modified, relative to the workspace root. */
    filePath: string;
    /** The content to search for in the file. */
    searchContent: string;
    /** The content to replace the search content with. */
    replaceContent: string;
    /** A flag indicating if this block is for creating a new file. True if `searchContent` is empty. */
    isNewFile: boolean;
    /** An optional line number or index for the block, used for error reporting. */
    lineNumber?: number;
}

/**
 * Represents the result of applying one or more SearchReplaceBlocks.
 */
export interface ApplyResult {
    /** Whether the overall application was successful (at least one block applied). */
    success: boolean;
    /** A summary message of the operation. */
    message: string;
    /** The number of unique files that were successfully processed. */
    filesProcessed: number;
    /** The number of blocks that were successfully applied. */
    blocksProcessed: number;
    /** A list of error messages from blocks that failed to apply. */
    errors: string[];
    /** A list of warning messages from blocks that applied but had issues (e.g., whitespace mismatches). */
    warnings: string[];
}