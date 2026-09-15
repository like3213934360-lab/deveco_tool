import { requestAction, requestOutcome } from "./core/request-outcome.js";
import crypto from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tools, type ToolName } from "./core/contracts.js";
import { configuredToolGroups, createToolCatalog, parseConnectionInput, workflowCatalog } from "./core/catalog.js";
import { DomainContentService } from "./services/domain-content.js";
import { domainRecipeCall, domainRecipeCatalog, domainRecipeSchema, hostCapabilityNames } from "./services/domain-recipes.js";
import { z } from "zod";
import { uiActionCapabilities } from "./core/ui-action-contract.js";
import { errorResult, invariant } from "./core/errors.js";
import { release, protocolVersion } from "./core/config.js";
import { WorkerClient } from "./core/worker-client.js";
import { toolImageResponse } from "./core/tool-image-response.js";

export const serverInstructions = [
  "HarmonyOS: workflow_catalog describes native workflows; domain_recipe reads task methods and source-linked knowledge.",
  "Pass project_path and target scopes explicitly; runs retain their scope. One-off UI tests can observe and act directly. Use ui_flow list/routes when a saved path or repeated navigation is useful; validate matching flows and record only reusable authorized setup. Complete setup before ui_test start; fresh_start=false preserves its app state.",
  "ui_query observes; ui_control acts/records. Active ui_test steps must use ui_test act/check, retaining scope and budgets. Inspect run status before retries; reconcile unknown effects before replay. Command acceptance and verified outcomes differ. Keep run IDs/revisions and artifact evidence; maintenance provides recovery.",
].join(" ");

