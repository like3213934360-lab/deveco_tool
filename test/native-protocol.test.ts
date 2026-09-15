import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { tools, workflowNames, uiTestStepSchema } from "../src/core/contracts.js";
import { createToolCatalog, connectionInputSchema, configuredToolGroups, parseConnectionInput, resultSchema, workflowCatalog, type ToolGroup } from "../src/core/catalog.js";
import { DomainContentService } from "../src/services/domain-content.js";
import { domainRecipeCall, domainRecipeCatalog } from "../src/services/domain-recipes.js";
import { uiActionCapabilities } from "../src/core/ui-action-contract.js";

const id = randomUUID();
const bindings = [{ id: "R1", revision: 1, text: "Build the original requested page" }];

function expandLocalSchema(node: unknown, root: Record<string, unknown>): unknown {
  if (Array.isArray(node)) return node.map(value => expandLocalSchema(value, root));
  if (node === null || typeof node !== "object") return node;
  const { $ref, $defs: _definitions, ...fields } = node as Record<string, unknown>;
  const expanded = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, expandLocalSchema(value, root)]));
  if ($ref === undefined) return expanded;
  assert.equal(typeof $ref, "string");
  assert.match($ref as string, /^#\/\$defs\/[^/]+$/);
  const definition = (root.$defs as Record<string, unknown>)?.[($ref as string).slice(8)];
  assert.notEqual(definition, undefined, `Unresolved local schema reference: ${String($ref)}`);
  return { ...expandLocalSchema(definition, root) as Record<string, unknown>, ...expanded };
}

test("compact discovery preserves the complete schema and SDK validator semantics", () => {
  const all = createToolCatalog(["core", "signing-admin", "emulator-admin", "compatibility"]);
  const provider = new AjvJsonSchemaValidator();
  for (const tool of all) {
    const original = { ...z.toJSONSchema(connectionInputSchema(tool.name), { io: "input" }), type: "object" };
    assert.deepEqual(expandLocalSchema(tool.inputSchema, tool.inputSchema), original, tool.name);
    assert.ok(JSON.stringify(tool.inputSchema).length <= JSON.stringify(original).length, tool.name);
    // Compile every advertised schema with the same validator used by the real MCP SDK.
    const compact = provider.getValidator(JSON.parse(JSON.stringify(tool.inputSchema))), inline = provider.getValidator(JSON.parse(JSON.stringify(original)));
    for (const input of [null, [], {}, { ignored: true }])
      assert.equal(compact(input).valid, inline(input).valid, `${tool.name}: ${JSON.stringify(input)}`);
  }
  const samples = {
    ui_flow: { action: "list", project_path: "/project" },
    ui_query: { action: "find", query: { tree_file: "/tree.json", selector: { text: "Submit" } } },
    ui_test: { action: "start", test_plan: "Show the requested page", app: { bundle_name: "com.example.test", ability: "EntryAbility" } },
    verify_ui: { review: { requirement: "The requested page is visible" } },
    emulator_manage: { action: "start", name: "Phone" },
  } as const;
  for (const [name, input] of Object.entries(samples)) {
    const tool = all.find(candidate => candidate.name === name)!;
    const compact = provider.getValidator(JSON.parse(JSON.stringify(tool.inputSchema)));
    assert.equal(compact(input).valid, true, name);
    assert.equal(compact({ ...input, ignored: true }).valid, false, name);
  }
  const query = provider.getValidator(JSON.parse(JSON.stringify(all.find(tool => tool.name === "ui_query")!.inputSchema)));
  const uiStart = provider.getValidator(JSON.parse(JSON.stringify(all.find(tool => tool.name === "ui_test")!.inputSchema)));
  assert.equal(uiStart({action:"start",test_plan:"Read the captured deployment",deployment_run_id:id}).valid,true);
  assert.equal(uiStart({action:"start",test_plan:"Missing app or deployment"}).valid,false);
  assert.equal(query({ action: "inspect", query: { offset: -1 } }).valid, false);
  assert.equal(query({ action: "find", query: { tree_file: "/tree.json", selector: { text: 123 } } }).valid, false);
  const flow = all.find(tool => tool.name === "ui_flow")!;
  assert.ok("$defs" in flow.inputSchema);
  assert.ok(JSON.stringify(flow.inputSchema).length < JSON.stringify(z.toJSONSchema(connectionInputSchema("ui_flow"), { io: "input" })).length);
});

