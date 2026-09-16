/**
 * Multi-language extraction: detect by file extension, load grammar
 * (bundled or on-demand cache), parse, then run the language extractor.
 */
import { createHash } from "node:crypto";
import Parser from "tree-sitter";
import { loadGrammarPackage, resolveLanguage, } from "./languages/grammars.js";
import { detectLanguage } from "./languages/registry.js";
import { linesFromOffsets } from "./loc.js";
const parser = new Parser();
const languageCache = new Map();
function grammarKey(npmPackage, grammarExport) {
    return grammarExport ? `${npmPackage}:${grammarExport}` : npmPackage;
}
function loadLanguage(npmPackage, grammarExport) {
    const key = grammarKey(npmPackage, grammarExport);
    const cached = languageCache.get(key);
    if (cached)
        return cached;
    const mod = loadGrammarPackage(npmPackage);
    const language = resolveLanguage(mod, grammarExport);
    languageCache.set(key, language);
    return language;
}
export function extractFunctions(file, source) {
    const extractor = detectLanguage(file);
    if (!extractor)
        return [];
    const language = loadLanguage(extractor.grammarPackage, extractor.grammarExport);
    // Grammar package exports are accepted by setLanguage at runtime; the
    // published Language type requires fields not present on every package.
    // @ts-expect-error tree-sitter Language under-specifies grammar module exports
    parser.setLanguage(language);
    const tree = parser.parse(source);
    return extractor.extract(file, source, tree).map((fn) => {
        if (fn.line != null)
            return fn;
        const lines = linesFromOffsets(source, fn.start, fn.end);
        return { ...fn, ...lines };
    });
}
export function extractCached(file, source, cache) {
    const extractor = detectLanguage(file);
    if (!extractor)
        return [];
    const digest = createHash("sha256").update(source).digest("hex");
    const key = `${file}\0${extractor.id}\0${digest}`;
    let functions = cache.get(key);
    if (!functions) {
        functions = extractFunctions(file, source).map(({ file: _ignored, ...fn }) => fn);
        cache.set(key, functions);
    }
    return functions.map((fn) => ({ ...fn, file }));
}
/**
 * Full extraction list for an index, including definitions shadowed by
 * first-wins bare-key insertion in {@link buildIndex}.
 */
const indexDefinitions = new WeakMap();
/**
 * Definitions grouped by `file\0key`, so a call can be resolved against the
 * file it was written in instead of the global bare-key map. See #19.
 */
const indexByFile = new WeakMap();
/** Snapshot paths per index, including files that produced no definitions. */
const indexSnapshotFiles = new WeakMap();
/** NUL cannot occur in a path or a symbol key, so it is a safe separator. */
export function fileScopedKey(file, key) {
    return `${file}\0${key}`;
}
export function flattenCallKeys(steps) {
    const keys = [];
    const walk = (list) => {
        for (const step of list) {
            if (step.type === "call") {
                keys.push(step.key);
                if (step.children)
                    walk(step.children);
            }
            else {
                walk(step.children);
            }
        }
    };
    walk(steps);
    return keys;
}
/**
 * Every function recorded when the index was built (including duplicates that
 * lost the bare-key race). Indexes created as plain Maps fall back to values().
 */
export function allFunctions(index) {
    return indexDefinitions.get(index) ?? [...index.values()];
}
/**
 * Definitions of `key` declared in `file`, top-level before locals, then in
 * source order. Empty when that file declares none.
 *
 * Indexes created as plain Maps (not via {@link buildIndex}) fall back to a
 * scan of their values.
 */
export function definitionsInFile(index, file, key) {
    const byFile = indexByFile.get(index);
    if (byFile)
        return byFile.get(fileScopedKey(file, key)) ?? [];
    return [...index.values()].filter((fn) => fn.file === file && fn.key === key);
}
/** Source paths the index was built from, when the snapshot list was known. */
export function snapshotFiles(index) {
    return indexSnapshotFiles.get(index);
}
export function buildIndex(functions, files) {
    const index = new Map();
    const byFile = new Map();
    const record = (fn) => {
        const scoped = fileScopedKey(fn.file, fn.key);
        const existing = byFile.get(scoped);
        if (existing)
            existing.push(fn);
        else
            byFile.set(scoped, [fn]);
        if (!index.has(fn.key)) {
            index.set(fn.key, fn);
        }
        if (fn.key.endsWith(".constructor")) {
            const className = fn.key.slice(0, -".constructor".length);
            const newKey = `new ${className}`;
            const ctor = { ...fn, key: newKey, label: `new ${className}()` };
            const scopedNew = fileScopedKey(fn.file, newKey);
            const existingNew = byFile.get(scopedNew);
            if (existingNew)
                existingNew.push(ctor);
            else
                byFile.set(scopedNew, [ctor]);
            if (!index.has(newKey)) {
                index.set(newKey, ctor);
            }
        }
    };
    // Top level first: a helper declared inside a body must never take a bare key
    // away from a real top-level definition somewhere else in the repo (#19).
    for (const fn of functions)
        if (!fn.local)
            record(fn);
    for (const fn of functions)
        if (fn.local)
            record(fn);
    indexDefinitions.set(index, functions.slice());
    indexByFile.set(index, byFile);
    if (files)
        indexSnapshotFiles.set(index, [...new Set(files)].sort());
    return index;
}
