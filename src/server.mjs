import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callCodeGenieTool, closeCodeGenie, getCodeGenieTools } from "./codegenie-client.mjs";
import { runArktsCheck, arktsCheckStatus } from "./arkts-check.mjs";
import { collectEnvironmentStatus } from "./config.mjs";
import { hdcLog, hdcStatus } from "./hdc-log.mjs";
import {
  findCallHierarchy,
  findReferences,
  getHover,
  goToDefinition,
  listSymbols,
  lspOperation,
  lspStatus,
  resetLsp,
  shutdownLsp,
} from "./lsp.mjs";
import { authStatus, login, logout } from "./modules/auth.mjs";
import { searchKnowledge } from "./modules/knowledge.mjs";
import { getProjectContext, setProjectPath } from "./project-context.mjs";
import { listScripts, runRegisteredScript } from "./script-registry.mjs";

const scriptIds = listScripts().map((script) => script.id);

let codegenieTools = [];
try {
  codegenieTools = await getCodeGenieTools();
} catch (error) {
  console.error(`[deveco-tool] ${error.code}: ${error.message}`);
}

const tools = [
  {
    name: "deveco_script_catalog",
    description: "List the allowlisted DevEco skill scripts that can be executed through this unified MCP.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "deveco_script",
    description: "Run one allowlisted DevEco skill script. Use args for named values or argv for exact script arguments.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", enum: scriptIds },
        args: { type: "object", additionalProperties: true },
        argv: { type: "array", items: { type: "string" } },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
      },
      required: ["script"],
      additionalProperties: false,
    },
  },
  {
    name: "switch_cwd",
    description: "Set the active HarmonyOS project root for subsequent script calls.",
    inputSchema: {
      type: "object",
      properties: { project_path: { type: "string" } },
      required: ["project_path"],
      additionalProperties: false,
    },
  },
  {
    name: "init_project_path",
    description: "Compatibility alias for switch_cwd; set the active HarmonyOS project root.",
    inputSchema: {
      type: "object",
      properties: { project_path: { type: "string" } },
      required: ["project_path"],
      additionalProperties: false,
    },
  },
  {
    name: "deveco_doctor",
    description: "Inspect local DevEco, HDC, project-context, and extracted Skill availability.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "arkts_knowledge_search",
    description: "Search the official DevEco CodeGenie ArkTS, ArkUI, HarmonyOS, and OpenHarmony knowledge base.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", minLength: 1 } },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "deveco_login",
    description: "Open the China-site Huawei DevEco login page and persist the local session token.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "deveco_logout",
    description: "Clear the local DevEco login session.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "deveco_status",
    description: "Return DevEco login state without exposing access or refresh tokens.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "arkts_check",
    description: "Run the official DevEco ArkTS static checker against the selected project or explicit .ets files.",
    inputSchema: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" }, description: "Optional project-relative or absolute .ets paths; omit to scan the project." },
        project_path: { type: "string", description: "Optional project root; otherwise use the active project from switch_cwd." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "check_ets_files",
    description: "Run the official local DevEco ArkTS checker for the requested .ets or .ts files.",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string" },
          description: "Project-relative or absolute .ets/.ts file paths.",
        },
      },
      required: ["files"],
      additionalProperties: false,
    },
  },
  {
    name: "hdc_log",
    description: "List connected HarmonyOS devices, collect filtered hilog lines, or clear the device log buffer.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["collect", "clear", "list_devices"] },
        device_id: { type: "string" },
        log_prefix: { type: "string", description: "Collect only lines containing this prefix; defaults to [VCODER_DEBUG]." },
        lines: { type: "integer", minimum: 1, maximum: 5000 },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "find_references",
    description: "Find all ArkTS/TypeScript references to the symbol at an absolute file position.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string" },
        line: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
        includeDeclaration: { type: "boolean" },
      },
      required: ["file", "line", "column"],
      additionalProperties: false,
    },
  },
  {
    name: "lsp",
    description: "Run any official DevEco LSP operation: definition, references, hover, document/workspace symbols, implementation, or call hierarchy.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["goToDefinition", "findReferences", "hover", "documentSymbol", "workspaceSymbol", "goToImplementation", "prepareCallHierarchy", "incomingCalls", "outgoingCalls"],
        },
        filePath: { type: "string", description: "Absolute or project-relative source file path." },
        line: { type: "integer", minimum: 1 },
        character: { type: "integer", minimum: 1 },
        query: { type: "string", description: "Workspace-symbol search query; empty string requests all symbols." },
      },
      required: ["operation", "filePath", "line", "character"],
      additionalProperties: false,
    },
  },
  {
    name: "go_to_definition",
    description: "Go to the ArkTS/TypeScript definition at an absolute file position.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string" },
        line: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
      },
      required: ["file", "line", "column"],
      additionalProperties: false,
    },
  },
  {
    name: "get_hover",
    description: "Get ArkTS/TypeScript type information and documentation at an absolute file position.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string" },
        line: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
      },
      required: ["file", "line", "column"],
      additionalProperties: false,
    },
  },
  {
    name: "list_symbols",
    description: "List functions, classes, variables, and other symbols defined in an ArkTS/TypeScript file.",
    inputSchema: {
      type: "object",
      properties: { file: { type: "string" } },
      required: ["file"],
      additionalProperties: false,
    },
  },
  {
    name: "find_call_hierarchy",
    description: "Find incoming callers or outgoing callees for an ArkTS/TypeScript symbol.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string" },
        line: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
        direction: { type: "string", enum: ["incoming", "outgoing"] },
      },
      required: ["file", "line", "column", "direction"],
      additionalProperties: false,
    },
  },
  ...codegenieTools.filter((tool) => !["init_project_path", "check_ets_files"].includes(tool.name)),
];

