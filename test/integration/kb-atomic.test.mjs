import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "../.."), work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-kba-"));
process.env.DEVECO_STATE_DIR = path.join(work, "state"); process.env.DEVECO_CONFIG = path.join(work, "config.json"); fs.writeFileSync(process.env.DEVECO_CONFIG, "{}");
const fixture = globalThis.__devecoKbAtomic = { fail: false };
const bundle = path.join(root, "node_modules/.cache/deveco-kb-atomic.mjs");
await build({ entryPoints: [path.join(root, "src/domains/knowledge.ts")], outfile: bundle, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", plugins: [{ name: "rename-fault", setup(b) {
  b.onResolve({ filter: /^node:fs$/ }, (a) => /(?:files|knowledge)\.ts$/.test(a.importer) ? { path: "fs", namespace: "fault" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fault" }, () => ({ contents: `import fs from 'node:fs';export default {...fs,renameSync:(a,b)=>{if(globalThis.__devecoKbAtomic.fail&&b.endsWith('current.json'))throw new Error('injected pointer failure');return fs.renameSync(a,b)}};` }));
} }] });
const m = await import(pathToFileURL(bundle).href);
after(() => { m.closeKnowledge(); fs.rmSync(bundle, { force: true }); fs.rmSync(work, { recursive: true, force: true }); delete globalThis.__devecoKbAtomic; });
function pack(version, marker) {
  const dir = path.join(work, `src-${marker}`, "package"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema: 1, version, sources: {}, created_at: marker })); fs.writeFileSync(path.join(dir, "index.db"), marker);
  const file = path.join(work, `.download-user-${marker}.tgz`); execFileSync("tar", ["-czf", file, "-C", path.dirname(dir), "package"]); return file;
}
test("same-version pointer failure preserves the active bytes and the caller's archive", async () => {
  const a = pack("1.0.0", "old"), b = pack("1.0.0", "new"), signal = new AbortController().signal;
  await m.update({ source: a }, signal); const old = m.activePack(), before = fs.readFileSync(path.join(work, "state/kb/current.json"));
  fixture.fail = true; await assert.rejects(m.update({ source: b, force: true }, signal), /injected pointer failure/); fixture.fail = false;
  assert.deepEqual(fs.readFileSync(path.join(work, "state/kb/current.json")), before); assert.equal(fs.readFileSync(path.join(old.dir, "index.db"), "utf8"), "old");
  assert.equal(fs.existsSync(a), true); assert.equal(fs.existsSync(b), true);
  await m.update({ source: b, force: true }, signal); assert.equal(m.activePack().manifest.created_at, "new");
  m.rollback(); assert.equal(m.activePack().manifest.created_at, "old");
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
