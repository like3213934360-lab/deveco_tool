import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, resolveDevecoHome } from "./config.mjs";
import { getProjectPath } from "./project-context.mjs";

// How long a timed-out process group gets to honour SIGTERM before SIGKILL. Long enough for a
// Python worker or a node script to run its cleanup, short enough that nothing lingers.
const SIGKILL_GRACE_MS = 2000;

/**
 * Terminate a spawned child and everything it started.
 *
 * Registered scripts shell out to hvigor, ohpm, hdc and Python workers. Signalling only the direct
 * child left those grandchildren running, so a timed-out build kept a hvigor daemon alive for the
 * rest of the session. Children are spawned detached, which puts them in their own process group,
 * and a negative pid signals that whole group. SIGTERM is only a request -- a process wedged in a
 * syscall or holding its own handler ignores it -- so it escalates rather than reporting a timeout
 * while the tree is still running.
 *
 * @param {import("node:child_process").ChildProcess} child The spawned child.
 * @param {number} [graceMs] How long to wait between SIGTERM and SIGKILL.
 * @returns {() => void} Cancels the pending escalation; call it once the child has exited.
 */
export function terminateProcessTree(child, graceMs = SIGKILL_GRACE_MS) {
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group is gone, or the platform refused the negative pid; the direct child still counts.
      try { child.kill(signal); } catch { /* already exited */ }
    }
  };

  signalGroup("SIGTERM");
  const escalation = setTimeout(() => signalGroup("SIGKILL"), graceMs);
  escalation.unref();
  const cancel = () => clearTimeout(escalation);
  child.once("close", cancel);
  return cancel;
}

const SCRIPT_DEFINITIONS = {
  copy_template: {
    skill: "deveco-create-project",
    file: "scripts/copy-template.mjs",
    description: "Copy the bundled ArkTS project template and resolve its SDK metadata.",
  },
  detect_sdk: {
    skill: "deveco-create-project",
    file: "scripts/detect-sdk.mjs",
    description: "Detect the API level and SDK metadata from the configured DevEco Studio.",
  },
  collect_hilog: {
    skill: "arkts-runtime-fix",
    file: "scripts/collect-hilog.mjs",
    description: "Collect a bounded HILOG snapshot from a connected HarmonyOS device.",
  },
  fetch_faultlog: {
    skill: "arkts-runtime-fix",
    file: "scripts/fetch-faultlog.mjs",
    description: "Fetch a named faultlogger file from a connected HarmonyOS device.",
  },
  jscrash_report: {
    skill: "arkts-runtime-fix",
    file: "scripts/jscrash-report.mjs",
    description: "Collect or analyze a JS crash report and produce structured diagnostics.",
  },
  parse_jscrash_log: {
    skill: "arkts-runtime-fix",
    file: "scripts/parse-jscrash-log.mjs",
    description: "Parse a JS crash log from a file or inline text.",
  },
  probe_faultlogger: {
    skill: "arkts-runtime-fix",
    file: "scripts/probe-faultlogger.mjs",
    description: "Probe recent faultlogger entries on a connected HarmonyOS device.",
  },
  search_practices: {
    skill: "arkui-component-best-practices",
    file: "scripts/search-practices.mjs",
    description: "Search the ArkUI component practice library by component name or keyword. "
      + "Takes a positional query and --limit=N / --json, so pass argv (e.g. [\"Swiper\", \"--limit=5\", \"--json\"]); "
      + "the args object form cannot express a positional query.",
  },
  d2c_pixso_arkts: {
    skill: "d2c-fast",
    file: "scripts/pixso-arkts/call-pixso-arkts.mjs",
    description: "Generate ArkTS page code from a Pixso design DSL. Every option is a flag with no "
      + "positional arguments, so the args object form works: {occurrence, full, out, images, rawOut, "
      + "result, structName, engine}. Prints a manifest JSON on stdout.",
  },
  ui_score: {
    skill: "ui-reconstruction-score",
    runtime: "python",
    description: "Score UI reconstruction fidelity between a reference and a candidate screenshot (or "
      + "two directories). Takes two positional paths, so pass argv (e.g. [\"ref.png\", \"cand.png\", "
      + "\"--out\", \"report\", \"--ignore-top-px\", \"44\"]). Needs Pillow; check deveco_doctor first.",
    file: "scripts/ui_score.py",
  },
  apifault_collect_hilog: {
    skill: "hmos-apifault-analysis",
    runtime: "python",
    file: "references/scripts/hilog_collector.py",
    description: "Collect and filter device hilog for API fault analysis.",
  },
  apifault_analyze_media: {
    skill: "hmos-apifault-analysis",
    runtime: "python",
    file: "references/scripts/media_file_analyzer.py",
    description: "Inspect a media file's container and codec metadata when diagnosing a media API fault.",
  },
  appfreeze_analyze: {
    skill: "hmos-appfreeze-analysis",
    runtime: "python",
    file: "scripts/freeze/main.py",
    description: "Analyze an appfreeze fault log: binder chains, stack sections, and a structured report.",
  },
  appfreeze_sample_stack: {
    skill: "hmos-appfreeze-analysis",
    runtime: "python",
    file: "scripts/sample_stack_analyzer.py",
    description: "Analyze a sampled stack trace collected during an appfreeze.",
  },
  arkts_docs_search: {
    skill: "hmos-arkts-knowledge-retriever",
    runtime: "python",
    file: "scripts/search_docs.py",
    description: "Search the bundled ArkTS documentation index shipped with this skill.",
  },
  arkui_docs_search: {
    skill: "hmos-arkui-knowledge-retriever",
    runtime: "python",
    file: "scripts/run.py",
    description: "Query the bundled ArkUI knowledge base for API usage, parameters, and version support.",
  },
  arkui_docs_rebuild_index: {
    skill: "hmos-arkui-knowledge-retriever",
    runtime: "python",
    file: "scripts/rebuild_index.py",
    description: "Rebuild the ArkUI knowledge base index after its documents change.",
  },
  instrument_test_run: {
    skill: "hmos-instrument-test",
    runtime: "python",
    file: "scripts/run_instrument_test.py",
    description: "Run instrumented (on-device) tests for a HarmonyOS module and report the results.",
  },
  local_test_run: {
    skill: "hmos-local-test",
    runtime: "python",
    file: "scripts/run_local_test.py",
    description: "Run local (host-side) unit tests for a HarmonyOS module and report the results.",
  },
  memleak_analyze: {
    skill: "hmos-memleak-analysis",
    runtime: "python",
    file: "scripts/skill_main.py",
    description: "Analyze an ArkTS heap snapshot for leak suspects and risky retain paths.",
  },
};

