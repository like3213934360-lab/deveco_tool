import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-independent-")), bundle = path.join(work, "proc.mjs");
await build({ entryPoints: [path.resolve("src/core/proc.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm" });
const { spawnIndependent, killAll } = await import(pathToFileURL(bundle).href);
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
