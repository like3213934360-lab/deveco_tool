import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callCodeGenieTool, closeCodeGenie, getCodeGenieTools } from "./codegenie-client.mjs";
import { PROXIED_CODEGENIE_TOOLS, PROXIED_CODEGENIE_TOOL_NAMES } from "./codegenie-tools.mjs";
import { collectDoctorReport } from "./doctor.mjs";
import { runArktsCheck, arktsCheckStatus } from "./arkts-check.mjs";
import { collectEnvironmentStatus } from "./config.mjs";
import { buildProject, devecoCliStatus, startApp } from "./deveco-cli.mjs";
import { validateDocument } from "./document-validate.mjs";
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
import { listScripts, pythonStatus, runRegisteredScript } from "./script-registry.mjs";

const scriptIds = listScripts().map((script) => script.id);

// CodeGenie also ships these, but this gateway implements them itself; hide the
// proxied copies so each name resolves once. build_project and start_app run
// through the bundled DevEco CLI so that building and launching keep working
// even when the CodeGenie child is unavailable.
const LOCAL_OVERRIDE_TOOLS = ["init_project_path", "check_ets_files", "build_project", "start_app"];

// The UI auto-verification chain is not part of this pack. verify_ui needs a
// multimodal model that nothing here configures, and save_ui_screenshot /
// get_ui_verification_log are keyed by a verify_ui run id, so without it they
// can only ever answer "not found". They are hidden from the tool list and
// rejected on call rather than proxied.
const DISABLED_CODEGENIE_TOOLS = ["verify_ui", "save_ui_screenshot", "get_ui_verification_log"];

// The tool list used to be filtered at request time, which made these two tables self-enforcing.
// Now that the proxy table is static, nothing would notice if a name ended up in two of them and
// so resolved to two different implementations. Fail at startup instead of shipping the ambiguity.
for (const tool of PROXIED_CODEGENIE_TOOLS) {
  if (LOCAL_OVERRIDE_TOOLS.includes(tool.name) || DISABLED_CODEGENIE_TOOLS.includes(tool.name)) {
    throw new Error(`${tool.name} is proxied to CodeGenie but is also overridden or disabled locally`);
  }
}

// Resolving the CodeGenie child is deliberately not awaited during startup.
// Its handshake intermittently never completes, and awaiting it here meant the
// gateway never reached server.connect(), so the whole MCP silently failed to
// answer `initialize` -- taking every local tool down with a child process that
// only five tools need. Handlers await this instead, and a failed attempt is
// forgotten so the next request can retry.
let codegenieToolsPromise = null;

function codegenieTools() {
  if (!codegenieToolsPromise) {
    codegenieToolsPromise = getCodeGenieTools().catch((error) => {
      console.error(`[deveco-tool] ${error.code}: ${error.message}`);
      codegenieToolsPromise = null;
      return [];
    });
  }
  return codegenieToolsPromise;
}


