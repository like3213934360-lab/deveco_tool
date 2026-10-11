// Original 100-action / 20-deployment budgets on a dedicated app, with independent OS measurements.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { app } from "../support/acceptance.mjs";

test("device soak retains memory, process, descriptor and temporary-file budgets", async (t) => {
  assert.notEqual(process.platform, "win32", "Soak measurements require POSIX ps/lsof");
  const { call, client, job, target, project, bundle, ui, launch, receipt } = await app(t);
  const pid = String(client.child.pid), sizes = {};
  const sample = async () => {
    const hostFiles = fs.readdirSync(os.tmpdir()).filter((f) => /^(deveco-|upstream-|api-scan-|vis-|layout-)/.test(f)).sort();
    return {
      rss: Number(execFileSync("ps", ["-o", "rss=", "-p", pid], { encoding: "utf8" }).trim()) / 1024,
      children: execFileSync("ps", ["-axo", "ppid="], { encoding: "utf8" }).split("\n").filter((line) => line.trim() === pid).length,
      fds: execFileSync("lsof", ["-p", pid], { encoding: "utf8" }).trim().split("\n").length - 1,
      host: hostFiles.length, host_files: hostFiles,
      device: (await call("device", { action: "shell", target, command: "ls /data/local/tmp" })).output.split("\n").filter((f) => f.startsWith("deveco-")).length,
    };
  };
  await launch(); const start = await sample();
  for (let i = 0; i < 100; i++) {
    const data = await ui({ action: "act", op: "click", selector: { key: "TapBox" } });
    (sizes.act ??= []).push(JSON.stringify(data).length);
  }
  assert.equal((await ui({ action: "find", selector: { key: "TapBox" } })).matches[0].text, "taps:100");
  for (const action of ["observe", "tree", "find", "screenshot", "layout", "perf"]) {
    const data = await ui({ action, ...(action === "find" ? { selector: { key: "TapBox" } } : {}), ...(action === "perf" ? { bundle } : {}) });
    sizes[action] = [JSON.stringify(data).length];
  }
  for (let i = 0; i < 20; i++) sizes.deploy = [...(sizes.deploy ?? []), JSON.stringify(await job("run", { action: "build_run", project, target, wait: 0 })).length];
  const end = await sample(); receipt("soak.json", { start, end, sizes });
  await t.test("RSS growth stays below 60 MB", () => assert.ok(end.rss - start.rss < 60));
  await t.test("child process growth stays within three", () => assert.ok(end.children <= start.children + 3));
  await t.test("descriptor growth stays within twenty", () => assert.ok(end.fds <= start.fds + 20));
  await t.test("host temporary files do not grow", () => assert.ok(end.host <= start.host));
  await t.test("device temporary files do not grow", () => assert.ok(end.device <= start.device));
  await t.test("structured output stays within 8000 characters", () => assert.ok(Math.max(...Object.values(sizes).flat()) <= 8000));
});
