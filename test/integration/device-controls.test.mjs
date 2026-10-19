// Platform command contracts with real argument construction and isolated transport replies.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const root = path.resolve(import.meta.dirname, "../.."), work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-controls-"));
const bundle = path.join(root, "node_modules/.cache/device-controls-test.mjs");
const f = globalThis.__controls = { calls: [], respond: () => ({ code: 0, stdout: "success", stderr: "" }) };
await build({ stdin: { contents: `export * from './src/domains/device-controls.ts'; export { install, validatePackages } from './src/domains/device.ts';`, resolveDir: root }, outfile: bundle,
  bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "error", plugins: [{ name: "transport", setup(b) {
    b.onResolve({ filter: /(?:proc|toolchain|ui)\.js$/ }, (a) => /domains\/(?:device|device-controls)\.ts$/.test(a.importer.replaceAll("\\", "/")) ? { path: path.basename(a.path, ".js"), namespace: "transport" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "transport" }, (a) => ({ contents: {
      proc: `export async function run(command,options){options.signal?.throwIfAborted();const f=globalThis.__controls;f.calls.push(command.args);return f.respond(command.args,options)}`,
      toolchain: `export function toolCommand(file,args){return {file,args}}`,
      ui: `export function invalidate(){} export async function displayControl(){return {rotation:0}} export async function dumpTree(){return []} export async function listWindows(){return []} export async function blankScreen(){return {blank:false}}`,
    }[a.path] }));
  } }] });
