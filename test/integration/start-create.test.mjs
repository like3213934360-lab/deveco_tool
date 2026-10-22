import { temporaryDirectory } from "../support/workspace.mjs";
// Real domains and schemas with a deterministic SDK fixture. Live SDK evidence is recorded separately.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import JSON5 from "json5";
import { after, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { zipFixture } from "../support/zip.mjs";

const root = path.resolve(import.meta.dirname, "../.."), work = temporaryDirectory("deveco-start-create-");
process.env.DEVECO_STATE_DIR = path.join(work, "state");
process.env.DEVECO_EMULATOR_CONFIG_DIR = work;
fs.mkdirSync(path.join(work, "Emulator1.0"));
fs.writeFileSync(path.join(work, "Emulator1.0/.emu_config"), "HarmonyOS_Software_Service_Agreement: agree\nHarmonyOS_SDK_Agreement: agree\n");
const bundle = path.join(work, "deveco-start-create.mjs");
const entry = ["domains/emulator", "domains/emulator-snapshot", "domains/project", "tools/extra", "tools/core", "core/errors", "core/db"].map((p) => `export * from ${JSON.stringify(path.join(root, `src/${p}.ts`))};`).join("\n");
await build({ stdin: { contents: entry, resolveDir: root }, outfile: bundle, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error",
  plugins: [{ name: "sdk", setup(b) {
    b.onResolve({ filter: /(?:device|proc|toolchain)\.js$|^node:timers\/promises$/ }, (a) => {
      const importer = a.importer.replaceAll("\\", "/");
      if (importer.endsWith("/domains/emulator.ts") || importer.endsWith("/domains/project.ts") && /(?:toolchain|proc)\.js$/.test(a.path))
        return { path: a.path === "node:timers/promises" ? "timers" : path.basename(a.path, ".js"), namespace: "fixture" };
    });
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: {
      toolchain: `export function toolCommand(name,args,cwd){return {file:name,args,cwd}};export function toolchain(){return {sdk:'fixture'}};export function sdkInfo(){return {platform_version:'26.0.0',api_level:26}};`,
      proc: `import fs from 'node:fs'; import path from 'node:path';
        export async function run(cmd,{signal,logFile}={}) {signal?.throwIfAborted();const f=globalThis.__startCreate;f.commands.push(cmd.args);
          if(cmd.file==='ohpm'||cmd.args.includes('--sync')||cmd.args.some(a=>/^assemble(?:Hap|Har|Hsp|App)$/.test(a))) {
            if(logFile)fs.writeFileSync(logFile,'BUILD SUCCESSFUL');
            if(cmd.args.some(a=>/^assemble(?:Hap|Har|Hsp|App)$/.test(a))){if(f.build)await f.build(cmd);else{const out=path.join(cmd.cwd,'entry/build/default/outputs/default');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'entry-default-unsigned.hap'),'fixture package');}}
            return {code:0,stdout:'BUILD SUCCESSFUL',stderr:'',elapsedMs:1};
          }
          if(cmd.args[0]==='-list')return {code:0,signal:null,stdout:f.raw??JSON.stringify(f.instances),stderr:''};
          if(cmd.args[0]==='-help')return {code:0,signal:null,stdout:f.help,stderr:''};if(cmd.args[0]==='-version')return {code:0,signal:null,stdout:'1.0.0',stderr:''};throw new Error('unexpected command '+cmd.args)};
        export async function spawnIndependent(cmd,log) {const f=globalThis.__startCreate;f.starts.push(cmd.args);f.logs.push(log);fs.writeFileSync(log,f.log);f.launched=true;f.onLaunch?.();
          if(f.spawnError)throw Object.assign(f.spawnError,{code:'PROCESS_FAILED'});return {exitCode:f.exit,async detach(){f.detached=true}}};`,
      device: `export async function listTargets(signal){signal?.throwIfAborted();const f=globalThis.__startCreate;return !f.launched&&!f.running?[]:Object.keys(f.targets)};
        export async function shell(target,args,signal){signal?.throwIfAborted();const f=globalThis.__startCreate;f.queries.push([target,args.at(-1)]);
          if(f.readError)throw f.readError;return {stdout:args.at(-1)==='ohos.qemu.hvd.name'?f.targets[target]??'':f.boot,stderr:'',code:f.readCode??0}};`,
      timers: `export async function setTimeout(_,v,{signal}){signal.throwIfAborted();const f=globalThis.__startCreate;await new Promise(r=>setImmediate(r));await f.tick(++f.polls);signal.throwIfAborted();return v}`,
    }[a.path] }));
  } }] });
