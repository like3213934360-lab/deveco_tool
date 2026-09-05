import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { harmonyDocs, cliAuth } from "../src/deveco-official.mjs";
import { writeCredential } from "../src/modules/credential-store.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-auth-docs-"));
const originalHomedir = os.homedir;
os.homedir = () => directory;
syncBuiltinESMExports();
const oldKeychain = process.env.DEVECO_DISABLE_CREDENTIAL_KEYCHAIN;
process.env.DEVECO_DISABLE_CREDENTIAL_KEYCHAIN = "1";
const auth = await import("../src/modules/auth.mjs");
const { searchKnowledge } = await import("../src/modules/knowledge.mjs");
const authFile = path.join(directory, ".deveco-knowledge-mcp", "auth.json");
const jwt = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, userId: "fixture", userName: "Fixture User" })).toString("base64url")}.x`;
const seed = () => writeCredential(authFile, { jwtToken: jwt, accessToken: "fixture-access", accessSavedAt: Date.now() });
const tokenResponse = () => Response.json({ status: true, userInfo: { accessToken: "fixture-refreshed" } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

after(async () => {
  await auth.closeAuth();
  os.homedir = originalHomedir;
  syncBuiltinESMExports();
  if (oldKeychain === undefined) delete process.env.DEVECO_DISABLE_CREDENTIAL_KEYCHAIN;
  else process.env.DEVECO_DISABLE_CREDENTIAL_KEYCHAIN = oldKeychain;
  fs.rmSync(directory, { recursive: true, force: true });
});

function cleanupAuth(t) {
  t.after(async () => {
    await auth.logout();
    await auth.closeAuth();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}

function browserFixture(t, outcome = "fail") {
  const calls = [];
  const originalSpawn = childProcess.spawn;
  t.mock.method(childProcess, "spawn", (command, args, options) => {
    if (!["open", "xdg-open", "rundll32.exe"].includes(command)) return originalSpawn(command, args, options);
    calls.push({ command, args, options });
    const child = new EventEmitter();
    if (outcome !== "hang") queueMicrotask(() => child.emit("close", outcome === "ok" ? 0 : 1));
    return child;
  });
  syncBuiltinESMExports();
  t.mock.method(globalThis, "fetch", async (url) => String(url).includes("/temptoken/check") ? new Response(jwt) : tokenResponse());
  return calls;
}

function callback(loginUrl, values = {}) {
  const url = new URL(loginUrl);
  const params = new URLSearchParams({ code: url.searchParams.get("code"), tempToken: "fixture-temp", siteId: "1", ...values });
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${url.searchParams.get("port")}/callback?${params}`, { agent: false }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.setTimeout(2000, () => request.destroy(new Error("Fixture callback timed out")));
  });
}

test("logout aborts a pending refresh and a late response cannot recreate credentials", async (t) => {
  cleanupAuth(t);
  await seed();
  const entered = deferred(), response = deferred();
  let signal;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    signal = options.signal;
    entered.resolve();
    return response.promise; // Deliberately deliver a response even after cancellation.
  });
  const refreshing = auth.ensureAccessToken({ force: true });
  const rejected = assert.rejects(refreshing, { code: "DEVECO_AUTH_CANCELLED" });
  await entered.promise;
  await auth.logout();
  assert.equal(signal.aborted, true);
  assert.deepEqual(await auth.authStatus(), { loggedIn: false });
  response.resolve(tokenResponse());
  await rejected;
  assert.equal(fs.existsSync(authFile), false);
  assert.equal(fs.existsSync(`${authFile}.key`), false);
});

test("logout waits for a credential write that has already entered the OS store", async (t) => {
  cleanupAuth(t);
  await seed();
  t.mock.method(globalThis, "fetch", async () => tokenResponse());
  const rename = fs.renameSync;
  let clearing, entered = false;
  t.mock.method(fs, "renameSync", (...args) => {
    if (!entered && args[1] === authFile) {
      entered = true;
      clearing = auth.logout();
    }
    return rename(...args);
  });
  await assert.rejects(auth.ensureAccessToken({ force: true }), { code: "DEVECO_AUTH_CANCELLED" });
  assert.equal(entered, true);
  await clearing;
  assert.equal(fs.existsSync(authFile), false);
  assert.equal(fs.existsSync(`${authFile}.key`), false);
});

