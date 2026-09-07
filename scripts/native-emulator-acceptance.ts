import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { atomicWrite } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const tested = evidenceIdentity();
const root = path.resolve(z.string().min(1).parse(process.argv[2]));
assert.equal(fs.existsSync(root), false, "Acceptance directory must be new");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const runtime = new Runtime(),
  name = `NativeMcp${crypto.randomBytes(4).toString("hex")}`;
const observations: {
  name: string;
  elapsed_ms: number;
  result?: unknown;
  error?: unknown;
}[] = [];
async function observe(name: string, task: () => Promise<unknown>) {
  const started = performance.now();
  try {
    const result = await task();
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      result,
    });
    process.stdout.write(`${name}: passed\n`);
    return result;
  } catch (error) {
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      error: errorResult(error),
    });
    throw error;
  } finally {
    atomicWrite(
      path.join(root, "evidence.json"),
      JSON.stringify(
        {
          tested,
          instance: name,
          platform: process.platform,
          node: process.version,
          observations,
        },
        null,
        2,
      ),
    );
  }
}
let created = false;
try {
  const inventory = await runtime.emulator.list();
  assert.equal(
    inventory.some((item) => item.name === name),
    false,
  );
  const images = z
    .object({
      images: z.array(
        z.object({ deviceType: z.string(), osVersion: z.string() }),
      ),
    })
    .parse(
      await runtime.emulator.manage({
        action: "images",
        downloaded: true,
        device_type: "phone",
      }),
    );
  const image = images.images[0];
  assert.ok(image, "A downloaded phone emulator image is required");
  await observe("emulator_create", async () => {
    const result = await runtime.emulator.manage({
      action: "create",
      name,
      device_type: image.deviceType,
      os_version: image.osVersion,
    });
    created = true;
    return result;
  });
  await observe("emulator_start", () =>
    runtime.emulator.manage({ action: "start", name }),
  );
  await observe("emulator_stays_running", async () => {
    await delay(5000);
    const instance = (await runtime.emulator.list()).find(
      (item) => item.name === name,
    );
    assert.equal(instance?.isRunning, true);
    return instance;
  });
  await observe("emulator_scenario", () =>
    runtime.emulator.scenario({ name, action: "battery", value: 80 }),
  );
  await observe("emulator_stop", () =>
    runtime.emulator.manage({ action: "stop", name }),
  );
  await observe("emulator_delete", () =>
    runtime.emulator.manage({ action: "delete", name }),
  );
  created = false;
  const after = await runtime.emulator.list();
  assert.deepEqual(
    after,
    inventory,
    "Existing emulator inventory must remain unchanged",
  );
} finally {
  await runtime.emulator.close();
  if (created) await runtime.emulator.manage({ action: "delete", name });
  await runtime.close();
}
