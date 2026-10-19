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
    ui: `import { setTimeout as delay } from 'node:timers/promises';
      export async function dumpTree(){return [{frame:globalThis.__devecoPerf.still?0:globalThis.__devecoPerf.gestures}]}
      export function treeSignature(nodes){return JSON.stringify(nodes)}
      export async function act(_t,_g,signal){
        const f=globalThis.__devecoPerf;signal.throwIfAborted();f.gestures++;
        if(!f.samplerStarted)throw new Error('sampling did not begin before gestures');
        if(f.failGesture)throw new Error('gesture failed');if(f.cancel)f.controller.abort();
        f.inGesture=true;
        try { if(f.gestureMs)await delay(f.gestureMs,undefined,{signal}); }
        finally { f.inGesture=false; }
        return {};
      }`,
    device: `export async function shell(_t,args,signal){
      const f=globalThis.__devecoPerf;signal.throwIfAborted();f.commands.push(args);
      const out={code:0,stdout:'',stderr:'',truncated:false,elapsedMs:1};
      if(args.includes('-profilerfps')){
        f.samplerStarted=true;
        if(f.waitSampler)await new Promise((r,j)=>signal.addEventListener('abort',()=>{f.samplerAborted=true;j(new Error('sampler aborted'))},{once:true}));
        return {...out,...f.profiler};
      }
      if(args[0].includes('fpsClear'))return {...out,...f.clear};
      if(args[0].includes('composer fps')){
        if(!f.baselineRead){f.baselineRead=true;return {...out,stdout:'999000000000',...f.baseline};}
        f.composerCalls++;if(f.inGesture)f.pollsDuringGestures++;
        return {...out,...(typeof f.composer==='function'?await f.composer(signal):f.composer)};
      }
      return {...out,stdout:'order:1 refreshrate=60'};
    }`,
  }[a.path] }));
} }] });
const m = await import(pathToFileURL(entry).href);
after(() => { fs.rmSync(work, { recursive: true, force: true }); delete globalThis.__devecoPerf; });
function reset(values = {}) {
  for (const k of Object.keys(f)) delete f[k];
  Object.assign(f, { commands: [], gestures: 0, composerCalls: 0, pollsDuringGestures: 0, profiler: { stdout: 'fps:0|1\nfps:0|2\n' }, composer: { stdout: 'RenderService fps unavailable' }, ...values });
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
test("valid frame timestamps alone do not prove scrolling occurred", async () => {
  const stdout = Array.from({ length: 61 }, (_, i) => String(Math.round(1e12 + i * 1e9 / 60))).join('\n');
  const r = await m.measureScroll('fixture', { repeat: 1 }, reset({ still: true, composer: { stdout } }));
  assert.equal(r.avg_fps, 60); assert.equal(r.activity_verified, false); assert.equal(r.verdict, 'inconclusive');
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
  assert.equal(r.verdict, 'inconclusive'); assert.equal(r.diagnostics.composer.zero_records, 6);
  assert.equal(r.diagnostics.composer.reason, 'all_zero_timestamps');
  assert.equal(r.diagnostics.profilerfps.reason, 'output_truncated');
});

test("long gestures cannot outrun the bounded frame history between composer reads", async () => {
  const started = Date.now();
  const signal = reset({ gestureMs: 3500, composer: () => {
    const last = Math.floor((Date.now() - started) * 120 / 1000);
    const first = Math.max(0, last - 383);
    return { stdout: Array.from({ length: last - first + 1 }, (_, i) => String(Math.round(1e12 + (first + i) * 1e9 / 120))).join('\n') };
  } });
  const r = await m.measureScroll('fixture', { repeat: 1 }, signal);
  assert.ok(f.pollsDuringGestures >= 5, 'sample while act() is awaiting the device');
  assert.equal(r.sampling.status, 'overlapping'); assert.deepEqual(r.sampling.gaps, []);
  assert.equal(r.verdict, 'smooth'); assert.deepEqual(r.excluded_intervals, []);
  assert.ok(r.frames >= 840, 'retain both full 3.5-second gestures, not only two 384-frame tails');
  const reads = f.artifact.captures.filter(c => c.command[0].includes('composer fps') && !c.command[0].includes('fpsClear'));
  assert.ok(reads.length < 15, 'bounded cadence, no busy loop');
  for (let i = 1; i < reads.length; i++) assert.ok(reads[i].started_ms >= reads[i - 1].finished_ms, 'no overlapping reads');
});

test("disjoint windows stay inconclusive even when the missing interval is below the long-gap threshold", async () => {
  const signal = reset({ composer: () => ({ stdout: Array.from({ length: 61 }, (_, i) => String(Math.round(1e12 + (f.composerCalls - 1) * 1.05e9 + i * 1e9 / 60))).join('\n') }) });
  const r = await m.measureScroll('fixture', { repeat: 1 }, signal);
  assert.equal(r.source, 'composer'); assert.deepEqual(r.excluded_intervals, []);
  assert.equal(r.sampling.status, 'gaps'); assert.equal(r.sampling.gaps[0].reason, 'non_overlapping_windows');
  assert.equal(r.verdict, 'inconclusive');
});

test("a composer read failure stops that sampler without retrying at the end", async () => {
  const stdout = Array.from({ length: 61 }, (_, i) => String(Math.round(1e12 + i * 1e9 / 60))).join('\n');
  const r = await m.measureScroll('fixture', { repeat: 1 }, reset({ gestureMs: 800, composer: () => f.composerCalls === 1 ? { stdout } : { code: 1, stderr: 'Permission denied' } }));
  assert.equal(f.composerCalls, 2); assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.diagnostics.composer.reason, 'permission_denied');
});

