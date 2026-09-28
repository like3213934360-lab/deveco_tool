import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { artifactPath, commitArtifact, saveArtifact } from "../core/artifacts.js";
import { packageRoot } from "../core/config.js";
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
  const request = { project: projectRoot, files: (files ?? []).map((f) => path.resolve(projectRoot, f)), fix };
  const result = await checkers.use(tc.root, startChecker, (proc) => new Promise<any>((resolve, reject) => {
    const id = proc.nextId++;
    const timer = setTimeout(() => { proc.pending.delete(id); reject(new ToolError("TIMEOUT", "ArkTS check timed out after 180s")); }, 180000);
    signal.addEventListener("abort", () => { clearTimeout(timer); proc.pending.delete(id); reject(new ToolError("CANCELLED", "Cancelled")); }, { once: true });
    proc.pending.set(id, (value) => { clearTimeout(timer); resolve(value); });
    proc.child.stdin!.write(JSON.stringify({ id, ...request }) + "\n");
  }));
  invariant(!result?.error, "CHECK_FAILED", `ArkTS check could not run: ${result?.error}`);
  const issues: CheckIssue[] = (result.errors ?? []).map((e: Record<string, unknown>) => ({
    file: path.relative(projectRoot, String(e.file ?? e.filePath ?? "")),
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

export async function codeLinter(projectRoot: string, options: { path?: string; fix?: boolean; product?: string }, signal: AbortSignal) {
  const tc = toolchain();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-lint-"));
  try {
    const report = path.join(dir, "report.json");
    const configFile = path.join(projectRoot, "code-linter.json5");
    const args = [
      ...(tc.kind === "clt" ? [tc.sdk] : []),
      ...(isFile(configFile) ? ["--config", configFile] : []),
      ...(options.product ? ["--product", options.product] : []),
      "--format", "json", "--output", report,
      ...(options.fix ? ["--fix"] : []),
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

/** Command line of the SDK language server (shared by MCP sessions and `serve-lsp`). */
export function lspCommand(project: string, language: "arkts" | "cpp") {
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
    args: ["--max-old-space-size=2048", component("arkts", tc), "--stdio", "--logger-level=ERROR", `--projectPath=${root}`, `--sdkPath=${tc.sdk}`],
    cwd: root, env: { ...process.env, DEVECO_SDK_HOME: tc.sdk } as Record<string, string | undefined>,
  };
}

async function startLsp(root: string, language: "arkts" | "cpp"): Promise<LspSession> {
  const cmd = lspCommand(root, language);
  const child = spawnManaged(cmd);
  const client = new LspClient(child);
  const session: LspSession = {
    client, root, language, opened: new Map(), diagnostics: new Map(),
    ready: Promise.resolve(),
    close: () => client.close(),
  };
  client.onNotification("textDocument/publishDiagnostics", (params: { uri: string; diagnostics: any[] }) => {
    session.diagnostics.set(params.uri, { at: Date.now(), items: params.diagnostics });
  });
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
          definition: { linkSupport: true }, implementation: { linkSupport: true }, references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          completion: { completionItem: { snippetSupport: false, documentationFormat: ["markdown", "plaintext"] } },
          signatureHelp: { signatureInformation: { documentationFormat: ["markdown", "plaintext"] } },
        },
        workspace: { symbol: {}, configuration: true },
      },
      initializationOptions: {},
    }, 120000);
    client.notify("initialized", {});
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
  const order = line === undefined
    ? lines.map((_, i) => i)
    : lines.map((_, i) => i).sort((a, b) => Math.abs(a - (line - 1)) - Math.abs(b - (line - 1)));
  const pattern = new RegExp(`(^|[^A-Za-z0-9_$])(${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![A-Za-z0-9_$])`);
  for (const i of order) {
    const match = pattern.exec(lines[i]!);
    if (match) return { line: i, character: match.index + match[1]!.length };
  }
  throw new ToolError("NOT_FOUND", `Symbol ${symbol} not found in file`, undefined, "Check spelling or pass line/column");
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
  const rel = path.relative(root, file);
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
      return (parsed.info ?? []).map((i) => [
        i.code?.value ? "```ts\n" + i.code.value + "\n```" : "",
        ...(i.data ?? []).map((d) => [d.document, ...(d.tags ?? []).slice(0, 6)].filter(Boolean).join("\n")),
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

export type LspAction = "hover" | "definition" | "implementation" | "references" | "symbols" | "workspace_symbols" | "diagnostics" | "completion" | "signature";

export async function lsp(input: {
  project: string; action: LspAction; file?: string; files?: string[]; symbol?: string; line?: number; column?: number; query?: string; language?: "arkts" | "cpp"; limit?: number;
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
        const since = Date.now();
        const deadline = since + 15000;
        let entry = session.diagnostics.get(uri);
        while ((!entry || entry.at < since - 50) && Date.now() < deadline) {
          signal.throwIfAborted();
          await new Promise((r) => setTimeout(r, 100));
          entry = session.diagnostics.get(uri);
        }
        for (const d of entry?.items ?? [])
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
      case "implementation": {
        const result = await session.client.request<any>(`textDocument/${input.action}`, params, 20000, signal);
        const list = (Array.isArray(result) ? result : result ? [result] : []).slice(0, 10);
        return { locations: list.map((l) => location(l, root, true)) };
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

export async function restartLsp(project: string) {
  const root = path.resolve(project);
  for (const language of ["arkts", "cpp"]) await sessions.close(`${root}|${language}`);
  return { restarted: true };
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

export async function apiScan(project: string, options: { from?: string; to?: string; files?: string[] }, signal: AbortSignal) {
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
    } else args.push("--projectPath", project);
    const result = await run(toolCommand("apiscan", args, path.dirname(component("apiscan", tc))), { signal, timeoutMs: 600000, allowFailure: true, logFile: file });
    await commitArtifact(id, file, "text/plain");
    const csv = [...walk(out, new Set())].find((f) => f.endsWith(".csv"));
    invariant(csv, "CHECK_FAILED", "API scan produced no report", { exit_code: result.code, log_artifact: id, tail: (result.stderr || result.stdout).slice(-1500) });
    const content = fs.readFileSync(csv, "utf8");
    const rows = content.split(/\r?\n/).filter(Boolean);
    const artifact = await saveArtifact(content, "text/plain");
    return { from, to, findings: Math.max(0, rows.length - 1), preview: rows.slice(0, 31).join("\n"), report_artifact: artifact.artifact_id, log_artifact: id };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}
