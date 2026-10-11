// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { app } from "../support/acceptance.mjs";

test("signing", async (t) => {
  const { call, job, directory, run, project, bundle } = await app(t);

  const team = process.env.E2E_TEAM;
  assert.ok(team, "E2E_TEAM must be explicitly selected by the user");
  await t.test("sign.certificates-devices", async () => {
    const certificates = await call("sign", { action: "certificates", team });
    assert.ok(certificates.certificates.some((c) => c.type === "debug" && c.expires > Date.now()));
    const devices = await call("sign", { action: "devices", team });
    assert.ok(devices.devices.length > 0);
  });
  await t.test("sign.keypair-csr", async () => {
    const keystore = path.join(directory, `audit-${Date.now()}.p12`), password = crypto.randomBytes(24).toString("hex"), out = keystore + ".csr";
    await call("sign", { action: "keypair", out: keystore, keystore_password: password, key_alias: "AuditKey" });
    execFileSync("openssl", ["pkcs12", "-in", keystore, "-passin", "stdin", "-noout"], { input: password + "\n", stdio: ["pipe", "pipe", "pipe"] });
    await call("sign", { action: "csr", keystore, keystore_password: password, key_alias: "AuditKey", out });
    assert.match(fs.readFileSync(out, "utf8"), /BEGIN (NEW )?CERTIFICATE REQUEST/);
    execFileSync("openssl", ["req", "-in", out, "-verify", "-noout"], { stdio: "pipe" });
  });
  await t.test("sign.sign-verify", async () => {
    const build = await job("project", { action: "build", project, wait: 0 });
    const unsigned = build.result.artifacts.find((a) => a.path.endsWith("-signed.hap")).path.replace(/-signed\.hap$/, "-unsigned.hap");
    assert.ok(fs.existsSync(unsigned));
    const out = path.join(directory, `${run}-signed.hap`);
    await call("sign", { action: "sign", project, file: unsigned, out });
    const d = await call("sign", { action: "verify", file: out }); assert.equal(d.verified, true); assert.equal(d.profile.bundle, bundle);
  });

});
