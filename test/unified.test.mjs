import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getEventListeners } from "node:events";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  listScripts, parseScriptOutput, registeredScriptEnvironment, runRegisteredScript,
} from "../src/script-registry.mjs";
import { arktsCheckStatus, runArktsCheck } from "../src/arkts-check.mjs";
import { resolveDevecoHome, resolveDevecoToolchain, resolveHdcPath } from "../src/config.mjs";
import {
  apiCompatibilityCheck, applyChanges, buildArgs, buildProject,
  devecoCliFailureMessage, projectSync, startApp,
} from "../src/deveco-cli.mjs";
import {
  cliAuth, codeLint, deviceInfo, emulatorManage, emulatorScenario,
  harmonyDocs, signatureGenerate, uiControl, uiInspect,
} from "../src/deveco-official.mjs";
import { closeHotReload, hotReload } from "../src/hotreload.mjs";
import { deleteCredential, readCredential, writeCredential } from "../src/modules/credential-store.mjs";
import { readTar } from "../src/device-tar.mjs";
import { withUitestLock, lockInternals } from "../src/device-lock.mjs";
import { analyseDump, dumpSignatures, flattenDump, readSelector } from "../src/device-dump.mjs";
import {
  cleanupUiTemporaryFiles, removeUiTemporaryFile, uiFind, uiObserve, uiSnapshot, uiTap,
} from "../src/device-ui.mjs";
import { hdcFailureMessage, hdcLog, hdcStatus, runHdc } from "../src/hdc-log.mjs";
import { getHover, goToDeclaration, lspStatus, resetLsp } from "../src/lsp.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// A few tests need a real DevEco Studio SDK on this machine: the ArkTS linter resolves its rule
// set out of it, hdc ships inside its toolchain, and detect_sdk reads its sdk-pkg.json. CI runners
// and contributors without DevEco installed must not see those as failures, so they announce
// themselves as skipped instead. Everything else -- including the HDC tests, which drive a fake
// hdc through HDC_PATH -- runs anywhere.
//
// Five tests need it. An earlier pass claimed four, measured by pointing DEVECO_HOME at an empty
// directory on macOS. That proxy was not faithful -- the linter still succeeded there while it
// fails on Linux -- so the stock-project test slipped through and turned CI red on Node 20 and 22.
// The count now comes from the real CI run rather than from a local simulation, and the probe
// below reads the SDK itself: sdk-pkg.json is what detect_sdk loads, the linter resolves its rule
// set beside it, and hdc ships under the same tree. Probing one tool inside the SDK is exactly how
// the stock-project test came to look runnable on a machine where it was not.
const DEVECO_SDK = (() => {
  const home = resolveDevecoHome().path;
  return Boolean(home) && fsSync.existsSync(path.join(home, "sdk", "default", "sdk-pkg.json"));
})();
const NEEDS_DEVECO_SDK = DEVECO_SDK ? false : "requires a local DevEco Studio SDK";

async function makeFakeHdc(body) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-hdc-test-"));
  const executable = path.join(directory, "hdc");
  await fs.writeFile(executable, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { directory, executable };
}

// Like makeFakeHdc, but keeps every invocation's argv so a test can assert on what was actually
// sent to the device rather than only on what came back. One argv element per line, invocations
// separated by ===, so an element containing a space stays one element.
async function makeRecordingHdc(body) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-hdc-test-"));
  const executable = path.join(directory, "hdc");
  const argvLog = path.join(directory, "argv.log");
  await fs.writeFile(
    executable,
    `#!/bin/sh\n{ printf '===\\n'; printf '%s\\n' "$@"; } >> '${argvLog}'\n${body}\n`,
    { mode: 0o755 },
  );
  return {
    directory,
    executable,
    async invocations() {
      const text = await fs.readFile(argvLog, "utf8").catch(() => "");
      return text
        .split("===\n")
        .filter((chunk) => chunk.trim())
        .map((chunk) => chunk.split("\n").filter(Boolean));
    },
  };
}

/** A hilog record as the device prints it; the collect path keys off this shape. */
function hilogRecord(message) {
  return `08-14 09:52:21.235 13128 13128 I A00F00/com.example.app/Tag: ${message}`;
}

/** Render text as one /bin/sh single-quoted word, so a fixture can emit an apostrophe. */
function shQuote(text) {
  return `'${text.split("'").join("'\\''")}'`;
}

async function withHdcPath(executable, operation) {
  const previous = process.env.HDC_PATH;
  process.env.HDC_PATH = executable;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.HDC_PATH;
    else process.env.HDC_PATH = previous;
  }
}

test("the script registry exposes the allowlisted Skill scripts", () => {
  const scripts = listScripts();
  assert.equal(scripts.length, 7);
  assert.deepEqual(scripts.map((script) => script.id), [
    "copy_template",
    "detect_sdk",
    "collect_hilog",
    "fetch_faultlog",
    "jscrash_report",
    "parse_jscrash_log",
    "probe_faultlogger",
  ]);
  assert.ok(scripts.every((script) => script.file.startsWith("skills/")));
  // Every registered script must exist on disk; a typo in a path would otherwise only surface
  // when someone actually calls that script.
  for (const script of scripts) {
    assert.ok(fsSync.existsSync(path.resolve(script.file)), `${script.id} points at a missing file`);
  }
  assert.ok(scripts.every((script) => script.runtime === "node"));
});

test("registered scripts can discover DevEco's bundled hvigorw from a GUI host PATH", () => {
  const root = path.join(os.tmpdir(), "deveco studio with spaces");
  const toolchain = {
    paths: {
      hvigor: path.join(root, "tools", "hvigor", "bin", "hvigorw.js"),
      ohpm: path.join(root, "tools", "ohpm", "bin", "pm-cli.js"),
      node: path.join(root, "tools", "node", process.platform === "win32" ? "node.exe" : "bin/node"),
      hdc: path.join(root, "sdk", "default", "openharmony", "toolchains", process.platform === "win32" ? "hdc.exe" : "hdc"),
      emulator: path.join(root, "tools", "emulator", process.platform === "win32" ? "Emulator.exe" : "Emulator"),
    },
  };
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const env = registeredScriptEnvironment({ [pathKey]: "/host/bin" }, toolchain);
  const entries = env[pathKey].split(path.delimiter);

  assert.equal(entries[0], path.dirname(toolchain.paths.hvigor));
  assert.ok(entries.includes(path.dirname(toolchain.paths.node)));
  assert.ok(entries.includes(path.dirname(toolchain.paths.hdc)));
  assert.equal(entries.at(-1), "/host/bin");
  assert.equal(
    env.NODE_HOME,
    process.platform === "win32"
      ? path.dirname(toolchain.paths.node)
      : path.dirname(path.dirname(toolchain.paths.node)),
  );
});

test("registered scripts return parsed key/value output", async () => {
  const result = await runRegisteredScript("parse_jscrash_log", {
    args: {
      logText: "Error: TypeError: Cannot read property 'x' of undefined",
      source: "text",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.parsed.status, "detected");
  assert.equal(result.parsed.source, "text");
});

test("credentials are encrypted at rest and plaintext stores migrate automatically", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-credential-"));
  const file = path.join(directory, "auth.json");
  const previous = process.env.DEVECO_DISABLE_CREDENTIAL_KEYCHAIN;
  process.env.DEVECO_DISABLE_CREDENTIAL_KEYCHAIN = "1";
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_DISABLE_CREDENTIAL_KEYCHAIN;
    else process.env.DEVECO_DISABLE_CREDENTIAL_KEYCHAIN = previous;
    await fs.rm(directory, { recursive: true, force: true });
  });

  const secret = { jwtToken: "secret-jwt", refreshToken: "secret-refresh" };
  await writeCredential(file, secret);
  const stored = await fs.readFile(file, "utf8");
  assert.doesNotMatch(stored, /secret-jwt|secret-refresh/);
  assert.deepEqual(await readCredential(file), secret);

  await deleteCredential(file);
  await fs.writeFile(file, JSON.stringify(secret), { mode: 0o600 });
  assert.deepEqual(await readCredential(file), secret);
  assert.doesNotMatch(await fs.readFile(file, "utf8"), /secret-jwt|secret-refresh/);
  await deleteCredential(file);
  assert.equal(fsSync.existsSync(file), false);
  assert.equal(fsSync.existsSync(`${file}.key`), false);
});

test("non-interactive auth rejects an expired session without opening a browser", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-auth-home-"));
  t.after(async () => await fs.rm(home, { recursive: true, force: true }));
  const authFile = path.join(home, ".deveco-knowledge-mcp", "auth.json");
  const expiredPayload = Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url");
  const script = [
    `const { writeCredential } = await import(${JSON.stringify(new URL("../src/modules/credential-store.mjs", import.meta.url).href)});`,
    `const { ensureAccessToken } = await import(${JSON.stringify(new URL("../src/modules/auth.mjs", import.meta.url).href)});`,
    `await writeCredential(${JSON.stringify(authFile)}, { jwtToken: ${JSON.stringify(`x.${expiredPayload}.x`)}, accessToken: "stale", accessSavedAt: Date.now() });`,
    "try { await ensureAccessToken({ interactive: false }); process.exitCode = 2; }",
    "catch (error) { process.stdout.write(String(error.code)); }",
  ].join("\n");

  const outcome = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      env: { ...process.env, HOME: home, USERPROFILE: home, DEVECO_DISABLE_CREDENTIAL_KEYCHAIN: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(outcome.code, 0, outcome.stderr);
  assert.equal(outcome.stdout, "DEVECO_SESSION_EXPIRED");
});

test("local diagnostics dependencies are discoverable", { skip: NEEDS_DEVECO_SDK }, () => {
  assert.equal(arktsCheckStatus().installed, true);
  assert.equal(hdcStatus().installed, true);
});

test("LSP falls back from unsupported declaration and kills a server that misses its deadline", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-lsp-test-"));
  const source = path.join(directory, "Main.ets");
  const entry = path.join(directory, "fake-lsp.mjs");
  const methodLog = path.join(directory, "methods.log");
  await fs.writeFile(source, "const answer: number = 42;\n");
  const sourceUri = `file://${source}`;
  await fs.writeFile(entry, [
    'import fs from "node:fs";',
    "let pending = Buffer.alloc(0);",
    "function send(id, result) {",
    "  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result }));",
    "  process.stdout.write(`Content-Length: ${body.length}\\r\\n\\r\\n`);",
    "  process.stdout.write(body);",
    "}",
    "process.stdin.on('data', (chunk) => {",
    "  pending = Buffer.concat([pending, chunk]);",
    "  while (true) {",
    "    const headerEnd = pending.indexOf('\\r\\n\\r\\n');",
    "    if (headerEnd < 0) return;",
    "    const match = /Content-Length:\\s*(\\d+)/i.exec(pending.subarray(0, headerEnd).toString());",
    "    if (!match) process.exit(2);",
    "    const length = Number(match[1]);",
    "    const bodyStart = headerEnd + 4;",
    "    if (pending.length < bodyStart + length) return;",
    "    const message = JSON.parse(pending.subarray(bodyStart, bodyStart + length).toString());",
    "    pending = pending.subarray(bodyStart + length);",
    `    if (message.method) fs.appendFileSync(${JSON.stringify(methodLog)}, message.method + "\\n");`,
    "    if (message.id === undefined) { if (message.method === 'exit') process.exit(0); continue; }",
    "    if (message.method === 'initialize') send(message.id, { capabilities: { definitionProvider: true } });",
    `    else if (message.method === 'textDocument/definition') send(message.id, [{ uri: ${JSON.stringify(sourceUri)}, range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } } }]);`,
    "    else if (message.method === 'textDocument/hover') { /* intentionally never reply */ }",
    "    else if (message.method === 'shutdown') send(message.id, null);",
    "    else send(message.id, []);",
    "  }",
    "});",
  ].join("\n"));

  const previousEntry = process.env.ARKTS_LSP_ENTRY;
  const previousProject = process.env.PROJECT_PATH;
  process.env.ARKTS_LSP_ENTRY = entry;
  process.env.PROJECT_PATH = directory;
  await resetLsp();
  t.after(async () => {
    await resetLsp();
    if (previousEntry === undefined) delete process.env.ARKTS_LSP_ENTRY;
    else process.env.ARKTS_LSP_ENTRY = previousEntry;
    if (previousProject === undefined) delete process.env.PROJECT_PATH;
    else process.env.PROJECT_PATH = previousProject;
    await fs.rm(directory, { recursive: true, force: true });
  });

  const declaration = await goToDeclaration({ file: source, line: 1, column: 7, timeoutMs: 2000 });
  assert.match(declaration, /Declaration fallback via definition/);
  let methods = await fs.readFile(methodLog, "utf8");
  assert.match(methods, /textDocument\/definition/);
  assert.doesNotMatch(methods, /textDocument\/declaration/,
    "an unadvertised declaration method must not be sent to the server");

  const startedAt = Date.now();
  await assert.rejects(
    () => getHover({ file: source, line: 1, column: 7, timeoutMs: 1000 }),
    (error) => error.code === "LSP_TIMEOUT",
  );
  assert.ok(Date.now() - startedAt < 2500, "the MCP deadline must bound a stalled LSP call");
  assert.equal(lspStatus().running, false, "a timed-out server must be discarded, not reused");
  methods = await fs.readFile(methodLog, "utf8");
  assert.match(methods, /textDocument\/hover/);
});

test("unified MCP advertises scripts, diagnostics, LSP, and CodeGenie tools", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: REPO_ROOT,
    stderr: "ignore",
  });
  const client = new Client({ name: "deveco-tool-test", version: "0.1.0" });
  t.after(async () => {
    await transport.close();
  });
  await client.connect(transport);
  const result = await client.listTools();
  const names = new Set(result.tools.map((tool) => tool.name));
  for (const name of [
    "deveco_script_catalog", "deveco_script", "switch_cwd", "deveco_doctor",
    "arkts_check", "hdc_log", "find_references", "go_to_definition",
    "go_to_declaration", "get_hover", "list_symbols", "find_call_hierarchy", "lsp", "build_project",
    "project_sync", "api_compat_check", "apply_changes",
    "document_validate", "ui_snapshot", "ui_observe", "ui_find", "ui_tap", "ui_flow",
    "code_lint", "hot_reload", "harmony_docs", "device_info", "ui_inspect",
    "emulator_manage", "emulator_scenario", "app_signature", "deveco_cli_auth", "ui_control",
  ]) assert.ok(names.has(name), `missing tool ${name}`);
  assert.equal(result.tools.length, 44);
  assert.equal(result.tools.filter((tool) => tool.name === "check_ets_files").length, 1);
  for (const disabled of ["verify_ui", "save_ui_screenshot", "get_ui_verification_log"]) {
    assert.ok(!names.has(disabled), `disabled tool ${disabled} is still advertised`);
    const call = await client.callTool({ name: disabled, arguments: {} });
    assert.equal(call.isError, true);
    assert.equal(JSON.parse(call.content[0].text).code, "TOOL_DISABLED");
  }

  const catalog = await client.callTool({ name: "deveco_script_catalog", arguments: {} });
  const parsed = JSON.parse(catalog.content[0].text);
  assert.equal(parsed.count, 7);

  const flowValidation = await client.callTool({
    name: "ui_flow",
    arguments: {
      action: "validate",
      flow: {
        version: 1,
        id: "schema-probe",
        name: "Schema probe",
        app: { bundleName: "com.example.test", module: "entry", ability: "EntryAbility" },
        start: { mode: "restart" },
        variables: {},
        steps: [],
        assert: { visible: { key: "ready" }, timeoutMs: 1000 },
      },
    },
  });
  assert.notEqual(flowValidation.isError, true);
  assert.equal(JSON.parse(flowValidation.content[0].text).valid, true);

  const rejected = await client.callTool({
    name: "deveco_status", arguments: { surprise: "must never reach the handler" },
  });
  assert.equal(rejected.isError, true);
  const validation = JSON.parse(rejected.content[0].text);
  assert.equal(validation.code, "SCHEMA_VALIDATION_FAILED");
  assert.ok(validation.details.some((detail) => detail.keyword === "additionalProperties"));

  const incompleteLoginPoll = await client.callTool({
    name: "deveco_login", arguments: { action: "status" },
  });
  assert.equal(incompleteLoginPoll.isError, true);
  assert.equal(JSON.parse(incompleteLoginPoll.content[0].text).code, "SCHEMA_VALIDATION_FAILED");
});

