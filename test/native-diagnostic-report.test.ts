import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeDiagnostics } from "../src/services/diagnostic-report.js";
import { tools } from "../src/core/contracts.js";

const projectRoot = path.resolve("diagnostic-fixture-app");
const issue = {
  file: path.join(projectRoot, "entry/Index.ets"),
  line: 12,
  column: 3,
  severity: "error",
  rule: "arkts-no-any-unknown",
  message: "Use explicit types",
};
const lsp = {
  range: { start: { line: 11, character: 2 }, end: { line: 11, character: 3 } },
  severity: 1,
  code: issue.rule,
  message: issue.message,
  source: "ArkTS",
};
test("normalization removes exact checker/linter/LSP duplicates with one-based coordinates and original-source pointers", () => {
  const reports = {
      arkts: {
        diagnostics: [issue],
        summary: { errorCount: 1, warnCount: 0 },
        artifact: { artifact_id: "527f764a-0e12-4384-bca0-75c8fcf80f60" },
      },
      linter: {
        report: [{ ...issue, file: "entry/Index.ets" }],
        summary: { issues: 1 },
      },
      lsp: [{ file: pathToFileURL(issue.file).href, diagnostics: [lsp] }],
    },
    before = JSON.stringify(reports),
    result = normalizeDiagnostics(projectRoot, reports);
  assert.equal(result.received, 3);
  assert.equal(result.unique_in_processed, 1);
  assert.equal(result.duplicates_removed, 2);
  assert.equal(result.diagnostics[0]!.occurrences, 3);
  assert.deepEqual(
    result.diagnostics[0]!.sources.map((row) => row.check),
    ["arkts", "linter", "lsp"],
  );
  assert.equal(result.diagnostics[0]!.line, 12);
  assert.equal(result.truncated, false);
  assert.equal(result.compilationVerified, false);
  const { tool, ...input } = result.report_reads[0]!.read;
  assert.ok(tools[tool as keyof typeof tools].schema.safeParse(input).success);
  assert.equal(JSON.stringify(reports), before);
});
test("different codes, messages, severity, positions and language stay separate; incomplete and clipped issues never establish equivalence", () => {
  const variants = [
    issue,
    { ...issue, rule: "other" },
    { ...issue, message: "Different cause" },
    { ...issue, severity: "warning" },
    { ...issue, line: 13 },
    { ...issue, truncated: true },
    { ...issue, truncated: true },
    { ...issue, rule: "" },
    { ...issue, rule: "" },
    { ...issue, line: 0 },
    { ...issue, line: 0 },
  ];
  const result = normalizeDiagnostics(projectRoot, {
    arkts: { diagnostics: variants },
    cpp: [{ file: issue.file, diagnostics: [lsp] }],
  });
  assert.equal(result.received, 12);
  assert.equal(result.duplicates_removed, 0);
  assert.equal(result.unique_in_processed, 12);
  assert.equal(result.truncated, true);
});
test("partial reports and bounded output never advertise whole-project unique counts; malformed rows remain in raw reports", () => {
  const result = normalizeDiagnostics(projectRoot, {
    arkts: {
      diagnostics: [
        { malformed: true },
        ...Array.from({ length: 250 }, (_, i) => ({ ...issue, line: i + 1 })),
      ],
      truncated: true,
      summary: { errorCount: 300, warnCount: 0 },
    },
  });
  assert.equal(result.received, 251);
  assert.equal(result.unnormalized, 1);
  assert.equal(result.unique_in_processed, 250);
  assert.equal(result.scope, "captured report previews");
  assert.ok(result.diagnostics.length <= 200);
  assert.equal(result.truncated, true);
  assert.equal(result.original_reports, "reports");
});
