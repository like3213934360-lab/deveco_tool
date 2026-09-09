import { Worker } from "node:worker_threads";
import crypto from "node:crypto";
import { ipcOutput } from "./ipc.js";
import { ToolError, invariant } from "./errors.js";
import type { ToolName } from "./contracts.js";

export class WorkerClient {
  private worker?: Worker;
  private closing = false;
  private shutdown?: Promise<unknown>;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
      cleanup: () => void;
    }
  >();
  constructor(
    readonly fatal: (error: Error) => void,
    private readonly createWorker = () =>
      new Worker(new URL("../worker.js", import.meta.url), {
        stdout: true,
        stderr: true,
      }),
  ) {}
  private start(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    this.worker = worker;
    // Native libraries must never contaminate MCP's stdout protocol stream.
    worker.stdout.resume();
    worker.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    worker.on("message", (raw: unknown) => {
      const message = ipcOutput.parse(raw),
        request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      request.cleanup();
      if (message.ok) request.resolve(message.data);
      else
        request.reject(
          new ToolError(
            message.error?.code ?? "WORKER_ERROR",
            message.error?.message ?? "Worker request failed",
            message.error?.details,
            message.error?.retryable,
          ),
        );
    });
    worker.on("error", (error) => this.fail(error));
    worker.on("exit", (code) => {
      if (this.worker === worker) this.worker = undefined;
      if (!this.closing || this.pending.size > 0)
        this.fail(
          new ToolError(
            "WORKER_EXITED",
            `Runtime worker exited (${code}) before completing its requests`,
          ),
        );
      this.closing = false;
      this.shutdown = undefined;
    });
    return worker;
  }
  private fail(error: Error) {
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    this.pending.clear();
    if (!this.closing) this.fatal(error);
  }
  async call(
    name: ToolName,
    input: unknown,
    signal?: AbortSignal,
    id = crypto.randomUUID(),
  ): Promise<unknown> {
    invariant(!this.closing, "RUNTIME_STOPPING", "Runtime is closing");
    invariant(
      this.pending.size < 64,
      "REQUEST_CAPACITY",
      "At most 64 outstanding runtime requests",
    );
    signal?.throwIfAborted();
    const worker = this.start();
    return new Promise((resolve, reject) => {
      const abort = () => worker.postMessage({ type: "cancel", id });
      const cleanup = () => signal?.removeEventListener("abort", abort);
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      worker.postMessage({ type: "call", id, name, input });
      if (signal?.aborted) abort();
    });
  }
  close(): Promise<unknown> {
    if (this.shutdown) return this.shutdown;
    if (!this.worker) return Promise.resolve({ closed: true });
    this.closing = true;
    return (this.shutdown = this.closeWorker(this.worker));
  }
  private async closeWorker(worker: Worker): Promise<unknown> {
    const id = crypto.randomUUID(),
      exited = new Promise<void>((resolve) =>
        worker.once("exit", () => resolve()),
      );
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        this.pending.set(id, { resolve, reject, cleanup: () => {} });
        worker.postMessage({ type: "close", id });
      });
      await exited;
      return result;
    } finally {
      this.pending.delete(id);
      // An error reply does not prove the worker and its owned children exited.
      // Keep it quarantined until its actual exit event, including when callers
      // retry restart. Never spawn a replacement alongside unconfirmed owners.
    }
  }
}
