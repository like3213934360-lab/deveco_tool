import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { artifactPath, commitArtifact, saveArtifact } from "../core/artifacts.js";
import { packageRoot, stateDir } from "../core/config.js";
import { invariant, ToolError } from "../core/errors.js";
import { isFile, sha256, walk } from "../core/files.js";
import { LspClient } from "../core/lsp-client.js";
import { run, spawnManaged } from "../core/proc.js";
import { pool } from "../core/sessions.js";
import { component, toolCommand, toolchain } from "../core/toolchain.js";
import { buildFailureHints } from "./diagnose.js";

/* ------------------------------ ArkTS static check ------------------------------ */

export interface CheckIssue { file: string; line: number; column: number; severity: string; message: string; rule?: string }

interface CheckerProcess {
  child: ReturnType<typeof spawnManaged>;
  pending: Map<number, (value: any) => void>;
  nextId: number;
  close(): void;
}

/**
 * Warm checker daemon (vendored upstream arkts-check.cjs --serve): the first
 * check pays ~6s to build the SDK type graph, later checks ~2s. Pooled per
 * toolchain and closed after the idle timeout.
 */
const checkers = pool<CheckerProcess>(1);

function startChecker(): Promise<CheckerProcess> {
  const tc = toolchain();
  const script = path.join(packageRoot, "resources/vendor/arkts-check.cjs");
  const child = spawnManaged({
    file: component("node", tc),
    args: ["--max-old-space-size=2048", "--expose-gc", script, "--serve"],
    env: { ...process.env, DEVECO_HOME: tc.content },
  });
  const proc: CheckerProcess = {
    child, pending: new Map(), nextId: 1,
    close: () => { try { child.stdin?.end(JSON.stringify({ shutdown: true }) + "\n"); } catch { /* ignore */ } setTimeout(() => child.kill("SIGKILL"), 2000).unref(); },
  };
  return new Promise((resolve, reject) => {
    let buffer = "";
    let ready = false;
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message: { ready?: boolean; id?: number; result?: unknown };
        try { message = JSON.parse(line); } catch { continue; }
        if (message.ready && !ready) { ready = true; resolve(proc); continue; }
        if (message.id !== undefined) { proc.pending.get(message.id)?.(message.result); proc.pending.delete(message.id); }
      }
    });
    child.stderr?.resume();
    child.once("exit", () => {
      // A dead daemon must leave the pool, or every later check would write into a closed pipe and wait forever.
      void checkers.closeIf(tc.root, proc);
      for (const done of proc.pending.values()) done({ success: false, error: "ArkTS checker exited", errors: [], summary: { errorCount: 0, warnCount: 0 } });
      proc.pending.clear();
      if (!ready) reject(new ToolError("CHECK_FAILED", "ArkTS checker failed to start"));
    });
    setTimeout(() => !ready && reject(new ToolError("TIMEOUT", "ArkTS checker did not start in 60s")), 60000).unref();
  });
}

export async function arktsCheck(projectRoot: string, files: string[] | undefined, signal: AbortSignal, fix = false) {
  const tc = toolchain();
  invariant(tc.components.etsLoader, "CAPABILITY_UNAVAILABLE", "SDK ets-loader not found; ArkTS check needs a full SDK");
  const root = path.resolve(projectRoot);
  const request = { project: root, files: (files ?? []).map((f) => path.resolve(root, f)), fix };
  let result = await checkOnce(tc.root, request, signal);
  // The warm daemon died (killed along with a cancelled job, OOM): one retry on a fresh daemon.
  if (result?.error === "ArkTS checker exited") result = await checkOnce(tc.root, request, signal);
  invariant(!result?.error, "CHECK_FAILED", `ArkTS check could not run: ${result?.error}`);
  return formatCheck(result, root, fix);
}

