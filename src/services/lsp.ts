import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  CancellationTokenSource,
  type MessageConnection,
} from "vscode-jsonrpc/node.js";
import { z } from "zod";
import type { ChildProcess } from "node:child_process";
import { ProcessService, type Command } from "../core/process.js";
import {
  component,
  discoverToolchain,
  type Toolchain,
} from "../core/toolchain.js";
import { invariant, ToolError } from "../core/errors.js";
import { digest } from "../core/files.js";
import { NativeDirectory } from "../core/native-directory.js";
import type { StateStore } from "../core/store.js";
import type { Project } from "./project.js";
import { compilationDatabase } from "./compilation-database.js";
import { withinDeadline } from "../core/deadline.js";
import { languageConnection } from "../core/language-connection.js";
import { assertLanguageBudget, symbolResults } from "./language-symbols.js";
import {
  arktsSymbolResult,
  reconcileArktsOutgoing,
  reconcileArktsCallableExtents,
} from "./arkts-language.js";

export interface Diagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
  severity?: number;
  code?: string | number;
  source?: string;
}
const point = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
});
const range = z.object({ start: point, end: point });
const location = z.object({ uri: z.string(), range });
const definition = z.union([
  location,
  z.object({
    targetUri: z.string(),
    targetSelectionRange: range,
    targetRange: range,
  }),
]);
const provider = z
  .union([z.boolean(), z.record(z.string(), z.unknown())])
  .optional();
const capabilities = z.object({
  hoverProvider: provider,
  definitionProvider: provider,
  implementationProvider: provider,
  referencesProvider: provider,
  documentSymbolProvider: provider,
  workspaceSymbolProvider: provider,
  callHierarchyProvider: provider,
  diagnosticProvider: z
    .object({
      identifier: z.string().optional(),
      interFileDependencies: z.boolean(),
      workspaceDiagnostics: z.boolean(),
    })
    .optional(),
  positionEncoding: z.string().optional(),
});
const markedString = z.union([
  z.string(),
  z.object({ language: z.string(), value: z.string() }),
]);
const hoverResult = z
  .object({
    contents: z.union([
      markedString,
      z.array(markedString),
      z.object({ kind: z.enum(["plaintext", "markdown"]), value: z.string() }),
    ]),
    range: range.optional(),
  })
  .nullable();
