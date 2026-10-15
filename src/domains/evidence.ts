import fs from "node:fs";
import path from "node:path";
import { database } from "../core/db.js";
import { invariant } from "../core/errors.js";
import { fileSha256, sha256, walk } from "../core/files.js";
import { stateDir } from "../core/config.js";

export type Verdict = "passed" | "failed" | "blocked" | "inconclusive" | "not_run" | "recorded";
export interface CheckResult { id: string; type: string; required: boolean; verdict: Verdict; elapsed_ms: number; detail: unknown }

/** Required work must be completed; an optional failure is visible but does not change the gate. */
export function aggregate(results: Pick<CheckResult, "required" | "verdict">[]): Verdict {
  const required = results.filter((r) => r.required);
  if (!required.length) return "inconclusive";
  for (const status of ["failed", "blocked", "inconclusive", "not_run", "recorded"] as const)
    if (required.some((r) => r.verdict === status)) return status;
  return "passed";
}

/** Identity includes uncommitted and untracked sources; generated outputs and verification state are excluded. */
export async function sourceIdentity(project: string) {
  const skip = new Set(["node_modules", "oh_modules", "build", ".hvigor", ".git", ".idea", ".cxx", ".test", ".cache", ".arkpilot"]);
  const files = [];
  for (const file of walk(project, skip)) files.push({ file: path.relative(project, file).replaceAll("\\", "/"), sha256: await fileSha256(file) });
  files.sort((a, b) => a.file.localeCompare(b.file));
  return { sha256: sha256(JSON.stringify(files)), files };
}

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

/** JUnit marks incomplete mandatory checks as errors, so CI cannot turn missing evidence green. */
export function junit(results: CheckResult[]) {
  const tests = results.map((r) => {
    const body = r.verdict === "passed" ? "" : !r.required ? `<skipped message="${escape(r.verdict)}"/>`
      : r.verdict === "failed" ? `<failure message="check failed">${escape(JSON.stringify(r.detail))}</failure>`
        : `<error type="${r.verdict}" message="required evidence incomplete">${escape(JSON.stringify(r.detail))}</error>`;
    return `<testcase name="${escape(r.id)}" classname="${escape(r.type)}" time="${r.elapsed_ms / 1000}">${body}</testcase>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="deveco.verify" tests="${results.length}" failures="${results.filter((r) => r.required && r.verdict === "failed").length}" errors="${results.filter((r) => r.required && !["passed", "failed"].includes(r.verdict)).length}" skipped="${results.filter((r) => !r.required && r.verdict !== "passed").length}">\n${tests.join("\n")}\n</testsuite>\n`;
}

/** Export complete referenced artifacts into a new directory, outside artifact retention. */
export async function exportEvidence(directory: string, report: { results: CheckResult[]; [key: string]: unknown }) {
  invariant(path.isAbsolute(directory), "INVALID_INPUT", "Evidence directory must be absolute");
  let parent = path.dirname(directory);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const canonical = path.join(fs.realpathSync(parent), path.relative(parent, directory));
  const rel = path.relative(fs.existsSync(stateDir()) ? fs.realpathSync(stateDir()) : path.resolve(stateDir()), canonical);
  invariant(rel.startsWith("..") || path.isAbsolute(rel), "INVALID_INPUT", "Permanent evidence must be outside DEVECO_STATE_DIR");
  invariant(!fs.existsSync(directory), "CONFLICT", "Evidence directory already exists; choose a new directory");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const refs = new Set<string>();
  const visit = (x: unknown): void => {
    if (typeof x === "string" && /^a_[\da-f]{16}$/.test(x)) refs.add(x);
    else if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === "object") Object.values(x).forEach(visit);
  };
  visit(report);
  const db = await database();
  const copied = new Set<string>();
  // JSON artifacts may themselves contain artifact references. Copy their transitive closure.
  for (const id of refs) {
    if (copied.has(id)) continue;
    const row = db.prepare("SELECT file,mime FROM artifacts WHERE id=?").get(id) as { file: string; mime: string } | undefined;
    invariant(row && fs.existsSync(row.file), "EVIDENCE_MISSING", `Referenced artifact is missing: ${id}`, { directory });
    const name = `${id}${path.extname(row.file)}`;
    fs.copyFileSync(row.file, path.join(directory, name), fs.constants.COPYFILE_EXCL); fs.chmodSync(path.join(directory, name), 0o600);
    copied.add(id);
    if (row.mime === "application/json") visit(JSON.parse(fs.readFileSync(row.file, "utf8")));
  }
  const write = (name: string, data: string) => fs.writeFileSync(path.join(directory, name), data, { flag: "wx", mode: 0o600 });
  write("report.json", JSON.stringify(report, null, 2));
  write("junit.xml", junit(report.results));
  const rows = report.results.map((r) => `<tr><td>${escape(r.id)}</td><td>${escape(r.type)}</td><td>${escape(r.verdict)}</td><td><details><summary>Evidence</summary><pre>${escape(JSON.stringify(r.detail, null, 2))}</pre></details></td></tr>`).join("");
  write("index.html", `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Verification evidence</title><style>body{font:16px system-ui;max-width:1200px;margin:32px auto;padding:16px}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;border:1px solid #ccc}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Verification: ${escape(report.verdict)}</h1><p>Scope: ${escape(report.scope)}. Required missing evidence does not pass.</p><a href="report.json">JSON</a> · <a href="junit.xml">JUnit</a> · <a href="manifest.json">Checksums</a><table><tr><th>Check</th><th>Type</th><th>Verdict</th><th>Detail</th></tr>${rows}</table><h2>Artifacts</h2><ul>${[...copied].map((id) => { const file = fs.readdirSync(directory).find((f) => f.startsWith(id))!; return `<li><a href="${escape(file)}">${escape(file)}</a></li>`; }).join("")}</ul></html>`);
  const files = [];
  for (const name of fs.readdirSync(directory).sort()) files.push({ file: name, bytes: fs.statSync(path.join(directory, name)).size, sha256: await fileSha256(path.join(directory, name)) });
  write("manifest.json", JSON.stringify({ schema: 1, created_at: new Date().toISOString(), files }, null, 2));
  return { directory, manifest: path.join(directory, "manifest.json"), files: files.length + 1 };
}
