import type { CallNode, DiffNode } from "./types.js";
/**
 * Structural tree diff keyed by call identity.
 * Children are aligned with LCS so output order stays close to the "after" tree.
 */
export declare function diffTrees(before: CallNode, after: CallNode): DiffNode;
export declare function treeHasChanges(node: DiffNode): boolean;
