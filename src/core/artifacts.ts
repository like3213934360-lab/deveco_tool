import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { config, stateDir } from "./config.js";
import { database } from "./db.js";
import { invariant } from "./errors.js";

const extensions: Record<string, string> = {
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
  "image/png": "png",
  "image/jpeg": "jpg",
  "video/mp4": "mp4",
};

export function artifactDir() {
  const dir = path.join(stateDir(), "artifacts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Reserve a file path for streaming output (e.g. process logs). Register with commitArtifact. */
export function artifactPath(mime = "text/plain") {
  const id = `a_${crypto.randomBytes(8).toString("hex")}`;
  return { id, file: path.join(artifactDir(), `${id}.${extensions[mime] ?? "bin"}`) };
}

export async function commitArtifact(id: string, file: string, mime: string, jobId?: string) {
  const bytes = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  (await database())
    .prepare("INSERT OR REPLACE INTO artifacts(id,job_id,file,mime,bytes,created) VALUES(?,?,?,?,?,?)")
    .run(id, jobId ?? null, file, mime, bytes, Date.now());
  scheduleCleanup(1000);
  return { artifact_id: id, bytes, mime };
}

export async function saveArtifact(data: string | Buffer, mime = "text/plain", jobId?: string) {
  const { id, file } = artifactPath(mime);
  fs.writeFileSync(file, data);
  return commitArtifact(id, file, mime, jobId);
}

async function lookup(id: string) {
  const row = (await database()).prepare("SELECT file,mime,bytes FROM artifacts WHERE id=? AND created>?").get(id, Date.now() - DAY) as
    | { file: string; mime: string; bytes: number }
    | undefined;
  invariant(row && fs.existsSync(row.file), "NOT_FOUND", `Artifact ${id} does not exist or was cleaned up`);
  return row;
}

/**
 * Text artifacts page by line: simple for models, never splits UTF-8, and the
 * response always says whether more remains (`next_line` null at the end).
 * `grep` filters lines first, which is usually what the model actually wants.
 */
export async function readArtifact(id: string, options: { line?: number; limit?: number; grep?: string } = {}) {
  const row = await lookup(id);
  if (row.mime.startsWith("image/"))
    return { artifact_id: id, mime: row.mime, bytes: row.bytes, image: fs.readFileSync(row.file).toString("base64") };
  if (!row.mime.startsWith("text/") && row.mime !== "application/json")
    return { artifact_id: id, mime: row.mime, bytes: row.bytes, file: row.file, note: "Binary artifact: open the file path directly" };
  const text = fs.readFileSync(row.file, "utf8");
  let lines = text.split("\n");
  const total = lines.length;
  let matcher: RegExp | undefined;
  if (options.grep) {
    try { matcher = new RegExp(options.grep, "i"); } catch { matcher = new RegExp(options.grep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
    lines = lines.map((line, index) => `${index + 1}: ${line}`).filter((line) => matcher!.test(line));
  }
  const start = Math.max(0, options.line ?? 0);
  const limit = Math.min(Math.max(1, options.limit ?? 200), 2000);
  let chunk = lines.slice(start, start + limit);
  let joined = chunk.join("\n");
  // Keep responses bounded even for very long single lines.
  while (joined.length > 60000 && chunk.length > 1) {
    chunk = chunk.slice(0, Math.ceil(chunk.length / 2));
    joined = chunk.join("\n");
  }
  if (joined.length > 60000) joined = joined.slice(0, 60000) + "…";
  const end = start + chunk.length;
  return {
    artifact_id: id,
    mime: row.mime,
    total_lines: total,
    ...(matcher ? { matched_lines: lines.length } : {}),
    line: start,
    next_line: end < lines.length ? end : null,
    content: joined,
  };
}

const DAY = 86400000;
const BATCH = 64;
const RECHECK = 60000;
let cleaning: Promise<void> | undefined;
let ticking = false;
let timer: NodeJS.Timeout | undefined;
let wakeAt = Infinity;
let maintenanceAt = 0;
let discoveryAt = 0;
let orphanAt = Infinity;
let stopped = false;

/** Age checks use indexed, bounded pages; directory discovery and quotas run only on maintenance. */
async function sweep(maintenance: boolean, discover: boolean) {
  const db = await database();
  const cfg = config();
  const cutoff = Date.now() - DAY;
  let failure: Error | undefined;
  const remove = async (file: string) => {
    try { await fs.promises.unlink(file); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      failure ??= new Error(`Cannot remove expired output ${file}: ${(error as Error).message}. Check file permissions; its retention record is kept for retry.`);
      return false;
    }
  };
  const prune = async (table: "artifacts" | "exports", where: string, params: number[] = [], bytesToFree = Infinity) => {
    const key = table === "artifacts" ? "id" : "path";
    const fields = table === "artifacts" ? "file,bytes" : "path AS file,0 AS bytes";
    const select = db.prepare(`SELECT ${key} AS key,${fields},created FROM ${table} WHERE (${where}) AND (created,${key})>(?,?) ORDER BY created,${key} LIMIT ${BATCH}`);
    const forget = db.prepare(`DELETE FROM ${table} WHERE ${key}=? AND created=?`);
    const unchanged = db.prepare(`SELECT 1 FROM ${table} WHERE ${key}=? AND created=?`);
    let created = -1, last = "";
    while (bytesToFree > 0) {
      const rows = select.all(...params, created, last) as { key: string; file: string; bytes: number; created: number }[];
      if (!rows.length) break;
      const removed = [];
      for (const row of rows) {
        if (bytesToFree <= 0) break;
        if (!unchanged.get(row.key, row.created)) continue;
        if (await remove(row.file)) { removed.push(row); bytesToFree -= row.bytes; }
      }
      // One short transaction per page, never hold a SQLite lock across filesystem awaits.
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of removed) forget.run(row.key, row.created);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      const end = rows[rows.length - 1]!;
      created = end.created; last = end.key;
      await yieldTurn();
    }
  };
  // Active or paused jobs must not exempt their media from the 24-hour limit.
  await prune("artifacts", "created<=?", [cutoff]);
  await prune("exports", "created<=?", [cutoff]);
  if (maintenance) {
    const active = "('queued','running','needs_input')";
    const old = db.prepare(`SELECT id FROM jobs WHERE status NOT IN ${active} AND (updated<=? OR id IN (SELECT id FROM jobs WHERE status NOT IN ${active} ORDER BY updated DESC LIMIT -1 OFFSET ?)) LIMIT ${BATCH}`);
    while (true) {
      const rows = old.all(cutoff, cfg.max_jobs) as { id: string }[];
      if (!rows.length) break;
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const { id } of rows) {
          db.prepare("DELETE FROM jobs WHERE id=?").run(id);
          db.prepare("DELETE FROM effects WHERE job_id=?").run(id);
          db.prepare("DELETE FROM events WHERE job_id=?").run(id);
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      await yieldTurn();
    }
    await prune("artifacts", "job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.id=artifacts.job_id)");
    const budget = cfg.max_artifact_mb * 1024 * 1024;
    const { used } = db.prepare("SELECT COALESCE(SUM(bytes),0) AS used FROM artifacts").get() as { used: number };
    if (used > budget) await prune("artifacts", "1", [], used - budget);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ui_tests'").get()) {
      db.prepare("DELETE FROM ui_tests WHERE updated<=?").run(cutoff);
    }
  }
  // Discover crash leftovers hourly, streaming directory entries instead of retaining a file list.
  // Once discovered, each earliest orphan deadline participates in the same timer as registered files.
  if (discover) {
    orphanAt = Infinity;
    const known = db.prepare("SELECT 1 FROM artifacts WHERE file=? LIMIT 1");
    const dir = artifactDir();
    let count = 0;
    for await (const entry of await fs.promises.opendir(dir)) {
      const file = path.join(dir, entry.name);
      if (entry.isFile() && !known.get(file)) {
        let stat;
        try { stat = await fs.promises.stat(file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (stat) {
          const expires = Math.min(stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs, stat.mtimeMs) + DAY;
          if (expires <= Date.now() && !known.get(file)) await remove(file);
          else orphanAt = Math.min(orphanAt, expires);
        }
      }
      if (++count % BATCH === 0) await yieldTurn();
    }
  }
  if (failure) throw failure;
}

/** Explicit cleanup shares the in-flight sweep; callers receive failures, never a false success. */
export function cleanup(maintenance = true, discover = true): Promise<void> {
  if (!cleaning) {
    if (maintenance) maintenanceAt = Date.now() + 3600000;
    if (discover) discoveryAt = Date.now() + 3600000;
    cleaning = sweep(maintenance, discover).finally(() => { cleaning = undefined; });
  }
  return cleaning;
}

/**
 * Copies written outside the state directory (screenshot/record save_path, test_export directories)
 * are tracked too, so the same retention removes them: nothing this server produces accumulates.
 */
export async function trackExport(file: string) {
  (await database()).prepare("INSERT OR REPLACE INTO exports(path,created) VALUES(?,?)").run(path.resolve(file), Date.now());
  scheduleCleanup(1000);
}

function arm(at: number) {
  if (stopped || at >= wakeAt) return;
  clearTimeout(timer);
  wakeAt = at;
  timer = setTimeout(() => {
    wakeAt = Infinity;
    void tick();
  }, Math.max(0, at - Date.now())).unref();
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await cleanup(Date.now() >= maintenanceAt, Date.now() >= Math.min(discoveryAt, orphanAt));
    if (stopped) return;
    const db = await database();
    const artifact = db.prepare("SELECT created FROM artifacts ORDER BY created LIMIT 1").get() as { created: number } | undefined;
    const exported = db.prepare("SELECT created FROM exports ORDER BY created LIMIT 1").get() as { created: number } | undefined;
    // Cheap reconciliation catches another writer, wall-clock changes and wake from sleep.
    arm(Math.min(Date.now() + RECHECK, maintenanceAt, discoveryAt, orphanAt, (artifact?.created ?? Infinity) + DAY, (exported?.created ?? Infinity) + DAY));
  } catch (error) {
    process.stderr.write(`[retention] ${(error as Error).message}; retry in 30s\n`);
    maintenanceAt = Date.now() + 30000;
    discoveryAt = Math.min(discoveryAt, maintenanceAt);
    arm(maintenanceAt);
  } finally {
    ticking = false;
  }
}

/** One unref timer for deadlines and coalesced quota checks, off the handshake path. */
export function scheduleCleanup(delayMs = 0) {
  if (stopped) return;
  maintenanceAt = Math.min(maintenanceAt, Date.now() + delayMs);
  arm(Date.now() + delayMs);
}

/** Stop before closing SQLite; pending filesystem operations must finish first. */
export async function stopCleanup() {
  stopped = true;
  clearTimeout(timer);
  wakeAt = Infinity;
  await cleaning;
}