/** Validate third-party data before returning it; empty results are valid LSP outcomes. */
export function languageResult(
  action: Exclude<LanguageRequest["action"], "diagnostics">,
  raw: unknown,
): unknown {
  assertLanguageBudget(raw);
  const schema =
    action === "hover"
      ? hoverResult
      : action === "references"
        ? z.array(location).max(10000).nullable()
        : action === "definition" || action === "implementation"
          ? z.union([location, z.array(definition).max(10000)]).nullable()
          : symbolResults[action];
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new ToolError(
      "LSP_INVALID_RESPONSE",
      `Invalid ${action} response`,
      parsed.error.issues,
    );
  return parsed.data;
}
/** Read and hash the same bounded bytes that will be sent to the language server. */
async function readDocument(file: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const handle = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NONBLOCK,
  );
  try {
    const before = fs.fstatSync(handle);
    invariant(
      before.isFile(),
      "LSP_FILE_INVALID",
      "Language documents must be regular files",
    );
    invariant(
      before.size <= 4 * 1024 * 1024,
      "LSP_FILE_TOO_LARGE",
      "Open language documents are limited to 4 MiB",
    );
    const buffer = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      signal.throwIfAborted();
      // Small documents are read in one bounded synchronous operation in the
      // runtime worker. Larger documents yield between chunks so cancellation
      // and unrelated requests can progress without caching stale source text.
      const length = Math.min(65536, buffer.length - offset);
      const bytesRead =
        buffer.length <= 65536
          ? fs.readSync(handle, buffer, offset, length, offset)
          : await new Promise<number>((resolve, reject) => {
              fs.read(
                handle,
                buffer,
                offset,
                length,
                offset,
                (error, bytes) => {
                  if (error) reject(error);
                  else resolve(bytes);
                },
              );
            });
      invariant(
        bytesRead > 0,
        "LSP_FILE_CHANGED",
        "Language document changed while being read",
      );
      offset += bytesRead;
    }
    const after = fs.fstatSync(handle);
    invariant(
      before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      "LSP_FILE_CHANGED",
      "Language document changed while being read",
    );
    signal.throwIfAborted();
    return {
      text: buffer.toString("utf8"),
      hash: createHash("sha256").update(buffer).digest("hex"),
    };
  } finally {
    fs.closeSync(handle);
  }
}
export function languagePosition(text: string, line = 0, character = 0) {
  invariant(
    Number.isInteger(line) &&
      line >= 0 &&
      Number.isInteger(character) &&
      character >= 0,
    "LSP_INVALID_POSITION",
    "Positions must be nonnegative integers",
  );
  // CRLF is one line break; JS string offsets already count UTF-16 code units.
  let current = 0,
    start = 0,
    end = 0;
  while (end < text.length && current < line) {
    const code = text.charCodeAt(end++);
    if (code === 13 || code === 10) {
      if (code === 13 && text.charCodeAt(end) === 10) end++;
      current++;
      start = end;
    }
  }
  invariant(
    current === line,
    "LSP_INVALID_POSITION",
    "Requested line is outside the current file",
  );
  end = start;
  while (
    end < text.length &&
    text.charCodeAt(end) !== 13 &&
    text.charCodeAt(end) !== 10
  )
    end++;
  invariant(
    character <= end - start,
    "LSP_INVALID_POSITION",
    "Requested character is outside the current line",
  );
  return { line, character };
}
const diagnosticSchema = z.object({
  range,
  message: z.string(),
  severity: z.number().optional(),
  code: z.union([z.string(), z.number()]).optional(),
  source: z.string().optional(),
});
const normalizeUri = (uri: string) => {
  const parsed = new URL(uri);
  return parsed.protocol === "file:"
    ? pathToFileURL(fileURLToPath(parsed)).href
    : parsed.href;
};
interface Session {
  connection: MessageConnection;
  child: ChildProcess;
  opened: Map<string, { hash: string; version: number }>;
  diagnostics: Map<string, Diagnostic[]>;
  touched: number;
  ready: Promise<void>;
  queued: Promise<void>;
  active: number;
  capabilities: z.infer<typeof capabilities>;
  closing?: Promise<void>;
  directory?: NativeDirectory;
}
interface LanguageRequest {
  action:
    | "hover"
    | "definition"
    | "implementation"
    | "references"
    | "diagnostics"
    | "documentSymbol"
    | "workspaceSymbol"
    | "prepareCallHierarchy"
    | "incomingCalls"
    | "outgoingCalls";
  language?: "arkts" | "cpp";
  file: string;
  line?: number;
  character?: number;
  includeDeclaration?: boolean;
  query?: string;
  item_index?: number;
  abi?: string;
  mode?: "debug" | "release";
}
async function waitFor<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}
export async function lspRequest(
  connection: MessageConnection,
  method: string,
  params: unknown,
  signal?: AbortSignal,
  timeoutMs = 20000,
): Promise<unknown> {
  signal?.throwIfAborted();
  const cancellation = new CancellationTokenSource();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      cancellation.dispose();
    };
    const abort = () => {
      cancellation.cancel();
      cleanup();
      reject(
        signal?.reason ??
          new ToolError("LSP_TIMEOUT", "Language request deadline exceeded"),
      );
    };
    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      connection.sendRequest(method, params, cancellation.token).then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(
            error !== null &&
              typeof error === "object" &&
              "code" in error &&
              error.code === -32601
              ? new ToolError(
                  "LSP_CAPABILITY_UNAVAILABLE",
                  `Language server does not implement ${method}`,
                  {
                    method,
                    rpc_code: -32601,
                    source: "jsonrpc_response",
                    request_dispatched: true,
                  },
                )
              : error,
          );
        },
      );
    } catch (error) {
      cleanup();
      reject(error);
    }
    if (signal?.aborted) abort();
  });
}
export async function filterDeclarations(
  raw: unknown,
  resolve: (uri: string, position: z.infer<typeof point>) => Promise<unknown>,
): Promise<z.infer<typeof location>[]> {
  const references = z
      .array(location)
      .max(10000)
      .parse(raw ?? []),
    cache = new Map<string, boolean>(),
    usages: z.infer<typeof location>[] = [];
  for (const reference of references) {
    const uri = normalizeUri(reference.uri),
      start = reference.range.start,
      key = `${uri}:${start.line}:${start.character}`;
    if (!cache.has(key)) {
      const raw = await resolve(uri, start),
        items = z
          .array(definition)
          .parse(raw === null ? [] : Array.isArray(raw) ? raw : [raw]);
      cache.set(
        key,
        items.some((item) => {
          const target = "targetUri" in item ? item.targetUri : item.uri,
            selection =
              "targetSelectionRange" in item
                ? item.targetSelectionRange
                : item.range;
          return (
            normalizeUri(target) === uri &&
            selection.start.line === start.line &&
            selection.start.character === start.character
          );
        }),
      );
    }
    if (!cache.get(key)) usages.push(reference);
  }
  return usages;
}
export class LanguageService {
  private readonly sessions = new Map<string, Session>();
  private reclamation?: Promise<void>;
  private stopping = false;
  get metrics() {
    return {
      connections: this.sessions.size,
      active_requests: [...this.sessions.values()].reduce(
        (sum, session) => sum + session.active,
        0,
      ),
      idle_ms: 300000,
      sweep_ms: 30000,
    };
  }
  private readonly sweeper: NodeJS.Timeout;
  constructor(
    readonly processes: ProcessService,
    readonly launch?: (project: Project, language: "arkts" | "cpp") => Command,
    readonly limits = { request_ms: 20000, opened_files: 128 },
    readonly store?: StateStore,
  ) {
    this.sweeper = setInterval(() => {
      for (const [key, session] of this.sessions)
        if (session.active === 0 && Date.now() - session.touched > 300000)
          void this.closeSession(key, session).catch(() => {});
    }, 30000);
    this.sweeper.unref();
  }
  private closeSession(key: string, session: Session): Promise<void> {
    return (session.closing ??= (async () => {
      session.connection.dispose();
      try {
        await this.processes.terminate(session.child);
        this.sessions.delete(key);
      } finally {
        await session.directory?.close();
      }
    })());
  }
  private async session(
    project: Project,
    language: "arkts" | "cpp",
    signal: AbortSignal,
    compileDirectory?: string,
  ): Promise<Session> {
    let toolchainFingerprint: string | undefined;
    const command =
      this.launch?.(project, language) ??
      (() => {
        const toolchain = discoverToolchain();
        toolchainFingerprint = toolchain.fingerprint;
        return {
          executable:
            language === "cpp"
              ? component(toolchain, "clangd")
              : component(toolchain, "node"),
          args: this.arguments(toolchain, project, language, compileDirectory),
          cwd: project.root,
          env: { ...process.env, DEVECO_SDK_HOME: toolchain.sdk },
        };
      })();
    const key = `${project.root}:${language}:${digest({ command, toolchainFingerprint })}:${project.fingerprint}`;
    for (;;) {
      signal.throwIfAborted();
      invariant(!this.stopping, "LSP_CLOSING", "Language service is closing");
      const found = this.sessions.get(key);
      if (found) {
        invariant(
          !found.closing,
          "LSP_CLOSING",
          "This language session is closing or its exit has not been confirmed",
        );
        found.touched = Date.now();
        // Reserve before yielding so another admission cannot evict this owner.
        found.active++;
        return found;
      }
      if (this.sessions.size < 4) break;
      if (this.reclamation) {
        await this.reclamation;
        continue;
      }
      const idle = [...this.sessions.entries()]
        .filter(([, session]) => session.active === 0 && !session.closing)
        .sort((a, b) => a[1].touched - b[1].touched)[0];
      invariant(
        idle,
        "LSP_CAPACITY",
        "At most four active language servers; wait for an active request to finish",
      );
      // Keep the slot occupied until ProcessService confirms owner exit. Share
      // this reclamation so concurrent callers do not evict extra idle owners.
      const reclamation = this.closeSession(idle[0], idle[1]);
      this.reclamation = reclamation;
      try {
        await reclamation;
      } finally {
        if (this.reclamation === reclamation) this.reclamation = undefined;
      }
    }
    let directory: NativeDirectory | undefined;
    if (!this.launch && language === "arkts") {
      invariant(
        this.store,
        "LSP_STORE_REQUIRED",
        "ArkTS sessions require shared log storage accounting",
      );
      directory = new NativeDirectory(this.store, 16 * 1024 * 1024);
      command.args.push(`--logger-path=${directory.file}`);
    }
    let child: ChildProcess;
    try {
      child = directory
        ? directory.own(() => this.processes.spawn(command))
        : this.processes.spawn(command);
    } catch (error) {
      void directory?.close();
      throw error;
    }
    invariant(
      child.stdout && child.stdin,
      "LSP_PIPE_MISSING",
      "Language server pipes unavailable",
    );
    child.stderr?.resume();
    const connection = languageConnection(child.stdout, child.stdin);
    const session: Session = {
      connection,
      child,
      opened: new Map(),
      diagnostics: new Map(),
      touched: Date.now(),
      ready: Promise.resolve(),
      queued: Promise.resolve(),
      active: 1,
      capabilities: {},
      directory,
    };
    directory?.controller.signal.addEventListener(
      "abort",
      () => {
        void this.closeSession(key, session).catch(() => {});
      },
      { once: true },
    );
    this.sessions.set(key, session);
    connection.listen();
    connection.onNotification(
      "textDocument/publishDiagnostics",
      (raw: unknown) => {
        const parsed = z
          .object({
            uri: z.string(),
            version: z.number().optional(),
            diagnostics: z.array(diagnosticSchema).max(10000),
          })
          .safeParse(raw);
        if (!parsed.success) return;
        const value = parsed.data;
        let uri: string;
        try {
          uri = normalizeUri(value.uri);
        } catch {
          return;
        }
        const opened = session.opened.get(uri);
        if (
          !opened ||
          (value.version !== undefined && value.version !== opened.version)
        )
          return;
        session.diagnostics.set(uri, value.diagnostics);
      },
    );
    session.ready = (async () => {
      const initialized = await lspRequest(connection, "initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(project.root).href,
        workspaceFolders: [
          {
            uri: pathToFileURL(project.root).href,
            name: path.basename(project.root),
          },
        ],
        capabilities: {
          general: { positionEncodings: ["utf-16"] },
          textDocument: {
            publishDiagnostics: { relatedInformation: true },
            diagnostic: {
              dynamicRegistration: false,
              relatedDocumentSupport: false,
            },
            definition: { linkSupport: true },
            implementation: { linkSupport: true },
            hover: { contentFormat: ["markdown", "plaintext"] },
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            callHierarchy: { dynamicRegistration: false },
          },
          workspace: { symbol: {}, diagnostics: { refreshSupport: false } },
        },
        initializationOptions: {},
      });
      const parsed = z.object({ capabilities }).safeParse(initialized);
      invariant(
        parsed.success,
        "LSP_INVALID_RESPONSE",
        "Invalid language server initialization result",
      );
      invariant(
        parsed.data.capabilities.positionEncoding === undefined ||
          parsed.data.capabilities.positionEncoding === "utf-16",
        "LSP_POSITION_ENCODING_UNSUPPORTED",
        "Language server must support UTF-16 positions",
      );
      session.capabilities = parsed.data.capabilities;
      await connection.sendNotification("initialized", {});
    })().catch(async (error) => {
      await this.closeSession(key, session);
      throw error;
    });
    void session.ready.catch(() => {});
    const exited = () => {
      void this.closeSession(key, session).catch(() => {});
    };
    child.on("error", exited);
    child.once("close", exited);
    return session;
  }
  private arguments(
    toolchain: Toolchain,
    project: Project,
    language: "arkts" | "cpp",
    compileDirectory?: string,
  ): string[] {
    if (language === "cpp") {
      invariant(
        compileDirectory,
        "COMPILE_DATABASE_MISSING",
        "Select a native compilation database",
      );
      return [
        `--compile-commands-dir=${compileDirectory}`,
        "--log=error",
        "--pch-storage=memory",
        "--background-index=false",
      ];
    }
    return [
      "--max-old-space-size=2048",
      component(toolchain, "arkts"),
      "--stdio",
      "--logger-level=ERROR",
      `--projectPath=${project.root}`,
      `--sdkPath=${toolchain.sdk}`,
    ];
  }
  private async openDocument(
    session: Session,
    uri: string,
    document: { text: string; hash: string },
    language: "arkts" | "cpp",
    protectedUri?: string,
  ) {
    const opened = session.opened.get(uri);
    if (opened) {
      session.opened.delete(uri);
      session.opened.set(uri, opened);
      return;
    }
    while (session.opened.size >= this.limits.opened_files) {
      const oldest = [...session.opened.keys()].find(
        (key) => key !== protectedUri,
      );
      invariant(
        oldest,
        "LSP_RESULT_LIMIT",
        "Call verification requires room for both caller and callee documents",
      );
      await session.connection.sendNotification("textDocument/didClose", {
        textDocument: { uri: oldest },
      });
      session.opened.delete(oldest);
      session.diagnostics.delete(oldest);
    }
    await session.connection.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: language,
        version: 1,
        text: document.text,
      },
    });
    session.opened.set(uri, { hash: document.hash, version: 1 });
  }
  async request(
    project: Project,
    input: LanguageRequest,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return withinDeadline(
      this.limits.request_ms,
      signal,
      "LSP_TIMEOUT",
      (signal) => this.requestWithin(project, input, signal),
    );
  }
  private async requestWithin(
    project: Project,
    input: LanguageRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    const file = fs.realpathSync.native(path.resolve(project.root, input.file)),
      uri = pathToFileURL(file).href,
      database =
        input.language === "cpp" && !this.launch
          ? compilationDatabase(project, input)
          : undefined;
    if (database)
      invariant(
        database.files.has(file),
        "COMPILE_DATABASE_FILE_MISSING",
        "Requested file is not a translation unit in this native compilation database",
      );
    const session = await this.session(
        project,
        input.language ?? "arkts",
        signal,
        database?.directory,
      ),
      previous = session.queued,
      finished = Promise.withResolvers<void>();
    session.queued = previous.then(() => finished.promise);
    signal = session.directory?.signal(signal) ?? signal;
    try {
      await waitFor(previous, signal);
      await waitFor(session.ready, signal);
      signal.throwIfAborted();
      if (input.action !== "diagnostics") {
        const capability = [
          "prepareCallHierarchy",
          "incomingCalls",
          "outgoingCalls",
        ].includes(input.action)
          ? ("callHierarchyProvider" as const)
          : (`${input.action}Provider` as Exclude<
              keyof typeof session.capabilities,
              "positionEncoding"
            >);
        const supported = session.capabilities[capability];
        // ArkTS SDK handlers exist despite missing/false symbol capability
        // declarations. Probe these bounded read requests; only an actual
        // JSON-RPC MethodNotFound proves that a handler is unavailable.
        const probeArktsSymbol =
          input.language !== "cpp" && input.action in symbolResults;
        if (!(
          (supported !== undefined && supported !== false) ||
          probeArktsSymbol
        ))
          throw new ToolError(
            "LSP_CAPABILITY_UNAVAILABLE",
            `Language server does not advertise ${capability} required by ${input.action}`,
            {
              source: "capability_declaration",
              capability,
              request_dispatched: false,
            },
          );
      }
      const requested = await readDocument(file, signal);
      const position = [
        "diagnostics",
        "documentSymbol",
        "workspaceSymbol",
      ].includes(input.action)
        ? undefined
        : languagePosition(requested.text, input.line, input.character);
      // Refresh all previously opened files before a query, including dependencies.
      for (const [opened, state] of session.opened) {
        signal.throwIfAborted();
        const filePath = fileURLToPath(opened);
        let document: Awaited<ReturnType<typeof readDocument>>;
        try {
          document =
            opened === uri ? requested : await readDocument(filePath, signal);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            error.code !== "ENOENT"
          )
            throw error;
          await session.connection.sendNotification("textDocument/didClose", {
            textDocument: { uri: opened },
          });
          session.opened.delete(opened);
          session.diagnostics.delete(opened);
          continue;
        }
        if (document.hash !== state.hash) {
          state.version++;
          session.diagnostics.delete(opened);
          await session.connection.sendNotification("textDocument/didChange", {
            textDocument: { uri: opened, version: state.version },
            contentChanges: [{ text: document.text }],
          });
          state.hash = document.hash;
        }
      }
      await this.openDocument(
        session,
        uri,
        requested,
        input.language ?? "arkts",
      );
      if (input.action === "diagnostics") {
        const provider = session.capabilities.diagnosticProvider;
        let diagnostics: Diagnostic[];
        if (provider) {
          // A pull provider need not publish notifications. Request a fresh
          // full report after synchronizing every opened document; never reuse
          // a previous resultId across dependency changes or synthesize empty
          // diagnostics when the server fails or returns an invalid report.
          const raw = await lspRequest(
            session.connection,
            "textDocument/diagnostic",
            {
              textDocument: { uri },
              ...(provider.identifier === undefined
                ? {}
                : { identifier: provider.identifier }),
            },
            signal,
            15000,
          );
          assertLanguageBudget(raw);
          const report = z
            .object({
              kind: z.literal("full"),
              resultId: z.string().optional(),
              items: z.array(diagnosticSchema).max(10000),
            })
            .safeParse(raw);
          if (!report.success)
            throw new ToolError(
              "LSP_INVALID_RESPONSE",
              "Expected a full diagnostic report for a request without previousResultId",
              report.error.issues,
            );
          diagnostics = report.data.items;
        } else {
          const deadline = Date.now() + 15000;
          while (!session.diagnostics.has(uri) && Date.now() < deadline) {
            signal.throwIfAborted();
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          invariant(
            session.diagnostics.has(uri),
            "DIAGNOSTICS_TIMEOUT",
            "Language server did not publish diagnostics",
          );
          diagnostics = session.diagnostics.get(uri)!;
        }
        await session.directory?.check();
        return {
          file,
          diagnostics,
          diagnostic_transport: provider ? "pull" : "push",
          compilationVerified: false,
          checkKind: "language-server",
          ...(database
            ? {
                compilation_database: {
                  sha256: database.hash,
                  abi: database.abi,
                  mode: database.mode,
                  sources: database.sources,
                },
              }
            : {}),
        };
      }
      const deadline = Date.now() + 20000;
      const query = (method: string, params: unknown) =>
        lspRequest(
          session.connection,
          method,
          params,
          signal,
          Math.max(1, deadline - Date.now()),
        );
      const openRelated = async (related: string, protectedUri = uri) => {
        const document =
          related === uri
            ? requested
            : await readDocument(fileURLToPath(related), signal);
        await this.openDocument(
          session,
          related,
          document,
          input.language ?? "arkts",
          protectedUri,
        );
        return document;
      };
      const declarationCache = new Map<
        string,
        z.infer<typeof symbolResults.documentSymbol>
      >();
      const validate = async (
        action: Exclude<LanguageRequest["action"], "diagnostics">,
        raw: unknown,
      ) => {
        if (input.language === "cpp" || !(action in symbolResults))
          return languageResult(action, raw);
        const operation = action as keyof typeof symbolResults;
        const normalized = await reconcileArktsCallableExtents(
          operation,
          arktsSymbolResult(operation, raw),
          async (item) => {
            const document = await openRelated(item.uri);
            for (const point of [
              item.range.start,
              item.range.end,
              item.selectionRange.start,
              item.selectionRange.end,
            ])
              languagePosition(document.text, point.line, point.character);
            if (!declarationCache.has(item.uri)) {
              invariant(
                declarationCache.size < 128,
                "LSP_RESULT_LIMIT",
                "Callable declaration verification is limited to 128 documents",
              );
              declarationCache.set(
                item.uri,
                symbolResults.documentSymbol.parse(
                  arktsSymbolResult(
                    "documentSymbol",
                    await query("textDocument/documentSymbol", {
                      textDocument: { uri: item.uri },
                    }),
                  ),
                ),
              );
            }
            // Studio's flat symbol table identifies the binding separately from
            // the arrow expression's callable extent. Use its exact source range;
            // a same-name symbol elsewhere in this or another document is insufficient.
            const matches = (declarationCache.get(item.uri) ?? []).filter(
              (symbol) =>
                "location" in symbol &&
                symbol.kind === 13 &&
                symbol.name === item.name &&
                symbol.location.uri === item.uri &&
                JSON.stringify(symbol.location.range) ===
                  JSON.stringify(item.selectionRange),
            );
            return matches.length === 1;
          },
        );
        return languageResult(action, normalized);
      };
      if (
        input.action === "incomingCalls" ||
        input.action === "outgoingCalls"
      ) {
        // Prepare on the same synchronized session each time. A host-supplied
        // item could belong to stale bytes, another workspace or another server.
        const prepared = await validate(
          "prepareCallHierarchy",
          await query("textDocument/prepareCallHierarchy", {
            textDocument: { uri },
            position,
          }),
        );
        const items = symbolResults.prepareCallHierarchy.parse(prepared) ?? [];
        const index = input.item_index ?? 0;
        if (!items.length && index === 0) return [];
        if (!Number.isInteger(index) || index < 0 || index >= items.length)
          throw new ToolError(
            "LSP_CALL_ITEM_NOT_FOUND",
            "Select an item_index returned by prepareCallHierarchy",
            {
              item_count: items.length,
              item_index: index,
            },
          );
        const selected = items[index]!;
        const caller =
          input.language !== "cpp"
            ? await openRelated(selected.uri)
            : undefined;
        let result = await validate(
          input.action,
          await query(`callHierarchy/${input.action}`, { item: selected }),
        );
        if (input.action === "outgoingCalls" && caller) {
          result = await reconcileArktsOutgoing(
            selected,
            result,
            async (callee) => {
              signal.throwIfAborted();
              await openRelated(callee.uri, selected.uri);
              return validate(
                "incomingCalls",
                await query("callHierarchy/incomingCalls", { item: callee }),
              );
            },
          );
          for (const entry of symbolResults.outgoingCalls.parse(result) ?? [])
            for (const range of entry.fromRanges) {
              languagePosition(
                caller.text,
                range.start.line,
                range.start.character,
              );
              languagePosition(
                caller.text,
                range.end.line,
                range.end.character,
              );
            }
        }
        await session.directory?.check();
        return result;
      }
      const result = await query(
        input.action === "workspaceSymbol"
          ? "workspace/symbol"
          : `textDocument/${input.action}`,
        input.action === "workspaceSymbol"
          ? { query: input.query ?? "" }
          : {
              textDocument: { uri },
              ...(position ? { position } : {}),
              ...(input.action === "references"
                ? {
                    context: {
                      includeDeclaration: input.includeDeclaration ?? false,
                    },
                  }
                : {}),
            },
      );
      const validated = await validate(input.action, result);
      await session.directory?.check();
      return input.action === "references" && !input.includeDeclaration
        ? await filterDeclarations(validated, (uri, position) =>
            query("textDocument/definition", {
              textDocument: { uri },
              position,
            }),
          )
        : validated;
    } catch (error) {
      if (session.directory?.controller.signal.aborted)
        throw session.directory.controller.signal.reason;
      throw error;
    } finally {
      session.active--;
      session.touched = Date.now();
      finished.resolve();
    }
  }
  async close(): Promise<void> {
    this.stopping = true;
    clearInterval(this.sweeper);
    await Promise.all(
      [...this.sessions].map(([key, session]) =>
        this.closeSession(key, session),
      ),
    );
  }
}
