import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  selectorStrength, validateFlow, validateFlowId, variablesForRun,
} from "../src/arkpilot/domain.mjs";
import { JsonFlowRepository } from "../src/arkpilot/repository.mjs";
import { resolveAppTarget } from "../src/arkpilot/target-resolver.mjs";
import {
  closeUiFlows, flowServiceInternals, recordSuccessfulUiAction, uiFlow,
} from "../src/arkpilot/flow-service.mjs";

function validFlow(overrides = {}) {
  return {
    version: 1,
    id: "open-settings",
    name: "打开设置",
    app: { bundleName: "com.example.test", module: "entry", ability: "EntryAbility" },
    start: { mode: "restart" },
    variables: {},
    steps: [{ id: "step-1", action: "tap", selector: { key: "settings" }, timeoutMs: 1000 }],
    assert: { visible: { key: "settings" }, timeoutMs: 1000 },
    ...overrides,
  };
}

async function temporaryProject(options = {}) {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "arkpilot-project-"));
  const modules = options.modules ?? [{
    buildName: "default", srcPath: "entry", runtimeName: "entry", type: "entry",
    abilities: ["EntryAbility"],
  }];
  await fs.mkdir(path.join(project, "AppScope"), { recursive: true });
  await fs.writeFile(path.join(project, "AppScope", "app.json5"), `{
    // JSON5 comments and trailing commas are accepted.
    "app": { "bundleName": "com.example.test", },
  }`);
  await fs.writeFile(path.join(project, "build-profile.json5"), JSON.stringify({
    modules: modules.map((item) => ({ name: item.buildName, srcPath: item.srcPath })),
  }));
  for (const item of modules) {
    if (item.missing) continue;
    const directory = path.join(project, item.srcPath, "src", "main");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "module.json5"), JSON.stringify({
      module: {
        name: item.runtimeName,
        type: item.type,
        abilities: item.abilities.map((name) => ({ name })),
      },
    }));
  }
  return project;
}

async function withHdc(executable, operation) {
  const previous = process.env.HDC_PATH;
  process.env.HDC_PATH = executable;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.HDC_PATH;
    else process.env.HDC_PATH = previous;
  }
}

async function fakeFlowHdc({ layout, hangOnBundle = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "arkpilot-hdc-"));
  const executable = path.join(directory, "hdc");
  const argvLog = path.join(directory, "argv.log");
  const layoutPath = path.join(directory, "layout.json");
  await fs.writeFile(layoutPath, JSON.stringify(layout ?? {
    attributes: { type: "root", bounds: "[0,0][1000,2000]" },
    children: [{
      attributes: {
        type: "Button", key: "settings", text: "设置", bounds: "[100,200][300,300]",
        clickable: "true", visible: "true", enabled: "true",
      },
    }],
  }));
  const bundleCase = hangOnBundle ? "sleep 10" : "echo 'bundleName: com.example.test'";
  const script = `#!/bin/sh
{ printf '===\\n'; printf '%s\\n' "$@"; } >> '${argvLog}'
if [ "$1" = "list" ]; then echo "device-1"; exit 0; fi
if [ "$1" = "-t" ]; then shift 2; fi
if [ "$1" = "shell" ]; then
  shift
  if [ "$1" = "bm" ]; then ${bundleCase}; exit 0; fi
  if [ "$1" = "aa" ]; then echo "success"; exit 0; fi
  if [ "$1" = "uitest" ] && [ "$2" = "dumpLayout" ]; then echo "DumpLayout saved to $4"; exit 0; fi
  if [ "$1" = "uitest" ] && [ "$2" = "uiInput" ]; then echo "No Error"; exit 0; fi
fi
if [ "$1" = "file" ] && [ "$2" = "recv" ]; then cp '${layoutPath}' "$4"; exit 0; fi
exit 1
`;
  await fs.writeFile(executable, script, { mode: 0o755 });
  return {
    directory,
    executable,
    async invocations() {
      const raw = await fs.readFile(argvLog, "utf8").catch(() => "");
      return raw.split("===\n").filter((entry) => entry.trim()).map((entry) => entry.trim().split("\n"));
    },
  };
}

