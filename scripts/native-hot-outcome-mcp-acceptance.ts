import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { capturedFileSchema } from "../src/core/captured-file.js";
import { discoverToolchain, toolCommand } from "../src/core/toolchain.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";
import { AcceptanceMcp } from "./lib/mcp-acceptance-client.js";
import { OwnedEmulatorAcceptance } from "./lib/owned-emulator-acceptance.js";

const [root, preparedFile, osVersion] = z
  .tuple([z.string().min(1), z.string().min(1), z.string().min(1).optional()])
  .parse(process.argv.slice(2));
assert.ok(path.isAbsolute(root) && path.isAbsolute(preparedFile));
assert.equal(
  fs.existsSync(root),
  false,
  "Retain failed attempts and use a new evidence directory",
);
const prepared = z
  .object({
    project_path: z.string(),
    module: z.string(),
    ability: z.string(),
    bundle_name: z.string().startsWith("com.deveco.mcpacceptance."),
  })
  .parse(JSON.parse(fs.readFileSync(preparedFile, "utf8")));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
atomicWrite(path.join(root, "config.json"), "{}\n");
const ownerRoot = path.join(root, "emulator-owner");
fs.mkdirSync(ownerRoot, { mode: 0o700 });
atomicWrite(path.join(ownerRoot, "config.json"), "{}\n");
const tested = evidenceIdentity(),
  results: Record<string, unknown> = {},
  mcp = new AcceptanceMcp(root, "native-hot-outcome-acceptance"),
  owner = new AcceptanceMcp(ownerRoot, "native-hot-emulator-owner", { tool_groups: ["core", "emulator-admin"] });
const file = path.join(root, "evidence.json"),
  save = () =>
    atomicWrite(
      file,
      JSON.stringify(
        {
          results,
          scope:
            "Owned signed application copy on an owned emulator via public MCP: consecutive HQF patches with application PID and UI assertions, failed source preflight, recovery patch, rejected hot file addition and explicit cold-deploy fallback. No user business application or physical-device claim.",
        },
        null,
        2,
      ),
    );
const record = (key: string, value: unknown) => {
  results[key] = value;
  save();
};
const owned = new OwnedEmulatorAcceptance(mcp, record, owner);
const project = path.join(root, "application"),
  relative = path.join(prepared.module, "src/main/ets/pages/Index.ets"),
  source = path.join(project, relative),
  original = fs.readFileSync(
    path.join(prepared.project_path, relative),
    "utf8",
  ),
  originalHash = fileDigest(path.join(prepared.project_path, relative));
assert.equal(original.split("确认输入").length, 2);
let completed = false,
  closed = false,
  started = false,
  written = original;