function checkOnce(key: string, request: { project: string; files: string[]; fix: boolean }, signal: AbortSignal): Promise<any> {
  signal.throwIfAborted();
  return checkers.use(key, startChecker, (proc) => new Promise<any>((resolve, reject) => {
    // Pooled daemon died since the last use (killed with a cancelled job's process group, OOM...):
    // report it as retryable instead of writing into a closed pipe and waiting forever.
    if (proc.child.exitCode !== null || proc.child.signalCode !== null || !proc.child.stdin?.writable) {
      void checkers.closeIf(key, proc);
      return resolve({ error: "ArkTS checker exited" });
    }
    const id = proc.nextId++;
    // The daemon handles requests one at a time and cannot abort one midway: an abandoned request
    // (cancelled job, timeout) would keep it busy and stall every later check. Drop the daemon
    // instead; the next check starts a fresh one.
    const abandon = (error: ToolError) => {
      clearTimeout(timer);
      if (!proc.pending.delete(id)) return;
      void checkers.closeIf(key, proc);
      reject(error);
    };
    const timer = setTimeout(() => abandon(new ToolError("TIMEOUT", "ArkTS check timed out after 180s")), 180000);
    signal.addEventListener("abort", () => abandon(new ToolError("CANCELLED", "Cancelled")), { once: true });
    proc.pending.set(id, (value) => { clearTimeout(timer); resolve(value); });
    proc.child.stdin!.write(JSON.stringify({ id, ...request }) + "\n");
  }));
}

function formatCheck(result: any, root: string, fix: boolean) {
  const issues: CheckIssue[] = (result.errors ?? []).map((e: Record<string, unknown>) => ({
    // The checker reports paths relative to the project; make them relative to the project, never to our cwd.
    file: (() => { const f = String(e.file ?? e.filePath ?? ""); return path.relative(root, path.isAbsolute(f) ? f : path.join(root, f)); })(),
    line: Number(e.line ?? 0), column: Number(e.column ?? e.col ?? 0),
    severity: String(e.severity ?? "error"), message: String(e.message ?? ""), rule: e.rule ? String(e.rule) : e.code ? String(e.code) : undefined,
  }));
  return {
    passed: result.summary?.errorCount === 0,
    errors: result.summary?.errorCount ?? 0,
    warnings: result.summary?.warnCount ?? 0,
    files: result.summary?.fileCount,
    issues: issues.sort((a, b) => (a.severity === "error" ? -1 : 1) - (b.severity === "error" ? -1 : 1)).slice(0, 50),
    ...(fix ? { fixed: result.fixed ?? [], also_modified: result.alsoModified ?? [] } : {}),
    hints: buildFailureHints(issues.filter((i) => i.severity === "error").map((i) => ({ code: i.rule, message: i.message }))),
    note: "Static preflight; a successful build is the final proof of compilation",
  };
}

/* ---------------------------------- linter ---------------------------------- */

