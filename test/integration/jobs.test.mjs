import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";
import { connect } from "../support/mcp.mjs";

// Bundle a small harness that exercises the job runner directly (TS sources -> ESM).
const out = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-jobs-"));
// Native resolution expands Windows runner short names (e.g. RUNNER~1); JS realpath does not.
const canonicalPath = (file) => { const p = fs.realpathSync.native(file); return process.platform === "win32" ? p.toLowerCase() : p; };
// Tests leave nothing behind; on Windows the state DB may still be open at exit (EPERM): best effort there.
process.on("exit", () => { try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* Windows: file still locked */ } });
process.env.DEVECO_STATE_DIR = out;
const harness = path.join(out, "harness.ts");
fs.writeFileSync(harness, `
export * from ${JSON.stringify(path.resolve("src/core/jobs.ts"))};
export * from ${JSON.stringify(path.resolve("src/core/artifacts.ts"))};
export * from ${JSON.stringify(path.resolve("src/core/db.ts"))};
export * from ${JSON.stringify(path.resolve("src/core/storage.ts"))};
export { ToolError } from ${JSON.stringify(path.resolve("src/core/errors.ts"))};
export { formatCheck } from ${JSON.stringify(path.resolve("src/domains/code.ts"))};
export { settlePreflight } from ${JSON.stringify(path.resolve("src/jobs.ts"))};
`);
// Output inside the repo so external packages (zod, json5) resolve from node_modules.
const bundle = path.resolve("node_modules/.cache/deveco-test-harness.mjs");
await build({ entryPoints: [harness], outfile: bundle, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error" });
const m = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);
after(async () => {
  await m.stopCleanup();
  m.closeDatabase();
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(bundle, { force: true });
});

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

test("concurrent first database calls share one connection and close it completely", async () => {
  const connections = await Promise.all(Array.from({ length: 12 }, () => m.database()));
  try {
    assert.equal(new Set(connections).size, 1, "lazy initialization must not leak extra connections");
    m.closeDatabase();
    for (const db of connections) assert.throws(() => db.prepare("SELECT 1"), /not open|closed/i);
  } finally {
    m.closeDatabase();
    for (const db of new Set(connections)) if (db.isOpen) db.close();
  }
});

test("database startup waits for an existing writer before changing journal mode", async () => {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(workerData);
    db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL); BEGIN EXCLUSIVE');
    db.prepare('INSERT INTO kv(key,value) VALUES(?,?)').run('startup-lock', 'preserved');
    parentPort.once('message', () => setTimeout(() => {
      db.exec('COMMIT'); db.close(); parentPort.close();
    }, 250));
    parentPort.postMessage('locked');
  `, { eval: true, workerData: path.join(out, "state.db") });
  const exited = once(worker, "exit");
  try {
    assert.deepEqual(await once(worker, "message"), ["locked"]);
    worker.postMessage("release after startup attempts to open");
    const db = await m.database();
    assert.equal(db.prepare("SELECT value FROM kv WHERE key='startup-lock'").get().value, "preserved");
    assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    assert.equal(m.recovered, undefined, "contention must never trigger corruption recovery");
    assert.deepEqual(await exited, [0]);
  } finally {
    await worker.terminate();
    await exited;
    m.closeDatabase();
  }
});

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
  const preflight = { errors: result.errors, warnings: result.warnings, files: result.files, scope: "changed", diagnostic_scope: result.scope, report_artifact: result.report_artifact, issues: result.issues.slice(0, 10), source_identity: "checked-source" };
  const settled = m.settlePreflight(preflight, true, "checked-source");
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

test("a successful build cannot overrule findings from different or unverified source", () => {
  const preflight = { errors: 1, source_identity: "before-repair", issues: [{ message: "real compiler error" }], report_artifact: "original-report" };
  for (const identity of ["after-repair", null, undefined]) {
    const summary = m.settlePreflight(preflight, true, identity);
    assert.equal(summary.errors, 1);
    assert.equal(summary.overruled, undefined);
    assert.equal(summary.source_match, false);
    assert.deepEqual(summary.issues, preflight.issues);
    assert.equal(summary.report_artifact, preflight.report_artifact);
  }
  const legacy = m.settlePreflight({ errors: 1 }, true, "current-source");
  assert.equal(legacy.overruled, undefined);
  assert.equal(legacy.source_match, false);
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

test("explicit cleanup observes files created after an earlier discovery snapshot", async (t) => {
  await m.stopCleanup();
  const original = fs.promises.opendir;
  let release, reached;
  const gate = new Promise((r) => { release = r; });
  const paused = new Promise((r) => { reached = r; });
  let held = false;
  t.mock.method(fs.promises, "opendir", async (...args) => {
    const directory = await original(...args);
    if (args[0] !== m.artifactDir() || held) return directory;
    held = true;
    // Freeze the exact directory snapshot, independently of OS enumeration timing.
    const entries = []; for await (const entry of directory) entries.push(entry);
    return { async *[Symbol.asyncIterator]() { reached(); await gate; yield* entries; } };
  });
  const earlier = m.cleanup();
  await paused;
  const stray = path.join(m.artifactDir(), "after-snapshot.txt");
  fs.writeFileSync(stray, "old orphan"); fs.utimesSync(stray, new Date(0), new Date(0));
  const requested = m.cleanup();
  release();
  await Promise.all([earlier, requested]);
  assert.equal(fs.existsSync(stray), false);
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

test("24-hour expiry applies to active jobs and reads immediately reject expired artifacts", async () => {
  const db = await m.database();
  db.prepare("INSERT INTO jobs(id,kind,status,input,created,updated) VALUES('j_active','t_slow','running','{}',0,0)").run();
  const old = await m.saveArtifact("expired media", "text/plain", "j_active");
  db.prepare("UPDATE artifacts SET created=? WHERE id=?").run(Date.now() - 86400000, old.artifact_id);
  const file = db.prepare("SELECT file FROM artifacts WHERE id=?").get(old.artifact_id).file;
  await assert.rejects(m.readArtifact(old.artifact_id), { code: "NOT_FOUND" });
  await m.cleanup();
  assert.equal(fs.existsSync(file), false);
  assert.equal(db.prepare("SELECT status FROM jobs WHERE id='j_active'").get().status, "running");
});

test("failed deletion is recorded once, skips later sweeps and never recursively removes exports", async (t) => {
  const db = await m.database();
  const directory = path.join(out, "protected-export"), other = path.join(out, "expired-copy");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "user-file"), "keep");
  fs.writeFileSync(other, "delete");
  await m.trackExport(directory);
  await m.trackExport(other);
  db.prepare("UPDATE exports SET created=0 WHERE path IN (?,?)").run(directory, other);
  const unlink = fs.promises.unlink;
  const attempts = t.mock.method(fs.promises, "unlink", (file) => unlink(file));
  assert.equal((await m.cleanup()).failed, 1);
  assert.equal(fs.existsSync(path.join(directory, "user-file")), true);
  assert.ok(db.prepare("SELECT 1 FROM exports WHERE path=?").get(directory));
  assert.equal(fs.existsSync(other), false);
  assert.equal(db.prepare("SELECT 1 FROM exports WHERE path=?").get(other), undefined);
  assert.ok(db.prepare("SELECT code,failed_at FROM retention_failures WHERE path=?").get(directory));
  fs.rmSync(directory, { recursive: true }); // Fix the obstruction; this must not re-enable deletion.
  fs.writeFileSync(directory, "retained for manual cleanup");
  for (let i = 0; i < 3; i++) assert.equal((await m.cleanup()).failed, 0);
  assert.equal(attempts.mock.calls.filter((call) => call.arguments[0] === directory).length, 1);
  assert.equal(fs.readFileSync(directory, "utf8"), "retained for manual cleanup");
  // A newly generated export has a new lifetime, not an automatic retry of the failed output.
  await m.trackExport(directory);
  assert.equal(db.prepare("SELECT 1 FROM retention_failures WHERE path=?").get(directory), undefined);
  assert.ok(fs.existsSync(directory));
  db.prepare("UPDATE exports SET created=0 WHERE path=?").run(directory);
  assert.equal((await m.cleanup()).failed, 0);
  assert.equal(db.prepare("SELECT 1 FROM exports WHERE path=?").get(directory), undefined);
  assert.equal(fs.existsSync(directory), false);
});

test("failed artifacts and crash leftovers are excluded from every cleanup path and the byte quota", async (t) => {
  const db = await m.database();
  const old = await m.saveArtifact("blocked media"), fresh = await m.saveArtifact("fresh media");
  const file = db.prepare("SELECT file FROM artifacts WHERE id=?").get(old.artifact_id).file;
  const orphan = path.join(m.artifactDir(), "failed-orphan.mp4");
  fs.writeFileSync(orphan, "unfinished recording");
  fs.utimesSync(orphan, new Date(0), new Date(0));
  db.prepare("UPDATE artifacts SET created=0,bytes=? WHERE id=?").run(600 * 1024 * 1024, old.artifact_id);
  const unlink = fs.promises.unlink;
  const attempts = t.mock.method(fs.promises, "unlink", async (name) => {
    if (name === file || name === orphan) throw Object.assign(new Error("Access denied"), { code: "EACCES" });
    await unlink(name);
  });
  assert.equal((await m.cleanup()).failed, 2);
  for (let i = 0; i < 3; i++) assert.equal((await m.cleanup()).failed, 0);
  for (const name of [file, orphan]) {
    assert.equal(attempts.mock.calls.filter((call) => call.arguments[0] === name).length, 1);
    assert.equal(db.prepare("SELECT code FROM retention_failures WHERE path=?").get(name).code, "EACCES");
    assert.ok(fs.existsSync(name));
  }
  assert.equal((await m.readArtifact(fresh.artifact_id)).content, "fresh media");
  await m.commitArtifact(old.artifact_id, file, "text/plain");
  assert.equal(db.prepare("SELECT 1 FROM retention_failures WHERE path=?").get(file), undefined);
  assert.equal((await m.readArtifact(old.artifact_id)).content, "blocked media");
});

test("byte quota evicts oldest files and retains recent files without reading media content", async () => {
  const db = await m.database(), files = [];
  try {
    for (let i = 0; i < 3; i++) {
      const item = m.artifactPath("video/mp4");
      fs.closeSync(fs.openSync(item.file, "w"));
      fs.truncateSync(item.file, 200 * 1024 * 1024); // Sparse fixture: real size, no large allocation.
      await m.commitArtifact(item.id, item.file, "video/mp4");
      db.prepare("UPDATE artifacts SET created=? WHERE id=?").run(Date.now() - 3000 + i * 1000, item.id);
      files.push(item);
    }
    await m.cleanup();
    assert.deepEqual(files.map(({ file }) => fs.existsSync(file)), [false, true, true]);
  } finally {
    for (const { id, file } of files) {
      fs.rmSync(file, { force: true });
      db.prepare("DELETE FROM artifacts WHERE id=?").run(id);
    }
  }
});

test("capture notifications coalesce and do not repeatedly scan the artifact directory", async (t) => {
  await m.cleanup();
  const original = fs.promises.opendir;
  const scans = t.mock.method(fs.promises, "opendir", (...args) => original(...args));
  for (let i = 0; i < 20; i++) await m.saveArtifact("small capture");
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(scans.mock.callCount(), 0);
});

test("an export refreshed during a cleanup batch keeps its new file and retention record", async (t) => {
  const db = await m.database();
  const first = path.join(out, "refresh-a.mp4"), refreshed = path.join(out, "refresh-b.mp4");
  for (const file of [first, refreshed]) { fs.writeFileSync(file, "old"); await m.trackExport(file); }
  db.prepare("UPDATE exports SET created=0 WHERE path IN (?,?)").run(first, refreshed);
  const unlink = fs.promises.unlink;
  t.mock.method(fs.promises, "unlink", async (file) => {
    await unlink(file);
    if (file === first) {
      fs.writeFileSync(refreshed, "new capture");
      await m.trackExport(refreshed);
    }
  });
  await m.cleanup();
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.readFileSync(refreshed, "utf8"), "new capture");
  assert.ok(db.prepare("SELECT created FROM exports WHERE path=?").get(refreshed).created > Date.now() - 5000);
});

test("managed storage retains current, rollback and live work; expires repair copies without following links", async () => {
  const kb = path.join(out, "kb"), backups = path.join(out, "backups");
  const keep = path.join(out, "keep-user-data");
  fs.mkdirSync(keep); fs.writeFileSync(path.join(keep, "user.txt"), "keep");
  for (const name of ["current", "previous", "orphan", ".tmp-aabb", ".upstream-ccdd", ".unknown"]) {
    fs.mkdirSync(path.join(kb, name), { recursive: true });
    fs.writeFileSync(path.join(kb, name, "data"), name);
    fs.utimesSync(path.join(kb, name), new Date(0), new Date(0));
  }
  fs.writeFileSync(path.join(kb, "current.json"), JSON.stringify({ version: "current", directory: "current", previous: "previous" }));
  for (const name of ["expired", "fresh", "busy"]) {
    fs.mkdirSync(path.join(backups, name), { recursive: true });
    fs.writeFileSync(path.join(backups, name, "copy"), name);
  }
  fs.symlinkSync(keep, path.join(backups, "expired", "link"), process.platform === "win32" ? "junction" : "dir");
  for (const name of ["expired", "busy"]) fs.utimesSync(path.join(backups, name), new Date(0), new Date(0));
  const damaged = path.join(out, "state.db.corrupt-old");
  fs.writeFileSync(damaged, "old recovery copy"); fs.utimesSync(damaged, new Date(0), new Date(0));
  const recovery = path.join(out, `state.db.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.writeFileSync(recovery, "just recovered, original mtime was old"); fs.utimesSync(recovery, new Date(0), new Date(0));
  const releases = await m.storageGuard((db) => [m.pinStorage(db, path.join(backups, "busy")), m.pinStorage(db, path.join(kb, ".upstream-ccdd"))]);
  try {
    assert.equal((await m.collectStorage()).failed, 0);
    for (const name of ["current", "previous", ".upstream-ccdd", ".unknown"]) assert.ok(fs.existsSync(path.join(kb, name)));
    for (const name of ["orphan", ".tmp-aabb"]) assert.equal(fs.existsSync(path.join(kb, name)), false);
    assert.equal(fs.existsSync(path.join(backups, "expired")), false);
    assert.equal(fs.existsSync(damaged), false);
    assert.ok(fs.existsSync(recovery), "A new recovery copy starts its own TTL despite retaining an old database mtime");
    assert.ok(fs.existsSync(path.join(backups, "busy")));
    assert.ok(fs.existsSync(path.join(backups, "fresh")));
    assert.equal(fs.readFileSync(path.join(keep, "user.txt"), "utf8"), "keep");
    for (const release of releases) release();
    assert.equal((await m.collectStorage()).failed, 0);
    assert.equal(fs.existsSync(path.join(backups, "busy")), false);
    assert.equal(fs.existsSync(path.join(kb, ".upstream-ccdd")), false);
  } finally {
    for (const release of releases) release();
    for (const dir of [kb, backups, keep]) fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(recovery, { force: true });
  }
});