test("cancellation aborts an in-flight composer read and leaves no background polling", async () => {
  const controller = new AbortController();
  reset({ gestureMs: 3000, composer: async signal => {
    if (f.composerCalls === 1) return { stdout: 'The fps of screen [Id:0] is:\n' };
    await new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { f.composerAborted = true; reject(new Error('composer aborted')); }, { once: true });
      controller.abort();
    });
  } });
  await assert.rejects(m.measureScroll('fixture', { repeat: 1 }, controller.signal));
  assert.equal(f.composerAborted, true); assert.equal(f.composerCalls, 2); assert.equal(f.artifact, undefined);
});


test("timestamps resurfacing after successful clear cannot contaminate the current measurement", async () => {
  const fresh = Array.from({length: 61}, (_, i) => String(Math.round(2e12 + i * 1e9 / 60))).join('\n');
  const old = '1000000000000\n1000016666667';
  const result = await m.measureScroll('fixture', { repeat: 1 }, reset({ baseline: { stdout: old }, composer: { stdout: old + '\n' + fresh } }));
  assert.equal(result.verdict, 'smooth'); assert.equal(result.frames, 61);
  assert.equal(result.diagnostics.composer.boundary.stale_timestamps, 2);
  assert.deepEqual(result.excluded_intervals, []);
  assert.ok(f.artifact.captures.some(c => c.stdout === old + '\n' + fresh), 'raw history remains available');
});

test("unavailable watermark cannot turn an unbounded history into a quality verdict", async () => {
  const stdout = Array.from({length: 61}, (_, i) => String(Math.round(2e12 + i * 1e9 / 60))).join('\n');
  const result = await m.measureScroll('fixture', {repeat: 1}, reset({baseline: {code: 1, stderr: 'Permission denied'}, composer: {stdout}}));
  assert.equal(result.verdict, 'inconclusive');
  assert.equal(result.diagnostics.composer.boundary.error, 'permission_denied');
});

test("new long gaps remain inconclusive after old timestamps are removed", async () => {
  const frames = [...Array.from({length: 20}, (_, i) => 2e12 + i * 1e9 / 60), ...Array.from({length: 20}, (_, i) => 2e12 + 2e9 + i * 1e9 / 60)];
  const result = await m.measureScroll('fixture', {repeat: 1}, reset({baseline: {stdout: '1000000000000'}, composer: {stdout: frames.map(Math.round).join('\n')}}));
  assert.equal(result.verdict, 'inconclusive'); assert.equal(result.excluded_intervals.length, 1);
});


test("zero pre-run records do not prove subsequently returned timestamps are fresh", async () => {
  const stdout = Array.from({length: 61}, (_, i) => String(Math.round(2e12 + i * 1e9 / 60))).join('\n');
  const result = await m.measureScroll('fixture', {repeat: 1}, reset({baseline: {stdout: 'The fps of screen [Id:0] is:\n0\n0'}, composer: {stdout}}));
  assert.equal(result.verdict, 'inconclusive');
  assert.equal(result.diagnostics.composer.boundary.error, 'no_pre_run_timestamps');
});
