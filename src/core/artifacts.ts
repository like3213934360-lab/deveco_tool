import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config, stateDir } from "./config.js";
import { database } from "./db.js";
import { invariant } from "./errors.js";

const extensions: Record<string, string> = {
  "text/plain": "txt",
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
  return { artifact_id: id, bytes, mime };
}

export async function saveArtifact(data: string | Buffer, mime = "text/plain", jobId?: string) {
  const { id, file } = artifactPath(mime);
  fs.writeFileSync(file, data);
  return commitArtifact(id, file, mime, jobId);
}

async function lookup(id: string) {
  const row = (await database()).prepare("SELECT file,mime,bytes FROM artifacts WHERE id=?").get(id) as
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

let cleaning = false;
/** Bounded retention by age, count and bytes. Runs after jobs finish, never on a timer. */
export async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  try {
    const db = await database();
    const cfg = config();
    const cutoff = Date.now() - cfg.retention_days * 86400000;
    const active = "('queued','running','needs_input')";
    const old = db
      .prepare(`SELECT id FROM jobs WHERE status NOT IN ${active} AND (updated < ? OR id IN (SELECT id FROM jobs WHERE status NOT IN ${active} ORDER BY updated DESC LIMIT -1 OFFSET ?))`)
      .all(cutoff, cfg.max_jobs) as { id: string }[];
    for (const { id } of old) {
      db.prepare("DELETE FROM jobs WHERE id=?").run(id);
      db.prepare("DELETE FROM effects WHERE job_id=?").run(id);
      db.prepare("DELETE FROM events WHERE job_id=?").run(id);
    }
    const orphans = db.prepare("SELECT id,file FROM artifacts WHERE (job_id IS NOT NULL AND job_id NOT IN (SELECT id FROM jobs)) OR (job_id IS NULL AND created < ?)").all(cutoff) as { id: string; file: string }[];
    const budget = cfg.max_artifact_mb * 1024 * 1024;
    const rows = db.prepare("SELECT id,file,bytes FROM artifacts ORDER BY created DESC").all() as { id: string; file: string; bytes: number }[];
    let used = 0;
    const over: { id: string; file: string }[] = [];
    for (const row of rows) {
      used += row.bytes;
      if (used > budget) over.push(row);
    }
    for (const row of [...orphans, ...over]) {
      fs.rmSync(row.file, { force: true });
      db.prepare("DELETE FROM artifacts WHERE id=?").run(row.id);
    }
  } finally {
    cleaning = false;
  }
}
