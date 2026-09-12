import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { invariant } from "./errors.js";
import { protocolVersion } from "./config.js";
import { digest } from "./files.js";

export const stateSchemaRevision = 2;
export const stateSchemaSql = `CREATE TABLE IF NOT EXISTS runtime_meta (version TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow TEXT NOT NULL, input TEXT NOT NULL, input_hash TEXT NOT NULL, request_key TEXT UNIQUE, protocol TEXT NOT NULL, status TEXT NOT NULL, owner TEXT, updated INTEGER NOT NULL, created INTEGER NOT NULL, result TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS leases (resource TEXT PRIMARY KEY, owner TEXT NOT NULL, pid INTEGER NOT NULL, updated INTEGER NOT NULL, token TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (run_id TEXT NOT NULL, node TEXT NOT NULL, input_hash TEXT NOT NULL, status TEXT NOT NULL, result TEXT, PRIMARY KEY(run_id,node));
      CREATE TABLE IF NOT EXISTS ui_recordings (run_id TEXT PRIMARY KEY, target TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, operation_owner TEXT, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ui_reviews (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, artifact_id TEXT NOT NULL, sha256 TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, read_token TEXT, read_at INTEGER, created INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ui_tests (run_id TEXT PRIMARY KEY, target TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ui_log_sessions (run_id TEXT PRIMARY KEY, owner TEXT, state TEXT NOT NULL, payload TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ui_log_chunks (run_id TEXT NOT NULL, sequence INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,sequence));
      CREATE UNIQUE INDEX IF NOT EXISTS ui_test_target ON ui_tests(target) WHERE state='active';
      CREATE TABLE IF NOT EXISTS skill_workflows (run_id TEXT PRIMARY KEY, kind TEXT NOT NULL, revision INTEGER NOT NULL, phase TEXT NOT NULL, payload TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS ui_recording_target ON ui_recordings(target) WHERE state IN ('preparing','active','sealed','cancelling');
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, file TEXT NOT NULL, bytes INTEGER NOT NULL, mime TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS artifact_gc (file TEXT PRIMARY KEY, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS released_packages (artifact_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, released_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS run_pins (id TEXT NOT NULL, run_id TEXT NOT NULL, owner TEXT NOT NULL, kind TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(id,run_id));
      CREATE TABLE IF NOT EXISTS run_dependencies (parent_run_id TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY(parent_run_id,run_id));
      CREATE INDEX IF NOT EXISTS run_dependency_target ON run_dependencies(run_id);
      CREATE TABLE IF NOT EXISTS storage_receipts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS artifact_streams (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, file TEXT NOT NULL, bytes INTEGER NOT NULL, owner TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS native_directories (id TEXT PRIMARY KEY, owner TEXT NOT NULL, file TEXT NOT NULL, bytes INTEGER NOT NULL, created INTEGER NOT NULL, closing INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS managed_processes (id TEXT PRIMARY KEY, owner TEXT NOT NULL, run_id TEXT, pid INTEGER, resources TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, windows_job TEXT);
      CREATE TABLE IF NOT EXISTS external_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, run_id TEXT, kind TEXT NOT NULL, resources TEXT NOT NULL, metadata TEXT NOT NULL, status TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, kind TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS state_schema (revision INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS runtime_instances (owner TEXT PRIMARY KEY, pid INTEGER NOT NULL);`;
const optionalSql = `
CREATE TABLE credentials (provider TEXT PRIMARY KEY, revision TEXT NOT NULL, ciphertext BLOB);
CREATE TABLE checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB,
  metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
CREATE TABLE writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);`;
type SchemaRow = { type: string; name: string; tbl_name: string; sql: string | null };
const rows = (db: Database.Database) => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name").all() as SchemaRow[];
const canonical = (sql: string | null) => sql?.replace(/\s+/g, " ").replaceAll("IF NOT EXISTS ", "").trim() ?? null;
let reference: SchemaRow[] | undefined;
function knownSchema() {
  if (!reference) {
    const db = new Database(":memory:");
    try { db.exec(stateSchemaSql + optionalSql); reference = rows(db); } finally { db.close(); }
  }
  return reference;
}
const optional = new Set(["credentials", "checkpoints", "writes", "ui_log_sessions", "ui_log_chunks", "state_schema", "runtime_instances"]);