test("discovery is compact with static optional groups and callable migration aliases", () => {
  const core = createToolCatalog(), names = core.map(item => item.name);
  for (const name of ["domain_recipe", "domain_content", "domain_acceptance", "project_context", "maintenance", "ui_query", "ui_test"])
    assert.ok(names.includes(name as typeof names[number]));
  const aliases = ["skill_workflow", "switch_cwd", "deveco_restart", "ui_observe", "ui_find", "ui_inspect", "ui_tap"] as const;
  for (const name of [...aliases, "signature_admin", "emulator_admin"] as const) assert.equal(names.includes(name), false);
  assert.deepEqual(configuredToolGroups("compatibility, signing-admin,signing-admin"), ["core", "compatibility", "signing-admin"]);
  assert.throws(() => configuredToolGroups("unknown"), { code: "TOOL_GROUP_INVALID" });
  assert.equal(createToolCatalog(["core", "compatibility"]).length, core.length + aliases.length);
  assert.deepEqual(parseConnectionInput("switch_cwd", { project_path: "/explicit" }, ["core"]), { project_path: "/explicit" });
  assert.throws(() => parseConnectionInput("signature_admin", { action: "certificates" }, ["core"]), { code: "TOOL_GROUP_DISABLED" });
  assert.throws(() => parseConnectionInput("app_signature", { action: "certificates" }, ["core"]), { code: "TOOL_GROUP_DISABLED" });
  assert.throws(() => parseConnectionInput("emulator_manage", { action: "images" }, ["core"]), { code: "TOOL_GROUP_DISABLED" });
  assert.equal(z.object({ action: z.string() }).parse(parseConnectionInput("app_signature", { action: "certificates" }, ["core", "signing-admin"])).action, "certificates");
  assert.equal(z.object({ action: z.string() }).parse(parseConnectionInput("emulator_admin", { action: "images" }, ["core", "emulator-admin"])).action, "images");
  for (const groups of [["core"], ["core", "signing-admin", "emulator-admin"]] as ToolGroup[][]) {
    assert.throws(() => parseConnectionInput("app_signature", { action: "inspect", team_id: "cloud-only" }, groups));
    for (const field of ["device_type", "os_version", "downloaded", "license_sha256"])
      assert.throws(() => parseConnectionInput("emulator_manage", { action: "list", [field]: field === "downloaded" ? true : "admin-only" }, groups));
  }
  assert.throws(() => parseConnectionInput("app_signature", { action: "configure", file: "/descriptor.json", output: "/material", options: {} }, ["core"]));
  assert.throws(() => parseConnectionInput("emulator_manage", { action: "stop", name: "Phone" }, ["core"]));
  assert.equal(z.object({ team_id: z.string() }).parse(parseConnectionInput("app_signature", { action: "certificates", team_id: "cloud-team" }, ["core", "signing-admin"])).team_id, "cloud-team");
  assert.equal(z.object({ device_type: z.string() }).parse(parseConnectionInput("emulator_manage", { action: "images", device_type: "phone" }, ["core", "emulator-admin"])).device_type, "phone");
  assert.equal("team_id" in (core.find(tool => tool.name === "app_signature")!.inputSchema.properties ?? {}), false);
  for (const field of ["device_type", "os_version", "downloaded", "license_sha256"])
    assert.equal(field in (core.find(tool => tool.name === "emulator_manage")!.inputSchema.properties ?? {}), false);
  assert.equal(createToolCatalog(["core", "signing-admin"]).find(tool => tool.name === "app_signature")?.annotations.openWorldHint, true);
  assert.equal(createToolCatalog(["core", "emulator-admin"]).find(tool => tool.name === "emulator_manage")?.annotations.openWorldHint, true);
  const list = workflowCatalog();
  assert.deepEqual(list.workflows.map(item => item.id), workflowNames);
  assert.ok(list.workflows.every(item => !("input_schema" in item) && "read" in item));
  const build = workflowCatalog("project_build").workflows[0]!;
  assert.ok("input_schema" in build && build.input_schema);
  for (const tool of core) {
    assert.equal(tool.outputSchema.type, "object");
    assert.match(tool.outputSchema.$id, /^urn:deveco-tool:result:[a-f0-9]{64}$/);
    assert.equal(tool._meta["deveco/annotations-are-authorization"], false);
  }
  for (const name of ["domain_content", "domain_recipe", "project_context"])
    assert.equal(core.find(tool => tool.name === name)?.annotations.readOnlyHint, true);
  for (const name of ["ui_query", "maintenance", "domain_acceptance", "ui_test"])
    assert.equal(core.find(tool => tool.name === name)?.annotations.readOnlyHint, false);
  assert.equal(core.find(tool => tool.name === "maintenance")?.annotations.destructiveHint, true);
});

