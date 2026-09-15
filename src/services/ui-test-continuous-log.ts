import { z } from "zod";
import { invariant, errorResult, ToolError } from "../core/errors.js";
import type { StateStore } from "../core/store.js";
import { withTrace } from "../core/trace.js";
import {
  LogStreamCollector,
  deviceLogTransport,
  type LogTransport,
  type LogBatch,
} from "./ui-log-stream.js";
import type { DeviceService } from "./device.js";

const gapSchema = z.strictObject({
  code: z.string(),
  first_at: z.number(),
  last_at: z.number(),
  occurrences: z.number(),
  discarded_bytes: z.number().default(0),
  from_ns: z.string().optional(),
  to_ns: z.string().optional(),
});
const sessionSchema = z.strictObject({
  format: z.literal(1),
  target: z.string(),
  bundle_name: z.string(),
  started_at: z.number(),
  ended_at: z.number().optional(),
  first_received_ns: z.string().optional(),
  last_received_ns: z.string().optional(),
  ready_at: z.number().optional(),
  current_ready_at: z.number().optional(),
  step_id: z.string(),
  stage: z.string(),
  bytes: z.number(),
  lines: z.number(),
  chunk_count: z.number(),
  gaps: z.array(gapSchema).max(256),
  omitted_gap_events: z.number().default(0),
  stop_reason: z.string().optional(),
  resumes: z.number().default(0),
});
const chunkSchema = z.strictObject({
  id: z.number().int(),
  sequence: z.number().int(),
  step_id: z.string(),
  stage: z.string(),
  source: z.literal("continuous"),
  status: z.literal("captured"),
  artifact_id: z.string().uuid(),
  bytes: z.number(),
  line_count: z.number(),
  sha256: z.string(),
  start_ns: z.string(),
  end_ns: z.string(),
  processes: z.record(z.string(), z.string()),
  uid: z.string().optional(),
  skipped_lines: z.number(),
  complete: z.literal(false),
  received_range_verified: z.literal(true),
});
type Session = z.infer<typeof sessionSchema>;
type Chunk = z.infer<typeof chunkSchema>;
interface Row {
  run_id: string;
  owner: string | null;
  state: string;
  payload: string;
  updated: number;
}
interface Active {
  collector: LogStreamCollector;
  controller: AbortController;
  done: Promise<void>;
  session: Session;
  idle: NodeJS.Timeout;
}
const scope = {
  mode: "continuous_application_pid_generations",
  complete: false,
  system_delivery: "unknown",
  lifecycle_coverage:
    "Observed application UID and PID/starttime pairs, at most five concurrent processes; short-lived processes entirely between identity polls or isolated children using another UID are not provably captured.",
  readiness:
    "First complete attributed line retained after a second process identity check; spawning HDC alone is not readiness.",
  boundaries:
    "Pre-registration, reconnect and unverified tails are gaps. Each retained chunk has verified process generations and device time bounds; receipt of every log produced by the app is not asserted.",
  max_bytes: 64 * 1024 * 1024,
  max_chunks: 8192,
  max_pending_bytes: 512 * 1024,
  identity_poll_ms: 1000,
  idle_timeout_ms: 120000,
};

