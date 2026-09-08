import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { ProcessService, type ProcessResult } from "../src/core/process.js";
import { withTrace } from "../src/core/trace.js";
import { digest } from "../src/core/files.js";
import {
  WorkflowEngine,
  type WorkflowDefinition,
} from "../src/core/workflows.js";
import { DeviceService } from "../src/services/device.js";
import {
  DeviceEffectJournal,
  deviceReceiptScripts,
  parseDeviceReceipt,
} from "../src/services/device-effect.js";

const result = (
  stdout: string,
  changes: Partial<ProcessResult> = {},
): ProcessResult => ({
  stdout,
  stderr: "",
  exitCode: 0,
  signal: null,
  truncated: false,
  elapsedMs: 0,
  pid: null,
  ...changes,
});
const identity = digest("fixture");
const receipt = (body = "start ability successfully") =>
  `DEVECO_DEVICE_RECEIPT_V1\n${identity}\n0\n${body}`;

test("device receipt rejects mismatched, partial, oversized and truncated evidence", () => {
  assert.deepEqual(parseDeviceReceipt(result(receipt()), identity), {
    exitCode: 0,
    stdout: "start ability successfully",
  });
  for (const value of [
    "DEVECO_DEVICE_RECEIPT_PENDING\n",
    receipt().slice(0, 50),
    receipt().replace(identity, digest("different command")),
    receipt("x".repeat(65536)),
    receipt().replace("\n0\n", "\n999\n"),
  ])
    assert.equal(parseDeviceReceipt(result(value), identity), undefined);
  assert.equal(
    parseDeviceReceipt(result(receipt(), { truncated: true }), identity),
    undefined,
  );
  assert.equal(
    parseDeviceReceipt(result(receipt(), { exitCode: 1 }), identity),
    undefined,
  );
});

