import type Parser from "tree-sitter";
import type { FunctionInfo, SourceLoc } from "../types.js";
export type SyntaxNode = Parser.SyntaxNode;
export type Tree = Parser.Tree;
export interface LanguageExtractor {
    /** Stable id, e.g. "typescript" | "python" | "go" */
    id: string;
    /** File extensions including dot, lowercase */
    extensions: string[];
    /** npm package providing the tree-sitter grammar */
    grammarPackage: string;
    /** Named export on the grammar package, if any (e.g. "typescript", "tsx") */
    grammarExport?: string;
    extract(file: string, source: string, tree: Tree): FunctionInfo[];
}
export declare function namedChildren(node: SyntaxNode): SyntaxNode[];
export declare function childByType(node: SyntaxNode, type: string): SyntaxNode | null;
/**
 * node-tree-sitter returns a fresh JS wrapper for most node accesses, so `===`
 * between two `SyntaxNode` values is unreliable. Compare node identity by span
 * and type instead. Null/undefined operands are never equivalent.
 */
export declare function sameNode(a: SyntaxNode | null | undefined, b: SyntaxNode | null | undefined): boolean;
export declare function collapseWs(text: string): string;
/**
 * Call-site / branch span for a syntax node.
 * Uses tree-sitter 0-based rows → 1-based display lines.
 */
export declare function locFromNode(file: string, node: SyntaxNode): SourceLoc;
