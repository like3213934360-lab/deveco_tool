// Explicit AGC team + disposable certificate/profile. Existing objects are never selected for deletion.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { session, required } from "../support/acceptance.mjs";

test("cloud certificate and profile lifecycle", async (t) => {
  const team = required("E2E_TEAM"), target = required("E2E_TARGET");
  const { call, raw, directory, defer } = await session(t);
  const sign = (args) => call("sign", { team, ...args });
  const ids = (list) => list.map((x) => x.id).sort();
  const before = { certificates: await sign({ action: "certificates" }), devices: await sign({ action: "devices" }) };
  const udid = (await call("device", { action: "shell", target, command: "bm get --udid" })).output.trim();
  assert.ok(udid);
  assert.ok(before.devices.devices.some((d) => d.udid && (d.udid === udid || udid.endsWith(d.udid))), "The selected device must already be registered");
  const name = `deveco_test_${crypto.randomUUID().replaceAll("-", "")}`, keystore_password = crypto.randomBytes(24).toString("hex");
  const keystore = path.join(directory, "key.p12"), csr = path.join(directory, "key.csr"), certificate = path.join(directory, "certificate.cer"), profile = path.join(directory, "profile.p7b");
  let certId, profileId;
  // Teardown failures remain test failures; only ids returned by this run are eligible.
  defer(async () => {
    if (profileId) await sign({ action: "profile_delete", id: profileId });
    if (certId) await sign({ action: "delete_certificate", id: certId });
    assert.deepEqual(ids((await sign({ action: "certificates" })).certificates), ids(before.certificates.certificates));
    assert.deepEqual(ids((await sign({ action: "devices" })).devices), ids(before.devices.devices));
  });
  await sign({ action: "keypair", out: keystore, keystore_password });
  await sign({ action: "csr", keystore, keystore_password, out: csr });
  const created = await sign({ action: "certificate_create", csr, name, type: "debug", out: certificate });
  certId = created.id; assert.ok(certId); assert.match(fs.readFileSync(certificate, "utf8"), /BEGIN CERTIFICATE/);
  assert.ok((await sign({ action: "certificates" })).certificates.some((c) => c.id === certId));
  const provision = await sign({ action: "profile_create", id: certId, bundle: "com.devecomcp.sign", type: "debug", name, out: profile });
  profileId = provision.id; assert.ok(profileId); assert.ok(fs.statSync(profile).size > 500);
  const deleted = profileId;
  await sign({ action: "profile_delete", id: deleted }); profileId = undefined;
  const again = await raw("sign", { action: "profile_delete", id: deleted, team });
  assert.equal(again.isError, true);
  const missing = await raw("sign", { action: "certificate_create", csr: path.join(directory, "missing.csr"), name, type: "debug", out: certificate, team });
  assert.equal(missing.isError, true);
  const registration = await sign({ action: "register_device", target });
  assert.ok(before.devices.devices.some((d) => d.udid === registration.udid), "Only an already registered target is allowed");
});
