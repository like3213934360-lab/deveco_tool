import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { recordedStep } from "../src/services/recording.js";
import {
  DeviceService,
  flattenDump,
  UiIndex,
  type Snapshot,
} from "../src/services/device.js";
import { controlSchema, flowSchema } from "../src/core/contracts.js";
import { atomicWrite } from "../src/core/files.js";
import { inspectProject } from "../src/services/project.js";
import { ToolError } from "../src/core/errors.js";

const bundle = "com.example.recording";
function snapshot(): Snapshot {
  const nodes = flattenDump({
    attributes: {
      type: "WindowScene",
      bundleName: bundle,
      focused: "true",
      bounds: "[100,200][500,1000]",
    },
    children: [
      {
        attributes: {
          type: "TextInput",
          id: "password",
          text: "previous-private-value",
          bounds: "[110,210][290,250]",
          enabled: true,
        },
      },
      {
        attributes: {
          type: "Button",
          id: "submit",
          text: "确定",
          bounds: "[110,260][290,300]",
          enabled: true,
        },
      },
    ],
  });
  return {
    id: "snapshot",
    device: "device",
    created: Date.now(),
    nodes,
    query: new UiIndex(nodes),
    signature: "s",
    structureSignature: "ss",
  };
}
const draft = () =>
  flowSchema.parse({
    version: 1,
    id: "recorded",
    name: "录制流程",
    app: { bundleName: bundle, module: "entry", ability: "MainAbility" },
    start: { mode: "attach" },
    steps: [],
  });
