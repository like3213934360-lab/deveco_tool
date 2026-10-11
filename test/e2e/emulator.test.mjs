// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { session, required } from "../support/acceptance.mjs";

test("emulator", async (t) => {
  const { call, raw, directory, run, defer } = await session(t);

  const os_version = required("E2E_IMAGE"), name = `deveco_test_${Date.now()}`;
  const before = (await call("emulator", { action: "list", details: true })).emulators;
  fs.writeFileSync(path.join(directory, `${run}-instances.json`), JSON.stringify(before, null, 2));
  let target, created = false;
  defer(async () => {
    if (!created) return;
    const instance = (await call("emulator", { action: "list" })).emulators.find((e) => e.name === name);
    if (instance?.running) await call("emulator", { action: "stop", name });
    if (instance) await call("emulator", { action: "delete", name });
  });
  await t.test("emulator.license-idempotent", async () => assert.equal((await call("emulator", { action: "license" })).accepted, true));
  await t.test("emulator.create", async () => {
    assert.equal((await call("emulator", { action: "create", name, device_type: "foldable", os_version, auto_accept_license: false })).created, name);
    created = true;
    const d = (await call("emulator", { action: "list", details: true })).emulators.find((e) => e.name === name);
    assert.equal(d.deviceType, "foldable"); assert.equal(d.isRunning, "false");
  });
  await t.test("emulator.start-coldboot", async () => {
    const d = await call("emulator", { action: "start", name, boot_mode: "coldboot", auto_accept_license: false });
    assert.equal(d.boot_completed, true); assert.equal(d.started, name); target = d.target;
    assert.ok(target);
    assert.equal((await call("device", { action: "shell", target, command: "param get ohos.qemu.hvd.name" })).output.trim(), name);
  });
  await t.test("emulator.reject-delete-running", async () => {
    const d = await raw("emulator", { action: "delete", name });
    assert.equal(d.isError, true); assert.equal(d.data.error.code, "CONFLICT");
  });
  await t.test("emulator.single-name-and-names-equivalent", async () => {
    const one = await call("emulator", { action: "start", name });
    const many = await call("emulator", { action: "start", names: [name] });
    assert.equal(one.already_running, true); assert.deepEqual(many, one);
  });
  await t.test("emulator.scenario-fold-real-screen", async () => {
    assert.ok(target, "start must succeed first");
    const sizes = [];
    for (const state of ["close", "open"]) {
      const d = await call("emulator", { action: "scenario", name, scenario: "fold", state });
      assert.equal(d.applied, "fold"); assert.equal(d.accepted, true);
      const screen = (await call("device", { action: "info", target })).screen;
      assert.ok(screen.width > 0 && screen.height > 0); sizes.push(screen);
    }
    assert.notDeepEqual(sizes[0], sizes[1], "fold must actually change the display dimensions");
  });
  await t.test("emulator.stop", async () => {
    assert.equal((await call("emulator", { action: "stop", name })).stopped, name);
    assert.equal((await call("emulator", { action: "list" })).emulators.find((e) => e.name === name).running, false);
    if (target) assert.equal((await call("device", { action: "list" })).devices.some((d) => d.target === target), false);
  });
  await t.test("emulator.delete", async () => {
    assert.equal((await call("emulator", { action: "delete", name })).deleted, name);
    created = false;
    const after = (await call("emulator", { action: "list", details: true })).emulators;
    assert.deepEqual(after, before, "existing instances and their settings must stay intact");
  });

});

test("emulator image lifecycle", async (t) => {
  const device_type = required("E2E_DEVICE_TYPE"), os_version = required("E2E_IMAGE");
  assert.equal(required("E2E_ALLOW_IMAGE_WRITE"), "1", "Image lifecycle is an explicit destructive test, not ordinary E2E");
  const { call, raw, defer } = await session(t);
  const downloaded = async () => (await call("emulator", { action: "images", device_type })).images.some((i) => i.os_version === os_version && i.downloaded);
  assert.equal(await downloaded(), false, "Refuse to remove a pre-existing user image");
  let installed = false;
  defer(async () => { if (installed) await call("emulator", { action: "remove_image", device_type, os_version }); });
  const created = await call("emulator", { action: "install_image", device_type, os_version });
  installed = true;
  assert.equal(await downloaded(), true); assert.ok(created.bytes > 0 && created.output.length < 700);
  await call("emulator", { action: "remove_image", device_type, os_version }); installed = false;
  assert.equal(await downloaded(), false);
  const again = await raw("emulator", { action: "remove_image", device_type, os_version });
  assert.equal(again.isError, true); assert.equal(again.data.error.code, "NOT_FOUND");
  assert.equal((await raw("emulator", { action: "install_image", device_type, os_version: "HarmonyOS 0.0.0(1)" })).isError, true);
});
