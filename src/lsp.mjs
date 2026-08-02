import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import { URI } from "vscode-uri";
import { resolveDevecoHome, REPO_ROOT } from "./config.mjs";
import { getProjectPath } from "./project-context.mjs";

const LSP_BINARY = path.join(
  REPO_ROOT,
  "node_modules",
  "@arkts",
  "language-server",
  "bin",
  "ets-language-server.js",
);

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
  const home = resolveDevecoHome().path;
  return home ? path.join(home, "sdk", "default", "openharmony") : "";
}

function disposeState() {
  if (!state) return;
  try { state.connection.dispose(); } catch { /* already disposed */ }
  if (state.child && !state.child.killed) {
    try { state.child.kill(); } catch { /* already exited */ }
  }
  state = null;
}

async function start(projectPath) {
  if (!fs.existsSync(LSP_BINARY)) {
    const error = new Error(`ArkTS language server is not installed: ${LSP_BINARY}`);
    error.code = "LSP_NOT_INSTALLED";
    throw error;
  }

  disposeState();
  const child = spawn(process.execPath, [LSP_BINARY, "--stdio"], {
    cwd: projectPath,
    env: {
      ...process.env,
      ...(sdkPath() ? { OHOS_SDK_PATH: sdkPath() } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
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
    const capabilities = await connection.sendRequest("initialize", initializeParams);
    await connection.sendNotification("initialized", {});
    process.stderr.write(`[deveco-tool/ets-lsp] initialized (${Object.keys(capabilities?.capabilities ?? {}).length} capabilities)\n`);
  } catch (error) {
    try { connection.dispose(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    throw error;
  }

  state = { child, connection, projectPath, documents: new Map() };
  return state;
}

async function getState(filePath) {
  const projectPath = activeProjectFor(filePath);
  if (state?.projectPath === projectPath) return state;
  if (starting) await starting;
  if (state?.projectPath === projectPath) return state;
  starting = start(projectPath);
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

async function ensureOpen(current, filePath) {
  const absolute = resolveSourcePath(filePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    const error = new Error(`Source file does not exist: ${absolute}`);
    error.code = "LSP_FILE_NOT_FOUND";
    throw error;
  }
  const uri = filePathToUri(absolute);
  const text = fs.readFileSync(absolute, "utf8");
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

async function request(file, line, column, method, params = {}) {
  const current = await getState(file);
  const document = await ensureOpen(current, file);
  return current.connection.sendRequest(method, {
    textDocument: { uri: document.uri },
    position: userPosition(line, column),
    ...params,
  });
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

export async function findReferences({ file, line, column, includeDeclaration = true }) {
  const result = await request(file, line, column, "textDocument/references", {
    context: { includeDeclaration: Boolean(includeDeclaration) },
  });
  if (!result?.length) return `No references found for symbol at ${file}:${line}:${column}`;
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
  return lines.join("\n");
}

export async function goToDefinition({ file, line, column }) {
  const result = await request(file, line, column, "textDocument/definition");
  if (!result) return `No definition found for symbol at ${file}:${line}:${column}`;
  const locations = Array.isArray(result) ? result : [result];
  const parts = locations.map(locationParts).filter(Boolean);
  if (!parts.length) return `No definition found for symbol at ${file}:${line}:${column}`;
  return `Definition(s):\n${parts.map((item) => `${item.file}:${item.line}:${item.column}  ${item.text}`).join("\n")}`;
}

export async function getHover({ file, line, column }) {
  const result = await request(file, line, column, "textDocument/hover");
  if (!result) return `No hover info for symbol at ${file}:${line}:${column}`;
  return formatHoverContents(result.contents);
}

export async function listSymbols({ file }) {
  const current = await getState(file);
  const document = await ensureOpen(current, file);
  const result = await current.connection.sendRequest("textDocument/documentSymbol", {
    textDocument: { uri: document.uri },
  });
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

export async function findCallHierarchy({ file, line, column, direction }) {
  if (direction !== "incoming" && direction !== "outgoing") {
    const error = new Error("direction must be incoming or outgoing");
    error.code = "LSP_INVALID_DIRECTION";
    throw error;
  }
  const current = await getState(file);
  const document = await ensureOpen(current, file);
  const prepared = await current.connection.sendRequest("textDocument/prepareCallHierarchy", {
    textDocument: { uri: document.uri },
    position: userPosition(line, column),
  });
  if (!prepared?.length) return `No call hierarchy available for symbol at ${file}:${line}:${column}`;
  const item = prepared[0];
  const title = [`Call hierarchy for: ${item.name} (${direction})\n`];
  if (direction === "incoming") {
    const calls = await current.connection.sendRequest("callHierarchy/incomingCalls", { item });
    if (!calls?.length) return `No incoming calls found for ${item.name}`;
    for (const call of calls) {
      const source = locationParts({ uri: call.from.uri, range: call.from.selectionRange });
      if (source) title.push(`  <- ${call.from.name}  ${source.file}:${source.line}:${source.column}`);
    }
  } else {
    const calls = await current.connection.sendRequest("callHierarchy/outgoingCalls", { item });
    if (!calls?.length) return `No outgoing calls found for ${item.name}`;
    for (const call of calls) {
      const target = locationParts({ uri: call.to.uri, range: call.to.selectionRange });
      if (target) title.push(`  -> ${call.to.name}  ${target.file}:${target.line}:${target.column}`);
    }
  }
  return title.join("\n");
}

/**
 * Compatibility adapter for DevEco Code's single `lsp` tool. The dedicated
 * helpers above keep the older ArkTS-LSP MCP names available, while this
 * operation-shaped entry point covers every operation in the official tool.
 */
export async function lspOperation({ operation, filePath, line, character, query = "" }) {
  const supported = [
    "goToDefinition",
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
  const current = await getState(filePath);
  const document = operation === "workspaceSymbol" ? null : await ensureOpen(current, filePath);
  const position = operation === "workspaceSymbol" || operation === "documentSymbol"
    ? null
    : userPosition(line, character);
  const textDocument = document ? { textDocument: { uri: document.uri } } : {};

  if (operation === "goToDefinition") {
    return current.connection.sendRequest("textDocument/definition", { ...textDocument, position });
  }
  if (operation === "findReferences") {
    return current.connection.sendRequest("textDocument/references", {
      ...textDocument,
      position,
      context: { includeDeclaration: true },
    });
  }
  if (operation === "hover") {
    return current.connection.sendRequest("textDocument/hover", { ...textDocument, position });
  }
  if (operation === "documentSymbol") {
    return current.connection.sendRequest("textDocument/documentSymbol", textDocument);
  }
  if (operation === "workspaceSymbol") {
    return current.connection.sendRequest("workspace/symbol", { query: String(query ?? "") });
  }
  if (operation === "goToImplementation") {
    return current.connection.sendRequest("textDocument/implementation", { ...textDocument, position });
  }
  if (operation === "prepareCallHierarchy") {
    return current.connection.sendRequest("textDocument/prepareCallHierarchy", { ...textDocument, position });
  }
  const prepared = await current.connection.sendRequest("textDocument/prepareCallHierarchy", {
    ...textDocument,
    position,
  });
  if (!prepared?.length) return [];
  if (operation === "incomingCalls") {
    return current.connection.sendRequest("callHierarchy/incomingCalls", { item: prepared[0] });
  }
  return current.connection.sendRequest("callHierarchy/outgoingCalls", { item: prepared[0] });
}

export async function resetLsp() {
  if (starting) {
    try { await starting; } catch { /* the next request will retry */ }
  }
  disposeState();
}

export async function shutdownLsp() {
  if (!state) return;
  try {
    await state.connection.sendRequest("shutdown");
    await state.connection.sendNotification("exit");
  } catch {
    // The server may already have exited; cleanup below is still sufficient.
  }
  disposeState();
}

export function lspStatus() {
  return {
    installed: fs.existsSync(LSP_BINARY),
    binary: LSP_BINARY,
    running: Boolean(state?.child && !state.child.killed),
    projectPath: state?.projectPath ?? null,
    sdkPath: sdkPath() || null,
  };
}