const m = await import(pathToFileURL(bundle).href);
let f;
beforeEach(() => {
  f = globalThis.__startCreate = { commands: [], starts: [], queries: [], logs: [], launched: false, running: false, polls: 0,
    instances: [{ name: "owned", isRunning: "false", isHotBoot: "true" }],
    targets: { "127.0.0.1:15541": "owned" }, boot: "true", help: "-bootMode coldboot snapshot reset -hdcPort -noWindow", log: "",
    tick: (n) => { if (n > 5) throw new Error("fixture never reached a terminal state"); } };
});
after(async () => { await m.closeDatabase(); fs.rmSync(bundle, { force: true }); fs.rmSync(work, { recursive: true, force: true }); delete globalThis.__startCreate; });
const start = (options = {}, signal = new AbortController().signal) => m.startEmulator("owned", options, signal);
const moduleOf = (project) => JSON5.parse(fs.readFileSync(path.join(project, "entry/src/main/module.json5"), "utf8")).module;
const create = (name, rest = {}) => m.createProject({ project: path.join(work, name), app_name: "Test app", bundle_name: "com.example.test", ...rest });
const rejected = (code) => (error) => error.code === code;

test("build reports whether it synchronized separately from the reason", async () => {
  const made = await create('sync-result'), project = m.inspectProject(made.created);
  const first = await m.buildProject(project, {}, new AbortController().signal);
  assert.equal(first.synced, true); assert.equal(first.sync_reason, 'dependencies not installed');
  fs.mkdirSync(path.join(project.root, 'oh_modules'));
  const second = await m.buildProject(project, {}, new AbortController().signal);
  assert.equal(second.synced, false); assert.equal(second.sync_reason, undefined);
  const requested = await m.buildProject(project, {sync:true}, new AbortController().signal);
  assert.equal(requested.synced, true); assert.equal(requested.sync_reason, 'requested');
});

test("build regenerates packaging outputs instead of selecting an older signed package", async () => {
  const made = await create("package-generation"), project = m.inspectProject(made.created);
  const dir = path.join(project.root, "entry/build/default/outputs/default");
  fs.mkdirSync(dir, { recursive: true });
  const signed = path.join(dir, "entry-default-signed.hap"), unsigned = path.join(dir, "entry-default-unsigned.hap");
  const unrelated = path.join(dir, "compiler-cache.bin"); fs.writeFileSync(unrelated, "keep");
  const otherProduct = path.join(project.root, "entry/build/watch/outputs/default/watch-signed.hap");
  fs.mkdirSync(path.dirname(otherProduct), { recursive: true }); fs.writeFileSync(otherProduct, "keep watch");
  for (const signedTime of [10, 20, 30]) {
    fs.writeFileSync(signed, "old signed payload"); fs.utimesSync(signed, signedTime, signedTime);
    f.build = () => {
      assert.equal(fs.existsSync(signed), false, "old packages must be removed before the SDK runs");
      assert.equal(fs.existsSync(unsigned), false);
      fs.writeFileSync(unsigned, "current unsigned payload"); fs.utimesSync(unsigned, 20, 20);
    };
    const result = await m.buildProject(project, {}, new AbortController().signal);
    assert.deepEqual(result.artifacts.map((a) => a.path), [unsigned]);
    assert.equal(fs.readFileSync(result.artifacts[0].path, "utf8"), "current unsigned payload");
  }
  assert.equal(fs.readFileSync(unrelated, "utf8"), "keep");
  assert.equal(fs.readFileSync(otherProduct, "utf8"), "keep watch");
  f.build = () => {};
  await assert.rejects(m.buildProject(project, {}, new AbortController().signal), { code: "BUILD_FAILED" });
  assert.deepEqual(await m.buildOutputs(project), [], "a successful SDK exit with no output cannot reuse the previous package");
});

