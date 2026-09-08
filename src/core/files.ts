import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSON5 from "json5";
import { invariant, object } from "./errors.js";
const hashBuffer = Buffer.allocUnsafe(1024 * 1024);

export function readObject(file: string): Record<string, unknown> {
  return parseObject(fs.readFileSync(file, "utf8"));
}
export function parseObject(source: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    value = JSON5.parse(source) as unknown;
  }
  return object(value);
}
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function fileDigest(file: string): string {
  const hash = crypto.createHash("sha256"),
    fd = fs.openSync(file, "r");
  // Synchronous hashing cannot interleave in one worker; reuse a bounded buffer.
  try {
    for (;;) {
      const bytes = fs.readSync(fd, hashBuffer);
      if (!bytes) break;
      hash.update(hashBuffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}
export function inside(root: string, candidate: string): string {
  const file = path.resolve(root, candidate);
  const relative = path.relative(root, file);
  invariant(
    !relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative),
    "PATH_OUTSIDE_ROOT",
    "Path escapes its root",
  );
  return file;
}
/** Canonicalize existing parents even when the requested output does not exist yet. */
export function destinationPath(candidate: string): string {
  const resolved = path.resolve(candidate);
  try {
    // Match fs.promises.realpath: native Windows resolution expands 8.3 names.
    // The JavaScript realpathSync implementation can retain short aliases and
    // split one project's identity/lease keys across equivalent paths.
    return fs.realpathSync.native(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(resolved);
    if (parent === resolved) throw error;
    return path.join(destinationPath(parent), path.basename(resolved));
  }
}
export function privateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  invariant(
    fs.lstatSync(directory).isDirectory() &&
      !fs.lstatSync(directory).isSymbolicLink(),
    "UNSAFE_STATE_PATH",
    "State directory must be a real directory",
  );
}
export function atomicWrite(
  file: string,
  data: string | Buffer,
  replace = true,
): void {
  // User-selected output directories may contain OS aliases, such as /tmp on macOS.
  // State directories are checked separately by their owner before use.
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const parent = fs.realpathSync.native(path.dirname(file));
  const destination = path.join(parent, path.basename(file));
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (replace) fs.renameSync(temporary, destination);
    else fs.linkSync(temporary, destination);
    if (process.platform !== "win32") {
      const directory = fs.openSync(parent, "r");
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
/** Publish an SDK-produced file only after its private destination copy is
 * durable. The exclusive link prevents a concurrent request being overwritten. */
export async function publishFile(
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<{ bytes: number; sha256: string }> {
  signal?.throwIfAborted();
  const parent = await fs.promises.realpath(path.dirname(destination)),
    target = path.join(parent, path.basename(destination)),
    temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    const input = await fs.promises.open(
      source,
      fs.constants.O_RDONLY | fs.constants.O_NONBLOCK,
    );
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    try {
      const before = await input.stat();
      invariant(
        before.isFile(),
        "OUTPUT_INVALID",
        "SDK output must be a regular file",
      );
      // Private from creation, including keystores written by a permissive SDK.
      // Keep the writable handle through sync; Windows rejects read-only fsync.
      const file = await fs.promises.open(temporary, "wx", 0o600);
      try {
        const buffer = Buffer.allocUnsafe(65536);
        while (bytes < before.size) {
          signal?.throwIfAborted();
          const { bytesRead } = await input.read(
            buffer,
            0,
            Math.min(buffer.length, before.size - bytes),
            bytes,
          );
          invariant(
            bytesRead > 0,
            "OUTPUT_CHANGED",
            "SDK output was truncated during publication",
          );
          hash.update(buffer.subarray(0, bytesRead));
          let written = 0;
          while (written < bytesRead) {
            signal?.throwIfAborted();
            const result = await file.write(
              buffer,
              written,
              bytesRead - written,
              bytes + written,
            );
            invariant(
              result.bytesWritten > 0,
              "OUTPUT_WRITE_FAILED",
              "Output publication made no progress",
            );
            written += result.bytesWritten;
          }
          bytes += bytesRead;
        }
        const after = await input.stat();
        invariant(
          before.size === after.size &&
            before.mtimeMs === after.mtimeMs &&
            before.ctimeMs === after.ctimeMs,
          "OUTPUT_CHANGED",
          "SDK output changed during publication",
        );
        await file.sync();
      } finally {
        await file.close();
      }
    } finally {
      await input.close();
    }
    signal?.throwIfAborted();
    await fs.promises.link(temporary, target);
    if (process.platform !== "win32") {
      const directory = await fs.promises.open(parent, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    await fs.promises.rm(temporary, {
      force: true,
      recursive: true,
      maxRetries: 3,
      retryDelay: 40,
    });
  }
}
export function walk(
  root: string,
  extensions?: ReadonlySet<string>,
  maxFiles = 100000,
): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const file = path.join(directory, item.name);
      if (
        item.isDirectory() &&
        ![
          "node_modules",
          "oh_modules",
          ".git",
          ".hvigor",
          ".cache",
          ".idea",
          ".cxx",
          ".preview",
          "build",
          "dist",
        ].includes(item.name)
      )
        visit(file);
      else if (
        item.isFile() &&
        (!extensions || extensions.has(path.extname(file)))
      )
        files.push(file);
      invariant(
        files.length <= maxFiles,
        "PROJECT_TOO_LARGE",
        `File count exceeds ${maxFiles}`,
      );
    }
  };
  visit(root);
  return files;
}
