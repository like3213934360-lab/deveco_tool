// Real emulator domain and child-process runner, with an isolated CLI; no device or image changes.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "../.."), work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-emulator-"));
const bundle = path.join(root, "node_modules/.cache/deveco-emulator.mjs"), cli = path.join(work, "emulator.cjs"), log = path.join(work, "calls.jsonl");
process.env.DEVECO_EMULATOR_CONFIG_DIR = work;
fs.mkdirSync(path.join(work, "Emulator1.0"));
fs.writeFileSync(path.join(work, "Emulator1.0/.emu_config"), "HarmonyOS_Software_Service_Agreement: agree\nHarmonyOS_SDK_Agreement: agree\n");
fs.writeFileSync(cli, `const fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(process.env.CLI_LOG,JSON.stringify(args)+'\\n');
  const response=JSON.parse(process.env.CLI_RESULTS)[args[0]];if(!response)throw new Error('unexpected CLI call '+args);
  process.stdout.write(response.stdout??'');process.stderr.write(response.stderr??'');
  if(response.signal)process.kill(process.pid,response.signal);else process.exitCode=response.code??0;`);
await build({ stdin: { contents: `export * from ${JSON.stringify(path.join(root, "src/domains/emulator.ts"))};`, resolveDir: root }, outfile: bundle,
  bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", plugins: [{ name: "emulator-cli", setup(b) {
    b.onResolve({ filter: /(?:device|toolchain)\.js$/ }, (a) => a.importer.replaceAll("\\", "/").endsWith("/domains/emulator.ts") ? { path: path.basename(a.path, ".js"), namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.path === "device"
      ? "export async function listTargets(){return []};export async function shell(){throw new Error('unexpected device call')}"
      : `export function toolCommand(_,args){return {file:process.execPath,args:[${JSON.stringify(cli)},...args],env:{...process.env,CLI_LOG:${JSON.stringify(log)},CLI_RESULTS:JSON.stringify(globalThis.__emulatorResults)}}}` }));
  } }] });
const m = await import(pathToFileURL(bundle).href);
const calls = () => fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
beforeEach(() => { fs.writeFileSync(log, ""); globalThis.__emulatorResults = { "-version": { stdout: "1.0.0" }, "-list": { stdout: "[]" } }; });
after(() => { fs.rmSync(bundle, { force: true }); fs.rmSync(work, { recursive: true, force: true }); delete globalThis.__emulatorResults; });

test("nonzero or signalled emulator exits fail even with empty or unfamiliar output", async () => {
  for (const response of [{ code: 7, stderr: "fatal: configuration unavailable" }, { code: 7 }, { signal: "SIGTERM" }]) {
    globalThis.__emulatorResults["-uninstall"] = response;
    await assert.rejects(m.removeImage("phone", "fixture"), (e) => {
      assert.equal(e.code, "EMULATOR_FAILED"); assert.ok(e.details.exit_code !== 0 || e.details.signal);
      assert.equal(e.details.output, response.stderr ?? "");
      if (response.code) assert.equal(e.details.exit_code, response.code);
      return true;
    });
  }
  assert.equal(calls().length, 3);
});

test("exit-zero SDK failures remain failures and explicit successful output is retained", async () => {
  globalThis.__emulatorResults["-uninstall"] = { stdout: "No images are available in the local environment." };
  await assert.rejects(m.removeImage("phone", "fixture"), { code: "NOT_FOUND" });
  globalThis.__emulatorResults["-create"] = { stdout: "Device create fail." };
  await assert.rejects(m.createEmulator({ name: "valid", device_type: "phone", os_version: "fixture" }), { code: "EMULATOR_FAILED" });
  globalThis.__emulatorResults["-uninstall"] = { stdout: "Image removed successfully." };
  assert.deepEqual(await m.removeImage("phone", "fixture"), { removed: "phone fixture", output: "Image removed successfully." });
});

test("metadata failures are not retried or ignored before stop and scenario errors cannot report accepted", async () => {
  globalThis.__emulatorResults["-list"] = { code: 8, stderr: "unavailable" };
  await assert.rejects(m.listEmulators(), { code: "EMULATOR_FAILED" });
  await assert.rejects(m.stopEmulator("owned"), { code: "EMULATOR_FAILED" });
  assert.deepEqual(calls(), [["-list", "-details"], ["-list", "-details"]]);
  globalThis.__emulatorResults["-instance"] = { code: 9 };
  await assert.rejects(m.scenario("owned", { action: "battery", level: 50 }), { code: "EMULATOR_FAILED" });
});

test("force install only tolerates a known missing prior image, not failed removal or cancellation", async () => {
  globalThis.__emulatorResults["-uninstall"] = { code: 7 };
  globalThis.__emulatorResults["-install"] = { stdout: "image is downloaded successfully." };
  await assert.rejects(m.installImage("phone", "fixture", new AbortController().signal, true), { code: "EMULATOR_FAILED" });
  assert.ok(calls().every((args) => args[0] !== "-install"));
  globalThis.__emulatorResults["-uninstall"] = { stdout: "No images are available in the local environment." };
  assert.equal((await m.installImage("phone", "fixture", new AbortController().signal, true)).installed, "phone fixture");
  const count = calls().length, cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(m.installImage("phone", "fixture", cancelled.signal, true)); assert.equal(calls().length, count);
});

test("create names follow the SDK character and length contract before any process or license operation", async () => {
  for (const name of ["", "   ", "bad-name", "bad/name", "name\n", "设备", "a".repeat(61)]) {
    await assert.rejects(m.createEmulator({ name, device_type: "phone", os_version: "fixture" }), { code: "INVALID_INPUT" });
  }
  assert.deepEqual(calls(), []);
  for (const name of ["A", "SDK Probe_+ 1", "a".repeat(60)]) assert.equal(m.createArgs({ name, device_type: "phone", os_version: "fixture" })[1], name);
});
