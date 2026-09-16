import type { CallNode, DiffNode } from "./types.js";
export interface RenderOptions {
    /** When false, skip ANSI colors (useful for tests). Default: true */
    color?: boolean;
    /**
     * Append `file:line` (or `file:line-line`) after each label.
     * Default: false.
     */
    locs?: boolean;
}
/**
 * Render a callstack diff as an ASCII tree with +/- markers.
 */
export declare function renderDiff(root: DiffNode, options?: RenderOptions): string;
/**
 * Render a single call tree as an ASCII tree (no +/- markers).
 */
export declare function renderTree(root: CallNode, options?: RenderOptions): string;
