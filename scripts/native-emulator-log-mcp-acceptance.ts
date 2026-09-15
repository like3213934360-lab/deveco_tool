import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { AcceptanceMcp } from "./lib/mcp-acceptance-client.js";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { errorResult, ToolError } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";
import { ProcessService } from "../src/core/process.js";
import { discoverToolchain, toolCommand } from "../src/core/toolchain.js";
import { emulatorBinding } from "../src/services/emulator-identity.js";

const [root, preparedFile, osVersion] = z
  .tuple([z.string().min(1), z.string().min(1), z.string().min(1).optional()])
  .parse(process.argv.slice(2));
assert.equal(
  fs.existsSync(root),
  false,
  "Use a new isolated evidence directory",
);
assert.ok(path.isAbsolute(root) && path.isAbsolute(preparedFile));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const name = `NativeMcp${crypto.randomBytes(4).toString("hex")}`,
  tested = evidenceIdentity();
const results: Record<string, unknown> = {},
  file = path.join(root, "evidence.json");
const client = new AcceptanceMcp(root, "emulator-continuous-log-acceptance", { tool_groups: ["core", "emulator-admin"] }),
  processes = new ProcessService();
let target: string | undefined,
  created = false,
  running = false,
  completed = false,
  closed = false;
const save = () =>
  atomicWrite(
    file,
    JSON.stringify(
      {
        instance: name,
        target,
        results,
        scope:
          "Candidate public MCP owns a fresh phone emulator; a separate public MCP process runs the continuous-log acceptance against a copy of an owned signed canary. This is emulator evidence, not physical-phone evidence. The original app project and user devices are unchanged.",
      },
      null,
      2,
    ),
  );
const instanceSchema = z.object({
  name: z.string(),
  isRunning: z.boolean(),
  instancePath: z.string().optional(),
});
async function inventory() {
  return z
    .object({ instances: z.array(instanceSchema) })
    .parse(await client.call("emulator_manage", { action: "list" })).instances;
}
async function operation(key: string, input: Record<string, unknown>) {
  const request_key = `emulator-log:${name}:${key}`;
  results[key] = { request_key, status: "submitting" };
  save();
  const run = z
    .object({ run_id: z.string() })
    .parse(await client.call(["create", "delete"].includes(String(input.action)) ? "emulator_admin" : "emulator_manage", { ...input, request_key }));
  results[key] = run;
  save();
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const status = z
      .object({
        status: z.string(),
        result: z.unknown(),
        error: z.unknown().optional(),
      })
      .parse(
        await client.call("workflow_run", {
          action: "status",
          detail: "full",
          run_id: run.run_id,
          wait_ms: 1000,
        }),
      );
    results[key] = { ...run, ...status };
    save();
    if (["queued", "running", "cancelling"].includes(status.status)) continue;
    assert.equal(status.status, "succeeded", JSON.stringify(status.error));
    console.log(`${key}: succeeded`);
    return;
  }
  throw new ToolError(
    "ACCEPTANCE_TIMEOUT",
    "Inspect the recorded task before any repeated effect",
  );
}
let initial: z.infer<typeof instanceSchema>[] = [];
try {
  const prepared = z
    .object({
      project_path: z.string(),
      module: z.string(),
      bundle_name: z.string().startsWith("com.deveco.mcpacceptance."),
    })
    .parse(JSON.parse(fs.readFileSync(preparedFile, "utf8")));
  const source = path.join(
      prepared.project_path,
      prepared.module,
      "src/main/ets/pages/Index.ets",
    ),
    originalHash = fileDigest(source);
  await client.connect();
  initial = await inventory();
  results.initial_inventory = initial;
  const images = z
    .object({
      images: z.array(
        z.object({ deviceType: z.string(), osVersion: z.string() }),
      ),
    })
    .parse(
      await client.call("emulator_admin", {
        action: "images",
        downloaded: true,
        device_type: "phone",
      }),
    );
  const image = osVersion ? images.images.find(candidate => candidate.osVersion === osVersion) : images.images[0];
  assert.ok(image);
  results.image = image;
  results.doctor = await client.call("deveco_doctor", {});
  save();
  await operation("create", {
    action: "create",
    name,
    device_type: image.deviceType,
    os_version: image.osVersion,
  });
  created = true;
  await operation("start", { action: "start", name });
  running = true;
  const deadline = Date.now() + 120000;
  while (!target && Date.now() < deadline) {
    const instance = (await inventory()).find((item) => item.name === name);
    assert.ok(instance?.isRunning);
    const targets = z
      .object({ targets: z.array(z.string()) })
      .parse(await client.call("device_info", { list: true })).targets;
    const matches = await Promise.allSettled(
      targets
        .filter((id) => /^(127\.0\.0\.1|localhost|\[::1\]):/.test(id))
        .map((id) =>
          emulatorBinding(name, instance.instancePath, id, async () => {
            const response = await processes.run(
              toolCommand(discoverToolchain(), "hdc", [
                "-t",
                id,
                "shell",
                "param",
                "get",
                "ohos.qemu.hvd.name",
              ]),
              { timeoutMs: 10000 },
            );
            assert.equal(response.truncated, false);
            return response.stdout.trim();
          }),
        ),
    );
    const matched = matches.filter((item) => item.status === "fulfilled");
    assert.ok(matched.length <= 1);
    if (matched[0]) {
      target = matched[0].value.target;
      results.binding = matched[0].value;
      save();
    } else await delay(1000);
  }
  assert.ok(target, "Owned emulator did not expose a verified HDC endpoint");
  const child = path.join(root, "continuous");
  results.continuous = await processes.run(
    {
      executable: process.execPath,
      args: [
        path.join(
          import.meta.dirname,
          "native-continuous-log-mcp-acceptance.js",
        ),
        child,
        preparedFile,
        target,
      ],
      cwd: process.cwd(),
      sensitive: true,
    },
    { timeoutMs: 600000, allowFailure: true, limitBytes: 65536 },
  );
  save();
  const evidence = path.join(child, "evidence.json");
  results.continuous_evidence = {
    file: evidence,
    sha256: fileDigest(evidence),
  };
  z.object({ passed: z.literal(true) }).parse(
    JSON.parse(fs.readFileSync(evidence, "utf8")),
  );
  assert.equal(fileDigest(source), originalHash);
  results.original_source_sha256 = originalHash;
  completed = true;
} catch (error) {
  results.error = errorResult(error);
  console.error(JSON.stringify(errorResult(error)));
} finally {
  try {
    if (running && target) {
      await operation("stop", { action: "stop", name, target });
      running = false;
    }
    await client.close();
    await client.connect();
    if (created) {
      const instance = (await inventory()).find((item) => item.name === name);
      assert.ok(instance && !instance.isRunning);
      await operation("delete", { action: "delete", name });
      created = false;
    }
    results.final_inventory = await inventory();
    assert.deepEqual(results.final_inventory, initial);
    await client.close();
    assert.equal(processes.size, 0);
    closed = true;
  } catch (error) {
    results.close_error = errorResult(error);
    await client.close().catch(() => {});
  }
  save();
  const passed = finishAcceptance(file, tested, completed && !created, closed);
  console.log(
    `Public emulator continuous log acceptance: ${passed ? "passed" : "failed"}`,
  );
}