export class UiTestContinuousLogService {
  private readonly active = new Map<string, Active>();
  private closed = false;
  constructor(
    readonly store: StateStore,
    readonly transport: (target: string, bundle: string) => LogTransport,
  ) {}
  static forDevice(store: StateStore, devices: DeviceService) {
    return new UiTestContinuousLogService(store, (target, bundle) =>
      deviceLogTransport(devices, target, bundle),
    );
  }
  private row(id: string) {
    return this.store.db
      .prepare("SELECT * FROM ui_log_sessions WHERE run_id=?")
      .get(id) as Row | undefined;
  }
  private save(
    id: string,
    session: Session,
    state = "running",
    owner: string | null = this.store.owner,
  ) {
    this.store.db
      .prepare(
        "INSERT INTO ui_log_sessions VALUES (?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET owner=excluded.owner,state=excluded.state,payload=excluded.payload,updated=excluded.updated",
      )
      .run(
        id,
        owner,
        state,
        JSON.stringify(sessionSchema.parse(session)),
        Date.now(),
      );
  }
  private gap(
    id: string,
    session: Session,
    code: string,
    details: {
      discarded_bytes?: number;
      from_ns?: string;
      to_ns?: string;
    } = {},
  ) {
    const now = Date.now(),
      last = session.gaps.at(-1);
    if (last?.code === code) {
      last.last_at = now;
      last.occurrences++;
      last.discarded_bytes += details.discarded_bytes ?? 0;
      if (details.to_ns) last.to_ns = details.to_ns;
    } else if (session.gaps.length < 256)
      session.gaps.push({
        code,
        first_at: now,
        last_at: now,
        occurrences: 1,
        discarded_bytes: 0,
        ...details,
      });
    else session.omitted_gap_events++;
    this.save(id, session);
  }
  private batch(id: string, session: Session, batch: LogBatch) {
    invariant(
      session.bytes + Buffer.byteLength(batch.content) <= scope.max_bytes,
      "UI_LOG_DISK_BUDGET",
      "Continuous test logs reached their 64 MiB disk budget; earlier chunks remain readable",
    );
    invariant(
      session.chunk_count < scope.max_chunks,
      "UI_LOG_CHUNK_BUDGET",
      "Continuous test logs reached their chunk budget; earlier chunks remain readable",
    );
    // Artifact publication is crash recoverable. A crash before the metadata
    // commit leaves a retained run artifact and an interrupted-session gap.
    const artifact = this.store.artifact(id, batch.content, "text/plain");
    const chunk: Chunk = {
      id: 500 + session.chunk_count,
      sequence: session.chunk_count,
      step_id: session.step_id,
      stage: session.stage,
      source: "continuous",
      status: "captured",
      artifact_id: artifact.artifact_id,
      bytes: artifact.bytes,
      line_count: batch.lines,
      sha256: batch.sha256,
      start_ns: batch.start_ns,
      end_ns: batch.end_ns,
      processes: batch.processes,
      ...(batch.uid ? { uid: batch.uid } : {}),
      skipped_lines: batch.skipped,
      complete: false,
      received_range_verified: true,
    };
    const next = { ...session,
      chunk_count: session.chunk_count + 1,
      bytes: session.bytes + artifact.bytes,
      lines: session.lines + batch.lines,
      last_received_ns: batch.end_ns,
    };
    this.store.db.transaction(() => {
      this.store.db
        .prepare("INSERT INTO ui_log_chunks VALUES (?,?,?)")
        .run(id, chunk.sequence, JSON.stringify(chunkSchema.parse(chunk)));
      this.save(id, next);
    })();
    // Do not advance the in-memory sequence when SQLite rolls back. A failed
    // metadata commit must not fabricate retained chunks or skip their IDs.
    Object.assign(session, next);
  }
  private touch(id: string, active: Active) {
    clearTimeout(active.idle);
    active.idle = setTimeout(() => {
      void this.stop(id, "idle_timeout").catch(() => {});
    }, scope.idle_timeout_ms);
    active.idle.unref();
  }
  /** Starts an independently leased, explicitly joined background reader. No
   * application action is replayed while resuming collection. */
  async ensure(
    id: string,
    target: string,
    bundle: string,
    step: string,
    stage: string,
    secrets: string[] = [],
  ) {
    invariant(
      !this.closed,
      "UI_LOG_CLOSED",
      "Continuous log service is closed",
    );
    const existing = this.active.get(id);
    if (existing) {
      invariant(existing.session.target === target && existing.session.bundle_name === bundle,
        "UI_LOG_SCOPE_CHANGED", "A saved test log cannot change application or device");
      existing.collector.redact(secrets);
      // A boundary is a host observation, not a device-clock fence. Record it
      // separately so a line delivered late isn't claimed as action causality.
      if (
        existing.session.step_id !== step ||
        existing.session.stage !== stage
      ) {
        await existing.collector.checkpoint();
        this.gap(id, existing.session, "step_delivery_boundary", {});
        existing.session.step_id = step;
        existing.session.stage = stage;
        this.save(id, existing.session);
      }
      this.touch(id, existing);
      return;
    }
    const old = this.row(id);
    if (old) {
      const previous = sessionSchema.parse(JSON.parse(old.payload));
      invariant(previous.target === target && previous.bundle_name === bundle,
        "UI_LOG_SCOPE_CHANGED", "A saved test log cannot change application or device");
    }
    if (old?.state === "exhausted") return;
    // Do not wait indefinitely on another runtime's live reader. Its identity
    // and lease remain authoritative; this runtime can only resume after release.
    this.store.reconcile();
    if (
      old?.state === "running" &&
      this.store.db
        .prepare("SELECT 1 FROM leases WHERE resource=?")
        .get(`ui-log:${id}`)
    )
      return;
    const session = old
      ? sessionSchema.parse(JSON.parse(old.payload))
      : sessionSchema.parse({
          format: 1,
          target,
          bundle_name: bundle,
          started_at: Date.now(),
          step_id: step,
          stage,
          bytes: 0,
          lines: 0,
          chunk_count: 0,
          gaps: [],
        });
    invariant(
      session.target === target && session.bundle_name === bundle,
      "UI_LOG_SCOPE_CHANGED",
      "A saved test log cannot change application or device",
    );
    const controller = new AbortController();
    let releaseStart!: () => void;
    const started = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const collector = new LogStreamCollector(this.transport(target, bundle), {
      batch: (batch) => this.batch(id, session, batch),
      gap: (code, details) => this.gap(id, session, code, details),
      ready: (_identity, first) => {
        session.ready_at ??= Date.now();
        session.current_ready_at ??= Date.now();
        session.first_received_ns ??= first;
        this.save(id, session);
      },
    });
    collector.redact(secrets);
    const active: Active = {
      controller,
      collector,
      session,
      done: Promise.resolve(),
      idle: setTimeout(() => {}, 0),
    };
    this.active.set(id, active);
    active.done = withTrace({ run_id: id, node: "continuous_ui_log" }, () =>
      this.store.lease(
        `ui-log:${id}`,
        async () => {
          // Re-read under the cross-process lease; historical metadata may have
          // advanced while another runtime still owned the capture.
          const current = this.row(id);
          invariant(
            !current || current.updated === old?.updated,
            "UI_LOG_OWNER_CHANGED",
            "Refresh the test after the previous log collector releases its lease",
          );
          if (old) {
            session.resumes++;
            this.gap(
              id,
              session,
              old.state === "running"
                ? "runtime_interrupted"
                : "capture_resumed",
              { from_ns: session.last_received_ns },
            );
          }
          session.step_id = step;
          session.stage = stage;
          delete session.current_ready_at;
          delete session.ended_at;
          delete session.stop_reason;
          this.save(id, session);
          releaseStart();
          let terminal: string | undefined;
          try {
            terminal = await collector.run(controller.signal);
          } catch (error) {
            if (!controller.signal.aborted) {
              terminal = errorResult(error).code;
              try {
                this.gap(id, session, terminal);
              } catch {
                /* DB failure is visible as an unclosed interval on the next read. */
              }
            }
          } finally {
            session.ended_at = Date.now();
            session.stop_reason ??= terminal ?? "collector_stopped";
            this.save(id, session, terminal ? "exhausted" : "stopped", null);
          }
        },
        controller.signal,
        { independent: true },
      ),
    )
      .catch((error) => {
        // No raw log/error text is persisted. Starting conflicts are observable in
        // the session lease; keep the owned process promise joined and handled.
        if (!controller.signal.aborted && !this.row(id)) {
          session.stop_reason = errorResult(error).code;
          this.save(id, session, "stopped", null);
        }
      })
      .finally(() => {
        clearTimeout(active.idle);
        this.active.delete(id);
        releaseStart();
      });
    this.touch(id, active);
    await started;
  }
  status(id: string) {
    const row = this.row(id);
    if (!row) return { ...scope, state: "not_started", chunk_count: 0 };
    const session = sessionSchema.parse(JSON.parse(row.payload));
    let ownerAlive = false;
    if (row.owner) {
      try {
        process.kill(Number(row.owner.split(":")[0]), 0);
        ownerAlive = true;
      } catch (error) {
        ownerAlive = (error as NodeJS.ErrnoException).code === "EPERM";
      }
    }
    const interrupted =
      row.state === "running" &&
      (!ownerAlive || (row.owner === this.store.owner && !this.active.has(id)));
    return {
      ...scope,
      ...session,
      state: interrupted ? "interrupted" : row.state,
      ...(interrupted
        ? {
            pending_gap: "runtime_interrupted_or_storage_failure",
            complete: false,
          }
        : {}),
    };
  }
  chunks(id: string, offset = 0, limit = 100): Chunk[] {
    return (
      this.store.db
        .prepare(
          "SELECT payload FROM ui_log_chunks WHERE run_id=? ORDER BY sequence LIMIT ? OFFSET ?",
        )
        .all(id, limit, offset) as { payload: string }[]
    ).map((row) => chunkSchema.parse(JSON.parse(row.payload)));
  }
  chunk(id: string, chunkId: number) {
    const row = this.store.db
      .prepare(
        "SELECT payload FROM ui_log_chunks WHERE run_id=? AND sequence=?",
      )
      .get(id, chunkId - 500) as { payload: string } | undefined;
    return row ? chunkSchema.parse(JSON.parse(row.payload)) : undefined;
  }
  async stop(id: string, reason: string) {
    const active = this.active.get(id);
    if (!active) return;
    active.session.stop_reason = reason;
    try {
      if (["test_finished", "evidence_export", "runtime_shutdown"].includes(reason))
        await active.collector.checkpoint();
      this.gap(id, active.session, reason);
    } finally {
      active.controller.abort(
        new ToolError("CANCELLED", "Continuous log capture stopped"),
      );
      await active.done;
    }
  }
  async close() {
    this.closed = true;
    await Promise.allSettled(
      [...this.active.keys()].map((id) => this.stop(id, "runtime_shutdown")),
    );
  }
}
