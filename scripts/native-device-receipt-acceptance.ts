import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { DeviceService } from "../src/services/device.js";
import { DeviceEffectJournal } from "../src/services/device-effect.js";
import { withTrace } from "../src/core/trace.js";
import { errorResult, invariant } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const output = path.resolve(process.argv[2] ?? "");
invariant(
  process.argv[2] && !fs.existsSync(output),
  "OUTPUT_REQUIRED",
  "Provide a new evidence directory",
);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const identity = evidenceIdentity(),
  processes = new ProcessService();
const cases: {
  accepted: boolean;
  dispatch_count: number;
  unresolved: number;
}[] = [];
try {
  for (const accepted of [true, false]) {
    const root = path.join(
      output,
      accepted ? "success-state" : "rejection-state",
    );
    let store = new StateStore(root),
      devices = new DeviceService(processes, store),
      dispatched = 0;
    try {
      const target = await devices.target(process.argv[3]);
      const transport = {
        shell: async (...args: Parameters<DeviceService["shell"]>) => {
          const value = await devices.shell(...args);
          if (args[1][0] === "sh" && args[1][2]?.includes("mkdir -m 700")) {
            dispatched++;
            throw new Error(
              "Injected transport response loss after fixture command completion",
            );
          }
          return value;
        },
      };
      const trace = { run_id: crypto.randomUUID(), node: "receipt_fixture" };
      const command = accepted
        ? ["printf", "%s", "DevEco 回执核验"]
        : ["sh", "-c", "printf '%s' 'DevEco fixture rejected'; exit 17"];
      const call = (recovery: boolean) =>
        withTrace(trace, () =>
          new DeviceEffectJournal(store, transport).run(
            target,
            "fixture",
            command,
            (receipt) => {
              invariant(
                receipt.exitCode === 0,
                "FIXTURE_REJECTED",
                "The fixture command completed with exit code 17",
              );
              assert.equal(receipt.stdout, "DevEco 回执核验");
              return { accepted: true };
            },
            undefined,
            recovery,
          ),
        );
      await assert.rejects(call(false), { code: "EFFECT_UNCERTAIN" });
      devices.close();
      store.close();
      store = new StateStore(root);
      devices = new DeviceService(processes, store);
      for (let attempt = 0; attempt < 2; attempt++) {
        if (accepted) assert.deepEqual(await call(true), { accepted: true });
        else await assert.rejects(call(true), { code: "FIXTURE_REJECTED" });
      }
      assert.equal(dispatched, 1);
      assert.deepEqual(store.uncertainOperations(trace.run_id), []);
      assert.deepEqual(store.externalGuards(), []);
      store.assertStopped(trace.run_id);
      cases.push({ accepted, dispatch_count: dispatched, unresolved: 0 });
    } finally {
      devices.close();
      store.close();
    }
  }
  const after = evidenceIdentity();
  invariant(
    identity.runtime_sha256 === after.runtime_sha256 &&
      identity.compiled_sha256 === after.compiled_sha256,
    "TESTED_FILES_CHANGED",
    "Tested runtime changed during verification",
  );
  fs.writeFileSync(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        identity,
        passed: true,
        cases,
        scope:
          "Real HarmonyOS shell receipt protocol; success and rejection with lost HDC responses and reopened host SQLite. Fixed printf fixtures only; no application installation or launch.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ output, passed: true, cases }));
} catch (error) {
  fs.writeFileSync(
    path.join(output, "failure.json"),
    JSON.stringify({ identity, error: errorResult(error) }, null, 2) + "\n",
  );
  console.error(JSON.stringify(errorResult(error)));
  process.exitCode = 1;
} finally {
  await processes.close();
}
