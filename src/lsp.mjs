import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import { URI } from "vscode-uri";
import { resolveDevecoToolchain, REPO_ROOT } from "./config.mjs";
import { getProjectPath } from "./project-context.mjs";
import { terminateProcessTree } from "./process-tree.mjs";

const BUNDLED_LSP_BINARY = path.join(
  REPO_ROOT,
  "node_modules",
  "@arkts",
  "language-server",
  "bin",
  "ets-language-server.js",
);
const DEFAULT_LSP_TIMEOUT_MS = 15000;
const MAX_LSP_TIMEOUT_MS = 120000;
const LSP_SHUTDOWN_TIMEOUT_MS = 2000;
const RG_OUTPUT_LIMIT = 2 * 1024 * 1024;

function lspBinary() {
  return process.env.ARKTS_LSP_ENTRY
    ? path.resolve(process.env.ARKTS_LSP_ENTRY)
    : BUNDLED_LSP_BINARY;
}

function boundedTimeout(value, fallback = DEFAULT_LSP_TIMEOUT_MS) {
  const parsed = Number(value);
  return Math.min(
    Math.max(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, 1000),
    MAX_LSP_TIMEOUT_MS,
  );
}

const SYMBOL_KIND_NAMES = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
  6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
  11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
  15: "String", 16: "Number", 17: "Boolean", 18: "Array", 19: "Object",
  20: "Key", 21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
  25: "Operator", 26: "TypeParameter",
};

let state = null;
let starting = null;

function filePathToUri(filePath) {
  return URI.file(path.resolve(filePath)).toString();
}

function uriToFilePath(uri) {
  return URI.parse(uri).fsPath;
}

function userPosition(line, column) {
  const lineNumber = Number(line);
  const columnNumber = Number(column);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    const error = new Error("line must be a positive integer (1-based)");
    error.code = "LSP_INVALID_POSITION";
    throw error;
  }
  if (!Number.isInteger(columnNumber) || columnNumber < 1) {
    const error = new Error("column must be a positive integer (1-based)");
    error.code = "LSP_INVALID_POSITION";
    throw error;
  }
  return { line: lineNumber - 1, character: columnNumber - 1 };
}

function fromLspPosition(position) {
  return {
    line: Number(position?.line ?? 0) + 1,
    column: Number(position?.character ?? 0) + 1,
  };
}

function readLine(filePath, line) {
  try {
    return fs.readFileSync(filePath, "utf8").split(/\n/)[line - 1]?.trimEnd() ?? "";
  } catch {
    return "";
  }
}

function languageId(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".ets": return "ets";
    case ".ts": return "typescript";
    case ".tsx": return "typescriptreact";
    case ".js": return "javascript";
    case ".jsx": return "javascriptreact";
    case ".json":
    case ".json5":
    case ".jsonc": return "json";
    default: return "plaintext";
  }
}

function resolveSourcePath(filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    const error = new Error("file/filePath is required");
    error.code = "LSP_FILE_REQUIRED";
    throw error;
  }
  const base = getProjectPath() || process.env.PROJECT_PATH || process.cwd();
  return path.resolve(base, filePath);
}

function activeProjectFor(filePath) {
  const active = getProjectPath() || process.env.PROJECT_PATH;
  if (active) return path.resolve(active);
  // A file is still a useful standalone LSP workspace. This fallback keeps
  // the service usable before switch_cwd while avoiding a fabricated project.
  return path.dirname(resolveSourcePath(filePath));
}

function sdkPath() {
  const configured = process.env.OHOS_SDK_PATH;
  if (configured) return path.resolve(configured);
  const sdk = resolveDevecoToolchain().paths?.sdk;
  return sdk ? path.join(sdk, "default", "openharmony") : "";
}

function disposeInstance(current) {
  if (!current) return;
  try { current.connection.dispose(); } catch { /* already disposed */ }
  if (current.child && !current.child.killed) terminateProcessTree(current.child);
  if (state === current) state = null;
}

function disposeState() {
  disposeInstance(state);
}

