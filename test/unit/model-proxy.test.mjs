// Exercise transport observation only; this fixture is not real-model acceptance.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("model proxy preserves split UTF-8 bytes and drains the final large response", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-proxy-"));
  const entry = path.join(directory, "echo.cjs"), trace = path.join(directory, "trace.jsonl");
  fs.writeFileSync(entry, `
const chunks=[];
process.stdin.on('data', chunk=>chunks.push(chunk));
process.stdin.on('end', ()=>process.stdout.end(Buffer.concat(chunks)));
`);
  const child = spawn(process.execPath, ["tools/model-proxy.mjs", entry, trace], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  const message = { id: 1, text: "中文🙂".repeat(16000) };
  const bytes = Buffer.from(JSON.stringify(message) + "\n");
  const closed = once(child, "close");
  try {
    const split = bytes.indexOf(Buffer.from("中")) + 1;
    child.stdin.write(bytes.subarray(0, split));
    await new Promise((resolve) => setTimeout(resolve, 100));
    child.stdin.end(bytes.subarray(split));
    const [code] = await closed;
    assert.equal(code, 0, Buffer.concat(errors).toString());
    assert.deepEqual(Buffer.concat(output), bytes);
    assert.deepEqual(fs.readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse), [
      { direction: "request", message }, { direction: "response", message },
    ]);
  } finally {
    child.kill();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a forbidden action or different device never reaches the server", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-proxy-boundary-"));
  const entry = path.join(directory, "sink.cjs"), policy = path.join(directory, "cases.json");
  fs.writeFileSync(entry, "process.stdin.on('data', chunk=>process.stdout.write(chunk));");
  fs.writeFileSync(policy, JSON.stringify([{ expect: [{ tool: "ui", arguments: { target: "test-emulator" } }],
    forbid: [{ tool: "ui", arguments: { action: "record_stop", discard: true } }] }]));
  try {
    for (const [i, args] of [{ action: "record_stop", target: "test-emulator", discard: true }, { action: "act", target: "other-device" }].entries()) {
      const trace = path.join(directory, `${i}.jsonl`), output = [];
      const child = spawn(process.execPath, ["tools/model-proxy.mjs", entry, trace, policy], { stdio: ["pipe", "pipe", "inherit"] });
      child.stdout.on("data", (chunk) => output.push(chunk));
      const closed = once(child, "close");
      const message = { id: 1, method: "tools/call", params: { name: "ui", arguments: args } };
      child.stdin.end(JSON.stringify(message) + "\n");
      assert.notEqual((await closed)[0], 0);
      assert.equal(Buffer.concat(output).length, 0, "must not forward or fabricate a response");
      assert.deepEqual(JSON.parse(fs.readFileSync(trace, "utf8")), { direction: "blocked", message });
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
