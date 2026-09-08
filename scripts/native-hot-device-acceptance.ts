import { finishAcceptance } from "./lib/acceptance-report.js";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { errorResult, invariant } from "../src/core/errors.js";
import { nativeOperation } from "./lib/native-operation.js";
import { evidenceIdentity } from "./lib/evidence.js";

// Only operate on a prepared, personally selected signing canary. Each attempt
// has its own evidence directory and never automatically retries a device effect.
const [root, preparedRoot, signingRoot, state] = z
  .tuple([
    z.string().min(1),
    z.string().min(1),
    z.string().min(1),
    z.string().min(1),
  ])
  .parse(process.argv.slice(2))
  .map((item) => path.resolve(item)) as [string, string, string, string];
assert.equal(fs.existsSync(root), false);
const prepared = z
  .object({
    bundle_name: z.string().startsWith("com.deveco.mcpacceptance."),
    project_path: z.string(),
    module: z.string(),
    ability: z.string(),
  })
  .parse(
    JSON.parse(
      fs.readFileSync(path.join(preparedRoot, "prepared.json"), "utf8"),
    ) as unknown,
  );
const journal = z
  .object({
    operations: z.object({
      preflight: z.object({ result: z.object({ target: z.string() }) }),
      configure: z.object({
        status: z.literal("succeeded"),
        result: z.object({ build_profile_sha256: z.string() }),
      }),
    }),
  })
  .parse(
    JSON.parse(
      fs.readFileSync(
        path.join(signingRoot, "operations.private.json"),
        "utf8",
      ),
    ) as unknown,
  );
const project_path = prepared.project_path,
  target = journal.operations.preflight.result.target,
  source = path.join(
    project_path,
    prepared.module,
    "src/main/ets/pages/Index.ets",
  ),
  original = fs.readFileSync(source, "utf8");
assert.equal(
  fileDigest(path.join(project_path, "build-profile.json5")),
  journal.operations.configure.result.build_profile_sha256,
);
assert.equal(original.split("确认输入").length, 2);
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
process.env.DEVECO_STATE_DIR = state;
process.env.DEVECO_CONFIG = path.join(root, "config.json");
const tested = evidenceIdentity(),
  runtime = new Runtime(),
  observations: {
    name: string;
    result?: unknown;
    error?: unknown;
    elapsed_ms: number;
  }[] = [];
let written = original, completed = false, closed = false, failed = false;
const save = () =>
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify({ tested, observations }, null, 2),
  );
async function observe<T>(name: string, task: () => Promise<T>) {
  const start = performance.now();
  try {
    const result = await task();
    observations.push({ name, result, elapsed_ms: performance.now() - start });
    console.log(`${name}: passed`);
    return result;
  } catch (error) {
    observations.push({
      name,
      error: errorResult(error),
      elapsed_ms: performance.now() - start,
    });
    console.log(`${name}: failed`);
    throw error;
  } finally {
    save();
  }
}
try {
  await observe("start_signed_watch", () =>
    nativeOperation(runtime, "hot_reload", {
      action: "start",
      project_path,
      target,
      modules: [prepared.module],
      app: {
        bundle_name: prepared.bundle_name,
        module: prepared.module,
        ability: prepared.ability,
      },
    }, path.join(root, "start.operation.private.json")),
  );
  await observe("baseline_assertion", () =>
    runtime.call("verify_ui", {
      target,
      assert: {
        visible: {
          key: "mcp-confirm",
          text: "确认输入",
          textMode: "exact",
          bundle_name: prepared.bundle_name,
        },
        timeoutMs: 10000,
      },
    }),
  );
  for (const [index, text] of ["热更新已生效", "第二次热更新"].entries()) {
    await observe(`patch_${index + 1}`, async () => {
      assert.equal(
        fs.readFileSync(source, "utf8"),
        written,
        "Canary source changed outside this acceptance",
      );
      written = original.replace("确认输入", text);
      atomicWrite(source, written);
      const result = z
        .object({ applied: z.literal(true), processPreserved: z.literal(true) })
        .passthrough()
        .parse(
          await nativeOperation(runtime, "hot_reload", {
            action: "apply",
            project_path,
            target,
            files: [source],
          }, path.join(root, `patch-${index + 1}.operation.private.json`)),
        );
      return result;
    });
    await observe(`patch_${index + 1}_assertion`, () =>
      runtime.call("verify_ui", {
        target,
        assert: {
          visible: {
            key: "mcp-confirm",
            text,
            textMode: "exact",
            bundle_name: prepared.bundle_name,
          },
          timeoutMs: 15000,
        },
      }),
    );
  }
  await observe("screenshot_evidence", () =>
    runtime.call("ui_snapshot", { target }),
  );
  completed = true;
} catch {
  failed = true;
  process.exitCode = 1;
} finally {
  try {
    await observe("stop_watch", async () => {
      const result = await runtime.call("hot_reload", {
        action: "stop",
        project_path,
      });
      const status = z
        .object({ active: z.boolean() })
        .parse(
          await runtime.call("hot_reload", { action: "status", project_path }),
        );
      assert.equal(status.active, false);
      return result;
    });
    await observe("restore_canary_source", async () => {
      invariant(
        fs.readFileSync(source, "utf8") === written,
        "CANARY_SOURCE_CONFLICT",
        "Canary changed externally; preserve current source for review",
      );
      if (written !== original) atomicWrite(source, original);
      return { restored: fs.readFileSync(source, "utf8") === original };
    });
  } catch {
    failed = true;
    process.exitCode = 1;
  }
  try {
    await observe("close", async () => { const result = await runtime.close(); closed = result.closed; return result; });
  } catch {
    failed = true;
    process.exitCode = 1;
  }
  finishAcceptance(path.join(root, "evidence.json"), tested, completed && !failed, closed);
}