test("a timed-out script takes its grandchildren with it", async () => {
  // Registered scripts shell out to hvigor, ohpm, hdc and Python workers. The timeout used to send
  // one SIGTERM to the direct child and return immediately, so those grandchildren survived every
  // timeout and piled up across a session. Verified against a real tree rather than a mock,
  // because what is being tested is process-group semantics, not our own bookkeeping.
  const { terminateProcessTree } = await import("../src/process-tree.mjs");

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-tree-"));
  // Parent ignores SIGTERM so the escalation to SIGKILL is what actually ends it.
  const parentScript = path.join(directory, "parent.mjs");
  const childScript = path.join(directory, "grandchild.mjs");
  await fs.writeFile(childScript, "setInterval(() => {}, 1000);\nconsole.log(process.pid);\n");
  await fs.writeFile(parentScript, [
    'import { spawn } from "node:child_process";',
    'process.on("SIGTERM", () => {});',
    `const kid = spawn(process.execPath, [${JSON.stringify(childScript)}], { stdio: "ignore" });`,
    "console.log(JSON.stringify({ parent: process.pid, grandchild: kid.pid }));",
    "setInterval(() => {}, 1000);",
  ].join("\n"));

  const child = spawn(process.execPath, [parentScript], { stdio: ["ignore", "pipe", "ignore"], detached: true });
  try {
    const pids = await new Promise((resolve, reject) => {
      let stdout = "";
      const timer = setTimeout(() => reject(new Error("the fixture never reported its pids")), 10000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        const line = stdout.split("\n").find((entry) => entry.trim().startsWith("{"));
        if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
      });
    });

    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    assert.ok(alive(pids.grandchild), "the fixture grandchild should be running before we start");

    terminateProcessTree(child, 300);
    await new Promise((resolve) => { setTimeout(resolve, 2000); });

    assert.equal(alive(pids.parent), false, "the direct child must be gone");
    assert.equal(alive(pids.grandchild), false, "the grandchild must go too, or hvigor daemons leak");
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* already reaped */ }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a timed-out DevEco CLI run does not leave its children behind", async () => {
  // build_project and start_app go through runDevecoCli, not the script registry, so fixing the
  // registry left this path still sending a single SIGTERM to the direct child. Upstream has no
  // timeout here at all -- runBundledDevecoCli is Bun.spawn plus await proc.exited -- so the
  // deadline, and the cleanup it makes necessary, are both this pack's own.
  const { runDevecoCli } = await import("../src/deveco-cli.mjs");

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-tree-"));
  const marker = path.join(directory, "child.pid");
  const fakeCli = path.join(directory, "cli.mjs");
  // Ignores SIGTERM and starts a child, mirroring a CLI whose hvigor front-end outlives a polite
  // signal. Writes the child's pid so the test can check the whole group actually went away.
  await fs.writeFile(fakeCli, [
    'import { spawn } from "node:child_process";',
    'import fs from "node:fs";',
    'process.on("SIGTERM", () => {});',
    'const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    `fs.writeFileSync(${JSON.stringify(marker)}, String(kid.pid));`,
    "setInterval(() => {}, 1000);",
  ].join("\n"));

  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = fakeCli;
  try {
    await assert.rejects(
      () => runDevecoCli([], { cwd: directory, timeoutMs: 1000 }),
      (error) => error.code === "DEVECO_CLI_TIMEOUT",
    );

    // Give the SIGTERM -> SIGKILL escalation time to land.
    await new Promise((resolve) => { setTimeout(resolve, 3000); });
    const childPid = Number(await fs.readFile(marker, "utf8"));
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    assert.equal(alive(childPid), false, "the CLI's child must not survive the timeout");
  } finally {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("DevEco CLI output is memory-bounded while its complete transcript is streamed to disk", async (t) => {
  const { combineOutput, runDevecoCli } = await import("../src/deveco-cli.mjs");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-output-"));
  const fakeCli = path.join(directory, "cli.mjs");
  await fs.writeFile(fakeCli, [
    'process.stdout.write("A".repeat(400000));',
    'process.stderr.write("B".repeat(350000));',
  ].join("\n"));
  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = fakeCli;
  let report;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    if (report?.logPath) await fs.rm(report.logPath, { force: true });
    await fs.rm(directory, { recursive: true, force: true });
  });

  report = await runDevecoCli([], { cwd: directory, timeoutMs: 5000 });
  assert.equal(report.outputTruncated, true);
  assert.ok(Buffer.byteLength(report.stdout) <= 256 * 1024);
  assert.ok(Buffer.byteLength(report.stderr) <= 256 * 1024);
  assert.ok(report.logPath && fsSync.existsSync(report.logPath));
  assert.ok((await fs.stat(report.logPath)).size > 750000,
    "the on-disk log must contain the complete output, not only the in-memory tail");
  assert.match(combineOutput(report), /Output truncated/);
  assert.match(combineOutput(report), new RegExp(report.logPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("the CLI and the MCP report the same doctor findings", async (t) => {
  // PACK.md told people to run `npm run doctor` to check DevEco Studio, HDC, the ArkTS checker
  // and login state, but the CLI only ever reported the environment and the script registry --
  // those checks existed solely in the MCP tool. Both now render one report; assert they agree.
  const cli = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/cli.mjs", "doctor"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.once("error", reject);
    child.once("close", () => resolve(JSON.parse(stdout)));
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: REPO_ROOT,
    stderr: "ignore",
  });
  const client = new Client({ name: "deveco-doctor-test", version: "0.1.0" });
  t.after(async () => { await transport.close(); });
  await client.connect(transport);
  const mcp = JSON.parse((await client.callTool({ name: "deveco_doctor", arguments: {} })).content[0].text);

  assert.deepEqual(Object.keys(cli).sort(), Object.keys(mcp).sort());
  for (const key of ["python", "arktsChecker", "devecoCli", "lsp", "hdc", "auth"]) {
    assert.ok(key in cli, `the CLI must report ${key}; PACK.md promises it`);
  }
  // Only the CodeGenie section may differ: the CLI does not start the child unless asked.
  assert.equal(cli.codegenie.available, "not probed");
  assert.deepEqual(cli.codegenie.advertised, mcp.codegenie.advertised);
});

test("the static proxy table still matches what the CodeGenie child advertises", async () => {
  // tools/list is answered from a hand-copied table so a stalled child cannot delay discovery.
  // That table is only safe while it agrees with the child; if CodeGenie changes a schema, hosts
  // would otherwise keep calling the old shape. Fail here rather than in a host.
  const { PROXIED_CODEGENIE_TOOLS } = await import("../src/codegenie-tools.mjs");
  const { getCodeGenieTools, closeCodeGenie } = await import("../src/codegenie-client.mjs");

  let live;
  try {
    live = await getCodeGenieTools();
  } catch (error) {
    // The child is optional; a machine without it must not fail the suite on drift it cannot see.
    assert.equal(error.code, "CODEGENIE_UNAVAILABLE");
    return;
  } finally {
    await closeCodeGenie().catch(() => {});
  }

  for (const expected of PROXIED_CODEGENIE_TOOLS) {
    const actual = live.find((tool) => tool.name === expected.name);
    assert.ok(actual, `CodeGenie no longer advertises ${expected.name}`);
    assert.deepEqual(
      JSON.parse(JSON.stringify(actual)),
      JSON.parse(JSON.stringify(expected)),
      `${expected.name} drifted from src/codegenie-tools.mjs`,
    );
  }
});

test("ArkTS checker and check_ets_files accept a stock HarmonyOS project", { skip: NEEDS_DEVECO_SDK }, async () => {
  const templatePath = path.resolve("test/fixtures/harmony-app");
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-tool-test-"));
  await fs.cp(templatePath, projectPath, { recursive: true });
  const file = path.join(projectPath, "entry/src/main/ets/pages/Index.ets");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: path.resolve("."),
    stderr: "ignore",
  });
  const client = new Client({ name: "deveco-tool-check-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    await client.callTool({ name: "switch_cwd", arguments: { project_path: projectPath } });
    const result = await client.callTool({ name: "arkts_check", arguments: { files: [file] } });
    assert.equal(result.isError, false);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.success, true);
    assert.equal(payload.summary.errorCount, 0);
    assert.equal(payload.checkKind, "static-precheck");
    assert.equal(payload.compilationVerified, false);
    assert.match(payload.verificationHint, /build_project/);

    const compatibleResult = await client.callTool({ name: "check_ets_files", arguments: { files: [file] } });
    assert.equal(compatibleResult.isError, false);
    const compatiblePayload = JSON.parse(compatibleResult.content[0].text);
    assert.equal(compatiblePayload.success, true);
    assert.equal(compatiblePayload.summary.errorCount, 0);

    const missingResult = await client.callTool({
      name: "check_ets_files",
      arguments: { files: [path.join(projectPath, "Missing.ets")] },
    });
    assert.equal(missingResult.isError, true);
    const missingPayload = JSON.parse(missingResult.content[0].text);
    assert.equal(missingPayload.code, "ARKTS_FILE_NOT_FOUND");
  } finally {
    await transport.close();
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test("ArkTS checker returns structured diagnostics for invalid source", { skip: NEEDS_DEVECO_SDK }, async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-tool-invalid-"));
  await fs.cp(path.resolve("test/fixtures/harmony-app"), projectPath, { recursive: true });
  const brokenFile = path.join(projectPath, "entry/src/main/ets/pages/Broken.ets");
  await fs.writeFile(
    brokenFile,
    "@Entry\n@Component\nstruct Broken {\n  build() {\n    Image($r('sys.media.__deveco_tool_missing_resource__'))\n  }\n}\n",
  );
  try {
    const payload = await runArktsCheck({
      files: [brokenFile],
      project_path: projectPath,
      timeoutMs: 180000,
    });
    assert.equal(payload.success, false);
    assert.ok(payload.summary.errorCount > 0);
    assert.ok(payload.errors.some((diagnostic) => diagnostic.file.endsWith("Broken.ets")));
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test("a project-wide scan finds errors in a multi-module project", { skip: NEEDS_DEVECO_SDK }, async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-tool-multimodule-"));
  await fs.cp(path.resolve("test/fixtures/harmony-app"), projectPath, { recursive: true });
  // Reshape the single-module template into a multi-module layout. `entry/` at
  // the project root is the only place the upstream checker ever looked, so a
  // project without it used to report a clean result no matter what it held.
  await fs.mkdir(path.join(projectPath, "commons"), { recursive: true });
  await fs.rename(path.join(projectPath, "entry"), path.join(projectPath, "commons", "core"));
  const profile = path.join(projectPath, "build-profile.json5");
  await fs.writeFile(profile, (await fs.readFile(profile, "utf8")).replace('"./entry"', '"./commons/core"'));
  await fs.writeFile(
    path.join(projectPath, "commons/core/src/main/ets/pages/Broken.ets"),
    "export class Broken {\n  static run(): void {\n    let loose: any = 1;\n    console.log(loose);\n  }\n}\n",
  );

  try {
    const payload = await runArktsCheck({ project_path: projectPath, timeoutMs: 600000 });
    assert.equal(payload.scan.mode, "project");
    assert.deepEqual(payload.scan.sourceRoots, [path.join("commons", "core", "src", "main", "ets")]);
    assert.ok(payload.checkedFileCount > 0, "the scan must resolve files to check");
    assert.equal(payload.internalError, undefined);
    assert.equal(payload.success, false);
    assert.ok(payload.errors.some((diagnostic) => diagnostic.file.endsWith("Broken.ets")
      && diagnostic.rule === "arkts-no-any-unknown"));
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test("a project-wide scan refuses to report success when it resolves no sources", async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-tool-nosources-"));
  try {
    await assert.rejects(
      () => runArktsCheck({ project_path: projectPath }),
      (error) => error.code === "ARKTS_NO_FILES_DISCOVERED",
    );
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test("removed non-official scripts are rejected by the registry", async () => {
  await assert.rejects(
    () => runRegisteredScript("non_official_script", { argv: ["--help"] }),
    (error) => error.code === "UNKNOWN_SCRIPT",
  );
});

test("script output parsing ignores narrative lines that look like fields", () => {
  const parsed = parseScriptOutput([
    "status: detected",
    "error_message: Cannot read property 'cardList' of undefined",
    "",
    "Top stack:",
    "    at buildCardList (entry/src/main/ets/pages/CardCatalog.ets:142:19)",
    "08-02 14:34:32.838  2047 59682 I C02D13/hdcd/HDC_LOG: FetchCommand channelId:2454900664",
    "Module name:com.example.app",
    "next_action: inspect the anchor",
  ].join("\n"));

  assert.deepEqual(Object.keys(parsed), ["status", "error_message", "next_action"]);
  assert.equal(parsed.error_message, "Cannot read property 'cardList' of undefined");
});

test("detect_sdk runs as a script instead of exiting silently", { skip: NEEDS_DEVECO_SDK }, async () => {
  const result = await runRegisteredScript("detect_sdk", {});
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined, "the script must write its result to stdout");
  assert.ok(Number.isInteger(result.parsed?.apiLevel));
  assert.ok(result.parsed.sdkVersion);
});

test("crash parsing reports the declared message, not the nearest crash-ish line", async () => {
  const crashLog = [
    "Module name:com.example.app",
    "Pid:23145",
    "Reason:TypeError",
    "Error name:TypeError",
    "Error message:Cannot read property 'cardList' of undefined",
    "Stacktrace:",
    "    at buildCardList (entry/src/main/ets/pages/CardCatalog.ets:142:19)",
  ].join("\n");

  const detected = await runRegisteredScript("parse_jscrash_log", { argv: ["--log-text", crashLog] });
  assert.equal(detected.parsed.status, "detected");
  assert.equal(detected.parsed.error_message, "Cannot read property 'cardList' of undefined");
  assert.equal(detected.parsed.suspected_file, "entry/src/main/ets/pages/CardCatalog.ets:142:19");

  // A snapshot with no crash must not promote an unrelated trailing log line.
  const clean = await runRegisteredScript("parse_jscrash_log", {
    argv: ["--log-text", "08-02 14:29:47 I wifi: AIWifiInfo:txRate:24747\n08-02 14:29:48 I powermgr: lux=17.9"],
  });
  assert.equal(clean.parsed.status, "no_crash_signature");
  assert.equal(clean.parsed.error_message, "(not found)");
});

test("build_project keeps the parameter contract the CodeGenie tool had", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-stub-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  // Echo the arguments so the orchestration can be asserted without a real build.
  await fs.writeFile(entry, "console.log(JSON.stringify(process.argv.slice(2)));\n");
  await fs.writeFile(path.join(project, "build-profile.json5"), '{"modules": []}\n');

  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });

  const logPath = path.join(project, "build.log");
  const report = await buildProject({
    project_path: project,
    module: "entry@default",
    build_mode: "debug",
    clean: true,
    log_path: logPath,
    enable_inspector_source_jump: true,
  });

  // clean means clean *and then* build, unlike upstream's clean-only.
  assert.ok(report.includes('["build","clean"]'), "clean must run first");
  assert.ok(
    report.includes('["build","--modules","entry@default","--build-mode","debug"]'),
    "the build must still run after the clean",
  );
  // Capability gaps are announced rather than silently dropped.
  assert.ok(report.includes("enable_inspector_source_jump has no DevEco CLI equivalent"));
  assert.ok((await fs.readFile(logPath, "utf8")).includes("build"), "log_path must receive the transcript");

  // The single-value `module` and the `modules` array are equivalent.
  assert.deepEqual(
    buildArgs({ modules: ["entry@default"], build_mode: "debug" }),
    ["build", "--modules", "entry@default", "--build-mode", "debug"],
  );
});

test("build_project background jobs finish without holding one MCP request open", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-job-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-job-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  await fs.writeFile(entry, "setTimeout(() => console.log('job finished'), 80);\n");
  await fs.writeFile(path.join(project, "build-profile.json5"), '{"modules": []}\n');

  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });

  const { getBuildProjectJob, startBuildProjectJob } = await import("../src/deveco-cli.mjs");
  const started = startBuildProjectJob({ project_path: project });
  assert.equal(started.status, "running");
  assert.ok(started.job_id);
  assert.equal(started.next_action.arguments.wait_ms, 20000);

  const finished = await getBuildProjectJob(started.job_id, 1000);
  assert.equal(finished.status, "succeeded");
  assert.match(finished.report, /job finished/);
});

test("build_project background jobs can terminate their DevEco CLI process tree", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-cancel-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-cancel-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  await fs.writeFile(entry, "setInterval(() => {}, 1000);\n");
  await fs.writeFile(path.join(project, "build-profile.json5"), '{"modules": []}\n');

  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });

  const { cancelBuildProjectJob, startBuildProjectJob } = await import("../src/deveco-cli.mjs");
  const started = startBuildProjectJob({ project_path: project, timeoutMs: 60000 });
  const cancelled = await cancelBuildProjectJob(started.job_id);
  assert.equal(cancelled.status, "cancelled");
  assert.match(cancelled.message, /process tree was terminated/);
});

