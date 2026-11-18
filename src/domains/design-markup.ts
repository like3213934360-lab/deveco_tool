import { parse as html, type DefaultTreeAdapterTypes as HTML } from "parse5";
import { parse, parseExpression } from "@babel/parser";
import type { ArrowFunctionExpression, Expression, FunctionDeclaration, FunctionExpression, JSXElement, JSXFragment, JSXText } from "@babel/types";
import { invariant, ToolError } from "../core/errors.js";

export interface Element {
  tag: string;
  attrs: Record<string, string>;
  children: (Element | string)[];
}

function htmlElement(node: HTML.ChildNode, depth: number): Element | string | undefined {
  invariant(depth < 32, "INVALID_INPUT", "Design markup is nested too deeply");
  if (node.nodeName === "#comment") return;
  if ("value" in node) return node.value;
  invariant("tagName" in node && node.namespaceURI === "http://www.w3.org/1999/xhtml",
    "CAPABILITY_UNAVAILABLE", "Unsupported HTML node", { node: node.nodeName });
  return { tag: node.tagName, attrs: Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])),
    children: node.childNodes.map((child) => htmlElement(child, depth + 1)).filter((child) => child !== undefined) };
}

export function readHtml(source: string) {
  const document = html(source, { onParseError(error) {
    invariant(error.code === "missing-doctype", "INVALID_INPUT", "Invalid design HTML", { code: error.code, line: error.startLine });
  } });
  const root = document.childNodes.find((child): child is HTML.Element => "tagName" in child && child.tagName === "html")!;
  const head = root.childNodes.find((child): child is HTML.Element => "tagName" in child && child.tagName === "head");
  invariant(head?.childNodes.every((child) => !("tagName" in child) || ["title", "meta"].includes(child.tagName)),
    "CAPABILITY_UNAVAILABLE", "Use inline styles in design HTML; scripts and stylesheets are unsupported");
  const body = root.childNodes.find((child) => "tagName" in child && child.tagName === "body")!;
  return htmlElement(body, 0) as Element;
}

function literal(value: Expression | JSXText, props: Map<string, string>) {
  if (value.type === "Identifier" && props.has(value.name)) return props.get(value.name)!;
  if (value.type === "StringLiteral" || value.type === "JSXText") return value.value;
  if (value.type === "NumericLiteral") return String(value.value);
  throw new ToolError("CAPABILITY_UNAVAILABLE", "JSX expressions must be string or number literals", { kind: value.type });
}

type StaticComponent = { root: JSXElement | JSXFragment; props: string[] };
type Expansion = { components: Map<string, StaticComponent>; nodes: number };

function staticComponent(fn: FunctionDeclaration | ArrowFunctionExpression | FunctionExpression): StaticComponent {
  const [param] = fn.params;
  invariant(!fn.async && !fn.generator && fn.params.length <= 1 && (!param || param.type === "ObjectPattern"),
    "CAPABILITY_UNAVAILABLE", "Use static components with optional destructured literal props");
  const props = param?.type === "ObjectPattern" ? param.properties.map((field) => {
    invariant(field.type === "ObjectProperty" && field.shorthand && field.value.type === "Identifier", "CAPABILITY_UNAVAILABLE", "Use simple named props");
    return field.value.name;
  }) : [];
  const body = fn.body;
  const root = body.type === "BlockStatement" ? (body.body.length === 1 && body.body[0]?.type === "ReturnStatement" ? body.body[0].argument : null) : body;
  invariant(root?.type === "JSXElement" || root?.type === "JSXFragment", "CAPABILITY_UNAVAILABLE", "Use a single static JSX return");
  return { root, props };
}