test("package generation covers APP/HSP/HAR, shared dependencies and missing module outputs", async () => {
  const made = await create("all-packages"), file = path.join(made.created, "build-profile.json5"), profile = JSON5.parse(fs.readFileSync(file, "utf8"));
  for (const [name, type] of [["feature", "feature"], ["library", "har"], ["shared", "shared"]]) {
    const dir = path.join(made.created, name, "src/main"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "module.json5"), JSON.stringify({ module: { name, type, deviceTypes: ["phone"] } }));
    profile.modules.push({ name, srcPath: `./${name}`, targets: [{ name: "default", applyToProducts: ["default"] }] });
  }
  fs.writeFileSync(file, JSON.stringify(profile)); const project = m.inspectProject(made.created);
  const hap = path.join(project.root, "entry/build/default/outputs/default/entry-unsigned.hap");
  const feature = path.join(project.root, "feature/build/default/outputs/default/feature-unsigned.hap");
  const hsp = path.join(project.root, "shared/build/default/outputs/default/shared-signed.hsp");
  const har = path.join(project.root, "library/build/default/outputs/default/library.har");
  const app = path.join(project.root, "build/outputs/default/app-signed.app");
  const put = (file, bytes = "obsolete") => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
  for (const [options, files] of [
    [{ modules: ["entry"] }, [hap, hsp]],
    [{ task: "assembleHsp" }, [hsp]], [{ task: "assembleHar" }, [har]], [{ task: "assembleApp" }, [app, hap, feature, hsp]],
  ]) {
    for (const file of files) put(file);
    f.build = () => { for (const file of files) { assert.equal(fs.existsSync(file), false, file); put(file, zipFixture({ "module.json": "current" })); } };
    const result = await m.buildProject(project, options, new AbortController().signal);
    assert.equal(result.success, true); assert.ok(result.artifacts.length);
    for (const artifact of result.artifacts) assert.equal(fs.readFileSync(artifact.path).includes(Buffer.from("obsolete")), false);
  }
  f.build = () => put(hap, "new entry only");
  await assert.rejects(m.buildProject(project, { modules: ["entry", "feature"] }, new AbortController().signal), (e) => e.code === "BUILD_FAILED" && e.details.missing.includes("feature"));
  const signed = hap.replace("unsigned", "signed");
  f.build = () => { for (const file of [hap, signed]) { put(file, zipFixture({ "module.json": "same generation" })); fs.utimesSync(file, 20, 20); } };
  assert.equal((await m.buildProject(project, { modules: ["entry"] }, new AbortController().signal)).artifacts[0].path, signed);
});

test("create writes the requested device types and preserves all other template fields", async () => {
  const template = JSON5.parse(fs.readFileSync(path.join(root, "templates/application/entry/src/main/module.json5"), "utf8")).module;
  const inputs = [undefined, ...["phone", "tablet", "2in1", "car", "wearable", "tv"].map((t) => [t]), ["tablet", "phone", "tablet"]];
  for (const [i, device_types] of inputs.entries()) {
    const result = await create(`project-${i}`, { device_types });
    const expected = [...new Set(device_types ?? ["phone"])];
    assert.deepEqual(result.device_types, expected);
    assert.deepEqual(moduleOf(result.created), { ...template, deviceTypes: expected });
    assert.equal(JSON5.parse(fs.readFileSync(path.join(result.created, "AppScope/app.json5"), "utf8")).app.bundleName, "com.example.test");
    assert.equal(JSON5.parse(fs.readFileSync(path.join(result.created, "AppScope/resources/base/element/string.json"), "utf8")).string[0].value, "Test app");
    assert.deepEqual(m.inspectProject(result.created).modules[0].deviceTypes, expected);
  }
});

test("invalid types and unavailable SDK mappings leave no project directory", async () => {
  for (const [i, device_types] of [[], ["foldable"], ["PHONE"], ["phone", "bad"]].entries()) {
    await assert.rejects(create(`invalid-${i}`, { device_types }), rejected("INVALID_INPUT"));
    assert.equal(fs.existsSync(path.join(work, `invalid-${i}`)), false);
  }
  await assert.rejects(create("bad-api", { target_api: 1 }), rejected("TOOLCHAIN_MISSING"));
  assert.equal(fs.existsSync(path.join(work, "bad-api")), false);
});

test("merge preserves user files; template conflicts are refused before any write", async () => {
  const dir = path.join(work, "merge"); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "user.txt"), "keep");
  await assert.rejects(create("merge"), rejected("CONFLICT"));
  await create("merge", { merge: true, device_types: ["wearable"] });
  assert.equal(fs.readFileSync(path.join(dir, "user.txt"), "utf8"), "keep");
  const conflict = path.join(work, "conflict");fs.mkdirSync(path.join(conflict, "entry/src/main"), { recursive: true });
  fs.writeFileSync(path.join(conflict, "entry/src/main/module.json5"), "owned by user");
  await assert.rejects(create("conflict", { merge: true, device_types: ["tv"] }), rejected("CONFLICT"));
  assert.equal(fs.existsSync(path.join(conflict, "AppScope")), false);
  assert.equal(fs.readFileSync(path.join(conflict, "entry/src/main/module.json5"), "utf8"), "owned by user");
});

