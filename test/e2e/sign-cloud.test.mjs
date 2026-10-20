// Explicit AGC team + disposable certificate/IDE profile. Existing objects are never selected for deletion.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import JSON5 from "json5";
import { test } from "node:test";
import { session, required } from "../support/acceptance.mjs";
import { waitJob } from "../support/mcp.mjs";

test("release automatic signing", async (t) => {
  const team = required("E2E_TEAM"), project = required("E2E_PROJECT");
  assert.equal(required("E2E_ALLOW_SIGN_AUTO"), "1", "Use an explicitly disposable project and cloud signing authorization");
  const { call } = await session(t);
  const profile = path.join(project, "build-profile.json5"), original = fs.readFileSync(profile), source = JSON5.parse(original.toString());
  const product = process.env.E2E_PRODUCT ?? "default", name = product + "_release";
  assert.ok(!source.app.signingConfigs?.some((v) => v.name === name), "No existing release configuration may be replaced");
  const before = await call("sign", { action: "certificates", team });
  const existing = new Set(before.certificates.map((v) => v.id));
  let status, committed;
  try {
    const started = await call("sign", { action: "auto", type: "release", project, product, team, wait: 0 });
    status = await waitJob(call, started);
    assert.equal(status.status, "succeeded", JSON.stringify(status));
    committed = fs.readFileSync(profile);
    assert.equal(status.result.type, "release"); assert.equal(status.result.devices, 0);
    assert.equal(status.result.signing_config, name);
    const updated = JSON5.parse(committed.toString());
    assert.deepEqual(updated.app.products, source.app.products);
    assert.ok(updated.app.signingConfigs.some((v) => v.name === name));
    assert.ok(!existing.has(status.result.certificate));
    const payload = JSON.parse(execFileSync("openssl", ["cms", "-verify", "-noverify", "-inform", "DER", "-in", status.result.files.p7b], { encoding: "utf8", stdio: "pipe", timeout: 15000 }));
    assert.equal(payload.type, "release"); assert.equal(payload["bundle-info"]["bundle-name"], required("E2E_BUNDLE"));
    assert.ok(payload["bundle-info"]["distribution-certificate"]);
  } finally {
    if (committed) {
      assert.deepEqual(fs.readFileSync(profile), committed, "Refuse to overwrite concurrent changes");
      fs.writeFileSync(profile, original);
      await call("sign", { action: "delete_certificate", team, id: status.result.certificate });
      const owned = path.dirname(status.result.files.p12);
      assert.ok(owned.startsWith(path.join(os.homedir(), ".ohos", "config", ".auto-")));
      fs.rmSync(owned, { recursive: true });
    }
    assert.deepEqual(fs.readFileSync(profile), original);
    const after = await call("sign", { action: "certificates", team });
    assert.deepEqual(after.certificates.map((v) => v.id).sort(), [...existing].sort(), "Keep all pre-existing cloud certificates");
  }
});

test("cloud certificate lifecycle and signed IDE profile", async (t) => {
  const team = required("E2E_TEAM"), target = required("E2E_TARGET");
  const { call, raw, directory, defer } = await session(t);
  const sign = (args) => call("sign", { team, ...args });
  const ids = (list) => list.map((x) => x.id).sort();
  const before = { certificates: await sign({ action: "certificates" }), devices: await sign({ action: "devices" }) };
  const output = execFileSync(required("E2E_HDC"), ["-t", target, "shell", "bm get -u"], { encoding: "utf8", timeout: 15000 });
  const udid = /\b[A-Fa-f0-9]{64}\b/.exec(output)?.[0];
  assert.ok(udid, "The selected device must expose its UDID for independent registration verification");
  assert.ok(before.devices.devices.some((d) => d.udid && (d.udid === udid || udid.endsWith(d.udid))), "The selected device must already be registered");
  const name = `deveco_test_${crypto.randomUUID().replaceAll("-", "")}`, keystore_password = crypto.randomBytes(24).toString("hex");
  const keystore = path.join(directory, "key.p12"), csr = path.join(directory, "key.csr"), certificate = path.join(directory, "certificate.cer"), profile = path.join(directory, "profile.p7b");
  let certId;
  // Teardown failures remain test failures; only ids returned by this run are eligible.
  defer(async () => {
    if (certId) await sign({ action: "delete_certificate", id: certId });
    assert.deepEqual(ids((await sign({ action: "certificates" })).certificates), ids(before.certificates.certificates));
    assert.deepEqual(ids((await sign({ action: "devices" })).devices), ids(before.devices.devices));
  });
  const registration = await sign({ action: "register_device", target });
  assert.equal(registration.already, true); assert.equal(registration.registered, false);
  assert.ok(before.devices.devices.some((d) => d.udid === registration.udid), "Only an already registered target is allowed");
  const invalid = await raw("sign", { action: "profile_delete", id: "not-a-console-profile-id", team });
  assert.equal(invalid.isError, true); assert.equal(invalid.data.error.code, "INVALID_INPUT");
  const missing = await raw("sign", { action: "certificate_create", csr: path.join(directory, "missing.csr"), name, type: "debug", out: certificate, team });
  assert.equal(missing.isError, true); assert.equal(missing.data.error.code, "NOT_FOUND");
  await call("sign", { action: "keypair", out: keystore, keystore_password });
  await call("sign", { action: "csr", keystore, keystore_password, out: csr });
  const created = await sign({ action: "certificate_create", csr, name, type: "debug", out: certificate });
  certId = created.certificate; assert.ok(certId); assert.match(fs.readFileSync(certificate, "utf8"), /BEGIN CERTIFICATE/);
  assert.ok((await sign({ action: "certificates" })).certificates.some((c) => c.id === certId));
  const provision = await sign({ action: "profile_create", id: certId, bundle: "com.devecomcp.sign", type: "debug", name, out: profile });
  assert.equal(provision.file, profile); assert.ok(fs.statSync(profile).size > 500);
  const payload = JSON.parse(execFileSync("openssl", ["cms", "-verify", "-noverify", "-inform", "DER", "-in", profile], { encoding: "utf8", stdio: "pipe", timeout: 15000 }));
  assert.equal(payload.type, "debug"); assert.equal(payload["bundle-info"]["bundle-name"], "com.devecomcp.sign");
  assert.ok(payload["debug-info"]["device-ids"].includes(udid));
  // IDE profiles return a signed file, not a console profile id. Console deletion needs a separately
  // authorized disposable console object and independent confirmation; it remains unverified here.
  assert.equal(provision.id, undefined);
});
