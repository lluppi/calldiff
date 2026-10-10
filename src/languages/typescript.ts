/**
 * TypeScript / TSX callable extraction (tree-sitter-typescript).
 */
import type { CallStep, FunctionInfo } from "../types.js";
import {
  childByType,
  collapseWs,
  locFromNode,
  namedChildren,
  type LanguageExtractor,
  type SyntaxNode,
  type Tree,
} from "./types.js";

function isFnLike(type: string): boolean {
  return (
    type === "function_declaration" ||
    type === "function_expression" ||
    type === "arrow_function" ||
    type === "generator_function" ||
    type === "generator_function_declaration" ||
    type === "method_definition"
  );
}

/** Nested function/arrow, not a method — skip as a sibling, maybe nest under a call. */
function isCallback(type: string): boolean {
  return isFnLike(type) && type !== "method_definition";
}

function getParamsLabel(params: SyntaxNode | null): string {
  if (!params || params.type !== "formal_parameters") return "()";
  const parts: string[] = [];
  for (const p of namedChildren(params)) {
    if (p.type === "required_parameter" || p.type === "optional_parameter") {
      const rest = childByType(p, "rest_pattern");
      if (rest) {
        const id = childByType(rest, "identifier");
        parts.push(id ? `...${id.text}` : "...");
        continue;
      }
      const id = childByType(p, "identifier");
      if (id) {
        parts.push(id.text);
        continue;
      }
      if (childByType(p, "object_pattern")) {
        parts.push("{}");
        continue;
      }
      if (childByType(p, "array_pattern")) {
        parts.push("[]");
        continue;
      }
      parts.push("_");
      continue;
    }
    if (p.type === "rest_parameter" || p.type === "rest_pattern") {
      const id = childByType(p, "identifier");
      parts.push(id ? `...${id.text}` : "...");
      continue;
    }
    parts.push("_");
  }
  return parts.length === 0 ? "()" : `(${parts.join(", ")})`;
}

function condText(test: SyntaxNode): string {
  if (test.type === "parenthesized_expression") {
    const inner = test.namedChild(0);
    if (inner) return collapseWs(inner.text);
  }
  return collapseWs(test.text);
}

function branchKey(kind: "if" | "else-if" | "else", cond: string): string {
  if (kind === "else") return "else";
  return `${kind}:${cond}`;
}

function calleeKey(node: SyntaxNode, className: string | null): string | null {
  if (node.type === "identifier") return node.text;
  if (node.type === "this") return className;

  if (
    node.type === "member_expression" ||
    node.type === "subscript_expression"
  ) {
    if (node.type === "subscript_expression") return null;

    const object = node.namedChild(0);
    const property =
      namedChildren(node).find(
        (c) =>
          c.type === "property_identifier" ||
          c.type === "private_property_identifier",
      ) ?? null;
    if (!object || !property) return null;

    const propName = property.text;
    if (object.type === "this" && className) {
      return `${className}.${propName}`;
    }
    if (object.type === "identifier") {
      return `${object.text}.${propName}`;
    }
    if (className) return `${className}.${propName}`;
    return propName;
  }

  return null;
}

/**
 * Treat JSX tags as component "calls". PascalCase identifiers and any
 * member expression (`Foo.Bar`, `motion.div`) count; lowercase tags are HTML.
 */
function jsxCalleeKey(node: SyntaxNode): string | null {
  for (const child of namedChildren(node)) {
    if (child.type === "identifier") {
      const name = child.text;
      return /^[A-Z]/.test(name) ? name : null;
    }
    if (child.type === "member_expression") {
      return calleeKey(child, null);
    }
    if (
      child.type === "jsx_attribute" ||
      child.type === "jsx_expression" ||
      child.type === "type_arguments"
    ) {
      break;
    }
  }
  return null;
}

function statementsOf(node: SyntaxNode): SyntaxNode[] {
  if (node.type === "statement_block") return namedChildren(node);
  return [node];
}