export async function codeLinter(projectRoot: string, options: { path?: string; fix?: boolean; product?: string; config_path?: string; incremental?: boolean; output_path?: string }, signal: AbortSignal) {
  const tc = toolchain();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-lint-"));
  try {
    const report = path.join(dir, "report.json");
    const configFile = options.config_path ? path.resolve(projectRoot, options.config_path) : path.join(projectRoot, "code-linter.json5");
    invariant(!options.config_path || (isFile(configFile) && /\.json5?$/.test(configFile)), "INVALID_INPUT", "config_path must point to an existing .json or .json5 file");
    const args = [
      ...(tc.kind === "clt" ? [tc.sdk] : []),
      ...(isFile(configFile) ? ["--config", configFile] : []),
      ...(options.product ? ["--product", options.product] : []),
      "--format", "json", "--output", report,
      ...(options.fix ? ["--fix"] : []),
      ...(options.incremental ? ["--incremental"] : []), // only uncommitted files (git)
      path.resolve(projectRoot, options.path ?? "."),
    ];
    const cmd = toolCommand("linter", args, projectRoot, {
      isPlugin: "false", debuggerTriggerCodeLinter: "false", fixKeys: "", targets: "", isTooManyFiles: "false",
      logPath: path.join(dir, "codelinter.log"), TMPDIR: dir, TMP: dir, TEMP: dir,
      PATH: [path.dirname(component("node", tc)), tc.components.java ? path.dirname(tc.components.java) : "", process.env.PATH ?? ""].filter(Boolean).join(path.delimiter),
    });
    const result = await run(cmd, { signal, timeoutMs: 300000, allowFailure: true });
    invariant(isFile(report), "CHECK_FAILED", "Code Linter produced no report", { tail: (result.stderr || result.stdout).slice(-1500) });
    const content = fs.readFileSync(report, "utf8");
    if (options.output_path) exportReport(content, options.output_path);
    const files = JSON.parse(content) as { filePath: string; messages: { line: number; column: number; severity: string | number; message: string; rule: string }[] }[];
    const issues: CheckIssue[] = [];
    const counts: Record<string, number> = {};
    for (const file of files) for (const m of file.messages) {
      const severity = typeof m.severity === "number" ? (m.severity >= 2 ? "error" : "warning") : m.severity.toLowerCase();
      counts[severity] = (counts[severity] ?? 0) + 1;
      issues.push({ file: path.relative(projectRoot, file.filePath), line: m.line, column: m.column, severity, message: m.message, rule: m.rule });
    }
    const rank = (s: string) => (s === "error" ? 0 : s === "warning" || s === "warn" ? 1 : 2);
    issues.sort((a, b) => rank(a.severity) - rank(b.severity));
    const artifact = await saveArtifact(content, "application/json");
    return { counts, total: issues.length, issues: issues.slice(0, 50), report_artifact: artifact.artifact_id, exit_code: result.code };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ----------------------------------- LSP ----------------------------------- */

interface LspSession {
  client: LspClient;
  root: string;
  language: "arkts" | "cpp";
  ready: Promise<void>;
  opened: Map<string, { version: number; hash: string }>;
  diagnostics: Map<string, { at: number; items: any[] }>;
  close(): Promise<void>;
}
const sessions = pool<LspSession>(3);

/**
 * Command line of the SDK language server (shared by MCP sessions and `serve-lsp`).
 * withModel: the caller sends its own project model (initializationOptions.modules), as the MCP
 * session does. Then --sdkPath must NOT be passed: with it the server rebuilds the model itself and
 * derives the HMS path as <sdkPath>/default/hms from <sdk>/default, i.e. sdk/default/default/hms, so
 * every HMS kit (@kit.PushKit, @kit.UIDesignKit...) failed to resolve and hovered as `any`.
 * serve-lsp keeps --sdkPath because editors that do not send modules rely on the server's own model.
 */
export function lspCommand(project: string, language: "arkts" | "cpp", withModel = false) {
  const tc = toolchain();
  const root = path.resolve(project);
  if (language === "cpp") {
    const db = findCompileCommands(root);
    invariant(db, "CAPABILITY_UNAVAILABLE", "C/C++ language service needs compile_commands.json", undefined,
      "Run project action=build task=compileNative to generate the compilation database");
    return { file: component("clangd", tc), args: [`--compile-commands-dir=${path.dirname(db)}`, "--log=error", "--background-index=false", "--pch-storage=memory"], cwd: root, env: process.env as Record<string, string | undefined> };
  }
  return {
    file: component("node", tc),
    args: ["--max-old-space-size=2048", component("arkts", tc), "--stdio", "--logger-level=ERROR", `--projectPath=${root}`, ...(withModel ? [] : [`--sdkPath=${tc.sdk}`])],
    cwd: root, env: { ...process.env, DEVECO_SDK_HOME: tc.sdk } as Record<string, string | undefined>,
  };
}

async function startLsp(root: string, language: "arkts" | "cpp"): Promise<LspSession> {
  const cmd = lspCommand(root, language, true);
  const child = spawnManaged(cmd);
  const client = new LspClient(child);
  const session: LspSession = {
    client, root, language, opened: new Map(), diagnostics: new Map(),
    ready: Promise.resolve(),
    close: () => client.close(),
  };
  // A crashed server leaves the pool so the next request starts a fresh one instead of failing.
  child.once("exit", () => void sessions.closeIf(`${root}|${language}`, session));
  client.onNotification("textDocument/publishDiagnostics", (params: { uri: string; diagnostics: any[] }) => {
    session.diagnostics.set(params.uri, { at: Date.now(), items: params.diagnostics });
  });
  // ArkTS loads the project model asynchronously after initialize; answers before that are file-local only.
  let modulesLoaded!: () => void;
  const moduleInit = new Promise<void>((r) => { modulesLoaded = r; });
  client.onNotification("aceProject/onModuleInitFinish", () => modulesLoaded());
  session.ready = (async () => {
    await client.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: path.basename(root) }],
      capabilities: {
        general: { positionEncodings: ["utf-16"] },
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true }, declaration: { linkSupport: true }, implementation: { linkSupport: true }, references: {}, callHierarchy: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          completion: { completionItem: { snippetSupport: false, documentationFormat: ["markdown", "plaintext"] } },
          signatureHelp: { signatureInformation: { documentationFormat: ["markdown", "plaintext"] } },
        },
        workspace: { symbol: {}, configuration: true },
      },
      // ArkTS: full project model (modules, SDK/HMS paths, resolved ohpm deps) so kits and @module imports resolve.
      initializationOptions: language === "arkts"
        ? (await import("./arktsModules.js")).arktsInitializationOptions(root, toolchain().sdk, stateDir(), component("arkts", toolchain()))
        : {},
    }, 120000);
    client.notify("initialized", {});
    // Bounded wait (large projects index for a while; results are still useful, just less complete).
    if (language === "arkts") await Promise.race([moduleInit, new Promise((r) => setTimeout(r, 60000))]);
  })();
  await session.ready;
  return session;
}

