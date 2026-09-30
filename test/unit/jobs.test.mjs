import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Bundle a small harness that exercises the job runner directly (TS sources -> ESM).
const out = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-jobs-"));
process.on("exit", () => fs.rmSync(out, { recursive: true, force: true })); // tests leave nothing behind
process.env.DEVECO_STATE_DIR = out;
const harness = path.join(out, "harness.ts");
fs.writeFileSync(harness, `
export * from ${JSON.stringify(path.resolve("src/core/jobs.ts"))};
export * from ${JSON.stringify(path.resolve("src/core/artifacts.ts"))};
export * from ${JSON.stringify(path.resolve("src/core/db.ts"))};
export { ToolError } from ${JSON.stringify(path.resolve("src/core/errors.ts"))};
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
