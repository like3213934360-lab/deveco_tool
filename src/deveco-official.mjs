import path from "node:path";
import { getProjectPath } from "./project-context.mjs";
import {
  combineOutput,
  devecoCliFailureMessage,
  projectRoot,
  runDevecoCli,
} from "./deveco-cli.mjs";

function fail(message, code = "DEVECO_ARGS_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function globalCwd(explicit) {
  const candidate = explicit || getProjectPath() || process.env.PROJECT_PATH || process.cwd();
  return path.resolve(candidate);
}

function nonEmpty(value, name) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) fail(`${name} is required`);
  return text;
}

function strings(value, name, required = false) {
  const entries = Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
  if (required && !entries.length) fail(`${name} must be a non-empty array`);
  return entries;
}

function choice(value, allowed, name, fallback) {
  const selected = value === undefined ? fallback : value;
  if (!allowed.includes(selected)) fail(`${name} must be one of: ${allowed.join(", ")}`);
  return selected;
}

function numberInRange(value, name, minimum, maximum, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum || (integer && !Number.isInteger(parsed))) {
    fail(`${name} must be ${integer ? "an integer " : ""}between ${minimum} and ${maximum}`);
  }
  return parsed;
}

async function execute(args, { cwd, timeoutMs, errorCode = "DEVECO_CLI_COMMAND_FAILED" } = {}) {
  const result = await runDevecoCli(args, { cwd, timeoutMs, input: args[0] === "auth" && args[1] === "login" ? "\n" : undefined });
  const output = combineOutput(result);
  const failure = devecoCliFailureMessage(result);
  if (failure) {
    const error = new Error(`> ${result.command}\n\n${output}`);
    error.code = errorCode;
    throw error;
  }
  return `> ${result.command}\n\n${output}`;
}

/** Official engineering Code Linter (`devecocli check lint`). */
export async function codeLint(input = {}) {
  const project = projectRoot(input.project_path);
  const args = ["check", "lint"];
  if (input.path) args.push(String(input.path));
  if (input.fix) args.push("--fix");
  if (input.incremental) args.push("--incremental");
  if (input.config_path) args.push("--config-path", String(input.config_path));
  if (input.product) args.push("--product", String(input.product));
  args.push("--format", choice(input.format, ["default", "json"], "format", "default"));
  if (input.output_path) args.push("--output-path", String(input.output_path));
  if (input.limit !== undefined) args.push("--limit", String(numberInRange(input.limit, "limit", 1, Number.MAX_SAFE_INTEGER, true)));
  return execute(args, { cwd: project, timeoutMs: input.timeoutMs, errorCode: "DEVECO_CODE_LINT_FAILED" });
}

/** Official local documentation catalog/search/read commands. */
export async function harmonyDocs(input = {}) {
  const action = choice(input.action, ["catalog", "search", "read"], "action");
  const args = ["docs", action];
  if (action === "catalog") {
    args.push("--format", choice(input.format, ["default", "json"], "format", "json"));
  } else if (action === "search") {
    args.push(...strings(input.keywords, "keywords", true));
    args.push("--catalog", input.catalog ? String(input.catalog) : "all");
    args.push("--format", choice(input.format, ["default", "json"], "format", "json"));
    if (input.limit !== undefined) args.push("--limit", String(numberInRange(input.limit, "limit", 1, Number.MAX_SAFE_INTEGER, true)));
  } else {
    args.push(nonEmpty(input.document_id, "document_id"));
  }
  return execute(args, { cwd: globalCwd(input.project_path), timeoutMs: input.timeoutMs, errorCode: "DEVECO_DOCS_FAILED" });
}

/** Official detailed device view. */
export async function deviceInfo(input = {}) {
  const args = ["device", "view"];
  if (input.target) args.push("--target", String(input.target));
  args.push("--format", choice(input.format, ["table", "json"], "format", "json"));
  return execute(args, { cwd: globalCwd(input.project_path), timeoutMs: input.timeoutMs, errorCode: "DEVECO_DEVICE_VIEW_FAILED" });
}

/** Official layout/window inspection, including depth and window selection. */
export async function uiInspect(input = {}) {
  const action = choice(input.action, ["layout", "windows"], "action");
  const args = action === "layout" ? ["ui", "layout"] : ["ui", "window", "list"];
  if (input.hvd) args.push("--device", String(input.hvd));
  if (action === "layout") {
    if (input.window !== undefined && input.all_windows) fail("window and all_windows are mutually exclusive");
    if (input.id !== undefined) args.push("--id", nonEmpty(String(input.id), "id"));
    if (input.window !== undefined) args.push("--window", nonEmpty(String(input.window), "window"));
    if (input.all_windows) args.push("--all-windows");
    if (input.depth !== undefined) args.push("--depth", String(numberInRange(input.depth, "depth", 0, Number.MAX_SAFE_INTEGER, true)));
    args.push("--format", choice(input.format, ["default", "json"], "format", "json"));
    args.push("--mode", choice(input.mode, ["full", "simplified"], "mode", "simplified"));
  } else {
    args.push("--format", choice(input.format, ["default", "json"], "format", "json"));
    if (input.all) args.push("--all");
  }
  return execute(args, { cwd: globalCwd(input.project_path), timeoutMs: input.timeoutMs, errorCode: "DEVECO_UI_INSPECT_FAILED" });
}

