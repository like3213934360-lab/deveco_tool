import { URI } from "vscode-uri";
import { OfficialLspClient } from "./client.mjs";
import { resolveLspTarget } from "./project-root.mjs";
import {
  officialArktsServerStatus,
  resolveOfficialArktsServer,
  setOfficialArktsServerForTests,
} from "./server-registry.mjs";

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 120000;
const INITIALIZE_TIMEOUT_MS = 120000;
const DEFAULT_IDLE_MS = 60 * 1000;
const MIN_IDLE_MS = 30000;
const MAX_IDLE_MS = 30 * 60 * 1000;

const OPERATIONS = new Set([
  "goToDefinition",
  "findReferences",
  "hover",
  "goToImplementation",
]);

const CAPABILITIES = {
  goToDefinition: "definitionProvider",
  findReferences: "referencesProvider",
  hover: "hoverProvider",
  goToImplementation: "implementationProvider",
};

const CAPABILITY_METHODS = {
  goToDefinition: "textDocument/definition",
  findReferences: "textDocument/references",
  hover: "textDocument/hover",
  goToImplementation: "textDocument/implementation",
};

function boundedTimeout(value) {
  const parsed = Number(value);
  return Math.min(
    Math.max(Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS, 1000),
    MAX_TIMEOUT_MS,
  );
}

function idleMs() {
  const parsed = Number(process.env.DEVECO_LSP_IDLE_MS);
  if (!Number.isInteger(parsed)) return DEFAULT_IDLE_MS;
  return Math.min(Math.max(parsed, MIN_IDLE_MS), MAX_IDLE_MS);
}

function position(line, character) {
  const lineNumber = Number(line);
  const characterNumber = Number(character);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    const error = new Error("line must be a positive integer (1-based).");
    error.code = "LSP_INVALID_POSITION";
    throw error;
  }
  if (!Number.isInteger(characterNumber) || characterNumber < 1) {
    const error = new Error("character must be a positive integer (1-based).");
    error.code = "LSP_INVALID_POSITION";
    throw error;
  }
  return { line: lineNumber - 1, character: characterNumber - 1 };
}

function startupWait(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(
          "The official ArkTS language server is still initializing the project.",
        );
        error.code = "LSP_INITIALIZING";
        error.hint = "Retry the same LSP request; initialization continues in the background.";
        error.details = { retryable: true, waitedMs: timeoutMs };
        reject(error);
      }, timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function remainingMs(startedAt, timeoutMs, phase) {
  const remaining = timeoutMs - (Date.now() - startedAt);
  if (remaining > 0) return remaining;
  const error = new Error(`Official ArkTS LSP call exceeded its ${timeoutMs}ms deadline.`);
  error.code = "LSP_TIMEOUT";
  error.details = { timeoutMs, phase };
  throw error;
}

class OfficialLspService {
  constructor() {
    this.client = null;
    this.starting = null;
    this.startingRoot = null;
    this.startingAbort = null;
    this.failed = null;
    this.active = 0;
    this.idleTimer = null;
    this.generation = 0;
  }

  clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  scheduleIdleShutdown() {
    this.clearIdleTimer();
    if (!this.client || this.active > 0) return;
    this.idleTimer = setTimeout(() => {
      const client = this.client;
      this.client = null;
      this.idleTimer = null;
      void client?.shutdown();
    }, idleMs());
    this.idleTimer.unref?.();
  }

  async clientFor(projectRoot, waitMs) {
    this.clearIdleTimer();
    if (this.client?.projectRoot === projectRoot && !this.client.closed) return this.client;
    if (this.failed?.projectRoot === projectRoot) throw this.failed.error;

    if (this.client && this.client.projectRoot !== projectRoot) {
      if (this.active > 0) {
        const error = new Error("Another ArkTS LSP operation is active in a different project.");
        error.code = "LSP_BUSY";
        error.details = {
          activeRoot: this.client.projectRoot,
          requestedRoot: projectRoot,
        };
        throw error;
      }
      const previous = this.client;
      this.client = null;
      await previous.shutdown();
    }

    if (this.starting && this.startingRoot !== projectRoot) {
      const error = new Error("The official ArkTS language server is initializing another project.");
      error.code = "LSP_BUSY";
      error.details = { activeRoot: this.startingRoot, requestedRoot: projectRoot };
      throw error;
    }

    if (!this.starting) {
      this.startingRoot = projectRoot;
      const spec = resolveOfficialArktsServer(projectRoot);
      const generation = this.generation;
      const controller = new AbortController();
      this.startingAbort = controller;
      const startup = OfficialLspClient.start(
        spec,
        projectRoot,
        INITIALIZE_TIMEOUT_MS,
        controller.signal,
      );
      let tracked;
      tracked = startup.then(async (client) => {
        if (generation !== this.generation) {
          await client.shutdown();
          const error = new Error("ArkTS LSP initialization was cancelled by a service reset.");
          error.code = "LSP_RESET";
          throw error;
        }
        this.client = client;
        this.failed = null;
        this.scheduleIdleShutdown();
        return client;
      }, (error) => {
        if (generation === this.generation) this.failed = { projectRoot, error };
        throw error;
      }).finally(() => {
        if (this.starting === tracked) {
          this.starting = null;
          this.startingRoot = null;
          if (this.startingAbort === controller) this.startingAbort = null;
        }
      });
      this.starting = tracked;
      this.starting.catch(() => {});
    }
    return startupWait(this.starting, waitMs);
  }

  requireCapability(client, operation) {
    const capability = CAPABILITIES[operation];
    if (!capability || client.supports(capability, CAPABILITY_METHODS[operation])) return;
    const error = new Error(
      `The official ArkTS ace-server does not advertise ${capability}.`,
    );
    error.code = "LSP_CAPABILITY_UNSUPPORTED";
    error.hint = "This operation cannot be completed by the installed official language server version.";
    error.details = { operation, capability, projectRoot: client.projectRoot };
    throw error;
  }

