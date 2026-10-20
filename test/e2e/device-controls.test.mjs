// Run one explicit top-level name at a time, after the shared build; see test/README.md.
// "device controls": E2E_DIR, E2E_PROJECT (dedicated app), E2E_TARGET, E2E_DEVICE_KIND.
// Install fixtures/device-controls/ControlMarkers.ets beside EntryAbility and call createControlMarkers(this.context, want) from onCreate.
// "disposable emulator system controls": E2E_DIR, E2E_TARGET, E2E_DEVICE_KIND=emulator,
// E2E_ALLOW_SYSTEM_WRITE=1; only a newly created disposable emulator. No cloud or signing calls.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { app, required, session, sha } from "../support/acceptance.mjs";
import { waitJob } from "../support/mcp.mjs";

async function bundles(device) {
  const names = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const result = await device({ action: "app", operation: "list", offset, limit: 200 });
    assert.ok(Array.isArray(result.bundles));
    names.push(...result.bundles);
    if (result.next_offset === null) {
      assert.equal(names.length, result.total);
      assert.equal(new Set(names).size, names.length);
      return names;
    }
    assert.ok(Number.isInteger(result.next_offset) && result.next_offset > offset, "bundle pagination must advance");
    offset = result.next_offset;
  }
  assert.fail("Bundle inventory exceeded the bounded pagination budget");
}

async function foreground(device, bundle, present) {
  const deadline = performance.now() + 10000;
  let result;
  do {
    result = await device({ action: "app", operation: "foreground" });
    if (result.applications.some((a) => a.bundle === bundle) === present) return result;
    await delay(250);
  } while (performance.now() < deadline);
  assert.fail(`Dedicated app foreground did not become ${present}: ${JSON.stringify(result)}`);
}

