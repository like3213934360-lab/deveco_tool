// Real MCP acceptance against the current environment; only explicitly selected test objects are mutated.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { connect } from "../../tools/mcp-client.mjs";

const phase = process.argv[2], directory = process.env.AUDIT_DIR;
assert.ok(directory && path.isAbsolute(directory), "AUDIT_DIR must be an absolute private evidence directory");
assert.ok(["skills", "emulator", "auth", "knowledge", "equivalence", "cpp"].includes(phase), "Unknown audit phase");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const run = `${phase}-${Date.now()}`, client = connect(), results = [];
const trace = path.join(directory, `${run}.jsonl`);
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
let current = "preflight";
async function raw(tool, args = {}) {
  const at = new Date().toISOString(), response = await client.call(tool, args);
  fs.appendFileSync(trace, JSON.stringify({ at, case: current, tool, args, isError: response.isError, data: response.data }) + "\n");
  return response;
}
async function call(tool, args = {}) {
  const r = await raw(tool, args);
  assert.equal(r.isError, false, JSON.stringify(r.data));
  return r.data;
}
async function check(id, fn) {
  current = id;
  try {
    await fn(); results.push({ id, status: "passed" }); console.log(`PASS ${id}`);
  } catch (error) {
    results.push({ id, status: "failed", error: error.message }); console.log(`FAIL ${id}: ${error.message}`);
  }
  fs.writeFileSync(path.join(directory, `${run}-results.json`), JSON.stringify({ phase, trace, results }, null, 2));
}
function hashes(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true }).filter((f) => fs.statSync(path.join(root, f)).isFile())
    .sort().map((f) => [f, sha(fs.readFileSync(path.join(root, f)))]));
}
function globalConfigs() {
  return Object.fromEntries([".codex/config.toml", ".config/opencode/opencode.json", ".config/opencode/opencode.jsonc"]
    .map((f) => [f, fs.existsSync(path.join(os.homedir(), f)) ? sha(fs.readFileSync(path.join(os.homedir(), f))) : null]));
}

