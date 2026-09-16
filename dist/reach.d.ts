import type { FunctionIndex } from "./extract.js";
import type { CallNode } from "./types.js";
/** Collapse a root→target node list into a linear single-child tree. */
export declare function pathToTree(nodes: CallNode[]): CallNode;
/**
 * Collect every root-to-node path in `tree` that ends at `target`
 * (first hit on a path; does not continue below the target).
 */
export declare function collectPathsTo(tree: CallNode, resolvedTarget: string, rawTarget: string): CallNode[];
/**
 * Find all call paths from `fromEntry` to `toEntry` in the indexed call graph.
 * Expands via the same rules as `buildCallTree` (including branch forks).
 *
 * When several definitions share the entry name, every definition is walked
 * (reach's contract is completeness). Order is stable across file reorderings.
 */
export declare function findReachPaths(fromEntry: string, toEntry: string, index: FunctionIndex, maxDepth: number): CallNode[];
