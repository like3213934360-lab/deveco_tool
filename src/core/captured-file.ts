import { constants } from "node:fs";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { StateStore } from "./store.js";
import { invariant } from "./errors.js";

export const capturedFileSchema = z.strictObject({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  artifact_id: z.string().uuid(),
});
export type CapturedFile = z.infer<typeof capturedFileSchema>;
export async function captureFiles(
  store: StateStore,
  runId: string,
  inputs: readonly { path: string; sha256?: string }[],
  signal?: AbortSignal,
): Promise<CapturedFile[]> {
  invariant(
    inputs.length > 0 && inputs.length <= 64,
    "PACKAGE_COUNT_INVALID",
    "Provide between 1 and 64 application packages",
  );
  const captured: CapturedFile[] = [];
  try {
    for (const input of inputs)
      captured.push(
        await captureFile(store, runId, input.path, input.sha256, signal),
      );
    return captured;
  } catch (error) {
    store.discardArtifacts(
      runId,
      captured.map((file) => file.artifact_id),
    );
    throw error;
  }
}
/** Copy from a stable file handle into charged, owned storage using bounded I/O.
 * Nothing becomes a usable input until copying, hashing and fsync complete. */
export async function captureFile(
  store: StateStore,
  runId: string,
  source: string,
  expectedSha256?: string,
  signal?: AbortSignal,
): Promise<CapturedFile> {
  signal?.throwIfAborted();
  const extension = path.extname(source);
  invariant(
    extension === ".hap" || extension === ".hsp",
    "ARTIFACT_INVALID",
    "A HAP or HSP file is required",
  );
  const input = await fs.open(
    path.resolve(source),
    constants.O_RDONLY | constants.O_NONBLOCK,
  );
  let stream: ReturnType<StateStore["streamArtifact"]> | undefined;
  try {
    stream = store.streamArtifact(
      runId,
      "application/vnd.harmony.package",
      extension,
    );
    const before = await input.stat();
    invariant(
      before.isFile(),
      "ARTIFACT_INVALID",
      "Deployment input must be a regular file",
    );
    stream.reserve(before.size);
    const output = await fs.open(stream.file, "wx", 0o600),
      hash = createHash("sha256"),
      buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    try {
      while (offset < before.size) {
        signal?.throwIfAborted();
        const { bytesRead } = await input.read(
          buffer,
          0,
          Math.min(buffer.length, before.size - offset),
          offset,
        );
        invariant(
          bytesRead > 0,
          "ARTIFACT_CHANGED",
          "Deployment input was truncated while being captured",
        );
        hash.update(buffer.subarray(0, bytesRead));
        let written = 0;
        while (written < bytesRead) {
          signal?.throwIfAborted();
          const result = await output.write(
            buffer,
            written,
            bytesRead - written,
            offset + written,
          );
          invariant(
            result.bytesWritten > 0,
            "ARTIFACT_WRITE_FAILED",
            "Package capture made no write progress",
          );
          written += result.bytesWritten;
        }
        offset += bytesRead;
      }
      const after = await input.stat();
      invariant(
        before.size === after.size &&
          before.mtimeMs === after.mtimeMs &&
          before.ctimeMs === after.ctimeMs,
        "ARTIFACT_CHANGED",
        "Deployment input changed while being captured",
      );
      const sha256 = hash.digest("hex");
      invariant(
        !expectedSha256 || expectedSha256 === sha256,
        "ARTIFACT_CHANGED",
        "Deployment package digest does not match",
      );
      signal?.throwIfAborted();
      await output.sync();
      await output.chmod(0o400);
      await output.close();
      if (process.platform !== "win32") {
        const directory = await fs.open(path.dirname(stream.file), "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
      const receipt = stream.finish();
      return {
        path: stream.file,
        sha256,
        bytes: receipt.bytes,
        artifact_id: receipt.artifact_id,
      };
    } finally {
      await output.close();
    }
  } catch (error) {
    stream?.discard();
    throw error;
  } finally {
    await input.close();
  }
}
export async function verifyCapturedFile(
  file: CapturedFile,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const input = await fs.open(
    file.path,
    constants.O_RDONLY | constants.O_NONBLOCK,
  );
  try {
    const before = await input.stat();
    invariant(
      before.isFile() && before.size === file.bytes,
      "ARTIFACT_CHANGED",
      "Captured package size has changed",
    );
    const hash = createHash("sha256"),
      buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < file.bytes) {
      signal?.throwIfAborted();
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, file.bytes - offset),
        offset,
      );
      invariant(
        bytesRead > 0,
        "ARTIFACT_CHANGED",
        "Captured package was truncated",
      );
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await input.stat();
    invariant(
      before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs &&
        hash.digest("hex") === file.sha256,
      "ARTIFACT_CHANGED",
      "Captured package does not match the submitted digest",
    );
  } finally {
    await input.close();
  }
}
