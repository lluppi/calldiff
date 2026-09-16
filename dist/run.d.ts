import type { DiffResult, ReachResult, TreeResult } from "./types.js";
export type DiffRunOptions = {
    from?: string;
    to?: string;
    /** Symbol entrypoints (`-e`). */
    entries?: string[];
    /** File entrypoints (`--file`): expand to that file's exports. */
    files?: string[];
    paths?: string[];
    cwd?: string;
    maxDepth?: number;
    /** When false, skip ANSI colors in ascii output. Default: true */
    color?: boolean;
    /** When true, append file:line suffixes in ascii. Default: false */
    locs?: boolean;
};
export type TreeRunOptions = {
    ref?: string;
    entries?: string[];
    files?: string[];
    paths?: string[];
    cwd?: string;
    maxDepth?: number;
    color?: boolean;
    locs?: boolean;
};
export type ReachRunOptions = {
    ref?: string;
    /** Start symbol(s). */
    entries?: string[];
    /** Start file(s): every export in the file. */
    files?: string[];
    /** Target symbol to reach. */
    to: string;
    paths?: string[];
    cwd?: string;
    maxDepth?: number;
    color?: boolean;
    locs?: boolean;
};
/** Diff call stacks between two snapshots. Returns structured data + ASCII. */
export declare function runDiff(options?: DiffRunOptions): DiffResult;
/** View call tree(s) for entrypoint(s) from a single snapshot. */
export declare function runTree(options: TreeRunOptions): TreeResult;
/** Find all call paths from entrypoint(s) to a target symbol. */
export declare function runReach(options: ReachRunOptions): ReachResult;
