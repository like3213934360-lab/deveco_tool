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

/** Lazily opened single state database (WAL, one connection per process). */
export async function database(): Promise<DatabaseSync> {
  if (db) return db;
  const { DatabaseSync } = await import("node:sqlite");
  db = new DatabaseSync(path.join(stateDir(), "state.db"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=OFF;");
  db.exec(schema);
  return db;
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
