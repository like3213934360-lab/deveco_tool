import { setTimeout as delay } from "node:timers/promises";
import { ToolError } from "./errors.js";

/** Per MCP connection; retain only bounded cursor metadata, never artifact bytes.
 * Allow ordinary rereads, but stop tight loops (including empty first pages).
 * Rejected reads yield before replying so a sequential caller ignoring errors
 * cannot replace a successful-response flood with a fast error flood. */
export class ArtifactReadGuard {
  private readonly reads = new Map<string, { count: number; last: number }>();
  constructor(private readonly now = () => performance.now()) {}

  async check(name: string, input: unknown, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (name !== "workflow_run" || !input || typeof input !== "object") return;
    const page = input as Record<string, unknown>;
    if (page.action !== "read_artifact" || page.as === "image" ||
        typeof page.artifact_id !== "string" || typeof page.offset !== "number") return;
    // Changing the page size must not disguise a stationary cursor.
    const key = `${page.artifact_id}:${page.offset}`, now = this.now();
    const previous = this.reads.get(key);
    const entry = previous && now - previous.last < 10000 ? previous : { count: 0, last: now };
    entry.last = now;
    this.reads.delete(key);
    if (this.reads.size >= 128) this.reads.delete(this.reads.keys().next().value!);
    this.reads.set(key, entry);
    if (entry.count < 8) {
      entry.count++;
      return;
    }
    await delay(250, undefined, { signal });
    throw new ToolError("ARTIFACT_READ_LOOP", "Repeated artifact offset without progress. Stop this loop; use eof or next_offset >= bytes to end pagination.", {
      artifact_id: page.artifact_id, offset: page.offset,
    });
  }
}
