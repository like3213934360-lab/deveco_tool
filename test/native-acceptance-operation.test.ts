import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { nativeOperation } from "../scripts/lib/native-operation.js";
import type { Runtime } from "../src/services/runtime.js";

test("acceptance records the submitted task before waiting and never repeats an uncertain effect", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-acceptance-")), file = path.join(root, "receipt.json"), run_id = randomUUID();
  let submissions = 0, state = "needs_input";
  const runtime = { call: async (tool: string) => {
    if (tool === "hot_reload") { submissions++; assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).status, "prepared"); return { run_id, status: "queued" }; }
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).run_id, run_id);
    return { run_id, status: state, result: { execute_native_operation: { applied: true } } };
  } } as Pick<Runtime, "call">;
  try {
    await assert.rejects(nativeOperation(runtime, "hot_reload", { action: "apply" }, file), { code: "ACCEPTANCE_OPERATION_INCOMPLETE" });
    state = "succeeded";
    assert.deepEqual(await nativeOperation(runtime, "hot_reload", { action: "apply" }, file), { applied: true });
    assert.equal(submissions, 1);
    await assert.rejects(nativeOperation(runtime, "hot_reload", { action: "start" }, file), { code: "ACCEPTANCE_INPUT_CHANGED" });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("lost submission response preserves the request identity without automatic replay", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-acceptance-lost-")), file = path.join(root, "receipt.json");
  let submissions = 0;
  const runtime = { call: async () => { submissions++; throw new Error("lost response"); } } as Pick<Runtime, "call">;
  try {
    await assert.rejects(nativeOperation(runtime, "emulator_manage", { action: "create" }, file), /lost response/);
    await assert.rejects(nativeOperation(runtime, "emulator_manage", { action: "create" }, file), { code: "ACCEPTANCE_SUBMISSION_UNKNOWN" });
    assert.equal(submissions, 1);
    assert.match(JSON.parse(fs.readFileSync(file, "utf8")).request_key, /^acceptance:/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
