// Real editor-facing SDK stdio: no fake server, build, installation, or protocol fallback.
// From the repository root: node --test --test-concurrency=1 test/e2e/lsp.test.mjs
// Requires a current build, configured SDK, E2E_DIR, and E2E_PROJECT=FullProbe with
// Util.ets (leaf hover), napi_init.cpp (Add symbols), and an existing compile_commands.json.
// POSIX only: each CLI owns a detached process group; cleanup never selects by process name.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { sourceFingerprint, verifyBuild } from "../../bin/runtime.mjs";
import { required, session, sha } from "../support/acceptance.mjs";

const root = path.resolve(import.meta.dirname, "../..");

async function bounded(promise, milliseconds, label, signal) {
  let timer, abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms`)), milliseconds);
      abort = () => reject(signal.reason ?? new Error(`${label} aborted`));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

async function exercise(t, context, project, language, ending) {
  // Prevent the launcher's rebuild path: missing/stale outputs are a prerequisite failure.
  verifyBuild(root, sourceFingerprint(root));
  const name = `${language}-${ending}`, directory = path.join(context.directory, name);
  fs.mkdirSync(directory, { mode: 0o700 });
  const logs = Object.fromEntries(["stdin", "stdout", "stderr", "writes"].map((stream) => [stream, path.join(directory, `${stream}.${stream === "writes" ? "jsonl" : "bin"}`)]));
  for (const file of Object.values(logs)) fs.writeFileSync(file, "", { flag: "wx", mode: 0o600 });
  const relative = language === "arkts" ? "entry/src/main/ets/pages/Util.ets" : "entry/src/main/cpp/napi_init.cpp";
  const file = path.join(project, relative), text = fs.readFileSync(file, "utf8"), before = sha(fs.readFileSync(file));
  const uri = pathToFileURL(file).href, folder = { uri: pathToFileURL(project).href, name: path.basename(project) };
  const expected = language === "arkts" ? "leaf" : "Add";
  assert.match(text, new RegExp(`\\b${expected}\\s*\\(`), `FullProbe must contain ${relative}:${expected}`);
  // Select the capability before contacting the SDK; never retry another probe after failure.
  const probe = language === "arkts" ? { method: "textDocument/hover", capability: "hoverProvider" }
    : { method: "textDocument/documentSymbol", capability: "documentSymbolProvider" };
  if (language === "arkts") {
    const declaration = /\bfunction\s+leaf\s*\(/.exec(text);
    assert.ok(declaration, "FullProbe must declare the leaf function");
    const prefix = text.slice(0, declaration.index + declaration[0].lastIndexOf("leaf")).split(/\r?\n/);
    probe.position = { line: prefix.length - 1, character: prefix.at(-1).length + 1 };
  }
  const interrupted = language === "cpp" && ["eof", "sigterm"].includes(ending);
  const exitContract = { kind: interrupted ? "expected_transport_interruption" : ["exit", "fragmented-exit"].includes(ending) ? "normal_protocol_exit" : "disconnect_boundary",
    expected_code: interrupted ? 1 : 0, verified: false,
    expected_diagnostic: interrupted ? `Transport error: ${ending === "eof" ? "Input/output error" : "Got signal, shutting down"}` : null };
  const args = [path.join(root, "bin/deveco-mcp.mjs"), "serve-lsp", "--project", project, ...(language === "cpp" ? ["--cpp"] : [])];
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0), sequence = 0, inputOffset = 0, frames = 0, pending, protocolFailure, failure, exit, initialized, observed;
  let groupGone = false;
  const cleanupSignals = [], cleanupEscalations = [];
  const fail = (error) => { protocolFailure ??= error; pending?.reject(error); };
  const closed = new Promise((resolve) => child.once("close", (code, signal) => {
    exit = { code, signal }; resolve(exit);
    if (pending) fail(new Error(`serve-lsp exited before its response: ${JSON.stringify(exit)}`));
  }));
  child.on("error", fail);
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on("error", fail);
  const write = (bytes, purpose) => {
    if (protocolFailure) throw protocolFailure;
    assert.ok(!child.stdin.destroyed && !child.stdin.writableEnded, "CLI input closed before the requested boundary");
    fs.appendFileSync(logs.stdin, bytes);
    fs.appendFileSync(logs.writes, JSON.stringify({ at: new Date().toISOString(), offset: inputOffset, bytes: bytes.length, purpose }) + "\n");
    inputOffset += bytes.length;
    child.stdin.write(bytes);
  };
  const frame = (message) => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
  };
  const send = (message) => write(frame(message), message.method ?? "server-request-response");
  const accept = (message) => {
    assert.ok(message && typeof message === "object" && !Array.isArray(message));
    assert.equal(message.jsonrpc, "2.0", "stdout must contain JSON-RPC, not CLI log text");
    if (typeof message.method === "string") {
      if (message.id === undefined) return; // Notifications remain in the unmodified stdout evidence.
      let result;
      if (message.method === "workspace/configuration") {
        assert.ok(Array.isArray(message.params?.items)); result = message.params.items.map(() => null);
      } else if (message.method === "workspace/workspaceFolders") result = [folder];
      else if (["client/registerCapability", "client/unregisterCapability", "window/workDoneProgress/create", "window/showMessageRequest"].includes(message.method)) result = null;
      else { send({ id: message.id, error: { code: -32601, message: "Unsupported request in read-only E2E client" } }); return; }
      send({ id: message.id, result }); return;
    }
    assert.ok(pending && message.id === pending.id, `Unexpected response id: ${message.id}`);
    assert.notEqual(Object.hasOwn(message, "result"), Object.hasOwn(message, "error"), "A response needs exactly one result or error");
    if (Object.hasOwn(message, "error")) pending.reject(new Error(`SDK response error: ${JSON.stringify(message.error)}`));
    else pending.resolve(message.result);
  };
  // support/mcp is newline JSON; product LspClient silently skips malformed frames and is
  // not a standalone build export. This strict, single-inflight reader checks this CLI boundary.
  child.stdout.on("data", (chunk) => {
    try {
      fs.appendFileSync(logs.stdout, chunk);
      if (protocolFailure) return;
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) { assert.ok(buffer.length <= 8192, "Unframed stdout or oversized LSP header"); return; }
        assert.ok(end <= 8192, "Oversized LSP header");
        const headers = buffer.subarray(0, end).toString("ascii").split("\r\n");
        let length;
        for (const header of headers) {
          const match = /^(Content-Length|Content-Type):[ \t]*(.+)$/i.exec(header);
          assert.ok(match, `Non-protocol stdout header: ${header}`);
          if (match[1].toLowerCase() === "content-length") {
            assert.equal(length, undefined, "Duplicate Content-Length"); assert.match(match[2], /^[1-9]\d*$/);
            length = Number(match[2]);
          } else assert.match(match[2], /^application\/vscode-jsonrpc(?:;\s*charset=utf-8)?$/i);
        }
        assert.ok(Number.isSafeInteger(length) && length <= 16 * 1024 * 1024, "Invalid or oversized LSP frame");
        const start = end + 4;
        if (buffer.length < start + length) return;
        const message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(start, start + length)));
        buffer = buffer.subarray(start + length); frames++; accept(message);
      }
    } catch (error) { fail(error); }
  });
  child.stderr.on("data", (chunk) => { try { fs.appendFileSync(logs.stderr, chunk); } catch (error) { fail(error); } });
  const request = async (method, params, milliseconds) => {
    assert.equal(pending, undefined, "Requests in this test are serial");
    if (protocolFailure) throw protocolFailure;
    assert.equal(exit, undefined, "CLI exited before the next request");
    const id = ++sequence;
    try {
      return await bounded(new Promise((resolve, reject) => {
        pending = { id, resolve: (value) => { pending = undefined; resolve(value); }, reject: (error) => { pending = undefined; reject(error); } };
        send({ id, method, params });
      }), milliseconds, `${language} ${method}`, t.signal);
    } finally { pending = undefined; }
  };
  const groupAlive = () => {
    if (groupGone || child.pid === undefined) return false;
    assert.ok(child.pid > 1 && child.pid !== process.pid);
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { if (error.code !== "ESRCH") throw error; groupGone = true; return false; }
  };
  const waitGroup = async (milliseconds) => {
    const deadline = performance.now() + milliseconds;
    while (groupAlive()) {
      assert.ok(performance.now() < deadline, `Owned process group ${child.pid} survived CLI exit`);
      await delay(50);
    }
  };
  try {
    initialized = await request("initialize", {
      processId: process.pid, clientInfo: { name: "deveco-serve-lsp-e2e", version: "1" }, rootUri: folder.uri,
      workspaceFolders: [folder], initializationOptions: {},
      capabilities: { general: { positionEncodings: ["utf-16"] }, workspace: { configuration: true, workspaceFolders: true },
        textDocument: { hover: { contentFormat: ["markdown", "plaintext"] }, documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
    }, 120000);
    assert.ok(initialized?.capabilities && typeof initialized.capabilities === "object");
    const capability = initialized.capabilities[probe.capability];
    assert.ok(capability === true || capability && typeof capability === "object", `SDK must declare the preselected ${probe.capability}`);
    send({ method: "initialized", params: {} });
    send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: language === "arkts" ? "ets" : "cpp", version: 1, text } } });
    const response = await request(probe.method, { textDocument: { uri }, ...(probe.position ? { position: probe.position } : {}) }, 60000);
    if (language === "arkts") {
      observed = response;
      const contents = Array.isArray(observed?.contents) ? observed.contents : [observed?.contents];
      const parts = contents.map((part) => typeof part === "string" ? part : part?.value);
      assert.ok(parts.length && parts.every((part) => typeof part === "string" && part.trim()), "Hover needs nonempty textual contents");
      assert.match(parts.join("\n"), /\bleaf\s*\([^)]*\)\s*:\s*number\b/, "Hover must identify the fixture's leaf signature, not just return an envelope");
    } else {
      assert.ok(Array.isArray(response) && response.length > 0, "A response envelope alone is not code-intelligence evidence");
      const flatten = (items) => items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
      observed = flatten(response).find((symbol) => symbol.name === expected);
      assert.ok(observed, `SDK did not report the fixture symbol ${expected}: ${JSON.stringify(response)}`);
      assert.ok(Number.isInteger(observed.kind) && observed.kind >= 1 && observed.kind <= 26);
    }
    const range = observed.selectionRange ?? observed.location?.range ?? observed.range;
    const lines = text.split(/\r?\n/);
    for (const position of [range?.start, range?.end]) {
      assert.ok(Number.isInteger(position?.line) && position.line >= 0 && position.line < lines.length);
      assert.ok(Number.isInteger(position.character) && position.character >= 0 && position.character <= lines[position.line].length);
    }
    const compare = (a, b) => a.line - b.line || a.character - b.character;
    assert.ok(compare(range.start, range.end) < 0, "SDK source range must be nonempty and ordered");
    if (probe.position) assert.ok(compare(range.start, probe.position) <= 0 && compare(probe.position, range.end) < 0, "Hover range must contain the requested leaf position");
    if (observed.location) assert.equal(observed.location.uri, uri);
    if (ending === "eof") child.stdin.end();
    else if (ending === "sigterm") assert.equal(child.kill("SIGTERM"), true, "Signal only this CLI; it must forward to its SDK child");
    else {
      assert.equal(await request("shutdown", null, 15000), null);
      if (ending === "fragmented-exit") {
        const bytes = frame({ method: "exit", params: null }), marker = Buffer.from('"method":"ex');
        const split = bytes.indexOf(marker) + marker.length;
        assert.ok(split >= marker.length && split < bytes.length);
        write(bytes.subarray(0, split), "exit-part-1"); await delay(100, undefined, { signal: t.signal });
        write(bytes.subarray(split), "exit-part-2");
        // Two writes are recorded, not claimed to guarantee two reader chunks.
      } else send({ method: "exit", params: null });
      assert.equal(child.stdin.writableEnded, false, "EOF must not mask the exit-notification path");
    }
    const result = await bounded(closed, 15000, `${language} ${ending} exit`, t.signal);
    assert.deepEqual(result, { code: exitContract.expected_code, signal: null }, `CLI must meet its ${exitContract.kind} contract without test cleanup assistance`);
    if (interrupted) {
      // This clangd reports an intentional ungraceful disconnect as code 1, not a successful shutdown.
      const stderr = fs.readFileSync(logs.stderr, "utf8");
      assert.match(stderr, new RegExp(`^E\\[[0-9:.]+\\] ${exitContract.expected_diagnostic}\\r?\\n?$`), "Only the corresponding SDK transport diagnostic is expected");
    }
    await waitGroup(5000);
    if (protocolFailure) throw protocolFailure;
    assert.equal(buffer.length, 0, "Truncated frame or non-protocol trailing stdout");
    assert.ok(frames >= 2);
    assert.equal(sha(fs.readFileSync(file)), before, "Read-only LSP requests must not change fixture sources");
    exitContract.verified = true;
  } catch (error) { failure = error; throw error; }
  finally {
    const errors = [];
    try {
      if (groupAlive()) {
        cleanupSignals.push("SIGTERM"); process.kill(-child.pid, "SIGTERM");
        try { await waitGroup(3000); }
        catch (term) {
          if (!groupAlive()) throw term;
          cleanupEscalations.push(term.stack);
          try { cleanupSignals.push("SIGKILL"); process.kill(-child.pid, "SIGKILL"); await waitGroup(5000); }
          catch (kill) { throw new AggregateError([term, kill], "Owned process-group cleanup failed", { cause: term }); }
        }
      }
      await bounded(closed, 5000, "owned CLI close during cleanup");
    } catch (cleanup) { errors.push(cleanup); }
    try {
      context.receipt(`${name}.json`, { command: [process.execPath, ...args], project, language, ending, pid: child.pid,
        logs, frames, remaining_stdout_bytes: buffer.length, initialized, probe, observed,
        static_document_symbol_provider_present: initialized?.capabilities ? Object.hasOwn(initialized.capabilities, "documentSymbolProvider") : null,
        exit, exit_contract: exitContract, group_gone: groupGone,
        error: failure?.stack, protocol_error: protocolFailure?.stack, cleanup_signals: cleanupSignals,
        cleanup_escalations: cleanupEscalations, cleanup_errors: errors.map((error) => error.stack) });
    } catch (evidence) { errors.push(evidence); }
    if (errors.length) throw new AggregateError([...(failure ? [failure] : []), ...errors], "serve-lsp check and cleanup/evidence failed", { cause: failure });
  }
}

test("serve-lsp real SDK protocol and process lifecycle", { timeout: 1800000 }, async (t) => {
  assert.notEqual(process.platform, "win32", "This E2E requires POSIX process-group ownership checks");
  const project = required("E2E_PROJECT"); assert.ok(path.isAbsolute(project));
  assert.ok(fs.statSync(path.join(project, "build-profile.json5")).isFile());
  verifyBuild(root, sourceFingerprint(root));
  const context = await session(t);
  for (const language of ["arkts", "cpp"]) {
    const endings = language === "arkts" ? ["exit", "fragmented-exit", "eof", "sigterm"] : ["exit", "eof", "sigterm"];
    for (const ending of endings) await t.test(`${language} ${ending}`, { timeout: 240000 },
      (child) => exercise(child, context, project, language, ending));
  }
});
