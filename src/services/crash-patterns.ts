import { invariant } from "../core/errors.js";

export const crashReferenceTypes: Readonly<Record<string, string>> = {
  businesserror_patterns: "BusinessError",
  error_patterns: "Error",
  outofmemoryerror_patterns: "OutOfMemoryError",
  rangeerror_patterns: "RangeError",
  referenceerror_patterns: "ReferenceError",
  syntaxerror_patterns: "SyntaxError",
  typeerror_patterns: "TypeError",
  urierror_patterns: "URIError",
};
interface Condition {
  field: "message" | "code_or_message" | "kind";
  mode: "contains" | "template" | "exact";
  alternatives: string[];
}
export interface CrashPattern {
  source_id: string;
  source_line: number;
  error_name: string;
  pattern: string;
  alternatives: Condition[][];
  conclusion: string;
  suggestion: string;
  level: "message_pattern" | "fault_mode";
}

function keywordConditions(expression: string): Condition[][] {
  // This prose row is explicitly reviewed; new prose is an unmapped change.
  if (expression === "应用自定义错误，如 `ApiError ...`")
    return [[{ field: "kind", mode: "exact", alternatives: ["ApiError"] }]];
  const tokens = [...expression.matchAll(/`([^`]+)`/g)];
  invariant(
    tokens.length > 0 && tokens.length <= 16,
    "CRASH_PATTERN_UNMAPPED",
    "Crash keywords need reviewed literal conditions",
  );
  const groups: Condition[][] = [[]];
  let offset = 0;
  for (const [index, token] of tokens.entries()) {
    const separator = expression.slice(offset, token.index).trim();
    invariant(
      index === 0 ? separator === "" : separator === "/" || separator === "+",
      "CRASH_PATTERN_UNMAPPED",
      "Unknown crash pattern combination",
    );
    if (separator === "/") groups.push([]);
    const literal = token[1]!;
    invariant(
      literal.length <= 1024 && !/[<>]/.test(literal),
      "CRASH_PATTERN_UNMAPPED",
      "Keyword templates need explicit mapping",
    );
    groups.at(-1)!.push({
      field: /^\d+$/.test(literal) ? "code_or_message" : "message",
      mode: "contains",
      alternatives:
        literal === "undefined/null" ? ["undefined", "null"] : [literal],
    });
    offset = token.index + token[0].length;
  }
  invariant(
    expression.slice(offset).trim() === "",
    "CRASH_PATTERN_UNMAPPED",
    "Trailing crash pattern prose needs review",
  );
  return groups;
}

/** Compile only the reviewed upstream tables. Unknown table syntax stops an update. */
export function compileCrashReference(
  id: string,
  content: string,
): CrashPattern[] {
  invariant(
    content.length <= 65536,
    "CRASH_PATTERN_UNMAPPED",
    "Runtime case reference exceeds the reviewed bound",
  );
  const name = id.replace(/^arkts-runtime-fix\//, ""),
    faultMode = name === "fault-mode-library",
    type = crashReferenceTypes[name];
  invariant(
    faultMode || type,
    "CRASH_PATTERN_UNMAPPED",
    `Unmapped runtime reference: ${id}`,
  );
  const heading = faultMode ? "## 三级根因库" : "## Pattern Matrix";
  const lines = content.split(/\r?\n/),
    start = lines.indexOf(heading);
  invariant(
    start >= 0 && lines.lastIndexOf(heading) === start,
    "CRASH_PATTERN_UNMAPPED",
    "Runtime case table heading changed",
  );
  const records: CrashPattern[] = [];
  let headers = 0;
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (line.startsWith("## ")) break;
    if (!line) continue;
    invariant(
      line.startsWith("|") && line.endsWith("|"),
      "CRASH_PATTERN_UNMAPPED",
      "Non-table runtime matching requirement needs review",
    );
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    invariant(
      cells.length === (faultMode ? 5 : 3),
      "CRASH_PATTERN_UNMAPPED",
      "Runtime table column count changed",
    );
    if (headers++ < 2) {
      const expected = faultMode
        ? [
            "一级根因",
            "二级根因",
            "Error message 模式",
            "三级根因",
            "分析要点 / 修复方向",
          ]
        : ["Error message keyword", "Analysis conclusion", "Fix suggestion"];
      invariant(
        headers === 1
          ? cells.every((cell, i) => cell === expected[i])
          : cells.every((cell) => /^:?-{3,}:?$/.test(cell)),
        "CRASH_PATTERN_UNMAPPED",
        "Runtime table headers changed",
      );
      continue;
    }
    const pattern = cells[faultMode ? 2 : 0]!;
    invariant(
      pattern.length > 0 && pattern.length <= 2048 && records.length < 128,
      "CRASH_PATTERN_UNMAPPED",
      "Runtime pattern table exceeds its bounds",
    );
    let errorName = type!,
      alternatives: Condition[][];
    if (faultMode) {
      const error = /^`([A-Za-z]*Error)`$/.exec(cells[1]!),
        template = /^`([^`]+)`$/.exec(pattern);
      invariant(
        cells[0] === "`JSError`" && error && template,
        "CRASH_PATTERN_UNMAPPED",
        "Unknown fault mode taxonomy",
      );
      const literal = template[1]!;
      invariant(
        !/[<>]/.test(literal.replace(/<(?:name|string|size|heap-type)>/g, "")),
        "CRASH_PATTERN_UNMAPPED",
        "Unknown fault mode placeholder",
      );
      errorName = error[1]!;
      alternatives = [
        [{ field: "message", mode: "template", alternatives: [literal] }],
      ];
    } else alternatives = keywordConditions(pattern);
    records.push({
      source_id: id,
      source_line: index + 1,
      error_name: errorName,
      pattern,
      alternatives,
      conclusion: cells[faultMode ? 3 : 1]!,
      suggestion: cells[faultMode ? 4 : 2]!,
      level: faultMode ? "fault_mode" : "message_pattern",
    });
  }
  invariant(
    headers >= 3 && records.length > 0,
    "CRASH_PATTERN_UNMAPPED",
    "Runtime case table is empty",
  );
  return records;
}

