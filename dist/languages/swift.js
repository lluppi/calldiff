import { childByType, collapseWs, locFromNode, namedChildren, } from "./types.js";
function isPrivate(node) {
    const mods = childByType(node, "modifiers");
    if (!mods)
        return false;
    return /\bprivate\b|\bfileprivate\b/.test(mods.text);
}
function isLikelyTypeName(name) {
    const c = name[0];
    return c !== undefined && c === c.toUpperCase() && c !== c.toLowerCase();
}
function getParamsLabel(node) {
    const params = namedChildren(node).filter((c) => c.type === "parameter");
    if (params.length === 0)
        return "()";
    const names = [];
    for (const p of params) {
        // Prefer external/local simple_identifier; last id is usually the local name
        const ids = namedChildren(p).filter((c) => c.type === "simple_identifier");
        names.push(ids.at(-1)?.text ?? "_");
    }
    return `(${names.join(", ")})`;
}
function navigationProp(nav) {
    const suffix = childByType(nav, "navigation_suffix");
    const id = suffix ? childByType(suffix, "simple_identifier") : null;
    return id?.text ?? null;
}
function calleeKey(node, className) {
    if (node.type === "simple_identifier") {
        if (isLikelyTypeName(node.text))
            return `new ${node.text}`;
        return node.text;
    }
    if (node.type === "navigation_expression") {
        const object = node.namedChild(0);
        const prop = navigationProp(node);
        if (!object || !prop)
            return null;
        if (object.type === "self_expression" && className) {
            return `${className}.${prop}`;
        }
        if (object.type === "simple_identifier") {
            return `${object.text}.${prop}`;
        }
        if (className)
            return `${className}.${prop}`;
        return prop;
    }
    return null;
}
function statementsOf(body) {
    if (!body)
        return [];
    if (body.type === "function_body") {
        const stmts = childByType(body, "statements");
        return stmts ? namedChildren(stmts) : [];
    }
    if (body.type === "statements")
        return namedChildren(body);
    return [body];
}
function collectStatements(file, statements, className) {
    const steps = [];
    const seen = new Set();
    const addCall = (key, node) => {
        const mark = `${key}:${node.startIndex}`;
        if (seen.has(mark))
            return;
        seen.add(mark);
        steps.push({ type: "call", key, ...locFromNode(file, node) });
    };
    const pushIfChain = (node, asElseIf) => {
        const kids = namedChildren(node);
        const stmtBlocks = kids.filter((c) => c.type === "statements");
        const nestedIf = kids.find((c) => c.type === "if_statement") ?? null;
        const cond = kids.find((c) => c.type !== "statements" &&
            c.type !== "else" &&
            c.type !== "if_statement") ?? null;
        const condText = cond ? collapseWs(cond.text) : "";
        const kind = asElseIf ? "else-if" : "if";
        const labelKind = asElseIf ? "else if" : "if";
        steps.push({
            type: "branch",
            key: condText ? `${kind}:${condText}` : kind,
            label: condText ? `${labelKind} ${condText}` : labelKind,
            ...locFromNode(file, cond ?? node),
            children: collectStatements(file, statementsOf(stmtBlocks[0] ?? null), className),
        });
        if (nestedIf) {
            pushIfChain(nestedIf, true);
            return;
        }
        if (stmtBlocks[1]) {
            steps.push({
                type: "branch",
                key: "else",
                label: "else",
                ...locFromNode(file, stmtBlocks[1]),
                children: collectStatements(file, statementsOf(stmtBlocks[1]), className),
            });
        }
    };
    const walk = (node) => {
        if (node.type === "function_declaration" ||
            node.type === "init_declaration" ||
            node.type === "class_declaration" ||
            node.type === "lambda_literal") {
            return;
        }
        if (node.type === "if_statement") {
            pushIfChain(node, false);
            return;
        }
        if (node.type === "do_statement") {
            const doBody = childByType(node, "statements");
            steps.push({
                type: "branch",
                key: "do",
                label: "do",
                ...locFromNode(file, node),
                children: doBody
                    ? collectStatements(file, namedChildren(doBody), className)
                    : [],
            });
            for (const clause of namedChildren(node)) {
                if (clause.type === "catch_block") {
                    const body = childByType(clause, "statements");
                    steps.push({
                        type: "branch",
                        key: "catch",
                        label: "catch",
                        ...locFromNode(file, clause),
                        children: body
                            ? collectStatements(file, namedChildren(body), className)
                            : [],
                    });
                }
            }
            return;
        }
        if (node.type === "switch_statement") {
            for (const entry of namedChildren(node)) {
                if (entry.type !== "switch_entry")
                    continue;
                const pattern = childByType(entry, "switch_pattern");
                const isDefault = namedChildren(entry).some((c) => c.type === "default_keyword");
                const body = childByType(entry, "statements");
                if (isDefault || !pattern) {
                    steps.push({
                        type: "branch",
                        key: "default",
                        label: "default",
                        ...locFromNode(file, entry),
                        children: body
                            ? collectStatements(file, namedChildren(body), className)
                            : [],
                    });
                }
                else {
                    const text = collapseWs(pattern.text);
                    steps.push({
                        type: "branch",
                        key: text ? `case:${text}` : "case",
                        label: text ? `case ${text}` : "case",
                        ...locFromNode(file, pattern),
                        children: body
                            ? collectStatements(file, namedChildren(body), className)
                            : [],
                    });
                }
            }
            return;
        }
        if (node.type === "call_expression") {
            const callee = node.namedChild(0);
            if (callee) {
                const key = calleeKey(callee, className);
                if (key)
                    addCall(key, node);
            }
            for (const child of namedChildren(node).slice(1))
                walk(child);
            return;
        }
        // Unwrap try openIt() → still see the call
        if (node.type === "try_expression") {
            for (const child of namedChildren(node))
                walk(child);
            return;
        }
        for (const child of namedChildren(node))
            walk(child);
    };
    for (const stmt of statements)
        walk(stmt);
    return steps;
}
function handleFunction(file, node, className, functions) {
    const name = childByType(node, "simple_identifier")?.text ?? null;
    if (!name)
        return;
    const body = childByType(node, "function_body");
    const key = className ? `${className}.${name}` : name;
    functions.push({
        key,
        label: `${key}${getParamsLabel(node)}`,
        file,
        steps: collectStatements(file, statementsOf(body), className),
        exported: !isPrivate(node),
        start: node.startIndex,
        end: node.endIndex,
    });
}
function handleInit(file, node, className, functions) {
    const body = childByType(node, "function_body");
    const info = {
        key: `${className}.init`,
        label: `${className}${getParamsLabel(node)}`,
        file,
        steps: collectStatements(file, statementsOf(body), className),
        exported: !isPrivate(node),
        start: node.startIndex,
        end: node.endIndex,
    };
    functions.push(info);
    functions.push({ ...info, key: `new ${className}` });
}
function handleClass(file, node, functions) {
    const className = childByType(node, "type_identifier")?.text ?? null;
    if (!className)
        return;
    const body = childByType(node, "class_body");
    if (!body)
        return;
    for (const element of namedChildren(body)) {
        if (element.type === "function_declaration") {
            handleFunction(file, element, className, functions);
        }
        else if (element.type === "init_declaration") {
            handleInit(file, element, className, functions);
        }
        else if (element.type === "class_declaration") {
            handleClass(file, element, functions);
        }
    }
}
function extractFromTree(file, _source, tree) {
    const functions = [];
    for (const stmt of namedChildren(tree.rootNode)) {
        if (stmt.type === "function_declaration") {
            handleFunction(file, stmt, null, functions);
        }
        else if (stmt.type === "class_declaration") {
            handleClass(file, stmt, functions);
        }
    }
    return functions;
}
export const swiftExtractor = {
    id: "swift",
    extensions: [".swift"],
    grammarPackage: "tree-sitter-swift",
    extract: extractFromTree,
};
