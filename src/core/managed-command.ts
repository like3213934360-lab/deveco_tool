import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { StateStore } from "./store.js";
import {
  ProcessService,
  type Command,
  type ProcessOptions,
  type ProcessResult,
} from "./process.js";
import { currentTrace } from "./trace.js";
import { digest, fileDigest } from "./files.js";
import {
  errorResult,
  invariant,
  SettledEffectError,
  ToolError,
} from "./errors.js";

const evidenceSchema = z.strictObject({
  file: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const receiptSchema = z.strictObject({
  value: z.unknown(),
  files: z.array(evidenceSchema).max(10000),
});
const referenceSchema = z.strictObject({
  artifact_id: z.string().uuid(),
  bytes: z
    .number()
    .int()
    .nonnegative()
    .max(8 * 1024 * 1024),
});
type Options = Pick<
  ProcessOptions,
  "signal" | "timeoutMs" | "onOutput" | "limitBytes"
>;

/** Domain completion is committed while ProcessService still owns the completed
 * command. Recovery consumes that receipt and verifies its files; it never
 * infers completion from old output files or repeats an unacknowledged command. */
export class ManagedCommand {
  constructor(
    readonly store: StateStore,
    readonly processes: ProcessService,
  ) {}

  async run<T>(
    name: string,
    command: Command,
    options: Options,
    collect: (result: ProcessResult) => T | Promise<T>,
    decode: (value: unknown) => T,
    files: (value: T) => readonly string[],
    mapFailure: (error: ToolError) => ToolError = (error) => error,
  ): Promise<T> {
    const trace = currentTrace();
    invariant(
      trace.run_id && trace.node,
      "COMMAND_CONTEXT_MISSING",
      "Durable commands require a workflow node",
    );
    const runId = trace.run_id,
      node = `${trace.node}:command:${name}`,
      completed = `${node}:completion`,
      input = { command_hash: digest(command) };
    let value: T | undefined;
    const recover = async (): Promise<T | undefined> => {
      const stored = await this.store.recoverEffect<unknown>(
        runId,
        completed,
        input,
      );
      if (stored === undefined) return undefined;
      const saved = receiptSchema.parse(this.unpack(stored));
      for (const entry of saved.files) {
        let valid = false;
        try {
          const stat = fs.lstatSync(entry.file);
          valid =
            stat.isFile() &&
            !stat.isSymbolicLink() &&
            stat.size === entry.bytes &&
            fileDigest(entry.file) === entry.sha256;
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ))
            throw error;
        }
        if (!valid)
          throw new SettledEffectError(
            "COMMAND_OUTPUT_CHANGED",
            "Completed command output changed; start a new run",
            { file: entry.file },
          );
      }
      return decode(saved.value);
    };
    await this.store.effect(
      runId,
      node,
      input,
      async () => {
        await this.processes.run(command, {
          ...options,
          onSettled: async (result, failure) => {
            await this.store.effect(runId, completed, input, async () => {
              if (failure || result.exitCode !== 0 || result.signal) {
                const error = failure
                  ? errorResult(failure)
                  : {
                      code: "PROCESS_FAILED",
                      message: `Tool exited with ${result.signal ?? result.exitCode}`,
                    };
                throw SettledEffectError.from(
                  mapFailure(
                    new ToolError(error.code, error.message, {
                      execution: this.pack(runId, result),
                    }),
                  ),
                );
              }
              try {
                const collected = decode(await collect(result));
                const evidence = files(collected).map((file) => {
                  invariant(
                    path.isAbsolute(file),
                    "COMMAND_OUTPUT_INVALID",
                    "Command evidence must have an absolute path",
                  );
                  const stat = fs.lstatSync(file);
                  invariant(
                    stat.isFile() && !stat.isSymbolicLink(),
                    "COMMAND_OUTPUT_INVALID",
                    "Command evidence must be a regular file",
                  );
                  const sha256 = fileDigest(file),
                    after = fs.lstatSync(file);
                  invariant(
                    stat.size === after.size &&
                      stat.mtimeMs === after.mtimeMs &&
                      stat.ctimeMs === after.ctimeMs,
                    "COMMAND_OUTPUT_CHANGED",
                    "Command output changed while recording completion",
                  );
                  return { file, bytes: stat.size, sha256 };
                });
                const packed = this.pack(
                  runId,
                  receiptSchema.parse({ value: collected, files: evidence }),
                );
                value = collected;
                return packed;
              } catch (error) {
                throw SettledEffectError.from(error);
              }
            });
          },
        });
        invariant(
          value !== undefined,
          "COMMAND_RECEIPT_MISSING",
          "Command exited without a durable completion record",
        );
        return { completed: true };
      },
      async () => {
        value = await recover();
        return value === undefined ? undefined : { completed: true };
      },
    );
    // A phase may have completed before the enclosing LangGraph node. Verify
    // output identity even when the phase itself already has a local receipt.
    const verified = value ?? (await recover());
    invariant(
      verified !== undefined,
      "COMMAND_RECEIPT_MISSING",
      "Completed command record is missing",
    );
    return verified;
  }

  private pack(runId: string, value: unknown): unknown {
    const json = JSON.stringify(value);
    invariant(
      typeof json === "string",
      "COMMAND_RECEIPT_INVALID",
      "Command completion must be serializable",
    );
    invariant(
      Buffer.byteLength(json) <= 8 * 1024 * 1024,
      "COMMAND_RECEIPT_TOO_LARGE",
      "Command completion exceeds its result limit",
    );
    return Buffer.byteLength(json) <= 16384
      ? { value }
      : { reference: this.store.artifact(runId, json, "application/json") };
  }
  private unpack(raw: unknown): unknown {
    const data = z
      .union([
        z.strictObject({ value: z.unknown() }),
        z.strictObject({
          reference: referenceSchema.extend({ mime: z.string() }),
        }),
      ])
      .parse(raw);
    if ("value" in data) return data.value;
    const parts: Buffer[] = [];
    let offset = 0;
    do {
      const part = this.store.readArtifact(
        data.reference.artifact_id,
        offset,
        65536,
      );
      invariant(
        part.bytes === data.reference.bytes,
        "COMMAND_RECEIPT_CHANGED",
        "Command receipt size changed",
      );
      parts.push(Buffer.from(part.data, "base64"));
      offset = part.next_offset;
    } while (offset < data.reference.bytes);
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
  }
}
