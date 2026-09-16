import type { CallStep, FunctionInfo } from "./types.js";
export declare function extractFunctions(file: string, source: string): FunctionInfo[];
type CachedFunction = Omit<FunctionInfo, "file">;
export type ExtractionCache = Map<string, CachedFunction[]>;
export declare function extractCached(file: string, source: string, cache: ExtractionCache): FunctionInfo[];
export type FunctionIndex = Map<string, FunctionInfo>;
/** NUL cannot occur in a path or a symbol key, so it is a safe separator. */
export declare function fileScopedKey(file: string, key: string): string;
export declare function flattenCallKeys(steps: CallStep[]): string[];
/**
 * Every function recorded when the index was built (including duplicates that
 * lost the bare-key race). Indexes created as plain Maps fall back to values().
 */
export declare function allFunctions(index: FunctionIndex): FunctionInfo[];
/**
 * Definitions of `key` declared in `file`, top-level before locals, then in
 * source order. Empty when that file declares none.
 *
 * Indexes created as plain Maps (not via {@link buildIndex}) fall back to a
 * scan of their values.
 */
export declare function definitionsInFile(index: FunctionIndex, file: string, key: string): FunctionInfo[];
/** Source paths the index was built from, when the snapshot list was known. */
export declare function snapshotFiles(index: FunctionIndex): string[] | undefined;
export declare function buildIndex(functions: FunctionInfo[], files?: Iterable<string>): FunctionIndex;
export {};
