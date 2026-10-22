import vm from "node:vm";
import { invariant, ToolError } from "./errors.js";

const match = new vm.Script("lines.map(line => regex.test(line))");

/** Bound caller-supplied log expressions without changing their regex semantics. */
export function grepMatcher(pattern: string) {
  invariant(pattern.length <= 512, "INVALID_INPUT", "Log grep is limited to 512 characters");
  let regex: RegExp;
  try { regex = new RegExp(pattern, "i"); }
  catch { throw new ToolError("INVALID_INPUT", "Invalid log grep regular expression"); }
  const context = vm.createContext({ regex, lines: [] });
  return (lines: string[]): boolean[] => {
    invariant(lines.every((line) => line.length <= 1024 * 1024), "INVALID_INPUT", "Log grep cannot evaluate lines above 1 MiB; read without grep instead");
    try {
      context.lines = lines;
      return match.runInContext(context, { timeout: 100 }) as boolean[];
    } catch { throw new ToolError("INVALID_INPUT", "Log grep exceeded the 100 ms evaluation budget; simplify the expression"); }
    finally { context.lines = []; }
  };
}