/** Official CLI browser auth and team listing. */
export async function cliAuth(input = {}) {
  const action = choice(input.action, ["login", "logout", "status", "team_list"], "action");
  const args = action === "team_list" ? ["auth", "team", "list"] : ["auth", action];
  return execute(args, { cwd: globalCwd(input.project_path), timeoutMs: input.timeoutMs, errorCode: "DEVECO_AUTH_FAILED" });
}

/** Official UI interaction commands, including node-id/window targeting. */
export async function uiControl(input = {}) {
  const action = choice(input.action, ["click", "doubleclick", "longclick", "swipe", "fling", "drag", "dircfling", "text"], "action");
  const args = ["ui", action];
  const targetAction = ["click", "doubleclick", "longclick", "text"].includes(action);
  const hasCoordinates = input.x !== undefined || input.y !== undefined;
  const hasNode = input.node_id !== undefined;
  const hasWindow = input.window !== undefined;
  if (!targetAction && (hasNode || hasWindow)) fail("node_id and window are only valid for click or text actions");
  if (hasWindow && !hasNode) fail("window must be used with node_id");
  if (targetAction && hasCoordinates && hasNode) fail("coordinates and node_id are mutually exclusive");
  if (hasNode) nonEmpty(input.node_id, "node_id");
  if (hasWindow && !/^[a-zA-Z0-9_-]+$/.test(nonEmpty(input.window, "window"))) fail("window must contain only letters, digits, - or _");
  if (action !== "text" && ["click", "doubleclick", "longclick"].includes(action) && !hasCoordinates && !hasNode) {
    fail("click actions require x/y coordinates or node_id");
  }
  if (["click", "doubleclick", "longclick"].includes(action)) {
    if (input.x !== undefined || input.y !== undefined) {
      args.push(String(numberInRange(input.x, "x", 1, Number.MAX_SAFE_INTEGER, true)));
      args.push(String(numberInRange(input.y, "y", 1, Number.MAX_SAFE_INTEGER, true)));
    }
  } else if (["swipe", "fling", "drag"].includes(action)) {
    for (const key of ["x", "y", "x2", "y2"]) args.push(String(numberInRange(input[key], key, 1, Number.MAX_SAFE_INTEGER, true)));
  } else if (action === "dircfling") {
    args.push(choice(input.direction, ["up", "down", "left", "right"], "direction"));
  } else {
    args.push(nonEmpty(input.text, "text"));
    if (input.x !== undefined || input.y !== undefined) {
      args.push(String(numberInRange(input.x, "x", 1, Number.MAX_SAFE_INTEGER, true)));
      args.push(String(numberInRange(input.y, "y", 1, Number.MAX_SAFE_INTEGER, true)));
    }
  }
  if (input.hvd) args.push("--device", String(input.hvd));
  if (input.node_id) args.push("--id", String(input.node_id));
  if (input.window) args.push("--window", String(input.window));
  if (input.speed !== undefined && ["swipe", "fling", "drag"].includes(action)) {
    args.push("--speed", String(numberInRange(input.speed, "speed", 200, 40000, true)));
  } else if (input.speed !== undefined) {
    fail("speed is only valid for swipe, fling, or drag");
  }
  return execute(args, { cwd: globalCwd(input.project_path), timeoutMs: input.timeoutMs, errorCode: "DEVECO_UI_CONTROL_FAILED" });
}

/** Generate/update project signing configuration through the official CLI. */
export async function signatureGenerate(input = {}) {
  const project = projectRoot(input.project_path);
  const args = ["signature", "generate"];
  if (input.force) args.push("--force");
  if (input.team_id) args.push("--team-id", String(input.team_id));
  if (input.product) args.push("--product", String(input.product));
  return execute(args, { cwd: project, timeoutMs: input.timeoutMs, errorCode: "DEVECO_SIGNATURE_FAILED" });
}

const DEVICE_TYPES = ["phone", "foldable", "widefold", "triplefold", "tablet", "2in1", "2in1 foldable", "wearable", "tv"];

