import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import {
  DeviceService,
  flattenDump,
  UiIndex,
  type Snapshot,
} from "../src/services/device.js";
import { FlowService } from "../src/services/flow.js";
import type { Project } from "../src/services/project.js";
import { flowSchema } from "../src/core/contracts.js";

function tree(labels: string[], bundle = "com.example.test") {
  return flattenDump({
    attributes: {
      type: "WindowScene",
      id: "session42",
      bundleName: bundle,
      focused: "true",
      bounds: "[100,200][150,250]",
    },
    children: labels.map((text, index) => ({
      attributes: {
        text,
        id: `key-${index}`,
        bounds: `[101,201][120,220]`,
        enabled: true,
      },
    })),
  });
}
class FixtureDevice extends DeviceService {
  actions: unknown[] = [];
  reads = 0;
  result = false;
  labels = ["Submit"];
  bundle = "com.example.test";
  delayed = false;
  otherApplication = false;
  override async snapshot(
    target: string,
    signal?: AbortSignal,
  ): Promise<Snapshot> {
    signal?.throwIfAborted();
    this.reads++;
    const labels = this.result
      ? ["Done"]
      : this.delayed && this.reads < 3
        ? []
        : this.labels;
    const nodes = [
      ...tree(labels, this.bundle),
      ...(this.otherApplication
        ? tree(["Submit"], "com.other.application")
        : []),
    ];
    return {
      id: "snapshot",
      device: target,
      created: Date.now(),
      nodes,
      query: new UiIndex(nodes),
      signature: "signature",
      structureSignature: "structure",
    };
  }
  override async control(_target: string, raw: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    this.actions.push(raw);
    return { commandAccepted: true, outcomeVerified: false };
  }
}
function fixture() {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-flow-")),
    ),
    store = new StateStore(path.join(root, "state"));
  const project: Project = {
    root,
    product: {
      name: "default",
      compatibleSdkVersion: 26,
      runtimeOS: "HarmonyOS",
    },
    modules: [],
    fingerprint: "fixture",
  };
  const device = new FixtureDevice(new ProcessService(), store),
    flows = new FlowService(device, store);
  const draft = (steps: unknown[], final = "Submit") =>
    flowSchema.parse({
      version: 1,
      id: "example",
      name: "Example",
      app: {
        bundleName: "com.example.test",
        module: "entry",
        ability: "EntryAbility",
      },
      start: { mode: "attach" },
      variables: {},
      steps,
      assert: { visible: { text: final, textMode: "exact" }, timeoutMs: 200 },
    });
  return {
    root,
    store,
    project,
    device,
    flows,
    draft,
    close() {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
test("saved flows wait for visibility without turning a missing first snapshot into a selector repair failure", async () => {
  const f = fixture();
  try {
    f.device.delayed = true;
    await f.flows.save(
      f.project,
      f.draft([
        {
          id: "wait",
          action: "waitVisible",
          selector: { text: "Submit" },
          timeoutMs: 1000,
        },
      ]),
    );
    const result = await f.flows.run(f.project, "example", "device", {});
    assert.equal(result.verified, true);
    assert.equal(result.selector_repairs_saved, false);
    assert.ok(f.device.reads >= 3);
    assert.equal(f.device.actions.length, 0);
  } finally {
    f.close();
  }
});
test("an ambiguous semantic alternative cannot be ignored in favor of a convenient unique match", async () => {
  const f = fixture();
  try {
    f.device.labels = ["Submit", "Submit", "Other"];
    await f.flows.save(
      f.project,
      f.draft([
        {
          id: "tap",
          action: "tap",
          timeoutMs: 300,
          selector: { key: "missing" },
          alternates: [{ text: "Submit", limit: 1 }, { text: "Other" }],
        },
      ]),
    );
    await assert.rejects(f.flows.run(f.project, "example", "device", {}), {
      code: "FLOW_TARGET_AMBIGUOUS",
    });
    assert.equal(f.device.actions.length, 0);
  } finally {
    f.close();
  }
});
test("selector repairs are saved only after the unchanged final assertion succeeds", async () => {
  const f = fixture();
  try {
    await f.flows.save(
      f.project,
      f.draft(
        [
          {
            id: "tap",
            action: "tap",
            timeoutMs: 300,
            selector: { key: "missing", text: "Submit" },
          },
        ],
        "Done",
      ),
    );
    const file = path.join(f.root, ".arkpilot/flows/example.json"),
      before = fs.readFileSync(file, "utf8");
    await assert.rejects(f.flows.run(f.project, "example", "device", {}), {
      code: "VERIFICATION_FAILED",
    });
    assert.equal(fs.readFileSync(file, "utf8"), before);
    f.device.control = async (_target, raw) => {
      f.device.actions.push(raw);
      f.device.result = true;
      return { commandAccepted: true, outcomeVerified: false };
    };
    const result = await f.flows.run(f.project, "example", "device", {});
    assert.equal(result.selector_repairs_saved, true);
    assert.equal(
      f.flows.read(f.project, "example").steps[0]?.selector?.key,
      undefined,
    );
    assert.deepEqual(
      f.flows.read(f.project, "example").assert,
      f.draft([], "Done").assert,
    );
  } finally {
    f.close();
  }
});
test("saved-flow action uniqueness cannot be bypassed by selector limit=1", async () => {
  const f = fixture();
  try {
    f.device.labels = ["Submit", "Submit"];
    await f.flows.save(
      f.project,
      f.draft([
        { id: "tap", action: "tap", selector: { text: "Submit", limit: 1 } },
      ]),
    );
    await assert.rejects(f.flows.run(f.project, "example", "device", {}), {
      code: "FLOW_TARGET_AMBIGUOUS",
    });
    assert.equal(f.device.actions.length, 0);
  } finally {
    f.close();
  }
});
test("a matching label in another application never permits a saved flow action", async () => {
  const f = fixture();
  try {
    f.device.bundle = "com.other.application";
    await f.flows.save(
      f.project,
      f.draft([
        {
          id: "tap",
          action: "tap",
          timeoutMs: 200,
          selector: { text: "Submit" },
        },
      ]),
    );
    await assert.rejects(f.flows.run(f.project, "example", "device", {}), {
      code: "FLOW_APP_UI_NOT_READY",
    });
    assert.equal(f.device.actions.length, 0);
  } finally {
    f.close();
  }
});
test("saved replay scopes primary and repaired indexes to the requested application in a mixed snapshot", async () => {
  const f = fixture();
  try {
    f.device.otherApplication = true;
    await f.flows.save(
      f.project,
      f.draft([
        {
          id: "tap",
          action: "tap",
          selector: { text: "Submit", textMode: "exact" },
        },
      ]),
    );
    assert.equal(
      (await f.flows.run(f.project, "example", "device", {})).verified,
      true,
    );
    assert.equal(f.device.actions.length, 1);
    f.device.labels = ["Something else"];
    await f.flows.save(
      f.project,
      f.draft([
        {
          id: "tap",
          action: "tap",
          selector: { key: "missing" },
          alternates: [{ text: "Submit" }],
        },
      ]),
      true,
    );
    await assert.rejects(f.flows.run(f.project, "example", "device", {}), {
      code: "FLOW_TARGET_MISSING",
    });
    assert.equal(f.device.actions.length, 1);
  } finally {
    f.close();
  }
});
test("percentage gestures use the identified application surface and stay inside its last pixel", async (t) => {
  const f = fixture();
  try {
    t.mock.method(f.device, "control", DeviceService.prototype.control.bind(f.device));
    const shell = t.mock.method(f.device, "shell", async () => ({ stdout: "No Error", stderr: "", elapsedMs: 1, pid: null, exitCode: 0, signal: null, truncated: false }));
    await f.flows.save(
      f.project,
      f.draft([
        {
          id: "tap",
          action: "tap",
          timeoutMs: 300,
          point: { xPercent: 100, yPercent: 100 },
        },
      ]),
    );
    await f.flows.run(f.project, "example", "device", {});
    assert.equal(shell.mock.callCount(), 1);
    assert.deepEqual(shell.mock.calls[0]!.arguments.slice(0, 2), ["device", ["uitest", "uiInput", "click", "149", "249"]]);
  } finally {
    f.close();
  }
});
test("a hidden assertion cannot pass while one of its recorded alternatives remains visible", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.device.verify("device", {
        hidden: { text: "Missing" },
        alternates: [{ text: "Submit" }],
        timeoutMs: 100,
      }),
      { code: "VERIFICATION_FAILED" },
    );
  } finally {
    f.close();
  }
});