test("recovery without a local intent neither creates one nor contacts the device", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-no-intent-")),
    store = new StateStore(root);
  try {
    const journal = new DeviceEffectJournal(store, {
      shell: async () => {
        throw new Error("must not contact device");
      },
    });
    assert.equal(
      await withTrace({ run_id: "run", node: "launch" }, () =>
        journal.run(
          "device",
          "launch",
          ["aa", "start"],
          () => ({ accepted: true }),
          undefined,
          true,
        ),
      ),
      undefined,
    );
    assert.equal(
      (
        store.db.prepare("SELECT COUNT(*) AS count FROM operations").get() as {
          count: number;
        }
      ).count,
      0,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("local completion survives cleanup failure and rejects changed inputs on recovery", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-local-receipt-")),
    store = new StateStore(root);
  let reads = 0;
  try {
    await store.effect(
      "run",
      "launch:device:launch",
      { target: "device", args: ["aa", "start"] },
      async () => ({ accepted: true }),
    );
    const journal = new DeviceEffectJournal(store, {
      shell: async (_target, args) => {
        assert.equal(args[0], "rm");
        reads++;
        throw new Error("device disconnected during cleanup");
      },
    });
    assert.deepEqual(
      await withTrace({ run_id: "run", node: "launch" }, () =>
        journal.run(
          "device",
          "launch",
          ["aa", "start"],
          () => {
            throw new Error("must not parse remote evidence");
          },
          undefined,
          true,
        ),
      ),
      { accepted: true },
    );
    assert.equal(reads, 1);
    await assert.rejects(
      withTrace({ run_id: "run", node: "launch" }, () =>
        journal.run(
          "device",
          "launch",
          ["aa", "start", "--ps", "route", "different"],
          () => true,
          undefined,
          true,
        ),
      ),
      { code: "INPUT_CHANGED" },
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// HarmonyOS executes this POSIX script regardless of the host OS. Windows also
// runs the protocol/SQLite tests above; macOS and Linux execute the actual script.
if (process.platform !== "win32") {
  test("LangGraph resumes a lost launch response after reopening SQLite and continues subsequent verification", async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-launch-graph-")),
      processes = new ProcessService();
    let store = new StateStore(path.join(root, "state")),
      devices = new DeviceService(processes, store);
    let loseResponse = true,
      verifies = 0;
    const counter = path.join(root, "counter"),
      fakeAa = path.join(root, "aa");
    fs.writeFileSync(
      fakeAa,
      '#!/bin/sh\nprintf x >> "$DEVECO_TEST_COUNTER"\nprintf "start ability successfully\\n"\n',
      { mode: 0o700 },
    );
    const mockDevice = () =>
      t.mock.method(
        devices,
        "shell",
        async (_target: string, input: string[], signal?: AbortSignal) => {
          if (input[0] === "pidof") return result("1234\n");
          const mapped = input.map((value) =>
            value.replaceAll("/data/local/tmp/", root + "/"),
          );
          const output = await processes.run(
            {
              executable: mapped[0]!,
              args: mapped.slice(1),
              cwd: root,
              env: {
                ...process.env,
                PATH: root + path.delimiter + process.env.PATH,
                DEVECO_TEST_COUNTER: counter,
              },
            },
            { signal },
          );
          if (
            loseResponse &&
            input[0] === "sh" &&
            input[2]?.includes("mkdir -m 700")
          ) {
            loseResponse = false;
            throw new Error("transport lost the completed launch response");
          }
          return output;
        },
      );
    const app = {
      bundle_name: "com.deveco.fixture",
      module: "feature",
      ability: "DetailAbility",
      uri: "fixture://detail/123",
      parameters: { route: "中文详情", enabled: true, count: 2 },
    };
    const definition: WorkflowDefinition = {
      id: "launch",
      description: "fixture",
      capabilities: [],
      completion: "verified",
      resources: () => ["device:fixture"],
      steps: [
        {
          id: "launch_application",
          kind: "effect",
          execute: (call) => devices.launch("fixture", app, call.signal, true),
          reconcile: (call) =>
            devices.reconcileLaunch("fixture", app, call.signal),
        },
        {
          id: "verify",
          kind: "read",
          execute: async () => {
            verifies++;
            return { verified: true };
          },
        },
      ],
    };
    let engine = new WorkflowEngine(store, [definition], async () => {});
    const settle = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        const value = await engine.status(id, 100);
        if (!["running", "queued"].includes(value.status)) return value;
      }
      throw new Error("Workflow failed to settle");
    };
    try {
      mockDevice();
      const { run_id } = engine.start("launch", { parameters: app });
      assert.equal((await settle(run_id)).status, "needs_input");
      assert.equal(verifies, 0);
      assert.equal(fs.readFileSync(counter, "utf8"), "x");
      await assert.rejects(
        store.lease("device:fixture", async () => true),
        { code: "RESOURCE_RECOVERY_REQUIRED" },
      );
      await assert.rejects(engine.cancel(run_id), {
        code: "CANCEL_UNCONFIRMED",
      });
      await engine.close();
      devices.close();
      store.close();
      t.mock.restoreAll();
      store = new StateStore(path.join(root, "state"));
      devices = new DeviceService(processes, store);
      engine = new WorkflowEngine(store, [definition], async () => {});
      mockDevice();
      await engine.resume(run_id, { action: "recheck" });
      assert.equal((await settle(run_id)).status, "succeeded");
      assert.equal(verifies, 1);
      assert.equal(fs.readFileSync(counter, "utf8"), "x");
      assert.deepEqual(store.uncertainOperations(run_id), []);
      assert.deepEqual(store.externalGuards(), []);
      assert.equal(await store.lease("device:fixture", async () => true), true);
    } finally {
      await engine.close();
      devices.close();
      await processes.close();
      store.close();
      t.mock.restoreAll();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("device acknowledgement lost after command completion is recovered after host restart without replaying Want arguments", async () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "deveco-remote-receipt-"),
      ),
      processes = new ProcessService();
    let store = new StateStore(path.join(root, "state")),
      loseResponse = true,
      executions = 0;
    const literal = "中文 ' ; $(touch should-not-exist) `false` ",
      counter = path.join(root, "counter");
    const args = [
      "sh",
      "-c",
      'printf x >> "$1"; printf "%s" "$2"',
      "fixture",
      counter,
      literal,
    ];
    const transport = {
      shell: async (_target: string, input: string[], signal?: AbortSignal) => {
        const mapped = input.map((value) =>
          value.replaceAll("/data/local/tmp/", root + "/"),
        );
        const output = await processes.run(
          { executable: mapped[0]!, args: mapped.slice(1), cwd: root },
          { signal },
        );
        if (input[0] === "sh" && input[2]?.includes("mkdir -m 700")) {
          executions++;
          if (loseResponse) {
            loseResponse = false;
            throw new Error("host lost HDC response");
          }
        }
        return output;
      },
    };
    const accept = (value: { exitCode: number; stdout: string }) => {
      assert.equal(value.exitCode, 0);
      assert.equal(value.stdout, literal);
      return { accepted: true };
    };
    const run = (recovery: boolean) =>
      withTrace({ run_id: "run", node: "launch" }, () =>
        new DeviceEffectJournal(store, transport).run(
          "device",
          "launch",
          args,
          accept,
          undefined,
          recovery,
        ),
      );
    try {
      await assert.rejects(run(false), { code: "EFFECT_UNCERTAIN" });
      assert.equal(fs.readFileSync(counter, "utf8"), "x");
      store.close();
      store = new StateStore(path.join(root, "state"));
      assert.deepEqual(await run(true), { accepted: true });
      assert.equal(executions, 1);
      assert.equal(fs.readFileSync(counter, "utf8"), "x");
      assert.ok(!fs.existsSync(path.join(root, "should-not-exist")));
      assert.deepEqual(
        fs
          .readdirSync(root)
          .filter((name) => name.startsWith("deveco-mcp-op-")),
        [],
      );
      assert.deepEqual(await run(true), { accepted: true });
      assert.equal(executions, 1);
    } finally {
      store.close();
      await processes.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("an incomplete remote claim cannot replay a command and remote output stays bounded", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-remote-claim-")),
      processes = new ProcessService();
    const directory = path.join(root, "claim"),
      counter = path.join(root, "counter");
    try {
      fs.mkdirSync(directory);
      const scripts = deviceReceiptScripts(directory, identity, [
        "touch",
        counter,
      ]);
      const value = await processes.run({
        executable: "sh",
        args: ["-c", scripts.execute],
      });
      assert.equal(parseDeviceReceipt(value, identity), undefined);
      assert.ok(!fs.existsSync(counter));
      fs.rmSync(directory, { recursive: true });
      const noisy = deviceReceiptScripts(directory, identity, [
        "sh",
        "-c",
        "head -c 100000 /dev/zero",
      ]);
      const output = await processes.run({
        executable: "sh",
        args: ["-c", noisy.execute],
      });
      assert.equal(parseDeviceReceipt(output, identity), undefined);
      assert.equal(fs.statSync(path.join(directory, "output")).size, 65536);
      assert.ok(fs.statSync(path.join(directory, "receipt")).size < 66000);
    } finally {
      await processes.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