/** Fail before DDL when the execution protocol or any persisted SQL contract is unknown. */
export function inspectStateSchema(db: Database.Database, allowEmpty = false) {
  const actual = rows(db);
  if (!actual.length && allowEmpty) return { protocol: protocolVersion, revision: 0, schema_sha256: digest([]) };
  invariant(actual.some(row => row.name === "runtime_meta" && row.type === "table"), "STATE_SCHEMA_UNSUPPORTED", "State has no supported execution identity; export with its original runtime before choosing fresh state");
  const expected = knownSchema(), byName = new Map(expected.map(row => [row.name, row]));
  invariant(actual.every(row => { const known = byName.get(row.name); return known && row.type === known.type && row.tbl_name === known.tbl_name && canonical(row.sql) === canonical(known.sql); }), "STATE_SCHEMA_UNSUPPORTED", "State contains an unknown table, column, index, view or trigger; it was not migrated");
  const versions = db.prepare("SELECT version FROM runtime_meta").all() as { version: string }[];
  invariant(versions.length === 1 && versions[0]?.version === protocolVersion, "STATE_VERSION_MISMATCH", "Use the original runtime to export history, then select fresh state for a different execution protocol");
  const names = new Set(actual.map(row => row.name));
  invariant(expected.filter(row => !optional.has(row.tbl_name)).every(row => names.has(row.name)), "STATE_SCHEMA_UNSUPPORTED", "Required durable state tables or indexes are missing");
  invariant(names.has("checkpoints") === names.has("writes") && names.has("ui_log_sessions") === names.has("ui_log_chunks"), "STATE_SCHEMA_UNSUPPORTED", "State contains a partial optional schema");
  let revision = 1;
  if (names.has("state_schema")) {
    const markers = db.prepare("SELECT revision FROM state_schema").all() as { revision: number }[];
    invariant(markers.length === 1 && markers[0]?.revision === stateSchemaRevision && names.has("runtime_instances") && names.has("ui_log_sessions"), "STATE_SCHEMA_UNSUPPORTED", "State schema revision is newer, incomplete or unsupported");
    revision = stateSchemaRevision;
  } else invariant(!names.has("runtime_instances"), "STATE_SCHEMA_UNSUPPORTED", "Runtime registrations require a schema revision");
  invariant(db.pragma("user_version", { simple: true }) === 0 && db.pragma("application_id", { simple: true }) === 0, "STATE_SCHEMA_UNSUPPORTED", "Unknown SQLite application or schema version");
  return { protocol: protocolVersion, revision, schema_sha256: digest(actual.map(row => ({ ...row, sql: canonical(row.sql) }))) };
}

/** Caller owns one immediate transaction, including maintenance check and registration. */
export function initializeStateSchema(db: Database.Database) {
  const prior = inspectStateSchema(db, true);
  db.exec(stateSchemaSql);
  if (!prior.revision) db.prepare("INSERT INTO runtime_meta VALUES (?)").run(protocolVersion);
  db.prepare("INSERT OR IGNORE INTO state_schema VALUES (?)").run(stateSchemaRevision);
  return prior;
}
export const stateMaintenancePath = (root: string) => path.join(path.dirname(path.resolve(root)), `.${path.basename(root)}.deveco-maintenance`);
export function assertStateMaintenanceAvailable(root: string) {
  invariant(!fs.lstatSync(stateMaintenancePath(root), { throwIfNoEntry: false }), "STATE_MAINTENANCE_ACTIVE", "State is fenced by an upgrade or rollback; resume that maintenance journal before starting MCP");
}
