import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { ToolError, errorResult, invariant } from "../src/core/errors.js";
import { release, protocolVersion } from "../src/core/config.js";
import { createToolCatalog } from "../src/core/catalog.js";
import { guidedKinds } from "../src/services/skill-guidance.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";
import { CapabilityReceipts } from "./lib/capability-receipts.js";

/** Real generic stdio MCP, bundled Skill guidance and SDK preflight/build.
 * Uses a new isolated directory. Does not start agents or alter user config. */
const root = path.resolve(z.string().min(1).parse(process.argv[2])),
  installation = fileURLToPath(new URL("../../", import.meta.url));
assert.equal(fs.existsSync(root), false);
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const project = path.join(root, "application"),
  state = path.join(root, "state"),
  tested = evidenceIdentity();
const receipts = new CapabilityReceipts(root, tested);
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
          "Generic stdio MCP/Worker/SDK stateless domain recipes, shared Resources/Prompts, bundled knowledge and requirement-bound native build acceptance, without a client Skill directory",
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
const requirement = { id: "R1", revision: 1, text: "The generated ArkUI launch page compiles after the injected missing-member error is repaired." };
const runSchema = z.object({ run_id: z.string().uuid() });
async function workflow(
  workflow: string,
  input: Record<string, unknown>,
  expected = "succeeded",
) {
  const { run_id } = runSchema.parse(
    await call("workflow_run", { action: "start", workflow, input, requirements: [requirement] }),
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
        await call("workflow_run", { action: "status", detail: "full", run_id, wait_ms: 1000 }),
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
try {
  await observe("connect", connect);
  const doctor = await observe("doctor", () => call("deveco_doctor", {}));
  const sdkMetadata = z.object({ default_sdk: z.object({ platform_version: z.string().min(1), package_version: z.string().min(1) }) }).parse(doctor).default_sdk;
  const sdk = sdkMetadata.platform_version;
  await observe("catalog", async () => {
    const list = await client!.listTools();
    assert.deepEqual(list.tools.map(tool => tool.name), createToolCatalog().map(tool => tool.name));
    assert.equal(list.tools.some(tool => tool.name === "skill_workflow"), false);
    assert.ok(client!.getInstructions()!.length < 600);
    assert.equal(client!.getInstructions()!.includes("first .ets"), false);
    return { tools: list.tools.map(tool => tool.name), instructions: client!.getInstructions() };
  });
  await observe("retired_guidance_rejected", async () => {
    for (const kind of guidedKinds) await assert.rejects(call("skill_workflow", { action: "start", kind, project_path: project, objective: requirement.text }), { code: "GUIDANCE_LIFECYCLE_RETIRED" });
    assert.deepEqual(await call("skill_workflow", { action: "list" }), []);
    assert.equal(fs.existsSync(project), false);
    return { rejected: guidedKinds, created_runs: 0 };
  });
  const recipe = z.object({ id: z.string(), creates_run: z.literal(false), completion_claim: z.literal("guidance_only"), content_sha256: z.string(), references: z.object({ knowledge: z.array(z.object({ uri: z.string() })) }) }).passthrough();
  const savedRecipes = new Map<string, unknown>();
  for (const kind of guidedKinds) await observe(`recipe_read:${kind}`, async () => {
    const data = await call("domain_recipe", { action: "read", id: kind });
    recipe.parse(data);
    savedRecipes.set(kind, data);
    return data;
  });
  await observe("resource_prompt_tool_parity", async () => {
    const prompt = await client!.getPrompt({ name: "harmonyos-spec", arguments: { objective: requirement.text, project_path: project } });
    const promptText = z.object({ type: z.literal("text"), text: z.string() }).parse(prompt.messages[0]!.content).text;
    const body = JSON.parse(promptText);
    assert.equal(body.original_requirement, requirement.text);
    assert.deepEqual(body.recipe, savedRecipes.get("spec"));
    const resource = await client!.readResource({ uri: "deveco://recipe/spec" });
    const resourceText = z.object({ text: z.string() }).parse(resource.contents[0]).text;
    const tool = z.object({ text: z.string(), sha256: z.string() }).parse(await call("domain_content", { action: "read", uri: "deveco://recipe/spec" }));
    assert.equal(resourceText, tool.text);
    assert.equal(createHash("sha256").update(tool.text).digest("hex"), tool.sha256);
    return { recipe_sha256: tool.sha256, original_requirement: body.original_requirement };
  });
  await observe("create_project", () => workflow("project_create", { project_path: project, app_name: "HostAcceptance", bundle_name: "com.deveco.hostacceptance", sdk_version: sdk }));
  const catalog = z.object({ skills: z.array(z.object({ name: z.string(), package_sha256: z.string(), files: z.array(z.object({ path: z.string(), sha256: z.string() })) })) }).parse(await observe("skill_catalog", () => call("skill_manage", { action: "catalog" })));
  assert.equal(catalog.skills.length, 6);
  await observe("skill_search", async () => z.object({ total: z.number().positive() }).parse(await call("skill_manage", { action: "catalog", query: "ArkTS" })));
  for (const skill of catalog.skills) for (const file of skill.files) await observe(`skill_read:${skill.name}:${file.path}`, async () => {
    const data = z.object({ content: z.string(), package_sha256: z.literal(skill.package_sha256) }).parse(await call("skill_manage", { action: "read", name: skill.name, file: file.path }));
    assert.equal(createHash("sha256").update(data.content).digest("hex"), file.sha256);
    const tool = z.object({ text: z.string(), sha256: z.string() }).parse(await call("domain_content", { action: "read", uri: `deveco://skill/${skill.name}/${file.path}` }));
    assert.equal(tool.text, data.content);
    return { name: skill.name, file: file.path, sha256: tool.sha256, bytes: Buffer.byteLength(data.content) };
  });
  // Read the domain rules once for this editing task, not before every .ets write.
  await observe("task_rules_on_demand", async () => {
    const read = z.object({ text: z.string(), sha256: z.string() }).parse(await call("domain_content", { action: "read", uri: "deveco://knowledge/arkts-grammar-standards/recipes-core" }));
    assert.ok(read.text.length);
    return { sha256: read.sha256, bytes: Buffer.byteLength(read.text) };
  });
  await observe("recipes_after_reconnect", async () => {
    await disconnect(); await connect();
    for (const kind of guidedKinds) assert.deepEqual(await call("domain_recipe", { action: "read", id: kind }), savedRecipes.get(kind));
    assert.deepEqual(await call("skill_workflow", { action: "list" }), []);
    assert.equal(fs.existsSync(path.join(project, ".agents")), false);
    assert.equal(fs.existsSync(path.join(project, ".codex")), false);
    return { recipes_preserved: guidedKinds, guidance_runs: 0 };
  });
  await observe("installer_removed", async () => {
    for (const action of ["install", "installed", "uninstall"]) await assert.rejects(call("skill_manage", { action }));
    return { rejected: ["install", "installed", "uninstall"] };
  });
  await observe("host_owned_documents", async () => {
    const hostNotes = path.join(root, "host-notes"); fs.mkdirSync(hostNotes);
    const documents = { "spec.md": `# Original requirement\nR1 revision 1: ${requirement.text}\nTask T1: restore source and validate build.`, "plan.md": "Read domain rules once, reproduce the compiler diagnostic, repair through host editing, and run a bound fresh native build.", "tasks.md": "- [ ] T1: repair and validate R1 revision 1" };
    for (const [name, content] of Object.entries(documents)) atomicWrite(path.join(hostNotes, name), content, false);
    await disconnect(); await connect();
    for (const [name, content] of Object.entries(documents)) assert.equal(fs.readFileSync(path.join(hostNotes, name), "utf8"), content);
    return { owner: "host", documents: Object.fromEntries(Object.keys(documents).map(name => [name, fileDigest(path.join(hostNotes, name))])), creates_mcp_guidance_run: false };
  });
  const sourceFile = path.join(project, "entry/src/main/ets/pages/Index.ets"), original = fs.readFileSync(sourceFile, "utf8");
  assert.ok(original.includes("Text(this.message)"));
  atomicWrite(sourceFile, original.replace("Text(this.message)", "Text(this.missingAcceptanceMember)"));
  try {
    await observe("checker_reproduces_error", async () => {
      const checked = z.object({ success: z.literal(false), summary: z.object({ errorCount: z.number().positive() }) }).passthrough().parse(await call("arkts_check", { project_path: project }));
      return checked;
    });
    await observe("default_build_blocked", async () => {
      const result = await workflow("project_build", { project_path: project }, "failed");
      assert.match(JSON.stringify(result.error), /BUILD_CHECK_BLOCKED/);
      return result;
    });
  } finally { atomicWrite(sourceFile, original); }
  await observe("checker_after_repair", async () => z.object({ success: z.literal(true), summary: z.object({ errorCount: z.literal(0) }) }).passthrough().parse(await call("arkts_check", { project_path: project })));
  const built = await observe("build_after_repair", () => workflow("project_build", { project_path: project }));
  const assessInput = { action: "assess", project_path: project, requirements: [{ ...requirement, original_text: requirement.text, task_ids: ["T1"], mode: "build-only" }], evidence: [{ requirement_id: requirement.id, requirement_revision: 1, task_id: "T1", run_id: built.run_id }] };
  const assessment = z.object({ assessment_id: z.string(), contract_satisfied: z.literal(true), business_verified: z.literal(false) }).passthrough().parse(await observe("bound_requirement_acceptance", () => call("domain_acceptance", assessInput)));
  await observe("source_change_invalidates_evidence", async () => {
    atomicWrite(sourceFile, original + "\n// Changed after the captured native result\n");
    try { return z.object({ contract_satisfied: z.literal(false), business_verified: z.literal(false) }).passthrough().parse(await call("domain_acceptance", assessInput)); }
    finally { atomicWrite(sourceFile, original); }
  });
  await observe("new_requirement_cannot_reuse_old_build", async () => z.object({ contract_satisfied: z.literal(false) }).passthrough().parse(await call("domain_acceptance", {
    ...assessInput, requirements: [{ ...requirement, revision: 2, text: requirement.text + " Include an additional requested change.", original_text: requirement.text, history: [{ revision: 1, text: requirement.text, reason: "The user added a requirement" }], task_ids: ["T1"], mode: "build-only" }], evidence: [{ ...assessInput.evidence[0], requirement_revision: 2 }],
  })));
  await observe("referenced_evidence_protected", async () => {
    await assert.rejects(call("maintenance", { action: "cleanup_plan", run_ids: [built.run_id] }), { code: "RUN_PROTECTED" });
    return { protected: true, native_run_id: built.run_id };
  });
  await observe("assessment_export_includes_native_receipt", async () => {
    const exported = z.object({ run_ids: z.array(z.string()), manifest_sha256: z.string() }).passthrough().parse(await call("maintenance", { action: "export", run_ids: [assessment.assessment_id], export_directory: path.join(root, "assessment-export") }));
    assert.deepEqual(exported.run_ids, [assessment.assessment_id, built.run_id].sort());
    return exported;
  });
  await observe("schema_rejection", async () => {
    await assert.rejects(call("ui_flow", { action: "run", id: "missing", mode: "attach" }));
    return { rejected_before_device_action: true };
  });
  const cases: [string, string[], string[], boolean?][] = [
    ["plan_enter.execute", ["recipe_read:plan", "retired_guidance_rejected"], ["Planning mode belongs to the host; MCP supplies a stateless planning recipe and rejects new guidance lifecycles."], true],
    ["plan_write.execute", ["host_owned_documents"], ["Host file editing retains the plan; no MCP plan write or publication lifecycle is advertised."], true],
    ["plan_exit.execute", ["recipes_after_reconnect"], ["The host controls its planning mode; reconnect retains methods without creating or transitioning guidance runs."], true],
    ["skill.list", ["skill_catalog"], ["Public catalog returns all six bundled Skills and their identities without client installation."]],
    ["skill.search", ["skill_search"], ["Public ArkTS catalog search returns a nonempty set of bundled Skills."]],
    ["skill.read", observations.filter(item => item.name.startsWith("skill_read:")).map(item => item.name), ["All bundled Skill bodies and references are read through public tools; shared domain content has identical bytes and hashes."]],
    ["spec_write.spec", ["recipe_read:spec", "host_owned_documents"], ["MCP supplies optional source-linked spec templates; the host owns the specification and its requirement revisions."], true],
    ["spec_write.design", ["recipe_read:spec", "host_owned_documents"], ["The host owns design document editing and persistence; no new MCP guidance lifecycle is created."], true],
    ["spec_write.tasks", ["host_owned_documents", "bound_requirement_acceptance"], ["The host owns task editing; native acceptance independently checks the explicit requirement/task/evidence relationship."], true],
    ["todowrite.execute", ["host_owned_documents"], ["Host-owned TODO files survive reconnection; this does not claim MCP task-management lifecycle support."], true],
    ["arkts_check.execute", ["checker_reproduces_error", "checker_after_repair"], ["Actual ArkTS checking reports an injected missing-member error and zero errors after original source restoration."]],
    ["build_project.execute", ["default_build_blocked", "build_after_repair", "bound_requirement_acceptance", "source_change_invalidates_evidence", "new_requirement_cannot_reuse_old_build"], ["A real compiler error blocks the build; a repaired requirement-bound HAP build satisfies build-only acceptance while changed source or a new requirement revision invalidates evidence."]],
  ];
  for (const [operation, names, checks, hostBoundary] of cases) {
    const selected = names.map(name => { const item = observations.find(value => value.name === name); assert.ok(item && !item.error); return item; });
    assert.ok(selected.length);
    receipts.add(operation, checks, selected, hostBoundary ? { boundary: "client_required" } : operation === "arkts_check.execute" ? { language: "arkts", sdk: sdkMetadata.package_version } : {});
  }
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
  receipts.finish(
    finishAcceptance(
      path.join(root, "evidence.json"),
      tested,
      completed,
      closed,
    ),
  );
}