const m = await import(pathToFileURL(bundle).href), signal = new AbortController().signal;
after(() => { delete globalThis.__controls; fs.rmSync(bundle, { force: true }); fs.rmSync(work, { recursive: true, force: true }); });
function reply(stdout, code = 0, stderr = "") { return { code, stdout, stderr }; }
test("control operations reject ignored fields and unknown operations", () => {
  m.validateControl({ action: "app", operation: "start", bundle: "com.example.app", ability: "Main" });
  for (const input of [{ action: "app", operation: "stop", files: [] }, { action: "clipboard", operation: "read", text: "unused" }, { action: "system", operation: "time", value: 1 }, { action: "screen", operation: "clear_data" }]) {
    assert.throws(() => m.validateControl(input), { code: "INVALID_INPUT" });
  }
});
test("command errors and unavailable testhelper remain failures; clipboard content is data", async () => {
  f.respond = () => reply("", 127, "testhelper: not found");
  await assert.rejects(m.clipboard("target", "read", undefined, signal), { code: "CAPABILITY_UNAVAILABLE" });
  f.respond = () => reply("Error: permission denied");
  await assert.rejects(m.screenControl("target", "wake", undefined, signal), { code: "CAPABILITY_UNAVAILABLE" });
  f.respond = () => reply("Pasteboard text: Error: a copied diagnostic, not a command failure\n");
  assert.match((await m.clipboard("target", "read", undefined, signal)).text, /^Error:/);
  f.respond = () => reply("Pasteboard text:   first\nsecond \n\n");
  assert.equal((await m.clipboard("target", "read", undefined, signal)).text, "  first\nsecond \n");
  f.respond = () => ({ ...reply("incomplete"), truncated: true });
  await assert.rejects(m.clipboard("target", "read", undefined, signal), { code: "DEVICE_OUTPUT_INVALID" });
  let copied = "hi'; echo evil";
  f.respond = (args) => reply(args[3] === "testhelper get-pastedata" ? `Pasteboard text: ${copied}\n` : "success");
  assert.equal((await m.clipboard("target", "write", copied, signal)).content_verified, true);
  assert.deepEqual(f.calls.at(-2), ["-t", "target", "shell", "testhelper set-pastedata 'hi'\\''; echo evil'"]);
  copied = "first\nsecond";
  await m.clipboard("target", "write", copied, signal);
  assert.deepEqual(f.calls.at(-2), ["-t", "target", "shell", "testhelper set-pastedata 'first\nsecond'"]);
  await assert.rejects(m.clipboard("target", "clear", undefined, signal), { code: "DEVICE_OUTPUT_INVALID" });
});
test("file deletion does not swallow failure, retry or delete directories", async () => {
  f.calls = [];
  f.respond = (args) => args[3]?.startsWith("rm ") ? reply("", 1, "Permission denied") : reply("file");
  await assert.rejects(m.deviceFile("target", "delete", "/data/local/tmp/one file", signal), { code: "CAPABILITY_UNAVAILABLE" });
  assert.equal(f.calls.filter((a) => a[3]?.startsWith("rm ")).length, 1);
  f.respond = () => reply("directory");
  await assert.rejects(m.deviceFile("target", "delete", "/data/local/tmp", signal), { code: "INVALID_INPUT" });
  f.respond = () => reply("ls: file: No such file or directory", 1);
  assert.equal((await m.deviceFile("target", "exists", "/data/local/tmp/absent", signal)).exists, false);
  f.respond = () => reply("", 1, "Permission denied");
  await assert.rejects(m.deviceFile("target", "exists", "/protected/file", signal), { code: "CAPABILITY_UNAVAILABLE" });
});
test("start confirms only an accepted request; reset and implicit Want inputs are explicit", async () => {
  f.respond = () => reply("start ability successfully");
  const result = await m.appControl("target", { operation: "start", want: { uri: "demo://page?a='value'" } }, signal);
  assert.equal(result.runtime_verified, false);
  assert.ok(f.calls.at(-1)[3].includes(" -U "));
  await assert.rejects(m.appControl("target", { operation: "uninstall", bundle: "com.example.app" }, signal), { code: "DATA_RESET_REQUIRED" });
  await assert.rejects(m.appControl("target", { operation: "start", bundle: "bad;command", ability: "Main" }, signal), { code: "INVALID_INPUT" });
  f.respond = () => reply("unknown output");
  await assert.rejects(m.appControl("target", { operation: "start", bundle: "com.example.app", ability: "Main" }, signal), { code: "LAUNCH_FAILED" });
});
test("app queries reject malformed output and paginate bundle inventories", async () => {
  f.respond = () => reply("ID: 100:\n\tcom.example.one\n\tcom.example.two\n");
  const result = await m.appControl("target", { operation: "list", limit: 1 }, signal);
  assert.deepEqual(result.bundles, ["com.example.one"]); assert.equal(result.next_offset, 1);
  assert.deepEqual(m.parseForeground("Mission list:\nAbilityRecord ID #1\n  state #FOREGROUND\n  app name [com.example.app]\n  main name [Main]\n"), [{ bundle: "com.example.app", ability: "Main" }]);
  assert.throws(() => m.parseForeground("arbitrary garbage"), { code: "DEVICE_OUTPUT_INVALID" });
  assert.throws(() => m.parseBundleInfo("app: {broken"), { code: "DEVICE_OUTPUT_INVALID" });
});
test("system time rejects invalid dates before issuing any command; no automatic mutation retry", async () => {
  f.calls = []; f.respond = () => reply("success");
  await assert.rejects(m.systemControl("target", "time", "2026-02-30 10:00:00", signal), { code: "INVALID_INPUT" });
  assert.equal(f.calls.length, 0);
  f.respond = () => reply("Current State: SLEEP");
  assert.equal((await m.screenControl("target", "wake", undefined, signal)).verified, false);
  f.respond = () => reply('Get parameter "persist.ace.darkmode" fail! errNum is:1002!');
  await assert.rejects(m.screenControl("target", "viewmode", undefined, signal), { code: "CAPABILITY_UNAVAILABLE" });
  f.respond = () => reply("unexpected mode");
  await assert.rejects(m.screenControl("target", "viewmode", undefined, signal), { code: "CAPABILITY_UNAVAILABLE" });
  f.calls = []; f.respond = () => reply("Error: unsupported operation", 1);
  await assert.rejects(m.screenControl("target", "sleeptime", 60000, signal));
  assert.equal(f.calls.length, 1);
});
test("package install shares HAP/HSP staging and cleans it once on failure or cancellation", async () => {
  const hap = path.join(work, "a package.hap"), hsp = path.join(work, "shared.hsp");
  fs.writeFileSync(hap, "fixture"); fs.writeFileSync(hsp, "fixture");
  f.calls = []; f.respond = (args) => args[3] === "bm" ? reply("install bundle successfully.") : args[2] === "file" ? reply("FileTransfer finish") : reply("success");
  await m.install("target", [hap], signal, true, { shared: [hsp], user: 100, install_timeout: 180 });
  const install = f.calls.find((a) => a[3] === "bm");
  assert.ok(install.includes("-p") && install.includes("-s") && install.includes("-u") && install.includes("-w"));
  assert.equal(f.calls.filter((a) => a[3]?.startsWith("rm ")).length, 1);
  f.calls = []; const controller = new AbortController();
  f.respond = (args) => {
    if (args[2] === "file") { controller.abort(); throw new Error("transfer cancelled"); }
    return reply("success");
  };
  await assert.rejects(m.install("target", [hap], controller.signal, true, { shared: [hsp] }), /transfer cancelled/);
  assert.equal(f.calls.filter((a) => a[3]?.startsWith("rm ")).length, 1);
  f.calls = []; f.respond = (args) => args[3]?.startsWith("rm ") ? reply("", 1, "Permission denied") : args[2] === "file" ? reply("FileTransfer finish") : reply("install bundle successfully.");
  await assert.rejects(m.install("target", [hap], signal, true, { shared: [hsp] }), { code: "DEVICE_CLEANUP_FAILED" });
  assert.equal(f.calls.filter((a) => a[3]?.startsWith("rm ")).length, 1);
  assert.throws(() => m.validatePackages([hap, hap]), { code: "INVALID_INPUT" });
  assert.throws(() => m.validatePackages([hap], { install_timeout: 90 }), { code: "INVALID_INPUT" });
});


test("viewmode setter does not depend on a missing legacy parameter and accepts only exact idempotent receipt", async () => {
  f.calls = []; f.respond = args => args[3] === 'testhelper' ? reply('Set view mode to dark successfully.') : reply('Get parameter fail!', 1);
  const changed = await m.screenControl('target', 'viewmode', 'dark', signal);
  assert.equal(changed.command_confirmed, true); assert.equal(changed.state_verified, false);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].slice(3), ['testhelper', 'set-viewmode', 'dark']);
  f.respond = () => reply('Error: View mode is already set to light.', 1);
  const unchanged = await m.screenControl('target', 'viewmode', 'light', signal);
  assert.equal(unchanged.state_verified, true); assert.equal(unchanged.unchanged, true);
  await assert.rejects(m.screenControl('target', 'viewmode', 'dark', signal), { code: 'DEVICE_COMMAND_FAILED' });
  for (const output of ['Error: Service is not available.', 'success', 'Set view mode to dark successfully.\nError: failure']) {
    f.respond = () => reply(output); await assert.rejects(m.screenControl('target', 'viewmode', 'dark', signal), { code: 'DEVICE_COMMAND_FAILED' });
  }
});
