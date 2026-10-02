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
CREATE TABLE IF NOT EXISTS credentials (
  provider TEXT PRIMARY KEY,
  data BLOB
);
CREATE TABLE IF NOT EXISTS exports (
  path TEXT PRIMARY KEY,
  created INTEGER NOT NULL
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
    handle.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=OFF;");
    handle.exec(schema);
    // A truncated file can open and still be unreadable: touch every table once.
    for (const t of ["jobs", "effects", "events", "artifacts", "credentials", "exports", "kv"]) handle.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get();
    return handle;
  } catch (error) {
    handle.close();
    throw error;
  }
}

/**
 * Lazily opened single state database (WAL, one connection per process). A corrupted file is moved
 * aside (state.db.corrupt-<time>, kept for diagnosis) and a fresh database is created, so one bad
 * file cannot make every job/flow/login call fail with an opaque INTERNAL error.
 */
export async function database(): Promise<DatabaseSync> {
  if (db) return db;
  const { DatabaseSync } = await import("node:sqlite");
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
  return `The state database was corrupted (${recovered.reason}) and has been recreated; job history, flow recording drafts and logins were lost (log in again with auth). The old file is kept at ${recovered.backup}`;
}

export function closeDatabase() {
  db?.close();
  db = undefined;
}

export async function kvGet(key: string): Promise<string | undefined> {
  const row = (await database()).prepare("SELECT value FROM kv WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value;
}
export async function kvDelete(key: string) {
  (await database()).prepare("DELETE FROM kv WHERE key=?").run(key);
}
export async function kvSet(key: string, value: string) {
  (await database()).prepare("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
