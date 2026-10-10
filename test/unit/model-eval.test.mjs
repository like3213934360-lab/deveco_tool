// The grader must reject invalid plans; these tests are not real model acceptance.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";
import { actualCalls, actionScenarios, callSet, grade, gradeLive, scenarios, unfinishedJobs } from "../../tools/model-eval.mjs";

let client, tools, state;
before(async () => {
  state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-model-eval-"));
  client = connect({ DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") });
  await client.initialize();
  tools = (await client.request("tools/list")).result.tools;
});
after(async () => {
  await client.close();
  fs.rmSync(state, { recursive: true, force: true });
});
const scenario = (id) => scenarios.filter((s) => s.id === id);

test("model scenarios cover every advertised tool and have unique ids", () => {
  assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length);
  assert.deepEqual([...new Set(scenarios.flatMap((s) => s.expect.map((c) => c.tool)))].sort(), tools.map((t) => t.name).sort());
});

test("extended discovery covers every action with schema-valid reference calls", () => {
  assert.equal(new Set(actionScenarios.map((s) => s.id)).size, actionScenarios.length);
  const covered = new Set(actionScenarios.flatMap((s) => s.expect.map((c) => `${c.tool}.${c.arguments?.action ?? ""}`)));
  for (const tool of tools) for (const action of tool.inputSchema.properties.action?.enum ?? [""])
    assert.ok(covered.has(`${tool.name}.${action}`), `missing ${tool.name}.${action}`);
  const added = actionScenarios.slice(scenarios.length);
  const result = grade(added.map((s) => ({ id: s.id, calls: s.expect })), tools, added);
  assert.deepEqual(result.filter((c) => !c.passed), []);
});

test("model grader checks exact scenario coverage", () => {
  assert.throws(() => grade([], tools), /scenario set/);
  assert.throws(() => grade([{ id: "environment" }, { id: "environment" }], tools), /duplicate/);
});

test("model grader recognizes host names without accepting invalid schema parameters", () => {
  const call = { tool: "emulator", arguments: { action: "start", name: "Phone", boot_mode: "snapshot", hdc_port: 15660 } };
  for (const prefix of ["", "mcp__deveco__", "deveco_", "default.deveco_"])
    assert.equal(grade([{ id: "snapshot-valid", calls: [{ ...call, tool: prefix + call.tool }] }], tools, scenario("snapshot-valid"))[0].passed, true);
  for (const change of [{ hdc_port: 5560 }, { hdc_port: "15660" }, { made_up: true }])
    assert.equal(grade([{ id: "snapshot-valid", calls: [{ ...call, arguments: { ...call.arguments, ...change } }] }], tools, scenario("snapshot-valid"))[0].passed, false);
  assert.equal(grade([{ id: "snapshot-valid", calls: [{ ...call, tool: "unknown_emulator" }] }], tools, scenario("snapshot-valid"))[0].passed, false);
});

test("both original device regressions require action even with otherwise correct parameters", () => {
  for (const id of ["device-log", "sqlite"]) {
    const s = scenario(id)[0];
    const call = structuredClone(s.expect[0]);
    delete call.arguments.action;
    const result = grade([{ id, calls: [call] }], tools, [s])[0];
    assert.equal(result.passed, false);
    assert.ok(result.failures.some((f) => f.invalid_call && f.issues.some((i) => i.path.includes("action"))));
  }
});

test("execution grading requires server calls, replies and expected output, not plans or prose", () => {
  const cases = [{ id: "probe", expect: [{ tool: "device", arguments: { action: "sqlite", db: ":memory:", sql: "SELECT 1 AS probe" }, result: { rows: [{ probe: 1 }], total: 1 } }] }];
  const request = { direction: "request", message: { id: 4, method: "tools/call", params: { name: "device", arguments: cases[0].expect[0].arguments } } };
  const response = (data, isError = false) => ({ direction: "response", message: { id: 4, result: { isError, content: [{ type: "text", text: JSON.stringify(data) }] } } });
  const passed = (trace) => gradeLive(actualCalls(trace), tools, cases)[0].passed;
  assert.equal(passed([]), false);
  assert.equal(passed([request]), false);
  assert.equal(passed([request, response({ error: { code: "INVALID_INPUT" } }, true)]), false);
  assert.equal(passed([request, response({ rows: [{ probe: 0 }], total: 1 })]), false);
  assert.equal(passed([request, response({ rows: [{ probe: 1 }], total: 1 })]), true);
  assert.equal(actualCalls([request, response({ status: "running" })])[0].pending, true);
  assert.equal(actualCalls([request, response({ status: "failed", error: { message: "build failed" } })])[0].succeeded, false);
});

test("parallel host results match transport calls regardless of key/order, preserving multiplicity", () => {
  const a = { tool: "device", arguments: { action: "info", target: "a" } };
  const b = { tool: "device", arguments: { action: "info", target: "b" } };
  assert.deepEqual(callSet([a, b]), callSet([b, { tool: "deveco_device", arguments: { target: "a", action: "info" } }]));
  assert.notDeepEqual(callSet([a, b]), callSet([a, a]));
  assert.notDeepEqual(callSet([a]), callSet([a, a]));
});

test("live alternatives require their asserted output and an actual successful response", () => {
  const call = { tool: "ui", arguments: { action: "assert", target: "test", visible: { text: "Hello World" } } };
  const cases = [{ id: "assert", expect: [], one_of: [{ ...call, result: { passed: true } }] }];
  for (const change of [{ succeeded: false }, { result: { passed: false } }, { result: undefined }])
    assert.equal(gradeLive([{ ...call, succeeded: true, result: { passed: true }, ...change }], tools, cases)[0].passed, false);
  assert.equal(gradeLive([{ ...call, succeeded: true, result: { passed: true } }], tools, cases)[0].passed, true);
});

test("a pending operation needs a successful terminal result for the same job", () => {
  const pending = { pending: true, succeeded: true, result: { job_id: "j_real", status: "running" } };
  const done = { pending: false, succeeded: true, result: { job_id: "j_real", status: "succeeded" } };
  assert.deepEqual(unfinishedJobs([pending]), ["j_real"]);
  assert.deepEqual(unfinishedJobs([pending, { ...done, result: { job_id: "j_other", status: "succeeded" } }]), ["j_real"]);
  assert.deepEqual(unfinishedJobs([pending, { ...done, succeeded: false }]), ["j_real"]);
  assert.deepEqual(unfinishedJobs([pending, done]), []);
});

test("model grader rejects forbidden operations even alongside the correct plan", () => {
  const plan = { id: "snapshot", calls: [], notes: "Allowed range: 10000-16555" };
  assert.equal(grade([plan], tools, scenario("snapshot"))[0].passed, true);
  plan.calls.push({ tool: "emulator", arguments: { action: "start", name: "Phone", hdc_port: 15660 } });
  assert.equal(grade([plan], tools, scenario("snapshot"))[0].passed, false);
  const sign = { id: "signing", calls: [{ tool: "sign", arguments: { action: "auto", project: "/workspace/Demo", target: "device-1" } }] };
  assert.equal(grade([sign], tools, scenario("signing"))[0].passed, false);
});

test("model grader accepts valid alternatives and refuses extra array choices", () => {
  for (const op of ["hover", "definition"])
    assert.equal(grade([{ id: "sdk-signature", calls: [{ tool: "code", arguments: { action: "lsp", op, project: "/workspace/Demo", symbol: "router.pushUrl" } }] }], tools, scenario("sdk-signature"))[0].passed, true);
  const call = { tool: "project", arguments: { action: "create", project: "/workspace/Demo", app_name: "Demo", bundle_name: "com.example.demo", device_types: ["phone", "tablet", "wearable"] } };
  assert.equal(grade([{ id: "project-types", calls: [call] }], tools, scenario("project-types"))[0].passed, false);
});
