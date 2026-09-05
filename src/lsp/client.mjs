import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import { URI } from "vscode-uri";
import { terminateProcessTree } from "../process-tree.mjs";

const MAX_STDERR_BYTES = 64 * 1024;
const MAX_DOCUMENTS = 32;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const SHUTDOWN_TIMEOUT_MS = 2000;
const FORCE_CLOSE_WAIT_MS = 2250;

function codedError(code, message, details, hint) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  if (hint) error.hint = hint;
  return error;
}

function raceTimeout(promise, timeoutMs, onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = codedError(
          "LSP_TIMEOUT",
          `Official ArkTS language server request timed out after ${timeoutMs}ms.`,
          { timeoutMs },
        );
        reject(error);
        onTimeout?.();
      }, timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function documentBytes(documents) {
  let total = 0;
  for (const document of documents.values()) total += document.bytes;
  return total;
}

function statSignature(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

export class OfficialLspClient {
  constructor(spec, projectRoot) {
    this.spec = spec;
    this.projectRoot = projectRoot;
    this.child = null;
    this.connection = null;
    this.capabilities = {};
    this.documents = new Map();
    this.stderr = "";
    this.closed = false;
    this.documentChains = new Map();
    this.dynamicCapabilities = new Set();
    this.documentReadCount = 0;
    this.documentCacheHitCount = 0;
  }

  static async start(spec, projectRoot, timeoutMs, signal) {
    const client = new OfficialLspClient(spec, projectRoot);
    await client.start(timeoutMs, signal);
    return client;
  }

  async start(timeoutMs, signal) {
    const startedAt = Date.now();
    try {
      this.child = spawn(this.spec.command, this.spec.args, {
        cwd: this.spec.cwd,
        env: this.spec.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (cause) {
      throw codedError(
        "LSP_START_FAILED",
        `Failed to start the official ArkTS LSP bridge: ${cause.message}`,
        { command: this.spec.command, provider: this.spec.provider },
      );
    }

    const childFailure = new Promise((_, reject) => {
      this.child.once("error", (cause) => reject(codedError(
        "LSP_START_FAILED",
        `Failed to start the official ArkTS LSP bridge: ${cause.message}`,
        { command: this.spec.command, provider: this.spec.provider },
      )));
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-MAX_STDERR_BYTES);
    });
    this.connection = createMessageConnection(
      new StreamMessageReader(this.child.stdout),
      new StreamMessageWriter(this.child.stdin),
    );
    this.child.once("exit", (code, signal) => {
      this.exit = { code, signal };
      if (!this.closed) {
        this.closed = true;
        try { this.connection?.dispose(); } catch { /* transport already closed */ }
      }
    });
    this.installClientHandlers();
    this.connection.listen();

    const initialize = this.connection.sendRequest("initialize", {
      processId: process.pid,
      clientInfo: { name: "deveco-tool", version: "0.1.0" },
      locale: "zh-CN",
      rootPath: this.projectRoot,
      rootUri: URI.file(this.projectRoot).toString(),
      workspaceFolders: [{
        uri: URI.file(this.projectRoot).toString(),
        name: path.basename(this.projectRoot),
      }],
      capabilities: {
        workspace: {
          configuration: true,
          workspaceFolders: true,
        },
        textDocument: {
          synchronization: { dynamicRegistration: true },
          definition: { dynamicRegistration: true, linkSupport: true },
          references: { dynamicRegistration: true },
          hover: { dynamicRegistration: true, contentFormat: ["markdown", "plaintext"] },
          implementation: { dynamicRegistration: true, linkSupport: true },
        },
      },
      initializationOptions: {},
    });

    let abortHandler;
    const aborted = new Promise((_, reject) => {
      abortHandler = () => {
        reject(codedError(
          "LSP_RESET",
          "ArkTS LSP initialization was cancelled by a service reset.",
          { phase: "initialize", projectRoot: this.projectRoot },
        ));
        this.forceClose();
      };
      if (signal?.aborted) abortHandler();
      else signal?.addEventListener("abort", abortHandler, { once: true });
    });

    let result;
    try {
      result = await raceTimeout(
        Promise.race([initialize, childFailure, aborted]),
        timeoutMs,
        () => this.forceClose(),
      );
      this.capabilities = result?.capabilities ?? {};
      const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
      await raceTimeout(
        Promise.race([
          this.connection.sendNotification("initialized", {}),
          aborted,
        ]),
        remaining,
        () => this.forceClose(),
      );
    } catch (error) {
      this.forceClose();
      await this.waitForExit();
      if (signal?.aborted && error.code !== "LSP_RESET") {
        error.code = "LSP_RESET";
        error.message = "ArkTS LSP initialization was cancelled by a service reset.";
      }
      if (error.code === "LSP_TIMEOUT") {
        error.details = { ...error.details, phase: "initialize", ...this.diagnostics() };
      } else {
        error.code ??= "LSP_INITIALIZE_FAILED";
        error.details = { phase: "initialize", ...this.diagnostics() };
      }
      throw error;
    } finally {
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    }
  }

  installClientHandlers() {
    this.connection.onRequest("workspace/configuration", (params) =>
      (params?.items ?? []).map(() => null));
    this.connection.onRequest("client/registerCapability", (params) => {
      for (const registration of params?.registrations ?? []) {
        if (registration?.method) this.dynamicCapabilities.add(registration.method);
      }
      return null;
    });
    this.connection.onRequest("client/unregisterCapability", (params) => {
      for (const registration of params?.unregisterations ?? params?.unregistrations ?? []) {
        if (registration?.method) this.dynamicCapabilities.delete(registration.method);
      }
      return null;
    });
    this.connection.onRequest("window/workDoneProgress/create", () => null);
    this.connection.onRequest("workspace/workspaceFolders", () => [{
      uri: URI.file(this.projectRoot).toString(),
      name: path.basename(this.projectRoot),
    }]);
    this.connection.onRequest("workspace/applyEdit", () => ({
      applied: false,
      failureReason: "deveco-tool exposes read-only ArkTS LSP operations.",
    }));
    this.connection.onRequest("window/showMessageRequest", () => null);
  }

  diagnostics() {
    return {
      provider: this.spec.provider,
      projectRoot: this.projectRoot,
      backend: this.spec.backend,
      pid: this.child?.pid ?? null,
      exit: this.exit ?? null,
      stderrTail: this.stderr.slice(-8192) || null,
    };
  }

  supports(capability, method) {
    const advertised = this.capabilities?.[capability];
    return advertised === true
      || Boolean(advertised && typeof advertised === "object")
      || Boolean(method && this.dynamicCapabilities.has(method));
  }

  async syncDocuments(filePath, timeoutMs) {
    const startedAt = Date.now();
    const sync = async () => {
      // The server owns snapshots for every didOpen document. Filesystem edits
      // to dependencies must reach it before any query of their consumers.
      for (const uri of [...this.documents.keys()]) {
        const openPath = URI.parse(uri).fsPath;
        if (openPath !== filePath) {
          await this.touchFile(openPath, Math.max(1, timeoutMs - (Date.now() - startedAt)), true);
        }
      }
      return this.touchFile(filePath, Math.max(1, timeoutMs - (Date.now() - startedAt)));
    };
    return raceTimeout(sync(), timeoutMs, () => this.forceClose());
  }

  async touchFile(filePath, timeoutMs, background = false) {
    const previous = this.documentChains.get(filePath) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (this.closed) {
        throw codedError("LSP_NOT_RUNNING", "The official ArkTS language server is not running.");
      }
      const uri = URI.file(filePath).toString();
      const current = this.documents.get(uri);
      if (background && !current) return uri; // Evicted during another query.
      let stat;
      try {
        stat = await fs.stat(filePath, { bigint: true });
      } catch (error) {
        if (!background || error.code !== "ENOENT") throw error;
        this.documents.delete(uri);
        await this.connection.sendNotification("textDocument/didClose", { textDocument: { uri } });
        return uri;
      }
      const bytes = Number(stat.size);
      if (bytes > MAX_DOCUMENT_BYTES) {
        throw codedError(
          "LSP_DOCUMENT_TOO_LARGE",
          `ArkTS source exceeds the ${MAX_DOCUMENT_BYTES}-byte LSP document limit.`,
          { filePath, bytes, maxBytes: MAX_DOCUMENT_BYTES },
        );
      }
      const signature = statSignature(stat);
      if (current?.signature === signature) {
        if (!background) {
          current.lastUsedAt = Date.now();
          this.documentCacheHitCount += 1;
        }
      } else {
        const content = await fs.readFile(filePath, "utf8");
        const contentBytes = Buffer.byteLength(content);
        this.documentReadCount += 1;
        if (contentBytes > MAX_DOCUMENT_BYTES) {
          throw codedError(
            "LSP_DOCUMENT_TOO_LARGE",
            `ArkTS source exceeds the ${MAX_DOCUMENT_BYTES}-byte LSP document limit.`,
            { filePath, bytes: contentBytes, maxBytes: MAX_DOCUMENT_BYTES },
          );
        }
        if (this.closed) {
          throw codedError("LSP_NOT_RUNNING", "The official ArkTS language server is not running.");
        }
        if (!current) {
          await this.connection.sendNotification("textDocument/didOpen", {
            textDocument: { uri, languageId: "ets", version: 1, text: content },
          });
          this.documents.set(uri, {
            version: 1,
            signature,
            bytes: contentBytes,
            lastUsedAt: Date.now(),
          });
        } else {
          current.version += 1;
          current.signature = signature;
          current.bytes = contentBytes;
          if (!background) current.lastUsedAt = Date.now();
          await this.connection.sendNotification("textDocument/didChange", {
            textDocument: { uri, version: current.version },
            contentChanges: [{ text: content }],
          });
        }
      }
      await this.evictDocuments(uri);
      return uri;
    });
    const tracked = next.then(() => undefined, () => undefined);
    this.documentChains.set(filePath, tracked);
    const completed = next.finally(() => {
      if (this.documentChains.get(filePath) === tracked) {
        this.documentChains.delete(filePath);
      }
    });
    try {
      return await raceTimeout(completed, timeoutMs, () => this.forceClose());
    } catch (error) {
      if (error.code === "LSP_TIMEOUT") {
        error.details = { ...error.details, phase: "documentSync", filePath, ...this.diagnostics() };
      }
      throw error;
    }
  }

  async evictDocuments(protectedUri) {
    while (this.documents.size > MAX_DOCUMENTS || documentBytes(this.documents) > MAX_DOCUMENT_BYTES) {
      const candidate = [...this.documents.entries()]
        .filter(([uri]) => uri !== protectedUri)
        .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
      if (!candidate) break;
      this.documents.delete(candidate[0]);
      await this.connection.sendNotification("textDocument/didClose", {
        textDocument: { uri: candidate[0] },
      });
    }
  }

  async request(method, params, timeoutMs) {
    if (this.closed) {
      throw codedError("LSP_NOT_RUNNING", "The official ArkTS language server is not running.");
    }
    try {
      return await raceTimeout(
        this.connection.sendRequest(method, params),
        timeoutMs,
        () => this.forceClose(),
      );
    } catch (error) {
      if (error.code === "LSP_TIMEOUT") {
        error.details = { ...error.details, method, ...this.diagnostics() };
      } else {
        error.code ??= "LSP_REQUEST_FAILED";
        error.details = { method, ...this.diagnostics() };
      }
      throw error;
    }
  }

  async shutdown() {
    if (this.closed) {
      await this.waitForExit();
      return;
    }
    try {
      await raceTimeout(
        this.connection.sendRequest("shutdown", null),
        SHUTDOWN_TIMEOUT_MS,
      );
      await this.connection.sendNotification("exit");
    } catch {
      // A failed graceful shutdown is followed by deterministic process-tree cleanup.
    } finally {
      this.forceClose();
      await this.waitForExit();
    }
  }

  async waitForExit(timeoutMs = FORCE_CLOSE_WAIT_MS) {
    if (!this.child?.pid || this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      const child = this.child;
      function done() {
        clearTimeout(timer);
        child.off("close", done);
        resolve();
      }
      child.once("close", done);
    });
  }

  forceClose() {
    if (this.closed) return;
    this.closed = true;
    try { this.connection?.dispose(); } catch { /* already closed */ }
    terminateProcessTree(this.child);
  }

  status() {
    return {
      running: Boolean(this.child?.pid && !this.closed && !this.child.killed),
      pid: this.child?.pid ?? null,
      projectRoot: this.projectRoot,
      provider: this.spec.provider,
      backend: this.spec.backend,
      capabilities: this.capabilities,
      openDocumentCount: this.documents.size,
      openDocumentBytes: documentBytes(this.documents),
      documentCacheLimits: { files: MAX_DOCUMENTS, bytes: MAX_DOCUMENT_BYTES },
      pendingDocumentCount: this.documentChains.size,
      documentReadCount: this.documentReadCount,
      documentCacheHitCount: this.documentCacheHitCount,
      stderrTail: this.stderr.slice(-8192) || null,
    };
  }
}
