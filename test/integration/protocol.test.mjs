import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { connect } from "../support/mcp.mjs";

const root = path.resolve(import.meta.dirname, "../..");
function raw(t) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-rpc-"));
  const env = { DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") };
  const child = spawn(process.execPath, [path.join(root, "dist/cli.js"), "mcp"], { env: { ...process.env, ...env } });
  const messages = [], readers = [];
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c; });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const m = JSON.parse(line);
    if (readers.length) readers.shift()(m); else messages.push(m);
  });
  const next = () => new Promise((resolve, reject) => {
    if (messages.length) return resolve(messages.shift());
    const timer = setTimeout(() => reject(new Error(`RPC response timeout: ${stderr}`)), 10000);
    readers.push((m) => { clearTimeout(timer); resolve(m); });
  });
  t.after(async () => {
    if (child.exitCode === null) { child.stdin.end(); await once(child, "exit"); }
    fs.rmSync(state, { recursive: true, force: true });
  });
  return { child, env, messages, next, send: (m) => child.stdin.write(typeof m === "string" ? `${m}\n` : `${JSON.stringify(m)}\n`) };
}

test("invalid frames return protocol errors and the subprocess stays usable", async (t) => {
  const c = raw(t);
  for (const frame of ["null", "false", "1", '"x"', "[]", "[{}]", "{}", '{"jsonrpc":"1.0","id":1,"method":"ping"}',
    '{"jsonrpc":"2.0","id":null,"method":"ping"}', '{"jsonrpc":"2.0","id":true,"method":"ping"}',
    '{"jsonrpc":"2.0","id":{},"method":"ping"}', '{"jsonrpc":"2.0","id":1.5,"method":"ping"}',
    '{"jsonrpc":"2.0","id":1,"method":3}']) {
    c.send(frame); assert.equal((await c.next()).error.code, -32600, frame);
  }
  c.send("{"); assert.equal((await c.next()).error.code, -32700);
  for (const params of [null, [], "x", 1, true]) {
    c.send({ jsonrpc: "2.0", id: "bad", method: "ping", params });
    assert.equal((await c.next()).error.code, -32602);
  }
  c.send({ jsonrpc: "2.0", id: "unknown", method: "not-a-method" });
  assert.equal((await c.next()).error.code, -32601);
  c.send({ jsonrpc: "2.0", id: "init", method: "initialize", params: {} });
  assert.equal((await c.next()).error.code, -32602);
  c.send({ jsonrpc: "2.0", id: "initialize", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "regression", version: "1" } } });
  assert.equal((await c.next()).result.protocolVersion, "2025-06-18");
  // Valid notifications, including malformed notification params, must stay silent.
  for (const method of ["ping", "not-a-method", "notifications/cancelled"])
    c.send({ jsonrpc: "2.0", method, params: [] });
  c.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  c.send({ jsonrpc: "2.0", id: "list", method: "tools/list" });
  const list = await c.next();
  assert.equal(list.id, "list"); assert.equal(list.result.tools.length, 15);
  // Concurrent string/numeric ids are returned intact without a serialization dependency.
  for (const id of [0, "0", 42, "last"]) c.send({ jsonrpc: "2.0", id, method: "ping" });
  const ids = await Promise.all(Array.from({ length: 4 }, c.next));
  assert.deepEqual(new Set(ids.map((m) => m.id)), new Set([0, "0", 42, "last"]));
});

test("version negotiation only claims the implemented single-message protocol", async (t) => {
  for (const requested of ["2025-06-18", "2025-03-26", "2024-11-05", "2099-01-01"]) {
    const c = raw(t);
    c.send({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: requested, capabilities: {}, clientInfo: { name: "regression", version: "1" } } });
    assert.equal((await c.next()).result.protocolVersion, "2025-06-18", requested);
    c.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    c.send([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "ping" }]);
    const batch = await c.next();
    assert.equal(batch.id, null); assert.equal(batch.error.code, -32600);
    c.send({ jsonrpc: "2.0", id: "after", method: "ping" });
    assert.deepEqual(await c.next(), { jsonrpc: "2.0", id: "after", result: {} });
  }
});

