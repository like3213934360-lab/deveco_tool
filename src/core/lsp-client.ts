import type { ChildProcess } from "node:child_process";
import { ToolError } from "./errors.js";
import { killTree } from "./proc.js";

type Pending = { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout; cleanup(): void };

/** Shared bounded framing for SDK responses and editor notifications. */
export class LspMessages {
  private buffer: Buffer = Buffer.alloc(0);
  clear() { this.buffer = Buffer.alloc(0); }
  *receive(chunk: Buffer): Generator<any> {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0 && this.buffer.length <= 8192) return;
      if (headerEnd < 0 || headerEnd > 8192) throw new ToolError("LSP_PROTOCOL_ERROR", "Language-server header exceeds 8 KiB");
      const length = Number(/^Content-Length:\s*(\d+)\s*$/im.exec(this.buffer.subarray(0, headerEnd).toString("ascii"))?.[1]);
      if (!Number.isSafeInteger(length) || length < 1 || length > 16 * 1024 * 1024)
        throw new ToolError("LSP_PROTOCOL_ERROR", "Invalid language-server Content-Length (maximum 16 MiB)");
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      let message: any;
      try {
        message = JSON.parse(body);
        if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Expected an object");
      } catch { throw new ToolError("LSP_PROTOCOL_ERROR", "Invalid language-server JSON message"); }
      yield message;
    }
  }
}

/** Minimal LSP JSON-RPC over stdio (Content-Length framing). No external dependency. */
export class LspClient {
  private readonly messages = new LspMessages();
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, (params: any) => void>();
  private closed = false;

  constructor(readonly child: ChildProcess) {
    child.stdout!.on("data", (chunk: Buffer) => this.receive(chunk));
    child.stderr?.resume();
    child.once("error", (error) => this.fail(new ToolError("LSP_EXITED", `Cannot start language server: ${error.message}`), true));
    child.once("exit", () => this.fail(new ToolError("LSP_EXITED", "Language server exited")));
    child.stdin!.on("error", () => this.fail(new ToolError("LSP_EXITED", "Language server pipe closed"), true));
  }

  onNotification(method: string, handler: (params: any) => void) {
    this.handlers.set(method, handler);
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 20000, signal?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(new ToolError("LSP_EXITED", "Language server is not running"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) { reject(new ToolError("CANCELLED", "Cancelled")); return; }
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      const abort = () => {
        cleanup(); this.pending.delete(id); this.notify("$/cancelRequest", { id });
        reject(new ToolError("CANCELLED", "Cancelled"));
      };
      const timer = setTimeout(() => {
        cleanup(); this.pending.delete(id); this.notify("$/cancelRequest", { id });
        reject(new ToolError("TIMEOUT", `${method} timed out after ${timeoutMs} ms`, undefined, "The language server may still be indexing; retry shortly", true));
      }, timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, cleanup });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown) {
    if (!this.closed) this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: unknown) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    this.child.stdin!.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]));
  }

  private receive(chunk: Buffer) {
    if (this.closed) return;
    try { for (const message of this.messages.receive(chunk)) {
      if (message.method && message.id !== undefined) {
        // Server->client request (workspace/configuration etc.): answer null.
        this.send({ jsonrpc: "2.0", id: message.id, result: message.method === "workspace/configuration" ? [] : null });
      } else if (message.method) {
        try { this.handlers.get(message.method)?.(message.params); }
        catch (error) { return this.fail(new ToolError("LSP_ERROR", `Language-server notification failed: ${(error as Error).message}`), true); }
      } else if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        pending.cleanup();
        if (message.error) pending.reject(new ToolError(message.error.code === -32601 ? "CAPABILITY_UNAVAILABLE" : "LSP_ERROR", message.error.message));
        else pending.resolve(message.result);
      }
    } } catch (error) { this.fail(error as Error, true); }
  }

  private fail(error: Error, terminate = false) {
    if (this.closed) return;
    this.closed = true;
    this.messages.clear();
    if (terminate) killTree(this.child, "SIGKILL");
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }

  async close() {
    if (this.closed) return;
    try {
      await this.request("shutdown", null, 3000);
      this.notify("exit", null);
    } catch { /* ignore */ }
    this.fail(new ToolError("LSP_EXITED", "Closed"));
    setTimeout(() => killTree(this.child, "SIGKILL"), 1000).unref();
  }
}
