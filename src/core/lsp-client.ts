import type { ChildProcess } from "node:child_process";
import { ToolError } from "./errors.js";
import { killTree } from "./proc.js";

type Pending = { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout };

/** Minimal LSP JSON-RPC over stdio (Content-Length framing). No external dependency. */
export class LspClient {
  private buffer: Buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, (params: any) => void>();
  private closed = false;

  constructor(readonly child: ChildProcess) {
    child.stdout!.on("data", (chunk: Buffer) => this.receive(chunk));
    child.stderr?.resume();
    child.once("exit", () => this.fail(new ToolError("LSP_EXITED", "Language server exited")));
    child.stdin!.on("error", () => this.fail(new ToolError("LSP_EXITED", "Language server pipe closed")));
  }

  onNotification(method: string, handler: (params: any) => void) {
    this.handlers.set(method, handler);
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 20000, signal?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(new ToolError("LSP_EXITED", "Language server is not running"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.notify("$/cancelRequest", { id });
        reject(new ToolError("TIMEOUT", `${method} timed out after ${timeoutMs} ms`, undefined, "The language server may still be indexing; retry shortly", true));
      }, timeoutMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        this.pending.delete(id);
        this.notify("$/cancelRequest", { id });
        reject(new ToolError("CANCELLED", "Cancelled"));
      }, { once: true });
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
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
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString("ascii"))?.[1]);
      if (!Number.isFinite(length)) { this.buffer = this.buffer.subarray(headerEnd + 4); continue; }
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      let message: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string; code: number } };
      try { message = JSON.parse(body); } catch { continue; }
      if (message.method && message.id !== undefined) {
        // Server->client request (workspace/configuration etc.): answer null.
        this.send({ jsonrpc: "2.0", id: message.id, result: message.method === "workspace/configuration" ? [] : null });
      } else if (message.method) {
        this.handlers.get(message.method)?.(message.params);
      } else if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new ToolError(message.error.code === -32601 ? "CAPABILITY_UNAVAILABLE" : "LSP_ERROR", message.error.message));
        else pending.resolve(message.result);
      }
    }
  }

  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
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