test("typed actions reject crossed UI/maintenance/content fields and requirement updates outside start", () => {
  for (const request of [
    { action: "snapshot", query: { mode: "tree" } },
    { action: "observe", query: { selector: { text: "Submit" } } },
    { action: "find", query: { tree_file: "/saved.json", selector: { text: "Submit" } } },
    { action: "inspect", query: { offset: 2, limit: 10 } },
  ]) assert.equal(tools.ui_query.schema.safeParse(request).success, true);
  for (const request of [
    { action: "snapshot", query: { mode: "tree", capture: { format: "png" } } },
    { action: "observe", query: { tree_file: "/saved.json" } },
    { action: "find", query: { tree_file: "/saved.json", target: "device" } },
    { action: "inspect", query: { snapshot_id: id } },
    { action: "click", query: {} }, { action: "find", selector: { text: "Submit" }, query: {} },
  ]) assert.equal(tools.ui_query.schema.safeParse(request).success, false, JSON.stringify(request));
  const json = z.toJSONSchema(tools.ui_query.schema, { io: "input" }) as unknown as { oneOf: { properties: { action: { const: string }; query: unknown }; additionalProperties: boolean }[] };
  assert.deepEqual(json.oneOf.map(branch => branch.properties.action.const), ["snapshot", "observe", "find", "inspect"]);
  assert.ok(json.oneOf.every(branch => branch.additionalProperties === false && branch.properties.query));
  for (const request of [{ action: "restart", run_ids: [id] }, { action: "cleanup_apply", run_ids: [id] }, { action: "cleanup_plan", run_ids: [id], plan_hash: "a".repeat(64) }, { action: "export", run_ids: [id] }])
    assert.equal(tools.maintenance.schema.safeParse(request).success, false);
  assert.equal(tools.maintenance.schema.safeParse({ action: "cleanup_apply", run_ids: [id], plan_hash: "a".repeat(64) }).success, true);
  assert.equal(tools.domain_content.schema.safeParse({ action: "read", uri: "deveco://recipe/spec", query: "ignored" }).success, false);
  assert.equal(tools.domain_recipe.schema.safeParse({ action: "start", id: "plan" }).success, false);
  assert.equal(tools.workflow_run.schema.safeParse({ action: "start", workflow: "project_build", input: { project_path: "/project" }, requirements: bindings }).success, true);
  for (const action of ["list", "status", "resume", "cancel", "read_artifact", "capacity", "cleanup_plan", "cleanup_apply", "export", "storage_receipt"])
    assert.equal(tools.workflow_run.schema.safeParse({ action, requirements: bindings }).success, false, action);
  const start = { action: "start", test_plan: "Show the requested page", app: { bundle_name: "com.example.test", ability: "EntryAbility" }, project_path: "/project", deployment_run_id: id, requirements: bindings };
  assert.equal(tools.ui_test.schema.safeParse(start).success, true);
  assert.equal(tools.ui_test.schema.safeParse({ ...start, requirements: [...bindings, ...bindings] }).success, false);
  assert.equal(tools.ui_test.schema.safeParse({ action: "status", test_id: id, requirements: bindings }).success, false);
  const step = { id: "A1", goal: "Display the requested page", review: { requirement: "The page matches the original requirement" }, requirement_ids: ["R1"], task_ids: ["T1"] };
  assert.equal(uiTestStepSchema.safeParse(step).success, true);
  for (const requirement_ids of [[], ["R1", "R1"], ["invalid reference"], Array.from({ length: 101 }, (_, index) => `R${index}`)])
    assert.equal(uiTestStepSchema.safeParse({ ...step, requirement_ids }).success, false);
  for (const task_ids of [[], ["T1", "T1"], ["invalid reference"], Array.from({ length: 101 }, (_, index) => `T${index}`)])
    assert.equal(uiTestStepSchema.safeParse({ ...step, task_ids }).success, false);
  assert.equal(tools.project_context.schema.safeParse({}).success, false);
  assert.equal(tools.project_context.schema.safeParse({ project_path: "/project", persist: true }).success, false);
});

