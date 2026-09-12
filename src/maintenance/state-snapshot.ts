import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { z } from "zod";
import { PayloadCipher } from "../core/crypto.js";
import { atomicWrite, digest, inside, privateDirectory } from "../core/files.js";
import { invariant } from "../core/errors.js";
import { inspectStateSchema, stateMaintenancePath } from "../core/state-schema.js";
import { processIsAlive } from "./quiescence.js";

const blockSize = 1024 * 1024;
const maxBytes = 1024 * 1024 * 1024;
const maxDatabaseBytes = 256 * 1024 * 1024;
const fileSchema = z.strictObject({ path: z.string(), bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/), parts: z.number().int().nonnegative() });
const manifestSchema = z.strictObject({ format: z.literal(1), identity: z.string(), directories: z.array(z.string()).max(20000), files: z.array(fileSchema).max(20000) });
type Manifest = z.infer<typeof manifestSchema>;
const markerSchema = z.strictObject({ identity: z.string(), journal: z.string(), pid: z.number().int().positive().nullable(), nonce: z.string() });
const readMarker = (file: string) => {
  const stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8192, "UPGRADE_FENCE_INVALID", "Maintenance fence is invalid");
  return markerSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
};
function syncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const fd = fs.openSync(directory, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function inspectCompatibleState(root: string) {
  invariant(fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(), "UPGRADE_STATE_INVALID", "Compatible state must be a real directory");
  const file = path.join(root, "state.sqlite"), stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxDatabaseBytes, "UPGRADE_STATE_INVALID", "State database must be a bounded regular file (at most 256 MiB)");
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const identity = inspectStateSchema(db);
    invariant(db.pragma("quick_check", { simple: true }) === "ok", "UPGRADE_STATE_INVALID", "SQLite consistency check failed");
    for (const [table, key] of [["runs", "workflow.key"], ["credentials", "credential.key"], ["ui_tests", "ui-test.key"], ["ui_recordings", "recording.key"], ["ui_reviews", "ui-review.key"], ["skill_workflows", "skill-workflow.key"]] as const) {
      const keyPath = path.join(root, key), exists = fs.lstatSync(keyPath, { throwIfNoEntry: false });
      const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      const required = hasTable && db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
      invariant(!required || exists, "UPGRADE_KEY_MISSING", "A durable state encryption key is missing");
      invariant(!exists || (exists.isFile() && !exists.isSymbolicLink() && exists.size === 32), "UPGRADE_KEY_INVALID", "Encryption keys must remain regular 32-byte local key files");
    }
    return identity;
  } finally { db.close(); }
}

/** The persistent sibling fence survives state-directory replacement and crashes. */
export interface StateFence {
  lock(): Database.Database;
  closeDatabase(commit?: boolean): void;
  finish(success: boolean): void;
}
export function fenceState(root: string, journal: string, identity: string): StateFence {
  const file = stateMaintenancePath(root);
  let previous: z.infer<typeof markerSchema>;
  if (!fs.lstatSync(file, { throwIfNoEntry: false })) {
    previous = { identity, journal, pid: process.pid, nonce: crypto.randomUUID() };
    atomicWrite(file, JSON.stringify(previous), false);
  } else {
    previous = readMarker(file);
    invariant(previous.identity === identity && previous.journal === journal, "UPGRADE_FENCE_CONFLICT", "Another maintenance journal owns this state");
    invariant(previous.pid === null || !processIsAlive(previous.pid), "UPGRADE_SESSIONS_ACTIVE", "Another maintenance process owns this state fence");
  }
  const nonce = previous.nonce;
  const controlFile = path.join(journal, "maintenance.sqlite");
  const controlStat = fs.lstatSync(controlFile, { throwIfNoEntry: false });
  invariant(!controlStat || (controlStat.isFile() && !controlStat.isSymbolicLink()), "UPGRADE_JOURNAL_INVALID", "Maintenance coordinator must be a regular SQLite file");
  const control = new Database(controlFile, { timeout: 2000 });
  try {
    // A separate coordinator remains locked across root-directory replacement,
    // including recovery after a crash between its two renames.
    control.exec("BEGIN EXCLUSIVE");
    invariant(digest(readMarker(file)) === digest(previous), "UPGRADE_FENCE_CONFLICT", "Maintenance ownership changed while claiming its coordinator");
    atomicWrite(file, JSON.stringify({ ...previous, pid: process.pid }));
  } catch (error) {
    control.close();
    if (fs.existsSync(file) && digest(readMarker(file)) === digest(previous) && previous.pid === process.pid) atomicWrite(file, JSON.stringify({ ...previous, pid: null }));
    throw error;
  }
  let db: Database.Database | undefined;
  return {
    lock() {
      const candidate = new Database(path.join(root, "state.sqlite"), { fileMustExist: true, timeout: 2000 });
      try {
        candidate.exec("BEGIN EXCLUSIVE");
        invariant(readMarker(file).pid === process.pid && readMarker(file).nonce === nonce, "UPGRADE_FENCE_CONFLICT", "Maintenance ownership changed while locking state");
        db = candidate;
        return candidate;
      } catch (error) { candidate.close(); throw error; }
    },
    closeDatabase(commit = false) {
      if (!db) return;
      try { if (db.inTransaction) db.exec(commit ? "COMMIT" : "ROLLBACK"); }
      finally { db.close(); db = undefined; }
    },
    finish(success: boolean) {
      try {
        this.closeDatabase();
        const current = readMarker(file);
        invariant(current.nonce === nonce && current.identity === identity && current.pid === process.pid, "UPGRADE_FENCE_CONFLICT", "Maintenance fence ownership changed");
        if (success) { fs.unlinkSync(file); syncDirectory(path.dirname(file)); }
        else atomicWrite(file, JSON.stringify({ ...current, pid: null }));
      } finally { control.close(); }
    },
  };
}

