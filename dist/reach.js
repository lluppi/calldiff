import { buildCallTree, buildCallTreeFromInfo, resolveAllEntries, resolveEntry, } from "./calltree.js";
import { assignOptionalTreeFields } from "./types.js";
function nodeMatchesTarget(nodeKey, resolvedTarget, rawTarget) {
    if (nodeKey === resolvedTarget || nodeKey === rawTarget)
        return true;
    const stripped = nodeKey.replace(/\(\)$/, "");
    if (stripped === resolvedTarget || stripped === rawTarget)
        return true;
    return (nodeKey.endsWith(`.${rawTarget}`) ||
        nodeKey.endsWith(`.${resolvedTarget}`));
}
/** Collapse a root→target node list into a linear single-child tree. */
export function pathToTree(nodes) {
    if (nodes.length === 0) {
        throw new Error("pathToTree requires at least one node");
    }
    const [head, ...rest] = nodes;
    const tree = {
        key: head.key,
        label: head.label,
        children: rest.length > 0 ? [pathToTree(rest)] : [],
    };
    return assignOptionalTreeFields(tree, head);
}
/**
 * Collect every root-to-node path in `tree` that ends at `target`
 * (first hit on a path; does not continue below the target).
 */
export function collectPathsTo(tree, resolvedTarget, rawTarget) {
    const paths = [];
    const walk = (node, ancestors) => {
        const chain = [...ancestors, node];
        if (nodeMatchesTarget(node.key, resolvedTarget, rawTarget)) {
            paths.push(pathToTree(chain));
            return;
        }
        for (const child of node.children) {
            walk(child, chain);
        }
    };
    walk(tree, []);
    return paths;
}
/**
 * Find all call paths from `fromEntry` to `toEntry` in the indexed call graph.
 * Expands via the same rules as `buildCallTree` (including branch forks).
 *
 * When several definitions share the entry name, every definition is walked
 * (reach's contract is completeness). Order is stable across file reorderings.
 */
export function findReachPaths(fromEntry, toEntry, index, maxDepth) {
    const toKey = resolveEntry(toEntry, index) ?? toEntry;
    const fromInfos = resolveAllEntries(fromEntry, index);
    if (fromInfos.length === 0) {
        const fromKey = resolveEntry(fromEntry, index) ?? fromEntry;
        const tree = buildCallTree(fromKey, index, maxDepth);
        return collectPathsTo(tree, toKey, toEntry);
    }
    const paths = [];
    for (const info of fromInfos) {
        const tree = buildCallTreeFromInfo(info, index, maxDepth);
        paths.push(...collectPathsTo(tree, toKey, toEntry));
    }
    return paths;
}