test("start_app deploys only the explicitly selected Entry module", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-start-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  const argvLog = path.join(directory, "argv.log");
  await fs.writeFile(entry, [
    'import fs from "node:fs";',
    `fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
    'console.log("Application launched successfully");',
  ].join("\n"));

  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });

  const report = await startApp({
    project_path: project,
    hvd: "device-1",
    module: "default",
    target: "default",
    ability: "EntryAbility",
  });
  const invocations = (await fs.readFile(argvLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.deepEqual(invocations, [[
    "run", "--skip-build", "--device", "device-1",
    "--module", "default@default", "--ability", "EntryAbility",
  ]]);
  assert.match(report, /Deployed modules: default@default/);
  assert.doesNotMatch(report, /watch/);
});

test("start_app requires a module instead of deploying multiple Entry modules", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-start-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  const argvLog = path.join(directory, "argv.log");
  await fs.writeFile(entry, [
    'import fs from "node:fs";',
    `fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
    'console.log("Specify module(s) to run. Available runnable modules:\\n- default\\n- watch");',
  ].join("\n"));

  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });

  await assert.rejects(
    () => startApp({ project_path: project, hvd: "device-1" }),
    (error) => error.code === "DEVECO_CLI_MODULE_REQUIRED"
      && /default, watch/.test(error.message),
  );
  const invocations = (await fs.readFile(argvLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(invocations, [["run", "--skip-build", "--device", "device-1"]]);
});

test("apply_changes scopes the CLI apply manifest to exactly one Entry module", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-apply-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  const log = path.join(directory, "apply.json");
  await fs.mkdir(path.join(project, "entry", "src"), { recursive: true });
  await fs.writeFile(path.join(project, "entry", "src", "Main.ets"), "@Entry struct Main {}\n");
  await fs.writeFile(entry, [
    'import fs from "node:fs";',
    'import path from "node:path";',
    'const args = process.argv.slice(2);',
    'const name = args[args.indexOf("--apply") + 1];',
    `fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, manifest: fs.readFileSync(path.join(process.cwd(), ".hvigor", name), "utf8") }));`,
    'console.log("Apply completed successfully");',
  ].join("\n"));

  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });

  const report = await applyChanges({
    project_path: project,
    hvd: "device-1",
    files: ["entry/src/Main.ets"],
    module: "entry",
    target: "default",
    product: "default",
  });
  const invocation = JSON.parse(await fs.readFile(log, "utf8"));
  assert.deepEqual(invocation.manifest, "entry/src/Main.ets\n");
  assert.deepEqual(invocation.args.slice(0, 7), ["run", "--device", "device-1", "--module", "entry@default", "--product", "default"]);
  assert.ok(invocation.args.includes("--apply"));
  assert.equal(invocation.args.filter((arg) => arg === "--module").length, 1);
  assert.match(report, /Applied 1 changed file/);
  const hvigorFiles = await fs.readdir(path.join(project, ".hvigor"));
  assert.deepEqual(hvigorFiles, [], "the temporary apply manifest must be removed");
});

test("apply_changes refuses an ambiguous multi-Entry project before creating an apply manifest", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-apply-modules-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  await fs.mkdir(path.join(project, "entry", "src"), { recursive: true });
  await fs.writeFile(path.join(project, "entry", "src", "Main.ets"), "@Entry struct Main {}\n");
  await fs.writeFile(entry,
    'console.log("Specify module(s) to run. Available runnable modules:\\n- entry\\n- watch");\n');
  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });

  await assert.rejects(
    () => applyChanges({
      project_path: project, hvd: "device-1", files: ["entry/src/Main.ets"],
    }),
    (error) => error.code === "DEVECO_CLI_MODULE_REQUIRED" && /entry, watch/.test(error.message),
  );
  assert.equal(fsSync.existsSync(path.join(project, ".hvigor")), false,
    "ambiguity must be rejected before a manifest can trigger any apply operation");
});

test("apply_changes relaunches the same selected module after a failed apply", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-apply-recover-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  const argvLog = path.join(directory, "argv.log");
  await fs.mkdir(path.join(project, "entry", "src"), { recursive: true });
  await fs.writeFile(path.join(project, "entry", "src", "Main.ets"), "@Entry struct Main {}\n");
  await fs.writeFile(entry, [
    'import fs from "node:fs";',
    'const args = process.argv.slice(2);',
    `fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(args) + "\\n");`,
    'if (args.includes("--apply")) console.log("error: failed to install changed application");',
    'else console.log("Application launched");',
  ].join("\n"));
  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });

  await assert.rejects(
    () => applyChanges({
      project_path: project,
      hvd: "device-1",
      files: ["entry/src/Main.ets"],
      module: "entry",
      target: "default",
      product: "default",
      ability: "EntryAbility",
    }),
    (error) => error.code === "DEVECO_CLI_APPLY_FAILED"
      && /previous installed app was relaunched/.test(error.message),
  );
  const invocations = (await fs.readFile(argvLog, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(invocations.length, 2);
  assert.ok(invocations[0].includes("--apply"));
  assert.deepEqual(invocations[1], [
    "run", "--skip-build", "--device", "device-1", "--module", "entry@default",
    "--product", "default", "--ability", "EntryAbility",
  ]);
  assert.deepEqual(await fs.readdir(path.join(project, ".hvigor")), []);
});

test("api_compat_check emits the DevEco CLI 1.3 compat command", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-compat-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-cli-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  await fs.writeFile(entry, "console.log(JSON.stringify(process.argv.slice(2)));\n");
  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });
  const report = await apiCompatibilityCheck({
    project_path: project,
    source_version: "12",
    target_version: "18",
    modules: ["entry"],
    format: "json",
  });
  assert.match(report, /\["check","compat","--source-version","12","--target-version","18","--modules","entry","--format","json"\]/);
});

test("project_sync uses DevEco Studio's bundled ohpm and Hvigor entries", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-home-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-project-"));
  const node = path.join(home, "tools", "node", process.platform === "win32" ? "node.exe" : "bin/node");
  const ohpm = path.join(home, "tools", "ohpm", "bin", "pm-cli.js");
  const hvigor = path.join(home, "tools", "hvigor", "bin", "hvigorw.js");
  await fs.mkdir(path.dirname(node), { recursive: true });
  await fs.mkdir(path.dirname(ohpm), { recursive: true });
  await fs.mkdir(path.dirname(hvigor), { recursive: true });
  await fs.symlink(process.execPath, node);
  await fs.writeFile(ohpm, 'console.log("ohpm", ...process.argv.slice(2));\n');
  await fs.writeFile(hvigor, 'console.log("hvigor", ...process.argv.slice(2));\n');

  const previous = process.env.DEVECO_HOME;
  process.env.DEVECO_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_HOME;
    else process.env.DEVECO_HOME = previous;
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });
  const report = await projectSync({ project_path: project, product: "wearable" });
  assert.match(report, /ohpm install --all/);
  assert.match(report, /hvigor --sync -p product=wearable --analyze=normal --parallel --incremental --no-daemon/);
});

test("CLT layout is resolved for project sync, SDK, HDC, and emulator paths", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-clt-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-clt-project-"));
  await fs.writeFile(path.join(root, "version.txt"), "# Version: 26.0.0\n");
  const node = path.join(root, "tool", "node", process.platform === "win32" ? "node.exe" : "bin/node");
  const ohpm = path.join(root, "ohpm", "bin", "pm-cli.js");
  const hvigor = path.join(root, "hvigor", "bin", "hvigorw.js");
  const hdc = path.join(root, "sdk", "default", "openharmony", "toolchains", process.platform === "win32" ? "hdc.exe" : "hdc");
  const sdkPkg = path.join(root, "sdk", "default", "sdk-pkg.json");
  await fs.mkdir(path.dirname(node), { recursive: true });
  await fs.mkdir(path.dirname(ohpm), { recursive: true });
  await fs.mkdir(path.dirname(hvigor), { recursive: true });
  await fs.mkdir(path.dirname(hdc), { recursive: true });
  await fs.symlink(process.execPath, node);
  await fs.writeFile(ohpm, 'console.log("clt-ohpm", ...process.argv.slice(2));\n');
  await fs.writeFile(hvigor, 'console.log("clt-hvigor", ...process.argv.slice(2));\n');
  await fs.writeFile(hdc, "fake hdc\n");
  await fs.writeFile(sdkPkg, JSON.stringify({ data: { apiVersion: 24, platformVersion: "6.1.1" } }));
  const previous = process.env.DEVECO_CLI_CLT_PATH;
  const previousStudio = process.env.DEVECO_CLI_STUDIO_PATH;
  process.env.DEVECO_CLI_CLT_PATH = root;
  delete process.env.DEVECO_CLI_STUDIO_PATH;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_CLT_PATH;
    else process.env.DEVECO_CLI_CLT_PATH = previous;
    if (previousStudio === undefined) delete process.env.DEVECO_CLI_STUDIO_PATH;
    else process.env.DEVECO_CLI_STUDIO_PATH = previousStudio;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });
  const resolved = resolveDevecoToolchain();
  assert.equal(resolved.kind, "clt");
  assert.equal(resolved.root, root);
  assert.equal(resolved.paths.node, path.join(root, "tool", "node", process.platform === "win32" ? "node.exe" : "bin/node"));
  assert.equal(resolved.paths.sdk, path.join(root, "sdk"));
  assert.equal(resolved.paths.hdc, path.join(root, "sdk", "default", "openharmony", "toolchains", process.platform === "win32" ? "hdc.exe" : "hdc"));
  assert.equal(resolved.paths.emulator, path.join(root, "emulator", process.platform === "win32" ? "Emulator.exe" : "Emulator"));
  const syncReport = await projectSync({ project_path: project });
  assert.match(syncReport, /clt-ohpm install --all/);
  assert.match(syncReport, /clt-hvigor --sync/);
  const sdkResult = await runRegisteredScript("detect_sdk", {});
  assert.equal(sdkResult.ok, true);
  assert.equal(sdkResult.parsed?.apiLevel, 24);
  assert.equal(resolveHdcPath(), hdc);
});

test("official DevEco wrappers preserve the 1.3.1 CLI command interfaces", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-official-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  const argvLog = path.join(directory, "argv.log");
  const stdinLog = path.join(directory, "stdin.log");
  await fs.writeFile(entry, [
    'import fs from "node:fs";',
    'const args = process.argv.slice(2);',
    `fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(args) + "\\n");`,
    'if (args[0] === "auth" && args[1] === "login") {',
    '  let input = "";',
    '  process.stdin.setEncoding("utf8");',
    '  for await (const chunk of process.stdin) input += chunk;',
    `  fs.writeFileSync(${JSON.stringify(stdinLog)}, input);`,
    '}',
    'console.log("ok");',
  ].join("\n"));
  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });

  await codeLint({ project_path: project, path: "entry", fix: true, incremental: true, config_path: "lint.json", product: "default", format: "json", output_path: "lint-report.json", limit: 50 });
  await harmonyDocs({ action: "catalog", project_path: project });
  await harmonyDocs({ action: "search", keywords: ["default"], project_path: project });
  await harmonyDocs({ action: "search", keywords: ["ArkUI", "animation"], catalog: "arkui", limit: 5, project_path: project });
  await harmonyDocs({ action: "read", document_id: "doc-1", project_path: project });
  await deviceInfo({ target: "device-1", project_path: project });
  await uiInspect({ action: "layout", hvd: "device-1", project_path: project });
  await uiInspect({ action: "layout", hvd: "device-1", id: "2", window: "7", depth: 4, mode: "simplified", project_path: project });
  await uiInspect({ action: "windows", hvd: "device-1", all: true, project_path: project });
  await uiControl({ action: "click", node_id: "button-1", window: "7", hvd: "device-1", project_path: project });
  await uiControl({ action: "drag", x: 1, y: 2, x2: 3, y2: 4, speed: 500, hvd: "device-1", project_path: project });
  await cliAuth({ action: "team_list", project_path: project });
  await cliAuth({ action: "login", project_path: project });
  await signatureGenerate({ project_path: project, force: true, team_id: "team-1", product: "default" });
  await emulatorManage({ action: "image_list", all: true, project_path: project });
  await emulatorManage({ action: "create", name: "phone-1", device_type: "phone", os_version: "6.0.0", force: true, project_path: project });
  await emulatorManage({ action: "image_download", device_type: "tablet", os_version: "6.0.0", force: true, project_path: project });
  await emulatorManage({ action: "license_accept", project_path: project });
  await emulatorScenario({ action: "battery", target: "phone-1", level: 42, project_path: project });
  await emulatorScenario({ action: "battery", target: "phone-1", status: "charging", project_path: project });
  await emulatorScenario({ action: "geolocation", target: "phone-1", longitude: 120.2, project_path: project });
  await emulatorScenario({ action: "sensor", target: "phone-1", heartrate: 80, project_path: project });

  const calls = (await fs.readFile(argvLog, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls, [
    ["check", "lint", "entry", "--fix", "--incremental", "--config-path", "lint.json", "--product", "default", "--format", "json", "--output-path", "lint-report.json", "--limit", "50"],
    ["docs", "catalog", "--format", "json"],
    ["docs", "search", "default", "--catalog", "all", "--format", "json"],
    ["docs", "search", "ArkUI", "animation", "--catalog", "arkui", "--format", "json", "--limit", "5"],
    ["docs", "read", "doc-1"],
    ["device", "view", "--target", "device-1", "--format", "json"],
    ["ui", "layout", "--device", "device-1", "--format", "json", "--mode", "simplified"],
    ["ui", "layout", "--device", "device-1", "--id", "2", "--window", "7", "--depth", "4", "--format", "json", "--mode", "simplified"],
    ["ui", "window", "list", "--device", "device-1", "--format", "json", "--all"],
    ["ui", "click", "--device", "device-1", "--id", "button-1", "--window", "7"],
    ["ui", "drag", "1", "2", "3", "4", "--device", "device-1", "--speed", "500"],
    ["auth", "team", "list"],
    ["auth", "login"],
    ["signature", "generate", "--force", "--team-id", "team-1", "--product", "default"],
    ["emulator", "image", "list", "--all", "--format", "json"],
    ["emulator", "create", "phone-1", "--device-type", "phone", "--os-version", "6.0.0", "--force"],
    ["emulator", "image", "download", "--device-type", "tablet", "--os-version", "6.0.0", "--force"],
    ["emulator", "license", "accept"],
    ["emulator", "battery", "--level", "42", "--target", "phone-1"],
    ["emulator", "battery", "--status", "charging", "--target", "phone-1"],
    ["emulator", "geolocation", "--longitude", "120.2", "--target", "phone-1"],
    ["emulator", "sensor", "--heartrate", "80", "--target", "phone-1"],
  ]);
  assert.equal(await fs.readFile(stdinLog, "utf8"), "\n");
});

test("official wrappers reject invalid option combinations before execution", async () => {
  await assert.rejects(() => uiInspect({ action: "layout", window: "7", all_windows: true }), /mutually exclusive/);
  await assert.rejects(() => uiControl({ action: "click" }), /require x\/y coordinates or node_id/);
  await assert.rejects(() => uiControl({ action: "click", x: 1, y: 2, node_id: "button" }), /mutually exclusive/);
  await assert.rejects(() => uiControl({ action: "text", text: "hello", window: "7" }), /window must be used with node_id/);
  await assert.rejects(() => uiControl({ action: "drag", x: 1, y: 2, x2: 3, y2: 4, speed: 100 }), /between 200 and 40000/);
  await assert.rejects(() => emulatorManage({ action: "start" }), /names must be a non-empty array/);
  await assert.rejects(() => emulatorManage({ action: "create", name: "phone", os_version: "6.0.0" }), /device_type/);
  await assert.rejects(() => emulatorManage({ action: "image_download", os_version: "6.0.0" }), /device_type/);
  await assert.rejects(() => emulatorManage({ action: "image_remove", os_version: "6.0.0" }), /device_type/);
  await assert.rejects(() => emulatorScenario({ action: "shake" }), /target is required/);
  await assert.rejects(() => emulatorScenario({ action: "battery", target: "phone", level: 50, status: "charging" }), /exactly one/);
  await assert.rejects(() => emulatorScenario({ action: "geolocation", target: "phone" }), /exactly one/);
  await assert.rejects(() => emulatorScenario({ action: "geolocation", target: "phone", longitude: 1, latitude: 2 }), /exactly one/);
  await assert.rejects(() => emulatorScenario({ action: "sensor", target: "phone", humidity: 50, temperature: 20 }), /exactly one/);
});