function findCompileCommands(root: string): string | undefined {
  const central = path.join(root, ".idea", ".deveco", "cxx", "compile_commands.json");
  if (isFile(central)) return central;
  for (const file of walk(root, new Set(["node_modules", "oh_modules", ".git", ".hvigor"]))) {
    if (path.basename(file) === "compile_commands.json") return file;
  }
  return undefined;
}

async function sync(session: LspSession, file: string) {
  const uri = pathToFileURL(file).href;
  const text = fs.readFileSync(file, "utf8");
  const hash = sha256(text);
  const state = session.opened.get(uri);
  if (!state) {
    session.opened.set(uri, { version: 1, hash });
    session.client.notify("textDocument/didOpen", { textDocument: { uri, languageId: session.language === "cpp" ? "cpp" : "ets", version: 1, text } });
    // Bound the working set: close the oldest document beyond 40.
    if (session.opened.size > 40) {
      const oldest = session.opened.keys().next().value!;
      session.opened.delete(oldest);
      session.client.notify("textDocument/didClose", { textDocument: { uri: oldest } });
    }
  } else if (state.hash !== hash) {
    state.version++;
    state.hash = hash;
    session.diagnostics.delete(uri);
    session.client.notify("textDocument/didChange", { textDocument: { uri, version: state.version }, contentChanges: [{ text }] });
  }
  return { uri, text };
}

