import { AsyncLocalStorage } from "node:async_hooks";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { SerializerProtocol } from "@langchain/langgraph-checkpoint";
import { StateStore } from "./store.js";
import { invariant } from "./errors.js";

interface Reservation {
  active: boolean;
  reserve(bytes: number): Promise<void>;
}
/** The official saver owns encoding, SQL and recovery; this adapter only
 * reserves storage for the bytes its serializer is about to hand to SQLite. */
export class BoundedSqliteSaver extends SqliteSaver {
  private readonly reservations: AsyncLocalStorage<Reservation>;
  private readonly pageSize: number;
  constructor(
    readonly store: StateStore,
    serializer?: SerializerProtocol,
  ) {
    const reservations = new AsyncLocalStorage<Reservation>(),
      original = serializer ?? new SqliteSaver(store.db).serde,
      pageSize = store.db.pragma("page_size", { simple: true }) as number;
    super(store.db, {
      async dumpsTyped(value: unknown): Promise<[string, Uint8Array]> {
        const encoded = await original.dumpsTyped(value),
          scope = reservations.getStore();
        invariant(
          scope?.active,
          "CHECKPOINT_RESERVATION_MISSING",
          "Checkpoint serialization requires an active write reservation",
        );
        invariant(
          encoded[1].byteLength <= 512 * 1024,
          "CHECKPOINT_TOO_LARGE",
          "Serialized checkpoint value exceeds 512 KiB; retain large results as artifacts",
        );
        // Reserve main-file and WAL payload pages plus B-tree/index overhead.
        // Every serialized row contributes; a pending putWrites batch cannot
        // claim the same free bytes as another MCP or artifact producer.
        await scope.reserve(
          2 * Math.ceil(encoded[1].byteLength / pageSize) * pageSize +
            16 * pageSize,
        );
        return encoded;
      },
      async loadsTyped(
        type: string,
        value: Uint8Array | string,
      ): Promise<unknown> {
        return original.loadsTyped(type, value) as Promise<unknown>;
      },
    });
    this.reservations = reservations;
    this.pageSize = pageSize;
  }
  private async reserved<T>(
    thread: unknown,
    write: () => Promise<T>,
  ): Promise<T> {
    invariant(
      typeof thread === "string" && thread.length > 0,
      "CHECKPOINT_THREAD_REQUIRED",
      "Checkpoint write requires thread_id",
    );
    // Creation and the initial allocation are one synchronous transaction. No
    // SQLite transaction remains open while a third-party serializer awaits.
    const stream = this.store.db.transaction(() => {
      const stream = this.store.streamArtifact(
        thread,
        "application/x-checkpoint-reservation",
      );
      stream.reserve(16 * this.pageSize);
      return stream;
    }).immediate();
    let pendingBytes = 0, pending: Promise<void> | undefined;
    const scope: Reservation = {
      active: true,
      reserve(bytes) {
        pendingBytes += bytes;
        // The official saver serializes checkpoint/metadata and write batches
        // concurrently. Combine reservations ready in the same microtask turn;
        // every encoded value still waits for a durable cross-process charge
        // before the official saver can insert it. Later encodings form a new
        // batch; this does not depend on the saver's number of serializer calls.
        return (pending ??= Promise.resolve().then(() => {
          const bytes = pendingBytes;
          pendingBytes = 0;
          pending = undefined;
          stream.reserve(bytes);
        }));
      },
    };
    try {
      return await this.reservations.run(scope, write);
    } finally {
      scope.active = false;
      // This reservation never creates a file; restart also releases a dead
      // owner's missing stream. No encoded checkpoint is copied to an artifact.
      stream.discard();
    }
  }
  override put(...args: Parameters<SqliteSaver["put"]>) {
    return this.reserved(args[0].configurable?.thread_id, () =>
      super.put(...args),
    );
  }
  override putWrites(...args: Parameters<SqliteSaver["putWrites"]>) {
    return this.reserved(args[0].configurable?.thread_id, () =>
      super.putWrites(...args),
    );
  }
}
