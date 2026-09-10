import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { ToolError, errorResult, invariant } from "../src/core/errors.js";
import { release, protocolVersion } from "../src/core/config.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";

/** Real generic stdio MCP, bundled Skill guidance and SDK preflight/build.
 * Uses a new isolated directory. Does not start agents or alter user config. */
const root = path.resolve(z.string().min(1).parse(process.argv[2])),
  installation = fileURLToPath(new URL("../../", import.meta.url));
assert.equal(fs.existsSync(root), false);
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const project = path.join(root, "application"),
  state = path.join(root, "state"),
  tested = evidenceIdentity();
atomicWrite(path.join(root, "config.json"), "{}\n");
let client: Client | undefined,
  transport: StdioClientTransport | undefined,
  completed = false,
  closed = false;
const observations: {
  name: string;
  elapsed_ms: number;
  result?: unknown;
  error?: unknown;
}[] = [];
const logFile = path.join(root, "mcp.ndjson");
const save = () =>
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        tested,
        scope:
          "Generic stdio MCP/Worker/SDK builtin Skill workflows and bundled knowledge, without any client Skill directory or client-specific executable",
        observations,
      },
      null,
      2,
    ) + "\n",
  );
async function observe<T>(name: string, task: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await task();
    observations.push({ name, elapsed_ms: performance.now() - start, result });
    console.log(`${name}: passed`);
    return result;
  } catch (error) {
    observations.push({
      name,
      elapsed_ms: performance.now() - start,
      error: errorResult(error),
    });
    console.log(`${name}: failed`);
    throw error;
  } finally {
    save();
  }
}
async function connect() {
  client = new Client({ name: "native-skill-mcp-acceptance", version: "1" });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(installation, "dist/src/cli.js")],
    cwd: installation,
    stderr: "pipe",
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (v): v is [string, string] =>
            v[1] !== undefined &&
            !v[0].startsWith("DEVECO_") &&
            !["NODE_OPTIONS", "NODE_PATH"].includes(v[0]),
        ),
      ),
      DEVECO_STATE_DIR: state,
      DEVECO_CONFIG: path.join(root, "config.json"),
    },
  });
  transport.stderr?.on("data", (chunk: Buffer) => {
    const size = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    if (size < 4 * 1024 * 1024)
      fs.appendFileSync(logFile, chunk.subarray(0, 4 * 1024 * 1024 - size), {
        mode: 0o600,
      });
  });
  await client.connect(transport);
  return { connected: true, release, protocol: protocolVersion };
}
async function disconnect() {
  try {
    await client?.close();
  } finally {
    await transport?.close();
    client = undefined;
    transport = undefined;
  }
}
async function call(name: string, args: Record<string, unknown>) {
  invariant(client, "CLIENT_MISSING", "Connect MCP first");
  const response = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 180000,
  });
  if (response.isError) {
    const { error } = z
      .object({ error: z.object({ code: z.string(), message: z.string() }) })
      .parse(response.structuredContent);
    throw new ToolError(error.code, error.message);
  }
  return z
    .object({ ok: z.literal(true), data: z.unknown() })
    .parse(response.structuredContent).data;
}
const runSchema = z.object({ run_id: z.string().uuid() });
async function workflow(
  workflow: string,
  input: Record<string, unknown>,
  expected = "succeeded",
) {
  const { run_id } = runSchema.parse(
    await call("workflow_run", { action: "start", workflow, input }),
  );
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const status = z
      .object({
        status: z.string(),
        result: z.unknown().optional(),
        error: z.unknown().optional(),
      })
      .parse(
        await call("workflow_run", { action: "status", run_id, wait_ms: 1000 }),
      );
    if (!["queued", "running", "cancelling"].includes(status.status)) {
      assert.equal(status.status, expected, JSON.stringify(status));
      return { run_id, ...status };
    }
  }
  throw new ToolError(
    "ACCEPTANCE_TIMEOUT",
    "Inspect retained run before retrying",
  );
}
const skillState = z
  .object({
    run_id: z.string(),
    revision: z.number(),
    phase: z.string(),
    definition_current: z.literal(true),
    guidance: z
      .object({
        delivery: z.literal("builtin_mcp"),
        client_skill_installation: z.literal(false),
      })
      .passthrough(),
    verified: z.literal(false),
  })
  .passthrough();
