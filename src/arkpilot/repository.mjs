import fs from "node:fs";
import path from "node:path";
import { flowError, validateFlow, validateFlowId } from "./domain.mjs";

const LOCK_STALE_MS = 30000;
const DEFAULT_CONFIG = { driver: "hdc-shell" };

function rejectSymlink(file) {
  if (!fs.existsSync(file)) return;
  if (fs.lstatSync(file).isSymbolicLink()) {
    throw flowError(`ArkPilot path may not be a symbolic link: ${file}`, "FLOW_PATH_UNSAFE");
  }
}

function ensureSafeRoot(projectPath) {
  const project = path.resolve(projectPath);
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
    throw flowError(`Project directory does not exist: ${project}`, "PROJECT_PATH_NOT_FOUND");
  }
  const arkpilot = path.join(project, ".arkpilot");
  const flows = path.join(arkpilot, "flows");
  const config = path.join(arkpilot, "config.json");
  rejectSymlink(arkpilot);
  rejectSymlink(flows);
  rejectSymlink(config);
  fs.mkdirSync(flows, { recursive: true });
  rejectSymlink(arkpilot);
  rejectSymlink(flows);
  rejectSymlink(config);
  if (!fs.existsSync(config)) {
    try {
      fs.writeFileSync(config, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return { project, flows, config };
}

function readConfig(file) {
  rejectSymlink(file);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw flowError(`ArkPilot config could not be read: ${file} (${error.message})`, "FLOW_CONFIG_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || !["hdc-shell", "hypium"].includes(parsed.driver)) {
    throw flowError(".arkpilot/config.json driver must be hdc-shell or hypium", "FLOW_CONFIG_INVALID");
  }
  return { driver: parsed.driver };
}

function fileFor(flows, id) {
  const safeId = validateFlowId(id);
  const file = path.join(flows, `${safeId}.json`);
  if (path.dirname(file) !== flows) throw flowError("Flow path escapes its repository", "FLOW_PATH_UNSAFE");
  rejectSymlink(file);
  return file;
}

function acquireWriteLock(file) {
  const lock = `${file}.lock`;
  try {
    return { fd: fs.openSync(lock, "wx"), lock };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      if ((Date.now() - fs.statSync(lock).mtimeMs) > LOCK_STALE_MS) {
        fs.rmSync(lock, { force: true });
        return { fd: fs.openSync(lock, "wx"), lock };
      }
    } catch (retryError) {
      if (retryError.code !== "ENOENT") throw retryError;
      return { fd: fs.openSync(lock, "wx"), lock };
    }
    throw flowError(`Flow is being written by another process: ${path.basename(file, ".json")}`, "FLOW_WRITE_BUSY");
  }
}

export class JsonFlowRepository {
  constructor(projectPath) {
    const resolved = ensureSafeRoot(projectPath);
    this.projectPath = resolved.project;
    this.flowsPath = resolved.flows;
    this.configPath = resolved.config;
    this.config = readConfig(resolved.config);
  }

  list() {
    rejectSymlink(this.flowsPath);
    return fs.readdirSync(this.flowsPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const id = entry.name.slice(0, -5);
        try {
          const flow = this.get(id);
          return { id: flow.id, name: flow.name, steps: flow.steps.length, app: flow.app };
        } catch (error) {
          return { id, invalid: true, error: { code: error.code ?? "FLOW_INVALID", message: error.message } };
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id, options = {}) {
    const file = fileFor(this.flowsPath, id);
    if (!fs.existsSync(file)) throw flowError(`Flow not found: ${id}`, "FLOW_NOT_FOUND");
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw flowError(`Flow JSON could not be read: ${file} (${error.message})`, "FLOW_JSON_INVALID");
    }
    return validateFlow(parsed, options);
  }

  save(value, options = {}) {
    const flow = validateFlow(value, options);
    const file = fileFor(this.flowsPath, flow.id);
    const { fd, lock } = acquireWriteLock(file);
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      fs.writeFileSync(temporary, `${JSON.stringify(flow, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, file);
      return { flow, path: file };
    } finally {
      try { fs.closeSync(fd); } catch {}
      fs.rmSync(temporary, { force: true });
      fs.rmSync(lock, { force: true });
    }
  }

  delete(id) {
    const file = fileFor(this.flowsPath, id);
    if (!fs.existsSync(file)) throw flowError(`Flow not found: ${id}`, "FLOW_NOT_FOUND");
    fs.rmSync(file);
    return { id: validateFlowId(id), deleted: true };
  }
}
