import { invariant } from "../../core/errors.js";
import type { BuildOptions } from "./protocol.js";

/** SDK hot compilation emits one completion per watch worker, without a request ID. */
export class BuildReceipts {
  private readonly workers = new Set<number>();
  private baseline?: string;
  private active?: {
    id: string;
    remaining: number;
    baseline?: string;
    expected: number;
  };
  get busy() {
    return this.active !== undefined;
  }
  begin(id: string, options: BuildOptions) {
    invariant(
      !this.active,
      "HVIGOR_SESSION_BUSY",
      "A build is already running",
    );
    const modules = options.prop.find((value) => value.startsWith("module="));
    const expected = modules?.slice(7).split(",").filter(Boolean).length ?? 0;
    if (options.hotCompile) {
      invariant(
        this.baseline && modules === this.baseline && this.workers.size > 0,
        "HVIGOR_WATCH_REQUIRED",
        "Hot compilation must use the complete established watch baseline",
      );
    } else {
      invariant(
        !this.baseline,
        "HVIGOR_BASELINE_ACTIVE",
        "Stop the watch worker before submitting a different build",
      );
      if (options.watch)
        invariant(
          expected > 0,
          "HVIGOR_MODULES_REQUIRED",
          "Watch requires explicit modules",
        );
    }
    this.active = {
      id,
      remaining: options.hotCompile ? this.workers.size : 1,
      ...(options.watch ? { baseline: modules } : {}),
      expected,
    };
  }
  watchWorker(id: number) {
    invariant(
      this.active?.baseline &&
        Number.isSafeInteger(id) &&
        id > 0 &&
        !this.workers.has(id),
      "HVIGOR_PROTOCOL_INVALID",
      "Unexpected SDK watch worker",
    );
    this.workers.add(id);
  }
  complete(success: boolean, message?: string) {
    const active = this.active;
    if (!active) return;
    if (success && --active.remaining > 0) return;
    if (success && active.baseline) {
      invariant(
        this.workers.size === active.expected,
        "HVIGOR_PROTOCOL_INVALID",
        "SDK watch worker count does not match the requested modules",
      );
      this.baseline = active.baseline;
    }
    this.active = undefined;
    return {
      type: "result" as const,
      id: active.id,
      success,
      ...(message === undefined ? {} : { message: message.slice(0, 8192) }),
    };
  }
}
