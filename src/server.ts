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
import { release } from "./core/config.js";
import { WorkerClient } from "./core/worker-client.js";

export async function serve() {
  const runtime = new WorkerClient((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
  const server = new Server(
    { name: "deveco-tool", version: release },
    {
      capabilities: { tools: {} },
      instructions:
        "Use workflow_catalog for fixed multi-step tasks. Only an explicit successful final assertion verifies UI outcomes. Large results are referenced artifacts. Local knowledge requires no Skill installation.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolCatalog,
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const id = crypto.randomUUID();
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
      const structuredContent = {
        ok: true,
        request_id: id,
        data: data ?? null,
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(structuredContent) },
        ],
        structuredContent,
      };
    } catch (error) {
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
