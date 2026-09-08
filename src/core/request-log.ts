import type Database from "better-sqlite3";
import { StateStore } from "./store.js";
import { invariant } from "./errors.js";

interface Event {
  kind: "request_start" | "request_finish" | "request_failed";
  data: string;
  created: number;
  bytes: number;
}

/** Ordinary request telemetry can be lost on a hard crash within its 20 ms
 * flush window. Workflow checkpoints, ownership and side-effect receipts never
 * use this buffer. Reserve its bounded footprint in the shared quota before
 * accepting any events, and flush synchronously at capacity or on shutdown. */
export class RequestLog {
  private readonly reservation: ReturnType<StateStore["streamArtifact"]>;
  private readonly insert: Database.Statement;
  private readonly pending: Event[] = [];
  private bytes = 0;
  private timer?: NodeJS.Timeout;
  private failure: unknown;
  private failed = false;
  private closed = false;
  private readonly maximumBytes = 64 * 1024;

  constructor(readonly store: StateStore, readonly onFailure: (error: unknown) => void) {
    this.reservation = store.streamArtifact("request-log-buffer", "application/json");
    try {
      this.reservation.reserve(this.maximumBytes);
      this.insert = store.db.prepare("INSERT INTO events(run_id,kind,data,created) VALUES (NULL,?,?,?)");
    } catch (error) {
      this.reservation.discard();
      throw error;
    }
  }

  get metrics() {
    return { pending_events: this.pending.length, pending_bytes: this.bytes, maximum_bytes: this.maximumBytes, flush_ms: 20, failed: this.failed };
  }

  write(kind: Event["kind"], data: unknown): void {
    invariant(!this.closed, "REQUEST_LOG_CLOSED", "Request logger is closed");
    if (this.failed) throw this.failure;
    const serialized = JSON.stringify(data);
    invariant(typeof serialized === "string", "EVENT_INVALID", "Request event must be serializable");
    const size = Buffer.byteLength(serialized);
    invariant(size <= 16384, "EVENT_TOO_LARGE", "Use an artifact for large data");
    // Charge UTF-16 storage and row/array overhead as well as payload bytes.
    const bytes = size * 2 + 256;
    if (this.bytes + bytes > this.maximumBytes || this.pending.length >= 128) this.flush();
    this.pending.push({ kind, data: serialized, created: Date.now(), bytes });
    this.bytes += bytes;
    this.timer ??= setTimeout(() => {
      try { this.flush(); }
      catch (error) { this.onFailure(error); }
    }, 20).unref();
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.failed) throw this.failure;
    if (!this.pending.length) return;
    try {
      this.store.db.transaction(() => {
        this.store.capacity(this.bytes);
        for (const event of this.pending) this.insert.run(event.kind, event.data, event.created);
      }).immediate();
      this.pending.length = 0;
      this.bytes = 0;
    } catch (error) {
      // Keep the bounded batch for diagnosis; no later request may silently
      // continue after persistence has failed. The owner must be restarted.
      this.failed = true;
      this.failure = error;
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.flush(); }
    finally { this.reservation.discard(); }
  }
}