test("ArkPilot v1 domain validates actions, ids, variables, and final assertions", () => {
  const flow = validateFlow(validFlow({
    variables: { query: { required: true, secret: true } },
    steps: [
      { id: "step-1", action: "input", selector: { key: "search" }, value: "${query}", timeoutMs: 1000 },
      { id: "step-2", action: "swipe", gesture: {
        fromXPercent: 80, fromYPercent: 50, toXPercent: 20, toYPercent: 50, velocity: 800,
      } },
    ],
  }));
  assert.equal(flow.steps[0].value, "${query}");
  assert.equal(flow.steps[1].fragile, true);
  assert.deepEqual(variablesForRun(flow, { query: "私密文本" }), { query: "私密文本" });
  assert.throws(() => variablesForRun(flow, {}), { code: "FLOW_VARIABLE_REQUIRED" });
  assert.throws(() => variablesForRun(flow, { query: "x", extra: "y" }), { code: "FLOW_VARIABLE_UNKNOWN" });
  assert.throws(() => validateFlow({ ...validFlow(), version: 2 }), { code: "FLOW_VERSION_UNSUPPORTED" });
  assert.throws(() => validateFlow({ ...validFlow(), assert: undefined }), { code: "FLOW_ASSERT_REQUIRED" });
  assert.throws(() => validateFlow(validFlow({ steps: [
    { id: "same", action: "tap", selector: { key: "a" } },
    { id: "same", action: "tap", selector: { key: "b" } },
  ] })), { code: "FLOW_INVALID" });
  assert.throws(() => validateFlow(validFlow({ steps: [{ id: "x", action: "unknown" }] })), {
    code: "FLOW_ACTION_INVALID",
  });
});

test("flow ids and percentage coordinates reject path traversal and invalid ranges", () => {
  for (const id of ["../outside", "/absolute", "has/slash", "UPPER", "a".repeat(65)]) {
    assert.throws(() => validateFlowId(id), { code: "FLOW_ID_INVALID" });
  }
  const point = validateFlow(validFlow({
    steps: [{ id: "point", action: "tap", point: { xPercent: 25, yPercent: 75 } }],
  }));
  assert.deepEqual(point.steps[0].point, { xPercent: 25, yPercent: 75 });
  assert.equal(point.steps[0].fragile, true);
  assert.ok(selectorStrength({ selector: { key: "stable" } })
    > selectorStrength({ selector: { text: "semantic", type: "Text" } }));
  assert.ok(selectorStrength({ selector: { text: "semantic", type: "Text" } })
    > selectorStrength({ point: { xPercent: 25, yPercent: 75 } }));
  assert.throws(() => validateFlow(validFlow({
    steps: [{ id: "point", action: "tap", point: { xPercent: -1, yPercent: 75 } }],
  })), { code: "FLOW_INVALID" });
});

test("JSON repository saves atomically and supports list, get, validate, and delete", async (t) => {
  const project = await temporaryProject();
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  const repo = new JsonFlowRepository(project);
  assert.deepEqual(repo.config, { driver: "hdc-shell" });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(project, ".arkpilot", "config.json"), "utf8")), {
    driver: "hdc-shell",
  });
  const saved = repo.save(validFlow());
  assert.equal(saved.flow.id, "open-settings");
  assert.equal(repo.get("open-settings").name, "打开设置");
  assert.deepEqual(repo.list().map((entry) => entry.id), ["open-settings"]);

  const original = await fs.readFile(saved.path, "utf8");
  assert.throws(() => repo.save(validFlow({ assert: undefined })), { code: "FLOW_ASSERT_REQUIRED" });
  assert.equal(await fs.readFile(saved.path, "utf8"), original, "a failed save must preserve the prior flow");
  assert.deepEqual(repo.delete("open-settings"), { id: "open-settings", deleted: true });
  assert.throws(() => repo.get("open-settings"), { code: "FLOW_NOT_FOUND" });
  assert.throws(() => repo.delete("open-settings"), { code: "FLOW_NOT_FOUND" });
  assert.equal((await fs.readdir(path.join(project, ".arkpilot", "flows"))).length, 0);
});