/**
 * Locate a Python interpreter for `runtime: "python"` scripts.
 * An explicit PYTHON is authoritative: if it is set but unusable, report that rather than silently
 * falling back to a different interpreter, which is how a script ends up running without Pillow.
 * @returns {string|null} The interpreter command, or null when none is usable.
 */
export function resolvePython() {
  const explicit = process.env.PYTHON;
  const candidates = explicit ? [explicit] : ["python3", "python"];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

/**
 * Report whether Pillow is importable by the resolved interpreter.
 * ui_score.py is the only script with a third-party dependency, and the system python3 on macOS
 * usually does not have it, so this has to be checked rather than assumed.
 * @returns {{available: boolean, python: string|null, version: string|null, pillow: boolean}} Status.
 */
export function pythonStatus() {
  const python = resolvePython();
  if (!python) return { available: false, python: null, version: null, pillow: false };
  const version = spawnSync(python, ["--version"], { encoding: "utf8" });
  const pillow = spawnSync(python, ["-c", "import PIL"], { stdio: "ignore" });
  return {
    available: true,
    python,
    version: (version.stdout || version.stderr || "").trim() || null,
    pillow: !pillow.error && pillow.status === 0,
  };
}

function scriptPath(definition) {
  return path.join(REPO_ROOT, "skills", definition.skill, definition.file);
}

export function listScripts() {
  return Object.entries(SCRIPT_DEFINITIONS).map(([id, definition]) => ({
    id,
    skill: definition.skill,
    file: path.relative(REPO_ROOT, scriptPath(definition)),
    runtime: definition.runtime ?? "node",
    description: definition.description,
  }));
}

function kebabCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/_/g, "-");
}