async function fixture(t: TestContext) {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-recording-")),
    ),
    project = path.join(root, "project"),
    oldConfig = process.env.DEVECO_CONFIG,
    oldState = process.env.DEVECO_STATE_DIR;
  atomicWrite(
    path.join(project, "build-profile.json5"),
    JSON.stringify({
      app: { products: [{ name: "default", compatibleSdkVersion: 26 }] },
      modules: [
        {
          name: "entry",
          srcPath: "entry",
          targets: [{ name: "default", applyToProducts: ["default"] }],
        },
      ],
    }),
  );
  atomicWrite(
    path.join(project, "AppScope/app.json5"),
    JSON.stringify({ app: { bundleName: bundle } }),
  );
  atomicWrite(
    path.join(project, "entry/src/main/module.json5"),
    JSON.stringify({
      module: {
        name: "entry",
        type: "entry",
        abilities: [{ name: "MainAbility", exported: true }],
      },
    }),
  );
  atomicWrite(
    path.join(root, "config.json"),
    JSON.stringify({ clt: path.join(root, "clt"), default_project: project }),
  );
  process.env.DEVECO_CONFIG = path.join(root, "config.json");
  fs.mkdirSync(path.join(root, "clt"));
  process.env.DEVECO_STATE_DIR = path.join(root, "state");
  let runtime = new Runtime();
  const configure = () => {
    t.mock.method(runtime.devices, "target", async () => "device");
    t.mock.method(runtime.devices, "snapshot", async () => snapshot());
    t.mock.method(runtime.devices, "verify", async () => ({ verified: true }));
    t.mock.method(runtime.devices, "control", async () => ({
      commandAccepted: true,
      outcomeVerified: false,
    }));
  };
  configure();
  return {
    root,
    project,
    get runtime() {
      return runtime;
    },
    async reopen() {
      await runtime.close();
      runtime = new Runtime();
      configure();
    },
    async close() {
      await runtime.close();
      if (oldConfig === undefined) delete process.env.DEVECO_CONFIG;
      else process.env.DEVECO_CONFIG = oldConfig;
      if (oldState === undefined) delete process.env.DEVECO_STATE_DIR;
      else process.env.DEVECO_STATE_DIR = oldState;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
async function settled(runtime: Runtime, id: string) {
  for (let n = 0; n < 100; n++) {
    const state = z
      .object({ status: z.string(), error: z.unknown().optional() })
      .parse(
        await runtime.call("workflow_run", {
          action: "status",
          run_id: id,
          wait_ms: 100,
        }),
      );
    if (!["queued", "running", "cancelling"].includes(state.status))
      return state;
  }
  throw new Error("Recording did not settle");
}
async function start(runtime: Runtime, id = "recorded") {
  const input = {
    action: "record_start",
    id,
    name: "录制流程",
    route: { module: "entry", ability: "MainAbility" },
    mode: "attach",
    request_key: `record-${id}`,
  };
  const result = z
    .object({ run_id: z.string(), recording_id: z.string() })
    .parse(await runtime.call("ui_flow", input));
  assert.equal((await settled(runtime, result.run_id)).status, "needs_input");
  assert.equal(result.run_id, result.recording_id);
  assert.equal(
    z
      .object({ recording_id: z.string() })
      .parse(await runtime.call("ui_flow", input)).recording_id,
    result.run_id,
  );
  return result.run_id;
}
test("modern application root windows can record controls without requiring a SceneBoard WindowScene", () => {
  const tree = snapshot();
  tree.nodes[0]!.type = "root";
  const step = recordedStep(
    tree,
    draft(),
    controlSchema.parse({ action: "click", selector: { key: "submit" } }),
  );
  assert.equal(step.selector?.key, "submit");
  tree.nodes[0]!.depth = 3;
  assert.throws(
    () =>
      recordedStep(
        tree,
        draft(),
        controlSchema.parse({ action: "click", selector: { key: "submit" } }),
      ),
    { code: "RECORDING_WINDOW_UNKNOWN" },
  );
});
test("recorded selectors exclude input values, gestures retain window geometry and unsupported chords reject before execution", () => {
  const flow = draft(),
    tree = snapshot();
  const input = recordedStep(
    tree,
    flow,
    controlSchema.parse({
      action: "inputText",
      selector: { key: "password" },
      text: "new-private-value",
    }),
  );
  assert.equal(input.value, "${input1}");
  assert.equal(input.selector?.key, "password");
  assert.ok(!JSON.stringify(input).includes("private-value"));
  const tap = recordedStep(
    tree,
    flow,
    controlSchema.parse({ action: "click", selector: { text: "确定" } }),
  );
  assert.equal(tap.selector?.key, "submit");
  assert.ok(tap.alternates?.some((selector) => selector.text === "确定"));
  const swipe = recordedStep(
    tree,
    flow,
    controlSchema.parse({
      action: "swipe",
      x: 200,
      y: 400,
      x2: 400,
      y2: 800,
      velocity: 600,
    }),
  );
  assert.deepEqual(swipe.gesture, {
    fromXPercent: 25,
    fromYPercent: 25,
    toXPercent: 75,
    toYPercent: 75,
    velocity: 600,
  });
  assert.equal(swipe.fragile, true);
  assert.throws(
    () =>
      recordedStep(
        tree,
        flow,
        controlSchema.parse({ action: "click", x: 99, y: 300 }),
      ),
    { code: "RECORDING_COORDINATES_INVALID" },
  );
  assert.throws(
    () =>
      recordedStep(
        tree,
        flow,
        controlSchema.parse({ action: "keyEvent", keys: ["CTRL", "A"] }),
      ),
    { code: "RECORDING_KEYS_UNSUPPORTED" },
  );
  assert.throws(
    () =>
      recordedStep(
        tree,
        flow,
        controlSchema.parse({ action: "dircFling", direction: 0 }),
      ),
    { code: "RECORDING_GESTURE_UNSUPPORTED" },
  );
  tree.nodes[0]!.bundleName = "com.other";
  assert.throws(
    () =>
      recordedStep(
        tree,
        flow,
        controlSchema.parse({ action: "click", x: 200, y: 300 }),
      ),
    { code: "RECORDING_WINDOW_UNKNOWN" },
  );
});
test("recording survives runtime restart, pauses without leases and saves only after its sealed final assertion passes", async (t) => {
  const f = await fixture(t);
  try {
    const id = await start(f.runtime);
    assert.equal(
      f.runtime.store.db.prepare("SELECT COUNT(*) AS n FROM leases").get() &&
        (
          f.runtime.store.db
            .prepare("SELECT COUNT(*) AS n FROM leases")
            .get() as { n: number }
        ).n,
      0,
    );
    await f.runtime.call("ui_control", {
      operation: {
        action: "inputText",
        selector: { key: "password" },
        text: "new-private-value",
      },
    });
    await f.runtime.call("ui_tap", { selector: { key: "submit" } });
    assert.equal(f.runtime.recordings.status(id).step_count, 2);
    assert.equal(f.runtime.recordings.status(id).receipt_count, 2);
    assert.ok(
      !JSON.stringify(
        f.runtime.store.db.prepare("SELECT * FROM ui_recordings").all(),
      ).includes("new-private-value"),
    );
    assert.ok(
      !JSON.stringify(f.runtime.recordings.flow(id)).includes("private-value"),
    );
    // A recheck without record_stop cannot skip the declared input boundary.
    await f.runtime.call("workflow_run", {
      action: "resume",
      run_id: id,
      resume_input: { action: "recheck" },
    });
    assert.equal((await settled(f.runtime, id)).status, "needs_input");
    await f.reopen();
    assert.equal(f.runtime.recordings.status(id).step_count, 2);
    t.mock.method(f.runtime.devices, "verify", async () => {
      throw new ToolError("VERIFICATION_FAILED", "Expected outcome missing");
    });
    const stop = {
      action: "record_stop",
      recording_id: id,
      assert: { visible: { text: "Done" } },
    };
    await f.runtime.call("ui_flow", stop);
    assert.equal((await settled(f.runtime, id)).status, "failed");
    f.runtime.store.db.prepare("UPDATE runs SET updated=0 WHERE id=?").run(id);
    f.runtime.store.prune();
    assert.equal(f.runtime.recordings.status(id).state, "sealed");
    assert.ok(
      !fs.existsSync(path.join(f.project, ".arkpilot/flows/recorded.json")),
    );
    await assert.rejects(
      f.runtime.call("ui_flow", {
        ...stop,
        assert: { visible: { text: "Easier" } },
      }),
      { code: "RECORDING_ASSERT_CHANGED" },
    );
    await assert.rejects(
      f.runtime.call("ui_tap", { selector: { key: "submit" } }),
      { code: "RECORDING_NOT_ACTIVE" },
    );
    t.mock.method(f.runtime.devices, "verify", async () => ({
      verified: true,
    }));
    await f.runtime.call("ui_flow", stop);
    assert.equal((await settled(f.runtime, id)).status, "succeeded");
    const flow = f.runtime.flows.read(inspectProject(f.project), "recorded");
    assert.equal(flow.steps.length, 2);
    assert.equal(flow.steps[0]?.value, "${input1}");
    assert.deepEqual(flow.variables, {
      input1: { required: true, secret: true },
    });
    assert.equal(flow.assert?.visible?.text, "Done");
    assert.equal(f.runtime.recordings.status(id).state, "finished");
    await f.runtime.call("ui_flow", stop);
    f.runtime.store.db.prepare("UPDATE runs SET updated=0 WHERE id=?").run(id);
    f.runtime.store.prune();
    assert.equal(
      f.runtime.store.db
        .prepare("SELECT run_id FROM ui_recordings WHERE run_id=?")
        .get(id),
      undefined,
    );
  } finally {
    await f.close();
  }
});
test("a lost recording receipt reports the accepted action, blocks further replay and can be discarded without repeating it", async (t) => {
  const f = await fixture(t);
  try {
    const id = await start(f.runtime);
    let actions = 0;
    let restoreCapacity = () => {};
    t.mock.method(f.runtime.devices, "control", async () => {
      actions++;
      const mocked = t.mock.method(f.runtime.store, "capacity", () => {
        throw new ToolError("STATE_CAPACITY", "Full");
      });
      restoreCapacity = () => mocked.mock.restore();
      return { commandAccepted: true, outcomeVerified: false };
    });
    const result = z
      .object({
        commandAccepted: z.boolean(),
        recording: z.object({ recorded: z.boolean(), uncertain: z.boolean() }),
      })
      .parse(await f.runtime.call("ui_tap", { selector: { key: "submit" } }));
    assert.equal(result.commandAccepted, true);
    assert.equal(result.recording.recorded, false);
    restoreCapacity();
    assert.ok(f.runtime.recordings.status(id).uncertain_operation);
    await assert.rejects(
      f.runtime.call("ui_tap", { selector: { key: "submit" } }),
      { code: "RECORDING_UNCERTAIN" },
    );
    await assert.rejects(
      f.runtime.call("ui_flow", {
        action: "record_stop",
        recording_id: id,
        assert: { visible: { text: "Done" } },
      }),
      { code: "RECORDING_UNCERTAIN" },
    );
    await f.runtime.call("workflow_run", { action: "cancel", run_id: id });
    assert.equal((await settled(f.runtime, id)).status, "cancelled");
    assert.equal(f.runtime.recordings.status(id).state, "cancelled");
    assert.equal(actions, 1);
    assert.ok(
      !fs.existsSync(path.join(f.project, ".arkpilot/flows/recorded.json")),
    );
  } finally {
    await f.close();
  }
});
test("recording resolves percentages once, retains fling sampling and rejects invalid controls before writing a pending receipt", async (t) => {
  const f = await fixture(t);
  try {
    const id = await start(f.runtime);
    let captures = 0;
    t.mock.method(f.runtime.devices, "snapshot", async () => {
      captures++;
      const tree = snapshot();
      for (const node of tree.nodes) node.displayId = "1";
      return tree;
    });
    const control = t.mock.method(f.runtime.devices, "control", async () => ({
      commandAccepted: true,
      outcomeVerified: false,
    }));
    await assert.rejects(
      f.runtime.call("ui_control", {
        operation: { action: "click", x: 200, y: 400, velocity: 600 },
      }),
      { code: "UI_INPUT_CONFLICT" },
    );
    assert.equal(control.mock.callCount(), 0);
    assert.equal(f.runtime.recordings.status(id).step_count, 0);
    assert.ok(!f.runtime.recordings.status(id).uncertain_operation);
    const before = captures;
    await f.runtime.call("ui_control", {
      operation: {
        action: "fling",
        window: { bundle_name: bundle },
        display_id: 1,
        gesture: {
          fromXPercent: 25,
          fromYPercent: 25,
          toXPercent: 75,
          toYPercent: 75,
          velocity: 800,
          stepLength: 4,
        },
      },
    });
    assert.equal(captures - before, 1);
    assert.deepEqual(control.mock.calls[0]!.arguments[1], {
      action: "fling",
      display_id: 1,
      x: 200,
      y: 400,
      x2: 400,
      y2: 800,
      velocity: 800,
      step_length: 4,
    });
    assert.deepEqual(f.runtime.recordings.flow(id).steps[0]?.gesture, {
      fromXPercent: 25,
      fromYPercent: 25,
      toXPercent: 75,
      toYPercent: 75,
      velocity: 800,
      stepLength: 4,
    });
    assert.equal(f.runtime.recordings.status(id).receipt_count, 1);
    await f.runtime.call("ui_control", {
      operation: {
        action: "drag",
        selector: { key: "submit", displayId: 1 },
        gesture: {
          fromXPercent: 10,
          fromYPercent: 50,
          toXPercent: 90,
          toYPercent: 50,
        },
      },
    });
    const recorded = f.runtime.recordings.flow(id).steps[1]!;
    assert.equal(recorded.selector, undefined);
    assert.equal(recorded.fragile, true);
    assert.ok(Math.abs(recorded.gesture!.fromXPercent - 7) < 1e-10);
    assert.deepEqual(
      { ...recorded.gesture, fromXPercent: 7 },
      {
        fromXPercent: 7,
        fromYPercent: 10,
        toXPercent: 43,
        toYPercent: 10,
      },
    );
  } finally {
    await f.close();
  }
});
test("recording cancellation reaches an in-flight UI action and waits for its operation guard before declaring cancelled", async (t) => {
  const f = await fixture(t);
  try {
    const id = await start(f.runtime),
      entered = Promise.withResolvers<void>();
    let stopped = false;
    t.mock.method(
      f.runtime.devices,
      "control",
      async (...[, , signal]: Parameters<typeof f.runtime.devices.control>) => {
        entered.resolve();
        try {
          await delay(10000, undefined, { signal });
        } finally {
          await delay(30);
          stopped = true;
        }
        return { commandAccepted: true, outcomeVerified: false };
      },
    );
    const action = f.runtime.call("ui_tap", { selector: { key: "submit" } });
    const failed = assert.rejects(action, { name: "AbortError" });
    await entered.promise;
    assert.throws(() => f.runtime.store.assertStopped(id), {
      code: "CANCEL_UNCONFIRMED",
    });
    const cancel = f.runtime.call("ui_flow", {
      action: "record_cancel",
      recording_id: id,
    });
    await delay(10);
    assert.equal(f.runtime.store.get(id).status, "needs_input");
    await cancel;
    await failed;
    assert.equal(stopped, true);
    assert.equal((await settled(f.runtime, id)).status, "cancelled");
    assert.equal(f.runtime.recordings.status(id).state, "cancelled");
    await start(f.runtime, "second");
  } finally {
    await f.close();
  }
});
test("one device has one unfinished recording and status follow-ups cannot retarget a captured task", async (t) => {
  const f = await fixture(t);
  try {
    const id = await start(f.runtime);
    const navigation = z.object({ run_id: z.string() }).parse(
      await f.runtime.call("ui_flow", {
        action: "navigate",
        route: { ability: "MainAbility" },
        assert: { visible: { text: "Done" } },
      }),
    );
    const navResult = await settled(f.runtime, navigation.run_id);
    assert.equal(navResult.status, "failed");
    assert.equal(
      z.object({ code: z.string() }).parse(navResult.error).code,
      "RECORDING_ACTIVE",
    );
    const competing = z.object({ run_id: z.string() }).parse(
      await f.runtime.call("ui_flow", {
        action: "record_start",
        id: "competing",
        name: "Competing",
        route: { ability: "MainAbility" },
        mode: "attach",
      }),
    );
    const result = await settled(f.runtime, competing.run_id);
    assert.equal(result.status, "failed");
    assert.equal(
      z.object({ code: z.string() }).parse(result.error).code,
      "RECORDING_ACTIVE",
    );
    for (const action of ["record_status", "record_stop", "record_cancel"])
      await assert.rejects(
        f.runtime.call("ui_flow", {
          action,
          recording_id: id,
          target: "another-device",
        }),
        { code: "RECORDING_INPUT_INVALID" },
      );
    await f.runtime.call("ui_flow", {
      action: "record_cancel",
      recording_id: id,
    });
    assert.equal(f.runtime.recordings.status(id).state, "cancelled");
  } finally {
    await f.close();
  }
});
test("action selectors cannot hide ambiguity with limit=1 in either direct control or recording", async (t) => {
  const f = await fixture(t);
  try {
    const tree = snapshot();
    tree.nodes.push({ ...tree.nodes[2]! });
    tree.query = new UiIndex(tree.nodes);
    const input = controlSchema.parse({
      action: "click",
      selector: { key: "submit", limit: 1 },
    });
    assert.throws(() => recordedStep(tree, draft(), input), {
      code: "RECORDING_TARGET_AMBIGUOUS",
    });
    const device = new DeviceService(f.runtime.processes, f.runtime.store);
    t.mock.method(device, "snapshot", async () => tree);
    const shell = t.mock.method(device, "shell", async () => {
      throw new Error("Ambiguous action reached the device");
    });
    await assert.rejects(device.control("device", input), {
      code: "UI_TARGET_AMBIGUOUS",
    });
    assert.equal(shell.mock.callCount(), 0);
  } finally {
    await f.close();
  }
});
test("runtime shutdown joins recorded controls and leaves an uncertain draft for inspection instead of silently saving it", async (t) => {
  const f = await fixture(t);
  try {
    const id = await start(f.runtime),
      entered = Promise.withResolvers<void>();
    let stopped = false;
    t.mock.method(
      f.runtime.devices,
      "control",
      async (...[, , signal]: Parameters<typeof f.runtime.devices.control>) => {
        entered.resolve();
        try {
          await delay(10000, undefined, { signal });
        } finally {
          stopped = true;
        }
        return { commandAccepted: true, outcomeVerified: false };
      },
    );
    const result = assert.rejects(
      f.runtime.call("ui_tap", { selector: { key: "submit" } }),
      { name: "AbortError" },
    );
    await entered.promise;
    await f.reopen();
    await result;
    assert.equal(stopped, true);
    assert.ok(f.runtime.recordings.status(id).uncertain_operation);
    assert.equal(f.runtime.recordings.status(id).step_count, 0);
    assert.ok(
      !fs.existsSync(path.join(f.project, ".arkpilot/flows/recorded.json")),
    );
    await f.runtime.call("ui_flow", {
      action: "record_cancel",
      recording_id: id,
    });
    assert.equal(f.runtime.recordings.status(id).state, "cancelled");
  } finally {
    await f.close();
  }
});
test("a prepared control snapshot is consumed once without a second dump and assertion alternatives cannot hide duplicate matches", async (t) => {
  const f = await fixture(t);
  try {
    const device = new DeviceService(f.runtime.processes, f.runtime.store);
    let dumps = 0,
      actions = 0;
    const receipt = {
      stdout: "",
      stderr: "",
      elapsedMs: 1,
      pid: null,
      exitCode: 0,
      signal: null,
      truncated: false,
    };
    t.mock.method(device, "shell", async (_target: string, args: string[]) => {
      if (args[1] === "dumpLayout") dumps++;
      if (args[1] === "uiInput") actions++;
      return receipt;
    });
    t.mock.method(device, "command", async (args: string[]) => {
      assert.equal(args[3], "recv");
      atomicWrite(
        args[5]!,
        JSON.stringify({
          attributes: {
            type: "WindowScene",
            bundleName: bundle,
            bounds: "[0,0][100,100]",
          },
          children: [
            {
              attributes: {
                id: "one",
                text: "Duplicate",
                type: "Button",
                bounds: "[1,1][10,10]",
              },
            },
            {
              attributes: {
                id: "two",
                text: "Duplicate",
                type: "Button",
                bounds: "[11,1][20,10]",
              },
            },
          ],
        }),
      );
      return receipt;
    });
    const prepared = await device.snapshot("device");
    await device.control(
      "device",
      { action: "click", selector: { key: "one" } },
      undefined,
      prepared,
    );
    assert.equal(dumps, 1);
    assert.equal(actions, 1);
    await assert.rejects(
      device.control(
        "device",
        { action: "click", selector: { key: "one" } },
        undefined,
        prepared,
      ),
      { code: "SNAPSHOT_EXPIRED" },
    );
    assert.equal(dumps, 1);
    assert.equal(actions, 1);
    await assert.rejects(
      device.verify("device", {
        visible: { text: "Missing" },
        alternates: [{ text: "Duplicate", limit: 1 }],
        timeoutMs: 500,
      }),
      { code: "UI_TARGET_AMBIGUOUS" },
    );
  } finally {
    await f.close();
  }
});
