import type { SourceLoc } from "./types.js";
/** Pick optional loc fields for spreading onto a node/step. */
export declare function pickLoc(loc: {
    file?: string;
    line?: number;
    endLine?: number;
} | null | undefined): Partial<SourceLoc>;
/** Format as `file:line` or `file:line-line`. */
export declare function formatSourceLoc(loc: SourceLoc): string;
/**
 * Convert byte offsets in `source` to 1-based line numbers.
 * `end` is exclusive (tree-sitter endIndex).
 */
export declare function linesFromOffsets(source: string, start: number, end: number): {
    line: number;
    endLine?: number;
};
