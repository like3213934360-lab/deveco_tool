import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Capture } from "../../tools/model-capture.mjs";

test("provider observation preserves request and streaming Response identity without recording headers", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-model-capture-"));
  const original = globalThis.fetch, previous = process.env.DEVECO_MODEL_CAPTURE;
  const input = "https://provider.invalid", init = { body: JSON.stringify({ model: "test", tools: [{ function: { name: "deveco_ui" } }] }), headers: { Authorization: "private-token" } };
  const stream = "data: 中文🙂\n\ndata: [DONE]\n\n", response = new Response(stream);
  globalThis.fetch = async (url, options) => { assert.equal(url, input); assert.equal(options, init); return response; };
  process.env.DEVECO_MODEL_CAPTURE = directory;
  try {
    await Capture();
    const result = await fetch(input, init);
    assert.equal(result, response);
    assert.equal(await result.text(), stream);
    const file = path.join(directory, "provider-1.response.txt");
    for (let i = 0; i < 100 && !fs.existsSync(file); i++) await delay(10);
    assert.equal(fs.readFileSync(file, "utf8"), stream);
    assert.equal(fs.readFileSync(path.join(directory, "provider-1.request.json"), "utf8"), init.body);
    assert.deepEqual(fs.readdirSync(directory).sort(), ["provider-1.request.json", "provider-1.response.txt"]);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.DEVECO_MODEL_CAPTURE; else process.env.DEVECO_MODEL_CAPTURE = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
