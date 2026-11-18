import JSON5 from "json5";
import { invariant, ToolError } from "../core/errors.js";

export type Primitive = string | boolean | number | null | undefined;
export const memberPath = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,5}$/;

const precedence = { "||": 1, "&&": 2, "===": 3, "!==": 3, "==": 3, "!=": 3,
  "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };
type Binary = keyof typeof precedence;
type Expression = { path: string[] } | { literal: Primitive }
  | { prefix: "!" | "+" | "-"; operand: Expression }
  | { left: Expression; operator: Binary; right: Expression }
  | { test: Expression; yes: Expression; no: Expression };

/** Only local primitives, own data members and operators are evaluated. */
export function parseCondition(source: string): Expression {
  invariant(source.length > 0 && source.length <= 512, "INVALID_INPUT", "Breakpoint condition must contain 1–512 characters");
  const lexer = /\s+|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|0[xX][\da-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|===|!==|<=|>=|==|!=|&&|\|\||\+\+|--|[!<>+*/%?:()\-]/y;
  const tokens: string[] = [];
  while (lexer.lastIndex < source.length) {
    const at = lexer.lastIndex, found = lexer.exec(source);
    invariant(found, "INVALID_INPUT", "Unsupported token in breakpoint condition", { column: at + 1 });
    if (found[0].trim()) tokens.push(found[0]);
  }
  let offset = 0;
  const take = (expected: string) => {
    invariant(tokens[offset] === expected, "INVALID_INPUT", `Expected ${expected} in breakpoint condition`);
    offset++;
  };
  const prefix = (depth: number): Expression => {
    invariant(depth <= 32, "INVALID_INPUT", "Breakpoint condition is nested too deeply");
    const token = tokens[offset++];
    invariant(token, "INVALID_INPUT", "Missing operand in breakpoint condition");
    if (token === "(") { const value = expression(1, depth + 1); take(")"); return value; }
    if (token === "!" || token === "+" || token === "-") return { prefix: token, operand: prefix(depth + 1) };
    if (token === "undefined") return { literal: undefined };
    if (memberPath.test(token) && !["true", "false", "null", "Infinity", "NaN"].includes(token)) return { path: token.split(".") };
    let literal: unknown;
    try { literal = JSON5.parse(token); }
    catch { throw new ToolError("INVALID_INPUT", "Expected a local name, property or literal in breakpoint condition"); }
    invariant(literal === null || typeof literal === "string" || typeof literal === "boolean" || typeof literal === "number" && Number.isFinite(literal),
      "INVALID_INPUT", "Breakpoint literals must be finite primitives");
    return { literal };
  };
  const expression = (min: number, depth: number): Expression => {
    let left = prefix(depth);
    for (;;) {
      const operator = tokens[offset] as Binary;
      const priority = Object.hasOwn(precedence, operator) ? precedence[operator] : 0;
      if (priority < min) break;
      offset++;
      left = { left, operator, right: expression(priority + 1, depth + 1) };
    }
    if (min === 1 && tokens[offset] === "?") {
      offset++;
      const yes = expression(1, depth + 1);
      take(":");
      return { test: left, yes, no: expression(1, depth + 1) };
    }
    return left;
  };
  const parsed = expression(1, 0);
  invariant(offset === tokens.length, "INVALID_INPUT", "Unexpected trailing input in breakpoint condition");
  return parsed;
}

export async function evaluateCondition(expression: Expression, read: (path: string[]) => Promise<Primitive>): Promise<Primitive> {
  if ("literal" in expression) return expression.literal;
  if ("path" in expression) return read(expression.path);
  if ("prefix" in expression) {
    const value = await evaluateCondition(expression.operand, read);
    return expression.prefix === "!" ? !value : expression.prefix === "-" ? -Number(value) : Number(value);
  }
  if ("test" in expression) return evaluateCondition(await evaluateCondition(expression.test, read) ? expression.yes : expression.no, read);
  const left = await evaluateCondition(expression.left, read);
  if (expression.operator === "&&") return left ? evaluateCondition(expression.right, read) : left;
  if (expression.operator === "||") return left ? left : evaluateCondition(expression.right, read);
  const right = await evaluateCondition(expression.right, read);
  const bothStrings = typeof left === "string" && typeof right === "string";
  const a = bothStrings ? left : Number(left), b = bothStrings ? right : Number(right);
  switch (expression.operator) {
    case "===": return left === right;
    case "!==": return left !== right;
    case "==": return left == right;
    case "!=": return left != right;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    case "+": return typeof left === "string" || typeof right === "string" ? String(left) + String(right) : Number(left) + Number(right);
    case "-": return Number(left) - Number(right);
    case "*": return Number(left) * Number(right);
    case "/": return Number(left) / Number(right);
    case "%": return Number(left) % Number(right);
  }
}
