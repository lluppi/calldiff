import type { Snapshot, SnapshotPair, SnapshotPairWithPaths, SnapshotWithPaths } from "./types.js";
export declare function assertGitRepo(cwd: string): void;
export declare function resolveSnapshots(from: string | undefined, to: string | undefined): SnapshotPair;
/**
 * Resolve diff from/to/paths with git-diff defaults, treating on-disk path
 * positionals as path filters when they are not valid git refs.
 *
 * Examples:
 * - `diff main src` → main vs worktree, paths=[src]
 * - `diff main feature src` → main vs feature, paths=[src]
 * - `diff src` → HEAD vs worktree, paths=[src]
 */
export declare function resolveDiffSnapshotsAndPaths(cwd: string, from: string | undefined, to: string | undefined, paths: string[]): SnapshotPairWithPaths;
/** Single snapshot for `calldiff tree` / `reach` — no ref → working tree. */
export declare function resolveSnapshot(ref: string | undefined): Snapshot;
/**
 * Resolve optional ref + path filters for tree/reach.
 * A lone positional that isn't a git ref but exists on disk is treated as a
 * path filter on the working tree (`calldiff tree -e foo src/lib`).
 */
export declare function resolveSnapshotAndPaths(cwd: string, ref: string | undefined, paths: string[]): SnapshotWithPaths;
export declare function verifyCommit(cwd: string, ref: string): void;
export interface SnapshotFile {
    path: string;
    /** Git blob metadata. Worktree files do not have it. */
    oid?: string;
    size?: number;
}
export declare function listSnapshotFiles(cwd: string, snapshot: Snapshot, pathFilters?: string[]): SnapshotFile[];
/** @deprecated Use listSourceFiles */
export declare function listTsFiles(cwd: string, snapshot: Snapshot, pathFilters?: string[]): string[];
export declare function listSourceFiles(cwd: string, snapshot: Snapshot, pathFilters?: string[]): string[];
export declare function visitCommitBlobs(cwd: string, files: SnapshotFile[], visit: (oid: string, source: string) => void): void;
export declare function visitWorktreeFiles(cwd: string, files: SnapshotFile[], visit: (file: SnapshotFile, source: string) => void): void;
export declare function readSnapshotFiles(cwd: string, snapshot: Snapshot, files: SnapshotFile[]): Map<string, string>;
export declare function describeSnapshot(snapshot: Snapshot): string;
