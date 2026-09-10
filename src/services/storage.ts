import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { setImmediate as yieldIO } from "node:timers/promises";
import { StateStore } from "../core/store.js";
import { digest, destinationPath, atomicWrite } from "../core/files.js";
import { invariant, errorResult, ToolError } from "../core/errors.js";
import { release, protocolVersion } from "../core/config.js";
import { currentTrace } from "../core/trace.js";

interface Artifact {
  id: string;
  run_id: string;
  file: string;
  bytes: number;
  mime: string;
  created: number;
}
interface Summary {
  id: string;
  workflow: string;
  status: string;
  created: number;
  updated: number;
  result: string | null;
  error: string | null;
}
interface RunEvent {
  id: number;
  run_id: string;
  kind: string;
  data: string;
  created: number;
}
const cleanupReceipt = z.object({
  receipt_id: z.string(),
  action: z.literal("cleanup"),
  run_ids: z.array(z.string()),
  artifact_bytes: z.number(),
  created: z.number(),
  release: z.string(),
  protocol: z.string(),
  request_id: z.string().optional(),
  references_removed: z.literal(true),
});
const eligible = `status IN ('succeeded','cancelled') AND owner IS NULL
  AND NOT EXISTS (SELECT 1 FROM operations WHERE operations.run_id=runs.id AND status='started')
  AND NOT EXISTS (SELECT 1 FROM managed_processes WHERE managed_processes.run_id=runs.id AND status<>'exited')
  AND NOT EXISTS (SELECT 1 FROM external_sessions WHERE external_sessions.run_id=runs.id AND status<>'closed')
  AND NOT EXISTS (SELECT 1 FROM artifact_streams WHERE artifact_streams.run_id=runs.id)
  AND NOT EXISTS (SELECT 1 FROM run_pins WHERE run_pins.run_id=runs.id)
  AND NOT EXISTS (SELECT 1 FROM run_dependencies WHERE run_dependencies.run_id=runs.id)
  AND NOT EXISTS (SELECT 1 FROM ui_recordings WHERE ui_recordings.run_id=runs.id AND state NOT IN ('finished','cancelled'))
  AND NOT EXISTS (SELECT 1 FROM ui_tests WHERE ui_tests.run_id=runs.id AND state='active')
  AND NOT EXISTS (SELECT 1 FROM ui_reviews WHERE ui_reviews.run_id=runs.id AND status='required')`;
const exportEligible = `status IN ('succeeded','cancelled','failed','interrupted','needs_input') AND owner IS NULL
  AND NOT EXISTS (SELECT 1 FROM artifact_streams WHERE artifact_streams.run_id=runs.id)
  AND NOT EXISTS (SELECT 1 FROM run_pins WHERE run_pins.run_id=runs.id)`;

/** Explicit storage lifecycle: select exact completed runs, review a digest-bound
 * plan, optionally export, then remove. Failed/recoverable work is protected. */
export class StorageService {
  constructor(readonly store: StateStore) {}

  capacity(additional = 0) {
    const candidates = this.store.db
      .prepare(
        `SELECT id,workflow,status,created,updated,
      (SELECT COALESCE(SUM(bytes),0) FROM artifacts WHERE run_id=runs.id) AS artifact_bytes
      FROM runs WHERE ${eligible} ORDER BY updated,id LIMIT 20`,
      )
      .all();
    const exports = (
      this.store.db
        .prepare(
          "SELECT id,data FROM storage_receipts WHERE kind='export' ORDER BY created DESC,id DESC LIMIT 10",
        )
        .all() as { id: string; data: string }[]
    ).map((row) => ({ receipt_id: row.id, ...JSON.parse(row.data) }));
    return {
      ...this.store.capacityStatus(additional),
      cleanup_candidates: candidates,
      recent_exports: exports,
      estimate_scope:
        "Current charged bytes plus additional_bytes; allow headroom for logs, SDK reservations and checkpoints.",
      protected:
        "Active, failed, interrupted, needs_input, unresolved and referenced runs cannot be cleaned. Export and remove a referring workflow before cleaning its native evidence.",
    };
  }