test("start modes, legacy cold and port arguments are explicit, without a retry candidate", () => {
  assert.deepEqual(m.startArgs("owned", {}), ["-hvd", "owned"]);
  for (const boot_mode of ["coldboot", "snapshot", "reset"]) assert.deepEqual(m.startArgs("owned", { boot_mode }), ["-hvd", "owned", "-bootMode", boot_mode]);
  assert.deepEqual(m.startArgs("owned", { cold: true, boot_mode: "coldboot", window: false, hdc_port: 10000, instance_path: "/instances", image_root: "/images" }),
    ["-hvd", "owned", "-bootMode", "coldboot", "-hdcPort", "10000", "-noWindow", "-instancePath", "/instances", "-imageRoot", "/images"]);
  assert.deepEqual(m.startArgs("owned", { cold: false }), ["-hvd", "owned"]);
  for (const opts of [{ cold: true, boot_mode: "reset" }, { cold: false, boot_mode: "coldboot" }, { boot_mode: "bad" }, ...[9999, 16556, 12000.5, NaN].map((hdc_port) => ({ hdc_port }))])
    assert.throws(() => m.startArgs("owned", opts), rejected("INVALID_INPUT"));
  assert.doesNotThrow(() => m.startArgs("owned", { hdc_port: 16555 }));
});

test("batch and schema errors are rejected before any emulator operation", async () => {
  for (const args of [{ names: ["a", "b"], hdc_port: 12000 }, { name: "a", names: ["b"] }, { names: ["a", "a"] }, { names: ["a", " "] }])
    await assert.rejects(m.emulatorTool.handler({ action: "start", ...args }, { signal: new AbortController().signal }), rejected("INVALID_INPUT"));
  assert.deepEqual(f.commands, []); assert.deepEqual(f.starts, []);
  for (const types of [[], ["invalid"]]) assert.equal(m.projectTool.schema.safeParse({ action: "create", project: "/x", device_types: types }).success, false);
  assert.ok(m.projectTool.params.create.includes("device_types"));
  for (const param of ["boot_mode", "hdc_port"]) assert.ok(m.emulatorTool.params.start.includes(param));
});

test("only the named device counts; boot must complete, including an existing instance", async () => {
  f.targets = { "127.0.0.1:15541": "other" }; f.boot = "false";
  f.tick = (n) => { if (n === 1) f.targets["127.0.0.1:15542"] = "owned"; if (n === 3) f.boot = "true"; };
  const result = await start(); assert.equal(result.target, "127.0.0.1:15542"); assert.equal(result.boot_completed, true);assert.equal(f.polls, 3);
  assert.equal(f.starts.length, 1); assert.ok(f.logs.every((file) => !fs.existsSync(file)));
  f.running = true; f.boot = "false";f.polls = 0;f.starts.length = 0;
  f.tick = () => { f.boot = "true"; };
  assert.equal((await start()).already_running, true);assert.equal(f.polls, 1);assert.equal(f.starts.length, 0);
});

test("a running instance refuses settings, and ambiguous identities are never picked", async () => {
  f.running = true;
  for (const opts of [{ cold: true }, { boot_mode: "reset" }, { hdc_port: 15541 }, { window: false }, { window: true }, { instance_path: "/x" }, { image_root: "/x" }])
    await assert.rejects(start(opts), rejected("CONFLICT"));
  f.targets["127.0.0.1:15542"] = "owned";
  await assert.rejects(start(), rejected("CONFLICT"));assert.equal(f.starts.length, 0);
});

test("missing instances, unsupported SDKs and disabled Quick Boot fail without launching", async () => {
  f.raw = "old plain name list"; await assert.rejects(start(), rejected("CAPABILITY_UNAVAILABLE"));delete f.raw;
  f.raw = "[null]"; await assert.rejects(start(), rejected("CAPABILITY_UNAVAILABLE"));delete f.raw;
  f.instances = [];await assert.rejects(start(), rejected("NOT_FOUND"));
  f.instances = [{ name: "owned", isHotBoot: "false" }];await assert.rejects(start({ boot_mode: "snapshot" }), rejected("CAPABILITY_UNAVAILABLE"));
  f.help = "-start";await assert.rejects(start({ boot_mode: "reset" }), rejected("CAPABILITY_UNAVAILABLE"));
  await assert.rejects(start({ hdc_port: 15541 }), rejected("CAPABILITY_UNAVAILABLE"));assert.equal(f.starts.length, 0);
});

