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
  callCodeGenieTool, closeCodeGenie, probeCodeGenieTools, resetCodeGenieCircuit,
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
import {
  cleanupUiTemporaryFiles, removeUiTemporaryFile, uiFind, uiObserve, uiSnapshot, uiTap,
} from "./device-ui.mjs";
import { closeUiFlows, recordSuccessfulUiAction, uiFlow } from "./arkpilot/flow-service.mjs";
import { closeVisualVerifier, verifyUi } from "./arkpilot/visual-verifier.mjs";
import { hdcLog, hdcStatus } from "./hdc-log.mjs";
import {
  findReferences,
  getHover,
  goToDefinition,
  lspOperation,
  lspStatus,
  resetLsp,
  shutdownLsp,
} from "./lsp.mjs";
import { authStatus, closeAuth, login, logout } from "./modules/auth.mjs";
import { searchKnowledge } from "./modules/knowledge.mjs";
import { getProjectContext, setProjectPath } from "./project-context.mjs";
import { listScripts, runRegisteredScript } from "./script-registry.mjs";

const scriptIds = listScripts().map((script) => script.id);

// CodeGenie also ships these, but this gateway implements them itself; hide the
// proxied copies so each name resolves once. build_project and start_app run
// through the bundled DevEco CLI so that building and launching keep working
// even when the CodeGenie child is unavailable.
const LOCAL_OVERRIDE_TOOLS = ["check_ets_files", "build_project", "start_app", "verify_ui"];

// The upstream stateful verification-log chain is not part of this pack. Its save/read tools use
// upstream run ids that the local, temporary-only verify_ui implementation deliberately does not
// create. Hide those two tools and reject direct calls instead of exposing a broken mixed chain.
const DISABLED_CODEGENIE_TOOLS = ["save_ui_screenshot", "get_ui_verification_log"];

