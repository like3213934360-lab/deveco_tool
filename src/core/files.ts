import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { invariant, ToolError } from "./errors.js";

export function readJson5(file: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON5.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ToolError("PROJECT_INVALID", `Cannot parse ${file}: ${(error as Error).message}`);
  }
  invariant(value && typeof value === "object" && !Array.isArray(value), "PROJECT_INVALID", `${file} must contain an object`);
  return value as Record<string, unknown>;
}

/** Write via a sibling temp file so readers never observe partial content. */
export function atomicWrite(file: string, data: string | Buffer, mode?: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    const fd = fs.openSync(temp, "wx", mode);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function sha256(data: string | Buffer) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export async function fileSha256(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function fileSnapshot(file: string, limit: number) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return undefined;
  invariant(stat.isFile() && stat.size <= limit && fs.realpathSync(file) === file, "INVALID_INPUT", "Expected a bounded regular file with no symbolic path", { file, max_bytes: limit });
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    invariant(opened.isFile() && opened.dev === stat.dev && opened.ino === stat.ino && opened.size === stat.size,
      "CONFLICT", "File changed before reading", { file });
    const bytes = Buffer.alloc(opened.size);
    const read = fs.readSync(fd, bytes, 0, bytes.length, 0), after = fs.lstatSync(file, { throwIfNoEntry: false });
    invariant(read === bytes.length && after?.isFile() && after.dev === opened.dev && after.ino === opened.ino &&
      after.size === opened.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs,
      "CONFLICT", "File changed while reading", { file });
    return { bytes, mode: opened.mode & 0o777 };
  } finally { fs.closeSync(fd); }
}

/** Resolve `relative` inside `root`, rejecting traversal. */
export function inside(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  invariant(rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)), "INVALID_INPUT", `Path escapes ${root}: ${relative}`);
  return target;
}

export function* walk(dir: string, skip = new Set(["node_modules", "oh_modules", "build", ".hvigor", ".git", ".idea"])): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, skip);
    else if (entry.isFile()) yield full;
  }
}

export function isFile(file: string) {
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** Keep head and tail of long text so early errors and final summaries both survive. */
export function clip(text: string, max = 4000): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  return `${text.slice(0, head)}\n…[${text.length - max} chars omitted]…\n${text.slice(text.length - (max - head))}`;
}