test("hot_reload owns a persistent watch process and applies a temporary manifest", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-hotreload-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-project-"));
  const entry = path.join(directory, "fake-cli.mjs");
  const log = path.join(directory, "argv.log");
  await fs.mkdir(path.join(project, "entry", "src"), { recursive: true });
  await fs.writeFile(path.join(project, "entry", "src", "Main.ets"), "@Entry struct Main {}\n");
  await fs.writeFile(entry, [
    'import fs from "node:fs";', 'import path from "node:path";',
    'const args = process.argv.slice(2);',
    `const log = ${JSON.stringify(log)};`,
    'const apply = args.indexOf("--hotreload-apply");',
    'const record = { args };',
    'if (apply >= 0) record.manifest = fs.readFileSync(path.join(process.cwd(), ".hvigor", args[apply + 1]), "utf8");',
    'fs.appendFileSync(log, JSON.stringify(record) + "\\n");',
    'if (args.includes("--hotreload") && !args.includes("stop")) { console.log("Hot-reload watch session active (socket persistent). Edit code"); setInterval(() => {}, 1000); }',
    'else if (apply >= 0 && process.env.DEVECO_FAKE_SIGNING_FAILURE === "1") { console.log("[HotReload] Signing prerequisites not met."); process.exitCode = 1; }',
    'else console.log("ok");',
  ].join("\n"));
  const previous = process.env.DEVECO_CLI_ENTRY;
  const previousSigningFailure = process.env.DEVECO_FAKE_SIGNING_FAILURE;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    await closeHotReload();
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY;
    else process.env.DEVECO_CLI_ENTRY = previous;
    if (previousSigningFailure === undefined) delete process.env.DEVECO_FAKE_SIGNING_FAILURE;
    else process.env.DEVECO_FAKE_SIGNING_FAILURE = previousSigningFailure;
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  });
  const started = await hotReload({ action: "start", project_path: project, hvd: "device-1", module: "entry", product: "default", timeoutMs: 5000 });
  assert.equal(started.active, true);
  const applied = await hotReload({ action: "apply", files: ["entry/src/Main.ets"], timeoutMs: 5000 });
  assert.deepEqual(applied.appliedFiles, ["entry/src/Main.ets"]);
  process.env.DEVECO_FAKE_SIGNING_FAILURE = "1";
  await assert.rejects(
    () => hotReload({ action: "apply", files: ["entry/src/Main.ets"], timeoutMs: 5000 }),
    (error) => error.code === "DEVECO_HOT_RELOAD_SIGNING_REQUIRED" && /app_signature/.test(error.message),
  );
  delete process.env.DEVECO_FAKE_SIGNING_FAILURE;
  const stopped = await hotReload({ action: "stop", timeoutMs: 5000 });
  assert.equal(stopped.stopped, true);
  const records = (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(records[0].args, ["run", "--device", "device-1", "--module", "entry", "--product", "default", "--hotreload"]);
  assert.equal(records[1].manifest, "entry/src/Main.ets\n");
  assert.deepEqual(records[1].args.slice(0, 6), ["run", "--device", "device-1", "--module", "entry", "--hotreload-apply"]);
  assert.match(records[1].args[6], /^deveco-tool-hotreload-.+\.txt$/);
  assert.deepEqual(records[2].args.slice(0, 6), ["run", "--device", "device-1", "--module", "entry", "--hotreload-apply"]);
  assert.deepEqual(records[3].args, ["run", "--hotreload", "stop"]);
  assert.deepEqual(await fs.readdir(path.join(project, ".hvigor")), []);
});

test("DevEco CLI failures are errors even when the process exits zero", () => {
  assert.equal(devecoCliFailureMessage({ exitCode: 0, stdout: "Build completed successfully", stderr: "" }), "");
  assert.ok(devecoCliFailureMessage({
    exitCode: 0,
    stdout: "Launching com.example/EntryAbility...\nerror: failed to start ability.",
    stderr: "",
  }));
  assert.ok(devecoCliFailureMessage({
    exitCode: 0,
    stdout: 'Emulator "Pura 90" was launched but did not appear in hdc list targets within the timeout.',
    stderr: "",
  }));
  assert.ok(devecoCliFailureMessage({ exitCode: 1, stdout: "", stderr: "boom" }));
});

test("HDC failure markers are errors even when the process exits zero", () => {
  const result = {
    stdout: "[Fail]Not match target founded, check connect-key please\n",
    stderr: "",
    exitCode: 0,
  };
  assert.match(hdcFailureMessage(result), /Not match target/);
  assert.equal(hdcFailureMessage({ stdout: "device-1\n", stderr: "", exitCode: 0 }), "");
});

test("a timed-out HDC call releases its abort listener immediately", async (t) => {
  const fake = await makeFakeHdc("sleep 3");
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));
  const controller = new AbortController();
  await assert.rejects(
    () => runHdc([fake.executable], 50, { signal: controller.signal }),
    (error) => error.code === "HDC_TIMEOUT",
  );
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("hdc_log rejects missing, unknown, and ambiguous devices", async () => {
  const empty = await makeFakeHdc("printf '[Empty]\\n'");
  try {
    await withHdcPath(empty.executable, async () => {
      await assert.rejects(() => hdcLog({ action: "collect" }), (error) => error.code === "HDC_NO_DEVICE");
    });
  } finally {
    await fs.rm(empty.directory, { recursive: true, force: true });
  }

  const multiple = await makeFakeHdc("printf 'device-a\\ndevice-b\\n'");
  try {
    await withHdcPath(multiple.executable, async () => {
      await assert.rejects(() => hdcLog({ action: "collect" }), (error) => error.code === "HDC_DEVICE_REQUIRED");
      await assert.rejects(
        () => hdcLog({ action: "clear", device_id: "missing" }),
        (error) => error.code === "HDC_DEVICE_NOT_FOUND",
      );
    });
  } finally {
    await fs.rm(multiple.directory, { recursive: true, force: true });
  }
});

test("hdc_log rejects zero-exit command failures after device validation", async () => {
  const fake = await makeFakeHdc(`
if [ "$1 $2" = "list targets" ]; then
  printf 'device-a\\n'
else
  printf '[Fail]Not match target founded, check connect-key please\\n'
fi`);
  try {
    await withHdcPath(fake.executable, async () => {
      await assert.rejects(
        () => hdcLog({ action: "clear", device_id: "device-a" }),
        (error) => error.code === "HDC_COMMAND_FAILED",
      );
    });
  } finally {
    await fs.rm(fake.directory, { recursive: true, force: true });
  }
});

// The collect path used to run a bare `hilog -x` and filter in Node. On one TCP-attached device
// that was 30MB / 212354 lines / 231s against a 120s deadline, for a prefix that matched nothing --
// unable to succeed at all. These tests pin the filter to the device, where the cost is paid.
test("collect matches the prefix on the device, against the whole rendered line", async () => {
  const fake = await makeRecordingHdc(`
if [ "$1 $2" = "list targets" ]; then
  printf 'device-a\\n'
  exit 0
fi
printf '${hilogRecord("[VCODER_DEBUG] kept")}\\n'`);
  try {
    const report = await withHdcPath(fake.executable, () => hdcLog({
      action: "collect",
      device_id: "device-a",
      lines: 300,
    }));
    const [, collect] = await fake.invocations();
    // grep -F rather than hilog's own -e: -e sees only the message body, so a prefix that lands in
    // the tag is invisible to it. On a real device -e returned 7071 lines from a buffer holding
    // 8385 matching ones, and lines dropped on the device cannot be recovered here. -F also takes
    // the prefix literally -- as a regex, [VCODER_DEBUG] is a character class that matched 195715
    // of 212354 lines.
    assert.deepEqual(collect, [
      "-t", "device-a", "shell", "hilog -x | grep -F -- '[VCODER_DEBUG]'",
    ]);
    assert.equal(report.deviceFiltered, true);
    assert.equal(report.truncated, false);
    assert.deepEqual(report.logs, [hilogRecord("[VCODER_DEBUG] kept")]);
  } finally {
    await fs.rm(fake.directory, { recursive: true, force: true });
  }
});

test("collect without a prefix bounds the tail instead of dumping the buffer", async () => {
  const fake = await makeRecordingHdc(`
if [ "$1 $2" = "list targets" ]; then
  printf 'device-a\\n'
  exit 0
fi
printf '${hilogRecord("anything")}\\n'`);
  try {
    const report = await withHdcPath(fake.executable, () => hdcLog({
      action: "collect",
      device_id: "device-a",
      log_prefix: "",
      lines: 120,
    }));
    const [, collect] = await fake.invocations();
    assert.deepEqual(collect, ["-t", "device-a", "shell", "hilog", "-z", "120"]);
    assert.ok(!collect.includes("-x"), "an unfiltered collect must not ship the whole buffer");
    assert.equal(report.lineCount, 1);
  } finally {
    await fs.rm(fake.directory, { recursive: true, force: true });
  }
});

test("a prefix with whitespace or shell metacharacters is still sent to the device", async () => {
  // Single quotes make all of these literal in the remote command, which is sent as one argv
  // element. Measured on a device: `a`id`b` did not run id, and $, backslash and double quote each
  // arrived unchanged. So none of them need to cost a full-buffer transfer.
  for (const prefix of ["[MY TAG]", "a$HOME b", 'say "hi"', "back\\slash", "a ; id ; b", "【标签】"]) {
    const fake = await makeRecordingHdc(`
if [ "$1 $2" = "list targets" ]; then
  printf 'device-a\\n'
  exit 0
fi
printf '${hilogRecord("no match here")}\\n'`);
    try {
      const report = await withHdcPath(fake.executable, () => hdcLog({
        action: "collect",
        device_id: "device-a",
        log_prefix: prefix,
      }));
      const [, collect] = await fake.invocations();
      assert.deepEqual(collect, ["-t", "device-a", "shell", `hilog -x | grep -F -- '${prefix}'`]);
      assert.equal(report.deviceFiltered, true, `${prefix} should filter on the device`);
    } finally {
      await fs.rm(fake.directory, { recursive: true, force: true });
    }
  }
});

test("a prefix that cannot be quoted falls back rather than breaking the remote shell", async () => {
  // A single quote closes our own quoting -- the device answers `/bin/sh: no closing quote` -- so
  // this one prefix has to be paid for with a full transfer and filtered here.
  const fake = await makeRecordingHdc(`
if [ "$1 $2" = "list targets" ]; then
  printf 'device-a\\n'
  exit 0
fi
printf '%s\\n' ${shQuote(hilogRecord("it's here"))} ${shQuote(hilogRecord("not here"))}`);
  try {
    const report = await withHdcPath(fake.executable, () => hdcLog({
      action: "collect",
      device_id: "device-a",
      log_prefix: "it's",
    }));
    const [, collect] = await fake.invocations();
    assert.deepEqual(collect, ["-t", "device-a", "shell", "hilog", "-x"]);
    assert.equal(report.deviceFiltered, false);
    assert.deepEqual(report.logs, [hilogRecord("it's here")]);
  } finally {
    await fs.rm(fake.directory, { recursive: true, force: true });
  }
});

test("a device complaint on stderr is not mistaken for an empty log", async () => {
  // hilog writes `unrecognized option` to stderr, and grep swallows stdout, so an unreadable device
  // looks exactly like a device with nothing to report unless stderr is read.
  const fake = await makeRecordingHdc(`
if [ "$1 $2" = "list targets" ]; then
  printf 'device-a\\n'
  exit 0
fi
case "$4" in
  *grep*) printf 'hilog: unrecognized option: x\\n' >&2 ;;
  *) printf '${hilogRecord("[VCODER_DEBUG] kept")}\\n' ;;
esac`);
  try {
    const report = await withHdcPath(fake.executable, () => hdcLog({
      action: "collect",
      device_id: "device-a",
    }));
    assert.equal(report.deviceFiltered, false);
    assert.deepEqual(report.logs, [hilogRecord("[VCODER_DEBUG] kept")]);
  } finally {
    await fs.rm(fake.directory, { recursive: true, force: true });
  }
});

test("stderr noise never fails a collect that returned real records", async () => {
  const fake = await makeRecordingHdc(`
if [ "$1 $2" = "list targets" ]; then
  printf 'device-a\\n'
  exit 0
fi
printf 'some unrelated chatter\\n' >&2
printf '${hilogRecord("[VCODER_DEBUG] kept")}\\n'`);
  try {
    const report = await withHdcPath(fake.executable, () => hdcLog({
      action: "collect",
      device_id: "device-a",
    }));
    const invocations = await fake.invocations();
    assert.equal(invocations.length, 2, "records outrank stderr noise, so there is no retry");
    assert.deepEqual(report.logs, [hilogRecord("[VCODER_DEBUG] kept")]);
  } finally {
    await fs.rm(fake.directory, { recursive: true, force: true });
  }
});

test("a device without grep falls back once instead of reporting its refusal as logs", async () => {
  // `hdc shell X` exits 0 whatever X did, so a device with no grep on it comes back as a successful
  // call whose only line is the complaint. Returning that as log content is the silent-wrong-answer
  // case; the shape test catches it and the plain dump still answers.
  const fake = await makeRecordingHdc(`
if [ "$1 $2" = "list targets" ]; then
  printf 'device-a\\n'
  exit 0
fi
case "$4" in
  *grep*) printf '/bin/sh: grep: inaccessible or not found\\n'; exit 0 ;;
esac
printf '${hilogRecord("[VCODER_DEBUG] kept")}\\n${hilogRecord("noise")}\\n'`);
  try {
    const report = await withHdcPath(fake.executable, () => hdcLog({
      action: "collect",
      device_id: "device-a",
    }));
    const invocations = await fake.invocations();
    assert.equal(invocations.length, 3, "expected list targets, the -e attempt, then the fallback");
    assert.deepEqual(invocations[2], ["-t", "device-a", "shell", "hilog", "-x"]);
    assert.equal(report.deviceFiltered, false);
    assert.deepEqual(report.logs, [hilogRecord("[VCODER_DEBUG] kept")]);
  } finally {
    await fs.rm(fake.directory, { recursive: true, force: true });
  }
});

test("a hilog that refuses both forms raises rather than passing the complaint through", async () => {
  const fake = await makeRecordingHdc(`
if [ "$1 $2" = "list targets" ]; then
  printf 'device-a\\n'
  exit 0
fi
printf 'Mutlti commands can not be used in combination [CODE: -31]\\n'`);
  try {
    await withHdcPath(fake.executable, async () => {
      await assert.rejects(
        () => hdcLog({ action: "collect", device_id: "device-a" }),
        (error) => error.code === "HDC_HILOG_ERROR" && /CODE: -31/.test(error.message),
      );
    });
  } finally {
    await fs.rm(fake.directory, { recursive: true, force: true });
  }
});

test("a collect that outruns its deadline keeps the lines it already read", async () => {
  // The old deadline rejected, discarding a buffer of real lines that had already crossed the wire.
  // /bin/echo rather than the shell builtin so each line is flushed by a process exit.
  const fake = await makeRecordingHdc(`
if [ "$1 $2" = "list targets" ]; then
  printf 'device-a\\n'
  exit 0
fi
/bin/echo '${hilogRecord("[VCODER_DEBUG] first")}'
/bin/echo '${hilogRecord("[VCODER_DEBUG] second")}'
sleep 20`);
  try {
    const report = await withHdcPath(fake.executable, () => hdcLog({
      action: "collect",
      device_id: "device-a",
      timeoutMs: 1000,
    }));
    assert.equal(report.truncated, true);
    assert.deepEqual(report.logs, [
      hilogRecord("[VCODER_DEBUG] first"),
      hilogRecord("[VCODER_DEBUG] second"),
    ]);
  } finally {
    await fs.rm(fake.directory, { recursive: true, force: true });
  }
});

test("initialize is answered without waiting on the CodeGenie child", async () => {
  // The gateway used to await the CodeGenie handshake before connecting its own
  // transport. That handshake intermittently never completes, so roughly one
  // start in six produced a server that never answered initialize at all and
  // took every local tool down with it.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const child = spawn(process.execPath, ["src/server.mjs"], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "deveco-initialize-test", version: "0.1.0" },
        },
      })}\n`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`initialize timed out on attempt ${attempt}`)), 5000);
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
          if (/"id"\s*:\s*1/.test(stdout)) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    } finally {
      child.kill("SIGKILL");
    }
  }
});

test("a CodeGenie child that never answers cannot delay tool discovery", { timeout: 60000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-codegenie-stall-"));
  const entry = path.join(directory, "never-answers.mjs");
  // Reads nothing, writes nothing, stays alive: the observed failure mode.
  await fs.writeFile(entry, "setInterval(() => {}, 1000);\n");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: REPO_ROOT,
    env: { ...process.env, DEVECO_CODEGENIE_ENTRY: entry },
    stderr: "ignore",
  });
  const client = new Client({ name: "deveco-stall-test", version: "0.1.0" });
  t.after(async () => {
    await transport.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  await client.connect(transport);

  // The whole point of the static proxy table: discovery must not wait on the child at all.
  // This used to take ~14s (2 handshake attempts x 2 five-second timeouts), which is past the
  // point where hosts abandon tool discovery and show the server as connected but toolless.
  const startedAt = Date.now();
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 1000, `tools/list must not wait on the child; took ${elapsed}ms`);

  assert.equal(names.length, 44, "all 44 tools must be advertised even while the child is stalled");
  assert.ok(names.includes("arkts_check"));
  // The capture/find/tap loop runs over hdc in-process, so a stalled child must not reach it.
  for (const local of ["ui_snapshot", "ui_observe", "ui_find", "ui_tap", "ui_flow"]) {
    assert.ok(names.includes(local), `${local} must survive a stalled CodeGenie child`);
  }
  // build_project and start_app run through the bundled DevEco CLI, so a stalled
  // CodeGenie child no longer costs the ability to build and launch.
  assert.ok(names.includes("build_project"), "building must survive a stalled CodeGenie child");
  assert.ok(names.includes("start_app"), "launching must survive a stalled CodeGenie child");

  // Proxied tools stay advertised and fail loudly on call. A tool that silently vanishes from
  // the list looks to a host exactly like a tool that never existed, which is not actionable.
  assert.ok(names.includes("check_cpp_files"), "proxied tools stay advertised from the static table");
  const proxied = await client.callTool({ name: "check_cpp_files", arguments: { files: ["/tmp/none.cpp"] } });
  assert.equal(proxied.isError, true);
  assert.match(proxied.content[0].text, /CODEGENIE_UNAVAILABLE/);

  // Local tools must keep working rather than inheriting the child's stall.
  const status = await client.callTool({ name: "deveco_status", arguments: {} });
  assert.equal(status.isError, false);
});

test("stdio EOF shuts down the MCP server within six seconds", { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "ignore"],
  });
  let stdout = "";
  const initialized = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MCP initialize response timed out")), 7000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (/"id"\s*:\s*1/.test(stdout)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "deveco-eof-test", version: "0.1.0" },
    },
  })}\n`);

  try {
    await initialized;
    const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    const startedAt = Date.now();
    child.stdin.end();
    const outcome = await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("MCP server did not exit after stdin EOF")), 6000)),
    ]);
    assert.equal(outcome.code, 0);
    assert.equal(outcome.signal, null);
    assert.ok(Date.now() - startedAt < 6000);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});

