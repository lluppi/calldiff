import pc from "picocolors";
import { formatSourceLoc, pickLoc } from "./loc.js";
function paint(status, text) {
    switch (status) {
        case "added":
            return pc.blue(text);
        case "removed":
            return pc.magenta(text);
        default:
            return text;
    }
}
function prefix(status) {
    switch (status) {
        case "added":
            return pc.blue("+");
        case "removed":
            return pc.magenta("-");
        default:
            return " ";
    }
}
function renderAsciiTree(root, options, withStatus) {
    const useColor = options.color !== false;
    const showLocs = options.locs === true;
    const paintStatus = (status, text) => useColor ? paint(status, text) : text;
    const statusPrefix = (status) => {
        if (!useColor) {
            switch (status) {
                case "added":
                    return "+";
                case "removed":
                    return "-";
                default:
                    return " ";
            }
        }
        return prefix(status);
    };
    const locSuffix = (node) => {
        if (!showLocs)
            return "";
        const loc = pickLoc(node);
        if (!loc.file || loc.line == null)
            return "";
        // SAFETY: file and line were just validated as present above.
        const text = `  ${formatSourceLoc(loc)}`;
        return useColor ? pc.dim(text) : text;
    };
    const lines = [];
    const walk = (node, indent, isLast, isRoot) => {
        const branch = isRoot ? "" : isLast ? "└─ " : "├─ ";
        const label = withStatus
            ? paintStatus(node.status ?? "same", node.label)
            : node.label;
        const suffix = locSuffix(node);
        const line = withStatus
            ? `${statusPrefix(node.status ?? "same")} ${indent}${branch}${label}${suffix}`
            : `${indent}${branch}${label}${suffix}`;
        lines.push(line);
        // Conditional arms omit the continuing │ rail — they are alternate paths,
        // not a nested stack that continues past the branch.
        const rail = node.kind === "branch" ? "   " : isLast || isRoot ? "   " : "│  ";
        const childIndent = isRoot ? "" : `${indent}${rail}`;
        node.children.forEach((child, index) => {
            walk(child, childIndent, index === node.children.length - 1, false);
        });
    };
    walk(root, "", true, true);
    return lines.join("\n");
}
/**
 * Render a callstack diff as an ASCII tree with +/- markers.
 */
export function renderDiff(root, options = {}) {
    return renderAsciiTree(root, options, true);
}
/**
 * Render a single call tree as an ASCII tree (no +/- markers).
 */
export function renderTree(root, options = {}) {
    return renderAsciiTree(root, options, false);
}