function textResult(value, isError = false) {
  return {
    isError,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

const server = new Server(
  { name: "deveco-tool", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};

  try {
    if (name === "deveco_script_catalog") {
      return textResult({ scripts: listScripts(), count: scriptIds.length });
    }

    if (name === "deveco_script") {
      if (typeof args.script !== "string") {
        return textResult({ code: "SCRIPT_REQUIRED", message: "script is required" }, true);
      }
      const result = await runRegisteredScript(args.script, args);
      return textResult(result, !result.ok);
    }

    if (name === "switch_cwd" || name === "init_project_path") {
      const project = setProjectPath(args.project_path);
      await resetLsp();
      if (codegenieTools.some((tool) => tool.name === "init_project_path")) {
        await callCodeGenieTool("init_project_path", { project_path: project.projectPath });
      }
      return textResult({ tool: name, ...project });
    }

    if (name === "deveco_doctor") {
      return textResult({
        environment: collectEnvironmentStatus(),
        project: getProjectContext(),
        scripts: listScripts(),
        codegenie: { available: codegenieTools.length > 0, toolCount: codegenieTools.length },
        arktsChecker: arktsCheckStatus(),
        lsp: lspStatus(),
        hdc: hdcStatus(),
        auth: authStatus(),
      });
    }

    if (name === "arkts_knowledge_search") {
      if (typeof args.question !== "string" || args.question.trim() === "") {
        return textResult({ code: "QUESTION_REQUIRED", message: "question must be a non-empty string" }, true);
      }
      return textResult({ question: args.question, answer: await searchKnowledge(args.question) });
    }

    if (name === "deveco_login") {
      const user = await login();
      return textResult({ loggedIn: true, userId: user.userId, userName: user.userName });
    }

    if (name === "deveco_logout") {
      await logout();
      return textResult({ loggedIn: false });
    }

    if (name === "deveco_status") {
      return textResult(authStatus());
    }

    if (name === "arkts_check") {
      return textResult(await runArktsCheck(args));
    }

    if (name === "check_ets_files") {
      if (!Array.isArray(args.files)) {
        return textResult({ code: "ARKTS_FILES_INVALID", message: "files must be an array of .ets or .ts paths" }, true);
      }
      return textResult(await runArktsCheck({ files: args.files }));
    }

    if (name === "hdc_log") {
      return textResult(await hdcLog(args));
    }

    if (name === "find_references") {
      return textResult(await findReferences(args));
    }

    if (name === "lsp") {
      return textResult(await lspOperation(args));
    }

    if (name === "go_to_definition") {
      return textResult(await goToDefinition(args));
    }

    if (name === "get_hover") {
      return textResult(await getHover(args));
    }

    if (name === "list_symbols") {
      return textResult(await listSymbols(args));
    }

    if (name === "find_call_hierarchy") {
      return textResult(await findCallHierarchy(args));
    }

    if (codegenieTools.some((tool) => tool.name === name)) {
      return await callCodeGenieTool(name, args);
    }

    return textResult({ code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` }, true);
  } catch (error) {
    return textResult({
      code: error.code ?? "TOOL_ERROR",
      message: error.message,
      hint: error.hint,
    }, true);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

let shutdownPromise;

function waitForShutdownTimeout(timeoutMs) {
  return new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), timeoutMs);
  });
}

async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const cleanup = Promise.allSettled([shutdownLsp(), closeCodeGenie()]);
    await Promise.race([cleanup, waitForShutdownTimeout(5000)]);
    process.exit(0);
  })();
  return shutdownPromise;
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.stdin.once("end", shutdown);
process.stdin.once("close", shutdown);