function inventory(root: string) {
  const files: { path: string; bytes: number }[] = [], directories: string[] = [];
  let bytes = 0, count = 0;
  const visit = (relative: string, depth: number) => {
    invariant(depth <= 32, "UPGRADE_STATE_LIMIT", "State directory nesting exceeds 32 levels");
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      invariant(++count <= 20000, "UPGRADE_STATE_LIMIT", "State backup exceeds 20000 entries");
      const name = path.join(relative, item.name);
      if (!relative && ["state.sqlite", "state.sqlite-wal", "state.sqlite-shm"].includes(item.name)) continue;
      const stat = fs.lstatSync(path.join(root, name));
      invariant(!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()), "UPGRADE_STATE_INVALID", "State backup refuses symbolic links and special files");
      if (stat.isDirectory()) { directories.push(name); visit(name, depth + 1); }
      else {
        bytes += stat.size;
        invariant(bytes <= maxBytes, "UPGRADE_STATE_LIMIT", "State backup exceeds 1 GiB");
        files.push({ path: name, bytes: stat.size });
      }
    }
  };
  visit("", 0);
  return { files, directories, bytes };
}
function readManifest(directory: string, identity: string, cipher: PayloadCipher): Manifest {
  const file = path.join(directory, "manifest.encrypted"), stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16 * 1024 * 1024, "UPGRADE_SNAPSHOT_INVALID", "Encrypted state manifest is invalid");
  const manifest = manifestSchema.parse(JSON.parse(cipher.open(identity, fs.readFileSync(file, "utf8"))) as unknown);
  invariant(manifest.identity === identity && manifest.files.reduce((sum, item) => sum + item.bytes, 0) <= maxBytes, "UPGRADE_SNAPSHOT_INVALID", "Snapshot identity or size differs");
  const names = [...manifest.directories, ...manifest.files.map(item => item.path)];
  invariant(new Set(names).size === names.length && names.every(name => name && name !== "." && name === path.normalize(name) && !path.isAbsolute(name) && !name.startsWith("..") && !name.includes("\0")), "UPGRADE_SNAPSHOT_INVALID", "Snapshot contains invalid or duplicate paths");
  for (const name of names) inside(directory, name);
  return manifest;
}

/** Encrypt bounded blocks; the SQLite serialize API includes committed WAL pages. */
export function saveStateSnapshot(root: string, journal: string, identity: string, db: Database.Database, cipher: PayloadCipher) {
  const directory = path.join(journal, "state-before"), staging = path.join(journal, "state-before.preparing");
  if (fs.existsSync(directory)) { readStateSnapshot(journal, identity, cipher); return { preserved: true }; }
  if (fs.existsSync(staging)) {
    invariant(fs.lstatSync(staging).isDirectory() && !fs.lstatSync(staging).isSymbolicLink(), "UPGRADE_SNAPSHOT_INVALID", "Snapshot staging is not an owned directory");
    fs.rmSync(staging, { recursive: true });
  }
  const source = inventory(root);
  const databaseBytes = Number(db.pragma("page_count", { simple: true })) * Number(db.pragma("page_size", { simple: true }));
  invariant(databaseBytes <= maxDatabaseBytes && source.bytes + databaseBytes <= maxBytes, "UPGRADE_STATE_LIMIT", "State snapshot exceeds its database or total byte bound");
  const serialized = db.serialize();
  privateDirectory(staging);
  const manifest: Manifest = { format: 1, identity, directories: source.directories, files: [] };
  try {
    for (const item of [...source.files, { path: "state.sqlite", bytes: serialized.length }]) {
      const index = manifest.files.length, input = item.path === "state.sqlite" ? undefined : fs.openSync(path.join(root, item.path), "r");
      const output = fs.openSync(path.join(staging, `${index}.bin`), "wx", 0o600);
      const buffer = Buffer.allocUnsafe(blockSize), hash = crypto.createHash("sha256");
      let bytes = 0, parts = 0;
      try {
        for (;;) {
          const size = input === undefined ? Math.min(blockSize, serialized.length - bytes) : fs.readSync(input, buffer);
          if (!size) break;
          const plain = input === undefined ? serialized.subarray(bytes, bytes + size) : buffer.subarray(0, size);
          bytes += size;
          invariant(bytes <= item.bytes, "UPGRADE_STATE_CHANGED", "A state file grew during the protected snapshot");
          hash.update(plain);
          const encrypted = cipher.sealBytes(`${identity}:${index}:${parts++}`, plain), length = Buffer.alloc(4);
          length.writeUInt32BE(encrypted.length);
          fs.writeSync(output, length); fs.writeSync(output, encrypted);
        }
        invariant(bytes === item.bytes, "UPGRADE_STATE_CHANGED", "A state file changed during the protected snapshot");
        fs.fsyncSync(output);
        manifest.files.push({ path: item.path, bytes, parts, sha256: hash.digest("hex") });
      } finally { buffer.fill(0); if (input !== undefined) fs.closeSync(input); fs.closeSync(output); }
    }
    atomicWrite(path.join(staging, "manifest.encrypted"), cipher.seal(identity, JSON.stringify(manifest)), false);
    fs.renameSync(staging, directory); syncDirectory(journal);
    readStateSnapshot(journal, identity, cipher);
    return { preserved: false };
  } finally { serialized.fill(0); }
}

