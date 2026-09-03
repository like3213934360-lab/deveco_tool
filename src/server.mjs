import fs from "node:fs";
import crypto from "node:crypto";
import Ajv from "ajv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  callCodeGenieTool, closeCodeGenie, getCodeGenieTools, resetCodeGenieCircuit,
} from "./codegenie-client.mjs";
import { PROXIED_CODEGENIE_TOOLS, PROXIED_CODEGENIE_TOOL_NAMES } from "./codegenie-tools.mjs";
import { collectDoctorReport } from "./doctor.mjs";
import { runArktsCheck, arktsCheckStatus } from "./arkts-check.mjs";
import { collectEnvironmentStatus } from "./config.mjs";
import {
  apiCompatibilityCheck,
  applyChanges,
  buildProject,
  cancelBuildProjectJob,
  closeBuildProjectJobs,
  devecoCliStatus,
  getBuildProjectJob,
  projectSync,
  startBuildProjectJob,
  startApp,
} from "./deveco-cli.mjs";
import {
  cliAuth,
  codeLint,
  deviceInfo,
  emulatorManage,
  emulatorScenario,
  harmonyDocs,
  signatureGenerate,
  uiControl,
  uiInspect,
} from "./deveco-official.mjs";
import { closeHotReload, hotReload } from "./hotreload.mjs";
import { uiFind, uiObserve, uiSnapshot, uiTap } from "./device-ui.mjs";
import { validateDocument } from "./document-validate.mjs";
import { hdcLog, hdcStatus } from "./hdc-log.mjs";
import {
  findCallHierarchy,
  findReferences,
  getHover,
  goToDeclaration,
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

const commonTimeout = { type: "integer", minimum: 1000, maximum: 3600000 };
const deviceTypes = ["phone", "foldable", "widefold", "triplefold", "tablet", "2in1", "2in1 foldable", "wearable", "tv"];

const officialTools = [
  {
    name: "code_lint",
    description: "Run the official project-level DevEco Code Linter, with incremental checking, JSON/report output, and optional automatic fixes.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional file or directory to lint, relative to the project." },
        fix: { type: "boolean", description: "Apply the linter's automatic fixes." },
        incremental: { type: "boolean" },
        config_path: { type: "string" },
        product: { type: "string" },
        format: { type: "string", enum: ["default", "json"] },
        output_path: { type: "string" },
        limit: { type: "integer", minimum: 1 },
        project_path: { type: "string" }, timeoutMs: commonTimeout,
      },
      additionalProperties: false,
    },
  },
  {
    name: "hot_reload",
    description: "Manage one real persistent DevEco hot-reload watch session: start, apply changed .ets files without restarting the app, inspect status, or stop.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "apply", "status", "stop"] },
        files: { type: "array", minItems: 1, items: { type: "string" } },
        hvd: { type: "string" }, module: { type: "string" }, product: { type: "string" },
        build_mode: { type: "string" }, ability: { type: "string" }, project_path: { type: "string" },
        timeoutMs: commonTimeout,
      },
      required: ["action"], additionalProperties: false,
    },
  },
  {
    name: "harmony_docs",
    description: "Use the official local DevEco documentation center: list catalogs, search a catalog, or read a document by ID.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["catalog", "search", "read"] },
        keywords: { type: "array", minItems: 1, items: { type: "string" } }, catalog: { type: "string" },
        document_id: { type: "string" }, format: { type: "string", enum: ["default", "json"] },
        limit: { type: "integer", minimum: 1 }, project_path: { type: "string" }, timeoutMs: commonTimeout,
      },
      required: ["action"], additionalProperties: false,
    },
  },
  {
    name: "device_info",
    description: "Return official detailed device information: name, serial, kind, device type, and OS version when supplied by the target.",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string" }, format: { type: "string", enum: ["table", "json"] }, project_path: { type: "string" }, timeoutMs: commonTimeout },
      additionalProperties: false,
    },
  },
  {
    name: "ui_inspect",
    description: "Inspect official UI window lists or layout trees with window/display selection, all-window mode, depth filtering, and full/simplified output.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["layout", "windows"] }, hvd: { type: "string" }, id: { type: "string", minLength: 1 },
        window: { type: "string", minLength: 1 }, all_windows: { type: "boolean" }, all: { type: "boolean" }, depth: { type: "integer", minimum: 0 },
        format: { type: "string", enum: ["default", "json"] }, mode: { type: "string", enum: ["full", "simplified"] },
        project_path: { type: "string" }, timeoutMs: commonTimeout,
      },
      required: ["action"], additionalProperties: false,
    },
  },
  {
    name: "ui_control",
    description: "Use the official DevEco UI controller for coordinate gestures or node-id/window-targeted clicks and text input.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["click", "doubleclick", "longclick", "swipe", "fling", "drag", "dircfling", "text"] },
        x: { type: "integer", minimum: 1 }, y: { type: "integer", minimum: 1 }, x2: { type: "integer", minimum: 1 }, y2: { type: "integer", minimum: 1 },
        direction: { type: "string", enum: ["up", "down", "left", "right"] }, text: { type: "string" },
        node_id: { type: "string", minLength: 1 }, window: { type: "string", minLength: 1, pattern: "^[a-zA-Z0-9_-]+$" }, speed: { type: "integer", minimum: 200, maximum: 40000 }, hvd: { type: "string" },
        project_path: { type: "string" }, timeoutMs: commonTimeout,
      },
      required: ["action"], additionalProperties: false,
    },
  },
  {
    name: "emulator_manage",
    description: "Manage official DevEco emulators, system images, and licenses: list/start/stop/create/delete, download/remove images, and view/accept licenses.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "start", "stop", "create", "delete", "image_list", "image_download", "image_remove", "license_view", "license_accept"] },
        names: { type: "array", items: { type: "string" } }, name: { type: "string" }, device_type: { type: "string", enum: deviceTypes },
        os_version: { type: "string" }, force: { type: "boolean" }, all: { type: "boolean" }, format: { type: "string", enum: ["table", "json"] },
        project_path: { type: "string" }, timeoutMs: commonTimeout,
      },
      required: ["action"], additionalProperties: false,
    },
  },
  {
    name: "emulator_scenario",
    description: "Simulate official emulator hardware/environment scenarios: shake, power, rotation, volume, folding, battery, location, sports/navigation, and sensors.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["shake", "power", "rotate", "volume", "fold", "battery", "geolocation", "scene", "sensor"] },
        target: { type: "string" }, direction: { oneOf: [{ type: "string" }, { type: "number" }] }, state: { type: "string" },
        level: { type: "integer", minimum: 0, maximum: 100 }, status: { type: "string", enum: ["charging", "discharging"] },
        longitude: { type: "number", minimum: -180, maximum: 180 }, latitude: { type: "number", minimum: -90, maximum: 90 },
        altitude: { type: "number", minimum: -10000, maximum: 10000 }, scene: { type: "string", enum: ["outdoorRunning", "outdoorCycling", "drivingNavigation"] },
        light_intensity: { type: "number", minimum: 0, maximum: 100000 }, humidity: { type: "number", minimum: 0, maximum: 100 },
        temperature: { type: "number", minimum: -273.1, maximum: 100 }, steps: { type: "integer", minimum: 0, maximum: 10000 }, heartrate: { type: "integer", minimum: 0, maximum: 255 },
        project_path: { type: "string" }, timeoutMs: commonTimeout,
      },
      required: ["action"], additionalProperties: false,
    },
  },
  {
    name: "app_signature",
    description: "Generate or update HarmonyOS project signing configuration using the official CLI account/team/device flow.",
    inputSchema: {
      type: "object",
      properties: { force: { type: "boolean" }, team_id: { type: "string" }, product: { type: "string" }, project_path: { type: "string" }, timeoutMs: commonTimeout },
      additionalProperties: false,
    },
  },
  {
    name: "deveco_cli_auth",
    description: "Manage the official DevEco CLI account session or list available signing teams. This is separate from the CodeGenie knowledge-service login.",
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["login", "logout", "status", "team_list"] }, project_path: { type: "string" }, timeoutMs: commonTimeout },
      required: ["action"], additionalProperties: false,
    },
  },
];


