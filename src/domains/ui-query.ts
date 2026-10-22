import { selectorSchema } from "./selectors.js";
import vm from "node:vm";
import { DOMImplementation } from "@xmldom/xmldom";
import xpath from "xpath";
import { invariant, ToolError } from "../core/errors.js";
import type { Selector, UiNode } from "./ui.js";

const query = new vm.Script("run()", { filename: "ui-selector" });
const stringFields = new Set(["text", "description", "id", "key", "type", "bundle", "window", "page"]);

export function validateSelector(selector: Selector) {
  const parsed = selectorSchema.safeParse(selector);
  invariant(parsed.success, "INVALID_INPUT", "Invalid UI selector", { issues: parsed.error?.issues });
  invariant(selector.regex_flags === undefined || selector.regex, "INVALID_INPUT", "regex_flags requires selector.regex");
  const flags = selector.regex_flags ?? "iu";
  invariant(/^[imsu]*$/.test(flags) && new Set(flags).size === flags.length, "INVALID_INPUT", "regex_flags supports distinct i, m, s, u flags only");
  if (selector.regex) {
    invariant(Object.keys(selector.regex).length > 0, "INVALID_INPUT", "selector.regex requires at least one field");
    for (const [field, pattern] of Object.entries(selector.regex)) {
      invariant(stringFields.has(field) && typeof pattern === "string" && pattern.length > 0 && pattern.length <= 512, "INVALID_INPUT", "Invalid selector regex field or pattern length", { field });
      try { new RegExp(pattern, flags); }
      catch (error) { throw new ToolError("INVALID_INPUT", "Invalid selector regular expression", { field, cause: String(error) }); }
    }
  }
  if (selector.xpath !== undefined) {
    invariant(selector.xpath.length > 0 && selector.xpath.length <= 2048, "INVALID_INPUT", "XPath length must be 1..2048");
    try { (xpath as typeof xpath & { parse(value: string): unknown }).parse(selector.xpath); }
    catch (error) { throw new ToolError("INVALID_INPUT", "Invalid selector XPath", { cause: String(error) }); }
    const document = new DOMImplementation().createDocument(null, "hierarchy");
    const result = bounded(() => xpath.select(selector.xpath!, document as unknown as Node));
    invariant(Array.isArray(result), "INVALID_INPUT", "XPath must select UI elements, not scalar values");
  }
}

/** Build DOM nodes directly; no XML parser, external entities, input code, or persistent tree copies. */
function xpathNodes(nodes: UiNode[], expression: string) {
  const document = new DOMImplementation().createDocument(null, "hierarchy");
  const elements = new Map<number, ReturnType<typeof document.createElement>>();
  const indices = new Map<unknown, number>();
  const available = new Set(nodes.map((node) => node.i));
  for (const node of nodes) {
    let tag = node.type.replace(/[^A-Za-z0-9_.-]/g, "_") || "node";
    if (!/^[A-Za-z_]/.test(tag)) tag = "_" + tag;
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(node.attributes ?? {})) {
      if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) && ["string", "number", "boolean"].includes(typeof value))
        element.setAttribute(key, String(value));
    }
    for (const [key, value] of Object.entries(node)) {
      if (value !== undefined && value !== null && key !== "rect" && key !== "attributes") element.setAttribute(key, String(value));
    }
    // SDK/upstream attribute spelling, alongside the MCP's normalized names.
    for (const [key, value] of Object.entries({ bundleName: node.bundle, windowId: node.window, longClickable: node.long_clickable }))
      if (value !== null && value !== undefined) element.setAttribute(key, String(value));
    const parent = node.parent === null || !available.has(node.parent) ? document.documentElement : elements.get(node.parent);
    invariant(parent, "DEVICE_OUTPUT_INVALID", "UI tree has an invalid parent reference");
    parent.appendChild(element);
    elements.set(node.i, element);
    indices.set(element, node.i);
  }
  const selected = xpath.select(expression, document as unknown as Node);
  invariant(Array.isArray(selected) && selected.every((node) => node.nodeType === 1), "INVALID_INPUT", "XPath must select UI elements, not attributes, text or scalar values");
  return new Set(selected.map((node) => indices.get(node)).filter((i) => i !== undefined));
}

/** A bounded VM interrupts expensive XPath/regex evaluation instead of blocking the MCP event loop. */
export function queryNodes(nodes: UiNode[], selector: Selector): UiNode[] {
  validateSelector(selector);
  if (!selector.xpath && !selector.regex) return nodes;
  const run = () => {
    const selected = selector.xpath ? xpathNodes(nodes, selector.xpath) : undefined;
    const patterns = Object.entries(selector.regex ?? {}).map(([field, pattern]) => [field as keyof UiNode, new RegExp(pattern, selector.regex_flags ?? "iu")] as const);
    return nodes.filter((node) => (!selected || selected.has(node.i)) && patterns.every(([field, pattern]) => pattern.test(String(node[field] ?? ""))));
  };
  return bounded(run);
}

function bounded<T>(run: () => T): T {
  try { return query.runInNewContext({ run }, { timeout: 100, contextCodeGeneration: { strings: false, wasm: false } }) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_SCRIPT_EXECUTION_TIMEOUT")
      throw new ToolError("UI_QUERY_TIMEOUT", "Selector XPath/regex exceeded 100 ms; simplify the expression or restrict the UI tree");
    if (error instanceof ToolError) throw error;
    throw new ToolError("INVALID_INPUT", "Selector evaluation failed", { cause: String(error) });
  }
}
