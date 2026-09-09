import { finishAcceptance } from "./lib/acceptance-report.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { atomicWrite } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { nativeOperation } from "./lib/native-operation.js";
import { evidenceIdentity } from "./lib/evidence.js";

let completed = false;
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
async function observe<T>(stepName: string, task: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await task();
    observations.push({
      name: stepName,
      elapsed_ms: performance.now() - started,
      result,
    });
    process.stdout.write(`${stepName}: passed\n`);
    return result;
  } catch (error) {
    observations.push({
      name: stepName,
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
    const result = await nativeOperation(runtime, "emulator_manage", {
      action: "create",
      name,
      device_type: image.deviceType,
      os_version: image.osVersion,
    }, path.join(root, "create.operation.private.json"));
    created = true;
    return result;
  });
  await observe("emulator_start", () =>
    nativeOperation(runtime, "emulator_manage", { action: "start", name }, path.join(root, "start.operation.private.json")),
  );
  await observe("emulator_stays_running", async () => {
    await delay(5000);
    const instance = (await runtime.emulator.list()).find(
      (item) => item.name === name,
    );
    assert.equal(instance?.isRunning, true);
    return instance;
  });
  const binding = await observe("emulator_device_binding", async () => {
    const deadline = performance.now() + 120000;
    for (;;) {
      const instance = (await runtime.emulator.list()).find((item) => item.name === name);
      assert.ok(instance?.isRunning);
      const bindings = await Promise.allSettled((await runtime.devices.targets()).map((target) => runtime.emulator.binding(name, target)));
      const matched = bindings.filter((item) => item.status === "fulfilled");
      assert.ok(matched.length <= 1, "Connected emulator identity must be unique");
      if (matched.length === 1) return matched[0]!.value;
      assert.ok(performance.now() < deadline, "Emulator did not expose a matching HDC endpoint within two minutes");
      await delay(1000);
    }
  });
  const target = binding.target;
  await observe("emulator_scenario", () =>
    nativeOperation(runtime, "emulator_scenario", { name, target, action: "battery", value: 80 }, path.join(root, "scenario.operation.private.json")),
  );
  await observe("emulator_stop", () =>
    nativeOperation(runtime, "emulator_manage", { action: "stop", name, target }, path.join(root, "stop.operation.private.json")),
  );
  await observe("emulator_delete", () =>
    nativeOperation(runtime, "emulator_manage", { action: "delete", name }, path.join(root, "delete.operation.private.json")),
  );
  created = false;
  const after = await runtime.emulator.list();
  assert.deepEqual(
    after,
    inventory,
    "Existing emulator inventory must remain unchanged",
  );
  completed = true;
} finally {
  // Shutdown reconciles owned launchers. An incomplete create/start/delete needs
  // inspection of its durable receipt; do not issue a compensating cloud/SDK effect.
  const closed = await runtime.close();
  finishAcceptance(path.join(root, "evidence.json"), tested, completed && !created, closed.closed);
  if (created) process.stderr.write("Emulator cleanup requires inspection of recorded operation receipts.\n");
}
