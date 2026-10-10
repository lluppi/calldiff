export function namedChildren(node) {
    const out = [];
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child)
            out.push(child);
    }
    return out;
}
export function childByType(node, type) {
    return namedChildren(node).find((c) => c.type === type) ?? null;
}
/**
 * node-tree-sitter returns a fresh JS wrapper for most node accesses, so `===`
 * between two `SyntaxNode` values is unreliable. Compare node identity by span
 * and type instead. Null/undefined operands are never equivalent.
 */
export function sameNode(a, b) {
    return (a != null &&
        b != null &&
        a.startIndex === b.startIndex &&
        a.endIndex === b.endIndex &&
        a.type === b.type);
}
export function collapseWs(text) {
    return text.replace(/\s+/g, " ").trim();
}
/**
 * Call-site / branch span for a syntax node.
 * Uses tree-sitter 0-based rows → 1-based display lines.
 */
export function locFromNode(file, node) {
    const line = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    return endLine > line ? { file, line, endLine } : { file, line };
}
