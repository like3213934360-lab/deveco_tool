import { config } from "./config.js";
import { ToolError } from "./errors.js";

/**
 * Keyed pool of long-lived resources (language servers, log streams, watchers).
 * Each entry has a single unref'd idle timer that is re-armed on use, so an
 * idle server costs nothing and never keeps the process alive.
 */
export interface Closable {
  close(): Promise<void> | void;
}
interface Entry<T extends Closable> {
  value: Promise<T>;
  timer?: NodeJS.Timeout;
  active: number;
}

export class SessionPool<T extends Closable> {
  private readonly entries = new Map<string, Entry<T>>();
  constructor(
    private readonly limit = 4,
    private readonly idleMs = () => config().session_idle_minutes * 60000,
  ) {}

  async use<R>(key: string, create: () => Promise<T>, fn: (value: T) => Promise<R>): Promise<R> {
    let entry = this.entries.get(key);
    if (!entry) {
      // Reserve synchronously, before awaiting an eviction or starting the process.
      const retired = this.evict();
      entry = { value: retired.then(create), active: 0 };
      this.entries.set(key, entry);
      const created = entry;
      entry.value.catch(() => { if (this.entries.get(key) === created) this.entries.delete(key); });
    }
    clearTimeout(entry.timer);
    entry.active++;
    try {
      return await fn(await entry.value);
    } finally {
      entry.active--;
      if (entry.active === 0 && this.entries.get(key) === entry) {
        entry.timer = setTimeout(() => void this.close(key).catch(reportCleanup), this.idleMs());
        entry.timer.unref();
      }
    }
  }

  has(key: string) {
    return this.entries.has(key);
  }
  keys() {
    return [...this.entries.keys()];
  }

  async close(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    clearTimeout(entry.timer);
    // A failed startup was reported to its caller; a failed cleanup must remain visible.
    const value = await entry.value.catch(() => undefined);
    if (value) {
      try { await value.close(); }
      catch (error) {
        if (!this.entries.has(key)) this.entries.set(key, entry);
        throw error;
      }
    }
  }

  /** Close `key` only if it still holds `value` (a stale instance must not close its replacement). */
  async closeIf(key: string, value: T) {
    const entry = this.entries.get(key);
    if (entry && (await entry.value.catch(() => undefined)) === value && this.entries.get(key) === entry) await this.close(key).catch(reportCleanup);
  }

  async closeAll() {
    await Promise.all(this.keys().map((key) => this.close(key)));
  }

  private evict(): Promise<void> {
    if (this.entries.size < this.limit) return Promise.resolve();
    const idle = [...this.entries].find(([, e]) => e.active === 0);
    if (idle) return this.close(idle[0]);
    throw new ToolError("RESOURCE_BUSY", "All language-service sessions are in use", { limit: this.limit }, "Wait for an active request to finish before opening another project", true);
  }
}

function reportCleanup(error: unknown) {
  process.stderr.write(`[sessions] Cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
}

const pools = new Set<SessionPool<any>>();
export function pool<T extends Closable>(limit?: number) {
  const created = new SessionPool<T>(limit);
  pools.add(created);
  return created;
}
export async function closeAllSessions() {
  await Promise.all([...pools].map((p) => p.closeAll()));
}
