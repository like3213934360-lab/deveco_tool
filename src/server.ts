import { z } from "zod";
import { version } from "./core/config.js";
import { errorResult, ToolError } from "./core/errors.js";
import { McpServer } from "./mcp.js";
import type { ToolDef } from "./registry.js";
import { allTools } from "./tools/index.js";

const instructions = [
  "HarmonyOS/ArkTS development tools. Start with doctor when the environment is unknown.",
  "Always pass absolute project paths. Long operations (build, run, sync) return a job; use job action=wait rather than repeating the call.",
  "Before answering ArkTS/ArkUI/@kit API questions from memory, use knowledge search/read; for exact API signatures use code action=lsp op=hover/definition against the project SDK.",
  "If sources disagree, trust in this order: project SDK declarations and a successful build > official docs (local pack, cloud sections marked official) > community articles (hints only, never the API contract).",
  "After editing .ets files run code action=check before building. Verify UI outcomes with ui assert, not screenshots alone. Never retry a job in needs_input without inspecting it.",
].join(" ");

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** Structured, bounded response. Errors carry code/category/hint so hosts can self-correct. */
function respond(value: unknown, isError = false) {
  const content: Content[] = [];
  if (value && typeof value === "object" && "_image" in value) {
    const { _image, ...rest } = value as { _image?: { data: string; mime: string } };
    if (_image) content.push({ type: "image", data: _image.data, mimeType: _image.mime });
    value = rest;
  }
  content.unshift({ type: "text", text: JSON.stringify(value) });
  return { content, ...(isError ? { isError: true } : {}) };
}

export async function serve() {
  const tools = allTools;
  const byName = new Map<string, ToolDef>(tools.map((tool) => [tool.name, tool]));
  let listed: unknown[] | undefined; // JSON Schemas are built on first tools/list, not at startup

  const server = new McpServer({ name: "deveco-mcp", version }, { tools: {}, resources: {}, prompts: {} }, instructions);
  server.on("tools/list", async () => {
    listed ??= tools.map((tool) => {
      const { $schema: _s, ...schema } = z.toJSONSchema(tool.schema, { io: "input" }) as Record<string, unknown>;
      return {
        name: tool.name, title: tool.title, description: tool.description,
        inputSchema: { ...schema, type: "object" },
        annotations: { title: tool.title, readOnlyHint: tool.readOnly ?? false, openWorldHint: false },
      };
    });
    return { tools: listed };
  });
  server.on("tools/call", async (params, signal) => {
    const name = String(params.name);
    const tool = byName.get(name);
    if (!tool) return respond({ error: errorResult(new ToolError("INVALID_INPUT", `Unknown tool ${name}`)) }, true);
    try {
      const parsed = tool.schema.safeParse(params.arguments ?? {});
      if (!parsed.success) throw new ToolError("INVALID_INPUT", z.prettifyError(parsed.error), undefined, "Fix the listed fields and call again");
      return respond(await tool.handler(parsed.data, { signal }));
    } catch (error) {
      return respond({ error: errorResult(error) }, true);
    }
  });
  server.on("resources/list", async () => {
    const { listResources } = await import("./domains/resources.js");
    return { resources: await listResources() };
  });
  server.on("resources/templates/list", async () => ({ resourceTemplates: [] }));
  server.on("resources/read", async (params) => {
    const { readResource } = await import("./domains/resources.js");
    return { contents: [await readResource(String(params.uri))] };
  });
  server.on("prompts/list", async () => {
    const { listPrompts } = await import("./domains/resources.js");
    return { prompts: listPrompts() };
  });
  server.on("prompts/get", async (params) => {
    const { getPrompt } = await import("./domains/resources.js");
    return getPrompt(String(params.name), (params.arguments ?? {}) as Record<string, string>);
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const [{ shutdownJobs }, { closeAllSessions }, { killAll }, { closeDatabase }] = await Promise.all([
      import("./core/jobs.js"), import("./core/sessions.js"), import("./core/proc.js"), import("./core/db.js"),
    ]);
    await Promise.race([Promise.all([shutdownJobs(), closeAllSessions()]), new Promise((r) => setTimeout(r, 3000))]);
    killAll();
    closeDatabase();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.start(() => void shutdown());
  // Mark jobs from dead processes as interrupted, off the handshake path.
  setTimeout(() => void import("./core/jobs.js").then((m) => m.recoverJobs()).catch(() => {}), 2000).unref();
}