function jsxElement(node: JSXElement | JSXFragment, depth: number, state: Expansion, props: Map<string, string>): Element {
  invariant(depth < 32 && ++state.nodes <= 500, "INVALID_INPUT", "Expanded design JSX exceeds 500 elements or 32 levels");
  const children = node.children.flatMap((child): (Element | string)[] => {
    if (child.type === "JSXElement" || child.type === "JSXFragment") return [jsxElement(child, depth + 1, state, props)];
    if (child.type === "JSXText") return [child.value];
    invariant(child.type === "JSXExpressionContainer", "CAPABILITY_UNAVAILABLE", "Spread children are unsupported in design JSX");
    return child.expression.type === "JSXEmptyExpression" ? [] : [literal(child.expression, props)];
  });
  if (node.type === "JSXFragment") return { tag: "body", attrs: {}, children };
  const { name, attributes } = node.openingElement;
  invariant(name.type === "JSXIdentifier", "CAPABILITY_UNAVAILABLE", "Use standard tags in design JSX");
  const attrs = attributes.map((attr) => {
    invariant(attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && attr.value, "CAPABILITY_UNAVAILABLE", "Use explicitly named JSX attributes with values");
    const key = attr.name.name, value = attr.value;
    if (key === "style" && value.type === "JSXExpressionContainer" && value.expression.type === "ObjectExpression") {
      const declarations = value.expression.properties.map((prop) => {
        invariant(prop.type === "ObjectProperty" && !prop.computed && !prop.shorthand && (prop.key.type === "Identifier" || prop.key.type === "StringLiteral"),
          "CAPABILITY_UNAVAILABLE", "Use literal CSS properties in JSX style");
        invariant(prop.value.type === "StringLiteral" || prop.value.type === "NumericLiteral", "CAPABILITY_UNAVAILABLE", "Use literal CSS values in JSX style");
        const css = (prop.key.type === "Identifier" ? prop.key.name : prop.key.value).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
        return css + ":" + literal(prop.value, props);
      });
      return [key, declarations.join(";")];
    }
    if (value.type === "StringLiteral") return [key, value.value];
    invariant(value.type === "JSXExpressionContainer" && value.expression.type !== "JSXEmptyExpression",
      "CAPABILITY_UNAVAILABLE", "Use explicit literal JSX attribute values");
    return [key, literal(value.expression, props)];
  });
  invariant(new Set(attrs.map(([key]) => key)).size === attrs.length, "INVALID_INPUT", "Duplicate JSX attribute");
  if (/^[A-Z]/.test(name.name)) {
    const component = state.components.get(name.name);
    invariant(component && !children.length, "CAPABILITY_UNAVAILABLE", "Use a file-local static component without children", { component: name.name });
    const bound = new Map(attrs.map(([key, value]) => [key!, value!]));
    invariant(bound.size === component.props.length && component.props.every((key) => bound.has(key)), "CAPABILITY_UNAVAILABLE", "Supply exactly the declared component props");
    return jsxElement(component.root, depth + 1, state, bound);
  }
  return { tag: name.name, attrs: Object.fromEntries(attrs), children };
}

export function readJsx(source: string) {
  const options = { plugins: ["jsx", "typescript"] as ["jsx", "typescript"] };
  let root: Expression | null | undefined;
  const components = new Map<string, StaticComponent>();
  try {
    if (source.trimStart().startsWith("<")) root = parseExpression(source, options);
    else {
      const statements = parse(source, { ...options, sourceType: "module" }).program.body;
      for (const entry of statements) {
        if (entry.type === "ImportDeclaration" || entry.type === "ExportDefaultDeclaration") continue;
        const variable = entry.type === "VariableDeclaration" && entry.kind === "const" && entry.declarations.length === 1 ? entry.declarations[0] : undefined;
        const fn = entry.type === "FunctionDeclaration" ? entry : variable?.init;
        const id = entry.type === "FunctionDeclaration" ? entry.id : variable?.id;
        invariant(id?.type === "Identifier" && /^[A-Z]/.test(id.name) && (fn?.type === "FunctionDeclaration" || fn?.type === "ArrowFunctionExpression"),
          "CAPABILITY_UNAVAILABLE", "Only static file-local component declarations are supported");
        components.set(id.name, staticComponent(fn));
      }
      const decl = statements.find((entry) => entry.type === "ExportDefaultDeclaration")?.declaration;
      invariant(decl, "CAPABILITY_UNAVAILABLE", "Design JSX needs a default export");
      if (decl.type === "FunctionDeclaration" || decl.type === "ArrowFunctionExpression" || decl.type === "FunctionExpression") {
        invariant(!decl.params.length, "CAPABILITY_UNAVAILABLE", "Root component cannot require props");
        root = staticComponent(decl).root;
      } else if (decl.type === "Identifier") {
        const component = components.get(decl.name);
        invariant(component && !component.props.length, "CAPABILITY_UNAVAILABLE", "Export a file-local root without props");
        root = component.root;
      } else if (decl.type === "JSXElement" || decl.type === "JSXFragment") root = decl;
    }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("INVALID_INPUT", "Design JSX could not be parsed", { cause: (error as Error).message });
  }
  invariant(root?.type === "JSXElement" || root?.type === "JSXFragment", "CAPABILITY_UNAVAILABLE", "Design JSX must return markup");
  return jsxElement(root, 0, { components, nodes: 0 }, new Map());
}