test("port conflicts leave the instance untouched; wrong actual port cannot report success", async () => {
  const server = net.createServer();
  // Pick a free port inside the SDK range; do not assume a fixed CI port is unused.
  let port;
  for (let candidate = 15541; candidate <= 16555; candidate++) {
    try { await new Promise((resolve, reject) => { server.once("error", reject);server.listen(candidate, "127.0.0.1", resolve); });port = candidate;break; }
    catch (e) { if (e.code !== "EADDRINUSE") throw e; }
  }
  assert.ok(port);
  try { await assert.rejects(start({ hdc_port: port }), rejected("CONFLICT"));assert.equal(f.starts.length, 0); }
  finally { await new Promise((r) => server.close(r)); }
  f.targets = { "127.0.0.1:9999": "owned" };
  await assert.rejects(start({ hdc_port: port }), rejected("CONFLICT"));assert.equal(f.starts.length, 1);
});

test("launcher failure (even exit 0), spawn error and nonzero exit retain diagnostics", async () => {
  for (const log of ["Unable to start", "Invalid command", "snapshot description changed, snapshot boot failed.", "could not use snapshot or default snapshot is not exist."]) {
    f.log = log;f.launched = false;f.targets = {};
    await assert.rejects(start(), (e) => e.code === "EMULATOR_FAILED" && e.details.log.startsWith(path.join(work, "state/artifacts")) && fs.readFileSync(e.details.log, "utf8") === log);
  }
  f.log = "";f.spawnError = new Error("ENOENT");await assert.rejects(start(), rejected("PROCESS_FAILED"));delete f.spawnError;
  f.exit = 2;await assert.rejects(start(), rejected("EMULATOR_FAILED"));
  assert.equal(new Set(f.logs).size, f.logs.length);
  for (const file of f.logs) fs.rmSync(file, { force: true });
});

test("cancellation and deadline never return success or restart/reset the VM", async (t) => {
  f.boot = "false";
  const cancelled = new AbortController();f.tick = () => cancelled.abort();
  await assert.rejects(start({}, cancelled.signal), (e) => e.code === "CANCELLED" && e.details.launched === true);
  assert.equal(f.starts.length, 1);
  const deadline = new AbortController();t.mock.method(AbortSignal, "timeout", () => deadline.signal);
  f.tick = () => deadline.abort();
  // The cancelled VM remains alive: waiting again must neither spawn nor claim readiness.
  await assert.rejects(start(), (e) => e.code === "TIMEOUT" && e.details.launched === false);
  assert.equal(f.starts.length, 1);
  for (const file of f.logs) fs.rmSync(file, { force: true });
});

test("HDC failures surface; disappearance is retried with identity checked again", async () => {
  f.readCode = 1; await assert.rejects(start(), rejected("PROCESS_FAILED")); delete f.readCode;
  f.readError = new m.ToolError("PROCESS_FAILED", "hdc failed");await assert.rejects(start(), rejected("PROCESS_FAILED"));
  f.readError = new m.ToolError("DEVICE_UNAVAILABLE", "disconnected");f.tick = () => { delete f.readError; };
  const result = await start();assert.equal(result.target, "127.0.0.1:15541");assert.equal(result.boot_completed, true);
  for (const file of f.logs) fs.rmSync(file, { force: true });
});

test("overlapping starts of the same instance cannot spawn twice", async () => {
  f.boot = "false";
  f.tick = async () => { await assert.rejects(start({ boot_mode: "reset" }), rejected("CONFLICT"));f.boot = "true"; };
  await start();assert.equal(f.starts.length, 1);
});

test("a reused HDC serial cannot certify the wrong instance as booted", async () => {
  f.boot = "false";
  f.tick = (n) => {
    f.boot = "true";
    f.targets["127.0.0.1:15541"] = "other";
    if (n === 2) f.targets["127.0.0.1:15542"] = "owned";
  };
  assert.equal((await start()).target, "127.0.0.1:15542");
  assert.equal(f.polls, 2); assert.equal(f.starts.length, 1);
});

