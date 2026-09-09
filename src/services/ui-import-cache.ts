import { UiIndex } from "./ui-tree.js";
import type { parseUiDump } from "./ui-parse.js";
import { invariant } from "../core/errors.js";

type ParsedTree = ReturnType<typeof parseUiDump>;
interface Entry {
  parsed: ParsedTree;
  index: UiIndex;
  weight: number;
}
/** Content-addressed, read-through cache. Callers must read and hash the current
 * source before lookup; filenames, mtimes and artifact IDs are not identities. */
export class SavedUiTreeCache {
  private readonly entries = new Map<string, Entry>();
  private estimatedBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private timer?: NodeJS.Timeout;
  private closed = false;
  readonly limits = Object.freeze({
    entries: 2,
    estimated_bytes: 32 * 1024 * 1024,
    idle_ms: 60000,
  });

  get metrics() {
    return {
      entries: this.entries.size,
      estimated_bytes: this.estimatedBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      limits: this.limits,
    };
  }
  get(key: string) {
    invariant(!this.closed, "RUNTIME_STOPPING", "Saved UI cache is closing");
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return;
    }
    this.hits++;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.touch();
    return entry;
  }
  put(key: string, parsed: ParsedTree, index: UiIndex, inputBytes: number) {
    invariant(!this.closed, "RUNTIME_STOPPING", "Saved UI cache is closing");
    // Conservative accounting for nodes, rectangle/visibility records, up to four
    // lazy selector maps and UTF-16 strings. This is a budget, not a measured RSS.
    let weight = inputBytes + parsed.nodes.length * 1024;
    for (const node of parsed.nodes)
      for (const value of Object.values(node))
        if (typeof value === "string") weight += value.length * 2;
    if (weight > this.limits.estimated_bytes) return;
    this.remove(key);
    while (
      this.entries.size >= this.limits.entries ||
      this.estimatedBytes + weight > this.limits.estimated_bytes
    ) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    this.entries.set(key, { parsed, index, weight });
    this.estimatedBytes += weight;
    this.touch();
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.estimatedBytes -= entry.weight;
    this.evictions++;
  }
  private touch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.clear(), this.limits.idle_ms);
    this.timer.unref();
  }
  private clear() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.evictions += this.entries.size;
    this.entries.clear();
    this.estimatedBytes = 0;
  }
  close() {
    this.closed = true;
    this.clear();
  }
}
