import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { Runtime } from "../src/services/runtime.js";
import { tools } from "../src/core/contracts.js";
import { ToolError } from "../src/core/errors.js";
import { atomicWrite, digest } from "../src/core/files.js";

const input = { name: "fixture", target: "device", action: "sensor", key: "light", value: 1234,
  verify: { bundle_name: "com.deveco.fixture", assert: { visible: { key: "light", text: "1234", textMode: "exact" } } },
  request_key: "outcome-fixture" };
function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deveco-outcome-")));
  const old = { config: process.env.DEVECO_CONFIG, state: process.env.DEVECO_STATE_DIR };
  fs.mkdirSync(path.join(root, "clt"));
  process.env.DEVECO_CONFIG = path.join(root, "config.json");
  process.env.DEVECO_STATE_DIR = path.join(root, "state");
  atomicWrite(process.env.DEVECO_CONFIG, JSON.stringify({ clt: path.join(root, "clt") }));
  let runtime = new Runtime();
  return { get runtime() { return runtime; }, async restart() { await runtime.close(); runtime = new Runtime(); }, async close() {
    await runtime.close();
    if (old.config === undefined) delete process.env.DEVECO_CONFIG; else process.env.DEVECO_CONFIG = old.config;
    if (old.state === undefined) delete process.env.DEVECO_STATE_DIR; else process.env.DEVECO_STATE_DIR = old.state;
    fs.rmSync(root, { recursive: true, force: true });
  } };
}
async function settled(runtime: Runtime, run: string) {
  for (let i = 0; i < 100; i++) {
    const status = z.object({ status: z.string(), result: z.unknown(), error: z.unknown().optional() }).parse(await runtime.call("workflow_run", { action: "status", run_id: run, wait_ms: 100 }));
    if (!["queued", "running", "cancelling"].includes(status.status)) return status;
  }
  throw new Error("Outcome fixture did not settle");
}

test("scenario observation rejects cross-application selectors before submitting a command", () => {
  for (const assertion of [
    { visible: { key: "light", bundle_name: "com.other.app" } },
    { visible: { key: "light" }, alternates: [{ key: "fallback", bundle_name: "com.other.app" }] },
  ]) assert.equal(tools.emulator_scenario.schema.safeParse({ ...input, verify: { ...input.verify, assert: assertion } }).success, false);
  assert.equal(tools.emulator_scenario.schema.safeParse(input).success, true);
});

test("accepted scenario and failed observation remain distinct; restarting and resuming rechecks only the observation", async (t) => {
  const f = fixture(); let commands = 0, observations = 0;
  const command = { commandAccepted: true, stateVerified: false, output: "Scenario simulation success." };
  try {
    t.mock.method(f.runtime.devices, "target", async () => "device");
    t.mock.method(f.runtime.emulator, "reconcileSessions", async () => {});
    t.mock.method(f.runtime.emulator, "scenario", async () => { commands++; return command; });
    t.mock.method(f.runtime.devices, "verify", async (_target: string, _assertion: unknown, _signal: unknown, bundle: string) => {
      observations++; assert.equal(bundle, input.verify.bundle_name);
      throw new ToolError("VERIFICATION_FAILED", "Controlled delayed callback");
    });
    const run = z.object({ run_id: z.string() }).parse(await f.runtime.call("emulator_scenario", input));
    const failed = await settled(f.runtime, run.run_id);
    assert.equal(failed.status, "failed"); assert.equal(commands, 1); assert.equal(observations, 1);
    const error = z.object({ code: z.literal("VERIFICATION_FAILED"), details: z.object({ command_accepted: z.literal(true), verified: z.literal(false), operation_sha256: z.string(), report_artifact: z.object({ artifact_id: z.string() }) }) }).parse(failed.error);
    assert.equal(error.details.operation_sha256, digest(command));
    const report = JSON.parse(Buffer.from(f.runtime.store.readArtifact(error.details.report_artifact.artifact_id).data, "base64").toString());
    assert.equal(report.verified, false); assert.equal(report.run_id, run.run_id);
    await f.restart();
    t.mock.method(f.runtime.devices, "target", async () => "device");
    t.mock.method(f.runtime.emulator, "reconcileSessions", async () => {});
    t.mock.method(f.runtime.emulator, "scenario", async () => { commands++; throw new Error("Accepted scenario must not replay"); });
    t.mock.method(f.runtime.devices, "verify", async (_target: string, _assertion: unknown, _signal: unknown, bundle: string) => {
      observations++; assert.equal(bundle, input.verify.bundle_name); return { verified: true, snapshot_id: "fresh-observation" };
    });
    await f.runtime.call("workflow_run", { action: "resume", run_id: run.run_id });
    const result = await settled(f.runtime, run.run_id);
    assert.equal(result.status, "succeeded"); assert.equal(commands, 1); assert.equal(observations, 2);
    const outputs = z.object({ execute_native_operation: z.unknown(), verify_native_outcome: z.object({ verified: z.literal(true), operation_sha256: z.string(), scope: z.literal("captured_application_ui_assertion") }) }).parse(result.result);
    assert.deepEqual(outputs.execute_native_operation, command);
    assert.equal(outputs.verify_native_outcome.operation_sha256, digest(command));
    assert.equal(f.runtime.store.db.prepare("SELECT 1 FROM leases").get(), undefined);
  } finally { await f.close(); }
});

test("cancelling the observation preserves the accepted command and releases the device lease", async (t) => {
  const f = fixture(), entered = Promise.withResolvers<void>(); let commands = 0;
  try {
    t.mock.method(f.runtime.devices, "target", async () => "device");
    t.mock.method(f.runtime.emulator, "reconcileSessions", async () => {});
    t.mock.method(f.runtime.emulator, "scenario", async () => { commands++; return { commandAccepted: true, stateVerified: false }; });
    t.mock.method(f.runtime.devices, "verify", async (_target: string, _assertion: unknown, signal: AbortSignal) => {
      entered.resolve(); await delay(10000, undefined, { signal }); return { verified: true };
    });
    const run = z.object({ run_id: z.string() }).parse(await f.runtime.call("emulator_scenario", input));
    await entered.promise;
    await f.runtime.call("workflow_run", { action: "cancel", run_id: run.run_id });
    assert.equal((await settled(f.runtime, run.run_id)).status, "cancelled");
    const duplicate = z.object({ run_id: z.string(), deduplicated: z.literal(true) }).parse(await f.runtime.call("emulator_scenario", input));
    assert.equal(duplicate.run_id, run.run_id); assert.equal(commands, 1);
    assert.equal(f.runtime.store.db.prepare("SELECT 1 FROM leases").get(), undefined);
  } finally { await f.close(); }
});