/** Complete official emulator lifecycle, images, and license commands. */
export async function emulatorManage(input = {}) {
  const action = choice(input.action, [
    "list", "start", "stop", "create", "delete", "image_list", "image_download", "image_remove",
    "license_view", "license_accept",
  ], "action");
  let args;
  if (action === "list") args = ["emulator", "list", "--format", choice(input.format, ["table", "json"], "format", "json")];
  else if (action === "start") args = ["emulator", "start", ...strings(input.names, "names", true)];
  else if (action === "stop") args = ["emulator", "stop", ...strings(input.names, "names", true)];
  else if (action === "create") {
    args = ["emulator", "create", nonEmpty(input.name, "name")];
    args.push("--device-type", choice(input.device_type, DEVICE_TYPES, "device_type"));
    args.push("--os-version", nonEmpty(input.os_version, "os_version"));
    if (input.force) args.push("--force");
  } else if (action === "delete") args = ["emulator", "delete", nonEmpty(input.name, "name")];
  else if (action === "image_list") {
    args = ["emulator", "image", "list"];
    if (input.device_type) args.push("--device-type", choice(input.device_type, DEVICE_TYPES, "device_type"));
    if (input.all) args.push("--all");
    args.push("--format", choice(input.format, ["table", "json"], "format", "json"));
  } else if (action === "image_download") {
    args = ["emulator", "image", "download"];
    args.push("--device-type", choice(input.device_type, DEVICE_TYPES, "device_type"));
    args.push("--os-version", nonEmpty(input.os_version, "os_version"));
    if (input.force) args.push("--force");
  } else if (action === "image_remove") {
    args = ["emulator", "image", "remove"];
    args.push("--device-type", choice(input.device_type, DEVICE_TYPES, "device_type"));
    args.push("--os-version", nonEmpty(input.os_version, "os_version"));
  } else args = ["emulator", "license", action === "license_view" ? "view" : "accept"];
  return execute(args, { cwd: globalCwd(input.project_path), timeoutMs: input.timeoutMs, errorCode: "DEVECO_EMULATOR_FAILED" });
}

const FOLD_STATES = [
  "open", "half-open", "close", "vertical-open", "single", "double", "triple",
  "left-folded-right-half-folded", "left-half-folded-right-expanded", "left-expanded-right-folded",
  "left-half-folded-right-folded", "left-expanded-right-half-folded", "left-half-folded-right-half-folded",
];

/** Official emulator hardware/environment scenario simulation. */
export async function emulatorScenario(input = {}) {
  const action = choice(input.action, ["shake", "power", "rotate", "volume", "fold", "battery", "geolocation", "scene", "sensor"], "action");
  const args = ["emulator", action];
  if (action === "rotate") args.push(choice(input.direction, ["left", "right"], "direction"));
  if (action === "volume") args.push(choice(input.direction, ["up", "down"], "direction"));
  if (action === "fold") args.push(choice(input.state, FOLD_STATES, "state"));
  if (action === "battery") {
    const selected = [input.level !== undefined, input.status !== undefined].filter(Boolean).length;
    if (selected !== 1) fail("battery requires exactly one of level or status");
    if (input.level !== undefined) args.push("--level", String(numberInRange(input.level, "level", 0, 100, true)));
    else args.push("--status", choice(input.status, ["charging", "discharging"], "status"));
  }
  if (action === "geolocation") {
    const choices = [
      ["longitude", "--longitude", -180, 180], ["latitude", "--latitude", -90, 90],
      ["altitude", "--altitude", -10000, 10000], ["direction", "--direction", 0, 359.99],
    ];
    const selected = choices.filter(([key]) => input[key] !== undefined);
    if (selected.length !== 1) fail("geolocation requires exactly one coordinate or direction option per call");
    const [key, flag, min, max] = selected[0];
    args.push(flag, String(numberInRange(input[key], key, min, max)));
  }
  if (action === "scene") args.push(choice(input.scene, ["outdoorRunning", "outdoorCycling", "drivingNavigation"], "scene"));
  if (action === "sensor") {
    const sensors = [
      ["light_intensity", "--light-intensity", 0, 100000, false], ["humidity", "--humidity", 0, 100, false],
      ["temperature", "--temperature", -273.1, 100, false], ["steps", "--steps", 0, 10000, true],
      ["heartrate", "--heartrate", 0, 255, true],
    ];
    const selected = sensors.filter(([key]) => input[key] !== undefined);
    if (selected.length !== 1) fail("sensor requires exactly one sensor option per call");
    const [key, flag, min, max, integer] = selected[0];
    args.push(flag, String(numberInRange(input[key], key, min, max, integer)));
  }
  args.push("--target", nonEmpty(input.target, "target"));
  return execute(args, { cwd: globalCwd(input.project_path), timeoutMs: input.timeoutMs, errorCode: "DEVECO_EMULATOR_SCENARIO_FAILED" });
}
