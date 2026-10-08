// Tiny stdio MCP client for smoke tests and benchmarks (no dependencies).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function connect(env = {}, entry = path.join(root, "bin/deveco-mcp.mjs")) {
  const started = performance.now();
  const child = spawn(process.execPath, [entry, "mcp"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  let id = 0;
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const current = ++id;
      const timer = setTimeout(() => reject(new Error(`${method} timed out; stderr: ${stderr}`)), 120000);
      pending.set(current, (m) => { clearTimeout(timer); resolve(m); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: current, method, params }) + "\n");
    });
  const client = {
    child,
    started,
    get stderr() { return stderr; },
    request,
    async initialize() {
      const result = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      return result;
    },
    async call(name, args = {}) {
      const response = await request("tools/call", { name, arguments: args });
      const text = response.result?.content?.find((c) => c.type === "text")?.text;
      return { isError: !!response.result?.isError, data: text ? JSON.parse(text) : undefined, content: response.result?.content ?? [] };
    },
    close() { child.stdin.end(); return new Promise((r) => child.once("exit", r)); },
  };
  return client;
}