  private eventSummary(ids: readonly string[]) {
    const hash = crypto.createHash("sha256");
    let count = 0,
      bytes = 0;
    for (const id of [...ids].sort()) {
      for (const row of this.store.db
        .prepare(
          "SELECT id,run_id,kind,data,created FROM events WHERE run_id=? ORDER BY id",
        )
        .iterate(id)) {
        const line = JSON.stringify(row) + "\n";
        hash.update(line);
        count++;
        bytes += Buffer.byteLength(line);
      }
    }
    return { count, bytes, sha256: hash.digest("hex") };
  }

  private snapshot(ids: readonly string[], forExport = false) {
    invariant(
      ids.length > 0 && ids.length <= 100 && new Set(ids).size === ids.length,
      "CLEANUP_SELECTION_INVALID",
      "Select 1-100 distinct run_ids from capacity or workflow_run list",
    );
    const runs: Summary[] = [],
      artifacts: Artifact[] = [];
    for (const id of [...ids].sort()) {
      const run = this.store.db
        .prepare(
          `SELECT id,workflow,status,created,updated,result,error FROM runs WHERE id=? AND ${forExport ? exportEligible : eligible}`,
        )
        .get(id) as Summary | undefined;
      invariant(
        run,
        "RUN_PROTECTED",
        forExport
          ? `Run ${id} is missing, running, pinned or has an active artifact stream; wait for a quiescent snapshot`
          : `Run ${id} is missing, recoverable, active, pinned or has unresolved effects; no runs were removed`,
      );
      runs.push(run);
      const rows = this.store.db
        .prepare(
          "SELECT * FROM artifacts WHERE run_id=? ORDER BY id LIMIT 4097",
        )
        .all(id) as Artifact[];
      artifacts.push(...rows);
      invariant(
        artifacts.length <= 4096,
        "STORAGE_SELECTION_TOO_LARGE",
        "Select fewer runs; at most 4096 artifacts per operation",
      );
    }
    const dependencies = [...ids]
      .sort()
      .flatMap(
        (id) =>
          this.store.db
            .prepare(
              "SELECT parent_run_id,run_id FROM run_dependencies WHERE parent_run_id=? ORDER BY run_id",
            )
            .all(id) as { parent_run_id: string; run_id: string }[],
      );
    const released_packages = [...ids].sort().flatMap(id => this.store.db
      .prepare("SELECT artifact_id,run_id,sha256,bytes,released_at FROM released_packages WHERE run_id=? ORDER BY artifact_id").all(id));
    return { runs, artifacts, dependencies, released_packages, events: this.eventSummary(ids) };
  }

  private planWithin(ids: readonly string[]) {
    const snapshot = this.snapshot(ids);
    const plan_hash = digest({
      state: fs.realpathSync.native(this.store.root),
      protocol: protocolVersion,
      ...snapshot,
    });
    return {
      snapshot,
      plan_hash,
      run_ids: snapshot.runs.map((run) => run.id),
      runs: snapshot.runs.map(({ result: _result, error: _error, ...run }) => ({
        ...run,
        artifact_count: snapshot.artifacts.filter(
          (artifact) => artifact.run_id === run.id,
        ).length,
        artifact_bytes: snapshot.artifacts
          .filter((artifact) => artifact.run_id === run.id)
          .reduce((sum, artifact) => sum + artifact.bytes, 0),
      })),
      artifact_bytes: snapshot.artifacts.reduce(
        (sum, artifact) => sum + artifact.bytes,
        0,
      ),
      event_count: snapshot.events.count,
    };
  }

  plan(ids: readonly string[]) {
    return this.store.db
      .transaction(() => {
        const { snapshot: _snapshot, ...plan } = this.planWithin(ids);
        return {
          ...plan,
          effect:
            "Remove selected run records, checkpoints, events and owned artifacts. Export first to retain evidence. Source HAPs and project files are untouched.",
        };
      })
      .immediate();
  }