/** Verify every AEAD block and full plaintext hash before using a backup. */
export function readStateSnapshot(journal: string, identity: string, cipher: PayloadCipher, destination?: string) {
  const directory = path.join(journal, "state-before"), manifest = readManifest(directory, identity, cipher);
  if (destination) {
    invariant(!fs.existsSync(destination), "UPGRADE_RESTORE_EXISTS", "State restore destination already exists");
    privateDirectory(destination);
    for (const name of manifest.directories) privateDirectory(inside(destination, name));
  }
  for (const [index, file] of manifest.files.entries()) {
    const source = path.join(directory, `${index}.bin`), stat = fs.lstatSync(source);
    invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size === file.bytes + file.parts * 32, "UPGRADE_SNAPSHOT_INVALID", "Encrypted snapshot size differs");
    const input = fs.openSync(source, "r"), output = destination ? fs.openSync(inside(destination, file.path), "wx", 0o600) : undefined;
    const hash = crypto.createHash("sha256"); let bytes = 0;
    try {
      for (let part = 0; part < file.parts; part++) {
        const header = Buffer.alloc(4);
        invariant(fs.readSync(input, header) === 4, "UPGRADE_SNAPSHOT_INVALID", "Encrypted block header is incomplete");
        const length = header.readUInt32BE();
        invariant(length > 28 && length <= blockSize + 28, "UPGRADE_SNAPSHOT_INVALID", "Encrypted block length is invalid");
        const encrypted = Buffer.allocUnsafe(length);
        invariant(fs.readSync(input, encrypted) === length, "UPGRADE_SNAPSHOT_INVALID", "Encrypted block is incomplete");
        const plain = cipher.openBytes(`${identity}:${index}:${part}`, encrypted);
        try { bytes += plain.length; hash.update(plain); if (output !== undefined) fs.writeSync(output, plain); }
        finally { plain.fill(0); }
      }
      invariant(bytes === file.bytes && hash.digest("hex") === file.sha256, "UPGRADE_SNAPSHOT_INVALID", "Restored state hash differs");
      if (output !== undefined) fs.fsyncSync(output);
    } finally { fs.closeSync(input); if (output !== undefined) fs.closeSync(output); }
  }
  if (destination) { syncDirectory(destination); inspectCompatibleState(destination); }
  return manifest;
}

/** Rename both directories on the same volume; retain all post-upgrade data. */
export function restoreStateSnapshot(root: string, journal: string, identity: string, cipher: PayloadCipher) {
  const suffix = identity.slice(0, 16), parent = path.dirname(root);
  const staging = path.join(parent, `.${path.basename(root)}.restore-${suffix}`);
  const retained = path.join(parent, `.${path.basename(root)}.after-upgrade-${suffix}`);
  const intent = path.join(journal, "state-restore.json"), body = JSON.stringify({ identity, root, staging, retained });
  readStateSnapshot(journal, identity, cipher);
  if (!fs.existsSync(intent)) {
    invariant(!fs.existsSync(staging) && !fs.existsSync(retained), "UPGRADE_RESTORE_EXISTS", "Restore paths are already occupied");
    atomicWrite(intent, body, false);
  } else invariant(fs.readFileSync(intent, "utf8") === body, "UPGRADE_JOURNAL_CONFLICT", "State restore intent differs");
  if (!fs.existsSync(retained)) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
    readStateSnapshot(journal, identity, cipher, staging);
    fs.renameSync(root, retained); syncDirectory(parent);
  }
  if (!fs.existsSync(root)) {
    if (!fs.existsSync(staging)) readStateSnapshot(journal, identity, cipher, staging);
    fs.renameSync(staging, root); syncDirectory(parent);
  }
  invariant(!fs.existsSync(staging), "UPGRADE_RESTORE_CONFLICT", "State restore paths are inconsistent");
  inspectCompatibleState(root);
  return { restored: true, post_upgrade_state_retained: retained };
}
