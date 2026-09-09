import fs from "node:fs";
import path from "node:path";
import { setImmediate as yieldToRequests } from "node:timers/promises";
import { StateStore } from "./store.js";
import { invariant, ToolError } from "./errors.js";

/** Foreign SDK file writes need an owned lifetime and a shared reservation.
 * Observation limits retained data; it is not an OS filesystem hard quota. */
export class NativeDirectory {
  readonly controller = new AbortController();
  readonly reservation: ReturnType<StateStore["reserveNativeDirectory"]>;
  private readonly timer: NodeJS.Timeout;
  private scanning?: Promise<void>;
  private closed = false;
  get file() {
    return this.reservation.file;
  }
  constructor(
    readonly store: StateStore,
    readonly maxBytes: number,
  ) {
    this.reservation = store.reserveNativeDirectory(maxBytes);
    this.timer = setInterval(() => {
      void this.check().catch(() => {});
    }, 200);
    this.timer.unref();
  }
  own<T>(task: () => T): T {
    invariant(
      !this.closed,
      "NATIVE_DIRECTORY_CLOSED",
      "Native directory is closed",
    );
    this.controller.signal.throwIfAborted();
    return this.store.withNativeDirectory(this.reservation.id, task);
  }
  signal(parent?: AbortSignal): AbortSignal {
    return parent
      ? AbortSignal.any([parent, this.controller.signal])
      : this.controller.signal;
  }
  check(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.controller.signal.aborted)
      return Promise.reject(this.controller.signal.reason);
    return (this.scanning ??= (async () => {
      let bytes = 0,
        files = 0;
      const visit = async (directory: string, depth: number): Promise<void> => {
        invariant(
          depth <= 16,
          "NATIVE_DIRECTORY_TOO_DEEP",
          "Native output exceeds 16 directory levels",
        );
        let handle: fs.Dir;
        try {
          handle = fs.opendirSync(directory, { bufferSize: 64 });
        } catch (error) {
          if (depth > 0 && (error as NodeJS.ErrnoException).code === "ENOENT")
            return;
          throw error;
        }
        try {
          for (
            let entry = handle.readSync();
            entry;
            entry = handle.readSync()
          ) {
            const file = path.join(directory, entry.name),
              stat = fs.lstatSync(file, { throwIfNoEntry: false });
            if (!stat) continue;
            invariant(
              ++files <= 4096,
              "NATIVE_DIRECTORY_TOO_MANY_FILES",
              "Native output exceeds 4096 entries",
            );
            invariant(
              !stat.isSymbolicLink(),
              "NATIVE_DIRECTORY_SYMLINK",
              "Native output must not contain symbolic links",
            );
            // Stream at most 64 entries between yields. Empty or small SDK log
            // directories avoid a thread-pool round trip for every filesystem
            // operation; large trees remain bounded and let cancellation run.
            if (files % 64 === 0) await yieldToRequests();
            if (stat.isDirectory()) await visit(file, depth + 1);
            else {
              invariant(
                stat.isFile(),
                "NATIVE_DIRECTORY_FILE_INVALID",
                "Native output must contain regular files",
              );
              bytes += stat.size;
            }
          }
        } finally {
          handle.closeSync();
        }
      };
      try {
        await visit(this.file, 0);
      } finally {
        // Keep observed bytes charged even when the SDK produces invalid output.
        if (bytes > this.maxBytes)
          this.store.chargeNativeDirectory(this.reservation.id, bytes);
      }
      if (bytes > this.maxBytes) {
        throw new ToolError(
          "NATIVE_DIRECTORY_CAPACITY",
          "Native SDK output exceeded its reserved byte budget",
          { bytes, limit: this.maxBytes },
        );
      }
      this.store.capacity();
    })()
      .catch((error: unknown) => {
        this.controller.abort(error);
        throw error;
      })
      .finally(() => {
        this.scanning = undefined;
      }));
  }
  async execute<T>(
    task: (signal: AbortSignal) => Promise<T>,
    parent?: AbortSignal,
  ): Promise<T> {
    try {
      const result = await this.own(() => task(this.signal(parent)));
      await this.check();
      return result;
    } catch (error) {
      if (error instanceof ToolError && error.code === "CANCEL_UNCONFIRMED")
        throw error;
      if (this.controller.signal.aborted) throw this.controller.signal.reason;
      throw error;
    } finally {
      await this.close();
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    clearInterval(this.timer);
    await this.scanning?.catch(() => {});
    this.closed = true;
    this.store.releaseNativeDirectory(this.reservation.id);
  }
}
