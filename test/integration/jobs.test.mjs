import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Bundle a small harness that exercises the job runner directly (TS sources -> ESM).
const out = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-jobs-"));
// Tests leave nothing behind; on Windows the state DB may still be open at exit (EPERM): best effort there.
process.on("exit", () => { try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* Windows: file still locked */ } });
process.env.DEVECO_STATE_DIR = out;
const harness = path.join(out, "harness.ts");
fs.writeFileSync(harness, `
export * from ${JSON.stringify(path.resolve("src/core/jobs.ts"))};
export * from ${JSON.stringify(path.resolve("src/core/artifacts.ts"))};
export * from ${JSON.stringify(path.resolve("src/core/db.ts"))};
export { ToolError } from ${JSON.stringify(path.resolve("src/core/errors.ts"))};
export { formatCheck } from ${JSON.stringify(path.resolve("src/domains/code.ts"))};
export { settlePreflight } from ${JSON.stringify(path.resolve("src/jobs.ts"))};
`);
// Output inside the repo so external packages (zod, json5) resolve from node_modules.
const bundle = path.resolve("node_modules/.cache/deveco-test-harness.mjs");
await build({ entryPoints: [harness], outfile: bundle, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error" });
const m = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);

let effectRuns = 0;
m.defineJob({
  kind: "t_ok",
  steps: [
    { id: "a", run: async (ctx) => ctx.input.n + 1 },
    { id: "b", effect: true, run: async (ctx) => { effectRuns++; return ctx.outputs.a * 2; } },
    { id: "skip", when: () => false, run: async () => { throw new Error("must not run"); } },
  ],
  summarize: (o) => ({ value: o.b }),
});
m.defineJob({ kind: "t_fail", steps: [{ id: "x", run: async () => { throw new m.ToolError("BUILD_FAILED", "boom", { detail: 1 }, "fix it"); } }] });
m.defineJob({ kind: "t_slow", steps: [{ id: "wait", run: (ctx) => new Promise((resolve, reject) => { const t = setTimeout(resolve, 10000); ctx.signal.addEventListener("abort", () => { clearTimeout(t); reject(ctx.signal.reason); }); }) }] });

test("runs steps in order, skips when=false, summarizes", async () => {
  const { job_id } = await m.startJob("t_ok", { n: 1 });
  const status = await m.waitJob(job_id, 5000);
  assert.equal(status.status, "succeeded");
  assert.deepEqual(status.result, { value: 4 });
  assert.equal(effectRuns, 1);
});

test("request_key deduplicates identical input and rejects different input", async () => {
  const first = await m.startJob("t_ok", { n: 5 }, "k1");
  await m.waitJob(first.job_id, 5000);
  const again = await m.startJob("t_ok", { n: 5 }, "k1");
  assert.equal(again.job_id, first.job_id);
  assert.equal(again.deduplicated, true);
  await assert.rejects(m.startJob("t_ok", { n: 6 }, "k1"), (e) => e.code === "CONFLICT");
});

test("failures keep code, details and hint", async () => {
  const { job_id } = await m.startJob("t_fail", {});
  const status = await m.waitJob(job_id, 5000);
  assert.equal(status.status, "failed");
  assert.equal(status.error.code, "BUILD_FAILED");
  assert.equal(status.error.hint, "fix it");
  assert.deepEqual(status.error.details, { detail: 1 });
});

test("cancel stops a running job", async () => {
  const { job_id } = await m.startJob("t_slow", {});
  await m.waitJob(job_id, 100);
  const status = await m.cancelJob(job_id);
  assert.equal(status.status, "cancelled");
});

test("interrupted effect is not replayed without force", async () => {
  const db = await m.database();
  let runs = 0;
  m.defineJob({ kind: "t_effect", steps: [{ id: "install", effect: true, run: async () => { runs++; return "ok"; } }] });
  // Simulate a crash after intent was recorded.
  db.prepare("INSERT INTO jobs(id,kind,status,input,created,updated) VALUES('j_crash','t_effect','interrupted','{}',0,0)").run();
  db.prepare("INSERT INTO effects(job_id,step,state,updated) VALUES('j_crash','install','intent',0)").run();
  await m.resumeJob("j_crash");
  let status = await m.waitJob("j_crash", 3000);
  assert.equal(status.status, "needs_input");
  assert.equal(status.error.code, "EFFECT_UNCERTAIN");
  assert.equal(runs, 0);
  await m.resumeJob("j_crash", true);
  status = await m.waitJob("j_crash", 3000);
  assert.equal(status.status, "succeeded");
  assert.equal(runs, 1);
});

test("artifacts page by line and filter with grep", async () => {
  const artifact = await m.saveArtifact(Array.from({ length: 500 }, (_, i) => `line ${i}${i % 50 === 0 ? " ERROR" : ""}`).join("\n"));
  const page = await m.readArtifact(artifact.artifact_id, { limit: 100 });
  assert.equal(page.total_lines, 500);
  assert.equal(page.next_line, 100);
  const last = await m.readArtifact(artifact.artifact_id, { line: 450, limit: 100 });
  assert.equal(last.next_line, null);
  const errors = await m.readArtifact(artifact.artifact_id, { grep: "ERROR" });
  assert.equal(errors.matched_lines, 10);
  assert.match(errors.content, /^1: line 0 ERROR/);
});

test("checker summaries distinguish dependency scope and retain every diagnostic in a pageable artifact", async () => {
  const root = path.join(out, "project");
  const checked = path.join("entry", "src", "main", "ets", "Main.ets"), dependency = path.join("library", "src", "main", "ets", "Helper.ets");
  const diagnostics = [
    ...Array.from({ length: 65 }, (_, i) => ({ file: dependency, line: i + 1, column: 1, severity: "warning", message: `dependency issue ${i}`, rule: "sample-warning" })),
    { file: path.join(root, checked), line: 1, column: 1, severity: "error", message: "root error" },
    { line: 0, column: 0, severity: "error", message: "project configuration error" },
  ];
  const result = await m.formatCheck({ checkedFiles: [checked], errors: diagnostics, summary: { errorCount: 2, warnCount: 65, fileCount: 1 } }, root, false, true);
  assert.equal(result.files, 1);
  assert.equal(result.total, 67);
  assert.deepEqual(result.scope, { mode: "files", requested_files: 1, diagnostic_files: 2, additional_files: 1, unlocated_issues: 1 });
  assert.equal(result.truncated, true);
  assert.equal(result.issues.length, 50);
  assert.deepEqual(result.issues.slice(0, 2).map((issue) => issue.severity), ["error", "error"]);
  let line = 0, content = "", pages = 0;
  do {
    const page = await m.readArtifact(result.report_artifact, { line, limit: 37 });
    content += page.content + "\n";
    line = page.next_line;
    pages++;
  } while (line !== null);
  assert.ok(pages > 1);
  const report = JSON.parse(content);
  assert.equal(report.issues.length, 67);
  assert.deepEqual(report.checked_files, [checked]);
  assert.equal(report.issues.at(-1).message, "dependency issue 64");
  assert.deepEqual(report.scope, result.scope);
  const match = await m.readArtifact(result.report_artifact, { grep: "dependency issue 64" });
  assert.equal(match.matched_lines, 1);
  const preflight = { errors: result.errors, warnings: result.warnings, files: result.files, scope: "changed", diagnostic_scope: result.scope, report_artifact: result.report_artifact, issues: result.issues.slice(0, 10) };
  const settled = m.settlePreflight(preflight, true);
  assert.equal(settled.errors, 0);
  assert.equal(settled.overruled, 2);
  assert.equal(settled.issues, undefined, "The build summary cannot keep compiler-overruled errors active");
  assert.equal(settled.report_artifact, result.report_artifact);
  assert.deepEqual(settled.diagnostic_scope, result.scope);
  assert.equal(settled.scope, "changed");
  assert.equal(settled.files, 1);
  assert.match(settled.note, /original static findings, not the build verdict/);
  assert.equal(preflight.errors, 2, "Settling a build must not rewrite original findings");
  assert.equal(m.settlePreflight(preflight, false), preflight);
  const clean = await m.formatCheck({ checkedFiles: [], errors: [], summary: { errorCount: 0, warnCount: 0, fileCount: 0 } }, root, false, false);
  assert.deepEqual(clean.scope, { mode: "project", requested_files: null, diagnostic_files: 0, additional_files: 0, unlocated_issues: 0 });
  assert.equal(clean.truncated, false);
});

test("force resume never repeats a protected cloud mutation without a receipt", async () => {
  const db = await m.database(); let runs = 0;
  m.defineJob({ kind: "t_protected", steps: [{ id: "create", effect: true, replay: false, run: async () => { runs++; } }] });
  db.prepare("INSERT INTO jobs(id,kind,status,input,created,updated) VALUES('j_protected','t_protected','interrupted','{}',0,0)").run();
  db.prepare("INSERT INTO effects(job_id,step,state,updated) VALUES('j_protected','create','intent',0)").run();
  for (const force of [false, true, true]) {
    await m.resumeJob("j_protected", force);
    const status = await m.waitJob("j_protected", 3000);
    assert.equal(status.status, "needs_input"); assert.equal(status.error.code, "EFFECT_UNCERTAIN");
  }
  assert.equal(runs, 0);
});

test("a job left running by a dead server reads as interrupted and resumes", async () => {
  const db = await m.database();
  let runs = 0;
  m.defineJob({ kind: "t_orphan", steps: [{ id: "a", run: async () => ++runs }] });
  // Owner pid 999999 does not exist: the server that ran it crashed.
  db.prepare("INSERT INTO jobs(id,kind,status,input,created,updated,owner) VALUES('j_orphan','t_orphan','running','{}',0,0,999999)").run();
  const seen = await m.jobStatus("j_orphan");
  assert.equal(seen.status, "interrupted");
  assert.equal(seen.next.action, "resume");
  await m.resumeJob("j_orphan");
  assert.equal((await m.waitJob("j_orphan", 3000)).status, "succeeded");
  assert.equal(runs, 1);
  // Cancel also works on an orphan.
  db.prepare("INSERT INTO jobs(id,kind,status,input,created,updated,owner) VALUES('j_orphan2','t_orphan','queued','{}',0,0,999999)").run();
  assert.equal((await m.cancelJob("j_orphan2")).status, "cancelled");
});

test("cleanup removes expired job-less artifacts, stray files and old UI tests; keeps recent ones", async () => {
  const db = await m.database();
  const fs = await import("node:fs");
  const path = await import("node:path");
  const old = await m.saveArtifact("old screenshot text");
  const fresh = await m.saveArtifact("fresh");
  db.prepare("UPDATE artifacts SET created=0 WHERE id=?").run(old.artifact_id);
  const dir = m.artifactDir();
  const stray = path.join(dir, "a_stray000000000.txt");
  fs.writeFileSync(stray, "orphan");
  fs.utimesSync(stray, new Date(0), new Date(0));
  db.exec("CREATE TABLE IF NOT EXISTS ui_tests (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)");
  db.prepare("INSERT OR REPLACE INTO ui_tests VALUES('t_old','{}',0),('t_new','{}',?)").run(Date.now());
  await m.cleanup();
  await assert.rejects(m.readArtifact(old.artifact_id), (e) => e.code === "NOT_FOUND");
  assert.equal((await m.readArtifact(fresh.artifact_id)).content, "fresh");
  assert.equal(fs.existsSync(stray), false);
  assert.deepEqual(db.prepare("SELECT id FROM ui_tests ORDER BY id").all().map((r) => r.id), ["t_new"]);
});

test("exported copies expire with the artifacts; untracked user files are never touched", async () => {
  const db = await m.database();
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(out, "exports");
  fs.mkdirSync(dir, { recursive: true });
  const oldCopy = path.join(dir, "shot.jpg"), newCopy = path.join(dir, "new.jpg"), mine = path.join(dir, "user-notes.txt");
  for (const f of [oldCopy, newCopy, mine]) fs.writeFileSync(f, "x");
  await m.trackExport(oldCopy);
  await m.trackExport(newCopy);
  db.prepare("UPDATE exports SET created=0 WHERE path=?").run(oldCopy);
  await m.cleanup();
  assert.equal(fs.existsSync(oldCopy), false);
  assert.equal(fs.existsSync(newCopy), true);
  assert.equal(fs.existsSync(mine), true, "files this server did not write are left alone");
});