test("concurrent searches share one refresh and never start an implicit browser login", async (t) => {
  cleanupAuth(t);
  await seed();
  const entered = deferred(), response = deferred();
  let requests = 0;
  t.mock.method(globalThis, "fetch", () => { requests++; entered.resolve(); return response.promise; });
  const one = auth.ensureAccessToken({ force: true });
  const two = auth.ensureAccessToken({ force: true });
  await entered.promise;
  response.resolve(tokenResponse());
  assert.deepEqual(await Promise.all([one, two]), ["fixture-refreshed", "fixture-refreshed"]);
  assert.equal(requests, 1);
  await auth.logout();
  await assert.rejects(auth.ensureAccessToken(), { code: "DEVECO_AUTH_REQUIRED" });
});

for (const platform of ["darwin", "linux", "win32"]) {
  test(`manual browser login remains usable with ${platform} launcher failure`, async (t) => {
    cleanupAuth(t);
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: platform });
    t.after(() => Object.defineProperty(process, "platform", { value: original }));
    const calls = browserFixture(t);
    const manual = deferred();
    let loginUrl;
    const loggingIn = auth.login({ onProgress(progress) {
      if (progress.login_url) loginUrl = progress.login_url;
      if (progress.browser_status === "manual_required") manual.resolve();
    } });
    await manual.promise;
    assert.equal(calls[0].command, { darwin: "open", linux: "xdg-open", win32: "rundll32.exe" }[platform]);
    assert.deepEqual(calls[0].args, platform === "win32" ? ["url.dll,FileProtocolHandler", loginUrl] : [loginUrl]);
    assert.equal(calls[0].options.shell, undefined);
    assert.equal(await callback(loginUrl, { code: "unrelated" }), 204);
    assert.equal(await callback(loginUrl), 302);
    assert.deepEqual(await loggingIn, { userId: "fixture", userName: "Fixture User" });
    const status = await auth.authStatus();
    assert.equal(status.loggedIn, true);
    for (const key of ["jwtToken", "accessToken", "refreshToken"]) assert.equal(key in status, false);
  });
}

test("logout closes the pending browser callback and a new login uses a new nonce", async (t) => {
  cleanupAuth(t);
  browserFixture(t);
  const ready = deferred();
  const first = auth.login({ onProgress(progress) { if (progress.login_url) ready.resolve(progress.login_url); } });
  const rejected = assert.rejects(first, { code: "DEVECO_AUTH_CANCELLED" });
  const oldUrl = await ready.promise;
  await auth.logout();
  await rejected;
  await assert.rejects(callback(oldUrl), { code: "ECONNREFUSED" });
  assert.deepEqual(await auth.authStatus(), { loggedIn: false });
  const nextReady = deferred();
  const next = auth.login({ onProgress(progress) { if (progress.login_url) nextReady.resolve(progress.login_url); } });
  const nextUrl = await nextReady.promise;
  assert.notEqual(new URL(nextUrl).searchParams.get("code"), new URL(oldUrl).searchParams.get("code"));
  assert.equal(await callback(nextUrl, { code: new URL(oldUrl).searchParams.get("code") }), 204);
  await callback(nextUrl);
  await next;
  assert.equal((await auth.authStatus()).loggedIn, true);
});

test("callback completion does not wait for a browser launcher that stays alive", async (t) => {
  cleanupAuth(t);
  browserFixture(t, "hang");
  const ready = deferred();
  const loggingIn = auth.login({ onProgress(progress) { if (progress.login_url) ready.resolve(progress.login_url); } });
  await callback(await ready.promise);
  await loggingIn;
  assert.equal((await auth.authStatus()).loggedIn, true);
});