test("JSON repository rejects malformed files, active locks, and symlink escapes", async (t) => {
  const project = await temporaryProject();
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  const repo = new JsonFlowRepository(project);
  const file = path.join(project, ".arkpilot", "flows", "broken.json");
  await fs.writeFile(file, "{not json");
  assert.throws(() => repo.get("broken"), { code: "FLOW_JSON_INVALID" });

  const lock = path.join(project, ".arkpilot", "flows", "open-settings.json.lock");
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid }));
  assert.throws(() => repo.save(validFlow()), { code: "FLOW_WRITE_BUSY" });

  const second = await temporaryProject();
  t.after(() => fs.rm(second, { recursive: true, force: true }));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "arkpilot-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.mkdir(path.join(second, ".arkpilot"), { recursive: true });
  await fs.symlink(outside, path.join(second, ".arkpilot", "flows"));
  assert.throws(() => new JsonFlowRepository(second), { code: "FLOW_PATH_UNSAFE" });

  const badConfig = await temporaryProject();
  t.after(() => fs.rm(badConfig, { recursive: true, force: true }));
  await fs.mkdir(path.join(badConfig, ".arkpilot"), { recursive: true });
  await fs.writeFile(path.join(badConfig, ".arkpilot", "config.json"), JSON.stringify({ driver: "unknown" }));
  assert.throws(() => new JsonFlowRepository(badConfig), { code: "FLOW_CONFIG_INVALID" });
});

test("Harmony manifest resolver handles custom srcPath and build/runtime module names", async (t) => {
  const project = await temporaryProject();
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  assert.deepEqual(resolveAppTarget(project), {
    bundleName: "com.example.test", module: "entry", ability: "EntryAbility",
  });
  assert.equal(resolveAppTarget(project, { module: "default" }).module, "entry");
  assert.equal(resolveAppTarget(project, { module: "entry" }).module, "entry");
});

test("Harmony manifest resolver refuses ambiguous targets and missing manifests", async (t) => {
  const multi = await temporaryProject({ modules: [
    { buildName: "one", srcPath: "features/one", runtimeName: "one", type: "entry", abilities: ["A"] },
    { buildName: "two", srcPath: "features/two", runtimeName: "two", type: "entry", abilities: ["B"] },
  ] });
  t.after(() => fs.rm(multi, { recursive: true, force: true }));
  assert.throws(() => resolveAppTarget(multi), { code: "FLOW_MODULE_REQUIRED" });
  assert.deepEqual(resolveAppTarget(multi, { module: "two" }), {
    bundleName: "com.example.test", module: "two", ability: "B",
  });

  const abilities = await temporaryProject({ modules: [{
    buildName: "default", srcPath: "entry", runtimeName: "entry", type: "entry", abilities: ["A", "B"],
  }] });
  t.after(() => fs.rm(abilities, { recursive: true, force: true }));
  assert.throws(() => resolveAppTarget(abilities), { code: "FLOW_ABILITY_REQUIRED" });

  const missing = await temporaryProject({ modules: [{
    buildName: "default", srcPath: "entry", runtimeName: "entry", type: "entry", abilities: [], missing: true,
  }] });
  t.after(() => fs.rm(missing, { recursive: true, force: true }));
  assert.throws(() => resolveAppTarget(missing), { code: "FLOW_MODULE_MANIFEST_INVALID" });
  await fs.rm(path.join(missing, "build-profile.json5"));
  assert.throws(() => resolveAppTarget(missing), { code: "FLOW_BUILD_PROFILE_INVALID" });
});

