import { threadId } from "node:worker_threads";
import { release, protocolVersion } from "./config.js";
import type { StateStore } from "./store.js";

export const runtimeSamplePolicy = { interval_ms: 60_000, maximum_samples: 2880 } as const;
const counterNames = ["active_requests", "owned_processes", "owned_listeners", "owned_connections",
  "parser_active", "parser_queued", "parser_workers", "lsp_active_requests", "ui_cache_entries"] as const;
export type RuntimeCounters = Record<(typeof counterNames)[number], number>;

/** Best-effort, fixed-size observations, independent of mandatory request receipts.
 * RSS covers the whole Node process; heap/external counters cover this Worker.
 * Samples share the ordinary event retention policy and also have a global cap.
 * Never retain inputs, paths, process arguments, errors or unbounded retry queues. */
export class RuntimeSamples {
  private readonly started = performance.now();
  private readonly timer: NodeJS.Timeout;
  private closed = false;
  private sequence = 0;
  private failedSamples = 0;
  private reportedFailure = false;

  constructor(private readonly store: StateStore, private readonly counters: () => RuntimeCounters,
    private readonly onFailure: (error: unknown) => void) {
    this.sample("startup");
    this.timer = setInterval(() => this.sample("interval"), runtimeSamplePolicy.interval_ms).unref();
  }

  private sample(reason: "startup" | "interval" | "shutdown") {
    if (this.closed) return;
    const sequence = ++this.sequence;
    try {
      const memory = process.memoryUsage(), counters = this.counters();
      const data = JSON.stringify({
        telemetry_version: 1, release, protocol: protocolVersion,
        instance_id: this.store.owner, pid: process.pid, thread_id: threadId, sequence, reason,
        uptime_ms: performance.now() - this.started, failed_samples: this.failedSamples,
        interval_ms: runtimeSamplePolicy.interval_ms, maximum_samples: runtimeSamplePolicy.maximum_samples,
        rss_bytes: memory.rss, heap_used_bytes: memory.heapUsed, heap_total_bytes: memory.heapTotal,
        external_bytes: memory.external, array_buffers_bytes: memory.arrayBuffers,
        ...Object.fromEntries(counterNames.map(name => [name,
          Number.isSafeInteger(counters[name]) && counters[name] >= 0 ? counters[name] : null])),
      });
      this.store.db.transaction(() => {
        this.store.capacity(Buffer.byteLength(data) * 2 + 256);
        this.store.db.prepare("INSERT INTO events(run_id,kind,data,created) VALUES (NULL,'runtime_sample',?,?)")
          .run(data, Date.now());
        this.store.db.prepare("DELETE FROM events WHERE run_id IS NULL AND kind='runtime_sample' AND id < (SELECT id FROM events WHERE run_id IS NULL AND kind='runtime_sample' ORDER BY id DESC LIMIT 1 OFFSET ?)")
          .run(runtimeSamplePolicy.maximum_samples - 1);
      }).immediate();
      this.reportedFailure = false;
    } catch (error) {
      this.failedSamples++;
      if (!this.reportedFailure) {
        this.reportedFailure = true;
        this.onFailure(error);
      }
    }
  }

  close() {
    if (this.closed) return;
    clearInterval(this.timer);
    this.sample("shutdown");
    this.closed = true;
  }
}