const localTools = [
  ...officialTools,
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
    name: "deveco_restart",
    description:
      "Restart this server's long-lived children in place, without dropping the client connection. "
      + "Use to recover from a stuck or erroring language service after fixing the root cause, instead of "
      + "restarting the whole agent session. `arkts` resets the ArkTS language server (affects lsp and its "
      + "five aliases). `cpp` drops the CodeGenie child, which also backs get_app_ui_tree and "
      + "perform_ui_action, so those reconnect on their next call too. `all` (default) does both. Nothing is "
      + "respawned eagerly: the next call that needs a child starts it. Caution: if the service fails again "
      + "right after a restart, the cause is a persistent project or SDK configuration problem -- do not call "
      + "this repeatedly, run deveco_doctor and fix the project first.",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", enum: ["arkts", "cpp", "all"] } },
      additionalProperties: false,
    },
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
    description: "Start or poll a China-site Huawei DevEco browser login. Start returns immediately so MCP hosts with a 30-second deadline do not abort the five-minute browser callback window; poll with action=status and the returned login_id.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "status"], description: "Defaults to start." },
        login_id: { type: "string", description: "Required for status." },
        wait_ms: { type: "integer", minimum: 0, maximum: 20000, description: "Status may wait this long for completion." },
      },
      allOf: [{
        if: { properties: { action: { const: "status" } }, required: ["action"] },
        then: { required: ["login_id"] },
      }],
      additionalProperties: false,
    },
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
    description: "Build a HarmonyOS project or specific modules through the bundled DevEco CLI. Builds start asynchronously by default so MCP hosts with a fixed 30-second timeout do not abort them: keep the returned job_id and call this tool with action=status until it finishes. "
      + "Use action=cancel to terminate the build, or action=run only when the MCP host is known to allow a long synchronous request. "
      + "Omit modules to build the whole product. Set clean only when a full rebuild is explicitly wanted: "
      + "it cleans and then builds, which discards incremental caches and makes the build much slower.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "status", "cancel", "run"],
          default: "start",
          description: "start (default) returns a job_id immediately; status polls it; cancel stops it; run waits synchronously.",
        },
        job_id: { type: "string", description: "Job ID returned by start; required for status and cancel." },
        wait_ms: { type: "integer", minimum: 0, maximum: 20000, description: "For status, wait up to this long for completion before returning; 20000 reduces polling while staying below common 30-second host limits." },
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
      allOf: [{
        if: { properties: { action: { enum: ["status", "cancel"] } }, required: ["action"] },
        then: { required: ["job_id"] },
      }],
      additionalProperties: false,
    },
  },
  {
    name: "project_sync",
    description: "Install all ohpm dependencies and synchronize the Hvigor project model using DevEco Studio's bundled toolchain.",
    inputSchema: {
      type: "object",
      properties: {
        product: { type: "string", description: "Product name; defaults to default." },
        install_dependencies: { type: "boolean", description: "Run ohpm install --all before Hvigor sync; defaults to true." },
        project_path: { type: "string", description: "Optional project root; otherwise the active project from switch_cwd." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 3600000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "api_compat_check",
    description: "Scan source files or modules for HarmonyOS API compatibility, or list supported API versions, through DevEco CLI 1.3.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["scan", "versions"], description: "Defaults to scan." },
        source_version: { type: "string", description: "Current API version; required for scan." },
        target_version: { type: "string", description: "Target API version; required for scan." },
        files: { type: "array", items: { type: "string" }, description: "Files to scan; cannot be combined with modules." },
        modules: { type: "array", items: { type: "string" }, description: "Modules to scan; cannot be combined with files." },
        format: { type: "string", enum: ["default", "csv", "json"] },
        output_path: { type: "string", description: "Optional report output path." },
        limit: { type: "integer", minimum: 1 },
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
        module: {
          type: "string",
          description: "Module to deploy and launch (e.g. entry, phone). Required when the project has multiple runnable modules; dependencies are included automatically.",
        },
        target: { type: "string", description: "Build target; combined with module as module@target." },
        product: { type: "string", description: "Product name from build-profile.json5; defaults to default." },
        ability: { type: "string", description: "Ability to launch; read from module.json5 when omitted." },
        project_path: { type: "string", description: "Optional project root; otherwise the active project from switch_cwd." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 3600000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "apply_changes",
    description: "Cold-build and deploy changed project files through DevEco CLI 1.3 apply mode. Exactly one Entry module is selected so a multi-Entry project cannot deploy sibling HAPs; pass module when the project has several runnable entries. On apply failure the tool makes a best-effort relaunch of the previously installed app.",
    inputSchema: {
      type: "object",
      properties: {
        files: { type: "array", minItems: 1, items: { type: "string" }, description: "Changed files inside the selected project." },
        hvd: { type: "string", description: "Target device; resolved automatically when exactly one is connected." },
        module: { type: "string", description: "Runnable Entry module. Required when the project has multiple runnable modules." },
        target: { type: "string", description: "Optional build target, combined as module@target." },
        ability: { type: "string", description: "Optional ability used only when relaunching after a failed apply." },
        product: { type: "string", description: "Product name from build-profile.json5." },
        build_mode: { type: "string", description: "Build mode, such as debug or release." },
        project_path: { type: "string", description: "Optional project root; otherwise the active project from switch_cwd." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 3600000 },
      },
      required: ["files"],
      additionalProperties: false,
    },
  },
  {
    name: "hdc_log",
    description: "List connected HarmonyOS devices, collect filtered hilog lines, or clear the device log buffer. Collect pushes the filter down to hilog itself, so narrowing log_prefix or lines cuts what crosses the wire rather than only what is printed.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["collect", "clear", "list_devices"] },
        device_id: { type: "string", description: "Required when more than one device is connected; hdc_log list_devices prints the keys." },
        log_prefix: { type: "string", description: "Collect only lines containing this prefix; defaults to [VCODER_DEBUG]. Matched literally, and matched on the device." },
        lines: { type: "integer", minimum: 1, maximum: 5000 },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 600000, description: "Deadline for the collect. On expiry the lines already read are returned with truncated: true rather than discarded." },
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
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000, description: "Hard deadline; a timed-out language server is terminated and restarted lazily." },
      },
      required: ["file", "line", "column"],
      additionalProperties: false,
    },
  },
  {
    name: "lsp",
    description: "Run any official DevEco LSP operation: definition, declaration, references, hover, document/workspace symbols, implementation, or call hierarchy. Request line/character are 1-based, but the response is the raw LSP payload, so positions inside it are 0-based; the dedicated wrappers normalise theirs to 1-based.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["goToDefinition", "goToDeclaration", "findReferences", "hover", "documentSymbol", "workspaceSymbol", "goToImplementation", "prepareCallHierarchy", "incomingCalls", "outgoingCalls"],
        },
        filePath: { type: "string", description: "Absolute or project-relative source file path." },
        line: { type: "integer", minimum: 1 },
        character: { type: "integer", minimum: 1 },
        query: { type: "string", description: "Workspace-symbol search query; empty string requests all symbols." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
      },
      required: ["operation"],
      allOf: [
        {
          if: { properties: { operation: { not: { const: "workspaceSymbol" } } }, required: ["operation"] },
          then: { required: ["filePath"] },
        },
        {
          if: {
            properties: { operation: { not: { enum: ["workspaceSymbol", "documentSymbol"] } } },
            required: ["operation"],
          },
          then: { required: ["line", "character"] },
        },
      ],
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
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
      },
      required: ["file", "line", "column"],
      additionalProperties: false,
    },
  },
  {
    name: "go_to_declaration",
    description: "Go to the ArkTS/TypeScript declaration at an absolute file position. If the installed ArkTS server does not advertise declarationProvider, this safely falls back to definition instead of returning JSON-RPC -32601.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string" },
        line: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
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
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
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
      properties: { file: { type: "string" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 } },
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
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
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
  {
    name: "ui_snapshot",
    description: "Capture the device screen over hdc and return it inline. Use this when you only need to see the screen; use ui_observe when you also need coordinates, since it gets both in one device round trip. Runs locally, so it still works when the CodeGenie child is unavailable. Captures at the display's own resolution, scaled down only when its long edge exceeds 2576px — the point past which a vision model resizes the image anyway, so a larger capture costs bytes without adding detail. Lower width when a long loop needs cheaper frames: image cost follows pixel area, so halving width quarters it.",
    inputSchema: {
      type: "object",
      properties: {
        hvd: { type: "string", description: "hdc connect key as printed by hdc_log list_devices; optional when exactly one device is connected." },
        localPath: { type: "string", description: "Where to write the image. Defaults to a timestamped file under the system temp directory." },
        overwrite: { type: "boolean", description: "Allow replacing an existing localPath. Defaults to false so a typo cannot destroy an unrelated file." },
        width: { type: "integer", minimum: 64, maximum: 4096, description: "Capture width, aspect ratio preserved. Defaults to the display’s own width, capped so the long edge stays within 2576px. Lower it to cut image cost on a long loop; coordinateScale reports the ratio either way." },
        format: { type: "string", enum: ["jpeg", "png"], description: "jpeg (default) is lossy but small; png is lossless and uncapped, for pixel-exact work. Both come from snapshot_display. Format does not change image cost, which follows pixel area only." },
        displayId: { type: "integer", minimum: 0, description: "Only for multi-display devices. Left unset, the device picks its active display." },
        inline: { type: "boolean", description: "Return the image as a content block (default true). Set false to get only the JSON report and the path." },
        ifChangedFrom: { type: "string", description: "A frameSignature from an earlier ui_snapshot or ui_observe. The capture still happens, but when the screen is byte-identical the reply is unchanged:true with no image. This is how to wait for something to happen cheaply: it costs a capture (~0.4s) where a full ui_observe costs a capture plus a layout dump (~1.4s), and spends no image tokens while nothing is moving." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ui_find",
    description: "Locate on-screen controls in a uitest layout dump and return tap-ready device coordinates, without capturing a frame. Use ui_observe instead when you also want to see the screen. Exact where reading coordinates off a screenshot is not, and unlike get_app_ui_tree it does not require the debugged app to be in the foreground. Pass dumpPath to re-query a dump you already have instead of spending ~1.4s on another one. A truncated default result does not mean later controls are absent: inspect componentTypes and re-query by type, such as type=Slider.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Case-insensitive substring of the node's visible text." },
        key: { type: "string", description: "Exact match on the node's key (what ArkUI .id() sets). Survives copy and locale changes, unlike text." },
        type: { type: "string", description: "Exact component type, e.g. Text, Button, Image." },
        dumpPath: { type: "string", description: "Parse this existing dump instead of dumping again. The path returned by a previous call." },
        hvd: { type: "string", description: "hdc connect key as printed by hdc_log list_devices; optional when exactly one device is connected." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum matches to return (default 20); matchCount reports the true total." },
        onScreenOnly: { type: "boolean", description: "Drop nodes outside the screen box or marked invisible (default true). Their centres are in the dump but tapping them does nothing." },
        clickableOnly: { type: "boolean", description: "Keep only nodes the device reports as clickable. Usable on its own: the node that handles a tap is usually a container with no text of its own, wrapping the label you can see." },
        displayId: { type: "integer", minimum: 0, description: "Restrict matches to one display. Only for multi-display devices; a foldable or an external screen puts nodes from both displays in one dump." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ui_observe",
    description: "Capture the screen AND the layout tree in one device round trip, and return the frame inline beside tap-ready coordinates. This is the tool to reach for in a UI loop: the capture is overlapped with the dump on the device, which measured 1238ms against 1731ms for calling ui_snapshot and ui_find separately. Takes the same selectors as ui_find. If matches are truncated, componentTypes still shows which later controls exist; re-query dumpPath with ui_find and a type such as Slider. Also returns structureSignature, which is stable while the layout is unchanged, so you can tell whether anything actually happened without re-reading the screen.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Case-insensitive substring of the node's visible text (or its accessibility label)." },
        key: { type: "string", description: "Exact match on the node's key (what ArkUI .id() sets). Survives copy and locale changes, unlike text." },
        type: { type: "string", description: "Exact component type, e.g. Text, Button, Image." },
        clickableOnly: { type: "boolean", description: "Keep only nodes the device reports as clickable. Usable on its own." },
        onScreenOnly: { type: "boolean", description: "Drop nodes outside the screen box or marked invisible (default true)." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum matches to return (default 20); matchCount reports the true total." },
        displayId: { type: "integer", minimum: 0, description: "Restrict matches to one display, and capture that display. Only for multi-display devices; a foldable or an external screen puts nodes from both displays in one dump." },
        hvd: { type: "string", description: "hdc connect key as printed by hdc_log list_devices; optional when exactly one device is connected." },
        localPath: { type: "string", description: "Where to write the frame. Defaults to a timestamped file under the system temp directory." },
        overwrite: { type: "boolean", description: "Allow replacing an existing localPath. Defaults to false so a typo cannot destroy an unrelated file." },
        width: { type: "integer", minimum: 64, maximum: 4096, description: "Capture width, aspect ratio preserved. Defaults to the display’s own width, capped so the long edge stays within 2576px." },
        inline: { type: "boolean", description: "Return the frame as a content block (default true)." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ui_tap",
    description: "Send a touch, gesture, or key event through uitest uiInput over hdc. Despite the compatibility name ui_tap, this tool also performs swipe/fling/drag/text/key actions. Prefer aiming click/doubleClick/longClick with key/text/type over passing x/y: coordinates go stale between the find and the tap. A swipe/fling/drag can target a node with from_percent/to_percent; if dumpLayout omits the target (for example a custom Slider), use all four screen-percentage fields instead of hard-coded pixels. Raw-coordinate and screen-percentage success only mean uitest accepted the command, not that the UI changed. Note dircFling direction is the scroll direction, and flinging at a list boundary succeeds without moving anything.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["click", "doubleClick", "longClick", "swipe", "fling", "drag", "dircFling", "inputText", "keyEvent"],
        },
        key: { type: "string", description: "Aim a click/doubleClick/longClick at the node with this exact key instead of at coordinates. Refuses rather than guesses when it matches no node or several." },
        text: { type: "string", description: "For click/doubleClick/longClick or percentage gestures, select a node whose visible text contains this. For inputText, this is the text to type." },
        type: { type: "string", description: "Aim at the node of this exact component type, or narrow a key/text selector." },
        clickableOnly: { type: "boolean", description: "Narrow a selector to nodes the device reports as clickable. The node that handles a tap is often a container wrapping the label you can see." },
        verify: { type: "boolean", description: "Dump again after a selector action. Defaults to true for percentage gestures and false for point taps because it doubles the layout-dump cost." },
        from_percent: { type: "number", minimum: 0, maximum: 100, description: "Start position inside a selector-targeted swipe/fling/drag." },
        to_percent: { type: "number", minimum: 0, maximum: 100, description: "End position inside a selector-targeted swipe/fling/drag." },
        axis: { type: "string", enum: ["horizontal", "vertical"], description: "Percentage direction. Horizontal is left-to-right; vertical is bottom-to-top. Defaults to horizontal." },
        from_x_percent: { type: "number", minimum: 0, maximum: 100, description: "Start x as a percentage of the current device screen when the target is absent from the UI tree. Supply all four screen-percentage fields and omit pixel coordinates/selectors." },
        from_y_percent: { type: "number", minimum: 0, maximum: 100, description: "Start y as a percentage from the top of the current device screen." },
        to_x_percent: { type: "number", minimum: 0, maximum: 100, description: "Destination x as a percentage of the current device screen." },
        to_y_percent: { type: "number", minimum: 0, maximum: 100, description: "Destination y as a percentage from the top of the current device screen." },
        x: { type: "integer", minimum: 0, description: "Device x for click/doubleClick/longClick/swipe/inputText. Omit when using a selector." },
        y: { type: "integer", minimum: 0, description: "Device y for click/doubleClick/longClick/swipe/inputText. Omit when using a selector." },
        x2: { type: "integer", minimum: 0, description: "Destination x for swipe/fling/drag." },
        y2: { type: "integer", minimum: 0, description: "Destination y for swipe/fling/drag." },
        direction: { type: "integer", enum: [0, 1, 2, 3], description: "dircFling scroll direction: 0 left, 1 right, 2 toward the top, 3 toward the bottom." },
        velocity: { type: "integer", minimum: 200, maximum: 40000, description: "Gesture speed in px/s for swipe/fling/drag and dircFling." },
        stepLength: { type: "integer", minimum: 1, description: "dircFling step length in px." },
        key1: { type: "string", description: "Key name or keycode, e.g. Back, Home, Power." },
        key2: { type: "string", description: "Second key of a combination." },
        key3: { type: "string", description: "Third key of a combination." },
        hvd: { type: "string", description: "hdc connect key as printed by hdc_log list_devices; optional when exactly one device is connected." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
      },
      required: ["action"],
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

// A capture the caller then has to go and read separately spends most of what the faster capture
// path just saved, so the frame rides back with its own report. Large frames -- a native PNG from
// the screenCap fallback, above all -- stay on disk rather than becoming a multi-megabyte base64
// blob in the transcript, and the report says which happened.
const MAX_INLINE_IMAGE_BYTES = 1500000;

function imageResult(report) {
  const blocks = [];
  let inlined = false;
  // ui_observe degrades to a dump-only result when the frame does not arrive; the layout is the
  // half that decides where a tap lands, so that is a usable answer with no image to inline.
  const hasFrame = Boolean(report.localPath) && report.bytes > 0;
  // An unchanged frame is one the caller has already seen. Sending it again would spend the image
  // tokens to say "nothing happened", which the boolean says for a fraction of the cost.
  if (hasFrame && !report.unchanged && report.inline !== false && report.bytes <= MAX_INLINE_IMAGE_BYTES) {
    try {
      blocks.push({
        type: "image",
        data: fs.readFileSync(report.localPath).toString("base64"),
        mimeType: report.mimeType,
      });
      inlined = true;
    } catch {
      // The file is on disk and its path is in the report; failing to inline it is not a failed
      // capture, so fall through to the text-only shape rather than turning this into an error.
    }
  }
  const payload = { ...report, inlined };
  delete payload.inline;
  blocks.push({ type: "text", text: JSON.stringify(payload, null, 2) });
  return { isError: false, content: blocks };
}

const server = new Server(
  { name: "deveco-tool", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const advertisedTools = [...localTools, ...PROXIED_CODEGENIE_TOOLS];
const schemaCompiler = new Ajv({ allErrors: true, strict: false });
// The upstream CodeGenie schemas use the OpenAPI integer format. Register it explicitly so Ajv
// validates the range instead of printing one warning per field to the MCP server's stderr.
schemaCompiler.addFormat("int32", {
  type: "number",
  validate: (value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647,
});
const argumentValidators = new Map(
  advertisedTools.map((tool) => [tool.name, schemaCompiler.compile(tool.inputSchema)]),
);

function argumentValidationFailure(name, args) {
  const validator = argumentValidators.get(name);
  if (!validator || validator(args)) return null;
  return {
    code: "SCHEMA_VALIDATION_FAILED",
    message: `Arguments for ${name} do not match its published input schema.`,
    details: (validator.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message,
      params: error.params,
    })),
  };
}

let loginJob = null;

function loginJobResult(job) {
  const result = {
    login_id: job.id,
    status: job.status,
    started_at: new Date(job.startedAt).toISOString(),
    elapsed_ms: (job.finishedAt ?? Date.now()) - job.startedAt,
  };
  if (job.status === "waiting") {
    result.message = "The browser login is waiting for its loopback callback.";
    result.next_action = { tool: "deveco_login", arguments: { action: "status", login_id: job.id, wait_ms: 20000 } };
  } else if (job.status === "succeeded") {
    result.loggedIn = true;
    result.userId = job.user?.userId;
    result.userName = job.user?.userName;
  } else {
    result.error = job.error;
  }
  return result;
}

function startLoginJob() {
  if (loginJob?.status === "waiting") return loginJobResult(loginJob);
  const job = {
    id: crypto.randomUUID(), status: "waiting", startedAt: Date.now(), finishedAt: null,
    user: null, error: null, completion: null,
  };
  loginJob = job;
  job.completion = login().then(
    (user) => {
      job.status = "succeeded";
      job.user = user;
      job.finishedAt = Date.now();
    },
    (error) => {
      job.status = "failed";
      job.error = { code: error.code ?? "DEVECO_LOGIN_FAILED", message: error.message };
      job.finishedAt = Date.now();
    },
  );
  return loginJobResult(job);
}

async function getLoginJob(id, waitMs) {
  if (!loginJob || String(id ?? "") !== loginJob.id) {
    const error = new Error(`Login job not found: ${id ?? ""}`);
    error.code = "DEVECO_LOGIN_JOB_NOT_FOUND";
    throw error;
  }
  const bounded = Math.min(Math.max(Number(waitMs) || 0, 0), 20000);
  if (bounded && loginJob.status === "waiting") {
    await Promise.race([
      loginJob.completion,
      new Promise((resolve) => setTimeout(resolve, bounded)),
    ]);
  }
  return loginJobResult(loginJob);
}

// Answered entirely from static tables: no await, so a stalled CodeGenie child cannot delay
// tool discovery. The child is contacted only when one of the proxied tools is called.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: advertisedTools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};

  try {
    const validationFailure = argumentValidationFailure(name, args);
    if (validationFailure) return textResult(validationFailure, true);

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

    if (name === "deveco_restart") {
      const target = args.target === undefined ? "all" : args.target;
      if (target !== "arkts" && target !== "cpp" && target !== "all") {
        return textResult(
          { code: "BAD_TARGET", message: 'target must be "arkts", "cpp", or "all"' },
          true,
        );
      }
      // Both helpers only tear down and clear state; the next call that needs a child respawns it.
      // Nothing is started here, so a restart cannot itself block on a handshake.
      const restarted = [];
      if (target === "arkts" || target === "all") {
        await resetLsp();
        restarted.push("arkts");
      }
      if (target === "cpp" || target === "all") {
        await closeCodeGenie();
        // An explicit restart is the operator saying the cause is dealt with, so the timeout
        // streak that may have tripped the circuit breaker should not outlive it.
        resetCodeGenieCircuit();
        restarted.push("cpp");
      }
      return textResult({
        tool: name,
        target,
        restarted,
        note: "Children are respawned lazily on the next call that needs them.",
      });
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
      const action = args.action ?? "start";
      if (action === "start") return textResult(startLoginJob());
      const result = await getLoginJob(args.login_id, args.wait_ms);
      return textResult(result, result.status === "failed");
    }

    if (name === "deveco_logout") {
      await logout();
      return textResult({ loggedIn: false });
    }

    if (name === "deveco_status") {
      return textResult(await authStatus());
    }

    if (name === "arkts_check") {
      return textResult(await runArktsCheck(args));
    }

    if (name === "code_lint") return plainResult(await codeLint(args));
    if (name === "hot_reload") return textResult(await hotReload(args));
    if (name === "harmony_docs") return plainResult(await harmonyDocs(args));
    if (name === "device_info") return plainResult(await deviceInfo(args));
    if (name === "ui_inspect") return plainResult(await uiInspect(args));
    if (name === "ui_control") return plainResult(await uiControl(args));
    if (name === "emulator_manage") return plainResult(await emulatorManage(args));
    if (name === "emulator_scenario") return plainResult(await emulatorScenario(args));
    if (name === "app_signature") return plainResult(await signatureGenerate(args));
    if (name === "deveco_cli_auth") return plainResult(await cliAuth(args));

    if (name === "check_ets_files") {
      if (!Array.isArray(args.files)) {
        return textResult({ code: "ARKTS_FILES_INVALID", message: "files must be an array of .ets or .ts paths" }, true);
      }
      return textResult(await runArktsCheck({ files: args.files }));
    }

    if (name === "build_project") {
      const action = args.action ?? "start";
      if (action === "run") {
        const { action: ignoredAction, job_id: ignoredJobId, wait_ms: ignoredWaitMs, ...buildArgs } = args;
        return plainResult(await buildProject(buildArgs));
      }
      if (action === "status") {
        const result = await getBuildProjectJob(args.job_id, args.wait_ms);
        return textResult(result, result.status === "failed");
      }
      if (action === "cancel") {
        return textResult(await cancelBuildProjectJob(args.job_id));
      }
      if (action !== "start") {
        return textResult({ code: "BUILD_ACTION_INVALID", message: `Unknown build action: ${action}` }, true);
      }
      const { action: ignoredAction, job_id: ignoredJobId, wait_ms: ignoredWaitMs, ...buildArgs } = args;
      return textResult(startBuildProjectJob(buildArgs));
    }

    if (name === "project_sync") {
      return plainResult(await projectSync(args));
    }

    if (name === "api_compat_check") {
      return plainResult(await apiCompatibilityCheck(args));
    }

    if (name === "start_app") {
      return plainResult(await startApp(args));
    }

    if (name === "apply_changes") {
      return plainResult(await applyChanges(args));
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

    if (name === "go_to_declaration") {
      return textResult(await goToDeclaration(args));
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

    // These three run over hdc in this process. They are dispatched here, ahead of the proxy
    // fallthrough, so a stalled CodeGenie child cannot reach the capture/find/tap loop at all.
    if (name === "ui_snapshot") {
      return imageResult({ ...await uiSnapshot(args), inline: args.inline });
    }

    if (name === "ui_observe") {
      return imageResult({ ...await uiObserve(args), inline: args.inline });
    }

    if (name === "ui_find") {
      return textResult(await uiFind(args));
    }

    if (name === "ui_tap") {
      return textResult(await uiTap(args));
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

// No eager warm-up. It existed so the first tools/list would find the child ready, and that
// reason disappeared when tools/list moved to a static table. Keeping it spawned a CodeGenie
// child in every session -- including the majority that never touch check_cpp_files,
// perform_ui_action or get_app_ui_tree -- and logged a handshake failure when it stalled, for a
// child nothing was waiting on. The three proxied tools now start it on first call, which is what
// PACK.md has been describing all along.

let shutdownPromise;

function waitForShutdownTimeout(timeoutMs) {
  return new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), timeoutMs);
  });
}

async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const cleanup = Promise.allSettled([shutdownLsp(), closeCodeGenie(), closeHotReload(), closeBuildProjectJobs()]);
    await Promise.race([cleanup, waitForShutdownTimeout(5000)]);
    process.exit(0);
  })();
  return shutdownPromise;
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.stdin.once("end", shutdown);
process.stdin.once("close", shutdown);
