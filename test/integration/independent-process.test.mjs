import { temporaryDirectory } from "../support/workspace.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { zipFixture } from "../support/zip.mjs";

const work = temporaryDirectory("deveco-independent-"), bundle = path.join(work, "proc.mjs");
await build({ stdin: { contents: `export * from ${JSON.stringify(path.resolve("src/core/proc.ts"))};export {extractZip as unzip} from ${JSON.stringify(path.resolve("src/core/unzip.ts"))};`, resolveDir: process.cwd() }, outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", nodePaths: [path.resolve("node_modules")] });
fs.symlinkSync(path.resolve("node_modules"), path.join(work, "node_modules"), "junction");
const { spawnIndependent, killAll, run, unzip } = await import(pathToFileURL(bundle).href);
after(() => fs.rmSync(work, { recursive: true, force: true }));

test("independent programs leave the host descendant tree and retain their exact arguments/output", async () => {
  const log = path.join(work, "program.log"), marker = "literal '$HOME' `echo no` 中文";
  const child = await spawnIndependent({ file: process.execPath, args: ["-e", "console.log(process.argv[1]);setInterval(()=>{},1000)", marker] }, log);
  try {
    await child.detach();
    killAll();
    assert.doesNotThrow(() => process.kill(child.pid, 0));
    if (process.platform !== "win32") {
      const rows = execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" }).trim().split("\n").map((s) => s.trim().split(/\s+/).map(Number));
      const parents = new Map(rows);
      for (let pid = child.pid; parents.has(pid); pid = parents.get(pid)) assert.notEqual(pid, process.pid, "host can still kill the independent descendant");
    }
    for (let i = 0; i < 100 && !fs.readFileSync(log, "utf8").includes(marker); i++) await delay(10);
    assert.equal(fs.readFileSync(log, "utf8").trim(), marker);
  } finally { process.kill(child.pid, "SIGTERM"); }
});

test("startup reports executable failure and nonzero exit without losing diagnostics", async () => {
  await assert.rejects(spawnIndependent({ file: path.join(work, "missing"), args: [] }), (e) => e.code === "PROCESS_FAILED" && /ENOENT/.test(e.message));
  const log = path.join(work, "failed.log");
  const child = await spawnIndependent({ file: process.execPath, args: ["-e", "console.error('startup refused');process.exit(7)"] }, log);
  try {
    for (let i = 0; i < 100 && child.exitCode === undefined; i++) await delay(10);
    assert.equal(child.exitCode, 7);
    assert.match(fs.readFileSync(log, "utf8"), /startup refused/);
  } finally { await child.detach(); }
});

test("timeout and cancellation kill descendants after the group leader exits", { skip: process.platform === "win32" ? "POSIX process-group behavior" : false, timeout: 15000 }, async () => {
  for (const cancel of [false, true]) {
    const pidFile = path.join(work, `descendant-${cancel}.pid`), controller = new AbortController();
    const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));console.log('descendant-ready');setInterval(()=>{},1000)`;
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)},process.argv[1]],{stdio:'inherit'});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)`;
    const start = Date.now();
    try {
      await assert.rejects(run({ file: process.execPath, args: ["-e", parent, pidFile] }, {
        signal: controller.signal, timeoutMs: cancel ? 10000 : 1500,
        onLine: (line) => { if (cancel && line.includes("descendant-ready")) controller.abort(new Error("cancelled fixture")); },
      }), (e) => cancel ? e.code === "CANCELLED" : e.code === "TIMEOUT");
      assert.ok(Date.now() - start < 6500, "stdio inherited by an orphan cannot hang run()");
      const pid = Number(fs.readFileSync(pidFile, "utf8"));
      const state = () => { try { return execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim(); } catch { return ""; } };
      for (let i = 0; i < 50 && state() && !state().startsWith("Z"); i++) await delay(20);
      assert.ok(!state() || state().startsWith("Z"), "owned descendant is no longer executing");
    } finally {
      if (fs.existsSync(pidFile)) { try { process.kill(Number(fs.readFileSync(pidFile)), "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; } }
    }
  }
});
test("ZIP entry mapping and output stream failures reject without crashing or leaving the archive open", async () => {
  const zip = path.join(work, "entries.zip"), destination = path.join(work, "extract");
  fs.writeFileSync(zip, zipFixture({ "valid.txt": "payload" }));
  const unsafe = path.join(work, "unsafe.zip"); fs.writeFileSync(unsafe, zipFixture({ "../escape.txt": "payload" }));
  await assert.rejects(unzip(unsafe, destination));
  assert.equal(fs.existsSync(path.join(work, "escape.txt")), false);
  fs.mkdirSync(path.join(destination, "valid.txt"), { recursive: true });
  await assert.rejects(unzip(zip, destination), /EISDIR|EPERM|EACCES/);
  fs.rmSync(path.join(destination, "valid.txt"), { recursive: true });
  assert.equal((await unzip(zip, destination)).length, 1);
  assert.equal(fs.readFileSync(path.join(destination, "valid.txt"), "utf8"), "payload");
});
