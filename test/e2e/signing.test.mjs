// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { app, sha } from "../support/acceptance.mjs";

test("local signing reference", async (t) => {
  const { call, directory, project, bundle, receipt } = await app(t, false);
  const info = await call("project", { action: "info", project });
  const sourceFile = path.join(project, "build-profile.json5"), original = fs.readFileSync(sourceFile);
  const source = JSON5.parse(original.toString()), selected = source.app.products.find((p) => p.name === info.product);
  const signing = source.app.signingConfigs?.find((c) => c.name === selected.signingConfig);
  assert.ok(signing?.material, "This acceptance needs existing local signing material; IDE-only signing is not replaced");
  const material = { ...signing.material };
  for (const field of ["storeFile", "certpath", "profile"]) {
    assert.equal(typeof material[field], "string", `Missing existing material field ${field}`);
    material[field] = path.resolve(project, material[field]); assert.ok(fs.existsSync(material[field]), `Missing existing ${field}`);
  }
  const materialHashes = ["storeFile", "certpath", "profile"].map((field) => [material[field], sha(fs.readFileSync(material[field]))]);
  const unsigned = info.modules.filter((m) => m.type === "entry").flatMap((m) => {
    const outputs = path.join(project, m.path, "build", info.product, "outputs", m.target);
    return fs.existsSync(outputs) ? fs.readdirSync(outputs).filter((name) => name.endsWith("-unsigned.hap")).map((name) => path.join(outputs, name)) : [];
  });
  assert.equal(unsigned.length, 1, "Build the dedicated single-entry project first; this test never selects among multiple HAPs");
  const originalHapHash = sha(fs.readFileSync(unsigned[0]));
  const configured = path.join(directory, "referenced-signing"); fs.mkdirSync(configured, { mode: 0o700 });
  // Only this private, short-lived profile changes names; all original material stays in place.
  fs.writeFileSync(path.join(configured, "build-profile.json5"), JSON.stringify({ app: {
    products: [{ name: "phone", signingConfig: "debug" }], signingConfigs: [{ ...signing, name: "debug", material }],
  } }), { mode: 0o600 });
  try {
    const out = path.join(directory, "phone-debug-signed.hap");
    await call("sign", { action: "sign", project: configured, file: unsigned[0], out });
    const verified = await call("sign", { action: "verify", file: out });
    assert.equal(verified.verified, true); assert.equal(verified.profile.bundle, bundle);
    assert.ok(verified.certificate_chain > 0);
    receipt("local-signing.json", { product: "phone", signing_config: "debug", original_product: info.product,
      signed: true, verified: true, bundle, output_sha256: sha(fs.readFileSync(out)), source_material: "existing; unchanged", cloud_operations: 0 });
  } finally {
    fs.rmSync(configured, { recursive: true, force: true });
    assert.deepEqual(fs.readFileSync(sourceFile), original);
    assert.equal(sha(fs.readFileSync(unsigned[0])), originalHapHash);
    for (const [file, hash] of materialHashes) assert.equal(sha(fs.readFileSync(file)), hash);
  }
});

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
