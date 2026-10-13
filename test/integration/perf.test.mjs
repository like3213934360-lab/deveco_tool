// FPS collection integration with isolated command evidence; no devices or runtime build required.
// Run: node --test test/integration/perf.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const root = path.resolve(import.meta.dirname, "../.."), work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-perf-"));
const f = globalThis.__devecoPerf = {};
const entry = path.join(work, "perf.mjs");
await build({ entryPoints: [path.join(root, "src/domains/perf.ts")], outfile: entry, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", plugins: [{ name: "commands", setup(b) {
  b.onResolve({ filter: /(?:ui|device|artifacts)\.js$/ }, (a) => /domains\/perf\.ts$/.test(a.importer.replaceAll("\\", "/")) ? { path: path.basename(a.path, ".js"), namespace: "fixture" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: {
    artifacts: `export async function saveArtifact(raw){globalThis.__devecoPerf.artifact=JSON.parse(raw);return {artifact_id:'diagnostic'}}`,
    ui: `export async function act(_t,_g,signal){const f=globalThis.__devecoPerf;signal.throwIfAborted();f.gestures++;if(!f.samplerStarted)throw new Error('sampling did not begin before gestures');if(f.failGesture)throw new Error('gesture failed');if(f.cancel)f.controller.abort()}`,
    device: `export async function shell(_t,args,signal){const f=globalThis.__devecoPerf;signal.throwIfAborted();f.commands.push(args);let out={code:0,stdout:'',stderr:'',truncated:false,elapsedMs:1};if(args.includes('-profilerfps')){f.samplerStarted=true;if(f.waitSampler)await new Promise((r,j)=>signal.addEventListener('abort',()=>{f.samplerAborted=true;j(new Error('sampler aborted'))},{once:true}));return {...out,...f.profiler}};if(args[0].includes('fpsClear'))return {...out,...f.clear};if(args[0].includes('composer fps'))return {...out,...f.composer};return {...out,stdout:'order:1 refreshrate=60'}}`,
  }[a.path] }));
} }] });
const m = await import(pathToFileURL(entry).href);
after(() => { fs.rmSync(work, { recursive: true, force: true }); delete globalThis.__devecoPerf; });
function reset(values = {}) {
  for (const k of Object.keys(f)) delete f[k];
  Object.assign(f, { commands: [], gestures: 0, profiler: { stdout: 'fps:0|1\nfps:0|2\n' }, composer: { stdout: 'RenderService fps unavailable' }, ...values });
  return new AbortController().signal;
}
test("empty/zero FPS is inconclusive with raw evidence, never a claim that the UI did not animate", async () => {
  const r = await m.measureScroll('fixture', { repeat: 1 }, reset());
  assert.equal(r.verdict, 'inconclusive'); assert.equal(r.source, 'none');
  assert.equal(r.diagnostics.profilerfps.valid_samples, 0); assert.equal(r.diagnostics.profilerfps.zero_samples, 2);
  assert.equal(r.diagnostics.profilerfps.reason, 'all_zero_samples');
  assert.equal(r.diagnostic_artifact, 'diagnostic'); assert.equal(f.gestures, 2);
  assert.ok(f.artifact.captures.some(c => c.stdout === 'fps:0|1\nfps:0|2\n' && c.code === 0));
  assert.doesNotMatch(r.note, /screen did not animate|nothing scrollable/);
});
test("profiler is sampled during the original gestures, never repeats them for fallback", async () => {
  const r = await m.measureScroll('fixture', { repeat: 2 }, reset({ profiler: { stdout: 'fps:60|1\nfps:0|2\nfps:30|3\n' } }));
  assert.equal(f.gestures, 4); assert.equal(r.gestures, 4); assert.equal(r.avg_fps, 45);
  assert.equal(r.verdict, 'fps_only'); assert.equal(r.diagnostics.profilerfps.zero_samples, 1);
});
test("valid composer frames preserve frame statistics and verdict", async () => {
  const stdout = Array.from({ length: 61 }, (_, i) => String(Math.round(1e12 + i * 1e9 / 60))).join('\n');
  const r = await m.measureScroll('fixture', { repeat: 1 }, reset({ composer: { stdout } }));
  assert.equal(r.source, 'composer'); assert.equal(r.verdict, 'smooth'); assert.equal(r.avg_fps, 60);
  assert.equal(r.frame_ms.p95, 16.67); assert.equal(f.gestures, 2);
});
test("permission/exit failures remain explicit and their raw streams are retained", async () => {
  const r = await m.measureScroll('fixture', { repeat: 1 }, reset({ composer: { code: 1, stderr: 'Permission denied' }, profiler: { code: 127, stderr: 'SP_daemon: command not found' } }));
  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.diagnostics.composer.reason, 'permission_denied');
  assert.equal(r.diagnostics.profilerfps.reason, 'unsupported_command');
  assert.ok(f.artifact.captures.some(c => c.code === 127 && c.stderr.includes('not found')));
});
test("failed clear prevents using stale composer timestamps as a successful measurement", async () => {
  const stdout = Array.from({ length: 61 }, (_, i) => String(Math.round(1e12 + i * 1e9 / 60))).join('\n');
  const r = await m.measureScroll('fixture', { repeat: 1 }, reset({ clear: { code: 1 }, composer: { stdout } }));
  assert.equal(r.verdict, 'inconclusive'); assert.equal(r.diagnostics.composer.reason, 'clear_failed');
});
test("gesture failure cancels the concurrent sampler and is not swallowed", async () => {
  const signal = reset({ failGesture: true, waitSampler: true });
  await assert.rejects(m.measureScroll('fixture', { repeat: 1 }, signal), /gesture failed/);
  assert.equal(f.samplerAborted, true); assert.equal(f.artifact, undefined);
});
test("caller cancellation cancels sampling and never emits a successful result", async () => {
  reset({ cancel: true, waitSampler: true }); f.controller = new AbortController();
  await assert.rejects(m.measureScroll('fixture', { repeat: 1 }, f.controller.signal));
  assert.equal(f.samplerAborted, true); assert.equal(f.artifact, undefined);
});


test("composer zero records and truncated profiler output remain diagnostic, not valid frame data", async () => {
  const r = await m.measureScroll('fixture', { repeat: 1 }, reset({ composer: { stdout: 'The fps of screen [Id:0] is:\n0\n0\n0\n' }, profiler: { stdout: 'fps:60|1', truncated: true } }));
  assert.equal(r.verdict, 'inconclusive'); assert.equal(r.diagnostics.composer.zero_records, 3);
  assert.equal(r.diagnostics.composer.reason, 'all_zero_timestamps');
  assert.equal(r.diagnostics.profilerfps.reason, 'output_truncated');
});
