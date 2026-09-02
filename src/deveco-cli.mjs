import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { REPO_ROOT, resolveDevecoHome } from "./config.mjs";
import { getProjectPath } from "./project-context.mjs";
import { hdcLog } from "./hdc-log.mjs";
import { terminateProcessTree } from "./process-tree.mjs";

const require = createRequire(import.meta.url);

const DEFAULT_TIMEOUT_MS = 900000;
const MAX_TIMEOUT_MS = 3600000;
const LOG_TAIL_LINES = 50;

/**
 * Locate the bundled DevEco CLI entry point.
 *
 * Upstream probes a vendor root and installs a PATH shim because it ships the
 * CLI with a packaged binary. This pack just depends on the npm package, so
 * ordinary module resolution is enough.
 *
 * @returns {string} Absolute path to the CLI entry.
 */
export function resolveDevecoCli() {
  const override = process.env.DEVECO_CLI_ENTRY;
  if (override) {
    if (!fs.existsSync(override)) {
      const error = new Error(`DEVECO_CLI_ENTRY does not exist: ${override}`);
      error.code = "DEVECO_CLI_NOT_FOUND";
      throw error;
    }
    return path.resolve(override);
  }
  try {
    return require.resolve("@deveco/deveco-cli/dist/cli.js", { paths: [REPO_ROOT] });
  } catch {
    const error = new Error("@deveco/deveco-cli is not installed; run npm install inside the pack root.");
    error.code = "DEVECO_CLI_NOT_FOUND";
    throw error;
  }
}

export function devecoCliStatus() {
  try {
    const entry = resolveDevecoCli();
    return { installed: true, entry };
  } catch (error) {
    return { installed: false, entry: null, reason: error.message };
  }
}

function projectRoot(explicit) {
  const candidate = explicit || getProjectPath() || process.env.PROJECT_PATH;
  if (!candidate) {
    const error = new Error("No HarmonyOS project is selected. Call switch_cwd first or pass project_path.");
    error.code = "PROJECT_REQUIRED";
    throw error;
  }
  const absolute = path.resolve(candidate);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    const error = new Error(`Project directory does not exist: ${absolute}`);
    error.code = "PROJECT_PATH_NOT_FOUND";
    throw error;
  }
  return absolute;
}

function childEnvironment() {
  const env = { ...process.env };
  const home = resolveDevecoHome().path;
  if (home) {
    env.DEVECO_HOME = home;
    // hvigor refuses to configure without this; DevEco Studio injects it, a
    // plain shell does not.
    if (!env.DEVECO_SDK_HOME) env.DEVECO_SDK_HOME = path.join(home, "sdk");
  }
  return env;
}

function toolchainPaths() {
  const home = resolveDevecoHome().path;
  if (!home) {
    const error = new Error("DevEco Studio is not configured. Set DEVECO_HOME or DEVECO_PATH.");
    error.code = "DEVECO_HOME_REQUIRED";
    throw error;
  }
  const windows = process.platform === "win32";
  const paths = {
    node: path.join(home, "tools", "node", windows ? "node.exe" : "bin/node"),
    ohpm: path.join(home, "tools", "ohpm", "bin", "pm-cli.js"),
    hvigor: path.join(home, "tools", "hvigor", "bin", "hvigorw.js"),
  };
  for (const [name, entry] of Object.entries(paths)) {
    if (!fs.existsSync(entry)) {
      const error = new Error(`DevEco ${name} entry does not exist: ${entry}`);
      error.code = "DEVECO_TOOLCHAIN_NOT_FOUND";
      throw error;
    }
  }
  return paths;
}

function commandText(entry, args) {
  const rendered = args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
  return `devecocli ${rendered}`;
}

/**
 * Run the DevEco CLI and capture its output.
 *
 * @param {string[]} args CLI arguments.
 * @param {{cwd: string, timeoutMs?: number}} options Working directory and timeout.
 * @returns {Promise<{command: string, exitCode: number|null, signal: string|null, stdout: string, stderr: string}>} Result.
 */
