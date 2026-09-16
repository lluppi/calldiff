import type { FunctionIndex } from "./extract.js";
import type { DiffNode, FunctionInfo } from "./types.js";
/**
 * Infer entrypoints: exported functions whose expanded call trees differ,
 * plus any explicitly requested symbol entries.
 */
export declare function inferEntries(before: FunctionIndex, after: FunctionIndex, explicit: string[], maxDepth: number): string[];
export type ExplicitDiffEntry = {
    key: string;
    beforeInfo?: FunctionInfo;
    afterInfo?: FunctionInfo;
    /** When set, trees are built from these file-pinned definitions. */
    file?: string;
};
/**
 * Expand explicit `-e` symbols and `--file` paths into concrete diff roots.
 */
export declare function resolveExplicitDiffEntries(before: FunctionIndex, after: FunctionIndex, symbols: string[], files?: string[]): ExplicitDiffEntry[];
export declare function diffEntry(key: string, before: FunctionIndex, after: FunctionIndex, maxDepth: number): DiffNode | null;
/** Diff two file-pinned definitions (or missing on one side). */
export declare function diffPinnedEntry(key: string, beforeInfo: FunctionInfo | undefined, afterInfo: FunctionInfo | undefined, before: FunctionIndex, after: FunctionIndex, maxDepth: number): DiffNode | null;