// The tool list used to be filtered at request time, which made these two tables self-enforcing.
// Now that the proxy table is static, nothing would notice if a name ended up in two of them and
// so resolved to two different implementations. Fail at startup instead of shipping the ambiguity.
for (const tool of PROXIED_CODEGENIE_TOOLS) {
  if (LOCAL_OVERRIDE_TOOLS.includes(tool.name) || DISABLED_CODEGENIE_TOOLS.includes(tool.name)) {
    throw new Error(`${tool.name} is proxied to CodeGenie but is also overridden or disabled locally`);
  }
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
    description: "Manage one real persistent DevEco hot-reload watch session: start, apply changed .ets files without restarting the app, inspect status, or stop. start waits at most 20 seconds per MCP call; if it returns starting=true, poll action=status instead of starting a duplicate session.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "apply", "status", "stop"] },
        files: { type: "array", minItems: 1, items: { type: "string" } },
        hvd: { type: "string" }, module: { type: "string" }, product: { type: "string" },
        build_mode: { type: "string" }, ability: { type: "string" }, project_path: { type: "string" },
        wait_ms: { type: "integer", minimum: 0, maximum: 20000, description: "For start only, wait this long for readiness before returning starting=true; defaults to 20000." },
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
    description: "Use the official DevEco inspector only when window/display selection, all-window output, or depth filtering is required. For routine semantic targeting use ui_find, or ui_observe when a screenshot is also needed; those local HDC paths avoid starting the DevEco CLI for every observation.",
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
    description: "Use the official DevEco UI controller only for its node-id/window-targeted operations. Prefer ui_flow action=navigate for multi-step navigation and ui_tap for ordinary semantic clicks, text, keys, and gestures; the local HDC path avoids DevEco CLI startup overhead.",
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
    name: "ui_flow",
    description: "Primary tool for entering a known HarmonyOS page or repeating multi-step UI navigation. action is always required. For a new navigation call action=navigate first: ArkPilot safely prefers an exact manifest-declared Ability/App Link/Want route, otherwise finds and replays a matching saved flow, and if none exists starts exploration recording automatically. Use goal for natural-language intent (not target), and id for a known flow (not flow_id); product is not a ui_flow argument. During exploration use ui_observe then semantic ui_tap; successful actions are learned without another command, then finish with navigate+recording_id+success_selector. Replay uses no screenshots on success, safely heals a changed key only from a unique exact semantic fallback, writes that repair only after the final assertion passes, and returns job_id for long runs. A successfully saved .arkpilot/flows JSON file is a persistent reusable project artifact, not temporary test output: never remove it during cleanup unless the user explicitly requests ui_flow action=delete. Use run only when the exact flow id is already known; use routes to inspect standard module.json5 routes. Never use repeated screenshot guessing for a navigation that this tool can replay.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["navigate", "routes", "driver_status", "record_start", "record_status", "record_stop", "record_cancel", "run", "status", "cancel", "list", "get", "validate", "delete"],
        },
        id: { type: "string", pattern: "^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$", description: "Flow id. Required for record_start, run, get, and delete; validate accepts either id or flow." },
        name: { type: "string", minLength: 1, description: "Human-readable flow name. Required for record_start." },
        goal: { type: "string", minLength: 1, description: "Natural-language navigation goal used to safely match a saved flow. Exact declared route names can also be used." },
        recording_id: { type: "string", description: "Recording id returned by record_start or navigate. Required for record_status, record_stop, record_cancel, and finishing navigate." },
        job_id: { type: "string", description: "Execution job id returned by run or navigate. Required for status and cancel." },
        project_path: { type: "string" },
        hvd: { type: "string", description: "Exact hdc device id; required when several devices are connected." },
        bundle_name: { type: "string" },
        module: { type: "string" },
        ability: { type: "string" },
        route_id: { type: "string", description: "Exact id returned by action=routes. Preferred over natural-language route guessing." },
        route_action: { type: "string", description: "Exact action declared by an Ability skill in module.json5." },
        uri: { type: "string", description: "Concrete URI for an App Link or a manifest route containing pathRegex." },
        want_parameters: {
          type: "object",
          description: "Explicit Want parameters only. ArkPilot never invents app-specific route parameters.",
          additionalProperties: { type: ["string", "integer", "boolean"] },
        },
        start_policy: { type: "string", enum: ["restart", "attach"] },
        backend: { type: "string", enum: ["hdc-shell", "hypium"] },
        wait_ms: { type: "integer", minimum: 0, maximum: 20000 },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
        variables: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
        flow: { type: "object", description: "Inline flow definition for validate; use this or id.", additionalProperties: true },
        success_selector: {
          type: "object",
          properties: {
            key: { type: "string" }, text: { type: "string" }, type: { type: "string" },
            clickableOnly: { type: "boolean" }, textMode: { type: "string", enum: ["exact", "contains"] },
          },
          additionalProperties: false,
        },
        success_state: { type: "string", enum: ["visible", "hidden"] },
        success_timeout_ms: { type: "integer", minimum: 100, maximum: 600000 },
        allow_unverified: { type: "boolean" },
        selector_healing: { type: "boolean", description: "Allow unique exact semantic fallbacks and persist promotions only after final success. Defaults to project config." },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_ui",
    description: "Optional final UI verification and failure-diagnosis tool. Use after navigation, not for aiming ordinary taps. capture/assert returns one temporary screenshot inline; when a semantic selector is provided it overlaps the screenshot and UI-tree dump. Canvas/XComponent screens can be judged by the host AI from visual_prompt. compare checks a short-lived in-memory frame signature against baseline_id. Screenshots are written only under the OS temp directory, deleted after inline delivery, never stored in the HarmonyOS project, and all baseline metadata expires after ten minutes.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["capture", "assert", "compare"] },
        hvd: { type: "string", description: "Exact device id; required when several devices are connected." },
        selector: {
          type: "object",
          properties: {
            key: { type: "string" }, text: { type: "string" }, type: { type: "string" },
            clickableOnly: { type: "boolean" }, textMode: { type: "string", enum: ["exact", "contains"] },
          },
          additionalProperties: false,
        },
        success_state: { type: "string", enum: ["visible", "hidden"] },
        visual_prompt: { type: "string", description: "Appearance requirement for the host AI to judge from the returned image." },
        baseline_id: { type: "string", description: "Snapshot id returned by capture/assert. Required for compare." },
        expect: { type: "string", enum: ["changed", "unchanged"] },
        width: { type: "integer", minimum: 64, maximum: 4096 },
        inline: { type: "boolean" },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "deveco_script_catalog",
    description: "List script summaries. Pass script to get its parameter schema and a valid example before execution.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: { script: { type: "string", enum: scriptIds } }, additionalProperties: false },
  },
  {
    name: "deveco_script",
    description: "Run an allowlisted script. Use args or argv, never both. Get script-specific requirements from deveco_script_catalog; invalid parameters are rejected before execution.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", enum: scriptIds },
        args: { type: "object", description: "Named parameters from deveco_script_catalog(script). Unknown keys and invalid values are rejected per script.",
          additionalProperties: { type: ["string", "number", "boolean"] } },
        argv: { type: "array", items: { type: "string" }, description: "Alternative --flag/value array; validated against the same script contract." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
      },
      required: ["script"],
      additionalProperties: false,
    },
  },
  {
    name: "switch_cwd",
    description: "Select the HarmonyOS project for subsequent tools. Use when changing projects; PROJECT_PATH can select the initial project.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: { project_path: { type: "string", minLength: 1 } },
      required: ["project_path"],
      additionalProperties: false,
    },
  },
  {
    name: "deveco_doctor",
    description: "Inspect local DevEco, HDC, project-context, and extracted Skill availability.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "deveco_restart",
    description:
      "Reset a stuck backend without disconnecting MCP. arkts resets the language service; cpp resets CodeGenie; all resets both. Children restart on next use. If failure recurs, diagnose with deveco_doctor before retrying.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", enum: ["arkts", "cpp", "all"], default: "all" } },
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
    description: "Start or poll a China-site Huawei DevEco browser login. Start returns immediately; poll with action=status and login_id. Waiting status includes login_url for manual opening on the MCP machine if browser_status is manual_required. The callback window lasts five minutes. deveco_logout cancels pending authentication.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "status"], description: "Defaults to start." },
        login_id: { type: "string", description: "Required for status." },
        wait_ms: { type: "integer", minimum: 0, maximum: 20000, description: "Status may wait this long for completion." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "deveco_logout",
    description: "Cancel pending CodeGenie login and token refresh, then clear the local session.",
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
    description: "Find ArkTS references through the official DevEco ace-server. The project is initialized by `devecocli serve lsp`; unsupported server capabilities fail explicitly instead of returning fabricated empty results.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string" },
        line: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
        includeDeclaration: { type: "boolean" },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000, description: "Per-call deadline. Official project initialization may continue in the background and return LSP_INITIALIZING for a later retry." },
      },
      required: ["file", "line", "column"],
      additionalProperties: false,
    },
  },
  {
    name: "lsp",
    description: "Official ArkTS LSP entry point backed only by `devecocli serve lsp --arkts` and the DevEco ace-server. Exposes only the four capabilities advertised by the current official server: definition, references, hover, and implementation. Request positions are 1-based; raw LSP response positions remain 0-based.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["goToDefinition", "findReferences", "hover", "goToImplementation"],
        },
        filePath: { type: "string", description: "Absolute or project-relative .ets file used to select and initialize the official project server." },
        line: { type: "integer", minimum: 1, description: "Required 1-based line number." },
        character: { type: "integer", minimum: 1, description: "Required 1-based character offset." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000, description: "One deadline shared by official server startup and the requested operation." },
      },
      required: ["operation", "filePath", "line", "character"],
      additionalProperties: false,
    },
  },
  {
    name: "go_to_definition",
    description: "Go to an ArkTS definition through the official DevEco ace-server.",
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
    description: "Get ArkTS type information and documentation from the official DevEco ace-server.",
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
        textMode: { type: "string", enum: ["exact", "contains"], description: "Text matching mode. Defaults to contains; recorded fallback selectors use exact." },
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
        textMode: { type: "string", enum: ["exact", "contains"], description: "Text matching mode. Defaults to contains." },
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
    description: "Low-level single UI action. For a new multi-step page navigation, call ui_flow action=navigate before this tool so the action is automatically learned or an existing flow is replayed. During active exploration, every successful semantic action here is recorded automatically. Prefer key/text/type over x/y: semantic targets survive layout movement and record a safe fallback for key changes. Use verify_ui only for final visual acceptance. Despite the compatibility name this also performs swipe/fling/drag/text/key actions.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["click", "doubleClick", "longClick", "swipe", "fling", "drag", "dircFling", "inputText", "keyEvent"],
        },
        key: { type: "string", description: "Aim a click/doubleClick/longClick at the node with this exact key instead of at coordinates. Refuses rather than guesses when it matches no node or several." },
        text: { type: "string", description: "For click/doubleClick/longClick or percentage gestures, select a node whose visible text contains this. For inputText, this is the text to type." },
        textMode: { type: "string", enum: ["exact", "contains"], description: "Selector text matching mode for non-input actions. Defaults to contains." },
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