test("recording redacts input text and converts raw coordinates to percentages", async () => {
  const session = { deviceId: "device-1", steps: [], variables: {} };
  const input = await flowServiceInternals.recordedStep(session, {
    action: "inputText", x: 250, y: 1000, text: "never-store-this",
  }, { screen: [0, 0, 1000, 2000] });
  assert.equal(input.value, "${input1}");
  assert.deepEqual(input.point, { xPercent: 25, yPercent: 50 });
  assert.equal(JSON.stringify({ input, variables: session.variables }).includes("never-store-this"), false);

  const gesture = await flowServiceInternals.recordedStep(session, {
    action: "swipe", from_x_percent: 90, from_y_percent: 50,
    to_x_percent: 10, to_y_percent: 50, velocity: 1200,
  }, {});
  assert.deepEqual(gesture.gesture, {
    fromXPercent: 90, fromYPercent: 50, toXPercent: 10, toYPercent: 50, velocity: 1200,
  });
  assert.deepEqual(flowServiceInternals.redactSecrets({
    message: "typed never-store-this", matches: [{ text: "never-store-this" }],
  }, ["never-store-this"]), {
    message: "typed [REDACTED]", matches: [{ text: "[REDACTED]" }],
  });
});

test("only successful external ui_tap events enter an active recording", async () => {
  flowServiceInternals.recordings.clear();
  const session = {
    id: "recording-1", status: "recording", deviceId: "device-1", steps: [], variables: {}, replaying: false,
  };
  flowServiceInternals.recordings.set(session.id, session);
  const recorded = await recordSuccessfulUiAction({ action: "click", key: "settings" }, {
    deviceId: "device-1", target: { key: "settings" },
  });
  assert.deepEqual(recorded, { recordingId: "recording-1", stepId: "step-1" });
  assert.equal(session.steps.length, 1);
  session.replaying = true;
  assert.equal(await recordSuccessfulUiAction({ action: "click", key: "x" }, { deviceId: "device-1" }), null);
  assert.equal(session.steps.length, 1);
  flowServiceInternals.recordings.clear();
});

test("record_stop verifies the final selector on-device before replacing a saved flow", async (t) => {
  const project = await temporaryProject();
  const fake = await fakeFlowHdc();
  t.after(async () => {
    flowServiceInternals.recordings.clear();
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(fake.directory, { recursive: true, force: true });
  });
  const repo = new JsonFlowRepository(project);
  repo.save(validFlow({ name: "原流程" }));
  await withHdc(fake.executable, async () => {
    const recording = await uiFlow({
      action: "record_start", project_path: project, id: "open-settings", name: "新流程",
      hvd: "device-1",
    });
    await recordSuccessfulUiAction({ action: "click", key: "settings" }, {
      deviceId: "device-1", target: { key: "settings" },
    });
    await assert.rejects(() => uiFlow({
      action: "record_stop", recording_id: recording.recordingId,
      success_selector: { key: "missing" }, success_timeout_ms: 100,
    }), { code: "FLOW_STEP_TIMEOUT" });
    assert.equal(repo.get("open-settings").name, "原流程", "failed verification must not overwrite the old flow");
    assert.equal((await uiFlow({ action: "record_status", recording_id: recording.recordingId })).steps.length, 1);

    const saved = await uiFlow({
      action: "record_stop", recording_id: recording.recordingId,
      success_selector: { key: "settings" }, success_timeout_ms: 1000,
    });
    assert.equal(saved.flow.name, "新流程");
    assert.equal(saved.flow.steps.length, 1);
  });
});

test("a complete HDC flow launches directly, uses semantic dumps, and takes no success screenshot", async (t) => {
  const project = await temporaryProject();
  const fake = await fakeFlowHdc();
  t.after(async () => {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(fake.directory, { recursive: true, force: true });
  });
  new JsonFlowRepository(project).save(validFlow());
  const startedAt = Date.now();
  const result = await withHdc(fake.executable, () => uiFlow({
    action: "run", project_path: project, id: "open-settings", hvd: "device-1", wait_ms: 5000,
  }));
  assert.equal(result.status, "SUCCEEDED");
  assert.ok(Date.now() - startedAt < 2000, "a completed job must cancel its losing wait timer");
  assert.ok(result.metrics.hdcCommands > 0);
  assert.equal(result.result.stepCount, 1);
  const calls = await fake.invocations();
  assert.equal(calls.filter((args) => args.includes("dumpLayout")).length, 2, "step wait and final assertion each dump once");
  assert.equal(calls.filter((args) => args.includes("uiInput")).length, 1, "a successful action is never replayed twice");
  assert.equal(calls.some((args) => args.includes("snapshot_display") || args.includes("screenCap")), false);
  assert.ok(calls.some((args) => args.includes("rm") && args.some((arg) => arg.endsWith("_dump.json"))),
    "the device-side UI dump must be removed after the flow");
  assert.ok(calls.some((args) => args.includes("force-stop")));
  assert.ok(calls.some((args) => args.includes("start")));
});

