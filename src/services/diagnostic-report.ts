import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const integer = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
const severity = (value: unknown) =>
  typeof value === "number"
    ? ({ 1: "error", 2: "warning", 3: "information", 4: "hint" }[value] ??
      String(value))
    : value === "warn"
      ? "warning"
      : typeof value === "string"
        ? value
        : "unknown";
function filePath(root: string, value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    const file = value.startsWith("file:") ? fileURLToPath(value) : value;
    // Preserve case and symlink spelling: don't merge paths on an assumed filesystem identity.
    return path.isAbsolute(file)
      ? path.normalize(file)
      : path.resolve(root, file);
  } catch {
    return null;
  }
}
type Diagnostic = {
  file: string | null;
  line: number | null;
  column: number | null;
  severity: string;
  code: string | null;
  message: string;
  sources: {
    check: string;
    diagnostic_source: unknown;
    report_index: number | null;
    issue_index: number;
  }[];
  occurrences: number;
  truncated: boolean;
};

/** Exact code/message/start-position matches only. Raw reports remain alongside this preview. */
export function normalizeDiagnostics(root: string, reports: unknown) {
  const values = record(reports),
    issues: Diagnostic[] = [],
    byIdentity = new Map<string, Diagnostic>();
  let received = 0,
    processed = 0,
    duplicates = 0,
    unnormalized = 0,
    inputTruncated = false;
  const reportReads: {
    check: string;
    read: { tool: string; action: string; artifact_id: string };
  }[] = [];
  function collect(check: string, value: unknown, index: number | null) {
    const report = record(value),
      isLsp = check === "lsp" || check === "cpp";
    const rows = array(check === "linter" ? report.report : report.diagnostics);
    received += rows.length;
    const summary = record(report.summary),
      total =
        check === "linter"
          ? integer(summary.issues)
          : check === "arkts"
            ? Number(summary.errorCount ?? 0) + Number(summary.warnCount ?? 0)
            : rows.length;
    inputTruncated ||=
      report.truncated === true || (total !== null && total > rows.length);
    const artifact = record(report.artifact);
    if (typeof artifact.artifact_id === "string")
      reportReads.push({
        check,
        read: {
          tool: "workflow_run",
          action: "read_artifact",
          artifact_id: artifact.artifact_id,
        },
      });
    for (let i = 0; i < rows.length && processed < 20000; i++) {
      processed++;
      const row = record(rows[i]),
        at = record(record(row.range).start),
        line = integer(isLsp ? at.line : row.line),
        column = integer(isLsp ? at.character : row.column);
      if (typeof row.message !== "string") {
        unnormalized++;
        continue;
      }
      const code = isLsp ? row.code : row.rule,
        message = row.message.replace(/\r\n/g, "\n").trim(),
        item: Diagnostic = {
          file: filePath(root, isLsp ? report.file : row.file),
          line: line === null ? null : line + (isLsp ? 1 : 0),
          column: column === null ? null : column + (isLsp ? 1 : 0),
          severity: severity(row.severity),
          code:
            typeof code === "string" || typeof code === "number"
              ? String(code)
              : null,
          message,
          sources: [
            {
              check,
              diagnostic_source: row.source ?? null,
              report_index: index,
              issue_index: i,
            },
          ],
          occurrences: 1,
          truncated: row.truncated === true,
        };
      // Missing codes/locations and clipped messages cannot establish equivalence.
      const comparable =
        item.file &&
        item.line &&
        item.column &&
        item.code &&
        message &&
        !item.truncated;
      const key = comparable
        ? createHash("sha256")
            .update(
              JSON.stringify([
                check === "cpp" ? "cpp" : "arkts",
                item.file,
                item.line,
                item.column,
                item.code,
                item.severity,
                message,
              ]),
            )
            .digest("hex")
        : null;
      const prior = key ? byIdentity.get(key) : undefined;
      if (prior) {
        prior.occurrences++;
        prior.sources.push(...item.sources);
        duplicates++;
      } else {
        issues.push(item);
        if (key) byIdentity.set(key, item);
      }
    }
  }
  for (const check of ["arkts", "linter", "lsp", "cpp"] as const) {
    if (!(check in values)) continue;
    if (check === "lsp" || check === "cpp")
      array(values[check]).forEach((value, index) =>
        collect(check, value, index),
      );
    else collect(check, values[check], null);
  }
  let bytes = 0;
  const preview: Diagnostic[] = [];
  for (const item of issues) {
    const clipped = {
      ...item,
      file: item.file?.slice(0, 1024).toWellFormed() ?? null,
      message: item.message.slice(0, 2048).toWellFormed(),
      code: item.code?.slice(0, 256).toWellFormed() ?? null,
      sources: item.sources.slice(0, 20),
      truncated:
        item.truncated ||
        item.message.length > 2048 ||
        (item.file?.length ?? 0) > 1024 ||
        (item.code?.length ?? 0) > 256 ||
        item.sources.length > 20,
    };
    bytes += Buffer.byteLength(JSON.stringify(clipped));
    if (preview.length >= 200 || bytes > 64 * 1024) break;
    preview.push(clipped);
  }
  return {
    position_base: 1,
    equivalence:
      "same language, file, start position, severity, nonempty code and exact normalized message; no clipped inputs merged",
    scope:
      inputTruncated || processed < received
        ? "captured report previews"
        : "captured complete reports",
    received,
    processed,
    unique_in_processed: issues.length,
    duplicates_removed: duplicates,
    unnormalized,
    truncated:
      inputTruncated ||
      processed < received ||
      preview.length < issues.length ||
      preview.some((item) => item.truncated),
    diagnostics: preview,
    report_reads: reportReads,
    original_reports: "reports",
    compilationVerified: false,
  };
}
