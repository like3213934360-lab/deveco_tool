import { config } from "./config.js";

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
      await this.evict();
      entry = { value: create(), active: 0 };
      this.entries.set(key, entry);
      entry.value.catch(() => this.entries.delete(key));
    }
    clearTimeout(entry.timer);
    entry.active++;
    try {
      return await fn(await entry.value);
    } finally {
      entry.active--;
      if (entry.active === 0 && this.entries.get(key) === entry) {
        entry.timer = setTimeout(() => void this.close(key), this.idleMs());
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
    try {
      await (await entry.value).close();
    } catch { /* already gone */ }
  }

  /** Close `key` only if it still holds `value` (a stale instance must not close its replacement). */
  async closeIf(key: string, value: T) {
    const entry = this.entries.get(key);
    if (entry && (await entry.value.catch(() => undefined)) === value) await this.close(key);
  }

  async closeAll() {
    await Promise.all(this.keys().map((key) => this.close(key)));
  }

  private async evict() {
    if (this.entries.size < this.limit) return;
    const idle = [...this.entries].find(([, e]) => e.active === 0);
    if (idle) await this.close(idle[0]);
  }
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