test("success and error output envelopes are mutually exclusive and reject ignored fields", () => {
  assert.equal(resultSchema.safeParse({ ok: true, request_id: id, data: null }).success, true);
  const error = { code: "FAILED", message: "Action failed", retryable: false };
  assert.equal(resultSchema.safeParse({ ok: false, request_id: id, error }).success, true);
  for (const value of [{ ok: true, request_id: id, error }, { ok: false, request_id: id, data: {} }, { ok: true, request_id: id, data: {}, error }, { ok: false, request_id: id, error, data: {} }, { ok: false, request_id: id, error: { ...error, hidden: true } }])
    assert.equal(resultSchema.safeParse(value).success, false);
});

async function connection(root: string, groups: ToolGroup[] = ["core"]) {
  const client = new Client({ name: "native-domain-protocol-test", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../src/cli.js", import.meta.url))], cwd: root, stderr: "ignore", env: {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string,string] => entry[1] !== undefined && !entry[0].startsWith("DEVECO_") && !["NODE_OPTIONS", "NODE_PATH"].includes(entry[0]))),
    DEVECO_CONFIG: path.join(root, "config.json"), DEVECO_STATE_DIR: path.join(root, "state"), DEVECO_TOOL_GROUPS: groups.join(","),
  } });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    assert.notEqual(response.isError, true, JSON.stringify(response.structuredContent));
    return z.object({ ok: z.literal(true), data: z.unknown() }).parse(response.structuredContent).data;
  };
  return { client, call, close: async () => { await client.close(); await transport.close(); } };
}