  apply(ids: readonly string[], expected: string) {
    const result = this.store.db
      .transaction(() => {
        const previous = this.store.db
          .prepare(
            "SELECT data FROM storage_receipts WHERE id=? AND kind='cleanup'",
          )
          .get(expected) as { data: string } | undefined;
        if (previous) {
          const receipt = cleanupReceipt.parse(JSON.parse(previous.data));
          invariant(
            digest([...ids].sort()) === digest(receipt.run_ids),
            "CLEANUP_SELECTION_CHANGED",
            "Receipt belongs to a different run selection",
          );
          return receipt;
        }
        const plan = this.planWithin(ids);
        invariant(
          plan.plan_hash === expected,
          "CLEANUP_PLAN_STALE",
          "Selected evidence changed; inspect a fresh cleanup_plan before applying",
        );
        for (const id of plan.run_ids) {
          this.store.db
            .prepare("DELETE FROM run_dependencies WHERE parent_run_id=?")
            .run(id);
          this.store.db
            .prepare(
              "INSERT OR IGNORE INTO artifact_gc SELECT file,bytes FROM artifacts WHERE run_id=?",
            )
            .run(id);
          for (const table of [
            "artifacts",
            "released_packages",
            "events",
            "operations",
            "ui_recordings",
            "ui_reviews",
            "ui_tests",
            "skill_workflows",
            "managed_processes",
            "external_sessions",
          ])
            this.store.db
              .prepare(`DELETE FROM ${table} WHERE run_id=?`)
              .run(id);
          for (const table of ["checkpoints", "writes"])
            if (
              this.store.db
                .prepare(
                  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                )
                .get(table)
            )
              this.store.db
                .prepare(`DELETE FROM ${table} WHERE thread_id=?`)
                .run(id);
          this.store.db.prepare("DELETE FROM runs WHERE id=?").run(id);
        }
        const receipt = {
          receipt_id: expected,
          action: "cleanup",
          run_ids: plan.run_ids,
          artifact_bytes: plan.artifact_bytes,
          created: Date.now(),
          release,
          protocol: protocolVersion,
          request_id: currentTrace().request_id,
          references_removed: true,
        };
        this.store.db
          .prepare("INSERT INTO storage_receipts VALUES (?,?,?,?)")
          .run(expected, "cleanup", JSON.stringify(receipt), receipt.created);
        // Bounded durable receipt history; never remove references before its transaction commits.
        this.store.db
          .prepare(
            "DELETE FROM storage_receipts WHERE kind='cleanup' AND id NOT IN (SELECT id FROM storage_receipts WHERE kind='cleanup' ORDER BY created DESC,id DESC LIMIT 1000)",
          )
          .run();
        return receipt;
      })
      .immediate();
    this.store.collectArtifacts();
    // SQLite may still have pinned readers; checkpoint is best effort, not a
    // reason to claim deletion failure after the receipt transaction committed.
    try {
      this.store.db.pragma("wal_checkpoint(PASSIVE)");
    } catch {
      /* Readers may hold WAL frames. */
    }
    return { ...result, capacity: this.capacity() };
  }

  receipt(id: string) {
    const row = this.store.db
      .prepare("SELECT kind,data,created FROM storage_receipts WHERE id=?")
      .get(id) as { kind: string; data: string; created: number } | undefined;
    invariant(row, "STORAGE_RECEIPT_NOT_FOUND", "Unknown receipt_id");
    return { ...row, data: JSON.parse(row.data), capacity: this.capacity() };
  }