  async execute(args) {
    const operation = args.operation;
    if (!OPERATIONS.has(operation)) {
      const error = new Error(`Unsupported official ArkTS LSP operation: ${operation}`);
      error.code = "LSP_OPERATION_INVALID";
      error.details = { supported: [...OPERATIONS] };
      throw error;
    }
    const timeoutMs = boundedTimeout(args.timeoutMs);
    const startedAt = Date.now();
    const target = resolveLspTarget(args.filePath);
    const at = position(args.line, args.character);
    const client = await this.clientFor(
      target.projectRoot,
      remainingMs(startedAt, timeoutMs, "initialization"),
    );
    this.clearIdleTimer();
    this.active += 1;
    try {
      this.requireCapability(client, operation);
      const uri = await client.syncDocuments(
        target.filePath,
        remainingMs(startedAt, timeoutMs, "documentSync"),
      );
      const textDocument = { textDocument: { uri } };
      if (operation === "goToDefinition") {
        return await client.request("textDocument/definition", {
          ...textDocument, position: at,
        }, remainingMs(startedAt, timeoutMs, "request"));
      }
      if (operation === "findReferences") {
        const references = await client.request("textDocument/references", {
          ...textDocument,
          position: at,
          context: { includeDeclaration: args.includeDeclaration !== false },
        }, remainingMs(startedAt, timeoutMs, "request"));
        if (args.includeDeclaration !== false || !references?.length) return references;
        // Current ace-server ignores includeDeclaration. Resolve declaration
        // locations through its own semantic service, never by matching text.
        this.requireCapability(client, "goToDefinition");
        const declarations = new Map();
        const usages = [];
        for (const reference of references) {
          const referenceUri = URI.parse(reference.uri).toString();
          const start = reference.range.start;
          const key = `${referenceUri}\0${start.line}\0${start.character}`;
          if (!declarations.has(key)) {
            // An interface's references may include several implementation
            // declarations. Resolve each location, not just the queried symbol.
            const definitions = await client.request("textDocument/definition", {
              textDocument: { uri: referenceUri }, position: start,
            }, remainingMs(startedAt, timeoutMs, "declarationFilter"));
            const entries = Array.isArray(definitions) ? definitions : definitions ? [definitions] : [];
            declarations.set(key, entries.some((definition) => {
              const targetUri = definition.targetUri ?? definition.uri;
              const range = definition.targetSelectionRange ?? definition.range;
              return targetUri && URI.parse(targetUri).toString() === referenceUri && range
                && range.start.line === start.line && range.start.character === start.character;
            }));
          }
          if (!declarations.get(key)) usages.push(reference);
        }
        return usages;
      }
      if (operation === "hover") {
        return await client.request("textDocument/hover", {
          ...textDocument, position: at,
        }, remainingMs(startedAt, timeoutMs, "request"));
      }
      return await client.request("textDocument/implementation", {
        ...textDocument,
        position: at,
      }, remainingMs(startedAt, timeoutMs, "request"));
    } catch (error) {
      if (client.closed) {
        this.client = null;
        this.failed = { projectRoot: target.projectRoot, error };
      }
      throw error;
    } finally {
      this.active -= 1;
      this.scheduleIdleShutdown();
    }
  }

  async reset() {
    this.generation += 1;
    this.clearIdleTimer();
    const client = this.client;
    this.client = null;
    const starting = this.starting;
    const startingAbort = this.startingAbort;
    this.starting = null;
    this.startingRoot = null;
    this.startingAbort = null;
    this.failed = null;
    startingAbort?.abort();
    await Promise.allSettled([
      client?.shutdown(),
      starting,
    ].filter(Boolean));
  }

  status() {
    const installed = officialArktsServerStatus();
    const client = this.client?.status();
    return {
      ...installed,
      state: this.failed ? "error" : this.starting ? "starting" : client?.running ? "ready" : "idle",
      running: client?.running ?? false,
      projectPath: client?.projectRoot ?? this.startingRoot ?? this.failed?.projectRoot ?? null,
      serverRoot: client?.projectRoot ?? this.startingRoot ?? this.failed?.projectRoot ?? null,
      pid: client?.pid ?? null,
      capabilities: client?.capabilities ?? null,
      openDocumentCount: client?.openDocumentCount ?? 0,
      openDocumentBytes: client?.openDocumentBytes ?? 0,
      documentCacheLimits: client?.documentCacheLimits ?? { files: 32, bytes: 16 * 1024 * 1024 },
      pendingDocumentCount: client?.pendingDocumentCount ?? 0,
      documentReadCount: client?.documentReadCount ?? 0,
      documentCacheHitCount: client?.documentCacheHitCount ?? 0,
      processLimits: {
        idleMs: idleMs(),
        idleShutdownScheduled: Boolean(this.idleTimer),
        initializationMs: INITIALIZE_TIMEOUT_MS,
      },
      lastError: this.failed ? {
        code: this.failed.error.code ?? "LSP_START_FAILED",
        message: this.failed.error.message,
        details: this.failed.error.details ?? null,
      } : null,
    };
  }
}

const service = new OfficialLspService();

export function executeOfficialLsp(args, options) {
  return service.execute(args, options);
}

export function officialLspStatus() {
  return service.status();
}

export function resetOfficialLsp() {
  return service.reset();
}

export async function setOfficialLspServerForTests(command) {
  await service.reset();
  setOfficialArktsServerForTests(command);
}

export function lspUriToPath(uri) {
  return URI.parse(uri).fsPath;
}