// --- device-UI fast path (src/device-ui.mjs) ----------------------------------------------------
//
// All of these drive a fake hdc through HDC_PATH, so they run on CI with no device and no DevEco.
// The fake writes to the LAST argv element because `file recv` puts the destination there and the
// `-t <device>` prefix shifts every positional index, and it appends every invocation to a log so
// tests can assert which commands actually ran rather than only what came back.

const SNAPSHOT_OK = "printf 'process: display 0, file type: jpeg, width: 1276, height: 2848\\n';"
  + " printf 'success: snapshot display 0 , write to /d/x.jpeg as jpeg, width: 1276, height: 2848\\n'";

// device-ui.mjs caches "this device has no snapshot_display" for the life of the process, keyed by
// device id. Sharing one device name across tests therefore leaks that verdict forward and silently
// routes later captures down the screenCap fallback, so every fake gets its own device by default.
let fakeDeviceCounter = 0;

async function makeUiHdc({
  devices, snapshot = SNAPSHOT_OK, recv = 'write_jpeg "$last"', observe = "printf 'OBSERVE_OK\\n'",
} = {}) {
  // The pid is part of the name because device-ui.mjs now persists the display size per device
  // under the system temp directory. Bare counters repeat on the next run, so a later run would
  // inherit the previous one's cache and capture scaled where the test expected native.
  const device = `device-${process.pid}-${(fakeDeviceCounter += 1)}`;
  const advertised = devices ?? device;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-ui-test-"));
  const log = path.join(directory, "argv.log");
  const marks = path.join(directory, "marks.log");
  const body = [
    `LOG="${log}"`,
    `MARKS="${marks}"`,
    'printf \'%s\\n\' "$*" >> "$LOG"',
    'for a in "$@"; do last="$a"; done',
    'pad() { i=0; while [ $i -lt 60 ]; do printf \'0123456789\' >> "$1"; i=$((i+1)); done; }',
    'write_jpeg() { printf \'\\377\\330\\377\\341\' > "$1"; pad "$1"; }',
    'write_png() { printf \'\\211PNG\\015\\012\\032\\012\' > "$1"; pad "$1"; }',
    'case "$*" in',
    `  *"list targets"*) printf '${advertised}\\n' ;;`,
    // The fused observe command mentions snapshot_display and dumpLayout too, so it has to be
    // matched before either of them. Its own echo is what makes it recognisable.
    `  *OBSERVE_OK*) ${observe} ;;`,
    `  *snapshot_display*) ${snapshot} ;;`,
    "  *screenCap*) printf 'ScreenCap saved to /d/x.png\\n' ;;",
    "  *dumpLayout*) printf 'DumpLayout saved to:/d/x.json\\n' ;;",
    "  *uiInput*) printf 'No Error\\n' ;;",
    `  *"file recv"*) ${recv} ;;`,
    "esac",
  ].join("\n");
  const executable = path.join(directory, "hdc");
  await fs.writeFile(executable, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return {
    device,
    directory,
    executable,
    async argv() {
      return (await fs.readFile(log, "utf8")).split("\n").filter(Boolean);
    },
    async marks() {
      return (await fs.readFile(marks, "utf8")).split("\n").filter(Boolean);
    },
  };
}

function uiTempTarget(name) {
  return path.join(os.tmpdir(), `deveco-ui-target-${process.pid}-${name}`);
}

test("ui_snapshot reads the native size from one line and the written size from the other", async (t) => {
  const fake = await makeUiHdc();
  const target = uiTempTarget("native.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
  });

  const report = await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target }));
  assert.equal(report.method, "snapshot_display");
  assert.equal(report.deviceId, fake.device);
  assert.equal(report.localPath, target);
  assert.equal(report.nativeWidth, 1276);
  assert.equal(report.nativeHeight, 2848);
  assert.equal(report.coordinateScale, 1);
  assert.equal(report.mimeType, "image/jpeg");
  assert.ok(report.bytes >= 512);

  const argv = await fake.argv();
  const capture = argv.find((line) => line.includes("snapshot_display"));
  // Defaulting -i to 0 breaks unfolded foldables, 2-in-1 and external displays, so it is only ever
  // sent when the caller named a display.
  assert.ok(!capture.includes(" -i "), `-i must be omitted when displayId is unset: ${capture}`);
  // The very first capture against an unfamiliar display cannot scale: -w alone does not preserve
  // the aspect ratio, and the height needs a native size nobody has reported yet. So it comes back
  // native and teaches the cache, which is what the next test picks up.
  assert.ok(!capture.includes(" -w "), `nothing to scale against yet: ${capture}`);
});

test("default screenshots are session-temporary and their device copies are removed immediately", async (t) => {
  const fake = await makeUiHdc();
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  const report = await withHdcPath(fake.executable, () => uiSnapshot());
  assert.equal(report.temporary, true);
  assert.ok(report.localPath.startsWith(path.join(os.tmpdir(), "deveco-ui", "sessions")));
  assert.equal(fsSync.existsSync(report.localPath), true);
  const argv = await fake.argv();
  assert.ok(argv.some((line) => line.includes("shell rm -f /data/local/tmp/deveco_ui_")));

  assert.equal(removeUiTemporaryFile(report.localPath), true);
  assert.equal(fsSync.existsSync(report.localPath), false);
  cleanupUiTemporaryFiles();
});

test("the first capture removes only stale screenshot artifacts from the legacy temp directory", async (t) => {
  const fake = await makeUiHdc();
  const legacyDirectory = path.join(os.tmpdir(), "deveco-ui", fake.device);
  const staleSnapshot = path.join(legacyDirectory, "snapshot-123-1.jpeg");
  const freshSnapshot = path.join(legacyDirectory, "snapshot-456-2.png");
  const staleObserveArchive = path.join(legacyDirectory, "observe.tar");
  const displayCache = path.join(legacyDirectory, "display.json");
  await fs.mkdir(legacyDirectory, { recursive: true });
  await fs.writeFile(staleSnapshot, "old temporary frame");
  await fs.writeFile(freshSnapshot, "active old-client frame");
  await fs.writeFile(staleObserveArchive, "old archive containing a frame");
  await fs.writeFile(displayCache, JSON.stringify({ width: 1276, height: 2848 }));
  const staleTime = new Date(Date.now() - 11 * 60 * 1000);
  await fs.utimes(staleSnapshot, staleTime, staleTime);
  await fs.utimes(staleObserveArchive, staleTime, staleTime);

  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(legacyDirectory, { recursive: true, force: true });
    cleanupUiTemporaryFiles();
  });

  const report = await withHdcPath(fake.executable, () => uiSnapshot());
  assert.equal(fsSync.existsSync(staleSnapshot), false);
  assert.equal(fsSync.existsSync(staleObserveArchive), false);
  assert.equal(fsSync.existsSync(freshSnapshot), true);
  assert.equal(fsSync.existsSync(displayCache), true);
  removeUiTemporaryFile(report.localPath);
});

test("the MCP deletes a default screenshot after returning it inline", async (t) => {
  const fake = await makeUiHdc();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: REPO_ROOT,
    env: { ...process.env, HDC_PATH: fake.executable },
    stderr: "ignore",
  });
  const client = new Client({ name: "deveco-ui-temp-test", version: "0.1.0" });
  t.after(async () => {
    await transport.close();
    await fs.rm(fake.directory, { recursive: true, force: true });
  });
  await client.connect(transport);

  const result = await client.callTool({ name: "ui_snapshot", arguments: {} });
  assert.ok(result.content.some((item) => item.type === "image"));
  const payload = JSON.parse(result.content.find((item) => item.type === "text").text);
  assert.equal(payload.inlined, true);
  assert.equal(payload.temporary, true);
  assert.equal(payload.temporaryFileRemoved, true);
  assert.equal(payload.localPath, null);
});

test("the display size is learned once and reused by later processes", async (t) => {
  // Scaling needs the native size, and re-learning it would cost every fresh server process an
  // extra unscaled capture. It is cached on disk, and never trusted over the device: every capture
  // reports the real size, so a fold or a rotation is picked up on the very next call.
  const fake = await makeUiHdc();
  const first = uiTempTarget("learn1.jpeg");
  const second = uiTempTarget("learn2.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(first, { force: true });
    await fs.rm(second, { force: true });
    await fs.rm(path.join(os.tmpdir(), "deveco-ui", fake.device), { recursive: true, force: true });
  });

  await withHdcPath(fake.executable, () => uiSnapshot({ localPath: first }));
  const report = await withHdcPath(fake.executable, () => uiSnapshot({ localPath: second }));

  const captures = (await fake.argv()).filter((line) => line.includes("snapshot_display"));
  assert.ok(!captures[0].includes(" -w "), "nothing known yet on the first capture");
  // The fixture's 1276x2848 display has a long edge past the 2576px ceiling, so it is scaled to
  // exactly that: 2576 tall, and 1276 * 2576 / 2848 = 1154 wide. A vision consumer would have
  // resized it to this anyway, so nothing is lost and the larger transfer is avoided.
  assert.ok(captures[1].includes(" -w 1154 -h 2576"), `second capture must scale: ${captures[1]}`);
  assert.equal(report.nativeWidth, 1276, "the native size is still reported after scaling");

  const cached = JSON.parse(
    await fs.readFile(path.join(os.tmpdir(), "deveco-ui", fake.device, "display.json"), "utf8"),
  );
  assert.deepEqual(cached, { width: 1276, height: 2848 });
});

test("an explicit width at or above native asks for no rescale", async (t) => {
  const fake = await makeUiHdc();
  const target = uiTempTarget("explicit.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
    await fs.rm(path.join(os.tmpdir(), "deveco-ui", fake.device), { recursive: true, force: true });
  });

  await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target }));
  await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target, width: 4096, overwrite: true }));
  const captures = (await fake.argv()).filter((line) => line.includes("snapshot_display"));
  // An explicit width only ever scales down -- asking for more pixels than the display has would
  // upscale a blurry frame and charge for the extra area.
  assert.ok(!captures[1].includes(" -w "), `native is one explicit width away: ${captures[1]}`);
});

test("a display within the ceiling is captured untouched", async (t) => {
  // Only tall displays are scaled. A 1080x1920 panel is inside the 2576px long-edge ceiling, so
  // the default must not touch it -- the cap exists to avoid waste, not to shrink on principle.
  const fake = await makeUiHdc({
    snapshot: "printf 'process: display 0, file type: jpeg, width: 1080, height: 1920\\n';"
      + " printf 'success: snapshot display 0 , write to /d/x.jpeg as jpeg, width: 1080, height: 1920\\n'",
  });
  const target = uiTempTarget("small.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
    await fs.rm(path.join(os.tmpdir(), "deveco-ui", fake.device), { recursive: true, force: true });
  });

  await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target }));
  const report = await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target, overwrite: true }));
  const captures = (await fake.argv()).filter((line) => line.includes("snapshot_display"));
  assert.ok(!captures[1].includes(" -w "), `nothing to cap on this display: ${captures[1]}`);
  assert.equal(report.coordinateScale, 1);
});

test("ui_snapshot passes -i only when displayId is given", async (t) => {
  const fake = await makeUiHdc();
  const target = uiTempTarget("display.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
  });

  await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target, displayId: 2 }));
  const capture = (await fake.argv()).find((line) => line.includes("snapshot_display"));
  assert.match(capture, /-i 2/);
});

test("ui_snapshot falls back to screenCap when snapshot_display fails at exit 0", async (t) => {
  // The exact hole this module exists around: `hdc shell` returns 0 whatever the remote command
  // did, and a bare "error:" line matches none of hdc-log's transport failure patterns. Success has
  // to be a positive marker, never the absence of a negative one.
  const fake = await makeUiHdc({
    snapshot: "printf 'error: something went wrong\\n'",
    recv: 'write_png "$last"',
  });
  const target = uiTempTarget("fallback.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
    await fs.rm(target.replace(/\.jpeg$/, ".png"), { force: true });
  });

  const report = await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target }));
  assert.equal(report.method, "uitest-screenCap");
  assert.equal(report.mimeType, "image/png");
  // screenCap writes PNG bytes. Leaving them at the requested .jpeg path would be a lie the caller
  // has no way to detect, so the destination moves and both paths come back.
  assert.ok(report.localPath.endsWith(".png"), report.localPath);
  assert.equal(report.requestedPath, target);
  assert.match(report.fallbackReason, /error/i);
});

test("a device without snapshot_display is probed once, not on every call", async (t) => {
  const fake = await makeUiHdc({
    snapshot: "printf 'inaccessible or not found\\n'",
    recv: 'write_png "$last"',
  });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    await uiSnapshot({ localPath: uiTempTarget("probe1.jpeg") });
    await uiSnapshot({ localPath: uiTempTarget("probe2.jpeg") });
  });

  const attempts = (await fake.argv()).filter((line) => line.includes("snapshot_display"));
  // Falling back costs the failed attempt plus the slower path, which is worse than the tool being
  // replaced. A device that has no snapshot_display will never grow one, so that verdict sticks.
  assert.equal(attempts.length, 1, "a permanently missing snapshot_display must not be re-probed");
});

test("format png is lossless, uncapped, and does not need the uitest lock", async (t) => {
  // snapshot_display writes png too -- believing otherwise sent every lossless capture through
  // uitest screenCap, which measured 5.2MB in 813ms against 3.7MB in 655ms for the same screen and
  // took the device lock for no reason. png is also the explicit ask for the untouched original,
  // so the long-edge ceiling that bounds the jpeg default does not apply to it.
  const fake = await makeUiHdc({ recv: 'write_png "$last"' });
  const target = uiTempTarget("lossless.png");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
    await fs.rm(path.join(os.tmpdir(), "deveco-ui", fake.device), { recursive: true, force: true });
  });

  await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target, format: "png" }));
  const report = await withHdcPath(fake.executable, () => uiSnapshot({
    localPath: target, format: "png", overwrite: true,
  }));
  assert.equal(report.method, "snapshot_display");
  assert.equal(report.mimeType, "image/png");
  assert.equal(report.localPath, target);
  assert.equal(report.requestedPath, undefined, "png was asked for, so nothing was substituted");
  assert.equal(report.fallbackReason, undefined, "an explicit png request is a choice, not a fallback");

  const argv = await fake.argv();
  const captures = argv.filter((line) => line.includes("snapshot_display"));
  assert.ok(captures.every((line) => line.includes("-t png")), "png must be asked of snapshot_display");
  // Even on the second call, when the display size is known and the jpeg default would have capped
  // the long edge, png stays native.
  assert.ok(!captures[1].includes(" -w "), `png is the untouched original: ${captures[1]}`);
  assert.equal(argv.filter((line) => line.includes("screenCap")).length, 0, "screenCap is now only a fallback");
});

test("ui_snapshot does not fall back after a timeout", async (t) => {
  const fake = await makeUiHdc({ snapshot: "sleep 3" });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    await assert.rejects(
      () => uiSnapshot({ localPath: uiTempTarget("timeout.jpeg"), timeoutMs: 1000 }),
      (error) => error.code === "HDC_TIMEOUT",
    );
  });
  // A wedged device would time out on screenCap too, so retrying there only doubles the wait.
  assert.equal((await fake.argv()).filter((line) => line.includes("screenCap")).length, 0);
});

test("ui_snapshot rejects an empty transfer instead of reporting success", async (t) => {
  const fake = await makeUiHdc({ recv: ": " });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    await assert.rejects(
      () => uiSnapshot({ localPath: uiTempTarget("empty.jpeg") }),
      (error) => error.code === "UI_SNAPSHOT_EMPTY",
    );
  });
});

test("ui_snapshot rejects a transfer that is not an image", async (t) => {
  // uitest and snapshot_display write plain-text failures into the -f/-p target and recv pulls them
  // back faithfully; without a magic-byte check they would arrive as a successful screenshot.
  const fake = await makeUiHdc({ recv: 'printf \'dump failed: no permission................................................\' > "$last"' });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    await assert.rejects(
      () => uiSnapshot({ localPath: uiTempTarget("text.jpeg") }),
      (error) => error.code === "UI_SNAPSHOT_EMPTY",
    );
  });
});

