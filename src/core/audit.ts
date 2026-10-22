import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { stateDir } from "./config.js";
import { database } from "./db.js";
import { sha256 } from "./files.js";
import { invariant } from "./errors.js";
import { withResourceSnapshot } from "./operations.js";

const DAY = 86400000;
let due = 0;
export const auditDeadline = () => due;

export async function appendAudit(row: Record<string, unknown>) {
  const db = await database(), data = JSON.stringify(row), created = Date.parse(String(row.at));
  db.prepare("INSERT INTO audit_events VALUES(?,?,?,?)").run(sha256(data), String(row.owner_id ?? ""), created, data);
  due = Math.min(due, created + DAY);
  (await import("./artifacts.js")).scheduleCleanup(1000);
}

export async function readAudit(owner: string) {
  return (await database()).prepare("SELECT data FROM audit_events WHERE owner=? ORDER BY created,rowid").all(owner)
    .map((row) => JSON.parse(String(row.data)) as Record<string, unknown>);
}

/** Bounded memory, including UTF-8 split across reads. Legacy rows are metadata only. */
function* legacyLines(file: string) {
  const fd = fs.openSync(file, "r"), buffer = Buffer.allocUnsafe(65536), decoder = new StringDecoder("utf8");
  let pending = "";
  try {
    for (;;) {
      const n = fs.readSync(fd, buffer);
      pending += n ? decoder.write(buffer.subarray(0, n)) : decoder.end();
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) { const line = pending.slice(0, end); pending = pending.slice(end + 1); if (line.trim()) yield line; }
      invariant(pending.length <= 1024 * 1024, "INVALID_INPUT", "Legacy operation log contains an oversized record; preserve it for inspection");
      if (!n) { if (pending.trim()) yield pending; break; }
    }
  } finally { fs.closeSync(fd); }
}

/** The resource gate also covers pre-migration writers. Import only between operations;
 * commit before unlinking, with content IDs making an interrupted import idempotent. */
export async function cleanupAudit(cutoff: number) {
  const db = await database(), file = path.join(stateDir(), "audit/operations.jsonl");
  await withResourceSnapshot((owners) => {
    const legacy = fs.existsSync(file);
    if (legacy && !owners.size) {
      invariant(fs.lstatSync(file).isFile(), "INVALID_INPUT", "Legacy operation log must be a regular file");
      db.exec("BEGIN IMMEDIATE");
      try {
        const insert = db.prepare("INSERT OR IGNORE INTO audit_events VALUES(?,?,?,?)");
        for (const line of legacyLines(file)) {
          const row = JSON.parse(line), created = Date.parse(row?.at);
          invariant(row && typeof row === "object" && Number.isFinite(created), "INVALID_INPUT", "Invalid legacy operation record; preserve the log for inspection");
          if (created > cutoff) insert.run(sha256(line), String(row.owner_id ?? ""), created, line);
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      fs.unlinkSync(file);
    }
    const active = [...owners];
    const eligible = active.length ? `owner NOT IN (${active.map(() => "?").join(",")})` : "1";
    db.prepare(`DELETE FROM audit_events WHERE created<=? AND ${eligible}`).run(cutoff, ...active);
    const next = db.prepare("SELECT MIN(created) AS created FROM audit_events WHERE created>?").get(cutoff) as { created: number | null };
    const held = db.prepare("SELECT 1 FROM audit_events WHERE created<=? LIMIT 1").get(cutoff);
    due = Math.min(Date.now() + (legacy && owners.size || held ? 30000 : 3600000), (next.created ?? Infinity) + DAY);
  });
}
