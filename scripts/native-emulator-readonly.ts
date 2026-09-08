import { finishAcceptance } from "./lib/acceptance-report.js";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { discoverToolchain, toolCommand } from "../src/core/toolchain.js";
import { emulatorLicenseLocation } from "../src/services/emulator-license.js";
import { atomicWrite } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const root = path.resolve(z.string().min(1).parse(process.argv[2]));
assert.equal(fs.existsSync(root), false, "Use a new evidence directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
let completed = false;
const tested = evidenceIdentity(),
  runtime = new Runtime(),
  toolchain = discoverToolchain();
const observations: {
  name: string;
  elapsed_ms: number;
  passed: boolean;
  result?: unknown;
  error?: unknown;
}[] = [];
let failed = false;
async function observe(name: string, task: () => Promise<unknown>) {
  const start = performance.now();
  try {
    observations.push({
      name,
      elapsed_ms: 0,
      passed: true,
      result: await task(),
    });
  } catch (error) {
    failed = true;
    observations.push({
      name,
      elapsed_ms: 0,
      passed: false,
      error: errorResult(error),
    });
  }
  observations.at(-1)!.elapsed_ms = performance.now() - start;
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        tested,
        toolchain,
        scope:
          "Read-only native inventory, installed images, installed agreement bytes and exact config preservation. Never execute native -license or accept agreements; stale-hash rejection is checked before any acceptance command.",
        observations,
      },
      null,
      2,
    ),
  );
  console.log(`${name}: ${observations.at(-1)!.passed ? "passed" : "failed"}`);
}
const reviewSchema = z.object({
  license_sha256: z.string(),
  accepted: z.boolean(),
  agreements: z.array(
    z.object({
      name: z.string(),
      sha256: z.string(),
      bytes: z.number(),
      artifact: z.object({ artifact_id: z.string() }),
    }),
  ),
});
try {
  const command = toolCommand(toolchain, "emulator", ["-version"]),
    version = await runtime.processes.run(command);
  const location = emulatorLicenseLocation(command.executable, version.stdout);
  const original = fs.existsSync(location.config)
    ? fs.readFileSync(location.config)
    : null;
  const originalMtime = original ? fs.statSync(location.config).mtimeMs : null;
  let review: z.infer<typeof reviewSchema> | undefined;
  await observe("emulator_inventory", () =>
    runtime.call("emulator_manage", { action: "list" }),
  );
  await observe("installed_images", () =>
    runtime.call("emulator_manage", { action: "images", downloaded: true }),
  );
  await observe("installed_agreement_view", async () => {
    review = reviewSchema.parse(
      await runtime.call("emulator_manage", { action: "license_view" }),
    );
    assert.equal(review.agreements.length, 2);
    for (const item of review.agreements) {
      const bytes = fs.readFileSync(
        path.join(location.directory, item.name + ".txt"),
      );
      assert.equal(
        crypto.createHash("sha256").update(bytes).digest("hex"),
        item.sha256,
      );
      assert.equal(bytes.length, item.bytes);
      const pieces = [];
      for (let offset = 0; offset < bytes.length;) {
        const page = runtime.store.readArtifact(
          item.artifact.artifact_id,
          offset,
        );
        pieces.push(Buffer.from(page.data, "base64"));
        offset = page.next_offset;
      }
      assert.deepEqual(Buffer.concat(pieces), bytes);
    }
    return review;
  });
  await observe("stable_review_digest", async () => {
    assert.ok(review);
    const again = reviewSchema.parse(
      await runtime.call("emulator_manage", { action: "license_view" }),
    );
    assert.equal(again.license_sha256, review.license_sha256);
    return { license_sha256: again.license_sha256 };
  });
  await observe("stale_review_rejected", async () => {
    assert.ok(review);
    const stale =
      (review.license_sha256.startsWith("0") ? "1" : "0") +
      review.license_sha256.slice(1);
    const submitted = z.object({ run_id: z.string() }).parse(
      await runtime.call("emulator_manage", {
        action: "license_accept",
        license_sha256: stale,
      }),
    );
    const deadline = performance.now() + 30000;
    for (;;) {
      const state = z.object({ status: z.string(), error: z.unknown().optional(), result: z.unknown().optional() }).parse(
        await runtime.call("workflow_run", { action: "status", run_id: submitted.run_id, wait_ms: 1000 }),
      );
      if (["queued", "running"].includes(state.status)) { assert.ok(performance.now() < deadline); continue; }
      assert.ok(["failed", "needs_input"].includes(state.status));
      let failure: unknown = state.error ?? z.object({ interrupts: z.array(z.object({ value: z.object({ error: z.unknown() }) })).length(1) }).parse(state.result).interrupts[0]!.value.error;
      for (let depth = 0; depth < 8; depth++) {
        const parsed = z.object({ code: z.string(), details: z.object({ cause: z.unknown() }).nullish() }).parse(failure);
        if (parsed.code !== "EFFECT_UNCERTAIN") { assert.equal(parsed.code, "EMULATOR_LICENSE_CHANGED"); break; }
        assert.ok(parsed.details && depth < 7);
        failure = parsed.details.cause;
      }
      break;
    }
    return { rejected: true };
  });
  await observe("native_configuration_unchanged", async () => {
    const current = fs.existsSync(location.config)
      ? fs.readFileSync(location.config)
      : null;
    assert.deepEqual(current, original);
    assert.equal(
      current ? fs.statSync(location.config).mtimeMs : null,
      originalMtime,
    );
    return { byte_identical: true, mtime_unchanged: true };
  });
  completed = true;
} finally {
  let closed = false;
  await observe("runtime_shutdown", async () => {
    const result = await runtime.close();
    closed = result.closed;
    return result;
  });
  finishAcceptance(path.join(root, "evidence.json"), tested, completed && !failed, closed);
  if (failed) process.exitCode = 1;
}
