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