test("failed knowledge/backup trees are persisted once and skipped before any later directory traversal", async (t) => {
  const roots = [path.join(out, "kb", "failed-pack"), path.join(out, "backups", "failed-repair")];
  for (const dir of roots) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "blocked"), "keep"); fs.utimesSync(dir, new Date(0), new Date(0)); }
  roots.forEach((dir, i) => { roots[i] = canonicalPath(dir); });
  const unlink = fs.promises.unlink;
  const attempts = t.mock.method(fs.promises, "unlink", async (file) => {
    if (roots.includes(path.dirname(file))) throw Object.assign(new Error("Access denied"), { code: "EACCES" });
    return unlink(file);
  });
  try {
    assert.equal((await m.collectStorage()).failed, 2, JSON.stringify({ roots, unlinks: attempts.mock.calls.map((c) => c.arguments[0]) }));
    const count = attempts.mock.callCount();
    const opendir = fs.promises.opendir, scans = t.mock.method(fs.promises, "opendir", (...args) => opendir(...args));
    for (let i = 0; i < 3; i++) assert.equal((await m.collectStorage()).failed, 0);
    assert.equal(attempts.mock.callCount(), count);
    assert.equal(scans.mock.calls.filter((call) => roots.includes(call.arguments[0])).length, 0);
    const db = await m.database();
    for (const dir of roots) assert.equal(db.prepare("SELECT code FROM retention_failures WHERE path=?").get(dir).code, "EACCES");
    attempts.mock.restore();
    fs.rmSync(roots[1], { recursive: true }); // Manual removal, followed by a genuinely new repair operation.
    await m.temporaryStorage(roots[1], async () => { fs.writeFileSync(path.join(roots[1], "new-copy"), "new lifetime"); });
    assert.equal(fs.existsSync(roots[1]), false);
    assert.equal(db.prepare("SELECT 1 FROM retention_failures WHERE path=?").get(roots[1]), undefined);
  } finally { for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a pointer change waits for an older sweep then collects the newly unreferenced pack", async (t) => {
  await m.stopCleanup();
  const kb = path.join(out, "kb"), backups = path.join(out, "backups");
  const old = path.join(kb, "before-change"), current = path.join(kb, "after-change");
  for (const dir of [old, current, backups]) fs.mkdirSync(dir, { recursive: true });
  const pointer = path.join(kb, "current.json");
  fs.writeFileSync(pointer, JSON.stringify({ directory: "before-change", previous: "after-change" }));
  let resume, reached;
  const barrier = new Promise((resolve) => { resume = resolve; });
  const paused = new Promise((resolve) => { reached = resolve; });
  const opendir = fs.promises.opendir;
  let held = false, scans = 0;
  t.mock.method(fs.promises, "opendir", async (dir, ...args) => {
    if (dir === canonicalPath(kb)) scans++;
    if (dir === canonicalPath(backups) && !held) { held = true; reached(); await barrier; }
    return opendir(dir, ...args);
  });
  let first, second;
  try {
    first = m.collectStorage();
    await Promise.race([paused, first.then(() => { throw new Error("Sweep finished before reaching the controlled pointer-change boundary"); })]);
    fs.writeFileSync(pointer, JSON.stringify({ directory: "after-change", previous: null }));
    m.requestStorageCleanup();
    second = m.collectStorage(true);
    resume(); await second;
    assert.equal(fs.existsSync(old), false, "The old sweep already passed kb before the pointer changed");
    assert.equal(fs.existsSync(current), true);
    assert.equal(scans, 2, "One follow-up scan, not a retry loop");
  } finally {
    resume(); await first; if (second) await second;
    for (const dir of [kb, backups]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a claimed deletion refuses new users and a temporary repair workspace is removed on failure", async (t) => {
  const dir = path.join(out, "backups", "claimed"), file = path.join(dir, "copy");
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, "x");
  let entered, resume;
  const started = new Promise((r) => entered = r), pause = new Promise((r) => resume = r);
  const unlink = fs.promises.unlink;
  const canonicalFile = canonicalPath(file);
  t.mock.method(fs.promises, "unlink", async (name) => { if (name === canonicalFile) { entered(); await pause; } return unlink(name); });
  const removing = m.removeStorage(dir);
  try {
    await Promise.race([started, removing.then(() => assert.fail("Deletion completed without reaching the intended file gate"))]);
    await assert.rejects(m.storageGuard((db) => m.pinStorage(db, file)), { code: "RESOURCE_BUSY" });
  } finally { resume(); await removing; }
  assert.equal(fs.existsSync(dir), false);
  await assert.rejects(m.temporaryStorage(dir, async () => { fs.writeFileSync(file, "temporary"); throw new Error("repair failed"); }), /repair failed/);
  assert.equal(fs.existsSync(dir), false);
});