test("a failed ui_snapshot never leaves the previous frame in place as if it were new", async (t) => {
  // Device paths are reused, so without staging a failed recv would leave the earlier call's file
  // at the destination, pass every size and format check, and hand back a stale screenshot -- worse
  // than an error, because nothing about it looks wrong.
  const fake = await makeUiHdc({ recv: ": " });
  const target = uiTempTarget("stale.jpeg");
  const original = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.alloc(600, 0x41)]);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, original);
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
  });

  await withHdcPath(fake.executable, async () => {
    await assert.rejects(
      () => uiSnapshot({ localPath: target, overwrite: true }),
      (error) => error.code === "UI_SNAPSHOT_EMPTY",
    );
  });
  assert.deepEqual(await fs.readFile(target), original, "the earlier frame must be left untouched");
  assert.equal(fsSync.existsSync(`${target}.part`), false, "staging file must not survive a failure");
});

test("ui_snapshot resolves devices the same way hdc_log does", async (t) => {
  const empty = await makeUiHdc({ devices: "[Empty]" });
  const two = await makeUiHdc({ devices: "device-a\\ndevice-b" });
  t.after(async () => {
    await fs.rm(empty.directory, { recursive: true, force: true });
    await fs.rm(two.directory, { recursive: true, force: true });
  });

  await withHdcPath(empty.executable, async () => {
    await assert.rejects(() => uiSnapshot({}), (error) => error.code === "HDC_NO_DEVICE");
  });
  await withHdcPath(two.executable, async () => {
    await assert.rejects(() => uiSnapshot({}), (error) => error.code === "HDC_DEVICE_REQUIRED");
    await assert.rejects(
      () => uiSnapshot({ hvd: "device-z" }),
      (error) => error.code === "HDC_DEVICE_NOT_FOUND",
    );
  });
});

test("ui_snapshot refuses to overwrite an existing destination unless explicitly allowed", async (t) => {
  const fake = await makeUiHdc();
  const target = uiTempTarget("overwrite-guard.jpeg");
  const original = Buffer.from("belongs to the caller");
  await fs.writeFile(target, original);
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
  });

  await withHdcPath(fake.executable, async () => {
    await assert.rejects(
      () => uiSnapshot({ localPath: target }),
      (error) => error.code === "UI_OUTPUT_EXISTS",
    );
  });
  assert.deepEqual(await fs.readFile(target), original);
  assert.equal((await fake.argv()).some((line) => line.includes("snapshot_display")), false,
    "the guard must run before taking a device capture");
});

test("captures overlap while uitest work is serialised", async (t) => {
  // The lock exists for uitest, which is a device singleton. snapshot_display is a different
  // binary and was measured running concurrently with a dump on a real device (356ms of genuine
  // overlap), so holding captures behind the same queue was pure latency.
  const fake = await makeUiHdc({
    snapshot: `printf 'BEGIN\\n' >> "$MARKS"; sleep 0.4; printf 'END\\n' >> "$MARKS"; ${SNAPSHOT_OK}`,
  });
  const first = uiTempTarget("parallel1.jpeg");
  const second = uiTempTarget("parallel2.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(first, { force: true });
    await fs.rm(second, { force: true });
  });

  const reports = await withHdcPath(fake.executable, () => Promise.all([
    uiSnapshot({ localPath: first }),
    uiSnapshot({ localPath: second }),
  ]));
  assert.deepEqual(await fake.marks(), ["BEGIN", "BEGIN", "END", "END"], "captures must overlap");
  assert.deepEqual(reports.map((report) => report.localPath), [first, second]);

  // Overlapping is only safe because each capture gets its own device-side path. Sharing one, as
  // the serialised version could, would have each call pull whichever write finished last.
  const captures = (await fake.argv()).filter((line) => line.includes("snapshot_display"));
  const devicePaths = captures.map((line) => /(-f\s+\S+)/.exec(line)?.[1]);
  assert.equal(new Set(devicePaths).size, 2, `concurrent captures need distinct paths: ${devicePaths}`);
});

test("uitest work on one device is serialised", async (t) => {
  const fake = await makeUiHdc({
    recv: `case "$last" in *json*) printf '%s' '${JSON.stringify(SAMPLE_DUMP)}' > "$last" ;;`
      + ' *) write_jpeg "$last" ;; esac',
  });
  // The fake's dumpLayout branch has to mark its own window, which the shared factory does not do.
  const body = (await fs.readFile(fake.executable, "utf8")).replace(
    "*dumpLayout*) printf 'DumpLayout saved to:/d/x.json\\n' ;;",
    "*dumpLayout*) printf 'BEGIN\\n' >> \"$MARKS\"; sleep 0.3;"
    + " printf 'END\\n' >> \"$MARKS\"; printf 'DumpLayout saved to:/d/x.json\\n' ;;",
  );
  await fs.writeFile(fake.executable, body, { mode: 0o755 });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, () => Promise.all([
    uiFind({ text: "首页" }),
    uiFind({ text: "工具" }),
  ]));
  assert.deepEqual(await fake.marks(), ["BEGIN", "END", "BEGIN", "END"], "dumps must not overlap");
});

// A layout dump shaped like a real one: the wrapper around `content`, inconsistent spacing inside
// $rect, an off-screen node and a zero-area node.
const SAMPLE_DUMP = {
  ProcessID: 46711,
  VsyncID: 587458,
  WindowID: 82,
  content: {
    $ID: 1,
    $type: "root",
    $rect: "[0.00, 0.00],[1276.00,2848.00]",
    $attrs: {},
    $children: [
      {
        $ID: 5,
        $type: "Text",
        $rect: "[604.00, 2689.00],[675.00,2730.00]",
        $attrs: { content: "工具", key: "tab_tools" },
        $children: [],
      },
      { $ID: 6, $type: "Text", $rect: "[357.00,2689.00],[428.00, 2730.00]", $attrs: { content: "首页" } },
      { $ID: 7, $type: "Button", $rect: "[10.00,9000.00],[100.00,9100.00]", $attrs: { content: "屏幕外" } },
      { $ID: 8, $type: "Text", $rect: "[5.00,5.00],[5.00,5.00]", $attrs: { content: "零面积" } },
    ],
  },
};

async function writeDump(t, value) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-ui-dump-"));
  const dumpPath = path.join(directory, "layout.json");
  await fs.writeFile(dumpPath, typeof value === "string" ? value : JSON.stringify(value));
  t.after(async () => await fs.rm(directory, { recursive: true, force: true }));
  return dumpPath;
}

test("ui_find turns a layout dump into tap coordinates without touching a device", async (t) => {
  // This is the arithmetic that decides where every tap lands, so it is checked against the value
  // measured on a real device: the 工具 tab centres on (640, 2710). An estimate read off a
  // screenshot put it at (640, 2670) -- 40px out, which a smaller target would have missed.
  const dumpPath = await writeDump(t, SAMPLE_DUMP);

  const byText = await uiFind({ dumpPath, text: "工具" });
  assert.equal(byText.matchCount, 1);
  assert.deepEqual(byText.matches[0].center, { x: 640, y: 2710 });
  assert.equal(byText.matches[0].key, "tab_tools");
  assert.equal(byText.matches[0].type, "Text");
  assert.equal(byText.deviceId, null);
  assert.deepEqual(byText.screen, [0, 0, 1276, 2848]);

  // key is the only selector that survives a copy change or a locale switch.
  assert.equal((await uiFind({ dumpPath, key: "tab_tools" })).matches[0].id, 5);
  assert.equal((await uiFind({ dumpPath, key: "nope" })).matchCount, 0);

  assert.equal((await uiFind({ dumpPath, type: "Button", onScreenOnly: false })).matchCount, 1);
  assert.equal((await uiFind({ dumpPath, text: "工" })).matchCount, 1, "substring match");

  // Off-screen and zero-area nodes are in the dump but tapping their centres does nothing, and the
  // caller cannot tell that apart from a broken tap.
  const onScreen = await uiFind({ dumpPath });
  assert.deepEqual(onScreen.matches.map((match) => match.text), ["工具", "首页"]);
  const everything = await uiFind({ dumpPath, onScreenOnly: false });
  assert.deepEqual(everything.matches.map((match) => match.text), ["工具", "首页", "屏幕外", "零面积"]);

  const limited = await uiFind({ dumpPath, onScreenOnly: false, limit: 1 });
  assert.equal(limited.matches.length, 1);
  assert.equal(limited.matchCount, 4);
  assert.equal(limited.truncated, true);
  assert.match(limited.truncationHint, /type: Slider/);
  assert.equal(limited.componentTypes.Text, 2, "only visible, non-zero-area component types are counted");
});

test("ui_find reads the accessibility dump shape that uitest actually emits", async (t) => {
  // The fixture above is CodeGenie's get_app_ui_tree shape. `uitest dumpLayout` -- which is what
  // ui_find itself runs -- emits this one instead: children/attributes, bounds as [x1,y1][x2,y2]
  // with no comma between the pairs, and type/key/clickable all inside attributes. Captured from a
  // real device, where the first pass returned every type as "" because it only looked at $type.
  const dumpPath = await writeDump(t, {
    attributes: { type: "root", bounds: "[0,0][1276,2848]", text: "" },
    children: [
      {
        attributes: {
          type: "Stack", bounds: "[372,389][905,1452]", text: "8月10日, 星期一",
          key: "sl_clock", id: "sl_clock", clickable: "true", enabled: "true", visible: "true",
        },
        children: [],
      },
      {
        attributes: {
          type: "Text", bounds: "[100,100][200,140]", text: "只是标签",
          key: "", id: "", clickable: "false", enabled: "true", visible: "true",
        },
      },
      {
        attributes: {
          type: "Text", bounds: "[100,200][200,240]", text: "隐藏的",
          clickable: "true", enabled: "true", visible: "false",
        },
      },
    ],
  });

  const clock = await uiFind({ dumpPath, text: "8月10日" });
  assert.equal(clock.matchCount, 1);
  assert.equal(clock.matches[0].type, "Stack", "type lives in attributes in this shape");
  assert.equal(clock.matches[0].key, "sl_clock");
  assert.equal(clock.matches[0].clickable, true, "string flags must be read as booleans");
  assert.deepEqual(clock.matches[0].center, { x: 639, y: 921 });

  // The visible text is frequently a label nested inside whatever handles the tap.
  const tappable = await uiFind({ dumpPath, clickableOnly: true });
  assert.deepEqual(tappable.matches.map((match) => match.text), ["8月10日, 星期一"]);

  // An explicit visible:false beats the geometry, which would have called this one on-screen.
  assert.deepEqual((await uiFind({ dumpPath })).matches.map((match) => match.text),
    ["8月10日, 星期一", "只是标签"]);
  assert.equal((await uiFind({ dumpPath, onScreenOnly: false })).matchCount, 3);
});

test("clickableOnly is a selector, not only a filter", async (t) => {
  // A real launcher screen carried 35 clickable nodes and not one of them had text of its own: the
  // node that takes the tap is a Stack / Flex / FormComponent wrapping the label you can see. While
  // clickableOnly merely filtered the has-text default, "show me what I can tap" answered 0 there.
  const dumpPath = await writeDump(t, {
    attributes: { type: "root", bounds: "[0,0][1276,2848]" },
    children: [
      {
        attributes: { type: "FormComponent", bounds: "[72,278][1205,803]", clickable: "true", enabled: "true" },
        children: [
          { attributes: { type: "Text", bounds: "[518,815][758,865]", text: "灵动小组件", clickable: "false" } },
        ],
      },
      { attributes: { type: "Text", bounds: "[100,100][200,140]", text: "只是标签", clickable: "false" } },
    ],
  });

  const tappable = await uiFind({ dumpPath, clickableOnly: true });
  assert.equal(tappable.matchCount, 1);
  assert.equal(tappable.matches[0].type, "FormComponent");
  assert.deepEqual(tappable.matches[0].center, { x: 639, y: 541 });
  assert.equal(tappable.matches[0].text, "", "the tappable node has no text of its own");

  // Combining it with another selector still narrows rather than widens.
  assert.equal((await uiFind({ dumpPath, clickableOnly: true, type: "Text" })).matchCount, 0);
  // And without it the has-text default is unchanged.
  assert.deepEqual((await uiFind({ dumpPath })).matches.map((match) => match.text),
    ["灵动小组件", "只是标签"]);
});

test("ui_find matches the accessibility label uitest actually writes", async (t) => {
  // uitest dumpLayout puts it in `description`; `accessibilityText` exists in neither dump shape.
  // An icon-only control carries no text at all, so this is the only way to address one by name.
  const dumpPath = await writeDump(t, {
    attributes: { type: "root", bounds: "[0,0][1276,2848]" },
    children: [
      { attributes: { type: "Image", bounds: "[40,120][120,200]", description: "返回", clickable: "true" } },
      { attributes: { type: "Text", bounds: "[200,120][400,200]", text: "标题", description: "标题的无障碍文本" } },
    ],
  });

  const back = await uiFind({ dumpPath, text: "返回" });
  assert.equal(back.matchCount, 1);
  assert.deepEqual(back.matches[0].center, { x: 80, y: 160 });
  // Where a node has both, the visible text wins -- description is the last fallback, not an override.
  assert.equal((await uiFind({ dumpPath, text: "标题" })).matches[0].text, "标题");
});

test("ui_find reports an unparseable dump with the file head as the hint", async (t) => {
  // uitest writes plain-text failures into the -p target, so the head of the file is the diagnosis.
  const dumpPath = await writeDump(t, "dump layout failed: no permission");
  await assert.rejects(
    () => uiFind({ dumpPath }),
    (error) => error.code === "UI_DUMP_PARSE_FAILED" && /no permission/.test(error.hint),
  );
  const emptyPath = await writeDump(t, "   ");
  await assert.rejects(() => uiFind({ dumpPath: emptyPath }), (error) => error.code === "UI_DUMP_EMPTY");
});

test("ui_find survives dumps that do not match the one device it was written against", async (t) => {
  const arrayRoot = await writeDump(t, [
    { $type: "Text", $rect: "[0,0],[10,10]", attributes: { content: "alpha" }, children: [] },
    { $type: "Text", $rect: "bad rect", $attrs: { content: "beta" } },
    { $type: "Text", $attrs: { content: "no rect" } },
    { $type: "Text", $rect: "[30.00,30.00],[20.00,20.00]", $attrs: { content: "inverted" } },
  ]);
  const found = await uiFind({ dumpPath: arrayRoot, onScreenOnly: false });
  assert.deepEqual(found.matches.map((match) => match.text), ["alpha", "inverted"]);
  // Corners arrive swapped on some nodes; a swapped pair still describes a real box.
  assert.deepEqual(found.matches[1].rect, [20, 20, 30, 30]);
  assert.deepEqual(found.matches[1].center, { x: 25, y: 25 });
});

test("ui_find dumps and pulls when no dumpPath is given", async (t) => {
  const fake = await makeUiHdc({ recv: `printf '%s' '${JSON.stringify(SAMPLE_DUMP)}' > "$last"` });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  const found = await withHdcPath(fake.executable, () => uiFind({ text: "首页" }));
  assert.equal(found.deviceId, fake.device);
  assert.deepEqual(found.matches[0].center, { x: 393, y: 2710 });

  const argv = await fake.argv();
  assert.ok(argv.some((line) => line.includes("uitest dumpLayout -p")), "must dump on the device");
  assert.ok(argv.some((line) => line.includes("file recv")), "must pull the dump back");
});

test("stale device-side scratch files are swept once per device, and only when old", async (t) => {
  // The scratch paths are keyed by pid, so they are bounded per process but not over time: a
  // development device had 14 of them, 6.9MB, including a 5.2MB PNG from the screenCap fallback.
  // Both entry points run here, so the pull has to answer with a frame or a dump depending on which
  // one asked. `$last` is the staging file, hence the substring match rather than a suffix.
  const fake = await makeUiHdc({
    recv: `case "$last" in *json*) printf '%s' '${JSON.stringify(SAMPLE_DUMP)}' > "$last" ;;`
      + ' *) write_jpeg "$last" ;; esac',
  });
  const target = uiTempTarget("swept.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
  });

  await withHdcPath(fake.executable, async () => {
    await uiSnapshot({ localPath: target });
    await uiFind({ text: "首页" });
  });

  // The sweep is not awaited by the capture path, so give it a moment to reach the log.
  let sweeps = [];
  for (let attempt = 0; attempt < 40 && sweeps.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    sweeps = (await fake.argv()).filter((line) => line.includes("deveco_ui_*"));
  }
  assert.equal(sweeps.length, 1, "one sweep per device per process, across both entry points");
  // The age bound is what makes it safe to run while another server process may be mid-capture
  // against the same device: an unqualified rm would delete that file between write and recv.
  assert.match(sweeps[0], /-mmin \+60 -delete/);
  assert.ok(
    sweeps[0].includes("shell find /data/local/tmp -maxdepth 1 -name 'deveco_ui_*'"),
    `the whole command must be one argv element: ${sweeps[0]}`,
  );
});

