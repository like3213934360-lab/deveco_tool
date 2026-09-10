import { requestAction, requestOutcome } from "./core/request-outcome.js";
import crypto from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tools, type ToolName } from "./core/contracts.js";
import { toolCatalog, workflowCatalog } from "./core/catalog.js";
import { errorResult, invariant } from "./core/errors.js";
import { release, protocolVersion } from "./core/config.js";
import { WorkerClient } from "./core/worker-client.js";
import { artifactImageSchema } from "./core/artifact-image.js";

export const serverInstructions = [
  "Use workflow_catalog for fixed multi-step tasks.",
  "Before writing or modifying the first .ets file in a task, use harmony_knowledge to read arkts-grammar-standards/recipes-core and consult the matching ArkTS or ArkUI references; review the Top-5 ArkTS traps before each additional .ets file.",
  "Keep project entry-page and routing declarations consistent with the selected module and product.",
  "After code changes, run applicable diagnostics first, then project_build, then an explicit verification step; only an explicit successful final assertion verifies UI outcomes.",
  "All HarmonyOS knowledge, Skills and guided workflow definitions are bundled in this MCP. Use them directly through tools; never install Skill files into the AI client. Large results are referenced artifacts.",
  "Use skill_workflow catalog/start for builtin plan/debug/spec/customize/arkts/repair/create/ui_test workflows. Each read/update returns current-phase Skill instructions, bundled knowledge, next tool actions and completion gates. Keep the run_id and revision, execute the indicated native MCP workflows, then attach applicable evidence. skill_manage catalog/read loads additional bundled references over MCP.",
  "For natural-language UI plans use ui_test: capture scopes, keep original requirements, execute bounded actions, check, read exact review images and complete ui_review before finish. On unchanged state inspect and replan; command acceptance alone never completes a test. Capture-only requests use ui_snapshot mode=image.",
  "Build workflows run a fresh full ArkTS preflight by default. Repair blocking diagnostics and recheck after changes; an explicit manual_override needs a recorded reason. Use workflow_run capacity/export/cleanup_plan/cleanup_apply for retained-state recovery instead of bypassing MCP deployment.",
].join(" ");

export async function serve() {
  const runtime = new WorkerClient((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
  const server = new Server(
    { name: "deveco-tool", version: release },
    {
      capabilities: { tools: {} },
      instructions: serverInstructions,
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    process.stderr.write(JSON.stringify({ kind: "mcp_catalog", stage: "host", release, protocol: protocolVersion, request_id: crypto.randomUUID(), outcome: "returned", tool_count: toolCatalog.length }) + "\n");
    return { tools: toolCatalog };
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
      const input = tools[name].schema.parse(request.params.arguments ?? {});
      let data: unknown;
      if (name === "workflow_catalog") {
        const args = tools.workflow_catalog.schema.parse(input);
        invariant(
          args.action !== "get" || args.workflow,
          "WORKFLOW_REQUIRED",
          "Specify workflow",
        );
        data = workflowCatalog(
          args.action === "get" ? args.workflow : undefined,
        );
      } else if (name === "deveco_restart") data = await runtime.close();
      else data = await runtime.call(name, input, extra.signal, id);
      let image:
        ReturnType<typeof artifactImageSchema.parse>["image"] | undefined;
      if (name === "workflow_run") {
        const args = tools.workflow_run.schema.parse(input);
        if (args.action === "read_artifact" && args.as === "image") {
          const parsed = artifactImageSchema.parse(data);
          image = parsed.image;
          const { image: _image, ...metadata } = parsed;
          data = metadata;
        }
      }
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
      const structuredContent = {
        ok: false,
        request_id: id,
        error: errorResult(error),
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