// Ordered literal scanning: bounded work, no regex generated from source patterns or logs.
function templateMatches(message: string, template: string) {
  const parts = template.split(/<(?:name|string|size|heap-type)>/g);
  if (parts.length === 1) return message === template;
  if (!message.startsWith(parts[0]!)) return false;
  let offset = parts[0]!.length;
  for (const part of parts.slice(1, -1)) {
    const at = message.indexOf(part, offset + 1);
    if (at < 0) return false;
    offset = at + part.length;
  }
  const suffix = parts.at(-1)!;
  return message.endsWith(suffix) && message.length - suffix.length > offset;
}
export interface CrashSignature {
  status: string;
  kind: string;
  error_message: string | null;
  error_code: string | null;
  selection_complete: boolean;
}
export function matchCrashPatterns(
  patterns: CrashPattern[],
  signature: CrashSignature,
) {
  if (signature.status !== "detected") return [];
  const message = signature.error_message ?? "";
  return patterns
    .filter((pattern) => {
      if (
        pattern.error_name !== signature.kind &&
        !(pattern.error_name === "Error" && signature.kind === "ApiError")
      )
        return false;
      return pattern.alternatives.some((group) =>
        group.every((condition) =>
          condition.alternatives.some((literal) => {
            if (condition.field === "kind") return signature.kind === literal;
            if (condition.mode === "template")
              return templateMatches(message, literal);
            if (condition.field === "code_or_message") {
              if (signature.error_code === literal) return true;
              for (
                let at = message.indexOf(literal);
                at >= 0;
                at = message.indexOf(literal, at + 1)
              )
                if (
                  !/\d/.test(message[at - 1] ?? "") &&
                  !/\d/.test(message[at + literal.length] ?? "")
                )
                  return true;
              return false;
            }
            return message.toLowerCase().includes(literal.toLowerCase());
          }),
        ),
      );
    })
    .map(({ alternatives: _conditions, ...pattern }) => ({
      ...pattern,
      match_status: "candidate",
      evidence_complete: signature.selection_complete,
      root_cause_verified: false,
    }));
}
