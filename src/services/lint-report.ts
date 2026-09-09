import { z } from "zod";
import { invariant, ToolError } from "../core/errors.js";

const messageSchema = z.object({
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  severity: z.string(),
  message: z.string(),
  rule: z.string(),
});
const fileSchema = z.object({
  filePath: z.string().min(1),
  messages: z.array(z.unknown()).max(100000),
});
export interface LintIssue {
  file: string;
  line: number;
  column: number;
  severity: string;
  message: string;
  rule: string;
  truncated: boolean;
}

/** Current file-report protocol only. Full evidence remains in the original artifact. */
export function parseLintReport(content: string, limit = 50) {
  invariant(
    Number.isInteger(limit) && limit >= 1 && limit <= 200,
    "LINT_LIMIT_INVALID",
    "Use 1–200 preview issues",
  );
  invariant(
    Buffer.byteLength(content) <= 16 * 1024 * 1024,
    "LINT_REPORT_TOO_LARGE",
    "Linter report exceeds 16 MiB",
  );
  let input: unknown;
  try {
    input = JSON.parse(content);
  } catch {
    throw new ToolError("LINT_REPORT_INVALID", "Linter report is not JSON");
  }
  invariant(
    Array.isArray(input) && input.length <= 100000,
    "LINT_REPORT_INVALID",
    "Expected a bounded array of native file reports",
  );
  const report: LintIssue[] = [],
    files = new Set<string>();
  const summary = {
    files_reported: 0,
    issues: 0,
    errors: 0,
    warnings: 0,
    suggestions: 0,
    other: 0,
  };
  let previewBytes = 2,
    previewFull = false;
  for (const raw of input) {
    const file = fileSchema.safeParse(raw);
    invariant(
      file.success,
      "LINT_REPORT_INVALID",
      "Invalid native file report",
    );
    files.add(file.data.filePath);
    for (const rawMessage of file.data.messages) {
      const parsed = messageSchema.safeParse(rawMessage);
      invariant(
        parsed.success,
        "LINT_REPORT_INVALID",
        "Invalid native diagnostic message",
      );
      const message = parsed.data;
      summary.issues++;
      invariant(
        summary.issues <= 100000,
        "LINT_REPORT_TOO_LARGE",
        "Linter report exceeds 100000 issues",
      );
      switch (message.severity.toLowerCase()) {
        case "error":
          summary.errors++;
          break;
        case "warning":
        case "warn":
          summary.warnings++;
          break;
        case "suggestion":
          summary.suggestions++;
          break;
        default:
          summary.other++;
      }
      if (report.length >= limit || previewFull) continue;
      const clip = (value: string, max: number) =>
        value.length <= max ? value : value.slice(0, max).toWellFormed();
      const row: LintIssue = {
        file: clip(file.data.filePath, 1024),
        line: message.line,
        column: message.column,
        severity: clip(message.severity, 64),
        message: clip(message.message, 2048),
        rule: clip(message.rule, 256),
        truncated:
          file.data.filePath.length > 1024 ||
          message.severity.length > 64 ||
          message.message.length > 2048 ||
          message.rule.length > 256,
      };
      const bytes = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (previewBytes + bytes > 24 * 1024) {
        previewFull = true;
        continue;
      }
      report.push(row);
      previewBytes += bytes;
    }
  }
  summary.files_reported = files.size;
  return {
    summary,
    report,
    truncated:
      report.length < summary.issues || report.some((row) => row.truncated),
  };
}