export function runDevecoCli(args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const entry = resolveDevecoCli();
  const bounded = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd,
      env: childEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group, so a timeout can reach the hvigor client front-end and the ohpm
      // downloads the CLI starts rather than only the CLI itself. The hvigor daemon re-parents
      // itself to pid 1 and is already outside this group, which is what we want: it is a shared,
      // persistent build server, not a leaked grandchild.
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      terminateProcessTree(child);
      if (!settled) {
        settled = true;
        const error = new Error(`DevEco CLI timed out after ${bounded}ms: ${commandText(entry, args)}`);
        error.code = "DEVECO_CLI_TIMEOUT";
        reject(error);
      }
    }, bounded);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ command: commandText(entry, args), exitCode, signal, stdout, stderr });
    });
  });
}

function runToolchainScript(script, args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { node } = toolchainPaths();
  const bounded = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    const child = spawn(node, [script, ...args], {
      cwd,
      env: childEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      terminateProcessTree(child);
      if (!settled) {
        settled = true;
        const error = new Error(`DevEco toolchain timed out after ${bounded}ms: ${path.basename(script)} ${args.join(" ")}`);
        error.code = "DEVECO_TOOLCHAIN_TIMEOUT";
        reject(error);
      }
    }, bounded);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        command: `${path.basename(node)} ${path.basename(script)} ${args.join(" ")}`,
        exitCode,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Assemble `devecocli build` arguments.
 *
 * @param {{product?: string, modules?: string[], build_mode?: string}} input Build selectors.
 * @returns {string[]} CLI arguments.
 */
export function buildArgs({ product, modules = [], build_mode: buildMode } = {}) {
  const args = ["build"];
  const trimmedProduct = typeof product === "string" ? product.trim() : "";
  const trimmedMode = typeof buildMode === "string" ? buildMode.trim() : "";
  const selected = modules.map((item) => String(item).trim()).filter(Boolean);
  if (trimmedProduct) args.push("--product", trimmedProduct);
  if (selected.length) args.push("--modules", ...selected);
  if (trimmedMode) args.push("--build-mode", trimmedMode);
  return args;
}

function combineOutput(result) {
  if (result.stdout && result.stderr) return `${result.stdout}${result.stderr}`;
  return result.stdout || result.stderr;
}

// The CLI prints `error: ...` and still exits 0 in some paths (a failed ability
// launch, for one), so exit codes alone would report those as success. Same
// defensive stance the pack already takes for HDC's `[Fail]` output.
const CLI_FAILURE_PATTERNS = [
  /^\s*error:/im,
  /failed to (install|start|launch|build)/i,
  /BUILD FAILED/i,
];

export function devecoCliFailureMessage(result) {
  const combined = combineOutput(result).trim();
  if (result.exitCode !== 0) {
    return combined || `DevEco CLI exited with code ${result.exitCode ?? "unknown"}`;
  }
  const hit = CLI_FAILURE_PATTERNS.find((pattern) => pattern.test(combined));
  return hit ? combined : "";
}

/**
 * Ask the CLI which modules it can actually deploy.
 *
 * `build-profile.json5` lists HARs too, and passing those to `--module` is an
 * error, so the runnable set comes from the CLI itself rather than from a guess
 * about module types. This probe is only needed when the caller omitted the
 * module and the wrapper has to decide whether there is a unique choice.
 *
 * @param {string} project Absolute project root.
 * @param {string} device Device name or serial.
 * @param {number|undefined} timeoutMs Optional timeout.
 * @returns {Promise<string[]>} Runnable module names.
 */
async function runnableModules(project, device, product, timeoutMs) {
  const args = ["run", "--skip-build", "--device", device];
  if (product) args.push("--product", product);
  const probe = await runDevecoCli(args, {
    cwd: project,
    timeoutMs,
  });
  const text = combineOutput(probe);
  const marker = text.indexOf("Available runnable modules:");
  if (marker < 0) return [];
  return text
    .slice(marker)
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

async function resolveDevice(explicit) {
  const requested = typeof explicit === "string" ? explicit.trim() : "";
  if (requested) return requested;
  const { devices } = await hdcLog({ action: "list_devices" });
  if (devices.length === 0) {
    const error = new Error("No connected HarmonyOS devices detected.");
    error.code = "HDC_NO_DEVICE";
    throw error;
  }
  if (devices.length > 1) {
    const error = new Error(`Multiple HarmonyOS devices are connected (${devices.join(", ")}); pass hvd.`);
    error.code = "HDC_DEVICE_REQUIRED";
    throw error;
  }
  return devices[0];
}

function presentLog(fullText, logPath) {
  const lines = fullText.split(/\r?\n/);
  if (lines.length <= LOG_TAIL_LINES || !logPath) {
    return fullText;
  }
  const tail = lines.slice(-LOG_TAIL_LINES).join("\n");
  return `--- The log is too long, only the last ${LOG_TAIL_LINES} lines are kept ---\n\n${tail}`;
}

/**
 * Build a HarmonyOS project through the bundled DevEco CLI.
 *
 * Parameter compatibility with the previously proxied CodeGenie tool is
 * deliberate: `module` (single string) and `log_path` have no upstream
 * equivalent, and `clean` here means clean *and then build* rather than
 * upstream's clean-only.
 *
 * @param {object} input Tool arguments.
 * @returns {Promise<string>} Human-readable build report.
 */
export async function buildProject(input = {}) {
  const project = projectRoot(input.project_path);
  const modules = [];
  if (typeof input.module === "string" && input.module.trim()) modules.push(input.module.trim());
  if (Array.isArray(input.modules)) {
    for (const item of input.modules) {
      const value = String(item ?? "").trim();
      if (value && !modules.includes(value)) modules.push(value);
    }
  }

  const sections = [];
  const transcript = [];

  if (input.clean) {
    const cleaned = await runDevecoCli(["build", "clean"], { cwd: project, timeoutMs: input.timeoutMs });
    transcript.push(`> ${cleaned.command}\n\n${combineOutput(cleaned)}`);
    const cleanFailure = devecoCliFailureMessage(cleaned);
    if (cleanFailure) {
      const error = new Error(`Clean failed: ${cleanFailure.slice(-500)}`);
      error.code = "DEVECO_CLI_CLEAN_FAILED";
      throw error;
    }
    sections.push("Clean completed.");
  }

  const args = buildArgs({ product: input.product, modules, build_mode: input.build_mode });
  const result = await runDevecoCli(args, { cwd: project, timeoutMs: input.timeoutMs });
  transcript.push(`> ${result.command}\n\n${combineOutput(result)}`);

  const fullText = transcript.join("\n\n");
  let logNotice = "";
  if (input.log_path) {
    const target = path.resolve(project, input.log_path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fullText, "utf8");
    logNotice = `\n\n[Log Saved] The full build log has been saved to: ${target}\nYou can read this file to view the complete log.`;
  }

  if (input.enable_inspector_source_jump) {
    sections.push(
      "[Notice] enable_inspector_source_jump has no DevEco CLI equivalent and was not applied. "
      + "Build the module through DevEco Studio if you need inspector source jumping.",
    );
  }

  const header = sections.length ? `${sections.join("\n")}\n\n` : "";
  const body = presentLog(fullText, input.log_path);
  const buildFailure = devecoCliFailureMessage(result);
  const status = buildFailure
    ? `\n\nBuild failed (exit code ${result.exitCode}).`
    : "\n\nBuild completed successfully.";

  if (buildFailure) {
    const error = new Error(`${header}=== Build Output ===\n${body}${status}${logNotice}`);
    error.code = "DEVECO_CLI_BUILD_FAILED";
    throw error;
  }
  return `${header}=== Build Output ===\n${body}${status}${logNotice}`;
}

/** Synchronise ohpm dependencies and the Hvigor project model. */
export async function projectSync(input = {}) {
  const project = projectRoot(input.project_path);
  const product = typeof input.product === "string" && input.product.trim()
    ? input.product.trim()
    : "default";
  if (!/^[A-Za-z0-9_-]+$/.test(product)) {
    const error = new Error("product may contain only letters, numbers, underscores, and hyphens");
    error.code = "DEVECO_PRODUCT_INVALID";
    throw error;
  }

  const toolchain = toolchainPaths();
  const transcript = [];
  if (input.install_dependencies !== false) {
    const install = await runToolchainScript(toolchain.ohpm, ["install", "--all"], {
      cwd: project,
      timeoutMs: input.timeoutMs,
    });
    transcript.push(`> ${install.command}\n\n${combineOutput(install)}`);
    if (install.exitCode !== 0) {
      const error = new Error(`Dependency installation failed:\n${transcript.join("\n\n")}`);
      error.code = "DEVECO_PROJECT_SYNC_FAILED";
      throw error;
    }
  }

  const sync = await runToolchainScript(toolchain.hvigor, [
    "--sync",
    "-p", `product=${product}`,
    "--analyze=normal",
    "--parallel",
    "--incremental",
    "--no-daemon",
  ], { cwd: project, timeoutMs: input.timeoutMs });
  transcript.push(`> ${sync.command}\n\n${combineOutput(sync)}`);
  if (sync.exitCode !== 0) {
    const error = new Error(`Project sync failed:\n${transcript.join("\n\n")}`);
    error.code = "DEVECO_PROJECT_SYNC_FAILED";
    throw error;
  }
  return `Project synchronized for product ${product}.\n\n${transcript.join("\n\n")}`;
}

/** Run the DevEco CLI 1.3 compatibility scanner. */
export async function apiCompatibilityCheck(input = {}) {
  const project = projectRoot(input.project_path);
  const action = input.action ?? "scan";
  const format = input.format ?? (action === "versions" ? "default" : "json");
  const args = ["check", "compat"];

  if (action === "versions") {
    args.push("versions", "--format", format);
  } else if (action === "scan") {
    const source = String(input.source_version ?? "").trim();
    const target = String(input.target_version ?? "").trim();
    if (!source || !target) {
      const error = new Error("source_version and target_version are required for action=scan");
      error.code = "DEVECO_COMPAT_VERSION_REQUIRED";
      throw error;
    }
    const files = Array.isArray(input.files) ? input.files.map(String).filter(Boolean) : [];
    const modules = Array.isArray(input.modules) ? input.modules.map(String).filter(Boolean) : [];
    if (files.length && modules.length) {
      const error = new Error("files and modules cannot be used together");
      error.code = "DEVECO_COMPAT_SCOPE_INVALID";
      throw error;
    }
    if (files.length) args.push(...files);
    args.push("--source-version", source, "--target-version", target);
    if (modules.length) args.push("--modules", ...modules);
    args.push("--format", format);
    if (input.output_path) args.push("--output-path", String(input.output_path));
    if (input.limit !== undefined) args.push("--limit", String(input.limit));
  } else {
    const error = new Error("action must be scan or versions");
    error.code = "DEVECO_COMPAT_ACTION_INVALID";
    throw error;
  }

  const result = await runDevecoCli(args, { cwd: project, timeoutMs: input.timeoutMs });
  const output = combineOutput(result);
  const failure = devecoCliFailureMessage(result);
  if (failure) {
    const error = new Error(`> ${result.command}\n\n${output}`);
    error.code = "DEVECO_API_COMPAT_FAILED";
    throw error;
  }
  return `> ${result.command}\n\n${output}`;
}

/** Build and deploy only the changed project files via DevEco CLI's cold apply mode. */
export async function applyChanges(input = {}) {
  const project = projectRoot(input.project_path);
  if (!Array.isArray(input.files) || input.files.length === 0) {
    const error = new Error("files must be a non-empty array of project files");
    error.code = "DEVECO_APPLY_FILES_REQUIRED";
    throw error;
  }
  const files = [];
  for (const file of input.files) {
    const absolute = path.resolve(project, String(file));
    const relative = path.relative(project, absolute);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      const error = new Error(`Changed file must be inside the selected project: ${file}`);
      error.code = "DEVECO_APPLY_FILE_OUTSIDE_PROJECT";
      throw error;
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      const error = new Error(`Changed file does not exist: ${absolute}`);
      error.code = "DEVECO_APPLY_FILE_NOT_FOUND";
      throw error;
    }
    const portable = relative.split(path.sep).join("/");
    if (!files.includes(portable)) files.push(portable);
  }

  const device = await resolveDevice(input.hvd);
  const hvigor = path.join(project, ".hvigor");
  fs.mkdirSync(hvigor, { recursive: true });
  const manifestName = `deveco-tool-apply-${process.pid}-${crypto.randomBytes(6).toString("hex")}.txt`;
  const manifest = path.join(hvigor, manifestName);
  fs.writeFileSync(manifest, `${files.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });

  try {
    const args = ["run", "--device", device];
    if (input.product) args.push("--product", String(input.product));
    if (input.build_mode) args.push("--build-mode", String(input.build_mode));
    args.push("--apply", manifestName);
    const result = await runDevecoCli(args, { cwd: project, timeoutMs: input.timeoutMs });
    const output = combineOutput(result);
    const failure = devecoCliFailureMessage(result);
    if (failure) {
      const error = new Error(`> ${result.command}\n\n${output}`);
      error.code = "DEVECO_CLI_APPLY_FAILED";
      throw error;
    }
    return `Device: ${device}\nApplied ${files.length} changed file(s):\n${files.map((file) => `- ${file}`).join("\n")}\n\n> ${result.command}\n\n${output}`;
  } finally {
    fs.rmSync(manifest, { force: true });
  }
}

/**
 * Deploy and launch the already-built app on a connected device.
 *
 * @param {object} input Tool arguments.
 * @returns {Promise<string>} Human-readable launch report.
 */
export async function startApp(input = {}) {
  const project = projectRoot(input.project_path);
  const device = await resolveDevice(input.hvd);

  const module = typeof input.module === "string" ? input.module.trim() : "";
  const target = typeof input.target === "string" ? input.target.trim() : "";
  const ability = typeof input.ability === "string" ? input.ability.trim() : "";
  const product = typeof input.product === "string" ? input.product.trim() : "";

  let selectedModule = module;
  if (!selectedModule) {
    const discovered = await runnableModules(project, device, product, input.timeoutMs);
    if (discovered.length > 1) {
      const error = new Error(
        `Multiple runnable modules found (${discovered.join(", ")}); pass module explicitly.`,
      );
      error.code = "DEVECO_CLI_MODULE_REQUIRED";
      throw error;
    }
    [selectedModule = ""] = discovered;
  }

  if (!selectedModule) {
    const error = new Error(
      `No runnable modules found for ${project}. Build the project first, or pass module explicitly.`,
    );
    error.code = "DEVECO_CLI_NO_MODULES";
    throw error;
  }

  // DevEco CLI resolves and installs non-HAR dependencies of the selected
  // module itself. Passing sibling Entry modules here creates an invalid
  // multi-Entry install request on a physical device.
  const selected = target ? `${selectedModule}@${target}` : selectedModule;
  const args = ["run", "--skip-build", "--device", device, "--module", selected];
  if (product) args.push("--product", product);
  if (ability) args.push("--ability", ability);

  const result = await runDevecoCli(args, { cwd: project, timeoutMs: input.timeoutMs });
  const output = combineOutput(result);
  const failure = devecoCliFailureMessage(result);
  if (failure) {
    const error = new Error(`> ${result.command}\n\n${output}`);
    error.code = "DEVECO_CLI_RUN_FAILED";
    throw error;
  }
  return `Device: ${device}\nDeployed modules: ${selected}\n> ${result.command}\n\n${output}`;
}
