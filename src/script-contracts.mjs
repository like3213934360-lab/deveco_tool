import Ajv from "ajv";

const text = { type: "string", minLength: 1, pattern: "^[^\\u0000]+$" };
const optionalText = { type: "string", pattern: "^[^\\u0000]*$" };
// One field vocabulary for per-script discovery and execution validation. Detailed schemas
// are returned on demand by the catalog, keeping tools/list independent of the script count.
const SCRIPT_PARAMETERS = {
  projectPath: { ...text, description: "copy_template: parent directory for the new app." },
  appName: { ...text, pattern: "^[A-Za-z][A-Za-z0-9_]{0,127}$", description: "copy_template: new app directory name." },
  bundleName: { ...optionalText, description: "App bundle ID; optional crash filter or template identifier." },
  apiLevel: { type: "integer", minimum: 17, description: "copy_template: API level; defaults to the installed SDK." },
  deviceId: { ...optionalText, description: "Device scripts: HDC ID; omit for a single connected device." },
  outputDir: { ...text, description: "collect_hilog/fetch_faultlog: local output directory." },
  lines: { type: "integer", minimum: 1, maximum: 10000, description: "Hilog lines, default 4000; jscrash_report minimum 200." },
  faultlogName: { ...text, pattern: "^[A-Za-z0-9._-]+$", description: "fetch_faultlog: filename from probe_faultlogger, without a directory." },
  logFile: { ...text, description: "Crash log path, relative to the active project or absolute." },
  logText: { ...text, description: "Inline crash log; mutually exclusive with logFile." },
  processHint: { ...optionalText, description: "Crash parser: process name filter." },
  includeText: { type: "boolean", description: "Crash parser: also return a readable report." },
  maxAgeMinutes: { type: "number", minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: "probe_faultlogger: age limit, default 30; 0 includes all history." },
  limit: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: "probe_faultlogger: maximum candidates, default 10." },
  source: { ...optionalText, description: "parse_jscrash_log: source label; defaults to file or text." },
  device: { ...optionalText, description: "parse_jscrash_log: device label in the report; does not contact a device." },
};

const exclusiveLogs = { not: { required: ["logFile", "logText"] } };
function contract(fields, required = [], constraints = {}) {
  return { type: "object", properties: Object.fromEntries(fields.map(key => [key, SCRIPT_PARAMETERS[key]])),
    required, additionalProperties: false, ...constraints };
}
const contracts = {
  copy_template: contract(["projectPath", "appName", "bundleName", "apiLevel"], ["projectPath", "appName"], {
    // The template writes this identifier into JSON: validate it before creating any directories.
    properties: {
      projectPath: SCRIPT_PARAMETERS.projectPath, appName: SCRIPT_PARAMETERS.appName, apiLevel: SCRIPT_PARAMETERS.apiLevel,
      bundleName: { type: "string", minLength: 7, maxLength: 128,
        pattern: "^[A-Za-z](?:[A-Za-z0-9_]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9_]*[A-Za-z0-9])?){2,}$" },
    },
  }),
  detect_sdk: contract([]),
  collect_hilog: contract(["deviceId", "outputDir", "lines"], ["outputDir"]),
  fetch_faultlog: contract(["deviceId", "faultlogName", "outputDir"], ["faultlogName", "outputDir"]),
  jscrash_report: contract(["deviceId", "bundleName", "processHint", "logFile", "logText", "lines", "includeText"], [], {
    ...exclusiveLogs,
    properties: Object.fromEntries(["deviceId", "bundleName", "processHint", "logFile", "logText", "lines", "includeText"]
      .map(key => [key, key === "lines" ? { ...SCRIPT_PARAMETERS.lines, minimum: 200 } : SCRIPT_PARAMETERS[key]])),
  }),
  parse_jscrash_log: contract(["logFile", "logText", "bundleName", "processHint", "source", "device", "includeText"], [], {
    oneOf: [{ required: ["logFile"] }, { required: ["logText"] }],
  }),
  probe_faultlogger: contract(["deviceId", "bundleName", "maxAgeMinutes", "limit"]),
};