  async export(
    ids: readonly string[],
    directory: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const target = destinationPath(directory),
      root = fs.realpathSync.native(this.store.root),
      relative = path.relative(root, target);
    invariant(
      relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative),
      "EXPORT_INSIDE_STATE",
      "Export to a new directory outside the state directory",
    );
    invariant(
      fs.existsSync(path.dirname(target)),
      "EXPORT_PARENT_MISSING",
      "Create the export parent directory first",
    );
    invariant(
      !fs.existsSync(target),
      "EXPORT_EXISTS",
      "Export destination must be new; existing files are never replaced",
    );
    const id = crypto.randomUUID();
    const snapshot = this.store.db
      .transaction(() => {
        // Export the complete native evidence closure under the same pins as
        // the referring workflow. A parent-only export must not lose receipts.
        invariant(
          ids.length > 0 &&
            ids.length <= 100 &&
            new Set(ids).size === ids.length,
          "CLEANUP_SELECTION_INVALID",
          "Select 1-100 distinct run_ids",
        );
        const closure = new Set(ids);
        for (const parent of closure) {
          for (const row of this.store.db
            .prepare(
              "SELECT run_id FROM run_dependencies WHERE parent_run_id=? ORDER BY run_id",
            )
            .all(parent) as { run_id: string }[])
            closure.add(row.run_id);
          invariant(
            closure.size <= 100,
            "STORAGE_SELECTION_TOO_LARGE",
            "Select fewer workflows; an export includes at most 100 runs and their native evidence",
          );
        }
        ids = [...closure].sort();
        const snapshot = this.snapshot(ids, true);
        this.store.db
          .prepare(
            "DELETE FROM storage_receipts WHERE kind='export' AND id NOT IN (SELECT id FROM run_pins) AND id NOT IN (SELECT id FROM storage_receipts WHERE kind='export' ORDER BY created DESC,id DESC LIMIT 999)",
          )
          .run();
        for (const run of snapshot.runs)
          this.store.db
            .prepare("INSERT INTO run_pins VALUES (?,?,?,?,?)")
            .run(id, run.id, this.store.owner, "export", Date.now());
        this.store.db
          .prepare("INSERT INTO storage_receipts VALUES (?,?,?,?)")
          .run(
            id,
            "export",
            JSON.stringify({
              receipt_id: id,
              run_ids: [...ids].sort(),
              destination: target,
              owner: this.store.owner,
              status: "copying",
              release,
            }),
            Date.now(),
          );
        return snapshot;
      })
      .immediate();
    let created = false;
    try {
      fs.mkdirSync(target, { mode: 0o700 });
      created = true;
      atomicWrite(
        path.join(target, "incomplete.json"),
        JSON.stringify({ receipt_id: id, complete: false }),
        false,
      );
      const exported: {
        id: string;
        run_id: string;
        file: string;
        bytes: number;
        mime: string;
        sha256: string;
        created: number;
      }[] = [];
      const omitted: { id: string; reason: string }[] = [];
      for (const artifact of snapshot.artifacts) {
        signal?.throwIfAborted();
        if (artifact.mime === "application/x-deveco-encrypted") {
          omitted.push({
            id: artifact.id,
            reason: "Private signing material is not exported",
          });
          continue;
        }
        invariant(
          path.dirname(artifact.file) ===
            path.join(this.store.root, "artifacts"),
          "ARTIFACT_PATH_INVALID",
          "Artifact is outside owned storage",
        );
        const name = path.basename(artifact.file);
        invariant(
          /^[a-f0-9-]{36}(?:\.(?:hap|hsp|hqf))?$/.test(name),
          "ARTIFACT_PATH_INVALID",
          "Artifact filename is not owned",
        );
        const source = await fs.promises.open(
          artifact.file,
          fs.constants.O_RDONLY |
            fs.constants.O_NONBLOCK |
            (fs.constants.O_NOFOLLOW ?? 0),
        );
        try {
          const before = await source.stat();
          invariant(
            before.isFile() && before.size === artifact.bytes,
            "ARTIFACT_CHANGED",
            "Retained artifact changed before export",
          );
          const output = await fs.promises.open(
            path.join(target, name),
            "wx",
            0o600,
          );
          try {
            const buffer = Buffer.allocUnsafe(1024 * 1024),
              hash = crypto.createHash("sha256");
            let offset = 0;
            while (offset < before.size) {
              signal?.throwIfAborted();
              const { bytesRead } = await source.read(
                buffer,
                0,
                Math.min(buffer.length, before.size - offset),
                offset,
              );
              invariant(
                bytesRead > 0,
                "ARTIFACT_CHANGED",
                "Retained artifact was truncated during export",
              );
              hash.update(buffer.subarray(0, bytesRead));
              let written = 0;
              while (written < bytesRead) {
                const result = await output.write(
                  buffer,
                  written,
                  bytesRead - written,
                  offset + written,
                );
                invariant(
                  result.bytesWritten > 0,
                  "EXPORT_WRITE_FAILED",
                  "Export made no write progress",
                );
                written += result.bytesWritten;
              }
              offset += bytesRead;
              await yieldIO();
            }
            const after = await source.stat();
            invariant(
              before.size === after.size &&
                before.mtimeMs === after.mtimeMs &&
                before.ctimeMs === after.ctimeMs,
              "ARTIFACT_CHANGED",
              "Retained artifact changed during export",
            );
            await output.sync();
            exported.push({
              id: artifact.id,
              run_id: artifact.run_id,
              file: name,
              bytes: offset,
              mime: artifact.mime,
              sha256: hash.digest("hex"),
              created: artifact.created,
            });
          } finally {
            await output.close();
          }
        } finally {
          await source.close();
        }
      }
      signal?.throwIfAborted();
      // Stream history separately: a long-lived run remains exportable and
      // cleanable without loading its entire event log into memory.
      const eventsFile = await fs.promises.open(
        path.join(target, "events.ndjson"),
        "wx",
        0o600,
      );
      const eventHash = crypto.createHash("sha256");
      let eventCount = 0,
        eventBytes = 0;
      try {
        for (const run of snapshot.runs) {
          let after = 0;
          for (;;) {
            signal?.throwIfAborted();
            const rows = this.store.db
              .prepare(
                "SELECT id,run_id,kind,data,created FROM events WHERE run_id=? AND id>? ORDER BY id LIMIT 100",
              )
              .all(run.id, after) as RunEvent[];
            if (!rows.length) break;
            for (const row of rows) {
              const line = JSON.stringify(row) + "\n";
              await eventsFile.writeFile(line);
              eventHash.update(line);
              eventCount++;
              eventBytes += Buffer.byteLength(line);
              after = row.id;
            }
            await yieldIO();
          }
        }
        await eventsFile.sync();
      } finally {
        await eventsFile.close();
      }
      const eventSummary = {
        count: eventCount,
        bytes: eventBytes,
        sha256: eventHash.digest("hex"),
      };
      invariant(
        digest(eventSummary) === digest(snapshot.events),
        "EXPORT_HISTORY_CHANGED",
        "Run history changed during export; select a new destination and retry",
      );
      const manifest = {
        format: 1,
        receipt_id: id,
        release,
        protocol: protocolVersion,
        created: Date.now(),
        runs: snapshot.runs,
        dependencies: snapshot.dependencies,
        events: { file: "events.ndjson", ...eventSummary },
        artifacts: exported,
        released_packages: snapshot.released_packages,
        omitted,
        complete: true,
        scope:
          "Evidence export; confirmed installations retain package digests and receipts, not temporary package binaries. Excludes workflow inputs, credentials and signing secrets. Not a resumable state backup.",
      };
      const manifestText = JSON.stringify(manifest, null, 2);
      atomicWrite(path.join(target, "manifest.json"), manifestText, false);
      fs.rmSync(path.join(target, "incomplete.json"));
      const receipt = {
        receipt_id: id,
        action: "export",
        status: "complete",
        destination: target,
        manifest_sha256: crypto
          .createHash("sha256")
          .update(manifestText)
          .digest("hex"),
        artifact_count: exported.length,
        omitted_count: omitted.length,
        run_ids: [...ids].sort(),
        created: Date.now(),
      };
      this.store.db
        .prepare("UPDATE storage_receipts SET data=? WHERE id=?")
        .run(JSON.stringify(receipt), id);
      this.store.db
        .prepare(
          "DELETE FROM storage_receipts WHERE kind='export' AND id NOT IN (SELECT id FROM run_pins) AND id NOT IN (SELECT id FROM storage_receipts WHERE kind='export' ORDER BY created DESC,id DESC LIMIT 1000)",
        )
        .run();
      return receipt;
    } catch (error) {
      // Retain a marked incomplete export for diagnosis. It is never presented
      // as a complete bundle and a later attempt must choose a new directory.
      this.store.db
        .prepare("UPDATE storage_receipts SET data=? WHERE id=?")
        .run(
          JSON.stringify({
            receipt_id: id,
            run_ids: [...ids].sort(),
            destination: target,
            status: "incomplete",
            directory_created: created,
          }),
          id,
        );
      throw new ToolError(
        signal?.aborted ? "CANCELLED" : "EXPORT_INCOMPLETE",
        "Export is incomplete; inspect storage_receipt before retrying to a new directory",
        {
          receipt_id: id,
          destination: target,
          cause_code: errorResult(error).code,
        },
      );
    } finally {
      this.store.db
        .prepare("DELETE FROM run_pins WHERE id=? AND owner=?")
        .run(id, this.store.owner);
    }
  }
}
