import { Worker } from "node:worker_threads";
import { AsyncResource } from "node:async_hooks";
import { availableParallelism } from "node:os";
import {
  cpuReplySchema,
  cpuResultSchemas,
  cpuTaskSchema,
  type CpuTask,
  type CpuResult,
} from "./cpu-protocol.js";
import { invariant, ToolError } from "./errors.js";

interface Job {
  id: number;
  task: CpuTask;
  bytes: number;
  submitted: number;
  started?: number;
  resource: AsyncResource;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
  settled: boolean;
}
interface Slot {
  worker: Worker;
  job?: Job;
  idle?: NodeJS.Timeout;
  stopping: boolean;
  reason?: unknown;
  exited: Promise<void>;
  resolveExit: () => void;
}
export interface CpuObservation {
  kind: CpuTask["kind"];
  queue_ms: number;
  elapsed_ms: number;
  parse_ms?: number;
  outcome: "completed" | "failed";
  input_bytes: number;
}
interface Limits {
  workers?: number;
  queue?: number;
  bytes?: number;
  idleMs?: number;
  timeoutMs?: number;
}
/** Only pure, versioned parsers run here. Cancellation waits for thread exit;
 * no durable business state or external effects belong to this pool. */
export class CpuPool {
  private readonly slots = new Set<Slot>();
  private readonly queue: Job[] = [];
  private readonly limits: Required<Limits>;
  private bytes = 0;
  private sequence = 0;
  private closing = false;
  private closed?: Promise<void>;
  private completed = 0;
  private failed = 0;
  private spawned = 0;
  constructor(
    limits: Limits = {},
    private readonly observe?: (event: CpuObservation) => void,
  ) {
    this.limits = {
      workers: Math.min(2, availableParallelism()),
      queue: 16,
      bytes: 64 * 1024 * 1024,
      idleMs: 30000,
      timeoutMs: 15000,
      ...limits,
    };
    for (const [key, max] of Object.entries({
      workers: 2,
      queue: 16,
      bytes: 64 * 1024 * 1024,
      idleMs: 30000,
      timeoutMs: 30000,
    })) {
      const value = this.limits[key as keyof Limits];
      invariant(
        Number.isSafeInteger(value) && value > 0 && value <= max,
        "CPU_LIMIT_INVALID",
        `Invalid parser limit: ${key}`,
      );
    }
  }
  get metrics() {
    return {
      workers: this.slots.size,
      active: [...this.slots].filter((slot) => slot.job).length,
      queued: this.queue.length,
      input_bytes: this.bytes,
      completed: this.completed,
      failed: this.failed,
      spawned: this.spawned,
      limits: { ...this.limits },
    };
  }
  async run<T extends CpuTask>(
    input: T,
    signal?: AbortSignal,
  ): Promise<CpuResult<T["kind"]>> {
    invariant(!this.closing, "RUNTIME_STOPPING", "Parser pool is closing");
    signal?.throwIfAborted();
    const task = cpuTaskSchema.parse(input);
    // Strings use up to two bytes per code unit. Count UTF-8 too for input limits.
    const bytes =
      Math.max(task.content.length * 2, Buffer.byteLength(task.content)) + 4096;
    invariant(
      bytes + this.bytes <= this.limits.bytes,
      "CPU_MEMORY_CAPACITY",
      "Parser input memory budget reached",
    );
    invariant(
      this.queue.length < this.limits.queue,
      "CPU_QUEUE_CAPACITY",
      "Parser queue is full",
    );
    const result = new Promise<unknown>((resolve, reject) => {
      const job: Job = {
        id: ++this.sequence,
        task,
        bytes,
        submitted: performance.now(),
        resource: new AsyncResource("DevecoParserTask"),
        resolve,
        reject,
        cleanup: () => {},
        settled: false,
      };
      const abort = () =>
        this.cancel(
          job,
          signal?.reason ?? new DOMException("Cancelled", "AbortError"),
        );
      const timer = setTimeout(
        () =>
          this.cancel(
            job,
            new ToolError("CPU_TIMEOUT", "Parser deadline exceeded"),
          ),
        this.limits.timeoutMs,
      );
      job.cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.bytes += bytes;
      this.queue.push(job);
      this.pump();
      if (signal?.aborted) abort();
    });
    // The fixed kind-to-schema mapping is validated on every worker reply.
    return (await result) as CpuResult<T["kind"]>;
  }
  private settle(
    job: Job,
    outcome: { value: unknown; parseMs?: number } | { error: unknown },
  ) {
    if (job.settled) return;
    job.settled = true;
    job.cleanup();
    this.bytes -= job.bytes;
    const failed = "error" in outcome;
    if (failed) this.failed++;
    else this.completed++;
    job.resource.runInAsyncScope(() => {
      try {
        this.observe?.({
          kind: job.task.kind,
          queue_ms: (job.started ?? performance.now()) - job.submitted,
          elapsed_ms: performance.now() - job.submitted,
          parse_ms: failed ? undefined : outcome.parseMs,
          outcome: failed ? "failed" : "completed",
          input_bytes: job.bytes,
        });
      } catch {
        /* Observability must not retain completed tasks. */
      }
      if (failed) job.reject(outcome.error);
      else job.resolve(outcome.value);
    });
    job.resource.emitDestroy();
  }
  private cancel(job: Job, reason: unknown) {
    if (job.settled) return;
    const queued = this.queue.indexOf(job);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      this.settle(job, { error: reason });
      return;
    }
    const slot = [...this.slots].find((value) => value.job === job);
    if (slot) this.stop(slot, reason);
  }
  private stop(slot: Slot, reason?: unknown) {
    if (slot.stopping) return;
    slot.stopping = true;
    slot.reason = reason;
    clearTimeout(slot.idle);
    // Keep it in the capacity count until the 'exit' event confirms termination.
    void slot.worker.terminate().catch((error: unknown) => {
      slot.reason = error;
    });
  }
  private spawn(): Slot {
    const done = Promise.withResolvers<void>();
    const worker = new Worker(new URL("./cpu-worker.js", import.meta.url), {
      stdout: true,
      stderr: true,
      resourceLimits: {
        maxOldGenerationSizeMb: 192,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
      },
      // Do not propagate inspector/test flags into parser isolates.
      execArgv: [],
    });
    const slot: Slot = {
      worker,
      stopping: false,
      exited: done.promise,
      resolveExit: done.resolve,
    };
    this.slots.add(slot);
    this.spawned++;
    worker.stdout.resume();
    worker.stderr.resume();
    worker.on("message", (raw: unknown) => {
      if (slot.stopping) return;
      const job = slot.job;
      try {
        const reply = cpuReplySchema.parse(raw);
        invariant(
          job && reply.id === job.id,
          "CPU_PROTOCOL_ERROR",
          "Parser reply does not match its task",
        );
        if (reply.ok) {
          const value = cpuResultSchemas[job.task.kind].parse(reply.data);
          this.settle(job, { value, parseMs: reply.elapsed_ms });
        } else
          this.settle(job, {
            error: new ToolError(
              reply.error.code,
              reply.error.message,
              reply.error.details,
              reply.error.retryable,
            ),
          });
        slot.job = undefined;
        worker.unref();
        slot.idle = setTimeout(() => this.stop(slot), this.limits.idleMs);
        slot.idle.unref();
        this.pump();
      } catch (error) {
        this.stop(slot, error);
      }
    });
    worker.on("error", (error) => this.stop(slot, error));
    worker.on("exit", (code) => {
      clearTimeout(slot.idle);
      this.slots.delete(slot);
      if (slot.job)
        this.settle(slot.job, {
          error:
            slot.reason ??
            new ToolError(
              "CPU_WORKER_EXITED",
              `Parser exited before completing its task (${code})`,
            ),
        });
      slot.job = undefined;
      slot.resolveExit();
      this.pump();
    });
    return slot;
  }
  private pump() {
    if (this.closing) return;
    while (this.queue.length) {
      let slot = [...this.slots].find((item) => !item.stopping && !item.job);
      if (!slot && this.slots.size >= this.limits.workers) return;
      const job = this.queue.shift()!;
      try {
        slot ??= this.spawn();
      } catch (error) {
        this.settle(job, { error });
        continue;
      }
      clearTimeout(slot.idle);
      slot.worker.ref();
      slot.job = job;
      job.started = performance.now();
      try {
        slot.worker.postMessage({ id: job.id, task: job.task });
      } catch (error) {
        this.stop(slot, error);
      }
    }
  }
  close(): Promise<void> {
    return (this.closed ??= (async () => {
      this.closing = true;
      const error = new ToolError("RUNTIME_STOPPING", "Parser pool is closing");
      for (const job of this.queue.splice(0)) this.settle(job, { error });
      const slots = [...this.slots];
      for (const slot of slots) this.stop(slot, error);
      await Promise.all(slots.map((slot) => slot.exited));
    })());
  }
}
