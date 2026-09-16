import { allFunctions, flattenCallKeys } from "./extract.js";
import { buildCallTree, buildCallTreeFromInfo, exportsInFile, indexedFiles, resolveEntry, resolveEntrypointFile, } from "./calltree.js";
import { diffTrees, treeHasChanges } from "./diff.js";
function emptyCallTree(key, label) {
    return { key, label, children: [] };
}
function functionFingerprint(fn) {
    if (!fn)
        return null;
    return JSON.stringify({ label: fn.label, steps: fn.steps });
}
function addReverseEdges(reverse, index) {
    for (const [caller, fn] of index) {
        for (const callee of flattenCallKeys(fn.steps)) {
            let callers = reverse.get(callee);
            if (!callers) {
                callers = new Set();
                reverse.set(callee, callers);
            }
            callers.add(caller);
        }
    }
}
function findAffected(before, after, maxDepth) {
    const keys = new Set([...before.keys(), ...after.keys()]);
    const reverse = new Map();
    addReverseEdges(reverse, before);
    addReverseEdges(reverse, after);
    const distance = new Map();
    const queue = [];
    for (const key of keys) {
        if (functionFingerprint(before.get(key)) === functionFingerprint(after.get(key))) {
            continue;
        }
        distance.set(key, 0);
        queue.push(key);
    }
    for (let i = 0; i < queue.length; i += 1) {
        const callee = queue[i];
        const nextDistance = distance.get(callee) + 1;
        if (nextDistance > maxDepth)
            continue;
        for (const caller of reverse.get(callee) ?? []) {
            const previous = distance.get(caller);
            if (previous !== undefined && previous <= nextDistance)
                continue;
            distance.set(caller, nextDistance);
            queue.push(caller);
        }
    }
    return new Set(distance.keys());
}
function changedKeys(keys, before, after, maxDepth) {
    return keys
        .filter((key) => diffEntry(key, before, after, maxDepth) !== null)
        .sort((a, b) => a.localeCompare(b));
}
/**
 * Infer entrypoints: exported functions whose expanded call trees differ,
 * plus any explicitly requested symbol entries.
 */
export function inferEntries(before, after, explicit, maxDepth) {
    if (explicit.length > 0) {
        const entries = [];
        for (const entry of explicit) {
            const key = resolveEntry(entry, after) ?? resolveEntry(entry, before);
            if (!key)
                throw new Error(`Entrypoint not found: ${entry}`);
            if (!entries.includes(key))
                entries.push(key);
        }
        return entries;
    }
    const affected = [...findAffected(before, after, maxDepth)].filter((key) => !key.startsWith("new "));
    const exported = affected.filter((key) => Boolean(before.get(key)?.exported || after.get(key)?.exported));
    const entries = changedKeys(exported, before, after, maxDepth);
    if (entries.length > 0)
        return entries;
    const checked = new Set(exported);
    const fallback = affected.filter((key) => !checked.has(key));
    return changedKeys(fallback, before, after, maxDepth);
}
/**
 * Expand explicit `-e` symbols and `--file` paths into concrete diff roots.
 */
export function resolveExplicitDiffEntries(before, after, symbols, files = []) {
    const out = [];
    const seen = new Set();
    for (const entry of symbols) {
        const key = resolveEntry(entry, after) ?? resolveEntry(entry, before);
        if (!key)
            throw new Error(`Entrypoint not found: ${entry}`);
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push({ key });
    }
    for (const entry of files) {
        const file = resolveEntrypointFile(entry, [
            ...indexedFiles(before),
            ...indexedFiles(after),
        ]);
        const keys = [
            ...new Set([
                ...exportsInFile(file, before),
                ...exportsInFile(file, after),
            ].map((info) => info.key)),
        ].sort((a, b) => a.localeCompare(b));
        if (keys.length === 0) {
            throw new Error(`No exported entrypoints in ${file}`);
        }
        for (const key of keys) {
            const id = `${file}\0${key}`;
            if (seen.has(id))
                continue;
            seen.add(id);
            const beforeInfo = allFunctions(before).find((fn) => fn.file === file && fn.key === key && fn.exported);
            const afterInfo = allFunctions(after).find((fn) => fn.file === file && fn.key === key && fn.exported);
            out.push({ key, beforeInfo, afterInfo, file });
        }
    }
    return out;
}
export function diffEntry(key, before, after, maxDepth) {
    const beforeKey = resolveEntry(key, before) ?? key;
    const afterKey = resolveEntry(key, after) ?? key;
    const hasBefore = before.has(beforeKey);
    const hasAfter = after.has(afterKey);
    if (!hasBefore && !hasAfter)
        return null;
    const beforeTree = hasBefore
        ? buildCallTree(beforeKey, before, maxDepth)
        : emptyCallTree(afterKey, after.get(afterKey)?.label ?? afterKey);
    const afterTree = hasAfter
        ? buildCallTree(afterKey, after, maxDepth)
        : emptyCallTree(beforeKey, before.get(beforeKey)?.label ?? beforeKey);
    if (!hasBefore && hasAfter) {
        const diff = diffTrees({ key: afterKey, label: afterTree.label, children: [] }, afterTree);
        return { ...diff, status: "added" };
    }
    if (hasBefore && !hasAfter) {
        const diff = diffTrees(beforeTree, {
            key: beforeKey,
            label: beforeTree.label,
            children: [],
        });
        return { ...diff, status: "removed" };
    }
    const diff = diffTrees(beforeTree, afterTree);
    if (!treeHasChanges(diff))
        return null;
    return diff;
}
/** Diff two file-pinned definitions (or missing on one side). */
export function diffPinnedEntry(key, beforeInfo, afterInfo, before, after, maxDepth) {
    if (!beforeInfo && !afterInfo)
        return null;
    const beforeTree = beforeInfo
        ? buildCallTreeFromInfo(beforeInfo, before, maxDepth)
        : emptyCallTree(key, afterInfo?.label ?? key);
    const afterTree = afterInfo
        ? buildCallTreeFromInfo(afterInfo, after, maxDepth)
        : emptyCallTree(key, beforeInfo?.label ?? key);
    if (!beforeInfo && afterInfo) {
        const diff = diffTrees({ key, label: afterTree.label, children: [] }, afterTree);
        return { ...diff, status: "added" };
    }
    if (beforeInfo && !afterInfo) {
        const diff = diffTrees(beforeTree, {
            key,
            label: beforeTree.label,
            children: [],
        });
        return { ...diff, status: "removed" };
    }
    const diff = diffTrees(beforeTree, afterTree);
    if (!treeHasChanges(diff))
        return null;
    return diff;
}
