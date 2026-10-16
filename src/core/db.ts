import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { stateDir } from "./config.js";

let db: DatabaseSync | undefined;

const schema = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  key TEXT UNIQUE,
  status TEXT NOT NULL,
  input TEXT NOT NULL,
  step TEXT,
  outputs TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  error TEXT,
  owner INTEGER,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_updated ON jobs(updated);
CREATE TABLE IF NOT EXISTS effects (
  job_id TEXT NOT NULL,
  step TEXT NOT NULL,
  state TEXT NOT NULL,
  receipt TEXT,
  updated INTEGER NOT NULL,
  PRIMARY KEY (job_id, step)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_job ON events(job_id, id);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_created ON artifacts(created,id);
CREATE INDEX IF NOT EXISTS artifacts_file ON artifacts(file);
CREATE TABLE IF NOT EXISTS credentials (
  provider TEXT PRIMARY KEY,
  data BLOB
);
CREATE TABLE IF NOT EXISTS exports (
  path TEXT PRIMARY KEY,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS exports_created ON exports(created,path);
CREATE TABLE IF NOT EXISTS retention_failures (
  path TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS retention_pins (
  path TEXT NOT NULL,
  owner TEXT NOT NULL,
  pid INTEGER NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY(path,owner)
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Set when this process found the state database corrupted and replaced it (reported by doctor and errors). */
export let recovered: { at: string; backup: string; reason: string } | undefined;

const CORRUPT = /not a database|malformed|SQLITE_(CORRUPT|NOTADB)|file is encrypted/i;

function open(DatabaseSync: typeof import("node:sqlite").DatabaseSync, file: string) {
  const handle = new DatabaseSync(file);
  try {
    // Lock contention also applies to journal-mode setup, before schema initialization.
    handle.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=OFF;");
    // Bootstrap/migrations share one durable commit. Autocommitting each CREATE can stall
    // the first protocol requests behind many fsyncs when retention opens a fresh database.
    handle.exec("BEGIN IMMEDIATE");
    try {
      handle.exec(schema);
      handle.exec("COMMIT");
    } catch (error) { handle.exec("ROLLBACK"); throw error; }
    // A truncated file can open and still be unreadable: touch every table once.
    for (const t of ["jobs", "effects", "events", "artifacts", "credentials", "exports", "retention_failures", "retention_pins", "kv"]) handle.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get();
    return handle;
  } catch (error) {
    handle.close();
    throw error;
  }
}

/**
 * Lazily opened single state database (WAL, one connection per process). A corrupted file is moved
 * aside (state.db.corrupt-<time>, retained for 24 hours) and a fresh database is created, so one bad
 * file cannot make every job/flow/login call fail with an opaque INTERNAL error.
 */
export async function database(): Promise<DatabaseSync> {
  if (db) return db;
  const { DatabaseSync } = await import("node:sqlite");
  // Another caller may finish opening while this one awaits the shared module import.
  if (db) return db;
  const file = path.join(stateDir(), "state.db");
  try {
    db = open(DatabaseSync, file);
  } catch (error) {
    const reason = (error as Error).message;
    if (!CORRUPT.test(reason)) throw error;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${file}.corrupt-${stamp}`;
    for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, backup + suffix);
    db = open(DatabaseSync, file);
    recovered = { at: new Date().toISOString(), backup, reason: reason.slice(0, 200) };
  }
  return db;
}

/** One-line explanation for responses after a recovery (consumed once per process by the server). */
let announced = false;
export function takeRecoveryNote() {
  if (!recovered || announced) return undefined;
  announced = true;
  return `The state database was corrupted (${recovered.reason}) and has been recreated; job history, flow recording drafts and logins were lost (log in again with auth). Temporary recovery copy: ${recovered.backup} (expires after 24 hours)`;
}

export function closeDatabase() {
  db?.close();
  db = undefined;
}

export async function kvGet(key: string): Promise<string | undefined> {
  const row = (await database()).prepare("SELECT value FROM kv WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value;
}
export async function kvEntries(prefix: string): Promise<{ key: string; value: string }[]> {
  return (await database()).prepare("SELECT key,value FROM kv WHERE substr(key,1,?)=? ORDER BY key").all(prefix.length, prefix) as { key: string; value: string }[];
}
export async function kvDelete(key: string) {
  (await database()).prepare("DELETE FROM kv WHERE key=?").run(key);
}
export async function kvSet(key: string, value: string) {
  (await database()).prepare("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
