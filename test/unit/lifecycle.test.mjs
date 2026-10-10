// Actual domains with an isolated SDK fixture. These checks do not claim real media playback.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const root = path.resolve(import.meta.dirname, "../.."), work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-lifecycle-"));
process.env.DEVECO_STATE_DIR = work;
const box = (type, text) => { const b = Buffer.alloc(8 + text.length); b.writeUInt32BE(b.length); b.write(type, 4); b.write(text, 8); return b; };
const fixture = globalThis.__devecoLifecycle = { active: false, recorder: 1, toggles: 0, mode: "ok", removed: [], cli: [], running: true, stopping: false, polls: 0, video: Buffer.concat([box("ftyp", "isom"), box("mdat", "samples"), box("moov", "vide")]) };
const bundle = path.join(root, "node_modules/.cache/deveco-lifecycle.mjs");
await build({ stdin: { contents: `export * from ${JSON.stringify(path.join(root, "src/domains/ui.ts"))};export * from ${JSON.stringify(path.join(root, "src/domains/emulator.ts"))};export {closeDatabase} from ${JSON.stringify(path.join(root, "src/core/db.ts"))};`, resolveDir: root }, outfile: bundle,
  bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", plugins: [{ name: "sdk", setup(b) {
    b.onResolve({ filter: /(?:device|proc|toolchain)\.js$/ }, (a) => /domains\/(?:ui|emulator)\.ts$/.test(a.importer.replaceAll("\\", "/")) ? { path: path.basename(a.path, ".js"), namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: {
      toolchain: `export function toolCommand(_name,args){return {file:'fixture',args}};`,
      proc: `export function spawnIndependent(){throw new Error('unexpected start')};export async function run(cmd){const f=globalThis.__devecoLifecycle;f.cli.push(cmd.args);if(cmd.args[0]==='-stop'){f.stopping=true;return {stdout:'Stop emulator owned successfully',stderr:''}};if(cmd.args[0]==='-list'){if(f.stopping&&++f.polls>=3)f.running=false;return {stdout:JSON.stringify([{name:'owned',isRunning:String(f.running),'hw.ramSize':'4096'}]),stderr:''}};throw new Error('unexpected mutation '+cmd.args)};`,
      device: `import fs from 'node:fs';const f=()=>globalThis.__devecoLifecycle;export async function listTargets(){return []};export async function assertConnected(){};export async function hdc(args){fs.writeFileSync(args.at(-1),f().video);return {stdout:'',stderr:'',code:0}};export async function shell(_t,args,signal){
        if(args[0]==='rm'){f().removed.push({path:args.at(-1),aborted:signal?.aborted});if(f().cleanupFail)return {stdout:'Permission denied',stderr:'',code:1};return {stdout:'',stderr:'',code:0}};
        signal?.throwIfAborted();if(args[0]==='aa'&&args[1]==='dump')return {stdout:f().dump??('ExtensionRecords:\\n'+(f().active?'uri [/com.huawei.hmos.screenrecorder/entry/ServiceExtAbility]\\nAbilityRecord ID #'+f().recorder+' state #ACTIVE start time [123]':'')),stderr:'',code:0};
        if(args[0]==='aa'){f().toggles++;if(!f().noStart)f().active=!f().active;if(f().toggleCancel){f().controller.abort();signal.throwIfAborted()};return {stdout:'start ability success',stderr:'',code:0}};
        if(args[0]==='mediatool'&&args[1]==='query')return {stdout:'find 1 result\\n"file://media/fixture"',stderr:'',code:0};
        if(args[0]==='mediatool'&&args[1]==='recv'){if(f().mode==='source')return {stdout:'[FAIL] open source media file failed',stderr:'',code:0};if(f().mode==='cancel'){f().controller.abort();signal.throwIfAborted()};return {stdout:args.at(-1),stderr:'',code:0}};throw new Error('unexpected shell '+args)};`,
    }[a.path] }));
  } }] });
const m = await import(pathToFileURL(bundle).href);
after(async () => { await m.closeDatabase(); fs.rmSync(bundle, { force: true }); fs.rmSync(work, { recursive: true, force: true }); delete globalThis.__devecoLifecycle; });
test("force overwrite and deletion of a running instance issue no SDK mutation", async () => {
  const before = fixture.cli.length;
  await assert.rejects(m.createEmulator({ name: "owned", device_type: "phone", os_version: "HarmonyOS 7.0.0(26)", memory: 8, force: true }), (e) => e.code === "CAPABILITY_UNAVAILABLE");
  await assert.rejects(m.deleteEmulator("owned"), (e) => e.code === "CONFLICT");
  assert.ok(fixture.cli.slice(before).every((a) => a[0] === "-list"));
});
test("stop waits through closing states before reporting completion", async () => {
  const r = await m.stopEmulator("owned"); assert.equal(r.stopped, "owned"); assert.ok(fixture.polls >= 4); assert.equal(fixture.running, false);
});
test("failed media export retains its session, prevents overwrite and cleans owned staging", async () => {
  const started = await m.startRecording("fixture"); fixture.mode = "source";
  await assert.rejects(m.stopRecording("fixture"), (e) => e.code === "UI_RECORD_FAILED" && /open source media file failed/.test(e.message));
  assert.equal((await m.recordingStatus("fixture")).file, started.file);
  await assert.rejects(m.startRecording("fixture"), (e) => e.code === "CONFLICT");
  assert.ok(fixture.removed.some((r) => r.path.endsWith(started.file)));
  fixture.mode = "ok"; const saved = await m.stopRecording("fixture"); assert.equal(saved.bytes, fixture.video.length); assert.equal((await m.recordingStatus("fixture")).file, undefined);
});
test("cancelled media export retains the receipt and cleanup uses an independent signal", async () => {
  const started = await m.startRecording("fixture"); fixture.mode = "cancel"; fixture.controller = new AbortController();
  await assert.rejects(m.stopRecording("fixture", {}, fixture.controller.signal));
  assert.equal((await m.recordingStatus("fixture")).file, started.file);
  assert.ok(fixture.removed.some((r) => r.path.endsWith(started.file) && !r.aborted));
  fixture.mode = "ok"; await m.stopRecording("fixture", { discard: true }); assert.equal((await m.recordingStatus("fixture")).file, undefined);
});


