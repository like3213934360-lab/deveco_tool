import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { StateStore } from "../src/core/store.js";
import { ProcessService, type ProcessResult } from "../src/core/process.js";
import { DeviceService } from "../src/services/device.js";
import {
  connectedTargets,
  deviceProperties,
} from "../src/services/device-info.js";
import { tools } from "../src/core/contracts.js";

const receipt = (stdout: string, truncated = false): ProcessResult => ({
  stdout,
  stderr: "",
  truncated,
  exitCode: 0,
  signal: null,
  elapsedMs: 0,
  pid: null,
});
test("device inventory never selects from partial, malformed, unauthorized or offline rows", () => {
  assert.deepEqual(connectedTargets(receipt("[Empty]\r\n")), []);
  assert.deepEqual(connectedTargets(receipt("")), []);
  assert.deepEqual(
    connectedTargets(
      receipt(
        "  device-A\r\n  device-B device\nlocked unauthorized\nstale offline\ndevice-A\n",
      ),
    ),
    ["device-A", "device-B"],
  );
  for (const output of [
    "[Empty]\ndevice-A",
    "[Unknown message]",
    "device-A unexpected",
    "device-A device extra",
    "-t",
    "\0id",
  ])
    assert.throws(() => connectedTargets(receipt(output)), {
      code: "DEVICE_INVENTORY_INVALID",
    });
  assert.throws(() => connectedTargets(receipt("only-visible-device", true)), {
    code: "DEVICE_INVENTORY_TRUNCATED",
  });
  assert.throws(
    () =>
      connectedTargets(
        receipt(Array.from({ length: 257 }, (_, n) => "device" + n).join("\n")),
      ),
    { code: "DEVICE_INVENTORY_LIMIT" },
  );
  assert.equal(
    tools.device_info.schema.safeParse({ list: true, target: "ignored" })
      .success,
    false,
  );
});

const params = [
  "const.product.name = 测试设备",
  "const.product.model = Model=A",
  "const.product.devicetype = phone",
  "const.product.cpu.abilist = arm64-v8a",
  "const.ohos.fullname = OpenHarmony-7.0.0.105",
  "const.ohos.apiversion = 26",
  "const.ohos.releasetype = Release",
].join("\n");
test("device metadata preserves absent values, evidence limits and emulator display names", () => {
  const full = deviceProperties(
    "192.168.1.2:5555",
    receipt(params + "\nunrelated.secret = hidden"),
  );
  assert.equal(full.name, "测试设备");
  assert.equal(full.device_type, "phone");
  assert.equal(full.os_version, "API 26 (Release)");
  assert.equal(full.properties["const.product.model"], "Model=A");
  assert.equal(full.properties["unrelated.secret"], undefined);
  assert.equal(full.complete, true);
  assert.equal(full.kind_source, "transport_address_heuristic");
  assert.deepEqual(full.missing_properties, []);
  const emulator = deviceProperties(
    "127.0.0.1:10001",
    receipt(params + "\nohos.qemu.hvd.name = 我的模拟器"),
  );
  assert.equal(emulator.name, "我的模拟器");
  assert.equal(emulator.kind, "emulator");
  assert.equal(emulator.kind_source, "device_property");
  const incomplete = deviceProperties(
    "device",
    receipt("const.product.devicetype = phone"),
  );
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.name, null);
  assert.equal(incomplete.os_version, null);
  assert.ok(incomplete.missing_properties.includes("const.product.model"));
  assert.ok(incomplete.missing_properties.includes("const.ohos.apiversion"));
  assert.equal(
    deviceProperties("device", receipt(params, true)).complete,
    false,
  );
  for (const output of [
    params + "\nconst.product.model = different",
    "const.product.name =\n" + params,
    params + "\nconst.product.name =",
  ])
    assert.throws(() => deviceProperties("device", receipt(output)), {
      code: "DEVICE_PROPERTIES_INVALID",
    });
});

test("explicit device selection remains fixed and cannot fall back after disconnect or ignore shell failure", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-device-info-")),
    store = new StateStore(root),
    processes = new ProcessService(),
    service = new DeviceService(processes, store);
  let inventory = "A\nB\n",
    truncated = false,
    shellExit = 0;
  const calls: string[][] = [];
  t.mock.method(service, "command", async (args: string[]) => {
    calls.push(args);
    if (args[0] === "list") return receipt(inventory, truncated);
    assert.equal(args[0], "-t");
    assert.equal(args[1], "B");
    const marker = args[3]?.match(/__DEVECO_EXIT_[a-f0-9]+__=/)?.[0];
    assert.ok(marker);
    return receipt(`${params}\n${marker}${shellExit}\n`);
  });
  try {
    await assert.rejects(service.info(), { code: "DEVICE_AMBIGUOUS" });
    assert.equal(
      calls.some((args) => args[0] === "-t"),
      false,
    );
    const result = await service.info("B");
    assert.equal(result.target, "B");
    assert.equal(result.complete, true);
    inventory = "A\n";
    await assert.rejects(service.info("B"), { code: "DEVICE_NOT_FOUND" });
    assert.equal(calls.filter((args) => args[0] === "-t").length, 1);
    inventory = "B\n";
    truncated = true;
    await assert.rejects(service.info(), {
      code: "DEVICE_INVENTORY_TRUNCATED",
    });
    assert.equal(calls.filter((args) => args[0] === "-t").length, 1);
    truncated = false;
    shellExit = 13;
    await assert.rejects(service.info("B"), { code: "HDC_REMOTE_FAILED" });
  } finally {
    service.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
