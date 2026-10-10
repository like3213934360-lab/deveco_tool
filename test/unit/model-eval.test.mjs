// The grader must reject invalid plans; these tests are not real model acceptance.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";
import { grade, scenarios } from "../../tools/model-eval.mjs";

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
