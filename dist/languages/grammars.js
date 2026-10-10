import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
function errnoCode(err) {
    // SAFETY: Node require/fs failures are ErrnoException with optional string code.
    return err.code;
}
/** On-disk cache of npm-installed tree-sitter grammar packages. */
export function grammarCacheDir() {
    const override = process.env.CALLDIFF_GRAMMAR_CACHE;
    if (override)
        return override;
    return join(homedir(), ".cache", "calldiff", "grammars");
}
function packageInstalled(cacheDir, npmPackage) {
    return existsSync(join(cacheDir, "node_modules", npmPackage));
}
/**
 * Create the cache's package.json and allow `npmPackage`'s install script.
 * npm 12 blocks dependency install scripts unless listed in `allowScripts`,
 * so grammars without a prebuild for this Node ABI (tree-sitter-perl ships
 * none; tree-sitter-kotlin lacks newer ABIs) would never compile.
 */
function ensureCachePackageJson(cacheDir, npmPackage) {
    mkdirSync(cacheDir, { recursive: true });
    const pkgPath = join(cacheDir, "package.json");
    const pkg = readCachePackageJson(pkgPath);
    if (pkg.allowScripts?.[npmPackage] === true)
        return;
    pkg.allowScripts = { ...pkg.allowScripts, [npmPackage]: true };
    writeFileSync(pkgPath, JSON.stringify(pkg), "utf8");
}
/** The cache package.json, or a fresh one when missing or unreadable. */
function readCachePackageJson(pkgPath) {
    const fresh = {
        name: "calldiff-grammar-cache",
        private: true,
        description: "On-demand tree-sitter grammars for calldiff",
    };
    if (!existsSync(pkgPath))
        return fresh;
    try {
        // SAFETY: the cache package.json is written only by this module.
        return JSON.parse(readFileSync(pkgPath, "utf8"));
    }
    catch {
        // Malformed (e.g. a torn concurrent write): rewrite it from scratch.
        return fresh;
    }
}
function installGrammar(cacheDir, npmPackage) {
    ensureCachePackageJson(cacheDir, npmPackage);
    execFileSync("npm", [
        "install",
        "--prefix",
        cacheDir,
        // Save into the cache package.json: with --no-save, npm prunes every
        // grammar it does not list, so each install evicted the others.
        // Explicit flags so a user `save=false` cannot undo that, and pins
        // from installSpecFor stay exact.
        "--save",
        "--save-exact",
        "--no-fund",
        "--no-audit",
        "--legacy-peer-deps",
        installSpecFor(npmPackage),
    ], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
    });
}
/**
 * Some grammar packages (e.g. tree-sitter-c-sharp ≥0.23.5) ship ESM bindings
 * with top-level await, which `require()` cannot load. Fall back to the native
 * `.node` addon via node-gyp-build — same payload the JS wrapper would return.
 */
function loadNativeBinding(packageRoot) {
    try {
        const require = createRequire(join(packageRoot, "package.json"));
        // SAFETY: node-gyp-build's default export is (root) => native binding.
        const gypBuild = require("node-gyp-build");
        const binding = gypBuild(packageRoot);
        try {
            binding.nodeTypeInfo = require(join(packageRoot, "src", "node-types.json"));
        }
        catch {
            // optional metadata
        }
        return binding;
    }
    catch {
        return null;
    }
}
function requireGrammar(require, npmPackage, packageRoot) {
    try {
        // SAFETY: grammar packages export a module compatible with GrammarModule.
        return require(npmPackage);
    }
    catch (err) {
        const code = err instanceof Error ? errnoCode(err) : undefined;
        const msg = err instanceof Error ? err.message : String(err);
        if (code === "ERR_REQUIRE_ASYNC_MODULE" ||
            msg.includes("top-level await")) {
            const binding = loadNativeBinding(packageRoot);
            if (binding)
                return binding;
        }
        throw err;
    }
}
function installSpecFor(npmPackage) {
    switch (npmPackage) {
        case "tree-sitter-c-sharp":
            return "tree-sitter-c-sharp@0.23.1";
        case "@tree-sitter-grammars/tree-sitter-lua":
            // 0.4+ is ESM-with-TLA; 0.2.0 is CJS and loads via createRequire.
            return "@tree-sitter-grammars/tree-sitter-lua@0.2.0";
        default:
            return npmPackage;
    }
}
/**
 * Install an npm grammar package into the shared cache if missing, then require it.
 * Reuses the cache across CLI invocations.
 */
export function loadGrammarPackage(npmPackage) {
    // Prefer the app's own dependency when present (e.g. tree-sitter-typescript).
    try {
        const localRequire = createRequire(import.meta.url);
        try {
            // SAFETY: local dependency resolves to a tree-sitter grammar module.
            return localRequire(npmPackage);
        }
        catch (err) {
            const code = err instanceof Error ? errnoCode(err) : undefined;
            const msg = err instanceof Error ? err.message : String(err);
            if (code === "ERR_REQUIRE_ASYNC_MODULE" ||
                msg.includes("top-level await")) {
                const entry = localRequire.resolve(npmPackage);
                const packageRoot = join(entry, "..", "..");
                const binding = loadNativeBinding(packageRoot);
                if (binding)
                    return binding;
            }
            throw err;
        }
    }
    catch {
        // fall through to cache
    }
    const cacheDir = grammarCacheDir();
    const fresh = !packageInstalled(cacheDir, npmPackage);
    if (fresh)
        installGrammar(cacheDir, npmPackage);
    const require = createRequire(join(cacheDir, "package.json"));
    const packageRoot = join(cacheDir, "node_modules", npmPackage);
    try {
        return requireGrammar(require, npmPackage, packageRoot);
    }
    catch (err) {
        if (fresh)
            throw err;
        // A cached install whose native build never ran (install scripts were
        // blocked, or Node's ABI changed since) — reinstall it once and retry.
        rmSync(packageRoot, { recursive: true, force: true });
        try {
            installGrammar(cacheDir, npmPackage);
            return requireGrammar(require, npmPackage, packageRoot);
        }
        catch (retryErr) {
            throw new Error(`Failed to load grammar ${npmPackage}`, {
                cause: new AggregateError([err, retryErr]),
            });
        }
    }
}
/** Resolve the value to pass to parser.setLanguage. */
export function resolveLanguage(mod, exportName) {
    if (exportName) {
        const named = mod[exportName];
        if (named != null)
            return named;
    }
    // Native grammar packages export { language, nodeTypeInfo, ... } — pass the module.
    return mod;
}
export function readCachedPackageVersion(npmPackage) {
    const cacheDir = grammarCacheDir();
    const pkgJson = join(cacheDir, "node_modules", npmPackage, "package.json");
    if (!existsSync(pkgJson))
        return null;
    try {
        const raw = JSON.parse(readFileSync(pkgJson, "utf8"));
        // SAFETY: npm package.json is JSON with an optional string version field.
        const pkg = raw;
        return pkg.version ?? null;
    }
    catch {
        return null;
    }
}