/** Locate a symbol by name near a line hint; models rarely know exact UTF-16 columns. */
export function locate(text: string, symbol: string | undefined, line?: number, column?: number) {
  const lines = text.split("\n");
  if (!symbol) {
    invariant(line !== undefined, "INVALID_INPUT", "Pass symbol (preferred) or line/column");
    return { line: Math.max(0, line - 1), character: Math.max(0, (column ?? 1) - 1) };
  }
  const name = symbol.split(/[.#]/).pop()!;
  // Search code only: comments and string/template contents are blanked (same length, so columns stay exact).
  const code = maskNonCode(lines);
  const order = line === undefined
    ? lines.map((_, i) => i)
    : lines.map((_, i) => i).sort((a, b) => Math.abs(a - (line - 1)) - Math.abs(b - (line - 1)));
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^A-Za-z0-9_$])(${esc})(?![A-Za-z0-9_$])`);
  // Without a line hint, prefer the declaration (function/class/struct/method/property), then any use.
  const declaration = new RegExp(`(^\\s*(?:export\\s+)?(?:default\\s+)?(?:(?:async|static|private|public|protected|readonly|abstract|declare|override)\\s+)*(?:function\\*?\\s+|class\\s+|struct\\s+|interface\\s+|enum\\s+|type\\s+|namespace\\s+|const\\s+|let\\s+|var\\s+|@\\w+\\s+)?)(${esc})\\s*[(<:=]?`);
  if (line === undefined) {
    for (const i of order) {
      const m = declaration.exec(code[i]!);
      if (m && m[1]!.trim().length + m[2]!.length > 0 && code[i]!.slice(m.index + m[1]!.length + m[2]!.length).trimStart().match(/^[(<:={]|^$/)) return { line: i, character: m.index + m[1]!.length };
    }
  }
  for (const i of order) {
    const match = pattern.exec(code[i]!);
    if (match) return { line: i, character: match.index + match[1]!.length };
  }
  throw new ToolError("NOT_FOUND", `Symbol ${symbol} not found in code (comments and strings are ignored)`, undefined, "Check spelling or pass line/column");
}

/** Replace comment and string contents with spaces, keeping line lengths (tracks block comments/templates across lines). */
export function maskNonCode(lines: string[]) {
  let state: "code" | "block" | "template" = "code";
  return lines.map((line) => {
    let out = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!, n = line[i + 1];
      if (state === "block") { if (c === "*" && n === "/") { state = "code"; out += "  "; i++; } else out += " "; continue; }
      if (state === "template") { if (c === "\\") { out += "  "; i++; } else if (c === "`") { state = "code"; out += "`"; } else out += " "; continue; }
      if (c === "/" && n === "/") { out += " ".repeat(line.length - i); break; }
      if (c === "/" && n === "*") { state = "block"; out += "  "; i++; continue; }
      if (c === "`") { state = "template"; out += "`"; continue; }
      if (c === "'" || c === '"') {
        out += c;
        let j = i + 1;
        for (; j < line.length && line[j] !== c; j++) { if (line[j] === "\\") { out += " "; j++; } out += " "; }
        if (j < line.length) out += c;
        i = j;
        continue;
      }
      out += c;
    }
    return out;
  });
}

function snippet(file: string, line: number, context = 3) {
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const from = Math.max(0, line - context);
    return lines.slice(from, line + context + 1).map((l, i) => `${from + i + 1}${from + i === line ? ">" : ":"} ${l}`).join("\n");
  } catch {
    return undefined;
  }
}

function location(loc: any, root: string, withSnippet: boolean) {
  const uri = loc.targetUri ?? loc.uri;
  const range = loc.targetSelectionRange ?? loc.range;
  const file = uri.startsWith("file:") ? fileURLToPath(uri) : uri;
  // clangd reports realpaths (/private/var/... on macOS): compare against the real project root too.
  let rel = path.relative(root, file);
  if (rel.startsWith("..")) { try { rel = path.relative(fs.realpathSync(root), file); } catch { /* keep */ } }
  return {
    file: rel.startsWith("..") ? file : rel,
    line: range.start.line + 1,
    column: range.start.character + 1,
    ...(withSnippet ? { code: snippet(file, range.start.line) } : {}),
  };
}

function hoverText(result: any): string {
  if (!result?.contents) return "";
  const c = result.contents;
  const raw = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : x.value)).join("\n") : c.value ?? "";
  // ArkTS ace-server returns a JSON payload {info:[{code:{value}, data:[{document, tags}]}]}; flatten it.
  if (raw.startsWith("{") && raw.includes('"info"')) {
    try {
      const parsed = JSON.parse(raw) as { info?: { code?: { value?: string }; data?: { document?: string; tags?: string[] }[] }[] };
      // The server HTML-escapes code (Promise&lt;string&gt;); agents need the literal signature.
      const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      return (parsed.info ?? []).map((i) => [
        i.code?.value ? "```ts\n" + unescape(i.code.value) + "\n```" : "",
        // Keep version/support tags even when a long @throws list precedes them.
        ...(i.data ?? []).map((d) => {
          const tags = d.tags ?? [];
          const key = tags.filter((t) => /^@(since|deprecated|atomicservice|crossplatform|syscap|stagemodelonly|systemapi|permission)\b/.test(t));
          const rest = tags.filter((t) => !key.includes(t)).slice(0, 6);
          return [d.document, ...rest, ...key].filter(Boolean).join("\n");
        }),
      ].filter(Boolean).join("\n")).join("\n\n").slice(0, 6000);
    } catch { /* fall through */ }
  }
  return raw.slice(0, 6000);
}

function flattenSymbols(items: any[], out: any[] = [], depth = 0): any[] {
  const kinds: Record<number, string> = { 5: "class", 6: "method", 7: "property", 8: "field", 9: "constructor", 10: "enum", 11: "interface", 12: "function", 13: "variable", 14: "constant", 23: "struct" };
  for (const s of items ?? []) {
    const range = s.selectionRange ?? s.range ?? s.location?.range;
    out.push({ name: s.name, kind: kinds[s.kind] ?? s.kind, line: (range?.start.line ?? 0) + 1, depth });
    if (s.children) flattenSymbols(s.children, out, depth + 1);
    if (out.length > 300) break;
  }
  return out;
}

export type LspAction = "hover" | "definition" | "declaration" | "implementation" | "references" | "symbols" | "workspace_symbols" | "diagnostics" | "completion" | "signature" | "call_hierarchy";

export async function lsp(input: {
  project: string; action: LspAction; file?: string; files?: string[]; symbol?: string; line?: number; column?: number; query?: string; language?: "arkts" | "cpp"; limit?: number; direction?: "incoming" | "outgoing";
}, signal: AbortSignal) {
  const root = path.resolve(input.project);
  const language = input.language ?? (input.file && /\.(c|cc|cpp|h|hpp)$/.test(input.file) ? "cpp" : "arkts");
  return sessions.use(`${root}|${language}`, () => startLsp(root, language), async (session) => {
    const limit = input.limit ?? 30;
    if (input.action === "workspace_symbols") {
      invariant(input.query, "INVALID_INPUT", "query is required");
      const result = await session.client.request<any[]>("workspace/symbol", { query: input.query }, 20000, signal);
      return { symbols: (result ?? []).slice(0, limit).map((s) => ({ name: s.name, container: s.containerName, ...location(s.location, root, false) })) };
    }
    if (input.action === "diagnostics") {
      const files = (input.files ?? (input.file ? [input.file] : [])).map((f) => path.resolve(root, f));
      invariant(files.length, "INVALID_INPUT", "Pass file or files");
      const out: Record<string, unknown>[] = [];
      for (const file of files.slice(0, 20)) {
        const { uri } = await sync(session, file);
        // Pull diagnostics first (what DevEco Studio / deveco-cli use for ArkTS: the ets-lint result
        // with module resolution done by the server); push notifications are the fallback (clangd).
        let items: any[] | undefined;
        if (language === "arkts") {
          const pulled = await session.client.request<any>("textDocument/diagnostic", { textDocument: { uri } }, 30000, signal).catch(() => undefined);
          if (Array.isArray(pulled?.items)) items = pulled.items;
        }
        if (!items) {
          const since = Date.now();
          const deadline = since + 15000;
          let entry = session.diagnostics.get(uri);
          while ((!entry || entry.at < since - 50) && Date.now() < deadline) {
            signal.throwIfAborted();
            await new Promise((r) => setTimeout(r, 100));
            entry = session.diagnostics.get(uri);
          }
          items = entry?.items ?? [];
        }
        for (const d of items)
          out.push({ file: path.relative(root, file), line: d.range.start.line + 1, column: d.range.start.character + 1, severity: ["", "error", "warning", "info", "hint"][d.severity ?? 1], code: d.code, message: d.message });
      }
      const errors = out.filter((d) => d.severity === "error");
      return {
        errors: errors.length, warnings: out.filter((d) => d.severity === "warning").length,
        diagnostics: out.sort((a, b) => (a.severity === "error" ? -1 : 1) - (b.severity === "error" ? -1 : 1)).slice(0, limit),
        hints: buildFailureHints(errors.map((e) => ({ code: e.code ? String(e.code) : undefined, message: String(e.message) }))),
      };
    }
    invariant(input.file, "INVALID_INPUT", "file is required");
    const file = path.resolve(root, input.file);
    invariant(isFile(file), "NOT_FOUND", `${input.file} does not exist`);
    const { uri, text } = await sync(session, file);
    if (input.action === "symbols") {
      const result = await session.client.request<any[]>("textDocument/documentSymbol", { textDocument: { uri } }, 20000, signal);
      return { symbols: flattenSymbols(result ?? []) };
    }
    const position = locate(text, input.symbol, input.line, input.column);
    const params = { textDocument: { uri }, position };
    switch (input.action) {
      case "hover": {
        const result = await session.client.request("textDocument/hover", params, 20000, signal);
        const value = hoverText(result);
        return { position: { line: position.line + 1, column: position.character + 1 }, hover: value || null, ...(value ? {} : { hint: "No type info here; try definition or check the symbol position" }) };
      }
      case "definition":
      case "declaration":
      case "implementation": {
        const result = await session.client.request<any>(`textDocument/${input.action}`, params, 20000, signal);
        const list = (Array.isArray(result) ? result : result ? [result] : []).slice(0, 10);
        return { locations: list.map((l) => location(l, root, true)) };
      }
      case "call_hierarchy": {
        const direction = input.direction ?? "incoming";
        if (language === "cpp" && direction === "outgoing")
          throw new ToolError("CAPABILITY_UNAVAILABLE", "clangd supports incoming calls only", undefined, "Use direction=incoming for C/C++");
        const items = await session.client.request<any[]>("textDocument/prepareCallHierarchy", params, 20000, signal);
        const item = items?.[0];
        if (!item) return { calls: [], hint: "No function at this position; point symbol at a function or method name" };
        const calls = await session.client.request<any[]>(`callHierarchy/${direction}Calls`, { item }, 30000, signal) ?? [];
        const other = (c: any) => (direction === "incoming" ? c.from : c.to);
        return {
          function: { name: item.name, ...location({ uri: item.uri, range: item.selectionRange ?? item.range }, root, false) },
          direction, total: calls.length,
          calls: calls.slice(0, limit).map((c) => ({ name: other(c).name, detail: other(c).detail, ...location({ uri: other(c).uri, range: other(c).selectionRange ?? other(c).range }, root, false), sites: c.fromRanges?.length ?? 0 })),
        };
      }
      case "references": {
        const result = await session.client.request<any[]>("textDocument/references", { ...params, context: { includeDeclaration: false } }, 30000, signal);
        const list = result ?? [];
        return { total: list.length, references: list.slice(0, limit).map((l) => location(l, root, false)) };
      }
      case "completion": {
        const result = await session.client.request<any>("textDocument/completion", params, 20000, signal);
        const items = (Array.isArray(result) ? result : result?.items ?? []) as any[];
        return { total: items.length, items: items.slice(0, limit * 2).map((i) => ({ label: i.label, detail: i.detail, kind: i.kind })) };
      }
      case "signature": {
        // signatureHelp needs a position inside the call's parentheses: step just past "(".
        const line = text.split("\n")[position.line] ?? "";
        const paren = line.indexOf("(", position.character);
        const inside = paren >= 0 ? { line: position.line, character: paren + 1 } : position;
        const result = await session.client.request<any>("textDocument/signatureHelp", { textDocument: { uri }, position: inside }, 20000, signal);
        const signatures = (result?.signatures ?? []).slice(0, 5).map((s: any) => ({ label: s.label, doc: typeof s.documentation === "string" ? s.documentation : s.documentation?.value }));
        if (signatures.length) return { signatures };
        // Fallback: hover carries the full signature for ArkTS methods.
        const hover = hoverText(await session.client.request("textDocument/hover", params, 20000, signal));
        return { signatures: hover ? [{ label: hover.split("\n```")[0]!.replace(/^```ts\n/, ""), doc: hover }] : [] };
      }
    }
    throw new ToolError("INVALID_INPUT", `Unsupported action ${input.action}`);
  });
}