function collectStatements(
  file: string,
  statements: SyntaxNode[],
  className: string | null,
): CallStep[] {
  const steps: CallStep[] = [];
  const seenCalls = new Set<string>();

  const addCall = (key: string, node: SyntaxNode) => {
    const mark = `${key}:${node.startIndex}`;
    if (seenCalls.has(mark)) return;
    seenCalls.add(mark);
    steps.push({ type: "call", key, ...locFromNode(file, node) });
  };

  const emitCall = (
    key: string | null,
    node: SyntaxNode,
    nested: CallStep[],
  ) => {
    if (key && nested.length > 0) {
      steps.push({
        type: "call",
        key,
        ...locFromNode(file, node),
        children: nested,
      });
    } else if (key) {
      addCall(key, node);
    } else {
      steps.push(...nested);
    }
  };

  const walkExpr = (node: SyntaxNode): void => {
    const type = node.type;

    if (isCallback(type)) {
      return;
    }

    if (type === "if_statement") {
      const test =
        childByType(node, "parenthesized_expression") ??
        namedChildren(node).find((c) => c.type !== "else_clause") ??
        null;
      const kids = namedChildren(node);
      const consequent =
        kids.find(
          (c) =>
            c.type !== "parenthesized_expression" && c.type !== "else_clause",
        ) ?? null;
      const elseClause = childByType(node, "else_clause");
      const cond = test ? condText(test) : "";

      steps.push({
        type: "branch",
        key: branchKey("if", cond),
        label: test ? `if (${condText(test)})` : "if",
        ...locFromNode(file, test ?? node),
        children: consequent
          ? collectStatements(file, statementsOf(consequent), className)
          : [],
      });

      let current = elseClause;
      while (current) {
        const inner = current.namedChild(0);
        if (!inner) break;

        if (inner.type === "if_statement") {
          const elseTest =
            childByType(inner, "parenthesized_expression") ?? null;
          const elseKids = namedChildren(inner);
          const elseConsequent =
            elseKids.find(
              (c) =>
                c.type !== "parenthesized_expression" &&
                c.type !== "else_clause",
            ) ?? null;
          const elseCond = elseTest ? condText(elseTest) : "";
          steps.push({
            type: "branch",
            key: branchKey("else-if", elseCond),
            label: elseTest ? `else if (${condText(elseTest)})` : "else if",
            ...locFromNode(file, elseTest ?? current),
            children: elseConsequent
              ? collectStatements(file, statementsOf(elseConsequent), className)
              : [],
          });
          current = childByType(inner, "else_clause");
          continue;
        }

        steps.push({
          type: "branch",
          key: branchKey("else", ""),
          label: "else",
          ...locFromNode(file, current),
          children: collectStatements(file, statementsOf(inner), className),
        });
        break;
      }
      return;
    }

    if (type === "call_expression" || type === "new_expression") {
      const isNew = type === "new_expression";
      const callee = node.namedChild(0);
      const bare = callee ? calleeKey(callee, isNew ? null : className) : null;
      let key =
        bare && isNew && !bare.startsWith("new ") ? `new ${bare}` : bare;
      if (
        receiverScopes &&
        key &&
        !isNew &&
        callee?.type === "member_expression"
      ) {
        const receiver = callee.namedChild(0);
        const tag =
          receiver?.type === "identifier"
            ? resolveReceiver(node, receiver.text)
            : null;
        if (tag) key = `${tag}${key.slice(receiver!.text.length)}`;
      }
      const args = childByType(node, "arguments");
      emitCall(
        key,
        node,
        args ? stepsFromArguments(file, args, className) : [],
      );
      // `foo(x).bar()` keeps `foo` — the receiver is not an argument.
      if (callee) walkExpr(callee);
      return;
    }

    if (type === "jsx_element") {
      const opening = childByType(node, "jsx_opening_element");
      const childNodes = namedChildren(node).filter(
        (c) =>
          c.type !== "jsx_opening_element" && c.type !== "jsx_closing_element",
      );
      const fromAttrs: CallStep[] = [];
      if (opening) {
        for (const attr of namedChildren(opening)) {
          if (
            attr.type === "jsx_attribute" ||
            attr.type === "jsx_expression"
          ) {
            fromAttrs.push(...collectStatements(file, [attr], className));
          }
        }
      }
      const nested = [
        ...fromAttrs,
        ...collectStatements(file, childNodes, className),
      ];
      emitCall(opening ? jsxCalleeKey(opening) : null, opening ?? node, nested);
      return;
    }

    if (type === "jsx_self_closing_element") {
      const attrNodes = namedChildren(node).filter(
        (c) => c.type === "jsx_attribute" || c.type === "jsx_expression",
      );
      emitCall(
        jsxCalleeKey(node),
        node,
        collectStatements(file, attrNodes, className),
      );
      return;
    }

    for (const child of namedChildren(node)) {
      walkExpr(child);
    }
  };

  for (const stmt of statements) {
    walkExpr(stmt);
  }

  return steps;
}

/** Named children of a function node that are never its runtime body. */
const NON_BODY = new Set([
  "comment",
  "formal_parameters",
  "type_parameters",
  "type_annotation",
  "identifier",
  "accessibility_modifier",
  "async",
  "readonly",
]);

function bodyOf(node: SyntaxNode): SyntaxNode | null {
  return (
    childByType(node, "statement_block") ??
    namedChildren(node).find((c) => !NON_BODY.has(c.type)) ??
    null
  );
}

/** Peel `(a) => (b) => body` to `body`. A returned factory (`return () => tick()`) stays out. */
function unwrapCurriedBody(body: SyntaxNode | null): SyntaxNode | null {
  let current = body ? stripTypeWrappers(body) : null;
  while (
    current &&
    (current.type === "arrow_function" ||
      current.type === "function_expression" ||
      current.type === "generator_function")
  ) {
    const inner = bodyOf(current);
    if (!inner) return current;
    current = stripTypeWrappers(inner);
  }
  return current;
}

/**
 * Calls and callback bodies inside `(...)`, as children of the receiving call.
 * Skip a callback already registered as its own definition (`const x = wrap(fn)`).
 */
function stepsFromArguments(
  file: string,
  args: SyntaxNode,
  className: string | null,
): CallStep[] {
  const skipCallbacks = args.parent ? hoistsCallback(args.parent) : false;
  const steps: CallStep[] = [];
  for (const rawArg of namedChildren(args)) {
    const arg = stripTypeWrappers(rawArg);
    if (isCallback(arg.type)) {
      if (skipCallbacks) continue;
      steps.push(
        ...collectStepsFromBody(
          file,
          unwrapCurriedBody(bodyOf(arg)),
          className,
        ),
      );
      continue;
    }
    steps.push(...collectStatements(file, [arg], className));
  }
  return steps;
}

