import { allFunctions, definitionsInFile, fileScopedKey, snapshotFiles, } from "./extract.js";
import { pickLoc } from "./loc.js";
/** Normalize user-facing paths for entry matching (`\` → `/`, strip `./`). */
export function normalizeEntryPath(entry) {
    return entry.replace(/\\/g, "/").replace(/^\.\//, "");
}
/**
 * Unique source paths resolvable as `--file` entrypoints for an index. Prefers
 * the snapshot's file list, so a file that exists but produced no definitions
 * still resolves and reports "no exported entrypoints" rather than "not found".
 */
export function indexedFiles(index) {
    const files = snapshotFiles(index);
    if (files)
        return files;
    return [...new Set(allFunctions(index).map((fn) => fn.file))].sort();
}
/**
 * Resolve which indexed source files match a `--file` argument.
 * Exact path wins; otherwise a unique suffix match (`routes.ts` → `src/routes.ts`).
 */
export function matchEntrypointFiles(entry, files) {
    const normalized = normalizeEntryPath(entry);
    const unique = [...new Set(files)];
    const exact = unique.filter((file) => file === normalized);
    if (exact.length > 0)
        return exact.sort();
    return unique
        .filter((file) => file === normalized || file.endsWith(`/${normalized}`))
        .sort();
}
/**
 * Resolve a `--file` argument to a single indexed source path.
 * Throws when missing or ambiguous.
 */
export function resolveEntrypointFile(entry, files) {
    const matched = matchEntrypointFiles(entry, files);
    if (matched.length === 0) {
        throw new Error(`Entrypoint file not found: ${entry}`);
    }
    if (matched.length > 1) {
        throw new Error(`Ambiguous entrypoint file: ${entry} matches ${matched.join(", ")}. Use a more specific path.`);
    }
    return matched[0];
}
/** Exported definitions in a concrete source path. */
export function exportsInFile(file, index) {
    return sortDefinitions(allFunctions(index).filter((fn) => fn.file === file && fn.exported));
}
/**
 * Exported definitions for a `--file` argument against one index.
 * Throws when the path is missing/ambiguous; returns [] when the file has no exports.
 */
export function resolveFileEntrypoints(entry, index) {
    const file = resolveEntrypointFile(entry, indexedFiles(index));
    return exportsInFile(file, index);
}
/** Is `fn` declared inside `owner`'s source span? */
function declaredInside(fn, owner) {
    if (!owner || fn.line == null || owner.line == null)
        return false;
    return (fn.line >= owner.line &&
        (fn.endLine ?? fn.line) <= (owner.endLine ?? owner.line));
}
/**
 * Resolve one call to a definition.
 *
 * A definition in the file the call was written in always wins: the bare-key
 * map is global and first-wins, so without this a call resolves to whichever
 * same-named function happened to be indexed first, grafting an unrelated body
 * into the tree. See #19.
 *
 * Falls back to the global map, which is what callers across file boundaries
 * (the common case) rely on.
 */
function resolveCall(key, index, callSite, owner) {
    const file = callSite?.file ?? owner?.file;
    if (file) {
        const candidates = definitionsInFile(index, file, key);
        if (candidates.length === 1)
            return candidates[0];
        if (candidates.length > 1) {
            // One file declaring the name twice: a helper declared inside the calling
            // function shadows that file's top-level definition.
            const shadowing = candidates.find((fn) => fn.local && declaredInside(fn, owner));
            return shadowing ?? candidates[0];
        }
    }
    return index.get(key);
}
function displayCallLabel(key, index, info) {
    if (info)
        return info.label;
    const fromIndex = index.get(key);
    if (fromIndex)
        return fromIndex.label;
    return key.includes("(") ? key : `${key}()`;
}
function expandSteps(steps, index, depth, maxDepth, visiting, 
/** Definition these steps were read from, used to scope call resolution. */
owner) {
    return steps.map((step) => {
        if (step.type === "branch") {
            return {
                key: step.key,
                label: step.label,
                kind: "branch",
                ...pickLoc(step),
                children: expandSteps(step.children, index, depth, maxDepth, visiting, owner),
            };
        }
        return expandCall(step.key, index, depth, maxDepth, visiting, step.children, step, undefined, owner);
    });
}
function expandCall(key, index, depth, maxDepth, visiting, inlineChildren, callSite, 
/** When set, expand this body even if another definition owns the bare key. */
infoOverride, 
/** Definition this call was read from, used to scope call resolution. */
owner) {
    const info = infoOverride ?? resolveCall(key, index, callSite, owner);
    const label = displayCallLabel(key, index, info);
    // Recursion is per definition, not per name: two same-named functions in
    // different files calling each other is not a cycle.
    const token = info ? fileScopedKey(info.file, info.key) : key;
    // Root uses the definition start line; every other node uses the call-site in the parent.
    const loc = depth === 0 && info?.line != null
        ? pickLoc({ file: info.file, line: info.line })
        : pickLoc(callSite);
    if (depth >= maxDepth) {
        return { key, label, kind: "call", ...loc, children: [] };
    }
    if (!info && !inlineChildren?.length) {
        return { key, label, kind: "call", ...loc, children: [] };
    }
    if (info && visiting.has(token)) {
        // Still expand call-site JSX children; they are not a re-entry into `key`'s body.
        const callSiteChildren = inlineChildren?.length
            ? expandSteps(inlineChildren, index, depth + 1, maxDepth, visiting, owner)
            : [];
        return {
            key,
            label: `${label} ⇄`,
            kind: "call",
            ...loc,
            children: callSiteChildren,
        };
    }
    if (info)
        visiting.add(token);
    const bodyChildren = info
        ? expandSteps(info.steps, index, depth + 1, maxDepth, visiting, info)
        : [];
    const callSiteChildren = inlineChildren?.length
        ? expandSteps(inlineChildren, index, depth + 1, maxDepth, visiting, owner)
        : [];
    if (info)
        visiting.delete(token);
    return {
        key,
        label,
        kind: "call",
        ...loc,
        children: [...bodyChildren, ...callSiteChildren],
    };
}
/**
 * Expand a function into a nested call tree by following known definitions.
 */
export function buildCallTree(entryKey, index, maxDepth) {
    const resolved = resolveEntry(entryKey, index) ?? entryKey;
    return expandCall(resolved, index, 0, maxDepth, new Set());
}
/**
 * Expand a specific definition. Used by `reach` when several functions share a
 * bare key and first-wins indexing would otherwise hide all but one body.
 */
export function buildCallTreeFromInfo(info, index, maxDepth) {
    return expandCall(info.key, index, 0, maxDepth, new Set(), undefined, undefined, info);
}
export function resolveEntry(entry, index) {
    if (index.has(entry))
        return entry;
    const stripped = entry.replace(/\(\)$/, "");
    if (index.has(stripped))
        return stripped;
    const matches = [...index.keys()].filter((key) => key === entry ||
        key.endsWith(`.${entry}`) ||
        key === `new ${entry}`);
    if (matches.length === 1)
        return matches[0];
    if (matches.length > 1) {
        const exported = matches.filter((key) => index.get(key)?.exported);
        if (exported.length === 1)
            return exported[0];
        return matches.sort()[0];
    }
    return null;
}
function entryNameMatches(key, entry) {
    return (key === entry ||
        key.endsWith(`.${entry}`) ||
        key === `new ${entry}`);
}
function sortDefinitions(fns) {
    return [...fns].sort((a, b) => {
        if (a.label !== b.label)
            return a.label < b.label ? -1 : 1;
        if (a.file !== b.file)
            return a.file < b.file ? -1 : 1;
        return (a.line ?? 0) - (b.line ?? 0);
    });
}
/**
 * Every definition that matches `entry` (including those shadowed in the
 * bare-key map). Prefer exact bare-key hits; otherwise Class.method / `new X`.
 * Order is stable by label, then file — independent of extract order.
 */
export function resolveAllEntries(entry, index) {
    const stripped = entry.replace(/\(\)$/, "");
    const all = allFunctions(index);
    const exact = all.filter((fn) => fn.key === entry || fn.key === stripped);
    if (exact.length > 0)
        return sortDefinitions(exact);
    const matches = all.filter((fn) => entryNameMatches(fn.key, entry) || entryNameMatches(fn.key, stripped));
    return sortDefinitions(matches);
}