function imageResult(report, isError = false) {
  const blocks = [];
  let inlined = false;
  let temporaryFileRemoved = false;
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
  if (hasFrame && report.temporary && (inlined || report.unchanged)) {
    try {
      temporaryFileRemoved = removeUiTemporaryFile(report.localPath);
    } catch {
      // The session cleanup below is the second chance; capture delivery still succeeded.
    }
  }
  const payload = { ...report, inlined };
  if (temporaryFileRemoved) {
    payload.localPath = null;
    payload.temporaryFileRemoved = true;
  }
  delete payload.inline;
  blocks.push({ type: "text", text: JSON.stringify(payload, null, 2) });
  return { isError, content: blocks };
}

/**
 * Keep DevEco Code's legacy UI action contract while executing it through the in-process HDC
 * adapter. Starting the CodeGenie child for one input command costs several seconds and also made
 * its default screenshots persistent on both the host and device. The local adapter is the same
 * bounded, device-selecting implementation used by ui_tap/ui_snapshot and removes its device
 * artifact in a finally block.
 */
async function performCompatibleUiAction(args) {
  if (args.actionType === "screenshot") {
    const report = await uiSnapshot({
      hvd: args.hvd,
      displayId: args.displayId,
      localPath: args.localPath,
      timeoutMs: args.timeoutMs,
      // An explicitly named local file is the opt-in persistence boundary. With no localPath the
      // frame lives under the OS temp directory and imageResult deletes it after inline delivery.
      overwrite: Boolean(args.localPath),
    });
    return imageResult({
      ...report,
      compatibilityTool: "perform_ui_action",
      backend: "hdc-shell",
      deviceSavePathIgnored: args.savePath
        ? "ArkPilot does not retain screenshot copies on the device; the transient copy was removed."
        : undefined,
    });
  }

  const mapped = {
    click: { action: "click", x: args.x, y: args.y },
    directionalFling: {
      action: "dircFling",
      direction: args.direction ?? 0,
      velocity: args.velocity ?? 600,
      stepLength: args.stepLength,
    },
    inputText: { action: "inputText", x: args.x, y: args.y, text: args.text },
    keyEvent: { action: "keyEvent", key1: args.key1, key2: args.key2, key3: args.key3 },
  }[args.actionType];
  if (!mapped) {
    const error = new Error("actionType must be click, directionalFling, inputText, keyEvent, or screenshot");
    error.code = "UI_ARGS_INVALID";
    throw error;
  }
  try {
    const result = await uiTap({ ...mapped, hvd: args.hvd, timeoutMs: args.timeoutMs });
    return textResult({ ...result, compatibilityTool: "perform_ui_action", backend: "hdc-shell" });
  } catch (error) {
    // HDC inserts its own double quotes around argv containing whitespace. Four characters remain
    // active inside those quotes, so the local adapter deliberately rejects that narrow input-text
    // case before acquiring the uitest lock or sending anything. Preserve the legacy tool's useful
    // escape hatch by delegating only that pre-action rejection to CodeGenie. Never fall back after
    // an HDC command: a timeout cannot prove an action did not land, and retrying could type twice.
    const needsCodeGenieTextTransport = args.actionType === "inputText"
      && error?.code === "UI_ARGS_INVALID"
      && /use perform_ui_action/i.test(String(error?.hint ?? ""));
    if (needsCodeGenieTextTransport) {
      return callCodeGenieTool("perform_ui_action", args);
    }
    throw error;
  }
}

