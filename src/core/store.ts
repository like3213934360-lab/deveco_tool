import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { configuration, protocolVersion, stateDirectory } from "./config.js";
import { atomicWrite, digest, privateDirectory } from "./files.js";
import { errorResult, invariant, ToolError } from "./errors.js";
import { PayloadCipher } from "./crypto.js";
import { currentTrace } from "./trace.js";
import { windowsJobAlive } from "./windows-job.js";

export type RunStatus =
  | "queued"
  | "running"
  | "needs_input"
  | "interrupted"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";
export interface RunRecord {
  id: string;
  workflow: string;
  input: string;
  input_hash: string;
  request_key: string | null;
  protocol: string;
  status: RunStatus;
  owner: string | null;
  updated: number;
  created: number;
  result: string | null;
  error: string | null;
}
interface Lease {
  resource: string;
  owner: string;
  pid: number;
  updated: number;
  token: string;
}
interface ManagedProcess {
  id: string;
  owner: string;
  run_id: string | null;
  pid: number | null;
  windows_job: string | null;
  resources: string;
  status: "starting" | "running" | "unconfirmed" | "exited";
}
export class StateStore {
  readonly db: Database.Database;
  readonly owner = `${process.pid}:${crypto.randomUUID()}`;
  readonly root: string;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly held = new AsyncLocalStorage<ReadonlySet<string>>();
  private readonly cipher: PayloadCipher;
  private lastPrune = Date.now();
  constructor(root = stateDirectory()) {
    this.root = root;
    privateDirectory(root);
    privateDirectory(path.join(root, "artifacts"));
    this.cipher = new PayloadCipher(path.join(root, "workflow.key"));
    this.db = new Database(path.join(root, "state.sqlite"));
    try {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = FULL");
      this.db.pragma("busy_timeout = 2000");
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS runtime_meta (version TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow TEXT NOT NULL, input TEXT NOT NULL, input_hash TEXT NOT NULL, request_key TEXT UNIQUE, protocol TEXT NOT NULL, status TEXT NOT NULL, owner TEXT, updated INTEGER NOT NULL, created INTEGER NOT NULL, result TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS leases (resource TEXT PRIMARY KEY, owner TEXT NOT NULL, pid INTEGER NOT NULL, updated INTEGER NOT NULL, token TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (run_id TEXT NOT NULL, node TEXT NOT NULL, input_hash TEXT NOT NULL, status TEXT NOT NULL, result TEXT, PRIMARY KEY(run_id,node));
      CREATE TABLE IF NOT EXISTS ui_recordings (run_id TEXT PRIMARY KEY, target TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, operation_owner TEXT, updated INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS ui_recording_target ON ui_recordings(target) WHERE state IN ('preparing','active','sealed','cancelling');
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, file TEXT NOT NULL, bytes INTEGER NOT NULL, mime TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS artifact_gc (file TEXT PRIMARY KEY, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS artifact_streams (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, file TEXT NOT NULL, bytes INTEGER NOT NULL, owner TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS native_directories (id TEXT PRIMARY KEY, owner TEXT NOT NULL, file TEXT NOT NULL, bytes INTEGER NOT NULL, created INTEGER NOT NULL, closing INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS managed_processes (id TEXT PRIMARY KEY, owner TEXT NOT NULL, run_id TEXT, pid INTEGER, resources TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, windows_job TEXT);
      CREATE TABLE IF NOT EXISTS external_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, run_id TEXT, kind TEXT NOT NULL, resources TEXT NOT NULL, metadata TEXT NOT NULL, status TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, kind TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL);`);
      const versions = this.db
        .prepare("SELECT version FROM runtime_meta")
        .all() as { version: string }[];
      invariant(
        versions.length === 0 || versions[0]?.version === protocolVersion,
        "STATE_VERSION_MISMATCH",
        "Export historical reports and select a fresh state directory for this execution protocol",
      );
      this.db
        .prepare("INSERT OR IGNORE INTO runtime_meta VALUES (?)")
        .run(protocolVersion);
      this.reconcile();
      this.prune();
      this.heartbeat = setInterval(() => {
        try {
          this.db
            .prepare("UPDATE leases SET updated=? WHERE owner=?")
            .run(Date.now(), this.owner);
          if (Date.now() - this.lastPrune >= 60000) this.prune();
          this.db
            .prepare(
              "UPDATE runs SET updated=? WHERE owner=? AND status IN ('running','cancelling')",
            )
            .run(Date.now(), this.owner);
        } catch {
          /* A busy writer is retried on the next tick; leases are never stolen by age alone. */
        }
      }, 5000);
      this.heartbeat.unref();
    } catch (error) {
      // Construction can fail during WAL recovery, schema validation or quota
      // checks. No caller has a StateStore to close in that case.
      this.db.close();
      this.cipher.close();
      throw error;
    }
  }
  private alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  }
  private processAlive(pid: number, windowsJob?: string | null): boolean {
    if (windowsJob) {
      try {
        return windowsJobAlive(windowsJob);
      } catch {
        return true;
      } // A failed OS query never authorizes resource reuse.
    }
    return (
      this.alive(pid) || (process.platform !== "win32" && this.alive(-pid))
    );
  }
  trackProcess(id: string = crypto.randomUUID()) {
    const now = Date.now();
    this.db
      .transaction(() => {
        this.capacity(4096);
        invariant(
          (
            this.db
              .prepare(
                "SELECT COUNT(*) AS count FROM managed_processes WHERE status<>'exited'",
              )
              .get() as { count: number }
          ).count < 64,
          "PROCESS_CAPACITY",
          "At most 64 owned or unresolved native processes",
        );
        this.db
          .prepare("INSERT INTO managed_processes VALUES (?,?,?,?,?,?,?,?,?)")
          .run(
            id,
            this.owner,
            currentTrace().run_id ?? null,
            null,
            JSON.stringify([...(this.held.getStore() ?? [])]),
            "starting",
            now,
            now,
            null,
          );
      })
      .immediate();
    return {
      spawned: (pid: number | null, windowsJob?: string) => {
        this.db
          .prepare(
            "UPDATE managed_processes SET pid=?,windows_job=?,status=?,updated=? WHERE id=?",
          )
          .run(
            pid,
            windowsJob ?? null,
            pid === null ? "exited" : "running",
            Date.now(),
            id,
          );
      },
      closed: (confirmed = false) => {
        const row = this.db
          .prepare("SELECT pid,windows_job FROM managed_processes WHERE id=?")
          .get(id) as { pid: number | null; windows_job: string | null };
        this.db
          .prepare("UPDATE managed_processes SET status=?,updated=? WHERE id=?")
          .run(
            !confirmed &&
              row.pid !== null &&
              this.processAlive(row.pid, row.windows_job)
              ? "unconfirmed"
              : "exited",
            Date.now(),
            id,
          );
      },
      unconfirmed: () => {
        this.db
          .prepare(
            "UPDATE managed_processes SET status='unconfirmed',updated=? WHERE id=? AND status<>'exited'",
          )
          .run(Date.now(), id);
      },
    };
  }
  private processGuards() {
    return (
      this.db
        .prepare("SELECT * FROM managed_processes WHERE status<>'exited'")
        .all() as ManagedProcess[]
    ).filter(
      (row) =>
        row.status === "unconfirmed" ||
        !this.alive(Number(row.owner.split(":")[0])),
    );
  }
  /** Record SDK work before dispatch; only verified completion/termination may close it. */
  trackExternalSession(kind: string, resources: string[], metadata: unknown) {
    const id = crypto.randomUUID();
    this.db
      .transaction(() => {
        this.capacity(4096);
        const count = this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM external_sessions WHERE status<>'closed'",
          )
          .get() as { count: number };
        invariant(
          count.count < 32,
          "SESSION_CAPACITY",
          "At most 32 active or unresolved SDK sessions",
        );
        this.db
          .prepare("INSERT INTO external_sessions VALUES (?,?,?,?,?,?,?,?)")
          .run(
            id,
            this.owner,
            currentTrace().run_id ?? null,
            kind,
            JSON.stringify(resources),
            JSON.stringify(metadata ?? null),
            "active",
            Date.now(),
          );
      })
      .immediate();
    const update = (status: string) =>
      this.db
        .prepare(
          "UPDATE external_sessions SET status=?,updated=? WHERE id=? AND owner=?",
        )
        .run(status, Date.now(), id, this.owner);
    return {
      id,
      confirmClosed: () => {
        update("closed");
      },
      unconfirmed: () => {
        update("unconfirmed");
      },
    };
  }
  externalGuards() {
    const rows = this.db
      .prepare("SELECT * FROM external_sessions WHERE status<>'closed'")
      .all() as {
      id: string;
      owner: string;
      run_id: string | null;
      kind: string;
      resources: string;
      metadata: string;
      status: string;
    }[];
    return rows.filter(
      (row) =>
        row.status === "unconfirmed" ||
        !this.alive(Number(row.owner.split(":")[0])),
    );
  }
  recoverExternalSession(
    id: string,
    verifyStopped: (kind: string, metadata: unknown) => void,
  ) {
    this.db
      .transaction(() => {
        const row = this.externalGuards().find((item) => item.id === id);
        invariant(
          row,
          "SESSION_NOT_RECOVERABLE",
          "Session is active or has already been recovered",
        );
        verifyStopped(row.kind, JSON.parse(row.metadata) as unknown);
        this.db
          .prepare(
            "UPDATE external_sessions SET status='closed',updated=? WHERE id=?",
          )
          .run(Date.now(), id);
      })
      .immediate();
  }
  uncertainOperations(runId: string) {
    return this.db
      .prepare(
        "SELECT node FROM operations WHERE run_id=? AND status='started'",
      )
      .all(runId) as { node: string }[];
  }
  assertStopped(runId: string): void {
    this.reconcile();
    const recording = this.db
      .prepare("SELECT operation_owner FROM ui_recordings WHERE run_id=?")
      .get(runId) as { operation_owner: string | null } | undefined;
    invariant(
      !recording?.operation_owner ||
        !this.alive(Number(recording.operation_owner.split(":")[0])),
      "CANCEL_UNCONFIRMED",
      "A recorded UI action has not finished stopping",
    );
    const processes = this.db
      .prepare(
        "SELECT id,pid,status FROM managed_processes WHERE run_id=? AND status<>'exited'",
      )
      .all(runId);
    invariant(
      processes.length === 0,
      "CANCEL_UNCONFIRMED",
      "An operation belonging to this run has not confirmed exit",
    );
    invariant(
      !this.db
        .prepare(
          "SELECT id FROM external_sessions WHERE run_id=? AND status<>'closed'",
        )
        .get(runId),
      "CANCEL_UNCONFIRMED",
      "An SDK daemon operation has not confirmed completion or termination",
    );
    invariant(
      this.uncertainOperations(runId).length === 0,
      "EFFECT_UNCERTAIN",
      "An interrupted external effect still needs reconciliation before cancellation",
    );
  }
  reconcile(): void {
    for (const child of this.processGuards())
      if (
        child.pid !== null &&
        !this.processAlive(child.pid, child.windows_job)
      )
        this.db
          .prepare(
            "UPDATE managed_processes SET status='exited',updated=? WHERE id=?",
          )
          .run(Date.now(), child.id);
    for (const stream of this.db
      .prepare("SELECT * FROM artifact_streams")
      .all() as {
      id: string;
      run_id: string;
      file: string;
      owner: string;
      created: number;
    }[]) {
      if (this.alive(Number(stream.owner.split(":")[0]))) continue;
      // Publish the bytes actually written before a crash, never reserved-but-unwritten bytes.
      this.db.transaction(() => {
        if (fs.existsSync(stream.file))
          this.db
            .prepare("INSERT OR IGNORE INTO artifacts VALUES (?,?,?,?,?,?)")
            .run(
              stream.id,
              stream.run_id,
              stream.file,
              fs.statSync(stream.file).size,
              "text/plain; incomplete=true",
              stream.created,
            );
        this.db
          .prepare("DELETE FROM artifact_streams WHERE id=?")
          .run(stream.id);
      })();
    }
    for (const run of this.db
      .prepare(
        "SELECT * FROM runs WHERE status IN ('running','cancelling','queued')",
      )
      .all() as RunRecord[]) {
      if (!run.owner || !this.alive(Number(run.owner.split(":")[0])))
        this.db
          .prepare(
            "UPDATE runs SET status='interrupted',owner=NULL WHERE id=? AND updated=?",
          )
          .run(run.id, run.updated);
    }
    for (const lease of this.db
      .prepare("SELECT * FROM leases")
      .all() as Lease[]) {
      if (!this.alive(lease.pid))
        this.db
          .prepare("DELETE FROM leases WHERE resource=? AND token=?")
          .run(lease.resource, lease.token);
    }
  }
  create(
    workflow: string,
    input: unknown,
    requestKey?: string,
    identity: unknown = input,
    inputArtifacts: readonly string[] = [],
  ): { run: RunRecord; created: boolean } {
    return this.db.transaction(() => {
      if (requestKey) {
        const previous = this.db
          .prepare("SELECT * FROM runs WHERE request_key=?")
          .get(requestKey) as RunRecord | undefined;
        if (previous) {
          invariant(
            previous.workflow === workflow &&
              previous.input_hash === digest(identity),
            "REQUEST_KEY_CONFLICT",
            "Request key already has different input",
          );
          return { run: previous, created: false };
        }
      }
      this.capacity();
      const id = crypto.randomUUID(),
        now = Date.now();
      this.db
        .prepare("INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          workflow,
          this.cipher.seal(id, JSON.stringify(input)),
          digest(identity),
          requestKey ?? null,
          protocolVersion,
          "queued",
          this.owner,
          now,
          now,
          null,
          null,
        );
      for (const artifact of inputArtifacts) {
        const attached = this.db
          .prepare(
            "UPDATE artifacts SET run_id=? WHERE id=? AND run_id='workflow-input'",
          )
          .run(id, artifact);
        invariant(
          attached.changes === 1,
          "WORKFLOW_EVIDENCE_MISSING",
          "Captured input artifact is missing or already owned",
        );
      }
      return { run: this.get(id), created: true };
    })();
  }
  get(id: string): RunRecord {
    const run = this.db.prepare("SELECT * FROM runs WHERE id=?").get(id) as
      RunRecord | undefined;
    invariant(run, "RUN_NOT_FOUND", "Unknown run_id");
    return { ...run, input: this.cipher.open(id, run.input) };
  }
  byRequest(key: string): RunRecord | undefined {
    return this.db
      .prepare("SELECT * FROM runs WHERE request_key=?")
      .get(key) as RunRecord | undefined;
  }
  list(offset = 0, limit = 100): RunRecord[] {
    invariant(
      Number.isSafeInteger(offset) &&
        offset >= 0 &&
        Number.isSafeInteger(limit) &&
        limit > 0 &&
        limit <= 100,
      "PAGINATION_INVALID",
      "Use a nonnegative offset and 1-100 runs per page",
    );
    return this.db
      .prepare(
        "SELECT * FROM runs ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
      )
      .all(limit, offset) as RunRecord[];
  }
  runCount(): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS count FROM runs").get() as {
        count: number;
      }
    ).count;
  }
  claim(id: string): void {
    const result = this.db
      .prepare(
        "UPDATE runs SET owner=?,status=CASE WHEN status='cancelling' THEN 'cancelling' ELSE 'queued' END,updated=? WHERE id=? AND status IN ('queued','interrupted','needs_input','failed','cancelling') AND (owner IS NULL OR owner=?)",
      )
      .run(this.owner, Date.now(), id, this.owner);
    invariant(
      result.changes === 1,
      "RUN_BUSY",
      "Run cannot be claimed in its current state",
    );
  }
  activate(id: string) {
    const result = this.db
      .prepare(
        "UPDATE runs SET status='running',updated=? WHERE id=? AND owner=? AND status='queued'",
      )
      .run(Date.now(), id, this.owner);
    invariant(
      result.changes === 1,
      "CANCELLED",
      "Run was cancelled while waiting for resources",
    );
  }
  update(
    id: string,
    status: RunStatus,
    result?: unknown,
    error?: unknown,
  ): void {
    const changed = this.db
      .prepare(
        "UPDATE runs SET status=?,updated=?,result=?,error=?,owner=? WHERE id=? AND owner=?",
      )
      .run(
        status,
        Date.now(),
        result === undefined ? null : JSON.stringify(result),
        error === undefined ? null : JSON.stringify(error),
        ["running", "queued", "cancelling"].includes(status)
          ? this.owner
          : null,
        id,
        this.owner,
      );
    invariant(
      changed.changes === 1,
      "RUN_OWNERSHIP_LOST",
      "Run state cannot be updated by this runtime",
    );
    if (["succeeded", "failed", "cancelled"].includes(status)) this.prune();
  }
  cancel(id: string): void {
    this.db
      .prepare(
        "UPDATE runs SET status='cancelling',updated=? WHERE id=? AND status IN ('queued','running')",
      )
      .run(Date.now(), id);
  }
  async lease<T>(
    resource: string,
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const inherited = this.held.getStore();
    if (inherited?.has(resource)) {
      signal?.throwIfAborted();
      return task();
    }
    const token = crypto.randomUUID(),
      started = performance.now();
    let acquired = false;
    while (!acquired) {
      signal?.throwIfAborted();
      this.reconcile();
      const guards = this.processGuards().filter((row) =>
        (JSON.parse(row.resources) as string[]).includes(resource),
      );
      const external = this.externalGuards().filter((row) =>
        (JSON.parse(row.resources) as string[]).includes(resource),
      );
      if (guards.length || external.length)
        throw new ToolError(
          "RESOURCE_RECOVERY_REQUIRED",
          "A previous operation may still be using this resource",
          {
            resource,
            processes: guards.map(({ id, run_id, pid, status }) => ({
              id,
              run_id,
              pid,
              status,
            })),
            sdk_sessions: external.map(
              ({ id, run_id, kind, metadata, status }) => ({
                id,
                run_id,
                kind,
                metadata: JSON.parse(metadata) as unknown,
                status,
              }),
            ),
          },
        );
      acquired =
        this.db
          .prepare("INSERT OR IGNORE INTO leases VALUES (?,?,?,?,?)")
          .run(resource, this.owner, process.pid, Date.now(), token).changes ===
        1;
      if (!acquired) await delay(50, undefined, { signal });
    }
    try {
      signal?.throwIfAborted();
      this.event(currentTrace().run_id ?? null, "lease_acquired", {
        ...currentTrace(),
        resource,
        queue_ms: performance.now() - started,
      });
      return await this.held.run(
        new Set([...(inherited ?? []), resource]),
        task,
      );
    } finally {
      this.db
        .prepare("DELETE FROM leases WHERE resource=? AND owner=? AND token=?")
        .run(resource, this.owner, token);
    }
  }
  async effect<T>(
    runId: string,
    node: string,
    input: unknown,
    task: () => Promise<T>,
    reconcile?: () => Promise<T | undefined>,
  ): Promise<T> {
    const hash = digest(input);
    const prior = this.db
      .prepare("SELECT * FROM operations WHERE run_id=? AND node=?")
      .get(runId, node) as
      { input_hash: string; status: string; result: string | null } | undefined;
    if (prior) {
      invariant(
        prior.input_hash === hash,
        "INPUT_CHANGED",
        "Operation inputs have changed; start a new run",
      );
      if (prior.status === "done" && prior.result !== null)
        return JSON.parse(prior.result) as T;
      const recovered = await reconcile?.();
      if (recovered !== undefined) {
        this.receipt(runId, node, recovered);
        return recovered;
      }
      throw new ToolError(
        "EFFECT_UNCERTAIN",
        `Verify external state before starting a new run: ${node}`,
      );
    }
    this.db
      .prepare("INSERT INTO operations VALUES (?,?,?,?,NULL)")
      .run(runId, node, hash, "started");
    try {
      const value = await task();
      this.receipt(runId, node, value);
      return value;
    } catch (error) {
      // Dispatch may have reached the external system even when its response,
      // parsing or local receipt write failed. Pause on the first uncertainty;
      // a failed status would incorrectly suggest the mutation never happened.
      throw new ToolError(
        "EFFECT_UNCERTAIN",
        `External operation has no durable completion receipt: ${node}`,
        { operation: node, cause: errorResult(error) },
      );
    }
  }
  private receipt(runId: string, node: string, value: unknown): void {
    this.db
      .prepare(
        "UPDATE operations SET status='done',result=? WHERE run_id=? AND node=?",
      )
      .run(JSON.stringify(value ?? null), runId, node);
  }
  artifact(
    runId: string,
    data: string | Buffer,
    mime = "text/plain",
  ): { artifact_id: string; bytes: number; mime: string } {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data),
      stream = this.streamArtifact(runId, mime);
    try {
      stream.reserve(buffer.length);
      atomicWrite(stream.file, buffer);
      return stream.finish();
    } catch (error) {
      stream.discard();
      throw error;
    }
  }
  streamArtifact(
    runId: string,
    mime = "text/plain",
    extension: "" | ".hap" | ".hsp" = "",
  ) {
    invariant(
      ["", ".hap", ".hsp"].includes(extension),
      "ARTIFACT_EXTENSION_INVALID",
      "Invalid owned artifact extension",
    );
    const id = crypto.randomUUID(),
      file = path.join(this.root, "artifacts", id + extension);
    this.db.transaction(() => {
      this.capacity(4096);
      this.db
        .prepare("INSERT INTO artifact_streams VALUES (?,?,?,?,?,?)")
        .run(id, runId, file, 0, this.owner, Date.now());
    })();
    let finished = false,
      requested = 0,
      reserved = 0;
    return {
      file,
      discard: () => {
        if (finished) return;
        fs.rmSync(file, { force: true });
        this.db.prepare("DELETE FROM artifact_streams WHERE id=?").run(id);
        finished = true;
      },
      reserve: (bytes: number) => {
        invariant(
          !finished,
          "ARTIFACT_CLOSED",
          "Artifact stream is already closed",
        );
        invariant(
          Number.isSafeInteger(bytes) && bytes >= 0,
          "ARTIFACT_SIZE_INVALID",
          "Reservation must be a non-negative byte count",
        );
        const next = requested + bytes;
        if (next > reserved) {
          this.db
            .transaction(() => {
              let allocation = Math.ceil(next / 65536) * 65536;
              try {
                this.capacity(allocation - reserved);
              } catch (error) {
                if (!(
                  error instanceof ToolError && error.code === "STATE_CAPACITY"
                ))
                  throw error;
                allocation = next;
                this.capacity(allocation - reserved);
              }
              this.db
                .prepare("UPDATE artifact_streams SET bytes=? WHERE id=?")
                .run(allocation, id);
              reserved = allocation;
            })
            .immediate();
        }
        requested = next;
      },
      finish: () =>
        this.db.transaction(() => {
          invariant(
            !finished,
            "ARTIFACT_CLOSED",
            "Artifact stream is already closed",
          );
          const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
          invariant(
            bytes <= reserved,
            "ARTIFACT_SIZE_INVALID",
            "Written bytes exceed the reserved storage budget",
          );
          this.db.prepare("DELETE FROM artifact_streams WHERE id=?").run(id);
          if (!fs.existsSync(file))
            fs.writeFileSync(file, "", { flag: "wx", mode: 0o600 });
          this.db
            .prepare("INSERT INTO artifacts VALUES (?,?,?,?,?,?)")
            .run(id, runId, file, bytes, mime, Date.now());
          finished = true;
          return { artifact_id: id, bytes, mime };
        })(),
    };
  }
  readArtifact(id: string, offset = 0, limit = 65536) {
    invariant(
      Number.isSafeInteger(offset) &&
        offset >= 0 &&
        Number.isSafeInteger(limit) &&
        limit > 0 &&
        limit <= 65536,
      "INVALID_RANGE",
      "Invalid artifact range",
    );
    // Hold the same write reservation used by pruning until the bounded read ends.
    // Otherwise another process can commit retention and unlink between lookup/open.
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare("SELECT * FROM artifacts WHERE id=?")
          .get(id) as { file: string; bytes: number; mime: string } | undefined;
        invariant(row, "ARTIFACT_NOT_FOUND", "Unknown artifact");
        const data = Buffer.allocUnsafe(
          Math.min(limit, Math.max(0, row.bytes - offset)),
        );
        const fd = fs.openSync(row.file, "r");
        try {
          invariant(
            fs.fstatSync(fd).size === row.bytes,
            "ARTIFACT_CHANGED",
            "Artifact size no longer matches its persisted receipt",
          );
          let read = 0;
          while (read < data.length) {
            const bytes = fs.readSync(
              fd,
              data,
              read,
              data.length - read,
              offset + read,
            );
            invariant(
              bytes > 0,
              "ARTIFACT_CHANGED",
              "Artifact was truncated during reading",
            );
            read += bytes;
          }
        } finally {
          fs.closeSync(fd);
        }
        return {
          artifact_id: id,
          mime: row.mime,
          bytes: row.bytes,
          offset,
          next_offset: offset + data.length,
          encoding: "base64",
          data: data.toString("base64"),
        };
      })
      .immediate();
  }
  event(runId: string | null, kind: string, data: unknown): void {
    const value = JSON.stringify(data);
    if (value.length > 16384)
      throw new ToolError("EVENT_TOO_LARGE", "Use an artifact for large data");
    this.capacity(Buffer.byteLength(value));
    this.db
      .prepare("INSERT INTO events(run_id,kind,data,created) VALUES (?,?,?,?)")
      .run(runId, kind, value, Date.now());
  }
  capacity(additional = 0): void {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(bytes),0) AS bytes FROM (SELECT bytes FROM artifacts UNION ALL SELECT bytes FROM artifact_streams UNION ALL SELECT bytes FROM artifact_gc UNION ALL SELECT bytes FROM native_directories)",
      )
      .get() as { bytes: number };
    const pageSize = this.db.pragma("page_size", { simple: true }) as number,
      pageCount = this.db.pragma("page_count", { simple: true }) as number,
      free = this.db.pragma("freelist_count", { simple: true }) as number;
    const walFile = path.join(this.root, "state.sqlite-wal"),
      wal = fs.existsSync(walFile) ? fs.statSync(walFile).size : 0;
    invariant(
      row.bytes + (pageCount - free) * pageSize + wal + additional <=
        configuration().max_bytes,
      "STATE_CAPACITY",
      "State retention capacity reached; export or remove completed runs",
    );
  }
  prune(): void {
    this.db.transaction(() => this.pruneOwned()).immediate();
    this.collectArtifacts();
    for (const row of this.db
      .prepare("SELECT id,owner,closing FROM native_directories")
      .all() as { id: string; owner: string; closing: number }[])
      if (row.closing || !this.alive(Number(row.owner.split(":")[0])))
        this.releaseNativeDirectory(row.id);
    this.lastPrune = Date.now();
  }
  /** Private resource identities are inherited by every managed process spawned inside task. */
  withNativeDirectory<T>(id: string, task: () => T): T {
    return this.held.run(
      new Set([...(this.held.getStore() ?? []), `native-directory:${id}`]),
      task,
    );
  }
  reserveNativeDirectory(bytes: number) {
    invariant(
      Number.isSafeInteger(bytes) && bytes > 0,
      "NATIVE_DIRECTORY_SIZE_INVALID",
      "Reserve a positive byte budget",
    );
    const id = crypto.randomUUID(),
      file = path.join(this.root, "tmp", id);
    this.db
      .transaction(() => {
        this.capacity(bytes + 4096);
        this.db
          .prepare("INSERT INTO native_directories VALUES (?,?,?,?,?,0)")
          .run(id, this.owner, file, bytes, Date.now());
      })
      .immediate();
    try {
      privateDirectory(file);
    } catch (error) {
      this.db.prepare("DELETE FROM native_directories WHERE id=?").run(id);
      throw error;
    }
    return { id, file, bytes };
  }
  chargeNativeDirectory(id: string, bytes: number): void {
    // An external writer may exceed its reservation between observations.
    // Charge the observed bytes even when already over quota, blocking new work.
    this.db
      .prepare("UPDATE native_directories SET bytes=MAX(bytes,?) WHERE id=?")
      .run(bytes, id);
  }
  releaseNativeDirectory(id: string): boolean {
    const row = this.db
      .prepare("SELECT file FROM native_directories WHERE id=?")
      .get(id) as { file: string } | undefined;
    if (!row) return true;
    this.db
      .prepare("UPDATE native_directories SET closing=1 WHERE id=?")
      .run(id);
    const resource = `native-directory:${id}`;
    // A failed cancellation must retain the inputs and budget of surviving writers.
    const writers = this.db
      .prepare(
        "SELECT pid,windows_job,resources FROM managed_processes WHERE status<>'exited'",
      )
      .all() as {
      pid: number | null;
      windows_job: string | null;
      resources: string;
    }[];
    if (
      writers.some(
        (writer) =>
          (JSON.parse(writer.resources) as string[]).includes(resource) &&
          (!writer.pid || this.processAlive(writer.pid, writer.windows_job)),
      )
    )
      return false;
    invariant(
      row.file === path.join(this.root, "tmp", id),
      "NATIVE_DIRECTORY_PATH_INVALID",
      "Owned directory path changed",
    );
    try {
      fs.rmSync(row.file, { recursive: true, force: true });
    } catch {
      return false;
    }
    this.db.prepare("DELETE FROM native_directories WHERE id=?").run(id);
    return true;
  }
  discardArtifacts(runId: string, ids: readonly string[]): void {
    this.db
      .transaction(() => {
        for (const id of ids) {
          this.db
            .prepare(
              "INSERT OR IGNORE INTO artifact_gc SELECT file,bytes FROM artifacts WHERE id=? AND run_id=?",
            )
            .run(id, runId);
          this.db
            .prepare("DELETE FROM artifacts WHERE id=? AND run_id=?")
            .run(id, runId);
        }
      })
      .immediate();
    this.collectArtifacts();
  }
  private collectArtifacts(): void {
    // Commit removal of all references before unlinking bytes. A crash or failed
    // transaction must never leave a retained run pointing at deleted evidence.
    // Tombstones also keep pending deletions charged against the storage budget.
    for (const row of this.db.prepare("SELECT file FROM artifact_gc").all() as {
      file: string;
    }[]) {
      try {
        fs.rmSync(row.file, { force: true });
      } catch {
        continue; // Locked files are retried on the next retention pass.
      }
      this.db.prepare("DELETE FROM artifact_gc WHERE file=?").run(row.file);
    }
  }
  private pruneOwned(): void {
    const config = configuration(),
      cutoff = Date.now() - config.retention_days * 86400000;
    const terminal = this.db
      .prepare(
        `SELECT * FROM runs WHERE status IN ('succeeded','failed','cancelled') AND owner IS NULL
         AND NOT EXISTS (SELECT 1 FROM operations WHERE operations.run_id=runs.id AND status='started')
         AND NOT EXISTS (SELECT 1 FROM managed_processes WHERE managed_processes.run_id=runs.id AND status<>'exited')
         AND NOT EXISTS (SELECT 1 FROM external_sessions WHERE external_sessions.run_id=runs.id AND status<>'closed')
         AND NOT EXISTS (SELECT 1 FROM artifact_streams WHERE artifact_streams.run_id=runs.id)
         AND NOT EXISTS (SELECT 1 FROM ui_recordings WHERE ui_recordings.run_id=runs.id AND state NOT IN ('finished','cancelled'))
         ORDER BY updated DESC,created DESC,id DESC`,
      )
      .all() as RunRecord[];
    for (const [index, run] of terminal.entries()) {
      if (index < config.max_runs && run.updated >= cutoff) continue;
      this.db
        .prepare(
          "INSERT OR IGNORE INTO artifact_gc SELECT file,bytes FROM artifacts WHERE run_id=?",
        )
        .run(run.id);
      this.db.transaction(() => {
        for (const table of [
          "artifacts",
          "events",
          "operations",
          "ui_recordings",
        ])
          this.db.prepare(`DELETE FROM ${table} WHERE run_id=?`).run(run.id);
        for (const table of ["checkpoints", "writes"])
          if (
            this.db
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
              )
              .get(table)
          )
            this.db
              .prepare(`DELETE FROM ${table} WHERE thread_id=?`)
              .run(run.id);
        this.db.prepare("DELETE FROM runs WHERE id=?").run(run.id);
      })();
    }
    this.db
      .prepare("DELETE FROM events WHERE run_id IS NULL AND created<?")
      .run(cutoff);
    this.db
      .prepare(
        "DELETE FROM managed_processes WHERE status='exited' AND (updated<? OR id NOT IN (SELECT id FROM managed_processes WHERE status='exited' ORDER BY updated DESC,id DESC LIMIT 1000)) AND (run_id IS NULL OR run_id NOT IN (SELECT id FROM runs))",
      )
      .run(cutoff);
    this.db
      .prepare(
        "DELETE FROM external_sessions WHERE status='closed' AND (updated<? OR id NOT IN (SELECT id FROM external_sessions WHERE status='closed' ORDER BY updated DESC,id DESC LIMIT 1000)) AND (run_id IS NULL OR run_id NOT IN (SELECT id FROM runs))",
      )
      .run(cutoff);
    this.db
      .prepare(
        "DELETE FROM events WHERE run_id IS NULL AND id NOT IN (SELECT id FROM events WHERE run_id IS NULL ORDER BY id DESC LIMIT 10000)",
      )
      .run();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO artifact_gc SELECT file,bytes FROM artifacts WHERE run_id NOT IN (SELECT id FROM runs) AND created<?",
      )
      .run(cutoff);
    this.db
      .prepare(
        "DELETE FROM artifacts WHERE run_id NOT IN (SELECT id FROM runs) AND created<?",
      )
      .run(cutoff);
  }
  close(): void {
    clearInterval(this.heartbeat);
    this.db
      .prepare(
        "UPDATE external_sessions SET status='unconfirmed',updated=? WHERE owner=? AND status<>'closed'",
      )
      .run(Date.now(), this.owner);
    this.db
      .prepare(
        "UPDATE managed_processes SET status='unconfirmed',updated=? WHERE owner=? AND status<>'exited'",
      )
      .run(Date.now(), this.owner);
    this.db.prepare("DELETE FROM leases WHERE owner=?").run(this.owner);
    this.db.close();
    this.cipher.close();
  }
}
