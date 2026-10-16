import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import { stateDir } from "./config.js";
import { database } from "./db.js";
import { invariant } from "./errors.js";

const DAY = 86400000;
let due = 0;
let collecting: Promise<CleanupResult> | undefined;
export type CleanupResult = { removed: number; failed: number; first_failure?: { path: string; code: string } };
export const storageDeadline = () => due;
export function requestStorageCleanup() { due = 0; }
export function reportCleanup(result: CleanupResult) {
  if (result.failed) process.stderr.write(`[retention] ${result.failed} deletion(s) failed; first: ${JSON.stringify(result.first_failure?.path.slice(0, 300))} (${result.first_failure?.code}). Automatic retries disabled, including after restart; remove affected files manually.\n`);
}

/** Serialize only pointer/pin changes, never network IO or recursive removal. */
export async function storageGuard<T>(fn: (db: DatabaseSync) => T): Promise<T> {
  return storageTransaction(await database(), fn);
}
export function storageTransaction<T>(db: DatabaseSync, fn: (db: DatabaseSync) => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const value = fn(db); db.exec("COMMIT"); return value; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

function pins(db: DatabaseSync) {
  const rows = db.prepare("SELECT path,owner,pid,kind FROM retention_pins").all() as { path: string; owner: string; pid: number; kind: string }[];
  const alive = new Map<number, boolean>();
  return rows.filter((row) => {
    if (!alive.has(row.pid)) {
      try { process.kill(row.pid, 0); alive.set(row.pid, true); }
      catch (error) { alive.set(row.pid, (error as NodeJS.ErrnoException).code !== "ESRCH"); }
    }
    if (alive.get(row.pid)) return true;
    db.prepare("DELETE FROM retention_pins WHERE path=? AND owner=?").run(row.path, row.owner);
    return false;
  });
}
const overlaps = (a: string, b: string) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
function storagePath(file: string, followLeaf = false) {
  const full = path.resolve(file);
  let existing = followLeaf ? full : path.dirname(full);
  while (true) {
    try {
      const canonical = path.join(fs.realpathSync.native(existing), path.relative(existing, full));
      return process.platform === "win32" ? canonical.toLowerCase() : canonical;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || path.dirname(existing) === existing) throw error;
      existing = path.dirname(existing);
    }
  }
}

/** Call inside storageGuard before opening a pack or creating a temporary working directory. */
export function pinStorage(db: DatabaseSync, file: string) {
  file = storagePath(file, true);
  invariant(!pins(db).some((p) => p.kind === "delete" && overlaps(p.path, file)), "RESOURCE_BUSY", "Storage is being reclaimed", { path: file });
  const owner = crypto.randomUUID();
  db.prepare("INSERT INTO retention_pins VALUES(?,?,?,?)").run(file, owner, process.pid, "use");
  return () => {
    db.prepare("DELETE FROM retention_pins WHERE path=? AND owner=?").run(file, owner);
    requestStorageCleanup();
  };
}

/** Never create a backup copy. A temporary workspace is protected only for its operation. */
export async function temporaryStorage<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const release = await storageGuard((db) => {
    const release = pinStorage(db, dir);
    fs.mkdirSync(dir);
    db.prepare("DELETE FROM retention_failures WHERE path=?").run(storagePath(dir));
    return release;
  });
  try { return await fn(); }
  finally {
    release();
    reportCleanup(await removeStorage(dir));
  }
}