test("ui_tap builds the uiInput command for each action", async (t) => {
  const fake = await makeUiHdc();
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    assert.match((await uiTap({ action: "click", x: 640, y: 2710 })).sent, /uiInput click 640 2710$/);
    const rawSwipe = await uiTap({ action: "swipe", x: 1, y: 2, x2: 3, y2: 4, velocity: 600 });
    assert.match(rawSwipe.sent, /uiInput swipe 1 2 3 4 600$/);
    assert.equal(rawSwipe.commandAccepted, true);
    assert.equal(rawSwipe.outcomeVerified, false);
    assert.match(rawSwipe.verificationHint, /from_percent/);
    assert.match((await uiTap({ action: "fling", x: 1, y: 2, x2: 3, y2: 4, velocity: 800 })).sent, /uiInput fling 1 2 3 4 800$/);
    assert.match((await uiTap({ action: "drag", x: 1, y: 2, x2: 3, y2: 4, velocity: 400 })).sent, /uiInput drag 1 2 3 4 400$/);
    assert.match((await uiTap({ action: "dircFling", direction: 3 })).sent, /uiInput dircFling 3$/);
    assert.match((await uiTap({ action: "keyEvent", key1: "Back" })).sent, /uiInput keyEvent Back$/);
    assert.match((await uiTap({ action: "inputText", x: 5, y: 6, text: "BMI" })).sent, /uiInput inputText 5 6 'BMI'$/);
  });
});

test("ui_tap targets and verifies a slider by percentage instead of guessed coordinates", async (t) => {
  const sliderDump = {
    attributes: { type: "root", bounds: "[0,0][1276,2848]" },
    children: [{
      attributes: {
        type: "Slider", bounds: "[100,200][900,300]", text: "100.000000",
        clickable: "true", enabled: "true", visible: "true",
      },
    }],
  };
  const fake = await makeUiHdc({ recv: `printf '%s' '${JSON.stringify(sliderDump)}' > "$last"` });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  const report = await withHdcPath(fake.executable, () => uiTap({
    action: "drag", type: "Slider", text: "100", from_percent: 100, to_percent: 0, velocity: 800,
  }));
  // 5% horizontal inset keeps both points on the slider's endpoint thumbs.
  assert.match(report.sent, /uiInput drag 860 250 140 250 800$/);
  assert.equal(report.target.type, "Slider");
  assert.deepEqual(report.requestedRange, { axis: "horizontal", fromPercent: 100, toPercent: 0 });
  assert.equal(report.outcomeVerified, true);
  assert.equal(report.verified.beforeText, "100.000000");
  assert.equal(report.verified.afterText, "100.000000");
  assert.equal(report.verified.valueChanged, false, "a no-change device response must not be reported as changed");
});

test("ui_tap maps screen percentages when a custom control is absent from the UI tree", async (t) => {
  const treeWithoutSlider = {
    attributes: { type: "root", bounds: "[0,0][1276,2848]" },
    children: [{ attributes: { type: "Canvas", bounds: "[0,0][1276,2848]", visible: "true" } }],
  };
  const fake = await makeUiHdc({
    recv: `printf '%s' '${JSON.stringify(treeWithoutSlider)}' > "$last"`,
  });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  const report = await withHdcPath(fake.executable, () => uiTap({
    action: "swipe",
    from_x_percent: 92.5,
    from_y_percent: 59.2,
    to_x_percent: 40.75,
    to_y_percent: 59.2,
    velocity: 800,
  }));
  assert.equal(report.sent, "uitest uiInput swipe 1180 1686 520 1686 800");
  assert.equal(report.coordinateSpace, "device-screen-percent");
  assert.deepEqual(report.screen, [0, 0, 1276, 2848]);
  assert.equal(report.commandAccepted, true);
  assert.equal(report.outcomeVerified, false);
  assert.match(report.verificationHint, /does not prove/);

  await assert.rejects(
    () => withHdcPath(fake.executable, () => uiTap({
      action: "swipe", from_x_percent: 10, from_y_percent: 20, to_x_percent: 30,
    })),
    (error) => error.code === "UI_ARGS_INVALID" && /all four/.test(error.message),
  );
});

test("ui_tap quotes whitespace-free text instead of restricting which characters it may contain", async (t) => {
  // Measured on a real device. hdc forwards an argument with no whitespace untouched, so a
  // single-quoted form is unquoted once by the device shell and everything inside arrives literally:
  // `id` printed the backticks rather than a uid, $HOME and ~ stayed unexpanded, and (b) no longer
  // raised the `/bin/sh: syntax error: unexpected '('` that the previous allowlist walked straight
  // into by permitting parentheses.
  const fake = await makeUiHdc();
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    const cases = [
      ["BMI", "'BMI'"],
      ["`id`", "'`id`'"],
      ["$HOME", "'$HOME'"],
      ["a(b)c", "'a(b)c'"],
      ["a;echo", "'a;echo'"],
      ['a"b', `'a"b'`],
      ["a?b", "'a?b'"],
      // The old allowlist was letters/marks/digits plus an ASCII punctuation set, so it rejected
      // every CJK punctuation mark: `，` is none of \p{L}, \p{M}, \p{N}.
      ["你好，世界。", "'你好，世界。'"],
      // Close, escape, reopen -- and still no whitespace, so it stays in the regime that protects it.
      ["it's", `'it'\\''s'`],
    ];
    for (const [text, expected] of cases) {
      const report = await uiTap({ action: "inputText", x: 1, y: 1, text });
      assert.equal(report.sent, `uitest uiInput inputText 1 1 ${expected}`, `text: ${text}`);
    }

    // With whitespace, hdc wraps the argument in double quotes of its own. That already neutralises
    // parentheses, globs, # and ;, so the text passes through unquoted by us.
    assert.equal(
      (await uiTap({ action: "inputText", x: 1, y: 1, text: "hello world 你好，再见" })).sent,
      "uitest uiInput inputText 1 1 hello world 你好，再见",
    );
  });
});

test("ui_tap refuses text and keys the device shell would still expand", async (t) => {
  // The four that survive hdc's own double quotes, all confirmed live on a real device: $HOME
  // expanded to /root, a backtick ran id, a backslash was consumed, and a double quote closed the
  // wrapper outright -- `a" ; id ; "b` executed id. perform_ui_action stays available for these.
  const fake = await makeUiHdc();
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    for (const text of ["$HOME y", "`id` x", 'a" ; id ; "b', "a\\b c", "line\nbreak"]) {
      await assert.rejects(
        () => uiTap({ action: "inputText", x: 1, y: 1, text }),
        (error) => error.code === "UI_ARGS_INVALID",
        `text must be rejected: ${JSON.stringify(text)}`,
      );
    }
    await assert.rejects(
      () => uiTap({ action: "keyEvent", key1: "Back; reboot" }),
      (error) => error.code === "UI_ARGS_INVALID",
    );
    await assert.rejects(() => uiTap({ action: "nope" }), (error) => error.code === "UI_ARGS_INVALID");
  });
  assert.equal((await fake.argv()).filter((line) => line.includes("uiInput")).length, 0);
});

test("ui_tap surfaces a uiInput failure instead of reporting a phantom tap", async (t) => {
  const fake = await makeUiHdc();
  // Replace the uiInput branch so it prints a usage line, which is what a real rejection looks like.
  const body = (await fs.readFile(fake.executable, "utf8"))
    .replace("*uiInput*) printf 'No Error\\n' ;;", "*uiInput*) printf 'error: coordinate out of range\\n' ;;");
  await fs.writeFile(fake.executable, body, { mode: 0o755 });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    await assert.rejects(
      () => uiTap({ action: "click", x: 1, y: 1 }),
      (error) => error.code === "UI_TAP_FAILED",
    );
  });
});

// --- ustar reader (src/device-tar.mjs) ----------------------------------------------------------

/**
 * Build a tar in the two magics that exist in the wild. The device writes the GNU one; the fixtures
 * here cover both so a change that only handles POSIX cannot pass.
 */
function buildTar(entries, { magic = "ustar\0", version = "00", corruptChecksum = false } = {}) {
  const blocks = [];
  for (const [name, contents] of entries) {
    const body = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8");
    const header = Buffer.alloc(512);
    header.write(name, 0, "utf8");
    header.write("000644 \0", 100, "utf8");
    header.write("000000 \0", 108, "utf8");
    header.write("000000 \0", 116, "utf8");
    header.write(`${body.length.toString(8).padStart(11, "0")} `, 124, "utf8");
    header.write("00000000000 ", 136, "utf8");
    header.write("        ", 148, "utf8");
    header.write("0", 156, "utf8");
    header.write(magic, 257, "latin1");
    header.write(version, 263, "latin1");
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += header[i];
    header.write(`${(corruptChecksum ? sum + 1 : sum).toString(8).padStart(6, "0")}\0 `, 148, "utf8");
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

test("the ustar reader accepts both magics, including the one the device writes", () => {
  // toybox 0.8.12 -- what runs on the device -- writes the older GNU magic "ustar " rather than
  // POSIX "ustar\0". An equality test against "ustar" rejects every real archive, which is exactly
  // what happened until this reader was run against one pulled off a device.
  for (const [magic, version] of [["ustar\0", "00"], ["ustar ", " \0"]]) {
    const files = readTar(buildTar([["a.json", '{"ok":true}'], ["b.log", "success:\n"]], { magic, version }));
    assert.deepEqual([...files.keys()], ["a.json", "b.log"]);
    assert.equal(files.get("a.json").toString("utf8"), '{"ok":true}');
    assert.equal(entryByBaseNameForTest(files, "b.log").toString("utf8"), "success:\n");
  }
});

function entryByBaseNameForTest(files, baseName) {
  for (const [name, contents] of files) {
    if (name === baseName || name.endsWith(`/${baseName}`)) return contents;
  }
  return null;
}

test("the ustar reader refuses damage rather than returning half a file", () => {
  // A silently mis-parsed archive would hand the caller a screenshot that is really part of a JSON
  // dump, which nothing downstream could detect.
  const good = buildTar([["a.bin", Buffer.alloc(2048, 7)]]);
  assert.equal(readTar(good).get("a.bin").length, 2048);

  assert.throws(() => readTar(good.subarray(0, 900)), (error) => error.code === "TAR_TRUNCATED");
  assert.throws(
    () => readTar(buildTar([["a.bin", "x"]], { corruptChecksum: true })),
    (error) => error.code === "TAR_INVALID" && /checksum/.test(error.message),
  );
  assert.throws(() => readTar(Buffer.alloc(2048)), (error) => error.code === "TAR_EMPTY");
  assert.throws(() => readTar(Buffer.alloc(64)), (error) => error.code === "TAR_INVALID");
  const alien = buildTar([["a.bin", "x"]], { magic: "gnutar" });
  assert.throws(() => readTar(alien), (error) => /unsupported tar format/.test(error.message));
});

// --- cross-process uitest lock (src/device-lock.mjs) --------------------------------------------

async function lockDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-lock-"));
  t.after(async () => await fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("the uitest lock serialises holders and releases on failure", async (t) => {
  const directory = await lockDirectory(t);
  const order = [];
  const hold = (label, ms) => withUitestLock({ directory, op: label, timeoutMs: 5000 }, async () => {
    order.push(`${label}:in`);
    await new Promise((resolve) => setTimeout(resolve, ms));
    order.push(`${label}:out`);
  });

  await Promise.all([hold("a", 120), hold("b", 10)]);
  assert.deepEqual(order, ["a:in", "a:out", "b:in", "b:out"]);

  // A holder that throws must still release, or one failure wedges the device for 90 seconds.
  await assert.rejects(
    () => withUitestLock({ directory, op: "boom", timeoutMs: 5000 }, async () => {
      throw new Error("device exploded");
    }),
    /device exploded/,
  );
  assert.equal(fsSync.existsSync(path.join(directory, lockInternals.LOCK_FILE)), false);
});

test("the uitest lock reclaims a dead holder but waits for a live one", async (t) => {
  const directory = await lockDirectory(t);
  const lockPath = path.join(directory, lockInternals.LOCK_FILE);

  // A pid that cannot be running: the owner crashed without releasing.
  await fs.writeFile(lockPath, JSON.stringify({ pid: 0x7ffffffe, startedAt: Date.now(), op: "ghost" }));
  assert.equal(lockInternals.processAlive(0x7ffffffe), false);
  let ran = false;
  await withUitestLock({ directory, op: "after-ghost", timeoutMs: 2000 }, async () => { ran = true; });
  assert.equal(ran, true, "a dead holder must not block the device forever");

  // A live holder that has been in there past the ceiling is wedged, and is also reclaimed --
  // otherwise one hung process blocks every future one for as long as it stays alive. Age comes
  // from the file's mtime, so the fixture has to backdate that and not just the recorded startedAt.
  const wedgedAt = Date.now() - lockInternals.STALE_AFTER_MS - 1000;
  await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: wedgedAt, op: "wedged" }));
  await fs.utimes(lockPath, new Date(wedgedAt), new Date(wedgedAt));
  ran = false;
  await withUitestLock({ directory, op: "after-wedged", timeoutMs: 2000 }, async () => { ran = true; });
  assert.equal(ran, true);

  // A live, recent holder is respected, and the wait is bounded and actionable.
  await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now(), op: "dumpLayout" }));
  await assert.rejects(
    () => withUitestLock({ directory, op: "blocked", timeoutMs: 1000 }, async () => {}),
    (error) => error.code === "UI_DEVICE_BUSY"
      && /dumpLayout/.test(error.message)
      && /agent session/i.test(error.hint),
  );
  await fs.rm(lockPath, { force: true });
});

test("releasing never deletes a lock that has been reclaimed by someone else", async (t) => {
  const directory = await lockDirectory(t);
  const lockPath = path.join(directory, lockInternals.LOCK_FILE);
  await withUitestLock({ directory, op: "mine", timeoutMs: 2000 }, async () => {
    // Simulate a competitor deciding we were stale and taking the lock for itself.
    await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: 1, op: "theirs" }));
  });
  const survivor = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(survivor.op, "theirs", "our release must not remove the new holder's lock");
  await fs.rm(lockPath, { force: true });
});

// --- change signatures (src/device-dump.mjs) ----------------------------------------------------

test("signatures ignore the attributes that change on every dump", () => {
  // accessibilityId and hashcode churn on 90 of 214 nodes between consecutive dumps of one
  // unchanged screen: they identify a dump, not a screen. A signature over the raw JSON is
  // therefore different every time and useless for deciding whether anything happened.
  const build = (accessibilityId, hashcode, text) => ({
    attributes: { type: "root", bounds: "[0,0][1276,2848]", accessibilityId, hashcode },
    children: [{ attributes: { type: "Text", bounds: "[0,0][100,50]", text, key: "k", accessibilityId, hashcode } }],
  });

  const first = dumpSignatures(flattenDump(build("1", "0xaaa", "同样的文字")).nodes);
  const second = dumpSignatures(flattenDump(build("999", "0xfff", "同样的文字")).nodes);
  assert.equal(first.signature, second.signature, "volatile identifiers must not move the signature");
  assert.equal(first.structureSignature, second.structureSignature);

  // Live content -- a clock, a counter -- legitimately moves `signature`. That is why
  // structureSignature exists: it answers "did the layout change" without that noise.
  const relabelled = dumpSignatures(flattenDump(build("1", "0xaaa", "变了的文字")).nodes);
  assert.notEqual(relabelled.signature, first.signature);
  assert.equal(relabelled.structureSignature, first.structureSignature);

  // Layout changes must move both.
  const moved = flattenDump({
    attributes: { type: "root", bounds: "[0,0][1276,2848]" },
    children: [{ attributes: { type: "Text", bounds: "[0,900][100,950]", text: "同样的文字", key: "k" } }],
  });
  assert.notEqual(dumpSignatures(moved.nodes).structureSignature, first.structureSignature);
});

test("displayId narrows matches on a multi-display dump", () => {
  // A foldable or an external screen puts nodes from more than one display in a single dump, and
  // their coordinate spaces are different, so tapping a match from the wrong one misses.
  const flattened = flattenDump({
    attributes: { type: "root", bounds: "[0,0][1276,2848]", displayId: "0" },
    children: [
      { attributes: { type: "Text", bounds: "[0,0][100,50]", text: "主屏", displayId: "0" } },
      { attributes: { type: "Text", bounds: "[0,0][100,50]", text: "副屏", displayId: "4" } },
    ],
  });
  const all = analyseDump({ root: {
    attributes: { type: "root", bounds: "[0,0][1276,2848]", displayId: "0" },
    children: [
      { attributes: { type: "Text", bounds: "[0,0][100,50]", text: "主屏", displayId: "0" } },
      { attributes: { type: "Text", bounds: "[0,0][100,50]", text: "副屏", displayId: "4" } },
    ],
  }, selector: readSelector({}) });
  assert.equal(all.matchCount, 2);
  assert.equal(flattened.nodes[1].displayId, "0");

  const onlyExternal = analyseDump({ root: {
    attributes: { type: "root", bounds: "[0,0][1276,2848]", displayId: "0" },
    children: [
      { attributes: { type: "Text", bounds: "[0,0][100,50]", text: "主屏", displayId: "0" } },
      { attributes: { type: "Text", bounds: "[0,0][100,50]", text: "副屏", displayId: "4" } },
    ],
  }, selector: readSelector({ displayId: 4 }) });
  assert.deepEqual(onlyExternal.matches.map((match) => match.text), ["副屏"]);
});