test("MCP Resources, Prompts and tool reads share byte identity; project contexts and aliases have no global effect", { timeout: 30000 }, async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deveco-domain-protocol-")));
  let session: Awaited<ReturnType<typeof connection>> | undefined;
  try {
    const first = path.join(root, "first"), second = path.join(root, "second");
    for (const project of [first, second]) fs.cpSync(fileURLToPath(new URL("../../test/fixtures/harmony-app", import.meta.url)), project, { recursive: true });
    const config = JSON.stringify({ default_project: first });
    fs.writeFileSync(path.join(root, "config.json"), config);
    session = await connection(root);
    const { client, call } = session;
    assert.ok(client.getServerCapabilities()?.resources);
    assert.ok(client.getServerCapabilities()?.prompts);
    const resources: { uri: string; _meta?: Record<string, unknown> }[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listResources(cursor ? { cursor } : {});
      resources.push(...page.resources); cursor = page.nextCursor;
    } while (cursor);
    const content = new DomainContentService(), expected = content.catalog({ limit: 100 });
    assert.equal(resources.length, expected.total);
    assert.equal(new Set(resources.map(item => item.uri)).size, resources.length);
    assert.equal((await client.listResourceTemplates()).resourceTemplates.length, 4);
    for (const kind of ["skill", "knowledge", "recipe", "source"] as const) {
      const entry = content.catalog({ kind, limit: 1 }).entries[0]!;
      const resource = await client.readResource({ uri: entry.uri });
      const fromResource = z.object({ contents: z.array(z.object({ uri: z.string(), text: z.string(), mimeType: z.string() })).length(1), _meta: z.object({ sha256: z.string() }) }).parse(resource);
      const fromTool = z.object({ uri: z.string(), text: z.string(), mimeType: z.string(), sha256: z.string() }).parse(await call("domain_content", { action: "read", uri: entry.uri }));
      assert.equal(fromResource.contents[0]!.text, fromTool.text);
      assert.equal(fromResource.contents[0]!.mimeType, fromTool.mimeType);
      assert.equal(fromResource._meta.sha256, fromTool.sha256);
      assert.equal(createHash("sha256").update(fromTool.text).digest("hex"), entry.sha256);
      assert.equal(resources.find(item => item.uri === entry.uri)?._meta?.sha256, entry.sha256);
    }
    const promptList = await client.listPrompts();
    assert.deepEqual(promptList.prompts.map(item => item.name), domainRecipeCatalog().recipes.map(item => `harmonyos-${item.id}`));
    const original = "Keep the original user requirement exactly — 原始需求。";
    const prompt = await client.getPrompt({ name: "harmonyos-spec", arguments: { objective: original, project_path: first, host_capabilities: "reasoning,file_read,file_edit" } });
    const message = z.object({ type: z.literal("text"), text: z.string() }).parse(prompt.messages[0]?.content);
    const body = JSON.parse(message.text);
    assert.equal(body.original_requirement, original);
    assert.equal(body.project_path, first);
    assert.deepEqual(body.recipe, await call("domain_recipe", { action: "read", id: "spec", host_capabilities: ["reasoning", "file_read", "file_edit"] }));
    assert.deepEqual(JSON.parse(content.read("deveco://recipe/spec").text), domainRecipeCall({ action: "read", id: "spec" }));
    await assert.rejects(client.getPrompt({ name: "harmonyos-spec", arguments: { unknown: "rejected" } }));
    await assert.rejects(client.readResource({ uri: "deveco://skill/../skills.json" }));
    const descriptor = z.object({ project_path: z.string(), immutable: z.literal(true), scope_sha256: z.string() }).parse(await call("project_context", { project_path: first }));
    assert.equal(descriptor.project_path, first);
    await call("project_context", { project_path: second });
    await call("switch_cwd", { project_path: second });
    assert.equal(fs.readFileSync(path.join(root, "config.json"), "utf8"), config);
    assert.deepEqual(z.object({ project_path: z.string(), immutable: z.literal(true), scope_sha256: z.string() }).parse(await call("project_context", { project_path: first })), descriptor);
    const implicit = await client.callTool({ name: "arkts_check", arguments: {} });
    assert.equal(implicit.isError, true);
    assert.equal(z.object({ error: z.object({ code: z.string() }) }).parse(implicit.structuredContent).error.code, "PROJECT_REQUIRED");
    const tree = path.join(root, "tree.json");
    fs.writeFileSync(tree, JSON.stringify({ attributes: { type: "Button", id: "submit", text: "Submit", bounds: "[0,0][100,100]" } }));
    const query = { tree_file: tree, selector: { text: "Submit" } };
    assert.deepEqual(await call("ui_query", { action: "find", query }), await call("ui_find", query));
    assert.deepEqual(await call("workflow_catalog", { action: "ui_actions" }), uiActionCapabilities());
    assert.deepEqual(await call("skill_workflow", { action: "list" }), []);
    const retired = await client.callTool({ name: "skill_workflow", arguments: { action: "start", kind: "plan", project_path: first, objective: original } });
    assert.equal(z.object({ error: z.object({ code: z.string() }) }).parse(retired.structuredContent).error.code, "GUIDANCE_LIFECYCLE_RETIRED");
    const disabled = await client.callTool({ name: "signature_admin", arguments: { action: "certificates" } });
    assert.equal(z.object({ error: z.object({ code: z.string() }) }).parse(disabled.structuredContent).error.code, "TOOL_GROUP_DISABLED");
    const catalogBefore = await client.listTools();
    await call("maintenance", { action: "restart" });
    assert.deepEqual(await client.listTools(), catalogBefore);
    await session.close(); session = undefined;
    session = await connection(root, ["core", "signing-admin", "emulator-admin", "compatibility"]);
    assert.deepEqual((await session.client.listTools()).tools.map(tool => tool.name), createToolCatalog(["core", "signing-admin", "emulator-admin", "compatibility"]).map(tool => tool.name));
  } finally { await session?.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
