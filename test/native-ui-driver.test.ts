import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { textComponent } from "../src/services/text-component.js";
import { inspectUiDriver } from "../src/services/ui-driver.js";
import { ToolError } from "../src/core/errors.js";
import type { ProcessResult } from "../src/core/process.js";

const receipt = (stdout: string, truncated = false): ProcessResult => ({
  stdout,
  stderr: "",
  truncated,
  exitCode: 0,
  signal: null,
  elapsedMs: 1,
  pid: null,
});

test("native text selection uses the same bounded protocol and architecture requirements as doctor", () => {
  for (const machine of ["aarch64", "arm64"]) {
    const result = textComponent(machine, "6.0.2.2");
    assert.equal(result.asset, "uitest_agent_v1.2.2.so");
    assert.equal(result.endpoint, "localabstract:uitest_socket");
  }
  assert.equal(textComponent("x86_64", "7.0.0.0").endpoint, "tcp:8012");
  assert.equal(
    textComponent("x86_64", "6.0.2.10").asset,
    "uitest_agent_v1.1.9.x86_64.so",
  );
  for (const [machine, version] of [
    ["armv7l", "6.0.2.2"],
    ["aarch64", "6.0.2.1"],
    ["x86_64", "5.99.99.99"],
    ["x86_64", "version 6.0.2.2"],
    ["x86_64", "999999999999999.0.0.0"],
    ["x86_64", "6.0.2.2-extra"],
  ])
    assert.throws(() => textComponent(machine!, version!), {
      code: "UI_TEXT_UNSUPPORTED",
    });
});

test("doctor does not probe implicitly and explicit probing only reads its fixed device under a lease", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-ui-driver-"));
  const previous = process.env.DEVECO_STATE_DIR;
  process.env.DEVECO_STATE_DIR = root;
  const runtime = new Runtime();
  const calls: string[][] = [];
  let targetReads = 0,
    machine = "aarch64",
    version = "6.0.2.2",
    truncated = false;
  t.mock.method(runtime.devices, "target", async (target?: string) => {
    targetReads++;
    assert.equal(target, "chosen");
    return target;
  });
  t.mock.method(
    runtime.devices,
    "shell",
    async (target: string, args: string[]) => {
      assert.equal(target, "chosen");
      assert.ok(
        runtime.store.db
          .prepare("SELECT resource FROM leases WHERE resource=?")
          .get("device:chosen"),
      );
      calls.push(args);
      if (args[0] === "uname") {
        assert.deepEqual(args, ["uname", "-m"]);
        return receipt(machine);
      }
      assert.deepEqual(args, ["uitest", "--version"]);
      return receipt(version, truncated);
    },
  );
  try {
    const schema = z.object({
      ui_driver: z.object({
        status: z.string(),
        operation_verified: z.literal(false),
        text_input: z.object({
          status: z.string(),
          component: z.string().nullable(),
        }),
      }),
    });
    assert.equal(
      schema.parse(await runtime.call("deveco_doctor", {})).ui_driver.status,
      "not_probed",
    );
    assert.equal(targetReads, 0);
    assert.equal(calls.length, 0);
    const doctor = schema.parse(
      await runtime.call("deveco_doctor", { target: "chosen" }),
    ).ui_driver;
    assert.equal(doctor.status, "detected");
    assert.equal(doctor.text_input.status, "component_detected");
    assert.equal(doctor.text_input.component, "uitest_agent_v1.2.2.so");
    assert.deepEqual(calls, [
      ["uname", "-m"],
      ["uitest", "--version"],
    ]);
    machine = "x86_64";
    assert.equal(
      (await inspectUiDriver(runtime.devices, "chosen")).text_input.component,
      "uitest_agent_v1.1.9.x86_64.so",
    );
    machine = "riscv64";
    const unsupported = await inspectUiDriver(runtime.devices, "chosen");
    assert.equal(unsupported.status, "detected");
    assert.equal(unsupported.text_input.status, "unavailable");
    assert.equal(unsupported.text_input.error?.code, "UI_TEXT_UNSUPPORTED");
    machine = "aarch64";
    version = "unknown";
    assert.equal(
      (await inspectUiDriver(runtime.devices, "chosen")).error?.code,
      "UI_DRIVER_PROBE_INVALID",
    );
    version = "6.0.2.2";
    truncated = true;
    assert.equal(
      (await inspectUiDriver(runtime.devices, "chosen")).error?.code,
      "UI_DRIVER_PROBE_INVALID",
    );
    assert.equal(
      runtime.store.db.prepare("SELECT resource FROM leases").all().length,
      0,
    );
  } finally {
    await runtime.close();
    if (previous === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("doctor reports a disconnected explicit target without fallback and propagates cancellation before any mutation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-driver-cancel-")),
    previous = process.env.DEVECO_STATE_DIR;
  process.env.DEVECO_STATE_DIR = root;
  const runtime = new Runtime();
  try {
    let shells = 0;
    t.mock.method(runtime.devices, "target", async () => {
      throw new ToolError("DEVICE_NOT_FOUND", "Disconnected");
    });
    t.mock.method(runtime.devices, "shell", async () => {
      shells++;
      return receipt("");
    });
    assert.equal(
      (await inspectUiDriver(runtime.devices, "chosen")).error?.code,
      "DEVICE_NOT_FOUND",
    );
    assert.equal(shells, 0);
    t.mock.method(runtime.devices, "target", async () => "chosen");
    const started = Promise.withResolvers<void>();
    t.mock.method(
      runtime.devices,
      "shell",
      async (_target: string, args: string[], signal?: AbortSignal) => {
        assert.deepEqual(args, ["uname", "-m"]);
        started.resolve();
        await delay(10000, undefined, { signal });
        throw new Error("Probe did not cancel");
      },
    );
    const controller = new AbortController(),
      cause = new ToolError("CANCELLED", "Stop the probe");
    const pending = inspectUiDriver(
      runtime.devices,
      "chosen",
      controller.signal,
    );
    await started.promise;
    controller.abort(cause);
    await assert.rejects(pending, cause);
    assert.equal(
      runtime.store.db.prepare("SELECT resource FROM leases").all().length,
      0,
    );
  } finally {
    await runtime.close();
    if (previous === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