function snapshotFixture(name, { tag = "emu-snapshot-default", state = 1024n, extra = 8 } = {}) {
  const instance = path.join(work, name); fs.mkdirSync(path.join(instance, "Log"), { recursive: true });
  const bytes = Buffer.alloc(256);
  bytes.writeUInt32BE(0x514649fb, 0); bytes.writeUInt32BE(3, 4);
  bytes.writeUInt32BE(1, 60); bytes.writeBigUInt64BE(80n, 64);
  bytes.writeUInt16BE(1, 92); bytes.writeUInt16BE(tag.length, 94); bytes.writeUInt32BE(extra, 116);
  if (extra >= 8) bytes.writeBigUInt64BE(state, 120); else bytes.writeUInt32BE(Number(state), 112);
  bytes.write("1" + tag, 120 + extra);
  fs.writeFileSync(path.join(instance, "ram.bin"), bytes);
  fs.writeFileSync(path.join(instance, "Log/qemu.log"), "load port from snapshot: 15541\n");
  return instance;
}

test("Quick Boot inspects bounded QCOW2 metadata, requiring named VM state", () => {
  assert.equal(m.hasBootSnapshot(path.join(work, "missing")), false);
  for (const [i, options] of [{}, { extra: 0 }, { tag: "other" }, { state: 0n }].entries()) {
    const instance = snapshotFixture(`format-${i}`, options);
    assert.equal(m.hasBootSnapshot(path.join(instance, "ram.bin")), i < 2);
  }
  const file = path.join(snapshotFixture("invalid-format"), "ram.bin");
  const valid = fs.readFileSync(file);
  for (const change of [b => b.writeUInt32BE(0, 0), b => b.writeUInt32BE(1025, 60), b => b.writeBigUInt64BE(9007199254740993n, 64), b => b.writeUInt32BE(0xffffffff, 116)]) {
    const bytes = Buffer.from(valid); change(bytes); fs.writeFileSync(file, bytes);
    assert.throws(() => m.hasBootSnapshot(file), rejected("CAPABILITY_UNAVAILABLE"));
  }
  fs.writeFileSync(file, valid.subarray(0, 70));
  assert.throws(() => m.hasBootSnapshot(file), rejected("CAPABILITY_UNAVAILABLE"));
});

test("snapshot evidence belongs to this launch and detects fallback across reads and log rotation", () => {
  const instance = snapshotFixture("snapshot-log"), log = path.join(instance, "Log/qemu.log");
  const restored = m.snapshotBoot(instance);
  assert.equal(restored(), false); // Historical success cannot certify a new launch.
  fs.appendFileSync(log, "load port from snap"); assert.equal(restored(), false);
  fs.appendFileSync(log, "shot: 15541\n"); assert.equal(restored(), true);
  fs.writeFileSync(log, "new log\n"); assert.equal(restored(), false);
  fs.appendFileSync(log, "could not use snap"); assert.equal(restored(), false);
  fs.appendFileSync(log, "shot or default snapshot is not exist.\n");
  assert.throws(restored, rejected("EMULATOR_FAILED"));
  const limited = m.snapshotBoot(instance); fs.appendFileSync(log, Buffer.alloc(4 * 1024 * 1024 + 1));
  assert.throws(limited, rejected("EFFECT_UNCERTAIN"));
});

test("snapshot start requires both saved state and fresh restore evidence, without coldboot retry", async () => {
  const instance = snapshotFixture("snapshot-start"), log = path.join(instance, "Log/qemu.log");
  f.instances[0].instancePath = instance;
  await assert.rejects(start({ boot_mode: "snapshot" }), rejected("EFFECT_UNCERTAIN"));
  f.launched = false; f.onLaunch = () => fs.appendFileSync(log, "could not use snapshot\n");
  await assert.rejects(start({ boot_mode: "snapshot" }), rejected("EMULATOR_FAILED"));
  f.launched = false; f.onLaunch = () => fs.appendFileSync(log, "load port from snapshot: 15541\n");
  assert.equal((await start({ boot_mode: "snapshot" })).boot_mode, "snapshot");
  assert.equal(f.starts.length, 3);
  assert.ok(f.starts.every(args => args.includes("snapshot") && !args.includes("coldboot")));
  f.launched = false; fs.rmSync(path.join(instance, "ram.bin"));
  await assert.rejects(start({ boot_mode: "snapshot" }), rejected("CAPABILITY_UNAVAILABLE"));
  assert.equal(f.starts.length, 3);
  for (const file of f.logs) fs.rmSync(file, { force: true });
});