/** True when this call's callback is extracted as a named definition. */
function hoistsCallback(call: SyntaxNode): boolean {
  let current: SyntaxNode | null = call.parent;
  while (current && TRANSPARENT_EXPRESSIONS.has(current.type)) {
    current = current.parent;
  }
  if (!current) return false;
  if (
    current.type === "variable_declarator" ||
    current.type === "export_statement"
  ) {
    return true;
  }
  if (current.type === "arguments") {
    const outer = current.parent;
    return outer?.type === "call_expression" ? hoistsCallback(outer) : false;
  }
  return false;
}

function collectStepsFromBody(
  file: string,
  body: SyntaxNode | null,
  className: string | null,
): CallStep[] {
  if (!body) return [];
  if (body.type === "statement_block") {
    return collectStatements(file, namedChildren(body), className);
  }
  return collectStatements(file, [body], className);
}

/** `yield* Tag` initialiser of a declarator as `Tag`; null for any other value. */
function yieldedTag(declarator: SyntaxNode): string | null {
  const value = declarator.childForFieldName("value");
  if (!value) return null;
  const yielded = stripTypeWrappers(value);
  if (
    yielded.type !== "yield_expression" ||
    !/^yield\s*\*/.test(yielded.text)
  ) {
    return null;
  }
  const operand = yielded.namedChild(0);
  const tag = operand ? stripTypeWrappers(operand) : null;
  if (tag?.type !== "identifier" || !/^[A-Z]/.test(tag.text)) return null;
  return tag.text;
}

/** Collect every name bound by a parameter / declarator pattern. */
function patternNames(node: SyntaxNode | null, out: Set<string>): void {
  if (!node) return;
  switch (node.type) {
    case "identifier":
    case "shorthand_property_identifier_pattern":
      out.add(node.text);
      return;
    case "required_parameter":
    case "optional_parameter":
      patternNames(node.childForFieldName("pattern"), out);
      return;
    case "assignment_pattern":
    case "object_assignment_pattern":
      patternNames(node.childForFieldName("left"), out);
      return;
    case "pair_pattern":
      patternNames(node.childForFieldName("value"), out);
      return;
    case "rest_pattern":
    case "object_pattern":
    case "array_pattern":
    case "formal_parameters":
      for (const child of namedChildren(node)) patternNames(child, out);
      return;
    default:
      return;
  }
}

const SCOPE_FUNCTIONS = new Set([
  "arrow_function",
  "function_expression",
  "function",
  "generator_function",
  "function_declaration",
  "generator_function_declaration",
  "method_definition",
]);

const BLOCK_SCOPES = new Set([
  "statement_block",
  "program",
  "switch_body",
  "class_body",
]);

type Declared = Map<string, string | null>;

/**
 * Per-file memo of `scopeDeclarations`, keyed by span and type (node wrappers
 * are not stable identities). Null while extracting a file with no `yield*`,
 * where no receiver can resolve, so call collection skips the scope walk.
 */
let receiverScopes: Map<string, Declared | null> | null = null;

function memoScopeDeclarations(scope: SyntaxNode): Declared | null {
  if (!receiverScopes) return null;
  const id = `${scope.startIndex}:${scope.endIndex}:${scope.type}`;
  if (receiverScopes.has(id)) return receiverScopes.get(id) ?? null;
  const declared = scopeDeclarations(scope);
  receiverScopes.set(id, declared);
  return declared;
}

/** Record `name` as declared (first declaration wins) with an optional Effect tag. */
function declare(into: Declared, name: string, tag: string | null): void {
  if (!into.has(name)) into.set(name, tag);
}

/** Names declared by a `const/let/var` statement. */
function declareVariables(statement: SyntaxNode, into: Declared): void {
  for (const d of namedChildren(statement)) {
    if (d.type !== "variable_declarator") continue;
    const name = d.childForFieldName("name");
    if (name?.type === "identifier") {
      declare(into, name.text, yieldedTag(d));
      continue;
    }
    const names = new Set<string>();
    patternNames(name, names);
    for (const n of names) declare(into, n, null);
  }
}

/** `var` declarations anywhere in a function body, not crossing nested functions. */
function declareVars(node: SyntaxNode, into: Declared): void {
  for (const child of namedChildren(node)) {
    if (SCOPE_FUNCTIONS.has(child.type) || child.type === "class_body")
      continue;
    if (child.type === "variable_declaration") declareVariables(child, into);
    declareVars(child, into);
  }
}

