import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { stripVTControlCharacters } from "node:util";

const MISSING_REPORT = "Scanner output format unexpected: missing report path.";
const SCANNER_OUTPUT = /^\[compat:check\] === scan stdout ===\r?\n([\s\S]*?)^\[compat:check\] === end stdout ===\r?\n?/m;

/** Adapt the pinned CLI's no-change result, keeping scanner/validation failures. */
export function compatScanResult(result, input, project, format) {
  const stdout = stripVTControlCharacters(result.stdout);
  const stderr = stripVTControlCharacters(result.stderr);
  const scanner = SCANNER_OUTPUT.exec(stdout)?.[1];
  const noChanges = result.exitCode === 1 && !result.signal && !result.outputTruncated
    && scanner && /^No API changes found between specified versions\.\r?$/m.test(scanner)
    && /^API change scan completed, took: [\d.]+ s\s*$/m.test(scanner)
    && !/CSV saved to:/.test(scanner)
    && new RegExp(`^Error: ${MISSING_REPORT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?$`, "m").test(`${stdout}\n${stderr}`)
    && [result.detectedFailure].filter(Boolean)
      .every((message) => message === `Error: ${MISSING_REPORT}`);

  if (noChanges) {
    const report = { records: [], count: 0 };
    let reportPath;
    if (input.output_path) {
      const target = path.resolve(project, input.output_path);
      const ext = path.extname(target).toLowerCase();
      reportPath = [".json", ".csv"].includes(ext) ? target
        : path.join(target, `api-change-${crypto.randomUUID()}.${format === "json" ? "json" : "csv"}`);
      const content = reportPath.toLowerCase().endsWith(".json") ? `${JSON.stringify(report, null, 2)}\n`
        : "\ufeffApi Definition,Language,ChangeId,Changed in SDK,Affected Versions,Title,Code Location,Change Type\r\n";
      // The official command validates the target before scanning; preserve its
      // no-overwrite contract even if a file appeared while the scanner ran.
      fs.writeFileSync(reportPath, content, { flag: "wx" });
    }
    return {
      ...result, exitCode: 0, detectedFailure: "", stderr: "",
      stdout: `${format === "json" ? JSON.stringify(report, null, 2) : "No API changes detected.\nTotal: 0"}\n`
        + (reportPath ? `Report: ${reportPath}\n` : ""),
    };
  }
  if (result.exitCode !== 0 || result.signal) return result;
  // Debug is an internal capture mechanism; leave the public successful report
  // in the CLI's normal format. Keep complete diagnostics on failures.
  return { ...result, stdout: stdout.replace(SCANNER_OUTPUT, "").replace(/^\[DEBUG\].*\r?\n?/gm, "") };
}