test("recorder state rejects unknown and truncated dumps, identifies exact service instances", () => {
  assert.equal(m.recorderInstance("ExtensionRecords:"), undefined);
  assert.equal(m.recorderInstance("ExtensionRecords:\nuri [/com.other/entry/ServiceExtAbility]\nAbilityRecord ID #2 state #ACTIVE start time [9]"), undefined);
  assert.equal(m.recorderInstance("ExtensionRecords:\nuri [/com.huawei.hmos.screenrecorder/entry/ServiceExtAbility]\nAbilityRecord ID #2 state #ACTIVE start time [9]"), "2:9");
  for (const text of ["", "[Fail] disconnected", "AbilityRecord ID #1", "ExtensionRecords:\nuri [/truncated", "ExtensionRecords:\nuri [/com.huawei.hmos.screenrecorder/entry/ServiceExtAbility]"])
    assert.throws(() => m.recorderInstance(text), (e) => e.code === "UI_RECORD_FAILED");
});

test("media lookup distinguishes no match, unique match, ambiguity and command failures", () => {
  assert.equal(m.recordingUri("find 0 result"), undefined);
  assert.equal(m.recordingUri('find 1 result\n"file://media/one"'), "file://media/one");
  for (const text of ['find 2 result\n"file://media/one"\n"file://media/two"', 'find 1 result', '[FAIL] query failed', 'find 0 result\n"file://media/one"'])
    assert.throws(() => m.recordingUri(text));
});

test("a different active recorder is never toggled by the old pending export", async () => {
  const started = await m.startRecording("fixture"), before = fixture.toggles;
  fixture.recorder++;
  assert.equal((await m.recordingStatus("fixture")).status, "busy");
  await assert.rejects(m.stopRecording("fixture"), (e) => e.code === "CONFLICT");
  assert.equal(fixture.toggles, before); assert.equal((await m.recordingStatus("fixture")).file, started.file);
  fixture.active = false; await m.stopRecording("fixture", { discard: true });
});

test("cancellation after a delivered stop never toggles the recorder back on", async () => {
  await m.startRecording("fixture"); fixture.controller = new AbortController(); fixture.toggleCancel = true;
  await assert.rejects(m.stopRecording("fixture", {}, fixture.controller.signal));
  const before = fixture.toggles;
  fixture.toggleCancel = false; fixture.mode = "ok";
  const saved = await m.stopRecording("fixture");
  assert.equal(saved.bytes, fixture.video.length); assert.equal(fixture.toggles, before); assert.equal(fixture.active, false);
});

test("zero-byte and unfinished videos retain the session and never become artifacts", async () => {
  const video = fixture.video;
  for (const bad of [Buffer.alloc(0), box("ftyp", "isom")]) {
    const started = await m.startRecording("fixture"); fixture.video = bad;
    await assert.rejects(m.stopRecording("fixture"), (e) => e.code === "UI_RECORD_FAILED");
    assert.equal((await m.recordingStatus("fixture")).file, started.file);
    await m.stopRecording("fixture", { discard: true });
  }
  fixture.video = video;
});


test("accepted start without an ACTIVE service is a failure with a retained receipt", async () => {
  fixture.noStart = true; const before = fixture.toggles;
  await assert.rejects(m.startRecording("fixture"), (e) => e.code === "UI_RECORD_FAILED" && /no recorder service/.test(e.message));
  assert.equal(fixture.toggles, before + 1); assert.equal((await m.recordingStatus("fixture")).status, "idle");
  assert.ok((await m.recordingStatus("fixture")).file);
  await assert.rejects(m.startRecording("fixture"), (e) => e.code === "CONFLICT");
  fixture.noStart = false; await m.stopRecording("fixture", { discard: true });
});


test("export and staging cleanup failures are both reported without losing the receipt", async () => {
  const started = await m.startRecording("fixture"); fixture.mode = "source"; fixture.cleanupFail = true;
  await assert.rejects(m.stopRecording("fixture"), (e) => e.code === "UI_RECORD_FAILED" && /open source/.test(e.details.export.message) && /staging/.test(e.details.cleanup.message));
  assert.equal((await m.recordingStatus("fixture")).file, started.file);
  fixture.cleanupFail = false; fixture.mode = "ok"; await m.stopRecording("fixture", { discard: true });
});