/** Names a scope node introduces, or null when it is not a scope. */
function scopeDeclarations(scope: SyntaxNode): Declared | null {
  const into: Declared = new Map();
  if (SCOPE_FUNCTIONS.has(scope.type)) {
    const names = new Set<string>();
    patternNames(childByType(scope, "formal_parameters"), names);
    if (scope.type === "arrow_function") {
      patternNames(scope.childForFieldName("parameter"), names);
    }
    if (
      scope.type !== "function_declaration" &&
      scope.type !== "generator_function_declaration" &&
      scope.type !== "method_definition"
    ) {
      patternNames(scope.childForFieldName("name"), names);
    }
    for (const n of names) declare(into, n, null);
    const body = scope.childForFieldName("body");
    if (body) declareVars(body, into);
    return into;
  }
  if (BLOCK_SCOPES.has(scope.type)) {
    for (const statement of namedChildren(scope)) {
      const st =
        statement.type === "export_statement"
          ? (statement.childForFieldName("declaration") ?? statement)
          : statement;
      if (
        st.type === "lexical_declaration" ||
        st.type === "variable_declaration"
      ) {
        declareVariables(st, into);
      } else if (
        st.type === "function_declaration" ||
        st.type === "generator_function_declaration" ||
        st.type === "class_declaration" ||
        st.type === "abstract_class_declaration"
      ) {
        const n = st.childForFieldName("name");
        if (n) declare(into, n.text, null);
      } else if (scope.type === "switch_body") {
        for (const c of namedChildren(st)) {
          if (c.type === "lexical_declaration") declareVariables(c, into);
        }
      }
    }
    return into;
  }
  if (scope.type === "for_statement") {
    const init = scope.childForFieldName("initializer");
    if (
      init &&
      (init.type === "lexical_declaration" ||
        init.type === "variable_declaration")
    ) {
      declareVariables(init, into);
    }
    return into;
  }
  if (scope.type === "for_in_statement") {
    const names = new Set<string>();
    patternNames(scope.childForFieldName("left"), names);
    for (const n of names) declare(into, n, null);
    return into;
  }
  if (scope.type === "catch_clause") {
    const names = new Set<string>();
    patternNames(scope.childForFieldName("parameter"), names);
    for (const n of names) declare(into, n, null);
    return into;
  }
  return null;
}

/**
 * The Effect Tag `name` refers to at `site`, or null. Effect code calls
 * services through a local (`const repo = yield* UserRepo; repo.find()`) and
 * nothing else says what `repo` is, so the binding stands in for a type.
 * Walks outward from the call site; the innermost scope declaring `name`
 * decides, so a shadowing param, local, catch or loop variable wins.
 */
function resolveReceiver(site: SyntaxNode, name: string): string | null {
  for (let scope = site.parent; scope; scope = scope.parent) {
    const declared = memoScopeDeclarations(scope);
    if (declared?.has(name)) return declared.get(name) ?? null;
  }
  return null;
}

function functionFromParts(
  file: string,
  key: string,
  label: string,
  params: SyntaxNode | null,
  body: SyntaxNode | null,
  exported: boolean,
  start: number,
  end: number,
  className: string | null,
): FunctionInfo {
  const paramsLabel = getParamsLabel(params);
  const steps = collectStepsFromBody(file, body, className);
  return {
    key,
    label: `${label}${paramsLabel}`,
    file,
    steps,
    exported,
    start,
    end,
  };
}

const TRANSPARENT_EXPRESSIONS = new Set([
  "parenthesized_expression",
  "as_expression",
  "satisfies_expression",
  "non_null_expression",
  "type_assertion",
]);

/**
 * Peel the wrappers TypeScript allows around a value — `(fn)`, `fn as Handler`,
 * `fn satisfies Handler`, `<Handler>fn`, `fn!` — so the node underneath can be
 * matched on its own terms. In every one of these the value is the first named
 * child, except `<T>fn`, where the leading `type_arguments` comes first.
 */
function stripTypeWrappers(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (TRANSPARENT_EXPRESSIONS.has(current.type)) {
    const inner = namedChildren(current).find(
      (c) => c.type !== "type_arguments",
    );
    if (!inner) return current;
    current = inner;
  }
  return current;
}

/**
 * `export default defineEventHandler(async (event) => {...})` — the module's
 * payload is a function argument to a wrapper call, not a declaration. Extract
 * it, keyed by its own name where it has one and by `fallbackName` otherwise:
 * the declared variable for `const handler = wrapper(...)`, the file stem for a
 * default export, so routes in different files do not collide.
 *
 * Returns whether a function was found, so a nested call that holds none —
 * `createHandler(makeOptions(), async () => {...})` — does not stop the scan
 * before the sibling argument that does.
 */
function unwrapWrappedFunction(
  file: string,
  call: SyntaxNode,
  fallbackName: string | null,
  exported: boolean,
  functions: FunctionInfo[],
  className: string | null = null,
  local = false,
  keepName = false,
): boolean {
  const args = namedChildren(call).find((c) => c.type === "arguments");
  if (!args) return false;
  for (const rawArg of namedChildren(args)) {
    const arg = stripTypeWrappers(rawArg);
    // Wrappers compose: `memo(forwardRef(function Input() {...}))`.
    if (arg.type === "call_expression") {
      if (
        unwrapWrappedFunction(
          file,
          arg,
          fallbackName,
          exported,
          functions,
          className,
          local,
          keepName,
        )
      ) {
        return true;
      }
      continue;
    }
    // Generators count too: `Effect.gen(function* () {...})` is this shape.
    if (!isCallback(arg.type)) continue;
    // A service member keeps its `Owner.member` key even when the generator
    // is named: `find: Effect.fn(function* find() {...})`.
    const named = keepName ? null : childByType(arg, "identifier");
    handleFunctionNode(
      file,
      arg,
      named?.text ?? fallbackName,
      exported,
      className,
      functions,
      local,
    );
    return true;
  }
  return false;
}