test("a failed manual-login window expires and releases its callback port", async (t) => {
  cleanupAuth(t);
  browserFixture(t);
  const setTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => setTimeout(fn, ms === 300000 ? 50 : ms, ...args));
  let url;
  await assert.rejects(auth.login({ onProgress(progress) { url = progress.login_url || url; } }), { code: "DEVECO_LOGIN_TIMEOUT" });
  await assert.rejects(callback(url), { code: "ECONNREFUSED" });
});

test("shutdown cancels pending login without deleting the saved session", async (t) => {
  cleanupAuth(t);
  await seed();
  browserFixture(t);
  const ready = deferred();
  const loggingIn = auth.login({ onProgress(progress) { if (progress.login_url) ready.resolve(); } });
  const rejected = assert.rejects(loggingIn, { code: "DEVECO_AUTH_CANCELLED" });
  await ready.promise;
  await auth.closeAuth();
  await rejected;
  assert.equal((await auth.authStatus()).loggedIn, true);
});

test("knowledge authentication retries once for service error 4016", async (t) => {
  cleanupAuth(t);
  await seed();
  let searches = 0, refreshes = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("jwToken/check")) { refreshes++; return tokenResponse(); }
    searches++;
    return Response.json(searches === 1 ? { error_code: 4016 } : { code: 200, body: { answer: { prompt: "header【检索信息】：Fixture result" } } });
  });
  assert.equal(await searchKnowledge("Text font size"), "Fixture result");
  assert.equal(searches, 2);
  assert.equal(refreshes, 1);
});

async function cliFixture(t) {
  const entry = path.join(directory, `cli-${Date.now()}.mjs`);
  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(() => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
  });
  return (output, code = 0, stderr = "") => fs.writeFileSync(entry,
    `process.stdout.write(${JSON.stringify(output)}); process.stderr.write(${JSON.stringify(stderr)}); process.exitCode=${code};`);
}

test("documentation content never becomes an execution failure, but failed CLI exits do", async (t) => {
  const output = await cliFixture(t);
  output("# Debugging\nBUILD FAILED\nconsole.error('Failed to start pip');\nerror: example\n");
  for (const input of [{ action: "read", document_id: "fixture" }, { action: "search", keywords: ["error:"] }]) {
    assert.match(await harmonyDocs({ ...input, project_path: directory }), /BUILD FAILED/);
  }
  output("", 1, "Document not found: fixture");
  await assert.rejects(harmonyDocs({ action: "read", document_id: "fixture", project_path: directory }), { code: "DEVECO_DOCS_FAILED" });
  output("", 0);
  await assert.rejects(harmonyDocs({ action: "catalog", project_path: directory }), /no output/i);
});

test("CLI authentication requires an action-specific acknowledgement, including empty teams", async (t) => {
  const output = await cliFixture(t);
  for (const message of [
    "Please run `devecocli auth login` first.", "Please run devecocli auth login first.",
    "Token expired. Run `devecocli auth login` again.", "Unexpected upstream message",
  ]) {
    output(message);
    await assert.rejects(cliAuth({ action: "team_list", project_path: directory }), { code: "DEVECO_AUTH_FAILED" });
  }
  for (const [action, message] of [
    ["team_list", "No teams found for the current user."], ["team_list", "Id  Name\n--  ----\n12  BUILD FAILED team\n"],
    ["login", "Login successful. Logged in as fixture."], ["login", "Already logged in, User Name:fixture"],
    ["logout", "Logout successful"], ["logout", "Already logged out."],
    ["status", "Not logged in"], ["status", "Current user: Failed to start"],
  ]) {
    output(`\u001b[32m${message}\u001b[0m\n`);
    assert.match(await cliAuth({ action, project_path: directory }), /devecocli auth/);
  }
  output("Login is managed by DevEco Code. Log out from DevEco Code instead.");
  await assert.rejects(cliAuth({ action: "logout", project_path: directory }), { code: "DEVECO_AUTH_FAILED" });
});