export async function serve() {
  const groups = configuredToolGroups();
  const toolCatalog = createToolCatalog(groups);
  const content = new DomainContentService();
  const runtime = new WorkerClient((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
  const server = new Server(
    { name: "deveco-tool", version: release },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: serverInstructions,
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    process.stderr.write(JSON.stringify({ kind: "mcp_catalog", stage: "host", release, protocol: protocolVersion, request_id: crypto.randomUUID(), outcome: "returned", tool_count: toolCatalog.length }) + "\n");
    return { tools: toolCatalog };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async request => {
    const offset = request.params?.cursor ? z.string().regex(/^\d{1,9}$/).transform(Number).parse(request.params.cursor) : 0;
    const page = content.catalog({ offset, limit: 100 });
    return {
      resources: page.entries.map(entry => ({ uri: entry.uri, name: entry.name, description: entry.description, mimeType: entry.mimeType, _meta: { sha256: entry.sha256 } })),
      ...(page.next_offset < page.total ? { nextCursor: String(page.next_offset) } : {}),
    };
  });
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      { uriTemplate: "deveco://skill/{name}/{file}", name: "Bundled HarmonyOS Skill file", mimeType: "text/markdown", description: "Use skill_manage catalog for names and allowed files; shares reviewed content digests with tool reads." },
      { uriTemplate: "deveco://knowledge/{id}", name: "HarmonyOS knowledge entry", mimeType: "text/markdown", description: "Use harmony_knowledge catalog/search for stable rule/case/example IDs." },
      { uriTemplate: "deveco://recipe/{id}", name: "Domain recipe", mimeType: "application/json", description: "Use domain_recipe catalog for on-demand methods and optional templates." },
      { uriTemplate: "deveco://source/{id}", name: "Reviewed source asset", mimeType: "text/plain", description: "Original source and adaptation identity remain separate." },
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    const result = content.read(request.params.uri);
    return { contents: [{ uri: result.uri, mimeType: result.mimeType, text: result.text }], _meta: { sha256: result.sha256, source: result.source } };
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const catalog = domainRecipeCatalog();
    return { prompts: catalog.recipes.map(recipe => ({
      name: `harmonyos-${recipe.id}`, description: recipe.description,
      arguments: [
        { name: "objective", description: "Original user requirement, retained verbatim", required: false },
        { name: "project_path", description: "Explicit project scope for subsequent native calls", required: false },
        { name: "host_capabilities", description: `Optional comma-separated capabilities: ${hostCapabilityNames.join(", ")}`, required: false },
      ],
    })) };
  });
  server.setRequestHandler(GetPromptRequestSchema, async request => {
    const args = z.strictObject({ objective: z.string().max(16384).optional(), project_path: z.string().min(1).optional(), host_capabilities: z.string().optional() }).parse(request.params.arguments ?? {});
    invariant(request.params.name.startsWith("harmonyos-"), "PROMPT_UNKNOWN", "Use prompts/list to select a HarmonyOS recipe");
    const recipeInput = domainRecipeSchema.parse({ action: "read", id: request.params.name.slice("harmonyos-".length), ...(args.host_capabilities !== undefined ? { host_capabilities: args.host_capabilities.split(",").map(value => value.trim()).filter(Boolean) } : {}) });
    const recipe = domainRecipeCall(recipeInput);
    return { description: "On-demand domain method; the host retains reasoning and editing responsibility", messages: [{ role: "user" as const, content: { type: "text" as const, text: JSON.stringify({ original_requirement: args.objective ?? null, project_path: args.project_path ?? null, recipe }) } }] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const id = crypto.randomUUID(), started = performance.now();
    const hostEvent = (result: Record<string, unknown>) => process.stderr.write(JSON.stringify({ kind: "mcp_request", stage: "host", release, protocol: protocolVersion, request_id: id, tool: Object.hasOwn(tools, request.params.name) ? request.params.name : "unknown", ...result, elapsed_ms: performance.now() - started }) + "\n");
    try {
      invariant(
        Object.hasOwn(tools, request.params.name),
        "TOOL_UNKNOWN",
        "Unknown tool name",
      );
      const name = request.params.name as ToolName;
      const input = parseConnectionInput(name, request.params.arguments ?? {}, groups);
      let data: unknown;
      if (name === "workflow_catalog") {
        const args = tools.workflow_catalog.schema.parse(input);
        invariant(
          args.action !== "get" || args.workflow,
          "WORKFLOW_REQUIRED",
          "Specify workflow",
        );
        data = args.action === "ui_actions" ? uiActionCapabilities() : workflowCatalog(
          args.action === "get" ? args.workflow : undefined,
        );
      } else if (name === "deveco_restart" || (name === "maintenance" && tools.maintenance.schema.parse(input).action === "restart")) data = await runtime.close();
      else data = await runtime.call(name, input, extra.signal, id);
      const envelope = toolImageResponse(name, input, data);
      data = envelope.data;
      const image = envelope.image;
      const structuredContent = {
        ok: true,
        request_id: id,
        data: data ?? null,
      };
      hostEvent({ ...requestAction(input), ...requestOutcome(data) });
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(structuredContent) },
          ...(image ? [image] : []),
        ],
        structuredContent,
      };
    } catch (error) {
      hostEvent({ ...requestAction(request.params.arguments), outcome: "error", code: errorResult(error).code });
      const failure = errorResult(error), args = request.params.arguments ?? {};
      const workflowInput = args.input !== null && typeof args.input === "object" && !Array.isArray(args.input) ? args.input as Record<string, unknown> : args;
      const structuredContent = {
        ok: false,
        request_id: id,
        error: { ...failure, recovery: recoveryAdvice(failure.code, {
          tool: request.params.name,
          ...(typeof args.workflow === "string" ? { workflow: args.workflow } : {}),
          ...(request.params.name === "workflow_run" && typeof args.run_id === "string" ? { run_id: args.run_id } : {}),
          ...(typeof workflowInput.project_path === "string" ? { project_path: workflowInput.project_path } : {}),
        }) },
      };
      return {
        isError: true,
        content: [
          { type: "text" as const, text: JSON.stringify(structuredContent) },
        ],
        structuredContent,
      };
    }
  });
  let stopping = false;
  const close = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await runtime.close();
    } catch (error) {
      process.stderr.write(JSON.stringify(errorResult(error)) + "\n");
      process.exitCode = 1;
    } finally {
      await server.close();
    }
  };
  process.once("SIGTERM", () => {
    void close();
  });
  process.once("SIGINT", () => {
    void close();
  });
  process.stdin.once("end", () => {
    void close();
  });
  await server.connect(new StdioServerTransport());
}
import { recoveryAdvice } from "./core/recovery.js";
