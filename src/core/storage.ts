import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { setImmediate as yieldTurn } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import { packageRoot, stateDir } from "./config.js";
import { database } from "./db.js";
import { invariant } from "./errors.js";
import { withResourceSnapshot } from "./operations.js";

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

export async function removeStorage(file: string, eligible: () => boolean = () => true, betweenOperations = false): Promise<CleanupResult> {
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
  try {
    // Hot-state writers in older hosts do not pin files. Their resource gate must stay held
    // through the unlink, without yielding; new writers are also excluded by the delete pin.
    if (betweenOperations) result.removed = await withResourceSnapshot((owners) => {
      if (owners.size || !eligible()) return 0;
      try { fs.unlinkSync(file); return 1; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
    });
    else { await removeTree(file, { count: 0 }); result.removed = 1; }
  }
  catch (error) {
    const code = ((error as NodeJS.ErrnoException).code ?? "UNKNOWN").slice(0, 64);
    if (db.prepare("INSERT OR IGNORE INTO retention_failures VALUES(?,?,?)").run(file, code, Date.now()).changes) {
      result.failed = 1; result.first_failure = { path: file, code };
    }
  } finally { db.prepare("DELETE FROM retention_pins WHERE path=? AND owner=?").run(file, owner); }
  return result;
}

function invalidHotState(file: string) {
  let value: { moduleRoot?: unknown };
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error instanceof SyntaxError) return true; if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  if (!value || typeof value.moduleRoot !== "string") return true;
  try { return !fs.statSync(value.moduleRoot).isDirectory(); }
  catch (error) { if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return true; throw error; }
}

/** Only explicitly owned test workspaces are disposable; arbitrary scratch material is not. */
function testWorkspace(file: string): { created: number; pids: number[] } | undefined {
  const marker = path.join(file, ".deveco-temporary.json");
  let stat;
  try { stat = fs.lstatSync(marker); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (!stat.isFile()) return;
  let value;
  try { value = JSON.parse(fs.readFileSync(marker, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (value.package_root !== packageRoot) return;
  invariant(value.schema === 1 && Number.isFinite(value.created) && Array.isArray(value.pids) && value.pids.length
    && value.pids.every((pid: unknown) => Number.isSafeInteger(pid) && Number(pid) > 0), "INVALID_INPUT", "Invalid temporary workspace ownership marker", { file });
  return value;
}
function workspaceExpired(file: string) {
  const value = testWorkspace(file);
  return !!value && value.created + DAY <= Date.now() && value.pids.every((pid) => {
    try { process.kill(pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
  });
}

/** Pointer changes need a scan that starts after the change, even if an older sweep is running.
 * Concurrent callers share that follow-up scan; failed paths stay excluded. No retry loop/timer. */
export async function collectStorage(afterChange = false): Promise<CleanupResult> {
  if (afterChange && collecting) await collecting;
  return collecting ??= collect().finally(() => { collecting = undefined; });
}
async function collect(): Promise<CleanupResult> {
  due = Date.now() + 3600000;
  const root = storagePath(stateDir(), true), kb = path.join(root, "kb"), backups = path.join(root, "backups"), hotpath = path.join(root, "hotpath"), scratch = path.join(packageRoot, ".scratch"), external = os.tmpdir();
  const result: CleanupResult = { removed: 0, failed: 0 };
  const db = await database();
  await storageGuard((db) => { pins(db); });
  const add = (r: CleanupResult) => { result.removed += r.removed; result.failed += r.failed; result.first_failure ??= r.first_failure; };
  for (const dir of [kb, backups, root, hotpath, scratch, external]) {
    let stream;
    try {
      const stat = await fs.promises.lstat(dir);
      invariant(stat.isDirectory() && !stat.isSymbolicLink(), "INVALID_INPUT", "Managed storage root must be a real directory", { path: dir });
      stream = await fs.promises.opendir(dir);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for await (const entry of stream) {
      const file = storagePath(path.join(dir, entry.name));
      const hot = dir === hotpath && entry.isFile() && /^[a-f0-9]{16}\.json$/.test(entry.name);
      const workspace = entry.isDirectory() && (dir === scratch && /^test-[a-z0-9-]+$/.test(entry.name)
        || dir === external && /^deveco-test-[a-z0-9-]+$/.test(entry.name)) ? testWorkspace(file) : undefined;
      const temporary = dir === backups || dir === root && /^state\.db\.corrupt-/.test(entry.name)
        || dir === kb && /^\.(?:upstream|tmp|download)-[a-f0-9]+(?:\.tgz)?$/.test(entry.name);
      const pack = dir === kb && entry.isDirectory() && !entry.name.startsWith(".");
      if ((!temporary && !pack && !hot && !workspace) || db.prepare("SELECT 1 FROM retention_failures WHERE path=?").get(file)) continue;
      if (pack && knowledgeReferences().has(file)) continue;
      let expires = 0;
      if (temporary || hot) {
        try { expires = temporaryExpiry(file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      }
      if (workspace) expires = workspace.created + DAY;
      if (expires > Date.now()) { due = Math.min(due, expires); continue; }
      if (hot && !invalidHotState(file)) continue;
      if (workspace && !workspaceExpired(file)) { due = Math.min(due, Date.now() + 30000); continue; }
      add(await removeStorage(file, () => {
        if (pack) return !knowledgeReferences().has(file);
        try { return workspace ? workspaceExpired(file) : temporaryExpiry(file) <= Date.now() && (!hot || invalidHotState(file)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
      }, hot));
      if (hot) due = Math.min(due, Date.now() + 30000);
      await yieldTurn();
    }
  }
  return result;
}