const server = new Server(
  { name: "deveco-tool", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const advertisedTools = [
  ...localTools,
  ...PROXIED_CODEGENIE_TOOLS.map((tool) => {
    if (tool.name === "get_app_ui_tree") {
      return {
        ...tool,
        description:
          "Legacy CodeGenie full-tree compatibility tool. Prefer ui_find for semantic coordinates or ui_observe for one-round-trip screenshot plus tree; both are faster local HDC paths and do not require the CodeGenie child. Use this proxy only when the caller specifically needs CodeGenie's original full-tree response contract.",
      };
    }
    if (tool.name === "perform_ui_action") {
      return {
      ...tool,
      description:
        "Compatibility UI action entry point. Prefer ui_flow navigate for multi-step navigation and ui_tap for new single actions. Click, fling, keys, screenshots, and shell-safe text use the local HDC fast path; only text that HDC cannot quote safely falls back to CodeGenie before any device action is sent. Default screenshots are temporary.",
      inputSchema: {
        ...tool.inputSchema,
        properties: {
          ...tool.inputSchema.properties,
          localPath: {
            ...tool.inputSchema.properties.localPath,
            description:
              "Optional explicit local destination. Omit it for an OS-temporary image that is deleted after inline delivery.",
          },
          savePath: {
            ...tool.inputSchema.properties.savePath,
            description:
              "Accepted for compatibility but never retained: the local fast path always removes its transient device screenshot.",
          },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
        },
      },
      };
    }
    return tool;
  }),
];
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

function conditionalArgumentErrors(name, args) {
  const errors = [];
  const has = (property) => Object.prototype.hasOwnProperty.call(args, property);
  const requireProperty = (property) => {
    if (!has(property)) {
      errors.push({
        path: "/",
        keyword: "required",
        message: `must have required property '${property}'`,
        params: { missingProperty: property },
      });
    }
  };

  if (name === "ui_flow") {
    if (args.action === "record_start") {
      requireProperty("id");
      requireProperty("name");
    }
    if (["record_status", "record_stop", "record_cancel"].includes(args.action)) {
      requireProperty("recording_id");
    }
    if (["run", "get", "delete"].includes(args.action)) requireProperty("id");
    if (["status", "cancel"].includes(args.action)) requireProperty("job_id");
    if (args.action === "validate" && !has("id") && !has("flow")) {
      errors.push({
        path: "/",
        keyword: "anyOf",
        message: "must have either id or flow",
        params: { requiredAlternatives: ["id", "flow"] },
      });
    }
  } else if (name === "verify_ui") {
    if (args.action === "assert") requireProperty("selector");
    if (args.action === "compare") requireProperty("baseline_id");
  } else if (name === "deveco_login") {
    if (args.action === "status") requireProperty("login_id");
  } else if (name === "build_project") {
    if (["status", "cancel"].includes(args.action)) requireProperty("job_id");
  }
  return errors;
}

function argumentValidationFailure(name, args) {
  const validator = argumentValidators.get(name);
  if (!validator) return null;
  const schemaValid = validator(args);
  const details = schemaValid
    ? conditionalArgumentErrors(name, args)
    : (validator.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message,
      params: error.params,
    }));
  if (details.length === 0) return null;
  return {
    code: "SCHEMA_VALIDATION_FAILED",
    message: `Arguments for ${name} do not match its published input schema.`,
    details,
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
    Object.assign(result, job.progress);
    result.message = job.progress.browser_status === "manual_required"
      ? "Open login_url in a browser on the MCP machine. The callback server is still waiting."
      : "The browser login is waiting for its loopback callback.";
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
    progress: {},
  };
  loginJob = job;
  job.completion = login({ onProgress: (progress) => Object.assign(job.progress, progress) }).then(
    (user) => {
      job.status = "succeeded";
      job.user = user;
      job.finishedAt = Date.now();
    },
    (error) => {
      job.status = error.code === "DEVECO_AUTH_CANCELLED" ? "cancelled" : "failed";
      job.error = { code: error.code ?? "DEVECO_LOGIN_FAILED", message: error.message };
      job.finishedAt = Date.now();
    },
  );
  return loginJobResult(job);
}