const localTools = [
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
    name: "build_project",
    description: "Build a HarmonyOS project or specific modules through the bundled DevEco CLI. "
      + "Omit modules to build the whole product. Set clean only when a full rebuild is explicitly wanted: "
      + "it cleans and then builds, which discards incremental caches and makes the build much slower.",
    inputSchema: {
      type: "object",
      properties: {
        modules: {
          type: "array",
          items: { type: "string" },
          description: "Modules to build, as `module` or `module@target` (e.g. entry, app_platform@default).",
        },
        module: { type: "string", description: "Single module, kept for compatibility; merged into modules." },
        product: { type: "string", description: "Product name from build-profile.json5; defaults to `default`." },
        build_mode: { type: "string", description: "Build mode from buildModeSet (e.g. debug, release); defaults to debug." },
        clean: { type: "boolean", description: "Clean build outputs first, then build." },
        log_path: { type: "string", description: "Write the full build log here; the reply then keeps only the last 50 lines." },
        enable_inspector_source_jump: {
          type: "boolean",
          description: "Accepted for compatibility only. The DevEco CLI has no equivalent, so this is reported as not applied rather than silently ignored.",
        },
        project_path: { type: "string", description: "Optional project root; otherwise the active project from switch_cwd." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 3600000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "start_app",
    description: "Deploy the already-built app to a connected device and launch it through the bundled DevEco CLI. "
      + "Does not build. Resolves the device automatically when exactly one is connected.",
    inputSchema: {
      type: "object",
      properties: {
        hvd: { type: "string", description: "Target device name or serial; resolved automatically when omitted." },
        module: { type: "string", description: "Module to launch (e.g. entry, phone)." },
        target: { type: "string", description: "Build target; combined with module as module@target." },
        ability: { type: "string", description: "Ability to launch; read from module.json5 when omitted." },
        project_path: { type: "string", description: "Optional project root; otherwise the active project from switch_cwd." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 3600000 },
      },
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
    description: "Find all ArkTS/TypeScript references to the symbol at an absolute file position. Project files mentioning the symbol are loaded into the language server first, so results cover the whole project rather than only files opened earlier this session.",
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
    description: "Run any official DevEco LSP operation: definition, references, hover, document/workspace symbols, implementation, or call hierarchy. Request line/character are 1-based, but the response is the raw LSP payload, so positions inside it are 0-based; the go_to_definition / find_references / get_hover / list_symbols / find_call_hierarchy wrappers normalise theirs to 1-based.",
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
    description: "Find incoming callers or outgoing callees for an ArkTS/TypeScript symbol. For direction=incoming, project files mentioning the symbol are loaded into the language server first so callers outside the current module are found.",
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
  {
    name: "document_validate",
    description: "Check an SDD artifact (spec.md / plan.md / tasks.md) against the section structure its template mandates: missing required sections, duplicate headings, disallowed level-2 sections, and the level-2 ceiling. Reports; never blocks. Call it after writing the artifact.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Path to the artifact. Relative paths resolve against the active project." },
        content: { type: "string", description: "Document text to validate instead of reading from disk. Wins over the file's contents when both are given." },
        documentType: {
          type: "string",
          enum: ["spec", "design", "tasks"],
          description: "Rule set to apply. Inferred from the basename (spec.md, plan.md, tasks.md) when omitted; plan.md maps to design.",
        },
      },
      additionalProperties: false,
    },
  },
];

function textResult(value, isError = false) {
  return {
    isError,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

// Build and launch reports are long console transcripts; JSON-encoding them
// would only make them harder to read.
function plainResult(text, isError = false) {
  return { isError, content: [{ type: "text", text }] };
}

const server = new Server(
  { name: "deveco-tool", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// Answered entirely from static tables: no await, so a stalled CodeGenie child cannot delay
// tool discovery. The child is contacted only when one of the proxied tools is called.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...localTools, ...PROXIED_CODEGENIE_TOOLS],
}));

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
      // The child used to be told the new path here, which meant switching projects waited on
      // its handshake. callCodeGenieTool already syncs the bound project before every proxied
      // call, so the child still learns the path -- just lazily, at first use.
      return textResult({ tool: name, ...project });
    }

    if (name === "deveco_doctor") {
      // Same report the CLI renders; the memoised loader is passed in so the probe reuses the
      // child this process already started rather than spawning a second one.
      return textResult(await collectDoctorReport({ loadCodeGenieTools: codegenieTools }));
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

    if (name === "build_project") {
      return plainResult(await buildProject(args));
    }

    if (name === "start_app") {
      return plainResult(await startApp(args));
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

    if (name === "document_validate") {
      return textResult(validateDocument(args));
    }

    if (DISABLED_CODEGENIE_TOOLS.includes(name)) {
      return textResult({
        code: "TOOL_DISABLED",
        message: `${name} is not available: this pack does not ship the UI auto-verification chain.`,
        hint: "Use get_app_ui_tree and perform_ui_action to inspect and drive the UI directly.",
      }, true);
    }

    // CodeGenie counts installed-but-stopped emulators as selectable targets and
    // demands hvd even when exactly one device is actually online, while
    // get_app_ui_tree picks that device on its own. Resolve it the same way here.
    if (name === "perform_ui_action" && !args.hvd) {
      const { devices } = await hdcLog({ action: "list_devices" });
      if (devices.length === 0) {
        return textResult({ code: "HDC_NO_DEVICE", message: "No connected HarmonyOS devices detected." }, true);
      }
      if (devices.length > 1) {
        return textResult({
          code: "HDC_DEVICE_REQUIRED",
          message: `Multiple HarmonyOS devices are connected (${devices.join(", ")}); pass hvd.`,
        }, true);
      }
      return await callCodeGenieTool(name, { ...args, hvd: devices[0] });
    }

    // Dispatch off the static table, not off a list fetched from the child. An unreachable child
    // now surfaces as a CODEGENIE_UNAVAILABLE error from the call itself, which is actionable,
    // rather than as the tool quietly disappearing from tools/list.
    if (PROXIED_CODEGENIE_TOOL_NAMES.includes(name)) {
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

// Start the CodeGenie child now so the first tools/list usually finds it ready,
// but only after `initialize` can already be served.
codegenieTools();

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