function sendLspRequest(current, method, params, timeoutMs) {
  const bounded = boundedTimeout(timeoutMs);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      disposeInstance(current);
      const error = new Error(`ArkTS language server timed out after ${bounded}ms while handling ${method}`);
      error.code = "LSP_TIMEOUT";
      reject(error);
    }, bounded);
    current.connection.sendRequest(method, params).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function start(projectPath, timeoutMs) {
  const binary = lspBinary();
  if (!fs.existsSync(binary)) {
    const error = new Error(`ArkTS language server is not installed: ${binary}`);
    error.code = "LSP_NOT_INSTALLED";
    throw error;
  }

  disposeState();
  const child = spawn(process.execPath, [binary, "--stdio"], {
    cwd: projectPath,
    env: {
      ...process.env,
      ...(sdkPath() ? { OHOS_SDK_PATH: sdkPath() } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.stderr?.on("data", (data) => {
    process.stderr.write(`[deveco-tool/ets-lsp] ${data.toString()}`);
  });
  child.once("error", (error) => {
    process.stderr.write(`[deveco-tool/ets-lsp] ${error.message}\n`);
  });
  child.once("exit", (code, signal) => {
    process.stderr.write(`[deveco-tool/ets-lsp] exited code=${code ?? ""} signal=${signal ?? ""}\n`);
    if (state?.child === child) {
      try { state.connection.dispose(); } catch { /* ignore */ }
      state = null;
    }
  });

  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );
  connection.listen();
  const sdk = sdkPath();
  const initializeParams = {
    processId: process.pid,
    capabilities: {
      textDocument: {
        references: { dynamicRegistration: false },
        definition: { dynamicRegistration: false, linkSupport: true },
        hover: { contentFormat: ["markdown", "plaintext"] },
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        rename: { dynamicRegistration: false },
      },
      workspace: { workspaceFolders: true },
    },
    rootUri: filePathToUri(projectPath),
    workspaceFolders: [{ uri: filePathToUri(projectPath), name: path.basename(projectPath) }],
    initializationOptions: {
      ets: { sdkPath: sdk },
      ...(process.env.TSDK_PATH ? { typescript: { tsdk: process.env.TSDK_PATH } } : {}),
    },
  };
  try {
    const initializing = { child, connection, projectPath, documents: new Map(), capabilities: {} };
    const response = await sendLspRequest(initializing, "initialize", initializeParams, timeoutMs);
    await connection.sendNotification("initialized", {});
    initializing.capabilities = response?.capabilities ?? {};
    state = initializing;
    process.stderr.write(`[deveco-tool/ets-lsp] initialized (${Object.keys(initializing.capabilities).length} capabilities)\n`);
  } catch (error) {
    try { connection.dispose(); } catch { /* ignore */ }
    terminateProcessTree(child);
    throw error;
  }

  return state;
}

async function getState(filePath, timeoutMs) {
  const projectPath = activeProjectFor(filePath);
  if (state?.projectPath === projectPath) return state;
  if (starting) await starting;
  if (state?.projectPath === projectPath) return state;
  starting = start(projectPath, timeoutMs);
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

async function ensureOpen(current, filePath) {
  const absolute = resolveSourcePath(filePath);
  let stat;
  try {
    stat = await fs.promises.stat(absolute);
  } catch {
    stat = null;
  }
  if (!stat?.isFile()) {
    const error = new Error(`Source file does not exist: ${absolute}`);
    error.code = "LSP_FILE_NOT_FOUND";
    throw error;
  }
  const uri = filePathToUri(absolute);
  const text = await fs.promises.readFile(absolute, "utf8");
  const existing = current.documents.get(uri);
  if (!existing) {
    await current.connection.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: languageId(absolute), version: 1, text },
    });
    current.documents.set(uri, { version: 1, text });
  } else if (existing.text !== text) {
    const version = existing.version + 1;
    await current.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
    current.documents.set(uri, { version, text });
  }
  return { absolute, uri };
}

const PREOPEN_EXTENSIONS = new Set([".ets", ".ts"]);
const PREOPEN_SKIP_DIRECTORIES = new Set(["node_modules", "oh_modules", "build", "hvigor", "dist"]);
const PREOPEN_FILE_LIMIT = 400;
const PREOPEN_MAX_DEPTH = 12;

async function collectSourceFiles(directory, results, deadline, scanState, depth = 0) {
  if (depth > PREOPEN_MAX_DEPTH || Date.now() >= deadline) {
    if (Date.now() >= deadline) scanState.truncated = true;
    return results;
  }
  let entries;
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (Date.now() >= deadline) {
      scanState.truncated = true;
      break;
    }
    if (entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (PREOPEN_SKIP_DIRECTORIES.has(entry.name)) continue;
      await collectSourceFiles(full, results, deadline, scanState, depth + 1);
      continue;
    }
    if (!PREOPEN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    if (entry.name.endsWith(".d.ets") || entry.name.endsWith(".d.ts")) continue;
    results.push(full);
  }
  return results;
}

async function rgSourceFiles(projectPath, symbol, timeoutMs) {
  return new Promise((resolve) => {
    const args = [
      "--files-with-matches", "--fixed-strings", "--word-regexp", "--max-count", "1",
      "--glob", "*.ets", "--glob", "*.ts",
      "--glob", "!**/*.d.ets", "--glob", "!**/*.d.ts",
      "--glob", "!**/node_modules/**", "--glob", "!**/oh_modules/**",
      "--glob", "!**/build/**", "--glob", "!**/.hvigor/**", "--glob", "!**/dist/**",
      symbol, ".",
    ];
    const child = spawn("rg", args, {
      cwd: projectPath,
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let output = "";
    let unavailable = false;
    const timer = setTimeout(() => {
      terminateProcessTree(child);
      unavailable = true;
    }, Math.min(boundedTimeout(timeoutMs), 5000));
    child.stdout.on("data", (chunk) => {
      if (output.length < RG_OUTPUT_LIMIT) output += chunk.toString();
    });
    child.once("error", () => {
      unavailable = true;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (unavailable || (code !== 0 && code !== 1)) {
        resolve(null);
        return;
      }
      resolve(output.split(/\r?\n/).filter(Boolean).map((file) => path.resolve(projectPath, file)));
    });
  });
}

async function filesContainingSymbol(projectPath, symbol, timeoutMs) {
  const scanDeadline = Date.now() + Math.min(boundedTimeout(timeoutMs), 5000);
  const fromRg = await rgSourceFiles(projectPath, symbol, Math.max(1000, scanDeadline - Date.now()));
  if (fromRg !== null) return { files: fromRg, scanner: "rg" };

  const scanState = { truncated: false };
  const candidates = await collectSourceFiles(projectPath, [], scanDeadline, scanState);
  const expression = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const matches = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(16, candidates.length) }, async () => {
    while (index < candidates.length && Date.now() < scanDeadline) {
      const candidate = candidates[index++];
      try {
        if (expression.test(await fs.promises.readFile(candidate, "utf8"))) matches.push(candidate);
      } catch {
        // A file can disappear while an editor or build task is replacing it.
      }
    }
  });
  await Promise.all(workers);
  if (index < candidates.length || Date.now() >= scanDeadline) scanState.truncated = true;
  return {
    files: matches, scanner: "async-fallback", scanned: index,
    truncated: scanState.truncated, deadline: scanDeadline,
  };
}

/**
 * Read the identifier sitting at a 1-based line/column.
 *
 * @param {string} absolutePath Absolute source path.
 * @param {number} line 1-based line.
 * @param {number} column 1-based column.
 * @returns {string} The identifier, or '' when the position is not on one.
 */
async function symbolNameAt(absolutePath, line, column) {
  let text;
  try {
    text = await fs.promises.readFile(absolutePath, "utf8");
  } catch {
    return "";
  }
  const target = text.split(/\r?\n/)[Number(line) - 1];
  if (typeof target !== "string" || !target.length) return "";
  const isWord = (character) => /[A-Za-z0-9_$]/.test(character ?? "");
  let start = Math.min(Math.max(Number(column) - 1, 0), target.length - 1);
  if (!isWord(target[start])) return "";
  let end = start;
  while (start > 0 && isWord(target[start - 1])) start -= 1;
  while (end + 1 < target.length && isWord(target[end + 1])) end += 1;
  return target.slice(start, end + 1);
}

/**
 * Open every project file that textually mentions the symbol under the cursor.
 *
 * The language server only answers from documents it has been told about, and
 * nothing crawls the workspace, so a cold `find_references` used to return just
 * the declaration while the real call sites stayed invisible.
 *
 * @param {object} current Active LSP state.
 * @param {string} absolutePath File holding the cursor.
 * @param {number} line 1-based line.
 * @param {number} column 1-based column.
 * @returns {Promise<{symbol: string, scanned: number, opened: number, truncated: boolean}>} Coverage report.
 */
async function preopenForSymbol(current, absolutePath, line, column, timeoutMs) {
  const symbol = await symbolNameAt(absolutePath, line, column);
  if (symbol.length < 2) return { symbol, scanned: 0, matched: 0, opened: 0, truncated: false, scanner: "none" };

  const found = await filesContainingSymbol(current.projectPath, symbol, timeoutMs);
  const candidates = found.files;
  let opened = 0;
  let truncated = found.truncated === true;
  const deadline = found.deadline ?? (Date.now() + Math.min(boundedTimeout(timeoutMs), 5000));
  for (const candidate of candidates) {
    if (opened >= PREOPEN_FILE_LIMIT || Date.now() >= deadline) {
      truncated = true;
      break;
    }
    if (current.documents.has(filePathToUri(candidate))) continue;
    const document = await ensureOpen(current, candidate);
    // didOpen is a notification, so the server may still be parsing when the
    // reference query arrives and would answer from a state that does not know
    // this file yet. A cheap round-trip forces the parse to complete first.
    const remaining = deadline - Date.now();
    if (remaining < 1000) {
      truncated = true;
      break;
    }
    await sendLspRequest(current, "textDocument/documentSymbol", {
      textDocument: { uri: document.uri },
    }, Math.min(boundedTimeout(timeoutMs), remaining))
      .catch(() => {});
    opened += 1;
  }
  return {
    symbol,
    scanned: found.scanned ?? candidates.length,
    matched: candidates.length,
    opened,
    truncated,
    scanner: found.scanner,
  };
}

function coverageNote({ scanned, matched, opened, truncated, scanner }) {
  if (!scanned) return "";
  const limit = truncated ? `, stopped at the ${PREOPEN_FILE_LIMIT}-file preopen limit` : "";
  return `\n(${scanner} scanned ${scanned} candidate file(s), matched ${matched}, opened ${opened} new one(s) before querying${limit})`;
}

async function request(file, line, column, method, params = {}, timeoutMs) {
  const current = await getState(file, timeoutMs);
  const document = await ensureOpen(current, file);
  return sendLspRequest(current, method, {
    textDocument: { uri: document.uri },
    position: userPosition(line, column),
    ...params,
  }, timeoutMs);
}

function locationParts(location) {
  const uri = location?.targetUri ?? location?.uri;
  const range = location?.targetRange ?? location?.range;
  if (!uri || !range?.start) return null;
  const file = uriToFilePath(uri);
  const position = fromLspPosition(range.start);
  return { file, ...position, text: readLine(file, position.line) };
}

function formatHoverContents(contents) {
  if (typeof contents === "string") return contents;
  if (contents && typeof contents === "object" && "kind" in contents) return contents.value ?? "";
  if (Array.isArray(contents)) {
    return contents.map((item) => (typeof item === "string" ? item : item?.value ?? "")).join("\n\n");
  }
  return contents == null ? "" : String(contents);
}

export async function findReferences({ file, line, column, includeDeclaration = true, timeoutMs }) {
  const current = await getState(file, timeoutMs);
  const document = await ensureOpen(current, file);
  const coverage = await preopenForSymbol(current, document.absolute, line, column, timeoutMs);
  const result = await sendLspRequest(current, "textDocument/references", {
    textDocument: { uri: document.uri },
    position: userPosition(line, column),
    context: { includeDeclaration: Boolean(includeDeclaration) },
  }, timeoutMs);
  if (!result?.length) {
    return `No references found for symbol at ${file}:${line}:${column}${coverageNote(coverage)}`;
  }
  const byFile = new Map();
  for (const location of result) {
    const item = locationParts(location);
    if (!item) continue;
    if (!byFile.has(item.file)) byFile.set(item.file, []);
    byFile.get(item.file).push(item);
  }
  const lines = [`Found ${result.length} references:\n`];
  for (const [filePath, references] of byFile) {
    lines.push(`## ${filePath}`);
    for (const ref of references) lines.push(`  L${ref.line}:${ref.column}  ${ref.text}`);
    lines.push("");
  }
  return `${lines.join("\n")}${coverageNote(coverage)}`;
}

export async function goToDefinition({ file, line, column, timeoutMs }) {
  const result = await request(file, line, column, "textDocument/definition", {}, timeoutMs);
  if (!result) return `No definition found for symbol at ${file}:${line}:${column}`;
  const locations = Array.isArray(result) ? result : [result];
  const parts = locations.map(locationParts).filter(Boolean);
  if (!parts.length) return `No definition found for symbol at ${file}:${line}:${column}`;
  return `Definition(s):\n${parts.map((item) => `${item.file}:${item.line}:${item.column}  ${item.text}`).join("\n")}`;
}

export async function goToDeclaration({ file, line, column, timeoutMs }) {
  const current = await getState(file, timeoutMs);
  const method = current.capabilities?.declarationProvider
    ? "textDocument/declaration"
    : "textDocument/definition";
  const result = await request(file, line, column, method, {}, timeoutMs);
  if (!result) return `No declaration found for symbol at ${file}:${line}:${column}`;
  const locations = Array.isArray(result) ? result : [result];
  const parts = locations.map(locationParts).filter(Boolean);
  if (!parts.length) return `No declaration found for symbol at ${file}:${line}:${column}`;
  const label = method === "textDocument/declaration"
    ? "Declaration(s)"
    : "Declaration fallback via definition(s) (server has no declarationProvider)";
  return `${label}:\n${parts.map((item) => `${item.file}:${item.line}:${item.column}  ${item.text}`).join("\n")}`;
}

export async function getHover({ file, line, column, timeoutMs }) {
  const result = await request(file, line, column, "textDocument/hover", {}, timeoutMs);
  if (!result) return `No hover info for symbol at ${file}:${line}:${column}`;
  return formatHoverContents(result.contents);
}

export async function listSymbols({ file, timeoutMs }) {
  const current = await getState(file, timeoutMs);
  const document = await ensureOpen(current, file);
  const result = await sendLspRequest(current, "textDocument/documentSymbol", {
    textDocument: { uri: document.uri },
  }, timeoutMs);
  if (!result?.length) return `No symbols found in ${file}`;
  const lines = [`Symbols in ${file}:\n`];
  const formatSymbol = (symbol, indent) => {
    const kind = SYMBOL_KIND_NAMES[symbol.kind] || `Kind(${symbol.kind})`;
    const range = symbol.range ?? symbol.location?.range;
    const position = fromLspPosition(range?.start ?? {});
    lines.push(`${"  ".repeat(indent)}${kind} ${symbol.name}  (L${position.line})`);
    for (const child of symbol.children ?? []) formatSymbol(child, indent + 1);
  };
  for (const symbol of result) formatSymbol(symbol, 0);
  return lines.join("\n");
}

export async function findCallHierarchy({ file, line, column, direction, timeoutMs }) {
  if (direction !== "incoming" && direction !== "outgoing") {
    const error = new Error("direction must be incoming or outgoing");
    error.code = "LSP_INVALID_DIRECTION";
    throw error;
  }
  const current = await getState(file, timeoutMs);
  const document = await ensureOpen(current, file);
  // Callers can live anywhere; callees are reachable from this file already.
  const coverage = direction === "incoming"
    ? await preopenForSymbol(current, document.absolute, line, column, timeoutMs)
    : { symbol: "", scanned: 0, matched: 0, opened: 0, truncated: false, scanner: "none" };
  const prepared = await sendLspRequest(current, "textDocument/prepareCallHierarchy", {
    textDocument: { uri: document.uri },
    position: userPosition(line, column),
  }, timeoutMs);
  if (!prepared?.length) {
    return `No call hierarchy available for symbol at ${file}:${line}:${column}${coverageNote(coverage)}`;
  }
  const item = prepared[0];
  const title = [`Call hierarchy for: ${item.name} (${direction})\n`];
  if (direction === "incoming") {
    const calls = await sendLspRequest(current, "callHierarchy/incomingCalls", { item }, timeoutMs);
    if (!calls?.length) return `No incoming calls found for ${item.name}${coverageNote(coverage)}`;
    for (const call of calls) {
      const source = locationParts({ uri: call.from.uri, range: call.from.selectionRange });
      if (source) title.push(`  <- ${call.from.name}  ${source.file}:${source.line}:${source.column}`);
    }
  } else {
    const calls = await sendLspRequest(current, "callHierarchy/outgoingCalls", { item }, timeoutMs);
    if (!calls?.length) return `No outgoing calls found for ${item.name}`;
    for (const call of calls) {
      const target = locationParts({ uri: call.to.uri, range: call.to.selectionRange });
      if (target) title.push(`  -> ${call.to.name}  ${target.file}:${target.line}:${target.column}`);
    }
  }
  return `${title.join("\n")}${coverageNote(coverage)}`;
}

/**
 * Compatibility adapter for DevEco Code's single `lsp` tool. The dedicated
 * helpers above keep the older ArkTS-LSP MCP names available, while this
 * operation-shaped entry point covers every operation in the official tool.
 */
export async function lspOperation({ operation, filePath, line, character, query = "", timeoutMs }) {
  const supported = [
    "goToDefinition",
    "goToDeclaration",
    "findReferences",
    "hover",
    "documentSymbol",
    "workspaceSymbol",
    "goToImplementation",
    "prepareCallHierarchy",
    "incomingCalls",
    "outgoingCalls",
  ];
  if (!supported.includes(operation)) {
    const error = new Error(`operation must be one of: ${supported.join(", ")}`);
    error.code = "LSP_OPERATION_INVALID";
    throw error;
  }
  const current = await getState(filePath, timeoutMs);
  const document = operation === "workspaceSymbol" ? null : await ensureOpen(current, filePath);
  const position = operation === "workspaceSymbol" || operation === "documentSymbol"
    ? null
    : userPosition(line, character);
  const textDocument = document ? { textDocument: { uri: document.uri } } : {};

  if (operation === "goToDefinition") {
    return sendLspRequest(current, "textDocument/definition", { ...textDocument, position }, timeoutMs);
  }
  if (operation === "goToDeclaration") {
    const method = current.capabilities?.declarationProvider
      ? "textDocument/declaration"
      : "textDocument/definition";
    return sendLspRequest(current, method, { ...textDocument, position }, timeoutMs);
  }
  if (operation === "findReferences") {
    return sendLspRequest(current, "textDocument/references", {
      ...textDocument,
      position,
      context: { includeDeclaration: true },
    }, timeoutMs);
  }
  if (operation === "hover") {
    return sendLspRequest(current, "textDocument/hover", { ...textDocument, position }, timeoutMs);
  }
  if (operation === "documentSymbol") {
    return sendLspRequest(current, "textDocument/documentSymbol", textDocument, timeoutMs);
  }
  if (operation === "workspaceSymbol") {
    return sendLspRequest(current, "workspace/symbol", { query: String(query ?? "") }, timeoutMs);
  }
  if (operation === "goToImplementation") {
    return sendLspRequest(current, "textDocument/implementation", { ...textDocument, position }, timeoutMs);
  }
  if (operation === "prepareCallHierarchy") {
    return sendLspRequest(current, "textDocument/prepareCallHierarchy", { ...textDocument, position }, timeoutMs);
  }
  const prepared = await sendLspRequest(current, "textDocument/prepareCallHierarchy", {
    ...textDocument,
    position,
  }, timeoutMs);
  if (!prepared?.length) return [];
  if (operation === "incomingCalls") {
    return sendLspRequest(current, "callHierarchy/incomingCalls", { item: prepared[0] }, timeoutMs);
  }
  return sendLspRequest(current, "callHierarchy/outgoingCalls", { item: prepared[0] }, timeoutMs);
}

export async function resetLsp() {
  if (starting) {
    try { await starting; } catch { /* the next request will retry */ }
  }
  disposeState();
}

export async function shutdownLsp() {
  if (!state) return;
  const current = state;
  try {
    await sendLspRequest(current, "shutdown", {}, LSP_SHUTDOWN_TIMEOUT_MS);
    await current.connection.sendNotification("exit");
  } catch {
    // The server may already have exited; cleanup below is still sufficient.
  }
  disposeState();
}

export function lspStatus() {
  return {
    installed: fs.existsSync(lspBinary()),
    binary: lspBinary(),
    running: Boolean(state?.child && !state.child.killed),
    projectPath: state?.projectPath ?? null,
    sdkPath: sdkPath() || null,
  };
}
