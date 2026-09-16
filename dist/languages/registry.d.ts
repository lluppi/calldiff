import type { LanguageExtractor } from "./types.js";
declare const extractors: LanguageExtractor[];
export declare function listSupportedExtensions(): string[];
export declare function listSupportedLanguages(): string[];
export declare function detectLanguage(file: string): LanguageExtractor | null;
export declare function getExtractor(id: string): LanguageExtractor | null;
export { extractors };