const selector = (text: string) => ({
  key: "mcp-confirm",
  text,
  textMode: "exact",
  bundle_name: prepared.bundle_name,
});
const app = {
  bundle_name: prepared.bundle_name,
  module: prepared.module,
  ability: prepared.ability,
};
function write(text: string) {
  assert.equal(
    fs.readFileSync(source, "utf8"),
    written,
    "Preserve source if another task modified this owned copy",
  );
  atomicWrite(source, text);
  written = text;
}
try {
  await mcp.connect();
  await owner.connect();
  record(
    "arkts_rules",
    await mcp.call("harmony_knowledge", {
      action: "read",
      kind: "rules",
      id: "arkts-grammar-standards/recipes-core",
    }),
  );
  fs.cpSync(prepared.project_path, project, {
    recursive: true,
    filter: (source) =>
      !["build", ".hvigor", ".idea", ".deveco-mcp", ".arkpilot"].includes(
        path.basename(source),
      ),
  });
  fs.chmodSync(path.join(project, "build-profile.json5"), 0o600);
  record("fixture", {
    project,
    original_sha256: originalHash,
    signing_profile_sha256: fileDigest(
      path.join(project, "build-profile.json5"),
    ),
  });
  const target = await owned.start(osVersion);
  async function pid(key: string) {
    const result = await owned.processes.run(
      toolCommand(discoverToolchain(), "hdc", [
        "-t",
        target,
        "shell",
        "pidof",
        prepared.bundle_name,
      ]),
      { timeoutMs: 5000 },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.truncated, false);
    assert.equal(result.stderr.trim(), "");
    const value = z
      .string()
      .regex(/^\d+(?:\s+\d+)*$/)
      .parse(result.stdout.trim());
    record(key, value);
    return value;
  }
  async function verify(key: string, text: string) {
    const result = z
      .object({ verified: z.literal(true) })
      .passthrough()
      .parse(
        await mcp.call("verify_ui", {
          target,
          assert: { visible: selector(text), timeoutMs: 15000 },
        }),
      );
    record(key, result);
  }
  started = true;
  await owned.operation("watch_start", "hot_reload", {
    action: "start",
    project_path: project,
    target,
    modules: [prepared.module],
    app,
  });
  record(
    "watch_status",
    await mcp.call("hot_reload", { action: "status", project_path: project }),
  );
  await verify("baseline_ui", "确认输入");
  const baselinePid = await pid("baseline_pid");
  const workflowInput = (text: string, hot_reload = true) => ({
    project_path: project,
    target,
    modules: [prepared.module],
    app,
    hot_reload,
    assert: { visible: selector(text), timeoutMs: 15000 },
  });
  async function patch(key: string, text: string) {
    write(original.replace("确认输入", text));
    const value = await owned.workflow(
      key,
      "build_deploy_verify",
      workflowInput(text),
    );
    const hot = z
      .object({
        hot_reload: z.literal(true),
        result: z
          .object({
            applied: z.literal(true),
            processPreserved: z.literal(true),
            process_identity: z.literal("observed_pid_set"),
            artifacts: z.array(capturedFileSchema).min(1),
            startupVerified: z.literal(true),
            outcomeVerified: z.literal(false),
            startup_check: z
              .object({
                status: z.literal("passed"),
                business_outcome_verified: z.literal(false),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .parse(await owned.output(value.result, "build_or_hot_apply"));
    record(`${key}_hot_receipt`, hot);
    for (const artifact of hot.result.artifacts) {
      assert.equal(fileDigest(artifact.path), artifact.sha256);
      assert.equal(fs.statSync(artifact.path).size, artifact.bytes);
    }
    assert.equal(await pid(`${key}_pid`), baselinePid);
    await verify(`${key}_ui`, text);
    for (const node of [
      "prepare_installation",
      "install_application",
      "launch_application",
    ])
      assert.equal(
        z
          .object({ skipped: z.literal(true) })
          .parse(await owned.output(value.result, node)).skipped,
        true,
      );
  }
  await patch("patch_one", "第一轮热补丁已生效");
  await patch("patch_two", "第二轮热补丁已生效");
  write(
    original.replace("确认输入", "不应显示的错误补丁") +
      "\nconst brokenAcceptanceValue: number = ;\n",
  );
  const invalid = await owned.workflow(
    "invalid_source",
    "build_deploy_verify",
    workflowInput("不应显示的错误补丁"),
    "failed",
  );
  record("invalid_source_error", invalid.error);
  assert.equal(await pid("after_invalid_pid"), baselinePid);
  await verify("after_invalid_ui", "第二轮热补丁已生效");
  await patch("recovery_patch", "错误修复后的热补丁");
  const added = path.join(
    project,
    prepared.module,
    "src/main/ets/ColdAcceptanceOnly.ets",
  );
  assert.equal(fs.existsSync(added), false);
  atomicWrite(
    added,
    "export function coldAcceptanceOnly(): number { return 42; }\n",
  );
  write(original.replace("确认输入", "完整部署恢复已生效"));
  const cold = await owned.workflow(
    "cold_required",
    "build_deploy_verify",
    workflowInput("完整部署恢复已生效"),
    "failed",
  );
  assert.equal(
    z.object({ code: z.literal("COLD_DEPLOY_REQUIRED") }).parse(cold.error)
      .code,
    "COLD_DEPLOY_REQUIRED",
  );
  assert.equal(await pid("after_cold_rejection_pid"), baselinePid);
  await verify("after_cold_rejection_ui", "错误修复后的热补丁");
  record(
    "stop_before_fallback",
    await mcp.call("hot_reload", { action: "stop", project_path: project }),
  );
  assert.equal(
    z
      .object({ active: z.literal(false) })
      .parse(
        await mcp.call("hot_reload", {
          action: "status",
          project_path: project,
        }),
      ).active,
    false,
  );
  started = false;
  await owned.workflow(
    "cold_fallback",
    "build_deploy_verify",
    workflowInput("完整部署恢复已生效", false),
  );
  await verify("cold_fallback_ui", "完整部署恢复已生效");
  assert.notEqual(await pid("cold_fallback_pid"), baselinePid);
  record(
    "final_inspection",
    await mcp.call("ui_inspect", {
      target,
      selector: selector("完整部署恢复已生效"),
      screenshot: true,
    }),
  );
  assert.equal(
    fileDigest(path.join(prepared.project_path, relative)),
    originalHash,
  );
  completed = true;
} catch (error) {
  record("error", errorResult(error));
  console.error(JSON.stringify(errorResult(error)));
} finally {
  let watchClosed = !started;
  if (started)
    try {
      record(
        "watch_cleanup",
        await mcp.call("hot_reload", { action: "stop", project_path: project }),
      );
      watchClosed =
        z
          .object({ active: z.literal(false) })
          .parse(
            await mcp.call("hot_reload", {
              action: "status",
              project_path: project,
            }),
          ).active === false;
    } catch (error) {
      record("watch_cleanup_error", errorResult(error));
    }
  try {
    await owned.close();
    closed = watchClosed;
  } catch (error) {
    record("close_error", errorResult(error));
    await mcp.close().catch(() => {});
    await owner.close().catch(() => {});
    await owned.processes.close();
  }
  save();
  const passed = finishAcceptance(file, tested, completed, closed);
  console.log(
    `Real hot outcome MCP acceptance: ${passed ? "passed" : "failed"}`,
  );
}
