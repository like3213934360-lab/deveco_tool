// Real SDK + caller-provided disposable project and existing signing configuration.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { session, required } from "../support/acceptance.mjs";

test("SDK per-build signing selection", async (t) => {
  const project = required("E2E_PROJECT"), signing_config = required("E2E_SIGNING_CONFIG");
  const { call, job } = await session(t);
  const file = path.join(project, "build-profile.json5"), original = fs.readFileSync(file);
  try {
    const built = await job("project", { action: "build", project, signing_config, mode: process.env.E2E_BUILD_MODE ?? "debug" });
    assert.equal(built.result.signing_config, signing_config); assert.equal(built.result.signing_config_restored, true);
    assert.deepEqual(fs.readFileSync(file), original);
    const signed = built.result.artifacts.filter((a) => a.path.endsWith("-signed.hap"));
    assert.equal(signed.length, 1, "Use a dedicated single-entry SDK project");
    const result = await call("sign", { action: "verify", file: signed[0].path });
    assert.equal(result.verified, true); assert.equal(result.profile.bundle, required("E2E_BUNDLE"));
    assert.ok(result.certificate_chain > 0);
    const invalid = await call("project", { action: "build", project, signing_config: "missing-" + Date.now(), wait: 0 });
    const failed = await call("job", { action: "wait", job_id: invalid.job_id, wait: 10000 });
    assert.equal(failed.status, "failed"); assert.equal(failed.error.code, "SIGN_CONFIG_MISSING");
  } finally {
    assert.deepEqual(fs.readFileSync(file), original, "SDK success and failure must preserve the source signing configuration");
  }
});