// --- fused observation (ui_observe) -------------------------------------------------------------

/** The archive the device builds, with the exact base names device-ui.mjs asks tar for. */
function observeArchive({ dump = SAMPLE_DUMP, snapLog = SNAPSHOT_OK_TEXT, image = null } = {}) {
  const pid = process.pid;
  const frame = image ?? Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(1024, 0x41)]);
  return buildTar([
    [`deveco_ui_${pid}_obs_snap.jpeg`, frame],
    [`deveco_ui_${pid}_obs_dump.json`, JSON.stringify(dump)],
    [`deveco_ui_${pid}_obs_snap.log`, snapLog],
    [`deveco_ui_${pid}_obs_dump.log`, "DumpLayout saved to:/data/local/tmp/x.json\n"],
  ], { magic: "ustar ", version: " \0" });
}

const SNAPSHOT_OK_TEXT = "process: display 0, file type: jpeg, width: 1276, height: 2848\n"
  + "success: snapshot display 0 , write to /d/x.jpeg as jpeg, width: 1276, height: 2848\n";

async function makeObserveHdc(t, { archive = observeArchive(), observe } = {}) {
  const staging = path.join(os.tmpdir(), `deveco-observe-${process.pid}-${Math.trunc(performance.now() * 1000)}.tar`);
  await fs.writeFile(staging, archive);
  const fake = await makeUiHdc({
    observe,
    recv: `case "$last" in *tar*) cat "${staging}" > "$last" ;;`
      + ` *json*) printf '%s' '${JSON.stringify(SAMPLE_DUMP)}' > "$last" ;; *) write_jpeg "$last" ;; esac`,
  });
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(staging, { force: true });
    await fs.rm(path.join(os.tmpdir(), "deveco-ui", fake.device), { recursive: true, force: true });
  });
  return fake;
}

test("ui_observe refuses to overwrite an existing destination unless explicitly allowed", async (t) => {
  const fake = await makeObserveHdc(t);
  const target = uiTempTarget("observe-overwrite-guard.jpeg");
  const original = Buffer.from("belongs to the caller");
  await fs.writeFile(target, original);
  t.after(async () => await fs.rm(target, { force: true }));

  await assert.rejects(
    () => withHdcPath(fake.executable, () => uiObserve({ localPath: target })),
    (error) => error.code === "UI_OUTPUT_EXISTS",
  );
  assert.deepEqual(await fs.readFile(target), original);
  assert.equal((await fake.argv()).some((line) => line.includes("OBSERVE_OK")), false,
    "the guard must run before starting the fused device operation");
});

test("ui_observe returns one frame and one tree from a single device round trip", async (t) => {
  // Fusing the two calls without overlapping them measured 1736ms against 1731ms for doing them
  // separately, because file recv is only ~48ms while dumpLayout alone is 1.25s. The win comes
  // from backgrounding the capture so it runs during the dump, which is what this asserts.
  const fake = await makeObserveHdc(t);

  const report = await withHdcPath(fake.executable, () => uiObserve({ text: "工具" }));
  assert.equal(report.method, "fused-snapshot_display");
  assert.equal(report.deviceId, fake.device);
  assert.equal(report.matchCount, 1);
  assert.deepEqual(report.matches[0].center, { x: 640, y: 2710 });
  assert.equal(report.nodeCount > 0, true);
  assert.ok(report.bytes >= 512, "the frame must come back too");
  assert.ok(report.signature && report.structureSignature, "both signatures ride along");
  assert.equal(report.nativeWidth, 1276);
  assert.equal(fsSync.existsSync(path.join(path.dirname(report.localPath), "observe.tar")), false,
    "the local archive contains a screenshot and must be removed as soon as it is parsed");

  const argv = await fake.argv();
  const fused = argv.find((line) => line.includes("OBSERVE_OK"));
  assert.ok(fused, "the fused command must be issued");
  assert.ok(fused.includes("2>&1 & uitest dumpLayout"),
    `the capture must be backgrounded so it overlaps the dump: ${fused}`);
  assert.ok(fused.includes("wait;"), "and waited for, or the archive can catch a partial file");
  assert.ok(fused.includes("rm -f"), "a stale archive must never be re-sent as this call's result");
  // One shell round trip plus one recv, not one per artifact.
  assert.equal(argv.filter((line) => line.includes("file recv")).length, 1);
});

test("ui_observe still answers when the frame is missing, because the tree is the half that aims a tap", async (t) => {
  const fake = await makeObserveHdc(t, {
    archive: observeArchive({ snapLog: "snapshot_display: command not found\n" }),
  });
  const report = await withHdcPath(fake.executable, () => uiObserve({ text: "首页" }));
  assert.equal(report.method, "fused-dump-only");
  assert.equal(report.bytes, 0);
  assert.equal(report.localPath, null);
  assert.match(report.fallbackReason, /command not found/);
  assert.deepEqual(report.matches[0].center, { x: 393, y: 2710 });
});

test("ui_observe falls back to separate calls when the device cannot archive", async (t) => {
  // Not every device is guaranteed to have tar, and the two-round-trip path still works.
  const fake = await makeObserveHdc(t, { observe: "printf 'tar: not found\\n'" });
  const report = await withHdcPath(fake.executable, () => uiObserve({ text: "工具" }));
  assert.equal(report.method, "separate-snapshot_display");
  assert.match(report.fallbackReason, /tar: not found/);
  assert.deepEqual(report.matches[0].center, { x: 640, y: 2710 });

  const argv = await fake.argv();
  assert.ok(argv.some((line) => line.includes("uitest dumpLayout -p")), "must dump separately");
  assert.ok(argv.some((line) => line.includes("snapshot_display")), "must capture separately");
});

test("ui_observe reports a dump failure inside the archive rather than a plausible empty tree", async (t) => {
  const pid = process.pid;
  const archive = buildTar([
    [`deveco_ui_${pid}_obs_snap.jpeg`, Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(1024, 0x41)])],
    [`deveco_ui_${pid}_obs_dump.json`, "dump layout failed: no permission"],
    [`deveco_ui_${pid}_obs_snap.log`, SNAPSHOT_OK_TEXT],
    [`deveco_ui_${pid}_obs_dump.log`, "DumpLayout failed:Wait for subscribe uitest.broadcast.command.reply timeout\n"],
  ], { magic: "ustar ", version: " \0" });
  const fake = await makeObserveHdc(t, { archive });

  // The archive step succeeds even when the commands inside it failed, so the logs are the only
  // proof either did anything. Losing the device to another uitest client is called out by name.
  await assert.rejects(
    () => withHdcPath(fake.executable, () => uiObserve({})),
    (error) => error.code === "UI_DEVICE_BUSY" && /DevEco Studio/.test(error.hint),
  );
});

test("a uitest client stealing the device is named, not left as a puzzling timeout", async (t) => {
  const fake = await makeUiHdc();
  const body = (await fs.readFile(fake.executable, "utf8")).replace(
    "*dumpLayout*) printf 'DumpLayout saved to:/d/x.json\\n' ;;",
    "*dumpLayout*) printf 'DumpLayout failed:Wait for subscribe uitest.broadcast.command.reply timeout\\n' ;;",
  );
  await fs.writeFile(fake.executable, body, { mode: 0o755 });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await assert.rejects(
    () => withHdcPath(fake.executable, () => uiFind({ text: "x" })),
    (error) => error.code === "UI_DEVICE_BUSY" && /another uitest client/.test(error.message),
  );
});

// --- selector-aimed taps ------------------------------------------------------------------------

test("ui_tap aims at a node instead of a coordinate", async (t) => {
  // Coordinates go stale: (639,541) addressed a home-screen widget and, once the notification
  // shade was pulled down, the notification list -- same point, different element. Resolving and
  // tapping under one lock hold shrinks that window to a single hdc round trip.
  const fake = await makeUiHdc({
    recv: `case "$last" in *json*) printf '%s' '${JSON.stringify(SAMPLE_DUMP)}' > "$last" ;;`
      + ' *) write_jpeg "$last" ;; esac',
  });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  const report = await withHdcPath(fake.executable, () => uiTap({ action: "click", key: "tab_tools" }));
  assert.equal(report.sent, "uitest uiInput click 640 2710");
  assert.equal(report.target.key, "tab_tools");
  assert.ok(report.structureSignature, "the signature lets a caller tell whether the tap changed anything");

  const argv = await fake.argv();
  const order = argv.filter((line) => /dumpLayout|uiInput/.test(line)).map((line) => (line.includes("dumpLayout") ? "dump" : "tap"));
  assert.deepEqual(order, ["dump", "tap"], "the dump must immediately precede the tap");
});

test("ui_tap refuses to guess which of several matches to hit", async (t) => {
  const fake = await makeUiHdc({
    recv: `case "$last" in *json*) printf '%s' '${JSON.stringify(SAMPLE_DUMP)}' > "$last" ;;`
      + ' *) write_jpeg "$last" ;; esac',
  });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  await withHdcPath(fake.executable, async () => {
    // An agent handed "the first of several" has no way to know it hit the wrong one; a refusal
    // that lists the candidates is something it can act on.
    await assert.rejects(
      () => uiTap({ action: "click", type: "Text" }),
      (error) => error.code === "UI_TARGET_AMBIGUOUS" && /Candidates:/.test(error.hint),
    );
    await assert.rejects(
      () => uiTap({ action: "click", key: "does-not-exist" }),
      (error) => error.code === "UI_TARGET_NOT_FOUND",
    );
    // Selector gestures are accepted only when their start and end percentages are explicit.
    await assert.rejects(
      () => uiTap({ action: "swipe", key: "tab_tools" }),
      (error) => error.code === "UI_ARGS_INVALID" && /from_percent and to_percent/.test(error.message),
    );
  });
  assert.equal((await fake.argv()).filter((line) => line.includes("uiInput")).length, 0);
});

test("the device's own clickable flag breaks a nested tie, but two real targets still refuse", async (t) => {
  // Visible text almost always matches twice: on a real screen a tab arrived as Column "首页"
  // clickable=true wrapping Text "首页" clickable=false. Refusing there would make text selectors
  // nearly unusable, and taking the one node the device calls tappable is not a guess -- the other
  // cannot be tapped at all.
  const nested = {
    attributes: { type: "root", bounds: "[0,0][1276,2848]" },
    children: [{
      attributes: { type: "Column", bounds: "[120,2568][328,2736]", text: "首页", clickable: "true" },
      children: [{ attributes: { type: "Text", bounds: "[188,2677][259,2718]", text: "首页", clickable: "false" } }],
    }],
  };
  const fake = await makeUiHdc({
    recv: `case "$last" in *json*) printf '%s' '${JSON.stringify(nested)}' > "$last" ;;`
      + ' *) write_jpeg "$last" ;; esac',
  });
  t.after(async () => await fs.rm(fake.directory, { recursive: true, force: true }));

  const report = await withHdcPath(fake.executable, () => uiTap({ action: "click", text: "首页" }));
  assert.equal(report.sent, "uitest uiInput click 224 2652", "the tappable container, not the label");
  assert.equal(report.target.disambiguatedBy, "clickable");

  // Two genuinely tappable matches are a real ambiguity and must still refuse.
  const twoButtons = {
    attributes: { type: "root", bounds: "[0,0][1276,2848]" },
    children: [
      { attributes: { type: "Button", bounds: "[0,0][100,50]", text: "删除", clickable: "true" } },
      { attributes: { type: "Button", bounds: "[0,200][100,250]", text: "删除", clickable: "true" } },
    ],
  };
  const ambiguous = await makeUiHdc({
    recv: `case "$last" in *json*) printf '%s' '${JSON.stringify(twoButtons)}' > "$last" ;;`
      + ' *) write_jpeg "$last" ;; esac',
  });
  t.after(async () => await fs.rm(ambiguous.directory, { recursive: true, force: true }));
  await assert.rejects(
    () => withHdcPath(ambiguous.executable, () => uiTap({ action: "click", text: "删除" })),
    (error) => error.code === "UI_TARGET_AMBIGUOUS",
  );
});

test("a child that accepts calls but never answers is torn down, then short-circuited", { timeout: 60000 }, async (t) => {
  // The SDK already bounded calls at 60s, so they were never unbounded -- but a bound is not a
  // recovery. Nothing reacted to it, so the wedged child stayed wedged and every later call paid
  // the full wait again. This is the other half: tear the child down, and stop re-paying.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-codegenie-deaf-"));
  const entry = path.join(directory, "answers-handshake-only.mjs");
  await fs.writeFile(entry, `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
    if (message.method === "initialize") {
      reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "deaf", version: "0" } });
    } else if (message.method === "tools/list") {
      reply({ tools: [{ name: "check_cpp_files", description: "stub", inputSchema: { type: "object" } }] });
    }
    // tools/call is deliberately never answered.
  }
});
setInterval(() => {}, 1000);
`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: REPO_ROOT,
    env: { ...process.env, DEVECO_CODEGENIE_ENTRY: entry, DEVECO_CODEGENIE_CALL_TIMEOUT_MS: "500" },
    stderr: "ignore",
  });
  const client = new Client({ name: "deveco-deaf-test", version: "0.1.0" });
  t.after(async () => {
    await transport.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await client.connect(transport);

  const call = async () => {
    const startedAt = Date.now();
    const result = await client.callTool({ name: "check_cpp_files", arguments: { files: ["/tmp/x.cpp"] } });
    return { code: JSON.parse(result.content[0].text).code, ms: Date.now() - startedAt, isError: result.isError };
  };

  const first = await call();
  assert.equal(first.isError, true);
  assert.equal(first.code, "CODEGENIE_TIMEOUT");
  assert.ok(first.ms >= 500, `must wait out the deadline, took ${first.ms}ms`);
  assert.equal((await call()).code, "CODEGENIE_TIMEOUT");
  assert.equal((await call()).code, "CODEGENIE_TIMEOUT");

  // Three in a row is enough to stop rediscovering it the expensive way.
  const tripped = await call();
  assert.equal(tripped.code, "CODEGENIE_CIRCUIT_OPEN");
  assert.ok(tripped.ms < 400, `an open circuit must fail immediately, took ${tripped.ms}ms`);

  // An explicit restart is the operator saying the cause is handled, so it clears the streak.
  const restart = await client.callTool({ name: "deveco_restart", arguments: { target: "cpp" } });
  assert.equal(restart.isError, false);
  const afterRestart = await call();
  assert.equal(afterRestart.code, "CODEGENIE_TIMEOUT", "the breaker must reopen for a real attempt");

  // Local tools never depended on that child and must be unaffected throughout.
  const status = await client.callTool({ name: "deveco_status", arguments: {} });
  assert.equal(status.isError, false);
});

test("ifChangedFrom answers with a boolean instead of a frame the caller already has", async (t) => {
  // The two halves of an observation cost very differently: a capture and pull is ~392ms, while
  // uitest dumpLayout alone is ~1200ms and is a floor rather than an overhead -- a resident
  // start-daemon moved it by 5ms, -b saved under 20% while dropping the other windows, and
  // -m false was slower. So the remaining saving is to skip the dump, and comparing frames is how
  // a caller knows that is safe. The encoder is deterministic: 8 consecutive captures of a still
  // screen produced one digest.
  const fake = await makeUiHdc();
  const target = uiTempTarget("signature.jpeg");
  t.after(async () => {
    await fs.rm(fake.directory, { recursive: true, force: true });
    await fs.rm(target, { force: true });
    await fs.rm(path.join(os.tmpdir(), "deveco-ui", fake.device), { recursive: true, force: true });
  });

  const first = await withHdcPath(fake.executable, () => uiSnapshot({ localPath: target }));
  assert.match(first.frameSignature, /^[0-9a-f]{32}$/);
  assert.equal(first.unchanged, undefined, "nothing to compare against on the first capture");

  const again = await withHdcPath(fake.executable, () => uiSnapshot({
    localPath: target, ifChangedFrom: first.frameSignature, overwrite: true,
  }));
  assert.equal(again.unchanged, true);
  assert.equal(again.frameSignature, first.frameSignature);
  // The capture still ran -- asking the question must never cost more than not asking it.
  assert.equal((await fake.argv()).filter((line) => line.includes("snapshot_display")).length, 2);

  const mismatched = await withHdcPath(fake.executable, () => uiSnapshot({
    localPath: target, ifChangedFrom: "0".repeat(32), overwrite: true,
  }));
  assert.equal(mismatched.unchanged, undefined, "a different screen must report as changed");
});