export async function restartLsp(project: string, language: "arkts" | "cpp" | "all" = "all") {
  const root = path.resolve(project);
  const languages = language === "all" ? ["arkts", "cpp"] : [language];
  for (const l of languages) await sessions.close(`${root}|${l}`);
  return { restarted: languages };
}

/** Save a report to a user-chosen absolute path (never overwrites a directory). */
function exportReport(content: string, target: string) {
  invariant(path.isAbsolute(target), "INVALID_INPUT", "output_path must be an absolute file path");
  invariant(!fs.existsSync(target) || fs.statSync(target).isFile(), "INVALID_INPUT", "output_path is a directory");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

/** C/C++ quick check: clangd diagnostics via the pooled session. */
export async function cppCheck(project: string, files: string[], signal: AbortSignal) {
  return lsp({ project, action: "diagnostics", files, language: "cpp" }, signal);
}

/* ------------------------------- API scanning ------------------------------- */

/** Versions the installed scanner knows (HarmonyOS_x.y.z(api)_Release ...). */
export function apiVersions(): string[] {
  const dir = path.join(path.dirname(component("apiscan")), "resources/apiChange");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^HarmonyOS_.+\.json$/.test(f)).map((f) => f.slice(0, -5)) : [];
  return [...new Set(["HarmonyOS_5.0.0(12)_Release", ...files])].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

export async function apiScan(project: string, options: { from?: string; to?: string; files?: string[]; modules?: string[]; output_path?: string }, signal: AbortSignal) {
  const tc = toolchain();
  const versions = apiVersions();
  const from = options.from ?? versions[0];
  const to = options.to ?? versions.at(-1);
  invariant(from && to && versions.includes(from) && versions.includes(to) && versions.indexOf(to) > versions.indexOf(from),
    "INVALID_INPUT", "from/to must be known scanner versions with to later than from", { versions });
  const { id, file } = artifactPath("text/plain");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-apiscan-"));
  try {
    const args = ["--startVersion", from, "--endVersion", to, "--outputPath", out, "--sdkPath", tc.sdk, "--nodePath", component("node", tc)];
    if (options.files?.length) {
      const files = options.files.map((f) => path.resolve(project, f));
      const ets = files.filter((f) => f.endsWith(".ets"));
      const cpp = files.filter((f) => /\.(c|cpp)$/.test(f));
      if (ets.length) args.push("--arkTsFiles", ets.join(","));
      if (cpp.length) args.push("--cppFiles", cpp.join(","));
    } else if (options.modules?.length) {
      const { inspectProject } = await import("./project.js");
      const known = inspectProject(project).modules;
      const paths = options.modules.map((name) => {
        const m = known.find((k) => k.name === name);
        invariant(m, "INVALID_INPUT", `Unknown module ${name}`, { modules: known.map((k) => k.name) });
        return m.root;
      });
      args.push("--modulePaths", paths.join(","));
    } else args.push("--projectPath", project);
    const result = await run(toolCommand("apiscan", args, path.dirname(component("apiscan", tc))), { signal, timeoutMs: 600000, allowFailure: true, logFile: file });
    await commitArtifact(id, file, "text/plain");
    const csv = [...walk(out, new Set())].find((f) => f.endsWith(".csv"));
    invariant(csv, "CHECK_FAILED", "API scan produced no report", { exit_code: result.code, log_artifact: id, tail: (result.stderr || result.stdout).slice(-1500) });
    const content = fs.readFileSync(csv, "utf8");
    const rows = content.split(/\r?\n/).filter(Boolean);
    const artifact = await saveArtifact(content, "text/plain");
    const saved = options.output_path ? exportReport(content, options.output_path) : undefined;
    return { from, to, ...(saved ? { saved } : {}), findings: Math.max(0, rows.length - 1), preview: rows.slice(0, 31).join("\n"), report_artifact: artifact.artifact_id, log_artifact: id };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}