async function skillRead(id: string) {
  return skillState.parse(
    await call("skill_workflow", { action: "read", run_id: id }),
  );
}
async function write(id: string, name: string, content: string) {
  return call("skill_workflow", {
    action: "write",
    run_id: id,
    expected_revision: (await skillRead(id)).revision,
    name,
    content,
  });
}
async function transition(
  id: string,
  phase: string,
  evidence_run_ids: string[] = [],
) {
  return call("skill_workflow", {
    action: "transition",
    run_id: id,
    expected_revision: (await skillRead(id)).revision,
    phase,
    evidence_run_ids,
    rationale:
      "The repository owner authorized this isolated native acceptance; compare retained results with the original fixed objective.",
  });
}
try {
  await observe("connect", connect);
  const doctor = await observe("doctor", () => call("deveco_doctor", {}));
  const sdk = z
    .object({ default_sdk: z.object({ platform_version: z.string() }) })
    .parse(doctor).default_sdk.platform_version;
  await observe("catalog", async () => {
    const list = await client!.listTools();
    assert.equal(list.tools.length, 29);
    for (const name of [
      "skill_manage",
      "skill_workflow",
      "ui_test",
      "ui_review",
    ])
      assert.ok(list.tools.some((tool) => tool.name === name));
    return { tools: list.tools.map((tool) => tool.name) };
  });
  const creation = skillState.parse(
    await observe("create_workflow_new_destination", () =>
      call("skill_workflow", {
        action: "start",
        kind: "create",
        project_path: project,
        objective:
          "Create a new SDK-matched project through the builtin MCP workflow and verify its HAP build.",
      }),
    ),
  );
  assert.equal(fs.existsSync(project), false);
  await write(
    creation.run_id,
    "plan.md",
    "# Project creation\n## Technical Context\nInstalled native SDK.\n## Project Structure\nCreate the captured application destination, then check and build its entry module.",
  );
  await transition(creation.run_id, "implementing");
  await observe("create_project", () =>
    workflow("project_create", {
      project_path: project,
      app_name: "HostAcceptance",
      bundle_name: "com.deveco.hostacceptance",
      sdk_version: sdk,
    }),
  );
  const plan = skillState.parse(
    await observe("plan_enter", () =>
      call("skill_workflow", {
        action: "start",
        kind: "plan",
        project_path: project,
        objective:
          "Read all six builtin Skills through MCP, recover workflow guidance after reconnect, and verify native preflight blocks a compiler error until repaired.",
      }),
    ),
  );
  await observe("plan_write", () =>
    write(
      plan.run_id,
      "plan.md",
      "# Native host acceptance\n## Technical Context\nInstalled SDK and compiled MCP/Worker.\n## Project Structure\napplication/entry contains the isolated page; instructions remain in the MCP package.\n## Steps\nRead builtin Skills and knowledge through MCP; recover workflow state and guidance after reconnect; inject a compiler error, verify blocking, repair and build.",
    ),
  );
  await observe("plan_exit", () => transition(plan.run_id, "implementing"));
  const catalog = z
    .object({
      skills: z.array(
        z.object({ name: z.string(), package_sha256: z.string() }),
      ),
    })
    .parse(
      await observe("skill_catalog", () =>
        call("skill_manage", { action: "catalog" }),
      ),
    );
  assert.equal(catalog.skills.length, 6);
  await observe("skill_search", async () => {
    const data = z
      .object({ total: z.number().positive() })
      .parse(await call("skill_manage", { action: "catalog", query: "ArkTS" }));
    return data;
  });
  for (const skill of catalog.skills) {
    await observe(`skill_read:${skill.name}`, async () => {
      const data = z
        .object({ content: z.string(), package_sha256: z.string() })
        .parse(
          await call("skill_manage", { action: "read", name: skill.name }),
        );
      assert.match(data.content, /^---\nname:/);
      assert.equal(data.package_sha256, skill.package_sha256);
      return {
        name: skill.name,
        bytes: Buffer.byteLength(data.content),
        package_sha256: data.package_sha256,
      };
    });
  }
  await observe("disconnect_reopen", async () => {
    await disconnect();
    return connect();
  });
  await observe("workflow_guidance_after_restart", async () => {
    const current = await skillRead(plan.run_id);
    assert.equal(current.guidance.delivery, "builtin_mcp");
    assert.equal(current.guidance.client_skill_installation, false);
    assert.equal(fs.existsSync(path.join(project, ".agents")), false);
    assert.equal(fs.existsSync(path.join(project, ".codex")), false);
    return current;
  });
  await observe("installer_removed", async () => {
    for (const action of ["install", "installed", "uninstall"])
      await assert.rejects(call("skill_manage", { action }));
    return { rejected: ["install", "installed", "uninstall"] };
  });
  const repair = skillState.parse(
    await call("skill_workflow", {
      action: "start",
      kind: "repair",
      project_path: project,
      objective:
        "A missing ArkTS member must fail checking and block default build; restore the exact source then recheck and build.",
    }),
  );
  await write(
    repair.run_id,
    "notes.md",
    "Reproduce a missing member in the isolated launch page. Assert the checker reports errors and the default build ends BUILD_CHECK_BLOCKED. Restore the captured original bytes and verify both native checking and build.",
  );
  await transition(repair.run_id, "implementing");
  const sourceFile = path.join(project, "entry/src/main/ets/pages/Index.ets"),
    original = fs.readFileSync(sourceFile, "utf8");
  assert.ok(original.includes("Text(this.message)"));
  atomicWrite(
    sourceFile,
    original.replace(
      "Text(this.message)",
      "Text(this.missingAcceptanceMember)",
    ),
  );
  try {
    await observe("checker_reproduces_error", async () => {
      const checked = z
        .object({
          success: z.boolean(),
          summary: z.object({ errorCount: z.number() }),
        })
        .passthrough()
        .parse(await call("arkts_check", { project_path: project }));
      assert.equal(checked.success, false);
      assert.ok(checked.summary.errorCount > 0);
      return checked;
    });
    await observe("default_build_blocked", async () => {
      const result = await workflow(
        "project_build",
        { project_path: project },
        "failed",
      );
      assert.match(JSON.stringify(result.error), /BUILD_CHECK_BLOCKED/);
      return result;
    });
  } finally {
    atomicWrite(sourceFile, original);
  }
  await observe("checker_after_repair", async () => {
    const checked = z
      .object({
        success: z.literal(true),
        summary: z.object({ errorCount: z.literal(0) }),
      })
      .passthrough()
      .parse(await call("arkts_check", { project_path: project }));
    return checked;
  });
  const built = await observe("build_after_repair", () =>
    workflow("project_build", { project_path: project }),
  );
  await transition(repair.run_id, "verifying");
  await observe("repair_complete", () =>
    transition(repair.run_id, "completed", [built.run_id]),
  );
  const spec = skillState.parse(
    await call("skill_workflow", {
      action: "start",
      kind: "spec",
      project_path: project,
      objective:
        "Validate the generated isolated native project against a documented build specification.",
    }),
  );
  await observe("spec_write", () =>
    write(
      spec.run_id,
      "spec.md",
      "# Specification\n## Requirements\nThe generated ArkUI launch page compiles.\n## User Scenarios\nA developer builds the isolated project.\n## Success Criteria\nZero native checker errors and a successful native HAP build.",
    ),
  );
  await observe("design_write", () =>
    write(
      spec.run_id,
      "plan.md",
      "# Design\n## Technical Context\nThe installed HarmonyOS SDK.\n## Project Structure\nentry/src/main/ets/pages/Index.ets is the launch page.",
    ),
  );
  await observe("tasks_write", () =>
    write(
      spec.run_id,
      "tasks.md",
      "- [x] Generate the isolated project.\n- [x] Recheck the original page with zero errors.\n- [x] Build its HAP using the default preflight.",
    ),
  );
  await transition(spec.run_id, "implementing");
  await transition(spec.run_id, "verifying");
  const specBuilt = await observe("spec_fresh_build", () =>
    workflow("project_build", { project_path: project }),
  );
  await observe("spec_complete", () =>
    transition(spec.run_id, "completed", [specBuilt.run_id]),
  );
  await transition(creation.run_id, "verifying");
  await observe("create_workflow_complete", () =>
    transition(creation.run_id, "completed", [built.run_id]),
  );
  await observe("referenced_evidence_protected", async () => {
    await assert.rejects(
      call("workflow_run", { action: "cleanup_plan", run_ids: [built.run_id] }),
      { code: "RUN_PROTECTED" },
    );
    return { rejected: true, native_run_id: built.run_id };
  });
  await observe("workflow_export_includes_native_receipt", async () => {
    const exported = z
      .object({ run_ids: z.array(z.string()), manifest_sha256: z.string() })
      .passthrough()
      .parse(
        await call("workflow_run", {
          action: "export",
          run_ids: [creation.run_id],
          export_directory: path.join(root, "creation-export"),
        }),
      );
    assert.deepEqual(exported.run_ids, [creation.run_id, built.run_id].sort());
    return exported;
  });
  await transition(plan.run_id, "verifying");
  await observe("publish_plan", async () => {
    const result = await call("skill_workflow", {
      action: "publish",
      run_id: plan.run_id,
      expected_revision: (await skillRead(plan.run_id)).revision,
      name: "plan.md",
      file: path.join(root, "plan.md"),
    });
    return { result, sha256: fileDigest(path.join(root, "plan.md")) };
  });
  await observe("plan_complete", () => transition(plan.run_id, "completed"));
  await observe("schema_rejection", async () => {
    await assert.rejects(
      call("ui_flow", { action: "run", id: "missing", mode: "attach" }),
    );
    return { rejected_before_device_action: true };
  });
  completed = true;
} catch (error) {
  console.error(JSON.stringify(errorResult(error)));
  process.exitCode = 1;
} finally {
  try {
    await disconnect();
    closed = true;
  } catch (error) {
    console.error(JSON.stringify(errorResult(error)));
  }
  save();
  finishAcceptance(path.join(root, "evidence.json"), tested, completed, closed);
}
