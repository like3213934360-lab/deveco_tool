import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inside } from "../core/files.js";
import { invariant } from "../core/errors.js";

/** One bounded byte reader backs tool, resource and prompt content. */
export function readContentFile(root: string, relative: string, expected?: string, maxBytes = 256 * 1024): { text: string; sha256: string } {
  const file = inside(root, relative);
  let parent = path.dirname(file);
  while (parent !== path.resolve(root)) {
    invariant(!fs.lstatSync(parent).isSymbolicLink(), "CONTENT_PATH_INVALID", "Bundled content cannot traverse symbolic links");
    const next = path.dirname(parent); invariant(next !== parent, "CONTENT_PATH_INVALID", "Content must remain within its resource root"); parent = next;
  }
  invariant(!fs.lstatSync(file).isSymbolicLink(), "CONTENT_FILE_INVALID", "Bundled content cannot be a symbolic link");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    invariant(before.isFile() && before.size <= maxBytes, "CONTENT_FILE_INVALID", "Content must be a bounded regular file");
    const bytes = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null); if (!count) break; offset += count; }
    const after = fs.fstatSync(fd);
    invariant(offset === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, "CONTENT_CHANGED", "Content changed during the read");
    const content = bytes.subarray(0, offset), sha256 = createHash("sha256").update(content).digest("hex");
    invariant(!expected || expected === sha256, "CONTENT_INTEGRITY", "Content differs from its versioned manifest");
    return { text: content.toString("utf8"), sha256 };
  } finally { fs.closeSync(fd); }
}