async function mcpFixture(t, { realCli = false, sharedHome, refreshGate } = {}) {
  const home = sharedHome || fs.mkdtempSync(path.join(directory, "mcp-"));
  const entry = path.join(home, "cli.mjs");
  fs.writeFileSync(entry, `const args=process.argv.slice(2); console.log(args[0]==='docs' ? '# Example\\nBUILD FAILED\\nFailed to start pip' : 'Please run \`devecocli auth login\` first.');`);
  // The official CLI starts background SDK/toolchain discovery for telemetry even on auth
  // commands. Keep this isolated authentication test independent of that host-dependent work.
  const env = { ...process.env, DEVECO_TEST_AUTH_HOME: home, DEVECO_CLI_DATA_DIR: path.join(home, "official"),
    DEVECO_CLI_DISABLE_UPDATE: "all", DEVECO_CLI_DISABLE_TELEMETRY: "1" };
  if (refreshGate) env.DEVECO_TEST_REFRESH_GATE = refreshGate;
  if (realCli) delete env.DEVECO_CLI_ENTRY;
  else env.DEVECO_CLI_ENTRY = entry;
  delete env.DEVECO_CLI_AUTH_SOURCE;
  const transport = new StdioClientTransport({
    command: process.execPath, cwd: root, env, stderr: "pipe",
    args: ["--import", new URL("fixtures/auth-preload.mjs", import.meta.url).href, "src/server.mjs"],
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => { stderr += chunk; });
  const client = new Client({ name: "auth-docs-tests", version: "1" });
  try { await client.connect(transport); }
  catch (error) {
    await transport.close();
    throw new Error(`Fixture MCP startup failed: ${stderr || error.message}`, { cause: error });
  }
  t.after(async () => { await transport.close(); assert.doesNotMatch(stderr, /unhandled|uncaught/i); });
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    let value; try { value = JSON.parse(result.content[0].text); } catch { value = result.content[0].text; }
    return { error: result.isError === true, value };
  };
  return { call, home };
}

test("logout in a second MCP process invalidates the first process's pending login", async (t) => {
  const first = await mcpFixture(t);
  const second = await mcpFixture(t, { sharedHome: first.home });
  const started = await first.call("deveco_login", { action: "start" });
  let progress;
  for (let attempt = 0; attempt < 50; attempt++) {
    progress = await first.call("deveco_login", { action: "status", login_id: started.value.login_id, wait_ms: 10 });
    if (progress.value.login_url) break;
  }
  assert.ok(progress.value.login_url);
  assert.deepEqual((await second.call("deveco_logout")).value, { loggedIn: false });
  await callback(progress.value.login_url).catch((error) => assert.ok(["ECONNREFUSED", "ECONNRESET"].includes(error.code)));
  const completed = await first.call("deveco_login", { action: "status", login_id: started.value.login_id, wait_ms: 1000 });
  assert.equal(completed.value.status, "cancelled");
  assert.equal(completed.error, true);
  assert.deepEqual((await second.call("deveco_status")).value, { loggedIn: false });
});

test("logout in another MCP process prevents an in-flight token refresh from restoring the session", async (t) => {
  const gate = path.join(directory, "refresh-gate");
  const first = await mcpFixture(t, { refreshGate: gate });
  const second = await mcpFixture(t, { sharedHome: first.home });
  const sharedAuthFile = path.join(first.home, ".deveco-knowledge-mcp", "auth.json");
  await writeCredential(sharedAuthFile, { jwtToken: jwt, accessToken: "old", accessSavedAt: 0 });
  const searching = first.call("arkts_knowledge_search", { question: "Text" });
  try {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(`${gate}.started`) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(fs.existsSync(`${gate}.started`));
    assert.deepEqual((await second.call("deveco_logout")).value, { loggedIn: false });
  } finally { fs.writeFileSync(gate, "release"); }
  const result = await searching;
  assert.equal(result.error, true);
  assert.equal(result.value.code, "DEVECO_AUTH_CANCELLED");
  assert.deepEqual((await second.call("deveco_status")).value, { loggedIn: false });
  assert.equal(fs.existsSync(sharedAuthFile), false);
  assert.equal(fs.existsSync(`${sharedAuthFile}.key`), false);
});