const examples = {
  copy_template: { projectPath: ".", appName: "SampleApp" },
  detect_sdk: {},
  collect_hilog: { outputDir: "./logs", lines: 4000 },
  fetch_faultlog: { faultlogName: "jscrash-com.example.app-20010000-1788500000000.log", outputDir: "./logs" },
  jscrash_report: { logFile: "./logs/crash.log" },
  parse_jscrash_log: { logText: "Error name: TypeError\nError message: Example crash\nStacktrace:\nat run (pages/Index.ets:12:5)" },
  probe_faultlogger: { bundleName: "com.example.app", maxAgeMinutes: 30 },
};

function scriptFlag(key) {
  return `--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
}

const schemaCompiler = new Ajv({ allErrors: true, strict: false });
const validators = new Map(Object.entries(contracts).map(([id, schema]) =>
  [id, schemaCompiler.compile(schema)]));

function invalid(id, details) {
  const error = new Error(`Invalid arguments for script ${id}.`);
  error.code = "SCRIPT_ARGS_INVALID";
  error.details = details;
  error.hint = `Call deveco_script_catalog with {"script":"${id}"} for the parameter schema and example.`;
  return error;
}

export function describeScriptContract(id) {
  if (!Object.hasOwn(contracts, id)) {
    const error = new Error(`Unknown registered script: ${id}`);
    error.code = "UNKNOWN_SCRIPT";
    throw error;
  }
  return {
    argsSchema: contracts[id],
    argvFlags: Object.fromEntries(Object.keys(contracts[id].properties).map(key => [key, scriptFlag(key)])),
    example: { script: id, args: examples[id] },
    notes: "Use either args or argv. Paths resolve against the active project, or the pack root when none is selected."
      + (id === "jscrash_report" ? " Without a log source this script collects device Hilog." : ""),
  };
}

// argv is an alternate spelling of the same contract, never an unchecked escape hatch.
export function validateScriptInput(id, input = {}) {
  const { argsSchema } = describeScriptContract(id);
  if (input.args !== undefined && input.argv !== undefined) throw invalid(id, ["Use either args or argv, not both."]);
  if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 600000)) {
    throw invalid(id, ["timeoutMs must be an integer between 1000 and 600000."]);
  }
  let values = input.args !== undefined ? input.args
    : Object.fromEntries(Object.entries(input).filter(([key]) => !["script", "argv", "timeoutMs"].includes(key)));
  if (input.argv !== undefined) {
    if (!Array.isArray(input.argv) || input.argv.some(value => typeof value !== "string")) throw invalid(id, ["argv must be an array of strings."]);
    values = {};
    const fields = new Map(Object.keys(argsSchema.properties).map(key => [scriptFlag(key), key]));
    for (let i = 0; i < input.argv.length; i++) {
      const flag = input.argv[i];
      const key = fields.get(flag);
      if (!key) throw invalid(id, [`Unknown flag or positional argument: ${flag}`]);
      if (Object.hasOwn(values, key)) throw invalid(id, [`Repeated flag: ${flag}`]);
      const schema = argsSchema.properties[key];
      if (schema.type === "boolean") { values[key] = true; continue; }
      const value = input.argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        // Official scripts accept omitted values for these optional text flags.
        if (schema.type === "string" && !schema.minLength) { values[key] = ""; continue; }
        throw invalid(id, [`Missing value for ${flag}`]);
      }
      values[key] = ["integer", "number"].includes(schema.type) && value.trim() ? Number(value) : value;
      i++;
    }
  }
  const validate = validators.get(id);
  if (!validate(values)) throw invalid(id, structuredClone(validate.errors));
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.startsWith("--")) throw invalid(id, [`${key} cannot start with --; use a file for such inline text.`]);
  }
  return values;
}
