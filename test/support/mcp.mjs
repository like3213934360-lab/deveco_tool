// Stdio MCP transport shared by tests and benchmarks; protocol errors never become tool success.
import { spawn } from "node:child_process";
import path from "node:path";
import { retainWorkspace } from "./workspace.mjs";

const root = path.resolve(import.meta.dirname, "../..");

/** @param {NodeJS.ProcessEnv} env @param {string} entry */
export function connect(env = {}, entry = path.join(root, "bin/deveco-mcp.mjs")) {
  const started = performance.now();
  const child = spawn(process.execPath, [entry, "mcp"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const releaseWorkspace = retainWorkspace(env.DEVECO_STATE_DIR ?? process.env.DEVECO_STATE_DIR, child.pid);
  /** @type {Map<number, {resolve: (value: any) => void, reject: (error: Error) => void, timer: NodeJS.Timeout}>} */
  const pending = new Map();
  let buffer = "", stderr = "", id = 0, ended = false, closing = false;
  /** @type {Error | undefined} */
  let failure;
  /** @param {Error} error */
  const fail = (error) => {
    failure ??= error;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
    pending.clear();
  };
  const exited = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      releaseWorkspace();
      ended = true;
      fail(new Error(`MCP closed (${signal ?? code}); stderr: ${stderr}`));
      resolve({ code, signal });
    });
  });
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line), p = pending.get(message.id);
        if (p) { clearTimeout(p.timer); pending.delete(message.id); p.resolve(message); }
      } catch (error) { fail(new Error(`Invalid MCP JSON: ${line.slice(0, 300)}`, { cause: error })); child.kill(); }
    }
  });
  /** @param {string} method @param {object} params @returns {Promise<any>} */
  const request = (method, params = {}, timeout = 120000) => new Promise((resolve, reject) => {
    if (failure || closing) { reject(failure ?? new Error("MCP is closing")); return; }
    const current = ++id;
    const timer = setTimeout(() => {
      pending.delete(current);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: current, reason: "Test request timed out" } }) + "\n");
      reject(new Error(`${method} timed out after ${timeout} ms; stderr: ${stderr}`));
    }, timeout);
    pending.set(current, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: current, method, params }) + "\n");
  });
  return {
    child, started,
    get stderr() { return stderr; },
    request,
    async initialize() {
      const response = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "deveco-test", version: "1" } });
      if (response.error || !response.result) throw new Error(`MCP initialize failed: ${JSON.stringify(response)}`);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      return response;
    },
    /** @param {string} name @param {object} args */
    async call(name, args = {}, timeout = 120000) {
      const response = await request("tools/call", { name, arguments: args }, timeout);
      if (response.error || !Array.isArray(response.result?.content)) throw new Error(`MCP call failed: ${JSON.stringify(response)}`);
      const text = response.result.content.find((/** @type {{type: string, text?: string}} */ c) => c.type === "text")?.text;
      return { isError: !!response.result.isError, data: text === undefined ? undefined : JSON.parse(text), content: response.result.content };
    },
    async close() {
      if (ended) return;
      closing = true; child.stdin.end();
      let timer;
      try {
        await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("MCP shutdown timed out")); }, 10000); })]);
      } finally { clearTimeout(timer); }
    },
  };
}

/** Wait for a terminal job state without retrying a failed operation or hiding a stuck job. */
/** @param {(tool: string, args: object) => Promise<any>} call @param {any} result */
export async function waitJob(call, result, timeout = 600000) {
  const deadline = performance.now() + timeout;
  while (["queued", "running"].includes(result.status)) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error(`Job ${result.job_id} timed out after ${timeout} ms`);
    result = await call("job", { action: "wait", job_id: result.job_id, wait: Math.min(55000, Math.ceil(remaining)) });
  }
  return result;
}