test("a remote logout closes an idle manual-login callback without waiting for a callback", async (t) => {
  const first = await mcpFixture(t);
  const second = await mcpFixture(t, { sharedHome: first.home });
  const started = await first.call("deveco_login", { action: "start" });
  const id = started.value.login_id;
  let progress;
  for (let attempt = 0; attempt < 50; attempt++) {
    progress = await first.call("deveco_login", { action: "status", login_id: id, wait_ms: 10 });
    if (progress.value.login_url) break;
  }
  assert.ok(progress.value.login_url);
  await second.call("deveco_logout");
  const result = await first.call("deveco_login", { action: "status", login_id: id, wait_ms: 1000 });
  assert.equal(result.value.status, "cancelled");
  await assert.rejects(callback(progress.value.login_url), { code: "ECONNREFUSED" });
});

test("MCP manual login, cancellation and error flags follow the actual outcomes", async (t) => {
  const { call } = await mcpFixture(t);
  const started = await call("deveco_login", { action: "start" });
  const id = started.value.login_id;
  let progress;
  for (let attempt = 0; attempt < 50; attempt++) {
    progress = await call("deveco_login", { action: "status", login_id: id, wait_ms: 10 });
    if (progress.value.browser_status === "manual_required") break;
  }
  assert.equal(progress.error, false);
  assert.equal(progress.value.status, "waiting");
  assert.equal(progress.value.browser_status, "manual_required");
  assert.ok(progress.value.login_url);
  assert.equal((await call("deveco_login", { action: "start" })).value.login_id, id);
  await callback(progress.value.login_url);
  const completed = await call("deveco_login", { action: "status", login_id: id, wait_ms: 1000 });
  assert.equal(completed.error, false);
  assert.equal(completed.value.status, "succeeded");
  const status = (await call("deveco_status")).value;
  assert.equal(status.loggedIn, true);
  for (const key of ["jwtToken", "accessToken", "refreshToken"]) assert.equal(key in status, false);
  const next = await call("deveco_login", { action: "start" });
  const oldPoll = call("deveco_login", { action: "status", login_id: next.value.login_id, wait_ms: 1000 });
  assert.deepEqual((await call("deveco_logout")).value, { loggedIn: false });
  const replacement = await call("deveco_login", { action: "start" });
  const cancelled = await oldPoll;
  assert.equal(cancelled.value.login_id, next.value.login_id);
  assert.equal(cancelled.value.status, "cancelled");
  assert.equal(cancelled.error, true);
  assert.notEqual(replacement.value.login_id, next.value.login_id);
  await call("deveco_logout");
  assert.deepEqual((await call("deveco_status")).value, { loggedIn: false });
  assert.equal((await call("harmony_docs", { action: "read", document_id: "fixture" })).error, false);
  const teams = await call("deveco_cli_auth", { action: "team_list" });
  assert.equal(teams.error, true);
  assert.equal(teams.value.code, "DEVECO_AUTH_FAILED");
});

test("the installed official CLI reports missing team authentication as an MCP error", async (t) => {
  const { call } = await mcpFixture(t, { realCli: true });
  const result = await call("deveco_cli_auth", { action: "team_list", timeoutMs: 10000 });
  assert.equal(result.error, true);
  assert.equal(result.value.code, "DEVECO_AUTH_FAILED");
  assert.match(result.value.message, /Please run `devecocli auth login` first/);
  const status = await call("deveco_cli_auth", { action: "status", timeoutMs: 10000 });
  assert.equal(status.error, false);
  assert.match(status.value, /Not logged in/);
});