test("device controls", async (t) => {
  const { call, raw, client, job, directory, target, project, bundle, receipt, defer } = await app(t);
  const device = (args) => call("device", { target, ...args });
  const rejected = async (args, code = "INVALID_INPUT") => {
    const result = await raw("device", { target, ...args });
    assert.equal(result.isError, true); assert.equal(result.data.error.code, code);
  };
  const marker = path.join(directory, "owned-marker.txt");
  fs.writeFileSync(marker, `device-controls ${crypto.randomUUID()}\n`, { flag: "wx", mode: 0o600 });
  const owned = new Set();
  const put = async (remote) => {
    assert.equal((await device({ action: "file", operation: "exists", remote })).exists, false);
    owned.add(remote); // A failed transfer can still leave a partial, test-owned file.
    await device({ action: "send", local: marker, remote });
    const current = await device({ action: "file", operation: "exists", remote });
    assert.equal(current.exists, true); assert.equal(current.kind, "file");
  };
  defer(async () => {
    const errors = [];
    for (const remote of owned) {
      try {
        const current = await device({ action: "file", operation: "exists", remote });
        if (current.exists) {
          assert.equal(current.kind, "file", "Do not remove a changed marker path");
          assert.equal((await device({ action: "file", operation: "delete", remote })).deleted, true);
        }
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Owned marker cleanup failed");
  });

  await t.test("dedicated app install, lifecycle, cache/data authorization and uninstall", async () => {
    const helper = path.join(project, "entry/src/main/ets/entryability/ControlMarkers.ets");
    assert.ok(fs.existsSync(helper), "Explicitly install the ControlMarkers fixture in this dedicated project before running");
    assert.equal(sha(fs.readFileSync(helper)), sha(fs.readFileSync(new URL("../fixtures/device-controls/ControlMarkers.ets", import.meta.url))), "The dedicated project must use the current marker fixture");
    const built = await job("project", { action: "build", project, wait: 0 });
    const files = built.result.artifacts.filter((a) => /-signed\.hap$/.test(a.path)).map((a) => a.path);
    assert.equal(files.length, 1, "Select a dedicated single-HAP project with existing local signing");
    const installed = await waitJob(call, await device({ action: "app", operation: "install", files, replace: true, wait: 0 }));
    assert.equal(installed.status, "succeeded", JSON.stringify(installed));
    assert.deepEqual(installed.result.installed, files.map((file) => path.basename(file)));
    assert.ok((await bundles(device)).includes(bundle));
    const info = await device({ action: "app", operation: "info", bundle });
    assert.equal(info.bundle, bundle);
    const entry = info.modules.find((m) => m.name === info.entry_module);
    assert.ok(entry?.main_ability, "Installed entry module must expose its main ability");
    assert.match(entry.name, /^[A-Za-z_][A-Za-z0-9_.-]*$/, "Installed module name must be a single safe path component");
    // UIAbilityContext uses module directories; select this path before the fixed cold-start probe.
    const base = `/data/app/el2/100/base/${bundle}/haps/${entry.name}`, suffix = `deveco-controls-${crypto.randomUUID()}.txt`;
    const cache = `${base}/cache/${suffix}`, data = `${base}/files/${suffix}`;
    for (const remote of [cache, data]) {
      assert.equal((await device({ action: "file", operation: "exists", remote })).exists, false);
      owned.add(remote);
    }
    assert.equal((await device({ action: "app", operation: "stop", bundle })).command_confirmed, true);
    await foreground(device, bundle, false);
    const start = await device({ action: "app", operation: "start", bundle, ability: entry.main_ability, module: entry.name,
      want: { parameters: { devecoControlsMarker: suffix } } });
    assert.equal(start.command_confirmed, true); assert.equal(start.runtime_verified, false);
    await foreground(device, bundle, true);
    for (const remote of [cache, data]) {
      const current = await device({ action: "file", operation: "exists", remote });
      assert.equal(current.exists, true, "UIAbility.onCreate must create the requested app-owned marker");
      assert.equal(current.kind, "file");
    }
    assert.equal((await device({ action: "app", operation: "stop", bundle })).command_confirmed, true);
    await foreground(device, bundle, false);
    for (const remote of [`${base}/cache`, `${base}/files`]) {
      const current = await device({ action: "file", operation: "exists", remote });
      assert.equal(current.exists, true, "The dedicated app must initialize its cache/files directories");
      assert.equal(current.kind, "directory");
    }
    await rejected({ action: "file", operation: "delete", remote: `${base}/cache` });
    assert.equal((await device({ action: "file", operation: "exists", remote: cache })).exists, true, "directory rejection preserves its owned marker");
    for (const operation of ["clear_data", "uninstall"]) {
      await rejected({ action: "app", operation, bundle }, "DATA_RESET_REQUIRED");
      assert.equal((await device({ action: "file", operation: "exists", remote: data })).exists, true);
      assert.ok((await bundles(device)).includes(bundle));
    }
    assert.equal((await device({ action: "app", operation: "clear_cache", bundle })).cache_cleared, true);
    assert.equal((await device({ action: "file", operation: "exists", remote: cache })).exists, false);
    assert.equal((await device({ action: "file", operation: "exists", remote: data })).exists, true, "cache cleanup must not clear app files");
    const reset = await device({ action: "app", operation: "clear_data", bundle, allow_data_reset: true });
    assert.equal(reset.data_reset, true); assert.equal(reset.installation_preserved, true);
    assert.equal((await device({ action: "file", operation: "exists", remote: data })).exists, false);
    assert.equal((await device({ action: "app", operation: "info", bundle })).bundle, bundle);
    // On success leave the dedicated app uninstalled. On failure do not replay install/uninstall.
    assert.equal((await device({ action: "app", operation: "uninstall", bundle, allow_data_reset: true })).uninstalled, true);
    assert.equal((await bundles(device)).includes(bundle), false);
  });

  await t.test("owned temporary file exists, delete and missing-path receipts", async () => {
    const remote = `/data/local/tmp/deveco-controls-${crypto.randomUUID()}.txt`;
    const missing = await device({ action: "file", operation: "exists", remote });
    assert.equal(missing.exists, false); assert.equal(missing.kind, "missing");
    await put(remote);
    const received = path.join(directory, "marker-return.txt");
    await device({ action: "recv", remote, local: received });
    assert.equal(sha(fs.readFileSync(received)), sha(fs.readFileSync(marker)));
    const deleted = await device({ action: "file", operation: "delete", remote });
    assert.equal(deleted.deleted, true); assert.equal(deleted.path, remote);
    assert.equal((await device({ action: "file", operation: "exists", remote })).exists, false);
    const again = await device({ action: "file", operation: "delete", remote });
    assert.equal(again.deleted, false); assert.equal(again.reason, "not_found");
    owned.delete(remote);
  });

  await t.test("clipboard special characters and clear restore the private original", async () => {
    // Never use session call/raw here: they persist arguments and results to calls.jsonl.
    const clipboard = async (operation, text) => {
      let result;
      try { result = await client.call("device", { action: "clipboard", target, operation, ...(text === undefined ? {} : { text }) }); }
      catch { throw new Error(`Private clipboard ${operation} transport failed; content omitted`); }
      if (result.isError) {
        const code = result.data?.error?.code;
        throw new Error(`Private clipboard ${operation} failed (${typeof code === "string" && /^[A-Z_]{1,64}$/.test(code) ? code : "UNKNOWN"}); content omitted`);
      }
      return result.data;
    };
    const original = (await clipboard("read")).text;
    assert.equal(typeof original, "string");
    assert.ok(original.length <= 16384 && !original.includes("\0"), "Original clipboard must be restorable before any write");
    const before = { sha256: sha(original), bytes: Buffer.byteLength(original) };
    receipt("clipboard-before.json", before);
    const errors = [];
    try {
      const text = "  Error: copied diagnostic 'single' \"double\" $value `literal` ; $(not-a-command)\n鸿蒙\ttrailing spaces  \n";
      const written = await clipboard("write", text);
      assert.equal(written.command_confirmed, true); assert.equal(written.content_verified, true);
      const readback = (await clipboard("read")).text;
      assert.equal(typeof readback, "string");
      assert.equal(sha(readback), sha(text), "Clipboard special-character readback hash");
      receipt("clipboard-written.json", { sha256: sha(readback), bytes: Buffer.byteLength(readback) });
      assert.equal((await clipboard("clear")).content_verified, true);
      const cleared = (await clipboard("read")).text;
      assert.equal(typeof cleared, "string"); assert.equal(Buffer.byteLength(cleared), 0);
    } catch (error) { errors.push(error); }
    finally {
      try {
        assert.equal((await clipboard("write", original)).content_verified, true);
        const restored = (await clipboard("read")).text;
        assert.equal(typeof restored, "string");
        const after = { sha256: sha(restored), bytes: Buffer.byteLength(restored) };
        receipt("clipboard-restored.json", after);
        assert.deepEqual(after, before, "Clipboard original restored (hash/length only)");
      } catch (error) { errors.push(error); }
    }
    // clipboard() already sanitizes failures; never attach its raw result or original text as a cause.
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Clipboard operation and restoration failed");
  });

  for (const [operation, check] of [
    ["size", (result) => assert.ok(result.screen.width > 0 && result.screen.height > 0)],
    ["status", (result) => assert.ok(result.state)],
    ["rotation", (result) => assert.ok([0, 1, 2, 3].includes(result.rotation))],
    ["viewmode", (result) => assert.ok(["light", "dark"].includes(result.value))],
  ]) await t.test(`screen ${operation} query is read-only`, async () => check(await device({ action: "screen", operation })));
  for (const operation of ["time", "timezone"]) await t.test(`system ${operation} query is read-only`, async () => {
    const result = await device({ action: "system", operation });
    assert.match(result.value, operation === "time" ? /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/ : /^[A-Za-z0-9_+\-/]+$/);
    assert.equal(result.previous, result.value);
  });

  await t.test("control parameter rejection happens before any mutation", async () => {
    for (const args of [
      { action: "screen", operation: "size", value: 1 },
      { action: "screen", operation: "rotate", value: 4 },
      { action: "screen", operation: "rotation_lock", value: "true" },
      { action: "screen", operation: "sleeptime", value: 4999 },
      { action: "screen", operation: "viewmode", value: "automatic" },
      { action: "system", operation: "time", value: 1 },
      { action: "system", operation: "time", value: "2026-02-30 10:00:00" },
      { action: "system", operation: "timezone", value: "UTC;reboot" },
      { action: "system", operation: "unlock", value: "unused" },
    ]) await rejected(args);
  });
  // Query even after a failed subtest; record actual installation state without a recovery mutation.
  receipt("app-final-state.json", { bundle, installed: (await bundles(device)).includes(bundle), data_restored: false });
});

test("disposable emulator system controls", async (t) => {
  assert.equal(required("E2E_DEVICE_KIND"), "emulator", "System writes are forbidden on physical devices");
  assert.equal(required("E2E_ALLOW_SYSTEM_WRITE"), "1", "System writes require explicit disposable-emulator authorization");
  const target = required("E2E_TARGET"), { call, receipt } = await session(t);
  const device = (args) => call("device", { target, ...args });
  const screen = (operation, value) => device({ action: "screen", operation, ...(value === undefined ? {} : { value }) });
  const system = (operation, value) => device({ action: "system", operation, ...(value === undefined ? {} : { value }) });
  const ui = (args) => call("ui", { target, ...args });
  const info = await device({ action: "info" });
  assert.ok(info.emulator?.name && /emulator/i.test(`${info.model} ${info.name}`), "Selected target must be the disposable running emulator");

  await t.test("sleep, wake and unprotected lockscreen gesture have independent observations", async () => {
    assert.equal((await screen("status")).state, "AWAKE", "Start the disposable emulator awake, before changing power state");
    const errors = [];
    try {
      assert.equal((await screen("sleep")).verified, true);
      assert.ok(["SLEEP", "INACTIVE"].includes((await screen("status")).state));
      assert.equal((await screen("wake")).verified, true);
      assert.equal((await screen("status")).state, "AWAKE");
      const unlocked = await system("unlock");
      assert.equal(unlocked.command_confirmed, true); assert.equal(unlocked.state_verified, false);
      const windows = (await ui({ action: "windows", all: true })).windows;
      assert.ok(windows.some((w) => w.focused && w.visible));
      assert.equal(windows.some((w) => w.visible && w.type === 2110), false, "A visible credential lockscreen must fail, never be bypassed");
      assert.ok((await ui({ action: "tree", depth: 8, limit: 100 })).nodes > 0);
      receipt("unlock-observation.json", { screen: (await screen("status")).state, keyguard_visible: false, setter_state_verified: unlocked.state_verified, scope: "visible platform windows only; no credential-unlock claim" });
    } catch (error) { errors.push(error); }
    finally {
      try { assert.equal((await screen("wake")).verified, true); }
      catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Screen operation and wake restoration failed");
  });

  await t.test("rotation changes are read back; lock setter does not claim a lock getter", async () => {
    const before = (await screen("rotation")).rotation;
    assert.ok([0, 1, 2, 3].includes(before));
    const errors = [];
    try {
      const value = (before + 1) % 4, rotated = await screen("rotate", value);
      assert.equal(rotated.verified, true); assert.equal((await screen("rotation")).rotation, value);
      for (const locked of [true, false]) {
        const result = await screen("rotation_lock", locked);
        assert.equal(result.command_confirmed, true); assert.equal(result.state_verified, false);
        assert.equal(result.locked_requested, locked);
        assert.ok([0, 1, 2, 3].includes((await screen("rotation")).rotation));
      }
    } catch (error) { errors.push(error); }
    finally {
      try {
        assert.equal((await screen("rotate", before)).verified, true);
        assert.equal((await screen("rotation")).rotation, before);
        receipt("rotation-restored.json", { rotation: before, original_lock_state: "unavailable", lock_restored: false, disposable_emulator: info.emulator.name });
      } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Rotation operation and restoration failed");
  });

  await t.test("sleep timeout has an observed effect and its override is restored", async () => {
    const errors = [];
    try {
      assert.equal((await screen("wake")).verified, true);
      const result = await screen("sleeptime", 5000);
      assert.equal(result.command_confirmed, true); assert.equal(result.state_verified, false);
      const deadline = performance.now() + 20000;
      let status;
      do {
        status = await screen("status");
        if (["SLEEP", "INACTIVE"].includes(status.state)) break;
        await delay(500);
      } while (performance.now() < deadline);
      assert.ok(["SLEEP", "INACTIVE"].includes(status.state), "A requested timeout alone is not evidence of sleep");
      receipt("sleeptime-observed.json", { requested_ms: 5000, state: status.state, setter_state_verified: result.state_verified });
    } catch (error) { errors.push(error); }
    finally {
      try {
        const restored = await screen("sleeptime", "restore");
        assert.equal(restored.command_confirmed, true); assert.equal(restored.state_verified, false);
      } catch (error) { errors.push(error); }
      try { assert.equal((await screen("wake")).verified, true); }
      catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Sleep timeout operation/restoration/wake failed");
  });

  await t.test("viewmode requires a readable baseline and an independent readback", async () => {
    const before = (await screen("viewmode")).value;
    assert.ok(["light", "dark"].includes(before));
    const errors = [];
    try {
      const value = before === "dark" ? "light" : "dark", changed = await screen("viewmode", value);
      assert.equal(changed.command_confirmed, true);
      assert.equal(changed.state_verified, changed.unchanged, "A setter receipt is not an independent state observation");
      assert.equal((await screen("viewmode")).value, value);
    } catch (error) { errors.push(error); }
    finally {
      try {
        assert.equal((await screen("viewmode", before)).command_confirmed, true);
        assert.equal((await screen("viewmode")).value, before);
      } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Viewmode operation and restoration failed");
  });

  for (const operation of ["control_center", "notification_center"]) await t.test(`${operation} reports independently observable window/control changes`, async () => {
    const errors = [];
    try {
      await ui({ action: "act", op: "key", key: "home" });
      const before = (await ui({ action: "windows", all: true })).windows;
      const treeBefore = await ui({ action: "tree", depth: 8, limit: 100 });
      const result = await system(operation);
      assert.equal(result.command_confirmed, true); assert.equal(result.state_verified, false);
      assert.equal(typeof result.window_changed, "boolean"); assert.ok(result.controls.length > 0);
      const after = (await ui({ action: "windows", all: true })).windows;
      const treeAfter = await ui({ action: "tree", depth: 8, limit: 100 });
      assert.ok(JSON.stringify(after) !== JSON.stringify(before) || treeAfter.tree !== treeBefore.tree, "Independent queries must show a window/control change");
      assert.ok(after.some((w) => w.visible && w.focused && w.type >= 2000 && ![2001, 2110].includes(w.type)), "The focused window must be a system panel, not desktop/keyguard");
      assert.ok(treeAfter.nodes > 0);
      receipt(`${operation}-observation.json`, { windows: after, scope: "system window/control change; no business or semantic panel-verification claim", setter_state_verified: result.state_verified });
    } catch (error) { errors.push(error); }
    finally {
      try { await ui({ action: "act", op: "key", key: "home" }); }
      catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, `${operation} and return-home cleanup failed`);
  });

  // Last: restore wall time before restoring timezone; no other system mutation follows this block.
  await t.test("timezone and bounded wall-clock change are restored in order", async () => {
    const zone = (await system("timezone")).value;
    assert.match(zone, /^[A-Za-z0-9_+\-/]+$/);
    const nextZone = zone === "UTC" ? "Asia/Shanghai" : "UTC";
    const milliseconds = (value) => { const result = Date.parse(`${value.replace(" ", "T")}Z`); assert.ok(Number.isFinite(result)); return result; };
    const wallTime = (value) => new Date(value).toISOString().slice(0, 19).replace("T", " ");
    const errors = [];
    try {
      assert.equal((await system("timezone", nextZone)).state_verified, true);
      assert.equal((await system("timezone")).value, nextZone);
      // Treat the reported fields as a wall clock in this fixed zone, not as the host timezone.
      const baseline = milliseconds((await system("time")).value), started = performance.now();
      try {
        const requested = baseline + 60000, changed = await system("time", wallTime(requested));
        assert.equal(changed.command_confirmed, true); assert.equal(changed.state_verified, false);
        const observed = milliseconds((await system("time")).value);
        assert.ok(Math.abs(observed - requested - (performance.now() - started)) <= 10000, "Independent time query must show the requested one-minute change");
        receipt("time-observed.json", { requested: wallTime(requested), observed: wallTime(observed), setter_state_verified: changed.state_verified });
      } catch (error) { errors.push(error); }
      finally {
        try {
          const restored = await system("time", wallTime(baseline + performance.now() - started));
          assert.equal(restored.command_confirmed, true); assert.equal(restored.state_verified, false);
          const observed = milliseconds((await system("time")).value), drift = observed - baseline - (performance.now() - started);
          receipt("time-restored.json", { observed: wallTime(observed), drift_ms: drift, setter_state_verified: restored.state_verified });
          assert.ok(Math.abs(drift) <= 10000, "Restored time must follow the original wall clock plus elapsed monotonic time");
        } catch (error) { errors.push(error); }
      }
    } catch (error) { errors.push(error); }
    finally {
      try {
        assert.equal((await system("timezone", zone)).state_verified, true);
        assert.equal((await system("timezone")).value, zone);
      } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Time/timezone operation and restoration failed");
  });
});
