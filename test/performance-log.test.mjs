import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createPerformanceLogger } from "../src/performance-log.mjs";
import { measureUiOperation, measureUiStage } from "../src/ui-performance.mjs";

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-metrics-中文 空格-"));
  const previous = process.env.DEVECO_TOOL_LOG_DIR;
  const enabled = process.env.DEVECO_UI_PERFORMANCE_LOG;
  process.env.DEVECO_TOOL_LOG_DIR = directory;
  delete process.env.DEVECO_UI_PERFORMANCE_LOG;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_TOOL_LOG_DIR; else process.env.DEVECO_TOOL_LOG_DIR = previous;
    if (enabled === undefined) delete process.env.DEVECO_UI_PERFORMANCE_LOG; else process.env.DEVECO_UI_PERFORMANCE_LOG = enabled;
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("discarded results, concurrent operations and failures persist once without UI content", async t => {
  const directory = await fixture(t);
  await Promise.all(Array.from({ length: 9 }, () => measureUiOperation("uiTap", async () =>
    measureUiOperation("nested", () => ({ text: "PRIVATE_UI_TEXT", data: "BASE64_IMAGE" })))));
  await assert.rejects(measureUiOperation("uiFind", () => measureUiStage("hdc.dump", () => {
    throw Object.assign(new Error("PRIVATE_ERROR_DETAIL"), { code: "HDC_TIMEOUT" });
  })), error => error.performance.log.status === "written");
  const text = await fs.readFile(path.join(directory, "ui-performance.jsonl"), "utf8");
  const rows = text.trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map(row => row.operationId)).size, 10);
  assert.equal(rows.filter(row => row.success).length, 9);
  assert.equal(rows.at(-1).errorCode, "HDC_TIMEOUT");
  assert.equal(rows.at(-1).stages["hdc.dump"].failures, 1);
  assert.doesNotMatch(text, /PRIVATE_|BASE64_IMAGE|nested/);
});

test("rotation stays bounded and retains whole JSON records in order", async t => {
  const directory = await fixture(t);
  const write = createPerformanceLogger({ directory, maxBytes: 256, maxFiles: 3 });
  for (let index = 0; index < 30; index++) assert.equal((await write({ index, pad: "x".repeat(80) })).status, "written");
  const names = (await fs.readdir(directory)).sort().reverse();
  assert.equal(names.length, 3);
  const rows = [];
  for (const name of names) {
    const file = path.join(directory, name);
    assert.ok((await fs.stat(file)).size <= 256);
    rows.push(...(await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse));
  }
  assert.equal(rows.at(-1).index, 29);
  assert.deepEqual(rows.map(row => row.index), rows.map(row => row.index).toSorted((a, b) => a - b));
});

test("multiple processes share rotation without corrupting or losing retained records", async t => {
  const directory = await fixture(t);
  const module = new URL("../src/performance-log.mjs", import.meta.url).href;
  await Promise.all(Array.from({ length: 3 }, (_, worker) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { createPerformanceLogger } from ${JSON.stringify(module)};
      const write = createPerformanceLogger({ directory: process.env.DEVECO_TOOL_LOG_DIR, maxBytes: 512, maxFiles: 20 });
      for (let index=0; index<20; index++) {
        const result = await write({worker:${worker}, index});
        if (result.status !== 'written') throw new Error(JSON.stringify(result));
      }
    `], { env: { ...process.env }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(stderr)));
  })));
  const names = (await fs.readdir(directory)).filter(name => name.startsWith("ui-performance.jsonl"));
  const rows = (await Promise.all(names.map(name => fs.readFile(path.join(directory, name), "utf8"))))
    .flatMap(text => text.trim().split("\n").map(JSON.parse));
  assert.equal(rows.length, 60);
  assert.equal(new Set(rows.map(row => `${row.worker}:${row.index}`)).size, 60);
});

test("unwritable destination and opt-out preserve action results and expose logging status", async t => {
  const directory = await fixture(t);
  const blocked = path.join(directory, "regular-file");
  await fs.writeFile(blocked, "not a directory");
  process.env.DEVECO_TOOL_LOG_DIR = blocked;
  const result = await measureUiOperation("uiTap", () => ({ commandAccepted: true }));
  assert.equal(result.commandAccepted, true);
  assert.equal(result.performance.log.status, "failed");
  process.env.DEVECO_UI_PERFORMANCE_LOG = "0";
  assert.equal((await measureUiOperation("uiFind", () => ({}))).performance.log.status, "disabled");
});
