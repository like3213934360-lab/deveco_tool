import { digest } from "../core/files.js";
import { invariant } from "../core/errors.js";
import type { ProcessResult } from "../core/process.js";
import type { StateStore } from "../core/store.js";
import { currentTrace } from "../core/trace.js";

const prefix = "DEVECO_DEVICE_RECEIPT_V1";
const pending = "DEVECO_DEVICE_RECEIPT_PENDING";
const outputLimit = 65536;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export interface DeviceReceipt {
  exitCode: number;
  stdout: string;
}
interface Transport {
  shell(
    target: string,
    args: string[],
    signal?: AbortSignal,
    timeoutMs?: number,
    allowFailure?: boolean,
    sensitive?: boolean,
  ): Promise<ProcessResult>;
}

/** A fixed command receipt, not a general remote task service. The private directory
 * is claimed atomically before dispatch. An existing claim never repeats the command. */
export function deviceReceiptScripts(
  directory: string,
  identity: string,
  args: string[],
) {
  invariant(
    /^[a-f0-9]{64}$/.test(identity),
    "DEVICE_RECEIPT_ID",
    "Invalid receipt identity",
  );
  const dir = quote(directory);
  const read = `if [ ! -L ${dir} ] && [ -d ${dir} ] && [ ! -L ${dir}/receipt ] && [ -f ${dir}/receipt ]; then
  head -c ${outputLimit + 1024} ${dir}/receipt
else
  printf '%s\\n' '${pending}'
fi`;
  const execute = `umask 077
if mkdir -m 700 ${dir} 2>/dev/null; then
  (
    ${args.map(quote).join(" ")}
    printf '%s\\n' "$?" > ${dir}/exit
  ) 2>&1 | (head -c ${outputLimit}; cat > /dev/null) > ${dir}/output
  if [ -f ${dir}/exit ]; then
    (printf '%s\\n%s\\n' '${prefix}' '${identity}'; cat ${dir}/exit ${dir}/output) > ${dir}/receipt.tmp &&
      mv ${dir}/receipt.tmp ${dir}/receipt
  fi
fi
${read}`;
  return { execute, read };
}

export function parseDeviceReceipt(
  raw: ProcessResult,
  identity: string,
): DeviceReceipt | undefined {
  if (raw.truncated || raw.exitCode !== 0) return undefined;
  const match =
    /^DEVECO_DEVICE_RECEIPT_V1\r?\n([a-f0-9]{64})\r?\n(\d{1,3})\r?\n([\s\S]*)$/.exec(
      raw.stdout,
    );
  if (
    !match ||
    match[1] !== identity ||
    Number(match[2]) > 255 ||
    Buffer.byteLength(match[3]!) >= outputLimit
  )
    return undefined;
  return { exitCode: Number(match[2]), stdout: match[3]! };
}

export class DeviceEffectJournal {
  constructor(
    private readonly store: StateStore,
    private readonly transport: Transport,
  ) {}

  async run<T>(
    target: string,
    name: string,
    args: string[],
    accept: (receipt: DeviceReceipt) => T,
    signal?: AbortSignal,
    recovery = false,
  ): Promise<T | undefined> {
    const trace = currentTrace();
    invariant(
      trace.run_id && trace.node,
      "DEVICE_EFFECT_CONTEXT",
      "Durable device operations require a workflow node",
    );
    const runId = trace.run_id,
      node = `${trace.node}:device:${name}`;
    const input = { target, args },
      identity = digest({ runId, node, input });
    const directory = `/data/local/tmp/deveco-mcp-op-${digest({ state: this.store.root, runId, node, target })}`;
    const scripts = deviceReceiptScripts(directory, identity, args);
    const matches = (metadata: unknown) =>
      metadata !== null &&
      typeof metadata === "object" &&
      "identity" in metadata &&
      metadata.identity === identity &&
      "directory" in metadata &&
      metadata.directory === directory;
    const closeRecoveredGuards = () => {
      for (const row of this.store.externalGuards()) {
        if (
          row.run_id !== runId ||
          row.kind !== "device_receipt" ||
          !matches(JSON.parse(row.metadata) as unknown)
        )
          continue;
        this.store.recoverExternalSession(row.id, (kind, metadata) => {
          invariant(
            kind === "device_receipt" && matches(metadata),
            "DEVICE_RECEIPT_ID",
            "Device receipt guard changed",
          );
        });
      }
    };
    const read = async () => {
      const result = await this.transport.shell(
        target,
        ["sh", "-c", scripts.read],
        signal,
        10000,
        false,
        true,
      );
      const receipt = parseDeviceReceipt(result, identity);
      if (receipt) closeRecoveredGuards();
      return receipt ? accept(receipt) : undefined;
    };
    const value = recovery
      ? await this.store.recoverEffect(runId, node, input, read)
      : await this.store.effect(
          runId,
          node,
          input,
          async () => {
            const guard = this.store.trackExternalSession(
              "device_receipt",
              [`device:${target}`],
              { identity, directory },
            );
            let stopped = false;
            try {
              const result = await this.transport.shell(
                target,
                ["sh", "-c", scripts.execute],
                signal,
                30000,
                false,
                true,
              );
              const receipt = parseDeviceReceipt(result, identity);
              invariant(
                receipt,
                "DEVICE_RECEIPT_MISSING",
                "Device operation has no complete matching receipt",
              );
              guard.confirmClosed();
              stopped = true;
              return accept(receipt);
            } catch (error) {
              if (!stopped) guard.unconfirmed();
              throw error;
            }
          },
          read,
        );
    if (value !== undefined) {
      // SQLite FULL has committed the normalized receipt before remote cleanup.
      // Cleanup failure must not turn a confirmed mutation into an uncertain one.
      try {
        await this.transport.shell(
          target,
          ["rm", "-rf", directory],
          undefined,
          10000,
          false,
          true,
        );
      } catch {
        try {
          this.store.event(runId, "device_receipt_cleanup_pending", {
            target,
            directory,
          });
        } catch {
          /* Receipt remains durable. */
        }
      }
    }
    return value;
  }
}
