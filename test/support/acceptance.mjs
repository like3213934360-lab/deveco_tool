// Real acceptance lifecycle and append-only private evidence; assertions belong to the test cases.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { connect, waitJob } from "./mcp.mjs";

export const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
export const redact = (value) => JSON.parse(JSON.stringify(value, (key, v) => /password|token|authorization|secret|login_url/i.test(key) ? "[redacted]" : v));
export function required(name) {
  assert.ok(process.env[name], `${name} must be explicitly selected; see test/README.md`);
  return process.env[name];
}
export function hashes(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true }).filter((f) => fs.statSync(path.join(root, f)).isFile())
    .sort().map((f) => [f, sha(fs.readFileSync(path.join(root, f)))]));
}
export function globalConfigs() {
  return Object.fromEntries([".codex/config.toml", ".config/opencode/opencode.json", ".config/opencode/opencode.jsonc"]
    .map((f) => [f, fs.existsSync(path.join(os.homedir(), f)) ? sha(fs.readFileSync(path.join(os.homedir(), f))) : null]));
}

export async function session(t, env = {}) {
  const base = required("E2E_DIR"); assert.ok(path.isAbsolute(base));
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const run = `${t.name.toLowerCase().replace(/[^a-z0-9-]/g, "_").slice(0, 24)}-${crypto.randomUUID()}`;
  const directory = path.join(base, run); fs.mkdirSync(directory, { mode: 0o700 });
  const trace = path.join(directory, "calls.jsonl");
  const receipt = (file, data) => fs.writeFileSync(path.join(directory, file), JSON.stringify(redact(data), null, 2), { flag: "wx", mode: 0o600 });
  const client = connect(env);
  const cleanup = [() => client.close()];
  const defer = (fn) => cleanup.push(fn);
  t.after(async () => {
    const errors = [];
    for (const fn of cleanup.reverse()) try { await fn(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "Acceptance cleanup failed");
  });
  t.diagnostic(`Private evidence: ${directory}`);
  let sequence = 0;
  const raw = async (tool, args = {}) => {
    const at = new Date().toISOString(), start = performance.now(), current = sequence++;
    try {
      const response = await client.call(tool, args);
      const images = response.content.filter((c) => c.type === "image").map((c, i) => {
        const bytes = Buffer.from(c.data, "base64"), file = `${current}-${i}.${c.mimeType === "image/png" ? "png" : "jpg"}`;
        fs.writeFileSync(path.join(directory, file), bytes, { flag: "wx", mode: 0o600 });
        return { file, bytes: bytes.length, sha256: sha(bytes) };
      });
      fs.appendFileSync(trace, JSON.stringify(redact({ sequence: current, at, ms: Math.round(performance.now() - start), tool, args, isError: response.isError, data: response.data, images })) + "\n", { mode: 0o600 });
      return { ...response, images };
    } catch (error) {
      try { fs.appendFileSync(trace, JSON.stringify(redact({ sequence: current, at, tool, args, failure: String(error) })) + "\n", { mode: 0o600 }); }
      catch (diagnostic) { throw new AggregateError([error, diagnostic], "Call and evidence recording failed"); }
      throw error;
    }
  };
  const call = async (tool, args = {}) => {
    const r = await raw(tool, args); assert.equal(r.isError, false, JSON.stringify(r.data)); return r.data;
  };
  const job = async (tool, args) => {
    const d = await waitJob(call, await call(tool, args)); assert.equal(d.status, "succeeded", JSON.stringify(d)); return d;
  };
  receipt("initialize.json", await client.initialize());
  receipt("tools.json", await client.request("tools/list"));
  const doctor = await call("doctor", { remote: false });
  assert.equal(doctor.server.build_id, JSON.parse(fs.readFileSync("dist/current.json", "utf8")).input_hash);
  return { client, call, raw, job, directory, run, receipt, defer };
}

export async function app(t, device = true) {
  const target = device ? required("E2E_TARGET") : undefined, project = required("E2E_PROJECT");
  assert.ok(path.isAbsolute(project));
  const bundle = JSON5.parse(fs.readFileSync(path.join(project, "AppScope/app.json5"), "utf8")).app.bundleName;
  assert.match(bundle, /^com\.devecomcp\./, "Only a dedicated MCP test app may be mutated");
  const context = await session(t);
  const { call } = context, info = device ? await call("device", { action: "info", target }) : undefined;
  if (device) assert.ok(!target.includes(":") && !/emulator/i.test(`${info.model} ${info.name}`), "Select the USB physical device");
  const ui = (args) => call("ui", { target, ...args });
  const visible = async (text) => assert.equal((await ui({ action: "assert", visible: { text, exact: true }, timeout_ms: 5000 })).passed, true);
  const launch = () => call("run", { action: "launch", project, target });
  const file = "entry/src/main/ets/pages/Index.ets";
  const lsp = (op, args = {}) => call("code", { action: "lsp", project, file, op, ...args });
  return { ...context, target, project, bundle, ui, visible, launch, file, lsp, info };
}