function objectToArgv(args) {
  const argv = [];
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    const flag = `--${kebabCase(key)}`;
    if (value === true) {
      argv.push(flag);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) argv.push(flag, String(item));
      continue;
    }
    argv.push(flag, String(value));
  }
  return argv;
}

// Skill scripts print a `key: value` block and then free-form narrative: stack
// frames, hilog excerpts, evidence dumps. Treating every `x: y` line as a field
// turned that narrative into fabricated keys ("08-02 14", "at foo (Bar.ets"),
// and a later duplicate could overwrite a real value. Every field the scripts
// actually emit is lowercase snake_case, so that is the accepted key shape.
const SCRIPT_FIELD_KEY = /^[a-z][a-z0-9_]*$/;

// Exported so the key-filtering rules can be unit tested without spawning a script.
export function parseScriptOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const values = {};
    let found = false;
    for (const line of trimmed.split(/\r?\n/)) {
      const equals = line.indexOf("=");
      const colon = line.indexOf(":");
      const separator = equals >= 0 ? equals : colon;
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      if (!SCRIPT_FIELD_KEY.test(key)) continue;
      if (Object.hasOwn(values, key)) continue;
      values[key] = line.slice(separator + 1).trim();
      found = true;
    }
    return found ? values : null;
  }
}

export async function runRegisteredScript(id, input = {}) {
  const definition = SCRIPT_DEFINITIONS[id];
  if (!definition) {
    const error = new Error(`Unknown registered script: ${id}`);
    error.code = "UNKNOWN_SCRIPT";
    throw error;
  }

  const file = scriptPath(definition);
  if (!fs.existsSync(file)) {
    const error = new Error(`Registered script is missing: ${file}`);
    error.code = "SCRIPT_NOT_FOUND";
    throw error;
  }

  const rawArgs = input.args ?? Object.fromEntries(
    Object.entries(input).filter(([key]) => !["script", "argv", "timeoutMs"].includes(key)),
  );
  const argv = Array.isArray(input.argv)
    ? input.argv.map(String)
    : objectToArgv(rawArgs);
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs ?? 120000), 1000), 600000);
  const devecoHome = resolveDevecoHome().path;
  const childEnv = { ...process.env };
  if (devecoHome) childEnv.DEVECO_HOME = devecoHome;

  const runtime = definition.runtime ?? "node";
  let command = process.execPath;
  if (runtime === "python") {
    const python = resolvePython();
    if (!python) {
      const error = new Error(`${id} needs a Python interpreter and none was usable.`);
      error.code = "PYTHON_NOT_FOUND";
      error.hint = process.env.PYTHON
        ? `PYTHON is set to "${process.env.PYTHON}" but it did not run. Point it at a working interpreter or unset it.`
        : "安装 Python 3,或把 PYTHON 环境变量指向可用的解释器。ui_score 还额外需要 Pillow。";
      throw error;
    }
    command = python;
  }

  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, [file, ...argv], {
      cwd: getProjectPath() ?? REPO_ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group. Several registered scripts shell out to hvigor, ohpm or hdc, and
      // signalling only the direct child left those grandchildren running: hvigor daemons and
      // Python workers survived every timeout and accumulated across a session.
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      terminateProcessTree(child);
      if (!settled) {
        settled = true;
        const error = new Error(`Script timed out after ${timeoutMs}ms: ${id}`);
        error.code = "SCRIPT_TIMEOUT";
        reject(error);
      }
    }, timeoutMs);

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
      resolve({ exitCode, signal, stdout, stderr });
    });
  });

  // A zero exit with nothing on stdout means the script produced no result at
  // all; say so rather than letting an empty `parsed` read as a clean run.
  const silentSuccess = result.exitCode === 0 && !result.stdout.trim();

  return {
    script: id,
    skill: definition.skill,
    file: path.relative(REPO_ROOT, file),
    runtime,
    argv,
    cwd: getProjectPath() ?? REPO_ROOT,
    exitCode: result.exitCode,
    signal: result.signal,
    ok: result.exitCode === 0,
    parsed: parseScriptOutput(result.stdout),
    ...(silentSuccess ? { warning: "Script exited 0 without writing to stdout; it produced no result." } : {}),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