async function getLoginJob(id, waitMs) {
  const job = loginJob;
  if (!job || String(id ?? "") !== job.id) {
    const error = new Error(`Login job not found: ${id ?? ""}`);
    error.code = "DEVECO_LOGIN_JOB_NOT_FOUND";
    throw error;
  }
  const bounded = Math.min(Math.max(Number(waitMs) || 0, 0), 20000);
  if (bounded && job.status === "waiting") {
    let timer;
    try {
      await Promise.race([
        job.completion,
        new Promise((resolve) => { timer = setTimeout(resolve, bounded); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  return loginJobResult(job);
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
      const scripts = listScripts(args.script);
      return textResult({ scripts, count: scripts.length });
    }

    if (name === "deveco_script") {
      if (typeof args.script !== "string") {
        return textResult({ code: "SCRIPT_REQUIRED", message: "script is required" }, true);
      }
      const result = await runRegisteredScript(args.script, args);
      return textResult(result, !result.ok);
    }

    if (name === "switch_cwd") {
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
      // Probe this process's current child; a successful earlier handshake can go stale.
      return textResult(await collectDoctorReport({ loadCodeGenieTools: probeCodeGenieTools }));
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
      return textResult(result, ["failed", "cancelled"].includes(result.status));
    }

    if (name === "deveco_logout") {
      const job = loginJob;
      await logout();
      if (job) {
        job.status = "cancelled";
        job.user = null;
        job.finishedAt = Date.now();
        job.error = { code: "DEVECO_AUTH_CANCELLED", message: "Logged out. Start a new login to continue." };
      }
      return textResult({ loggedIn: false });
    }

    if (name === "deveco_status") {
      return textResult(await authStatus());
    }

    if (name === "arkts_check") {
      const result = await runArktsCheck(args);
      return textResult(result, result.success === false || Number(result.exitCode ?? 0) !== 0);
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
      const result = await runArktsCheck({ files: args.files });
      return textResult(result, result.success === false || Number(result.exitCode ?? 0) !== 0);
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

    if (name === "get_hover") {
      return textResult(await getHover(args));
    }

    // These local UI tools run over hdc in this process. They are dispatched ahead of the proxy
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
      const result = await uiTap(args);
      const recording = await recordSuccessfulUiAction(args, result);
      return textResult(recording ? { ...result, recording } : result);
    }

    if (name === "ui_flow") {
      const result = await uiFlow(args);
      const executionStatus = result.execution?.status;
      return textResult(result, result.status === "FAILED" || executionStatus === "FAILED");
    }

    if (name === "verify_ui") {
      const result = await verifyUi(args);
      const failedAssertion = args.action === "assert" && result.verification?.passed === false;
      const failedComparison = args.action === "compare" && result.verification?.passed === false;
      return imageResult({ ...result, inline: args.inline }, failedAssertion || failedComparison);
    }

    if (DISABLED_CODEGENIE_TOOLS.includes(name)) {
      return textResult({
        code: "TOOL_DISABLED",
        message: `${name} is not available: local verify_ui does not persist upstream verification run logs.`,
        hint: "Use verify_ui for a temporary final check, or ui_observe/ui_tap to inspect and drive the UI.",
      }, true);
    }

    if (name === "perform_ui_action") return performCompatibleUiAction(args);

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
      details: error.details,
    }, true);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

// No eager warm-up. It existed so the first tools/list would find the child ready, and that
// reason disappeared when tools/list moved to a static table. Keeping it spawned a CodeGenie
// child in every session -- including the majority that never touch check_cpp_files,
// get_app_ui_tree -- and logged a handshake failure when it stalled, for a
// child nothing was waiting on. The remaining proxied tools now start it on first call, which is what
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
    const cleanup = Promise.allSettled([
      closeAuth(), shutdownLsp(), closeCodeGenie(), closeHotReload(), closeBuildProjectJobs(), closeUiFlows(),
    ]);
    await Promise.race([cleanup, waitForShutdownTimeout(5000)]);
    cleanupUiTemporaryFiles();
    closeVisualVerifier();
    process.exit(0);
  })();
  return shutdownPromise;
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.stdin.once("end", shutdown);
process.stdin.once("close", shutdown);
