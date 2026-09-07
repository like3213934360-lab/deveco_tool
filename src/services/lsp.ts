import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
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
import { privateDirectory, digest } from "../core/files.js";
import { stateDirectory } from "../core/config.js";
import type { Project } from "./project.js";
import { compilationDatabase } from "./compilation-database.js";
import { withinDeadline } from "../core/deadline.js";

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
  const schema =
    action === "hover"
      ? hoverResult
      : action === "references"
        ? z.array(location).max(10000).nullable()
        : z.union([location, z.array(definition).max(10000)]).nullable();
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
  const handle = await fs.promises.open(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
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
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        Math.min(65536, buffer.length - offset),
        offset,
      );
      invariant(
        bytesRead > 0,
        "LSP_FILE_CHANGED",
        "Language document changed while being read",
      );
      offset += bytesRead;
    }
    const after = await handle.stat();
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
    await handle.close();
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
}
interface LanguageRequest {
  action:
    "hover" | "definition" | "implementation" | "references" | "diagnostics";
  language?: "arkts" | "cpp";
  file: string;
  line?: number;
  character?: number;
  includeDeclaration?: boolean;
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
    connection.sendRequest(method, params, cancellation.token).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
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
  private readonly sweeper: NodeJS.Timeout;
  constructor(
    readonly processes: ProcessService,
    readonly launch?: (project: Project, language: "arkts" | "cpp") => Command,
    readonly limits = { request_ms: 20000, opened_files: 128 },
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
      await this.processes.terminate(session.child);
      this.sessions.delete(key);
    })());
  }
  private session(
    project: Project,
    language: "arkts" | "cpp",
    compileDirectory?: string,
  ): Session {
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
    const found = this.sessions.get(key);
    if (found) {
      invariant(
        !found.closing,
        "LSP_CLOSING",
        "This language session is closing or its exit has not been confirmed",
      );
      found.touched = Date.now();
      return found;
    }
    invariant(
      this.sessions.size < 4,
      "LSP_CAPACITY",
      "At most four active language servers; close an idle session",
    );
    const child = this.processes.spawn(command);
    invariant(
      child.stdout && child.stdin,
      "LSP_PIPE_MISSING",
      "Language server pipes unavailable",
    );
    child.stderr?.resume();
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    const session: Session = {
      connection,
      child,
      opened: new Map(),
      diagnostics: new Map(),
      touched: Date.now(),
      ready: Promise.resolve(),
      queued: Promise.resolve(),
      active: 0,
      capabilities: {},
    };
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
            definition: { linkSupport: true },
            implementation: { linkSupport: true },
            hover: { contentFormat: ["markdown", "plaintext"] },
            references: {},
          },
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
    child.on("error", () => {
      this.sessions.delete(key);
      connection.dispose();
    });
    child.once("close", () => {
      this.sessions.delete(key);
      connection.dispose();
    });
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
    const logs = path.join(stateDirectory(), "lsp");
    privateDirectory(logs);
    return [
      "--max-old-space-size=2048",
      component(toolchain, "arkts"),
      "--stdio",
      `--logger-path=${logs}`,
      "--logger-level=ERROR",
      `--projectPath=${project.root}`,
      `--sdkPath=${toolchain.sdk}`,
    ];
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
    const file = await fs.promises.realpath(
        path.resolve(project.root, input.file),
      ),
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
    const session = this.session(
        project,
        input.language ?? "arkts",
        database?.directory,
      ),
      previous = session.queued,
      finished = Promise.withResolvers<void>();
    session.queued = previous.then(() => finished.promise);
    session.active++;
    try {
      await waitFor(previous, signal);
      await waitFor(session.ready, signal);
      signal.throwIfAborted();
      if (input.action !== "diagnostics") {
        const supported = session.capabilities[`${input.action}Provider`];
        invariant(
          supported !== undefined && supported !== false,
          "LSP_CAPABILITY_UNAVAILABLE",
          `Language server does not advertise ${input.action}`,
        );
      }
      const requested = await readDocument(file, signal);
      const position =
        input.action === "diagnostics"
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
      if (!session.opened.has(uri)) {
        while (session.opened.size >= this.limits.opened_files) {
          const oldest = session.opened.keys().next().value;
          invariant(
            oldest,
            "LSP_STATE_INVALID",
            "Cannot select an idle document",
          );
          await session.connection.sendNotification("textDocument/didClose", {
            textDocument: { uri: oldest },
          });
          session.opened.delete(oldest);
          session.diagnostics.delete(oldest);
        }
        session.opened.set(uri, { hash: requested.hash, version: 1 });
        await session.connection.sendNotification("textDocument/didOpen", {
          textDocument: {
            uri,
            languageId: input.language === "cpp" ? "cpp" : "arkts",
            version: 1,
            text: requested.text,
          },
        });
      } else {
        const state = session.opened.get(uri)!;
        session.opened.delete(uri);
        session.opened.set(uri, state);
      }
      if (input.action === "diagnostics") {
        const deadline = Date.now() + 15000;
        while (!session.diagnostics.has(uri) && Date.now() < deadline) {
          signal?.throwIfAborted();
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        invariant(
          session.diagnostics.has(uri),
          "DIAGNOSTICS_TIMEOUT",
          "Language server did not publish diagnostics",
        );
        return {
          file,
          diagnostics: session.diagnostics.get(uri),
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
      const result = await query(`textDocument/${input.action}`, {
        textDocument: { uri },
        position,
        ...(input.action === "references"
          ? {
              context: {
                includeDeclaration: input.includeDeclaration ?? false,
              },
            }
          : {}),
      });
      const validated = languageResult(input.action, result);
      return input.action === "references" && !input.includeDeclaration
        ? await filterDeclarations(validated, (uri, position) =>
            query("textDocument/definition", {
              textDocument: { uri },
              position,
            }),
          )
        : validated;
    } finally {
      session.active--;
      session.touched = Date.now();
      finished.resolve();
    }
  }
  async close(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all(
      [...this.sessions].map(([key, session]) =>
        this.closeSession(key, session),
      ),
    );
  }
}