/** File path minus extension — the key for an anonymous default export. */
function fileStem(file: string): string {
  return file.replace(/\.[^./]+$/, "");
}

/**
 * Extract a function from a variable declarator's initialiser: a direct
 * arrow/function expression, or a function argument to a wrapper call.
 */
function extractDeclaratorFunction(
  file: string,
  d: SyntaxNode,
  exported: boolean,
  functions: FunctionInfo[],
  className: string | null = null,
  local = false,
): void {
  const id = childByType(d, "identifier");
  if (!id) return;
  // Read the initialiser by field: node-tree-sitter hands out fresh wrapper
  // objects, so `c !== id` identity checks are not reliable.
  const value = d.childForFieldName("value");
  if (!value) return;
  extractValueFunction(
    file,
    value,
    id.text,
    exported,
    functions,
    className,
    local,
  );
}

/**
 * Extract callables from an initialiser value, shared by variable declarators
 * and class fields: a direct function, a wrapper call, or an object literal.
 */
function extractValueFunction(
  file: string,
  value: SyntaxNode,
  name: string,
  exported: boolean,
  functions: FunctionInfo[],
  className: string | null = null,
  local = false,
): void {
  const init = stripTypeWrappers(value);
  if (init.type === "arrow_function" || init.type === "function_expression") {
    handleFunctionNode(file, init, name, exported, className, functions, local);
    return;
  }
  // `const handler = defineEventHandler(async (event) => {...})` — the
  // initialiser is the wrapper call, so the function is one level in.
  if (init.type === "call_expression") {
    unwrapWrappedFunction(
      file,
      init,
      name,
      exported,
      functions,
      className,
      local,
    );
    // `Layer.effect(Db, Effect.gen(...))` — also the implementation of `Db`.
    // The gen itself is already the declarator's function (with its locals).
    const layer = local ? null : layerServiceOwner(init, className);
    const impl = layer ? serviceImplementation(layer.impl) : null;
    if (layer && impl) {
      extractServiceMembers(file, impl, layer.owner, exported, functions);
    }
    return;
  }
  // `const tool = { execute: () => run() }` — a module-level callable object.
  if (init.type === "object") {
    const owner = className && !local ? `${className}.${name}` : name;
    extractObjectLiteralFunctions(
      file,
      init,
      owner,
      exported,
      functions,
      local,
    );
  }
}

