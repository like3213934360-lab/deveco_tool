import { temporaryDirectory } from "../support/workspace.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { zipFixture } from "../support/zip.mjs";

const root = path.resolve(import.meta.dirname, "../.."), work = temporaryDirectory("deveco-kba-");
process.env.DEVECO_STATE_DIR = path.join(work, "state"); process.env.DEVECO_CONFIG = path.join(work, "config.json"); fs.writeFileSync(process.env.DEVECO_CONFIG, "{}");
const fixture = globalThis.__devecoKbAtomic = { fail: false };
const bundle = path.join(work, "knowledge.mjs");
await build({ stdin: { contents: 'export * from "./src/domains/knowledge.ts"; export { closeDatabase } from "./src/core/db.ts"; export { stopCleanup } from "./src/core/artifacts.ts";', resolveDir: root }, outfile: bundle, bundle: true, format: "esm", platform: "node", logLevel: "error",
  define: { "import.meta.url": JSON.stringify(pathToFileURL(path.join(root, "src/core/config.ts")).href) },
  banner: { js: `import {createRequire as testRequire} from "node:module"; const require = testRequire(${JSON.stringify(path.join(root, "package.json"))});` },
  plugins: [{ name: "rename-fault", setup(b) {
  b.onResolve({ filter: /^node:fs$/ }, (a) => /(?:files|knowledge)\.ts$/.test(a.importer) ? { path: "fs", namespace: "fault" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fault" }, () => ({ contents: `import fs from 'node:fs';export default {...fs,renameSync:(a,b)=>{if(globalThis.__devecoKbAtomic.fail&&b.endsWith('current.json'))throw new Error('injected pointer failure');return fs.renameSync(a,b)}};` }));
} }] });
const m = await import(pathToFileURL(bundle).href);
after(async () => { await m.closeKnowledge(); await m.stopCleanup(); m.closeDatabase(); fs.rmSync(bundle, { force: true }); fs.rmSync(work, { recursive: true, force: true }); delete globalThis.__devecoKbAtomic; });
function pack(version, marker) {
  const dir = path.join(work, `src-${marker}`, "package"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, version, sources: {}, created_at: marker })); const db = new DatabaseSync(path.join(dir, "index.db"));
  db.exec("CREATE TABLE documents(id INTEGER PRIMARY KEY,document_id TEXT,catalog_id INTEGER,doc_title TEXT); CREATE TABLE segments(id INTEGER PRIMARY KEY,doc_id INTEGER,section_title TEXT,lead_text TEXT,search_text TEXT,excerpt_truncated INTEGER); CREATE VIRTUAL TABLE segments_fts USING fts5(search_text); CREATE TABLE vocab(term TEXT); ");
  db.prepare("INSERT INTO documents VALUES(1,'doc',0,?)").run(marker); db.close();
  fs.writeFileSync(path.join(dir, "docs.zip"), zipFixture({ "doc.md": marker }));
  const file = path.join(work, `.download-user-${marker}.tgz`); execFileSync("tar", ["-czf", file, "-C", path.dirname(dir), "package"]); return file;
}
test("same-version pointer failure preserves the active bytes and the caller's archive", async () => {
  const a = pack("1.0.0", "old"), b = pack("1.0.0", "new"), signal = new AbortController().signal;
  await m.update({ source: a }, signal); const old = m.activePack(), before = fs.readFileSync(path.join(work, "state/kb/current.json"));
  fixture.fail = true; await assert.rejects(m.update({ source: b, force: true }, signal), /injected pointer failure/); fixture.fail = false;
  assert.deepEqual(fs.readFileSync(path.join(work, "state/kb/current.json")), before); const saved = new DatabaseSync(path.join(old.dir, "index.db"), {readOnly:true}); try { assert.equal(saved.prepare("SELECT doc_title FROM documents").get().doc_title, "old"); } finally {saved.close();}
  assert.equal(fs.existsSync(a), true); assert.equal(fs.existsSync(b), true);
  await m.update({ source: b, force: true }, signal); assert.equal(m.activePack().manifest.created_at, "new");
  await m.rollback(); assert.equal(m.activePack().manifest.created_at, "old");
});
test("unsafe archive version cannot escape the KB directory or alter the active pack", async () => {
  const before = m.activePack().dir;
  await assert.rejects(m.update({ source: pack("../../escape", "escape") }, new AbortController().signal), (e) => e.code === "INVALID_INPUT");
  assert.equal(m.activePack().dir, before); assert.equal(fs.existsSync(path.join(work, "escape")), false);
});
test("interrupted and cancelled downloads close HTTP and leave no partial pack", async (t) => {
  let received, closed; const sent = new Promise((r) => received = r), disconnected = new Promise((r) => closed = r);
  const server = http.createServer((req, res) => { res.writeHead(200); res.write("partial archive"); if (req.url === "/broken") setTimeout(() => res.destroy(), 10); else { req.on("close", closed); received(); } });
  await new Promise((r) => server.listen(0, "127.0.0.1", r)); t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`, before = m.activePack().dir;
  await assert.rejects(m.update({ source: `${url}/broken` }, new AbortController().signal));
  const controller = new AbortController(), pending = m.update({ source: `${url}/hold` }, controller.signal); await sent; controller.abort(); await assert.rejects(pending);
  await Promise.race([disconnected, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("HTTP remained open")), 1500); timer.unref(); })]);
  assert.equal(m.activePack().dir, before); assert.deepEqual(fs.readdirSync(path.join(work, "state/kb")).filter((n) => n.startsWith(".")), []);
});