function knowledgeReferences() {
  const root = storagePath(path.join(stateDir(), "kb"));
  let value;
  try { value = JSON.parse(fs.readFileSync(path.join(root, "current.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set<string>(); throw error; }
  const names = [value.directory ?? value.version, value.previous].filter((n) => n != null);
  invariant(names.length > 0 && names.every((n) => typeof n === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(n)), "INVALID_INPUT", "Invalid knowledge pointer; preserve installed packs until repaired");
  return new Set(names.flatMap((n) => [path.join(root, n), storagePath(path.join(root, n), true)]));
}

function temporaryExpiry(file: string) {
  const modified = fs.lstatSync(file).mtimeMs;
  // Renaming a damaged database preserves its old mtime; the recovery timestamp starts its TTL.
  const stamp = /^state\.db\.corrupt-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)/i.exec(path.basename(file))?.[1];
  const recovered = stamp ? Date.parse(stamp.toUpperCase().replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z/, "T$1:$2:$3.$4Z")) : 0;
  return Math.max(modified, Number.isFinite(recovered) ? recovered : 0) + DAY;
}

/** A streaming walk keeps memory bounded; one failure stops this tree, with no filesystem retries. */
async function removeTree(file: string, progress: { count: number }) {
  let stat;
  try { stat = await fs.promises.lstat(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (stat.isDirectory()) {
    for await (const entry of await fs.promises.opendir(file)) await removeTree(path.join(file, entry.name), progress);
    await fs.promises.rmdir(file);
  } else await fs.promises.unlink(file); // Symlinks are unlinked, never followed.
  if (++progress.count % 64 === 0) await yieldTurn();
}

export async function removeStorage(file: string, eligible: () => boolean = () => true): Promise<CleanupResult> {
  file = storagePath(file);
  const result: CleanupResult = { removed: 0, failed: 0 };
  const owner = crypto.randomUUID();
  const claimed = await storageGuard((db) => {
    if (db.prepare("SELECT 1 FROM retention_failures WHERE path=?").get(file) || pins(db).some((p) => overlaps(p.path, file)) || !eligible()) return false;
    if (path.dirname(file) === storagePath(path.join(stateDir(), "kb")) && !path.basename(file).startsWith(".") && knowledgeReferences().has(file)) return false;
    db.prepare("INSERT INTO retention_pins VALUES(?,?,?,?)").run(file, owner, process.pid, "delete");
    return true;
  });
  if (!claimed) return result;
  const db = await database();
  try { await removeTree(file, { count: 0 }); result.removed = 1; }
  catch (error) {
    const code = ((error as NodeJS.ErrnoException).code ?? "UNKNOWN").slice(0, 64);
    if (db.prepare("INSERT OR IGNORE INTO retention_failures VALUES(?,?,?)").run(file, code, Date.now()).changes) {
      result.failed = 1; result.first_failure = { path: file, code };
    }
  } finally { db.prepare("DELETE FROM retention_pins WHERE path=? AND owner=?").run(file, owner); }
  return result;
}

/** Startup/hourly reconciliation, plus immediate sweeps after update/rollback. No extra timer. */
export function collectStorage(): Promise<CleanupResult> {
  return collecting ??= collect().finally(() => { collecting = undefined; });
}
async function collect(): Promise<CleanupResult> {
  due = Date.now() + 3600000;
  const root = storagePath(stateDir(), true), kb = path.join(root, "kb"), backups = path.join(root, "backups");
  const result: CleanupResult = { removed: 0, failed: 0 };
  const db = await database();
  await storageGuard((db) => { pins(db); });
  const add = (r: CleanupResult) => { result.removed += r.removed; result.failed += r.failed; result.first_failure ??= r.first_failure; };
  for (const dir of [kb, backups, root]) {
    let stream;
    try {
      const stat = await fs.promises.lstat(dir);
      invariant(stat.isDirectory() && !stat.isSymbolicLink(), "INVALID_INPUT", "Managed storage root must be a real directory", { path: dir });
      stream = await fs.promises.opendir(dir);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for await (const entry of stream) {
      const file = storagePath(path.join(dir, entry.name));
      const temporary = dir === backups || dir === root && /^state\.db\.corrupt-/.test(entry.name)
        || dir === kb && /^\.(?:upstream|tmp|download)-[a-f0-9]+(?:\.tgz)?$/.test(entry.name);
      const pack = dir === kb && entry.isDirectory() && !entry.name.startsWith(".");
      if ((!temporary && !pack) || db.prepare("SELECT 1 FROM retention_failures WHERE path=?").get(file)) continue;
      if (pack && knowledgeReferences().has(file)) continue;
      let expires = 0;
      if (temporary) {
        try { expires = temporaryExpiry(file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      }
      if (expires > Date.now()) { due = Math.min(due, expires); continue; }
      add(await removeStorage(file, () => {
        if (pack) return !knowledgeReferences().has(file);
        try { return temporaryExpiry(file) <= Date.now(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
      }));
      await yieldTurn();
    }
  }
  return result;
}
