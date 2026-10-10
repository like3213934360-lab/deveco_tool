// Domain regression tests use an SDK fixture; real patch/UI acceptance is a separate E2E test.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "../.."), work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-hot-"));
process.env.DEVECO_STATE_DIR = path.join(work, "state");
const fixture = globalThis.__devecoHot = { stamp: "1:2", patch: 3000001, calls: [], fail: false, compile: 0 };
const output = path.join(root, "node_modules/.cache/deveco-hot.mjs");
await build({ entryPoints: [path.join(root, "src/domains/hotreload.ts")], outfile: output, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", plugins: [{ name: "sdk", setup(b) {
  b.onResolve({ filter: /(?:device|proc|toolchain)\.js$/ }, (a) => a.importer.replaceAll("\\", "/").endsWith("/domains/hotreload.ts") ? { path: path.basename(a.path, ".js"), namespace: "fixture" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: {
    toolchain: `export const toolCommand=()=>({});`,
    proc: `export async function run(){globalThis.__devecoHot.compile++;return {code:0,stdout:'',stderr:''}}`,
    device: `import fs from 'node:fs';const f=()=>globalThis.__devecoHot;
      export async function installStamp(){return f().stamp};export async function pidOf(){return 123};export async function hdc(){throw new Error('unexpected hdc')};
      export async function install(target,packages,signal,replace){signal.throwIfAborted();f().calls.push({target,packages:packages.map(p=>fs.readFileSync(p,'utf8')),replace});if(f().fail)throw new Error('install failed');f().patch=f().keepPatch?3000001:0;f().stamp='1:3'};
      export async function shell(target,args){f().calls.push({target,args});return {code:0,stdout:f().query??('bundle name: com.test.hot\\npatch version code: '+f().patch+'\\n'),stderr:''}};`,
  }[a.path] }));
} }] });
const m = await import(pathToFileURL(output).href);
after(() => { fs.rmSync(output, { force: true }); fs.rmSync(work, { recursive: true, force: true }); delete globalThis.__devecoHot; });
const signal = new AbortController().signal;
async function baseline() {
  Object.assign(fixture, { stamp: "1:2", patch: 3000001, calls: [], fail: false, compile: 0, keepPatch: false, query: undefined });
  const projectRoot = fs.mkdtempSync(path.join(work, "project-"));
  const project = { root: projectRoot, product: "default", bundleName: "com.test.hot", modules: [{ name: "entry", type: "entry", root: path.join(projectRoot, "entry"), target: "default" }] };
  const source = path.join(project.modules[0].root, "src/main/ets/Index.ets");
  fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, "original source");
  const packages = ["entry.hap", "shared.hsp"].map((name) => { const file = path.join(projectRoot, name); fs.writeFileSync(file, `original ${name}`); return { path: file, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }; });
  await m.recordBaseline(project, "entry", project.bundleName, "owned", signal, packages);
  const state = path.join(project.modules[0].root, "build/default/intermediates/deveco-mcp-hot.json");
  return { project, source, packages, state, read: () => JSON.parse(fs.readFileSync(state, "utf8")) };
}

test("reset restores immutable original HAP/HSP bytes, verifies patch zero and never rebuilds current edits", async () => {
  const b = await baseline();
  fs.writeFileSync(b.source, "edited source");
  for (const p of b.packages) fs.writeFileSync(p.path, "new build");
  const result = await m.resetHotReload(b.project, "entry", undefined, signal);
  assert.equal(result.reset, true); assert.equal(result.method, "restore_baseline_packages"); assert.equal(result.patch_version, 0);
  assert.deepEqual(fixture.calls, [{ target: "owned", packages: ["original entry.hap", "original shared.hsp"], replace: true }, { target: "owned", args: ["bm", "quickfix", "-q", "-b", "com.test.hot"] }]);
  assert.equal(fixture.compile, 1); assert.equal(fs.readFileSync(b.source, "utf8"), "edited source"); assert.equal(fs.existsSync(b.state), false);
});

test("legacy, wrong-target, replaced-app, changed and missing packages fail before installation", async () => {
  for (const mode of ["legacy", "target", "stamp", "changed", "missing", "directory"]) {
    const b = await baseline(), data = b.read();
    if (mode === "legacy") { delete data.restore; fs.writeFileSync(b.state, JSON.stringify(data)); }
    if (mode === "stamp") fixture.stamp = "1:99";
    if (mode === "directory") { data.restore.directory = "."; fs.writeFileSync(b.state, JSON.stringify(data)); }
    if (["changed", "missing"].includes(mode)) {
      const file = path.join(path.dirname(b.state), data.restore.directory, data.restore.packages[0].file);
      if (mode === "changed") fs.writeFileSync(file, "corrupt"); else fs.rmSync(file);
    }
    await assert.rejects(m.resetHotReload(b.project, "entry", mode === "target" ? "other" : undefined, signal), (e) => ["NOT_FOUND", "CONFLICT"].includes(e.code));
    assert.equal(fixture.calls.length, 0, mode); assert.ok(fs.existsSync(b.state), mode);
  }
});

test("installation failure, unchanged patch and unparseable verification retain the baseline", async () => {
  for (const mode of ["install", "patch", "query"]) {
    const b = await baseline();
    fixture.fail = mode === "install"; fixture.keepPatch = mode === "patch"; fixture.query = mode === "query" ? "error: query failed\npatch version code: 0" : undefined;
    await assert.rejects(m.resetHotReload(b.project, "entry", undefined, signal));
    assert.ok(fs.existsSync(b.state)); assert.ok(fs.existsSync(path.join(path.dirname(b.state), b.read().restore.directory)));
    assert.equal(fixture.calls.filter((c) => c.packages).length, 1); assert.equal(fixture.compile, 1);
  }
});

test("cancelled reset preserves original archive and issues no device mutation", async () => {
  const b = await baseline(), controller = new AbortController(); controller.abort();
  await assert.rejects(m.resetHotReload(b.project, "entry", undefined, controller.signal));
  assert.equal(fixture.calls.length, 0); assert.ok(fs.existsSync(b.state));
});


test("a package changed since installation cannot replace an existing baseline", async () => {
  const b = await baseline(), previous = fs.readFileSync(b.state, "utf8");
  fs.writeFileSync(b.packages[0].path, "changed after install");
  await assert.rejects(m.recordBaseline(b.project, "entry", "com.test.hot", "owned", signal, b.packages), (e) => e.code === "CONFLICT");
  assert.equal(fs.readFileSync(b.state, "utf8"), previous);
  assert.equal(fs.readdirSync(path.dirname(b.state)).filter((n) => n.startsWith("deveco-mcp-baseline-")).length, 1);
  assert.equal(fixture.compile, 1);
});