test("tools/call rejects malformed envelopes before resolving or executing tools", async (t) => {
  const c = raw(t);
  let id = 0;
  c.send({ jsonrpc: "2.0", id: ++id, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "regression", version: "1" } } });
  assert.equal((await c.next()).result.protocolVersion, "2025-06-18");
  c.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  for (const params of [
    ...[undefined, null, true, 1, [], {}, "", "  "].map((name) => ({ name, arguments: {} })),
    ...[null, [], [1], "", "x", true, false, 1, 0].map((args) => ({ name: "doctor", arguments: args })),
  ]) {
    c.send({ jsonrpc: "2.0", id: ++id, method: "tools/call", params });
    const response = await c.next();
    assert.equal(response.error?.code, -32602, JSON.stringify(params));
    assert.equal(response.result, undefined, "malformed envelopes never become tool results");
  }
  for (const name of ["missing", "__proto__"]) {
    c.send({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: {} } });
    const response = await c.next();
    assert.equal(response.error.code, -32602);
    assert.equal(response.error.message, `Unknown tool: ${name}`);
    assert.equal(response.result, undefined);
  }
  // Omitted arguments are a valid envelope. The action schema still returns a tool error.
  c.send({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: "job" } });
  const missingAction = await c.next();
  assert.equal(missingAction.error, undefined);
  assert.equal(missingAction.result.isError, true);
  assert.equal(JSON.parse(missingAction.result.content[0].text).error.code, "INVALID_INPUT");
  c.send({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: "job", arguments: { action: "list" } } });
  const valid = await c.next();
  assert.equal(valid.error, undefined);
  assert.deepEqual(JSON.parse(valid.result.content[0].text).jobs, []);
});

test("required prompt arguments never interpolate missing or malformed project values", async (t) => {
  const c = raw(t);
  for (const name of ["fix-build", "debug-crash", "upgrade-sdk"]) {
    for (const args of [{}, { project: "" }, { project: "  \n" }, { project: null }, { project: 1 }, { project: {} }, []]) {
      c.send({ jsonrpc: "2.0", id: 1, method: "prompts/get", params: { name, arguments: args } });
      assert.equal((await c.next()).error.code, -32602, `${name}: ${JSON.stringify(args)}`);
    }
    c.send({ jsonrpc: "2.0", id: 1, method: "prompts/get", params: { name, arguments: { project: "/project" } } });
    const valid = await c.next(); assert.ok(valid.result); assert.doesNotMatch(JSON.stringify(valid), /undefined/);
  }
  for (const params of [{}, { name: "__proto__", arguments: {} }, { name: 3 }, { name: "fix-build", arguments: null }]) {
    c.send({ jsonrpc: "2.0", id: 1, method: "prompts/get", params });
    assert.equal((await c.next()).error.code, -32602);
  }
  // Reconnect is an independent process; a preceding bad frame has no durable poison state.
  const reconnected = connect(c.env);
  try { assert.equal((await reconnected.initialize()).result.serverInfo.name, "deveco-mcp"); }
  finally { await reconnected.close(); }
});

test("all 103 audited entrypoints remain discoverable and reject unknown fields before execution", async (t) => {
  const c = connect(raw(t).env);
  try {
    await c.initialize();
    const listed = await c.request("tools/list");
    const tools = new Map(listed.result.tools.map((tool) => [tool.name, tool]));
    const entries = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/tool-actions.json")));
    assert.equal(entries.length, 103);
    assert.equal(new Set(entries).size, 103);
    for (const entry of entries) {
      const [name, action] = entry.split(".");
      const tool = tools.get(name);
      assert.ok(tool, `${entry}: tool must remain discoverable`);
      if (action) assert.ok(tool.inputSchema.properties.action.enum.includes(action), `${entry}: action must remain discoverable`);
      const response = await c.call(name, { ...(action ? { action } : {}), audit_unknown_field: true });
      assert.equal(response.isError, true, entry);
      assert.equal(response.data.error.code, "INVALID_INPUT", entry);
      assert.deepEqual(response.data.error.details.unknown, ["audit_unknown_field"], entry);
    }
    assert.deepEqual((await c.call("job", { action: "list" })).data.jobs, [], "no invalid call created a job");
  } finally { await c.close(); }
});

test("cancelled knowledge metadata closes the HTTP request and leaves other RPCs responsive", async (t) => {
  const c = raw(t);
  let started, closed;
  const begun = new Promise((r) => { started = r; });
  const disconnected = new Promise((r) => { closed = r; });
  const server = http.createServer((_req, res) => { started(); res.once("close", closed); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  fs.writeFileSync(c.env.DEVECO_CONFIG, JSON.stringify({ npm_registry: `http://127.0.0.1:${server.address().port}` }));
  c.send({ jsonrpc: "2.0", id: "kb", method: "tools/call", params: { name: "knowledge", arguments: { action: "status" } } });
  await begun;
  c.send({ jsonrpc: "2.0", id: "parallel", method: "ping" });
  assert.equal((await c.next()).id, "parallel");
  const cancelledAt = performance.now();
  c.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "kb" } });
  let timer;
  try {
    await Promise.race([disconnected, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Cancelled HTTP socket remained open")), 1500); })]);
  } finally { clearTimeout(timer); }
  assert.ok(performance.now() - cancelledAt < 1500);
  c.send({ jsonrpc: "2.0", id: "after", method: "ping" });
  assert.equal((await c.next()).id, "after", "cancelled request emits no late response");
});
