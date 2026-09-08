import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { withTrace } from "../src/core/trace.js";
import { emulatorBinding } from "../src/services/emulator-identity.js";

test("unset emulator ports require live guest identity and reject physical devices, mismatches and concurrent config replacement", async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "native-guest-identity-"))), file = path.join(root, "config.ini");
  const config = `name=fixture\nuuid=original-instance\ninstancePath=${root}\nhw.hdc.port=notset\n`;
  fs.writeFileSync(file, config);
  let probes = 0;
  const guest = async () => { probes++; return "fixture"; };
  try {
    await assert.rejects(emulatorBinding("fixture", root, "127.0.0.1:5555"), { code: "EMULATOR_TARGET_UNAVAILABLE" });
    await assert.rejects(emulatorBinding("fixture", root, "physical-device", guest), { code: "EMULATOR_TARGET_MISMATCH" });
    assert.equal(probes, 0);
    await assert.rejects(emulatorBinding("fixture", root, "127.0.0.1:5555", async () => "other-instance"), { code: "EMULATOR_TARGET_MISMATCH" });
    for (const target of ["127.0.0.1:5555", "localhost:5555", "[::1]:5555"]) {
      const bound = await emulatorBinding("fixture", root, target, guest);
      assert.deepEqual(bound, { name: "fixture", instance: root, uuid: "original-instance", target, port: 5555 });
    }
    await assert.rejects(emulatorBinding("fixture", root, "127.0.0.1:5555", async () => {
      fs.writeFileSync(file, config.replace("original-instance", "replacement-instance")); return "fixture";
    }), { code: "EMULATOR_IDENTITY_CHANGED" });
    fs.writeFileSync(file, config.replace("notset", "5556"));
    await assert.rejects(emulatorBinding("fixture", root, "127.0.0.1:5555", guest), { code: "EMULATOR_TARGET_MISMATCH" });
    assert.equal(probes, 3, "A live guest must not override a conflicting configured port");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("loopback device aliases share leases and unresolved external guards across stores", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-resource-identity-"));
  const first = new StateStore(root), second = new StateStore(root);
  try {
    await first.lease("device:localhost:05555", async () => {
      await first.lease("device:[::1]:5555", async () => {});
      for (const alias of ["127.0.0.1:5555", "localhost:5555", "[::1]:5555"]) {
        const abort = new AbortController();
        const pending = second.lease(`device:${alias}`, async () => assert.fail("Alias bypassed held lease"), abort.signal);
        abort.abort(new Error("fixture cancellation"));
        await assert.rejects(pending, /fixture cancellation|aborted/);
      }
      await second.lease("device:127.0.0.1:5556", async () => {});
    });
    const guard = first.trackExternalSession("fixture", ["device:[::1]:5555"], {});
    guard.unconfirmed();
    await assert.rejects(second.lease("device:localhost:5555", async () => {}), { code: "RESOURCE_RECOVERY_REQUIRED" });
    guard.confirmClosed();
    await second.lease("device:127.0.0.1:5555", async () => {});
  } finally {
    first.close(); second.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});

test("domain reconciliation requires process and session exit and never settles sibling commands", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-child-reconcile-"));
  const store = new StateStore(root);
  try {
    const { run } = store.create("fixture", {});
    await withTrace({ run_id: run.id, node: "execute" }, async () => {
      for (const node of ["execute:command:one", "execute:command:one:completion", "execute:command:one-more", "sibling:command:one"])
        await assert.rejects(store.effect(run.id, node, {}, async () => { throw new Error("lost response"); }));
      const child = store.trackProcess();
      assert.throws(() => store.settleReconciledChildren(["one"], {}), { code: "CANCEL_UNCONFIRMED" });
      child.spawned(null);
      const guard = store.trackExternalSession("fixture", [], {});
      assert.throws(() => store.settleReconciledChildren(["one"], {}), { code: "CANCEL_UNCONFIRMED" });
      guard.confirmClosed();
      assert.throws(() => store.settleReconciledChildren(["one:completion"], {}), { code: "RECONCILIATION_CONTEXT_INVALID" });
      store.settleReconciledChildren(["one"], { secret: "must not be public" });
      assert.deepEqual(store.uncertainOperations(run.id).map((item) => item.node).sort(), ["execute:command:one-more", "sibling:command:one"]);
      assert.equal(JSON.stringify(store.db.prepare("SELECT result FROM operations").all()).includes("must not be public"), false);
      assert.equal(JSON.stringify(store.db.prepare("SELECT data FROM events").all()).includes("must not be public"), false);
    });
  } finally {
    store.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});
