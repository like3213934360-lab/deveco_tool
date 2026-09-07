import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import lockfile from "proper-lockfile";

const sessionId = crypto.randomUUID();
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;
let lastWarning = -Infinity;

/** Serializes within one process; the directory lease also protects rotation across MCP hosts. */
export function createPerformanceLogger({ directory, maxBytes = MAX_BYTES, maxFiles = MAX_FILES } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 128 || !Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 20) {
    throw new RangeError("Invalid performance log retention limits");
  }
  let tail = Promise.resolve();
  async function write(record) {
    const started = performance.now();
    const root = path.resolve(directory ?? process.env.DEVECO_TOOL_LOG_DIR ?? path.join(os.homedir(), ".deveco-tool", "logs"));
    const file = path.join(root, "ui-performance.jsonl");
    let release;
    try {
      const line = JSON.stringify(record) + "\n";
      const bytes = Buffer.byteLength(line);
      if (bytes > Math.min(maxBytes, 16384)) throw Object.assign(new Error("Performance record too large"), { code: "RECORD_TOO_LARGE" });
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      let compromised;
      release = await lockfile.lock(root, { lockfilePath: path.join(root, ".ui-performance.lock"),
        stale: 10000, retries: { retries: 12, minTimeout: 10, maxTimeout: 50, factor: 1.3 },
        onCompromised: error => { compromised = error; } });
      const size = await fs.stat(file).then(stat => stat.size, error => {
        if (error.code === "ENOENT") return 0;
        throw error;
      });
      if (size + bytes > maxBytes) {
        await fs.rm(maxFiles === 1 ? file : `${file}.${maxFiles - 1}`, { force: true });
        for (let index = maxFiles - 2; index >= 0; index--) {
          try { await fs.rename(index === 0 ? file : `${file}.${index}`, `${file}.${index + 1}`); }
          catch (error) { if (error.code !== "ENOENT") throw error; }
        }
      }
      if (compromised) throw compromised;
      await fs.appendFile(file, line, { mode: 0o600 });
      await release();
      release = null;
      return { status: "written", path: file, elapsedMs: Math.round((performance.now() - started) * 1000) / 1000 };
    } catch (error) {
      // Observability failure must not turn an accepted device action into an apparent failure.
      if (performance.now() - lastWarning >= 60000) {
        lastWarning = performance.now();
        process.stderr.write(`[deveco-tool] Performance log unavailable (${error.code ?? "LOG_WRITE_FAILED"}): ${file}\n`);
      }
      return { status: "failed", path: file, code: error.code ?? "LOG_WRITE_FAILED" };
    } finally {
      if (release) await release().catch(() => {});
    }
  }
  return record => {
    const pending = tail.then(() => write(record));
    tail = pending.catch(() => {});
    return pending;
  };
}

const append = createPerformanceLogger();

export function persistUiPerformance(metrics, error) {
  if (process.env.DEVECO_UI_PERFORMANCE_LOG === "0") return Promise.resolve({ status: "disabled" });
  // No arguments, screenshots, UI text, output payloads, project paths or error messages.
  const errorCode = error ? String(error.code ?? "UI_OPERATION_FAILED").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) : null;
  return append({ version: 1, timestamp: new Date().toISOString(), sessionId, pid: process.pid,
    success: !error, errorCode, ...metrics });
}