/** Static member name for an object-literal key, or null when computed. */
function memberKey(node: SyntaxNode): string | null {
  if (node.type === "property_identifier") return node.text;
  if (node.type === "string") return node.text.replace(/^['"]|['"]$/g, "");
  return null;
}

/**
 * Functions written as object-literal properties, keyed `<owner>.<prop>` so
 * they resolve the way class methods do: `const tool = { run: () => x }` is
 * callable as `tool.run`, and a module that exports only an object literal
 * still yields entrypoints. Nested object literals extend the prefix.
 */
function extractObjectLiteralFunctions(
  file: string,
  object: SyntaxNode,
  ownerName: string,
  exported: boolean,
  functions: FunctionInfo[],
  local = false,
): void {
  for (const member of namedChildren(object)) {
    if (member.type === "pair") {
      const keyNode = member.namedChild(0);
      const valueNode = member.namedChild(1);
      const name = keyNode ? memberKey(keyNode) : null;
      if (!name || !valueNode) continue;
      const value = stripTypeWrappers(valueNode);
      const key = `${ownerName}.${name}`;
      if (isCallback(value.type)) {
        handleFunctionNode(file, value, key, exported, null, functions, local);
      } else if (value.type === "call_expression") {
        unwrapWrappedFunction(
          file,
          value,
          key,
          exported,
          functions,
          null,
          local,
        );
      } else if (value.type === "object") {
        extractObjectLiteralFunctions(
          file,
          value,
          key,
          exported,
          functions,
          local,
        );
      }
      continue;
    }

    if (member.type === "method_definition") {
      const keyNode = childByType(member, "property_identifier");
      const name = keyNode ? memberKey(keyNode) : null;
      if (name) {
        handleFunctionNode(
          file,
          member,
          `${ownerName}.${name}`,
          exported,
          null,
          functions,
          local,
        );
      }
    }
  }
}

/** The object literal a service construction yields, plus where its shorthand names live. */
type ServiceImplementation = {
  object: SyntaxNode;
  /** Body block whose declarations the shorthand members refer to, if any. */
  scope: SyntaxNode | null;
};

const SERVICE_IMPLEMENTATION_KEYS = new Set([
  "effect",
  "scoped",
  "succeed",
  "sync",
]);

/** The initialiser (or function node) a statement declares under `name`, if any. */
function declaredValue(statement: SyntaxNode, name: string): SyntaxNode | null {
  if (
    statement.type === "function_declaration" ||
    statement.type === "generator_function_declaration"
  ) {
    return childByType(statement, "identifier")?.text === name
      ? statement
      : null;
  }
  if (
    statement.type !== "lexical_declaration" &&
    statement.type !== "variable_declaration"
  ) {
    return null;
  }
  for (const d of namedChildren(statement)) {
    if (d.type !== "variable_declarator") continue;
    const id = d.childForFieldName("name");
    if (id?.type !== "identifier" || id.text !== name) continue;
    const value = d.childForFieldName("value");
    return value ? stripTypeWrappers(value) : null;
  }
  return null;
}

/** A module-level `const`/function named `name`, found from any node in the file. */
function topLevelValue(anchor: SyntaxNode, name: string): SyntaxNode | null {
  let root = anchor;
  while (root.parent) root = root.parent;
  for (const child of namedChildren(root)) {
    const statement =
      child.type === "export_statement"
        ? (namedChildren(child).find((c) => c.type !== "export_clause") ??
          child)
        : child;
    const value = declaredValue(statement, name);
    if (value) return value;
  }
  return null;
}

/** Same lookup, but only over the direct children of one block. */
function blockValue(block: SyntaxNode, name: string): SyntaxNode | null {
  for (const statement of namedChildren(block)) {
    const value = declaredValue(statement, name);
    if (value) return value;
  }
  return null;
}

/**
 * Find the object literal an Effect service construction yields — the
 * `{ find, remove }` returned from `Effect.gen(function* () {...})`, or an
 * object handed straight to `Effect.succeed`/`Layer.succeed`. Bounded on
 * purpose: identifier hops stop at three, and everything else descends.
 */
function serviceImplementation(
  node: SyntaxNode,
  hops = 0,
): ServiceImplementation | null {
  const value = stripTypeWrappers(node);
  if (value.type === "object") return { object: value, scope: null };

  if (isCallback(value.type)) {
    const body = bodyOf(value);
    if (!body) return null;
    if (body.type !== "statement_block")
      return serviceImplementation(body, hops);
    const returns = namedChildren(body).filter(
      (c) => c.type === "return_statement",
    );
    const returned = returns.at(-1)?.namedChild(0);
    if (!returned) return null;
    const expr = stripTypeWrappers(returned);
    const resolved =
      expr.type === "identifier" && hops < 3
        ? (() => {
            const target =
              blockValue(body, expr.text) ?? topLevelValue(body, expr.text);
            return target ? serviceImplementation(target, hops + 1) : null;
          })()
        : serviceImplementation(expr, hops);
    if (!resolved) return null;
    return { object: resolved.object, scope: resolved.scope ?? body };
  }

  if (value.type === "call_expression") {
    const callee = value.childForFieldName("function") ?? value.namedChild(0);
    if (
      callee?.type === "member_expression" &&
      callee.childForFieldName("property")?.text === "pipe"
    ) {
      const receiver = callee.childForFieldName("object");
      if (receiver && stripTypeWrappers(receiver).type === "call_expression") {
        return serviceImplementation(receiver, hops);
      }
    }
    const args = namedChildren(value).find((c) => c.type === "arguments");
    if (!args) return null;
    for (const arg of namedChildren(args)) {
      const stripped = stripTypeWrappers(arg);
      if (
        stripped.type !== "object" &&
        stripped.type !== "call_expression" &&
        !isCallback(stripped.type)
      ) {
        continue;
      }
      const found = serviceImplementation(stripped, hops);
      if (found) return found;
    }
    return null;
  }

  if (value.type === "identifier" && hops < 3) {
    const target = topLevelValue(value, value.text);
    return target ? serviceImplementation(target, hops + 1) : null;
  }
  return null;
}

/**
 * Index the members of a service implementation as `<owner>.<member>` so
 * `UserRepo.find` resolves like a class method. Inline members come from the
 * object-literal path; shorthand (`{ find }`) and identifier-valued members are
 * resolved against the construction body first, then the file's top level.
 * Never `local`: these are the service's public surface.
 */
function extractServiceMembers(
  file: string,
  impl: ServiceImplementation,
  owner: string,
  exported: boolean,
  functions: FunctionInfo[],
): void {
  extractObjectLiteralFunctions(file, impl.object, owner, exported, functions);
  for (const member of namedChildren(impl.object)) {
    let name: string | null = null;
    let ident: string | null = null;
    if (member.type === "shorthand_property_identifier") {
      name = member.text;
      ident = member.text;
    } else if (member.type === "pair") {
      const keyNode = member.namedChild(0);
      const valueNode = member.namedChild(1);
      const value = valueNode ? stripTypeWrappers(valueNode) : null;
      if (keyNode && value?.type === "identifier") {
        name = memberKey(keyNode);
        ident = value.text;
      }
    }
    if (!name || !ident) continue;
    const target =
      (impl.scope && blockValue(impl.scope, ident)) ??
      topLevelValue(impl.object, ident);
    if (!target) continue;
    const key = `${owner}.${name}`;
    if (
      target.type === "function_declaration" ||
      target.type === "generator_function_declaration"
    ) {
      handleFunctionNode(file, target, key, exported, null, functions);
    } else if (
      target.type === "arrow_function" ||
      target.type === "function_expression"
    ) {
      handleFunctionNode(file, target, key, exported, null, functions);
    } else if (target.type === "call_expression") {
      // Unwrap only: going through extractValueFunction would re-enter the
      // Layer path, and `const Live = Layer.sync(T, () => ({ live: Live }))`
      // would recurse forever.
      unwrapWrappedFunction(
        file,
        target,
        key,
        exported,
        functions,
        null,
        false,
        true,
      );
    }
  }
}

/**
 * `class X extends Effect.Service<X>()("X", { effect: <impl> })` — the
 * implementation of the service the class declares, if it resolves.
 */
function effectServiceImplementation(
  classNode: SyntaxNode,
): ServiceImplementation | null {
  const heritage = childByType(classNode, "class_heritage");
  const extendsClause = heritage
    ? childByType(heritage, "extends_clause")
    : null;
  const base = extendsClause?.namedChild(0);
  if (!base) return null;
  const outer = stripTypeWrappers(base);
  if (outer.type !== "call_expression") return null;
  const inner = outer.childForFieldName("function") ?? outer.namedChild(0);
  if (inner?.type !== "call_expression") return null;
  const callee = inner.childForFieldName("function") ?? inner.namedChild(0);
  if (
    callee?.type !== "member_expression" ||
    callee.childForFieldName("object")?.text !== "Effect" ||
    callee.childForFieldName("property")?.text !== "Service"
  ) {
    return null;
  }
  const args = namedChildren(outer).find((c) => c.type === "arguments");
  const options = args
    ? namedChildren(args).find((c) => stripTypeWrappers(c).type === "object")
    : null;
  if (!options) return null;
  for (const pair of namedChildren(stripTypeWrappers(options))) {
    if (pair.type !== "pair") continue;
    const keyNode = pair.namedChild(0);
    const valueNode = pair.namedChild(1);
    const key = keyNode ? memberKey(keyNode) : null;
    if (!key || !valueNode || !SERVICE_IMPLEMENTATION_KEYS.has(key)) continue;
    const impl = serviceImplementation(valueNode);
    if (impl) return impl;
  }
  return null;
}

/**
 * `Layer.effect(Tag, impl)` and its siblings, optionally under `.pipe(...)`:
 * the Tag (or `this` inside the Tag's own class) names the service, and the
 * second argument is its implementation.
 */
function layerServiceOwner(
  call: SyntaxNode,
  className: string | null,
): { owner: string; impl: SyntaxNode } | null {
  let current = call;
  for (;;) {
    const callee =
      current.childForFieldName("function") ?? current.namedChild(0);
    if (
      callee?.type === "member_expression" &&
      callee.childForFieldName("property")?.text === "pipe"
    ) {
      const receiver = callee.childForFieldName("object");
      const inner = receiver ? stripTypeWrappers(receiver) : null;
      if (inner?.type !== "call_expression") return null;
      current = inner;
      continue;
    }
    if (
      callee?.type !== "member_expression" ||
      callee.childForFieldName("object")?.text !== "Layer" ||
      !SERVICE_IMPLEMENTATION_KEYS.has(
        callee.childForFieldName("property")?.text ?? "",
      )
    ) {
      return null;
    }
    break;
  }
  const args = namedChildren(current).find((c) => c.type === "arguments");
  const [first, impl] = args ? namedChildren(args) : [];
  if (!first || !impl) return null;
  const tag = stripTypeWrappers(first);
  if (tag.type === "identifier") return { owner: tag.text, impl };
  if (tag.type === "this" && className) return { owner: className, impl };
  return null;
}

/**
 * Register definitions declared inside a function body.
 *
 * `visitStatement` only walks top-level statements, so a helper declared inside
 * a body was never indexed at all, and calls to it fell through to whatever
 * top-level function elsewhere in the repo happened to share the bare name.
 * See #19.
 *
 * Helper bodies are still not attributed to the outer caller (contract #5);
 * they become definitions in their own right, marked `local`.
 */
function collectLocalDefinitions(
  file: string,
  body: SyntaxNode | null,
  className: string | null,
  functions: FunctionInfo[],
) {
  if (!body) return;

  const walk = (node: SyntaxNode): void => {
    for (const child of namedChildren(node)) {
      if (
        child.type === "function_declaration" ||
        child.type === "generator_function_declaration"
      ) {
        const id = childByType(child, "identifier");
        handleFunctionNode(
          file,
          child,
          id?.text ?? null,
          false,
          className,
          functions,
          true,
        );
        continue;
      }

      if (
        child.type === "lexical_declaration" ||
        child.type === "variable_declaration"
      ) {
        for (const d of namedChildren(child)) {
          if (d.type !== "variable_declarator") continue;
          extractDeclaratorFunction(
            file,
            d,
            false,
            functions,
            className,
            true,
          );
        }
        // Fall through: `walk` skips the initializer bodies as fn-like below,
        // so a declaration list is never registered twice.
      }

      // Anonymous callbacks are not addressable by name; skip their bodies.
      if (isFnLike(child.type)) continue;

      walk(child);
    }
  };

  walk(body);
}

function handleFunctionNode(
  file: string,
  node: SyntaxNode,
  name: string | null,
  exported: boolean,
  className: string | null,
  functions: FunctionInfo[],
  /** Declared inside another body: key stays bare and resolution is file-scoped. */
  local = false,
) {
  if (!name) return;
  const key = className && !local ? `${className}.${name}` : name;
  const params = childByType(node, "formal_parameters");
  const body = unwrapCurriedBody(bodyOf(node));

  const info = functionFromParts(
    file,
    key,
    key,
    params,
    body,
    exported,
    node.startIndex,
    node.endIndex,
    className,
  );
  functions.push(local ? { ...info, local: true } : info);
  collectLocalDefinitions(file, body, className, functions);
}

function handleClass(
  file: string,
  node: SyntaxNode,
  exported: boolean,
  functions: FunctionInfo[],
) {
  const nameNode =
    childByType(node, "type_identifier") ?? childByType(node, "identifier");
  const className = nameNode?.text ?? null;
  if (!className) return;

  // `class Repo extends Effect.Service<Repo>()("Repo", {...}) {}` — the
  // members live in the heritage call, not the (empty) class body.
  const service = effectServiceImplementation(node);
  if (service) {
    extractServiceMembers(file, service, className, exported, functions);
    if (service.scope) {
      collectLocalDefinitions(file, service.scope, null, functions);
    }
  }

  const body = childByType(node, "class_body");
  if (!body) return;

  for (const element of namedChildren(body)) {
    if (element.type === "method_definition") {
      const keyNode =
        childByType(element, "property_identifier") ??
        childByType(element, "private_property_identifier") ??
        childByType(element, "computed_property_name");
      const methodName = keyNode?.text ?? null;
      const isConstructor = methodName === "constructor";
      if (!methodName) continue;

      const accessibility = childByType(element, "accessibility_modifier");
      const methodExported = exported || accessibility?.text === "public";

      const params = childByType(element, "formal_parameters");
      const fnBody = childByType(element, "statement_block");
      const key = isConstructor
        ? `${className}.constructor`
        : `${className}.${methodName}`;
      const label = isConstructor ? `new ${className}()` : key;

      functions.push(
        functionFromParts(
          file,
          key,
          label,
          params,
          fnBody,
          methodExported,
          element.startIndex,
          element.endIndex,
          className,
        ),
      );
      collectLocalDefinitions(file, fnBody, className, functions);
    }

    if (element.type === "public_field_definition") {
      const keyNode = childByType(element, "property_identifier");
      const value = element.childForFieldName("value");
      if (keyNode && value) {
        extractValueFunction(
          file,
          value,
          keyNode.text,
          exported,
          functions,
          className,
        );
      }
    }
  }
}

function visitStatement(
  file: string,
  node: SyntaxNode,
  exported: boolean,
  functions: FunctionInfo[],
) {
  if (node.type === "export_statement") {
    const found =
      namedChildren(node).find((c) => c.type !== "export_clause") ?? null;
    if (!found) return;
    const decl = stripTypeWrappers(found);

    const isDefault = node.text.startsWith("export default");

    if (
      decl.type === "function_declaration" ||
      decl.type === "function_expression" ||
      decl.type === "generator_function_declaration" ||
      decl.type === "generator_function"
    ) {
      const id = childByType(decl, "identifier");
      const name = id?.text ?? (isDefault ? "default" : null);
      handleFunctionNode(file, decl, name, true, null, functions);
      return;
    }
    if (decl.type === "arrow_function") {
      handleFunctionNode(
        file,
        decl,
        isDefault ? "default" : null,
        true,
        null,
        functions,
      );
      return;
    }
    if (
      decl.type === "class_declaration" ||
      decl.type === "abstract_class_declaration" ||
      decl.type === "class"
    ) {
      handleClass(file, decl, true, functions);
      return;
    }
    if (decl.type === "call_expression") {
      unwrapWrappedFunction(
        file,
        decl,
        isDefault ? fileStem(file) : null,
        true,
        functions,
      );
      return;
    }
    if (decl.type === "object" && isDefault) {
      extractObjectLiteralFunctions(
        file,
        decl,
        fileStem(file),
        true,
        functions,
      );
      return;
    }
    if (
      decl.type === "lexical_declaration" ||
      decl.type === "variable_declaration"
    ) {
      visitStatement(file, decl, true, functions);
    }
    return;
  }

  if (
    node.type === "function_declaration" ||
    node.type === "generator_function_declaration"
  ) {
    const id = childByType(node, "identifier");
    handleFunctionNode(file, node, id?.text ?? null, exported, null, functions);
    return;
  }

  if (
    node.type === "class_declaration" ||
    node.type === "abstract_class_declaration"
  ) {
    handleClass(file, node, exported, functions);
    return;
  }

  if (
    node.type === "lexical_declaration" ||
    node.type === "variable_declaration"
  ) {
    for (const d of namedChildren(node)) {
      if (d.type !== "variable_declarator") continue;
      extractDeclaratorFunction(file, d, exported, functions);
    }
  }
}

function extractFromTree(
  file: string,
  source: string,
  tree: Tree,
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  receiverScopes = /\byield\s*\*/.test(source) ? new Map() : null;
  try {
    for (const stmt of namedChildren(tree.rootNode)) {
      visitStatement(file, stmt, false, functions);
    }
  } finally {
    receiverScopes = null;
  }
  return functions;
}

export const typescriptExtractor: LanguageExtractor = {
  id: "typescript",
  extensions: [".ts", ".mts", ".cts"],
  grammarPackage: "tree-sitter-typescript",
  grammarExport: "typescript",
  extract: extractFromTree,
};

/** TSX (.tsx) — separate tree-sitter-typescript grammar export from plain TS. */
export const typescriptreactExtractor: LanguageExtractor = {
  id: "typescriptreact",
  extensions: [".tsx"],
  grammarPackage: "tree-sitter-typescript",
  grammarExport: "tsx",
  extract: extractFromTree,
};