test("shutdown cancels pending deadlines and later writes cannot rearm cleanup", async () => {
  const db = await m.database();
  const item = await m.saveArtifact("finish shutdown first");
  const file = db.prepare("SELECT file FROM artifacts WHERE id=?").get(item.artifact_id).file;
  db.prepare("UPDATE artifacts SET created=0 WHERE id=?").run(item.artifact_id);
  m.scheduleCleanup();
  await m.stopCleanup();
  m.scheduleCleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(fs.existsSync(file));
});

test("managed deletion failures remain excluded in a fresh MCP process", async (t) => {
  const roots = [path.join(out, "kb", "restart-failed-pack"), path.join(out, "backups", "restart-failed-repair")];
  for (const dir of roots) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "blocked"), "manual cleanup only"); fs.utimesSync(dir, new Date(0), new Date(0)); }
  const canonical = roots.map(canonicalPath), unlink = fs.promises.unlink;
  const fault = t.mock.method(fs.promises, "unlink", (file) => canonical.includes(path.dirname(file))
    ? Promise.reject(Object.assign(new Error("Access denied"), { code: "EACCES" })) : unlink(file));
  assert.equal((await m.collectStorage()).failed, 2);
  fault.mock.restore();
  const removable = path.join(out, "kb", "restart-orphan");
  fs.mkdirSync(removable); fs.writeFileSync(path.join(removable, "data"), "remove");
  await m.stopCleanup(); m.closeDatabase();
  const client = connect({ DEVECO_STATE_DIR: out, DEVECO_CONFIG: path.join(out, "none.json") });
  try {
    await client.initialize();
    const started = Date.now();
    while (fs.existsSync(removable) && Date.now() - started < 5000) {
      await client.request("ping", {}, 1000);
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(fs.existsSync(removable), false);
    for (const dir of roots) assert.equal(fs.readFileSync(path.join(dir, "blocked"), "utf8"), "manual cleanup only");
    assert.doesNotMatch(client.stderr, /\[retention\]/);
  } finally { await client.close(); }
});
