/**
 * Loaded tree-sitter grammar package surface.
 * Named exports (`typescript`, `tsx`, …) are looked up by `resolveLanguage`.
 */
export type GrammarModule = {
    language?: GrammarModule;
    typescript?: GrammarModule;
    tsx?: GrammarModule;
    [exportName: string]: GrammarModule | undefined;
};
/** Runtime grammar handle passed to `parser.setLanguage`. */
export type GrammarLanguage = GrammarModule;
/** On-disk cache of npm-installed tree-sitter grammar packages. */
export declare function grammarCacheDir(): string;
/**
 * Install an npm grammar package into the shared cache if missing, then require it.
 * Reuses the cache across CLI invocations.
 */
export declare function loadGrammarPackage(npmPackage: string): GrammarModule;
/** Resolve the value to pass to parser.setLanguage. */
export declare function resolveLanguage(mod: GrammarModule, exportName?: string): GrammarLanguage;
export declare function readCachedPackageVersion(npmPackage: string): string | null;
