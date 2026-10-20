// Reversible configuration selection and real SQLite/process interruption; no SDK or cloud.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import JSON5 from "json5";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "../..");
fs.mkdirSync(path.join(root, ".scratch"), { recursive: true });
const work = fs.mkdtempSync(path.join(root, ".scratch/build-signing-test-"));
process.env.DEVECO_STATE_DIR = path.join(work, "state");
const bundle = path.join(work, "harness.mjs");
await build({ stdin: { contents: "export * from './src/domains/build-signing.ts'; export * from './src/core/db.ts';", resolveDir: root },
  outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "error" });
const m = await import(pathToFileURL(bundle).href);
after(() => { m.closeDatabase(); fs.rmSync(work, { recursive: true }); });
const signal = new AbortController().signal;
function project(reference = true) {
  const dir = fs.mkdtempSync(path.join(work, "project-")), file = path.join(dir, "build-profile.json5");
  const source = "{ // preserve comments, formatting, quotes and other products\n app:{ products:[{name:'phone', " + (reference ? "signingConfig:'debug'," : "") +
    "metadata:{name:'signingConfig'}},{name:'watch', signingConfig:'watch'}], signingConfigs:[{name:'debug',material:{storePassword:'PRIVATE_PASSWORD_DO_NOT_STORE'}},{name:'release'},{name:'watch'}] }\n}\n";
  fs.writeFileSync(file, source, { mode: 0o600 });
  return { dir, file, source };
}
const selection = p => JSON5.parse(fs.readFileSync(p.file, "utf8")).app.products[0].signingConfig;

test("per-build signing selects the named existing configuration and restores exact source on success/failure/cancellation", async () => {
  for (const reference of [true, false]) for (const outcome of ["success", "failure", "cancel"]) {
    const p = project(reference), controller = new AbortController();
    const run = () => m.withBuildSigning(p.dir, "phone", "release", controller.signal, async () => {
      assert.equal(selection(p), "release");
      assert.equal(JSON5.parse(fs.readFileSync(p.file, "utf8")).app.products[1].signingConfig, "watch");
      const receipts = await m.kvEntries("build-signing:");
      assert.equal(receipts.length, 1); assert.ok(!receipts[0].value.includes("PRIVATE_PASSWORD_DO_NOT_STORE"));
      if (outcome === "failure") throw new Error("compiler failure");
      if (outcome === "cancel") { controller.abort(); controller.signal.throwIfAborted(); }
      return { success: true };
    });
    if (outcome === "success") assert.deepEqual(await run(), { success: true, signing_config: "release", signing_config_restored: true });
    else await assert.rejects(run(), outcome === "failure" ? /compiler failure/ : { name: "AbortError" });
    assert.equal(fs.readFileSync(p.file, "utf8"), p.source);
    if (process.platform !== "win32") assert.equal(fs.statSync(p.file).mode & 0o777, 0o600);
    assert.deepEqual(await m.kvEntries("build-signing:"), []);
  }
});

test("unknown signing configuration or product runs no compiler and changes no configuration", async () => {
  const p = project(); let calls = 0;
  for (const [product, config, code] of [["phone", "missing", "SIGN_CONFIG_MISSING"], ["unknown", "release", "PROJECT_INVALID"]])
    await assert.rejects(m.withBuildSigning(p.dir, product, config, signal, async () => { calls++; return {}; }), { code });
  assert.equal(calls, 0); assert.equal(fs.readFileSync(p.file, "utf8"), p.source);
  const invalid = p.source.replace("signingConfig:'debug'", "signingConfig:{password:'MUST_NOT_STORE'}");
  fs.writeFileSync(p.file, invalid);
  await assert.rejects(m.withBuildSigning(p.dir, "phone", "release", signal, async () => { calls++; return {}; }), { code: "PROJECT_INVALID" });
  assert.equal(calls, 0); assert.equal(fs.readFileSync(p.file, "utf8"), invalid);
  assert.deepEqual(await m.kvEntries("build-signing:"), []);
});

test("concurrent configuration edits are preserved and recovery remains explicit", async () => {
  const p = project(); let concurrent;
  await assert.rejects(m.withBuildSigning(p.dir, "phone", "release", signal, async () => {
    concurrent = fs.readFileSync(p.file, "utf8") + "// concurrent edit\n"; fs.writeFileSync(p.file, concurrent); return {};
  }), { code: "SIGN_CONFIG_RESTORE_CONFLICT" });
  assert.equal(fs.readFileSync(p.file, "utf8"), concurrent);
  await assert.rejects(m.withBuildSigning(p.dir, "phone", undefined, signal, async () => ({})), { code: "SIGN_CONFIG_RESTORE_CONFLICT" });
  fs.writeFileSync(p.file, p.source); // Caller reconciles only this test-owned file.
  await m.withBuildSigning(p.dir, "phone", undefined, signal, async () => ({}));
  assert.deepEqual(await m.kvEntries("build-signing:"), []);
});

test("an abrupt process exit restores its minimal receipt before the next ordinary build", async () => {
  const p = project();
  const code = "const m=await import(" + JSON.stringify(pathToFileURL(bundle).href) + "); await m.withBuildSigning(" +
    JSON.stringify(p.dir) + ",'phone','release',new AbortController().signal,async()=>{console.log('selected');setInterval(()=>{},1000);await new Promise(()=>{});});";
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await once(child.stdout, "data");
    assert.equal(selection(p), "release");
    child.kill("SIGKILL"); await once(child, "exit");
    await m.withBuildSigning(p.dir, "phone", undefined, signal, async () => { assert.equal(fs.readFileSync(p.file, "utf8"), p.source); return {}; });
    assert.equal(fs.readFileSync(p.file, "utf8"), p.source); assert.deepEqual(await m.kvEntries("build-signing:"), []);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});