test("a second flow on the same device fails fast without restarting or diagnosing it", async (t) => {
  const project = await temporaryProject();
  const fake = await fakeFlowHdc({ hangOnBundle: true });
  t.after(async () => {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(fake.directory, { recursive: true, force: true });
  });
  new JsonFlowRepository(project).save(validFlow());
  await withHdc(fake.executable, async () => {
    const first = await uiFlow({
      action: "run", project_path: project, id: "open-settings", hvd: "device-1",
      timeoutMs: 60000, wait_ms: 0,
    });
    for (let attempt = 0; attempt < 200 && flowServiceInternals.activeFlowDevices.size === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const holder = flowServiceInternals.activeFlowDevices.get("device-1");
    if (!holder) {
      const state = await uiFlow({ action: "status", job_id: first.jobId, wait_ms: 0 });
      assert.fail(`the first flow did not reserve its device: ${JSON.stringify(state)}`);
    }
    assert.equal(holder, first.jobId);

    const startedAt = Date.now();
    const second = await uiFlow({
      action: "run", project_path: project, id: "open-settings", hvd: "device-1",
      timeoutMs: 60000, wait_ms: 1000,
    });
    assert.equal(second.status, "FAILED");
    assert.equal(second.error.code, "UI_DEVICE_BUSY");
    assert.equal(second.metrics.hdcCommands, 1, "the rejected flow only enumerates the requested device");
    assert.equal(second.diagnostics, undefined);
    assert.ok(Date.now() - startedAt < 1000);

    const cancelled = await uiFlow({ action: "cancel", job_id: first.jobId });
    assert.equal(cancelled.status, "CANCELLED");
    const calls = await fake.invocations();
    assert.equal(calls.filter((args) => args.includes("bm")).length, 1, "the rejected flow must not restart the app");
  });
});

test("the total deadline aborts a hanging HDC child and reports timeout instead of cancellation", async (t) => {
  const project = await temporaryProject();
  const fake = await fakeFlowHdc({ hangOnBundle: true });
  t.after(async () => {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(fake.directory, { recursive: true, force: true });
  });
  new JsonFlowRepository(project).save(validFlow());
  const startedAt = Date.now();
  const result = await withHdc(fake.executable, () => uiFlow({
    action: "run", project_path: project, id: "open-settings", hvd: "device-1",
    timeoutMs: 1000, wait_ms: 3000,
  }));
  assert.equal(result.status, "FAILED");
  assert.equal(result.error.code, "FLOW_TOTAL_TIMEOUT");
  assert.ok(Date.now() - startedAt < 3000, "the HDC process tree must be cancelled promptly");
});

test("cancel aborts an active child process and reaches CANCELLED within three seconds", async (t) => {
  const project = await temporaryProject();
  const fake = await fakeFlowHdc({ hangOnBundle: true });
  t.after(async () => {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(fake.directory, { recursive: true, force: true });
  });
  new JsonFlowRepository(project).save(validFlow());
  await withHdc(fake.executable, async () => {
    const started = await uiFlow({
      action: "run", project_path: project, id: "open-settings", hvd: "device-1",
      timeoutMs: 60000, wait_ms: 0,
    });
    const cancelledAt = Date.now();
    const cancelled = await uiFlow({ action: "cancel", job_id: started.jobId });
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.error.code, "FLOW_CANCELLED");
    assert.ok(Date.now() - cancelledAt < 3000);
  });
});

test.after(async () => {
  flowServiceInternals.recordings.clear();
  await closeUiFlows();
});