try {
  fs.writeFileSync(path.join(directory, `${run}-initialize.json`), JSON.stringify(await client.initialize(), null, 2));
  const server = (await call("doctor", { remote: false, ...(process.env.AUDIT_TARGET ? { target: process.env.AUDIT_TARGET } : {}) })).server;
  assert.equal(server.build_id, JSON.parse(fs.readFileSync("dist/current.json", "utf8")).input_hash);
  if (phase === "cpp") {
    const project = process.env.AUDIT_PROJECT, file = "entry/src/main/cpp/napi_init.cpp";
    assert.ok(project && path.isAbsolute(project));
    assert.match((await call("project", { action: "info", project })).bundle_name, /^com\.devecomcp\./);
    const source = path.join(project, file), original = fs.readFileSync(source);
    assert.match(original.toString(), /static int Add\(int a, int b\)/);
    const lsp = (op, args = {}) => call("code", { action: "lsp", project, file, op, ...args });
    const line = original.toString().split("\n").length + 1;
    try {
      fs.appendFileSync(source, "\nstruct AuditBase { virtual int value() = 0; };\nstruct AuditDerived final : AuditBase { int value() override { return 1; } };\n");
      await check("cpp.declaration", async () => assert.ok((await lsp("declaration", { symbol: "Add", line: 5 })).locations.some((l) => l.line === 2)));
      await check("cpp.references", async () => assert.ok((await lsp("references", { symbol: "Add", line: 2 })).references.some((l) => l.line === 5)));
      await check("cpp.symbols", async () => assert.ok((await lsp("symbols")).symbols.some((s) => s.name === "NapiAdd")));
      await check("cpp.workspace_symbols", async () => assert.ok((await lsp("workspace_symbols", { query: "NapiAdd" })).symbols.some((s) => s.name === "NapiAdd")));
      await check("cpp.diagnostics", async () => assert.equal((await lsp("diagnostics")).errors, 0));
      await check("cpp.completion", async () => assert.ok((await lsp("completion", { line: 5, column: 23 })).items.some((i) => i.label.trim() === "env")));
      await check("cpp.signature", async () => assert.match((await lsp("signature", { line: 5, column: 30 })).signatures[0].label, /Add\(int a, int b\) -> int/));
      await check("cpp.incoming", async () => assert.deepEqual((await lsp("call_hierarchy", { symbol: "Add", line: 2 })).calls.map((c) => c.name), ["NapiAdd"]));
      await check("cpp.outgoing-explicitly-unavailable", async () => {
        const d = await raw("code", { action: "lsp", project, file, op: "call_hierarchy", symbol: "NapiAdd", line: 3, direction: "outgoing" });
        assert.equal(d.isError, true); assert.equal(d.data.error.code, "CAPABILITY_UNAVAILABLE");
      });
      await check("cpp.implementation", async () => assert.ok((await lsp("implementation", { symbol: "value", line })).locations.some((l) => l.line === line + 1 && l.code.includes("AuditDerived"))));
    } finally { fs.writeFileSync(source, original); }
    await check("cpp.fixture-restored", async () => assert.deepEqual(fs.readFileSync(source), original));
  }
  if (phase === "equivalence") {
    const project = process.env.AUDIT_PROJECT, target = process.env.AUDIT_TARGET;
    assert.ok(project && path.isAbsolute(project) && target && !target.includes(":"));
    const info = await call("project", { action: "info", project });
    assert.match(info.bundle_name, /^com\.devecomcp\./, "Only a dedicated audit app may be installed");
    await check("model-live.install-dedicated-app", async () => {
      let d = await call("run", { action: "build_run", project, target });
      while (["queued", "running"].includes(d.status)) d = await call("job", { action: "wait", job_id: d.job_id, wait: 55000 });
      assert.equal(d.status, "succeeded", JSON.stringify(d));
      assert.equal((await call("ui", { action: "assert", target, visible: { text: "Hello World" } })).passed, true);
    });
    await check("ui.tree-default-depth-equals-zero", async () => {
      const args = { action: "tree", target, all_windows: true, interactive: false };
      assert.deepEqual(await call("ui", args), await call("ui", { ...args, depth: 0 }));
    });
    await check("code.check-relative-and-absolute-path-equivalent", async () => {
      const file = "entry/src/main/ets/pages/Index.ets", args = { action: "check", project };
      const relative = await call("code", { ...args, files: [file] });
      const absolute = await call("code", { ...args, files: [path.join(project, file)] });
      assert.deepEqual(absolute, relative);
    });
  }
  if (phase === "auth") {
    const provider = "codegenie";
    const db = new DatabaseSync(path.join(os.homedir(), ".deveco-mcp/state.db"), { readOnly: true });
    const credential = (p) => { const row = db.prepare("SELECT data FROM credentials WHERE provider=?").get(p); return row ? sha(row.data) : null; };
    const original = credential("developer");
    const waitLogin = async () => {
      for (let i = 0; i < 300; i++) {
        const d = await call("auth", { action: "status", provider });
        assert.equal(d.error, undefined, JSON.stringify(d));
        if (!d.login_pending && d.logged_in) return d;
        await new Promise((r) => setTimeout(r, 1000));
      }
      assert.fail("Browser login did not complete within five minutes");
    };
    try {
      await check("auth.existing-session-pending-logout-login", async () => {
        assert.equal((await call("auth", { action: "status", provider })).logged_in, true);
        const before = credential(provider);
        const started = await call("auth", { action: "login", provider, open_browser: false });
        assert.equal(started.pending, true);
        const d = await call("auth", { action: "status", provider });
        assert.equal(d.logged_in, true); assert.equal(d.login_pending, true);
        assert.equal((await call("auth", { action: "login", provider, open_browser: false })).login_url, started.login_url);
        assert.equal((await call("auth", { action: "logout", provider })).logged_in, false);
        assert.equal((await call("auth", { action: "status", provider })).logged_in, false);
        assert.equal(credential(provider), null);
        await call("auth", { action: "login", provider, open_browser: true });
        await waitLogin();
        assert.ok(credential(provider)); assert.notEqual(credential(provider), before);
      });
      await check("auth.completed-login-restarts-and-old-cleanup-preserves-new", async () => {
        const previous = await call("auth", { action: "status", provider });
        const d = await call("auth", { action: "login", provider, open_browser: false });
        assert.notEqual(d.login_url, previous.login_url);
        assert.equal((await call("auth", { action: "status", provider })).login_pending, true);
        await new Promise((r) => setTimeout(r, 65000));
        const pending = await call("auth", { action: "status", provider });
        assert.equal(pending.login_pending, true); assert.equal(pending.login_url, d.login_url);
        await call("auth", { action: "logout", provider });
        await call("auth", { action: "login", provider, open_browser: true });
        await waitLogin();
      });
      await check("auth.other-provider-unchanged", async () => assert.equal(credential("developer"), original));
    } finally { db.close(); }
  }
  if (phase === "knowledge") {
    const root = path.join(os.homedir(), ".deveco-mcp/kb"), pointer = path.join(root, "current.json");
    const before = JSON.parse(fs.readFileSync(pointer, "utf8"));
    const original = path.join(root, before.directory ?? before.version), content = hashes(original);
    const installed = (await call("knowledge", { action: "status", check: false })).installed;
    await check("knowledge.update-upstream-and-rollback", async () => {
      let d = await call("knowledge", { action: "update", file: "upstream" });
      while (["queued", "running"].includes(d.status)) d = await call("job", { action: "wait", job_id: d.job_id, wait: 55000 });
      assert.equal(d.status, "succeeded", JSON.stringify(d)); assert.equal(d.result.updated, true);
      const next = JSON.parse(fs.readFileSync(pointer, "utf8"));
      assert.notEqual(next.directory, before.directory ?? before.version); assert.equal(next.previous, before.directory ?? before.version);
      const found = await call("knowledge", { action: "search", query: "@Local", limit: 1 });
      assert.equal(found.pack, d.result.version); assert.ok(found.results.length > 0);
      assert.ok((await call("knowledge", { action: "read", id: found.results[0].id })).content.length > 100);
      assert.equal((await call("knowledge", { action: "rollback" })).rolled_back_to, `${installed.version} (${installed.origin})`);
      assert.deepEqual((await call("knowledge", { action: "status", check: false })).installed, installed);
      assert.equal(JSON.parse(fs.readFileSync(pointer, "utf8")).directory, before.directory ?? before.version);
      assert.deepEqual(hashes(original), content);
      assert.equal((await call("knowledge", { action: "search", query: "@Local", limit: 1 })).pack, installed.version);
    });
  }
  if (phase === "emulator") {
    const name = `deveco_remaining_${Date.now()}`;
    const before = (await call("emulator", { action: "list", details: true })).emulators;
    fs.writeFileSync(path.join(directory, `${run}-instances.json`), JSON.stringify(before, null, 2));
    let target;
    await check("emulator.license-idempotent", async () => assert.equal((await call("emulator", { action: "license" })).accepted, true));
    await check("emulator.create", async () => {
      assert.equal((await call("emulator", { action: "create", name, device_type: "foldable", os_version: "HarmonyOS 7.0.0(26.0.0)", auto_accept_license: false })).created, name);
      const d = (await call("emulator", { action: "list", details: true })).emulators.find((e) => e.name === name);
      assert.equal(d.deviceType, "foldable"); assert.equal(d.isRunning, "false");
    });
    await check("emulator.start-coldboot", async () => {
      const d = await call("emulator", { action: "start", name, boot_mode: "coldboot", auto_accept_license: false });
      assert.equal(d.boot_completed, true); assert.equal(d.started, name); target = d.target;
      assert.ok(target);
      assert.equal((await call("device", { action: "shell", target, command: "param get ohos.qemu.hvd.name" })).output.trim(), name);
    });
    await check("emulator.reject-delete-running", async () => {
      const d = await raw("emulator", { action: "delete", name });
      assert.equal(d.isError, true); assert.equal(d.data.error.code, "CONFLICT");
    });
    await check("emulator.single-name-and-names-equivalent", async () => {
      const one = await call("emulator", { action: "start", name });
      const many = await call("emulator", { action: "start", names: [name] });
      assert.equal(one.already_running, true); assert.deepEqual(many, one);
    });
    await check("emulator.scenario-fold-real-screen", async () => {
      assert.ok(target, "start must succeed first");
      const sizes = [];
      for (const state of ["close", "open"]) {
        const d = await call("emulator", { action: "scenario", name, scenario: "fold", state });
        assert.equal(d.applied, "fold"); assert.equal(d.accepted, true);
        const screen = (await call("device", { action: "info", target })).screen;
        assert.ok(screen.width > 0 && screen.height > 0); sizes.push(screen);
      }
      assert.notDeepEqual(sizes[0], sizes[1], "fold must actually change the display dimensions");
    });
    await check("emulator.stop", async () => {
      assert.equal((await call("emulator", { action: "stop", name })).stopped, name);
      assert.equal((await call("emulator", { action: "list" })).emulators.find((e) => e.name === name).running, false);
      if (target) assert.equal((await call("device", { action: "list" })).devices.some((d) => d.target === target), false);
    });
    await check("emulator.delete", async () => {
      assert.equal((await call("emulator", { action: "delete", name })).deleted, name);
      const after = (await call("emulator", { action: "list", details: true })).emulators;
      assert.deepEqual(after, before, "existing instances and their settings must stay intact");
    });
  }
  if (phase === "skills") {
    const root = process.env.AUDIT_SKILLS;
    assert.ok(root && path.isAbsolute(root), "AUDIT_SKILLS must be explicitly chosen by the user");
    const before = globalConfigs(), destination = path.join(root, run);
    fs.mkdirSync(destination, { recursive: true });
    const source = path.resolve("knowledge/skills"), bundled = fs.readdirSync(source).sort();
    await check("skills.export-full-content", async () => {
      const d = await call("skills", { action: "export", path: path.join(destination, "exported") });
      assert.deepEqual(d.exported.sort(), bundled);
      assert.deepEqual(hashes(d.directory), hashes(source));
    });
    for (const host of ["codex", "opencode"]) {
      const project = path.join(destination, host), skills = path.join(project, "skills");
      const file = path.join(project, host === "codex" ? ".codex/config.toml" : ".opencode/opencode.json");
      const sentinel = host === "codex" ? '[mcp_servers.audit_preserved]\ncommand = "node"\nargs = ["--version"]\n'
        : JSON.stringify({ mcp: { audit_preserved: { type: "local", command: ["node", "--version"], enabled: false } } });
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, sentinel);
      await check(`skills.install_mcp-${host}`, async () => {
        const d = await call("skills", { action: "install_mcp", host, scope: "project", project });
        assert.equal(d.file, file); assert.equal(d.written, true);
        const text = fs.readFileSync(file, "utf8");
        if (host === "codex") assert.ok(text.startsWith(sentinel));
        else assert.deepEqual(JSON.parse(text).mcp.audit_preserved, JSON.parse(sentinel).mcp.audit_preserved);
        const again = await call("skills", { action: "install_mcp", host, scope: "project", project });
        assert.equal(again.written, false); assert.equal(fs.readFileSync(file, "utf8"), text);
        const args = host === "codex" ? ["mcp", "get", "deveco", "--json"] : ["mcp", "list"];
        const output = execFileSync(host, args, { cwd: project, encoding: "utf8", timeout: 120000 });
        fs.writeFileSync(path.join(directory, `${run}-${host}-registration.txt`), output);
        assert.match(output, /deveco/);
        if (host === "opencode") assert.match(output, /connected/);
        else assert.equal(JSON.parse(output).transport.args[0], path.resolve("bin/deveco-mcp.mjs"));
        const hostText = fs.readFileSync(file, "utf8");
        fs.writeFileSync(path.join(directory, `${run}-${host}-after-host.txt`), hostText);
        const afterHost = await call("skills", { action: "install_mcp", host, scope: "project", project });
        assert.equal(afterHost.written, false); assert.equal(fs.readFileSync(file, "utf8"), hostText);
      });
      await check(`skills.init-${host}`, async () => {
        const d = await call("skills", { action: "init", host, scope: "project", project, path: skills });
        assert.equal(d.skills.directory, skills); assert.deepEqual(hashes(skills), hashes(source));
        assert.equal(d.mcp.written, false);
        const forced = await call("skills", { action: "install_mcp", host, scope: "project", project, force: true });
        assert.equal(forced.written, true);
        const text = fs.readFileSync(file, "utf8");
        if (host === "codex") assert.ok(text.startsWith(sentinel));
        else assert.deepEqual(JSON.parse(text).mcp.audit_preserved, JSON.parse(sentinel).mcp.audit_preserved);
      });
    }
    await check("skills.market-install-uninstall", async () => {
      const found = await call("skills", { action: "search", query: "ArkUI", limit: 5 });
      assert.ok(found.skills.length > 0);
      const name = found.skills[0].name, market = path.join(destination, "market");
      const installed = await call("skills", { action: "install", name, path: market });
      assert.equal(installed.installed, name); assert.equal(installed.directory, path.join(market, name));
      const content = fs.readFileSync(path.join(installed.directory, "SKILL.md"), "utf8");
      assert.match(content, /^---/); assert.ok(content.length > 100);
      fs.writeFileSync(path.join(directory, `${run}-market-hashes.json`), JSON.stringify(hashes(installed.directory), null, 2));
      const removed = await call("skills", { action: "uninstall", name, path: market });
      assert.equal(removed.removed, name); assert.equal(fs.existsSync(installed.directory), false);
      const absent = await raw("skills", { action: "uninstall", name, path: market });
      assert.equal(absent.isError, true); assert.equal(absent.data.error.code, "NOT_FOUND");
    });
    await check("skills.global-configs-unchanged", async () => assert.deepEqual(globalConfigs(), before));
  }
} finally {
  await client.close();
}
if (results.some((r) => r.status !== "passed")) process.exitCode = 1;
