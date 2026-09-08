import { digest } from "../core/files.js";
import { invariant, SettledEffectError } from "../core/errors.js";
import type { ProcessResult } from "../core/process.js";
import type { StateStore } from "../core/store.js";
import { currentTrace } from "../core/trace.js";

const prefix = "DEVECO_DEVICE_RECEIPT_V1";
const pending = "DEVECO_DEVICE_RECEIPT_PENDING";
const streamBegin = "DEVECO_DEVICE_STREAM_V1";
const streamEnd = "DEVECO_DEVICE_STREAM_END_V1";
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
  // Some shipped aa binaries suppress output when their stdout is redirected.
  // Keep the HDC stream intact, then publish the observed acknowledgement in a
  // second round trip. A lost stream leaves the claim pending, never replayable.
  const streamed = `umask 077
if mkdir -m 700 ${dir} 2>/dev/null; then
  printf '%s\\n%s\\n' '${streamBegin}' '${identity}'
  ${args.map(quote).join(" ")}
  result=$?
  printf '%s\\n' "$result" > ${dir}/exit
  printf '\\n%s\\n%s\\n%s\\n' '${streamEnd}' '${identity}' "$result"
fi
${read}`;
  return { execute: args[0] === "aa" ? streamed : execute, read };
}

export function parseStreamedDeviceReceipt(raw: ProcessResult, identity: string): DeviceReceipt | undefined {
  if (raw.truncated || raw.exitCode !== 0 || !/^[a-f0-9]{64}$/.test(identity)) return undefined;
  const match = new RegExp(`^${streamBegin}\\r?\\n${identity}\\r?\\n([\\s\\S]*)\\r?\\n${streamEnd}\\r?\\n${identity}\\r?\\n(\\d{1,3})\\r?\\n${pending}\\r?\\n$`).exec(raw.stdout);
  if (!match || Number(match[2]) > 255 || Buffer.byteLength(match[1]!) >= outputLimit) return undefined;
  return { exitCode: Number(match[2]), stdout: match[1]! };
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
    timeoutMs = 30000,
  ): Promise<T | undefined> {
    signal?.throwIfAborted();
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
    const settle = (receipt: DeviceReceipt) => {
      try {
        return accept(receipt);
      } catch (error) {
        throw SettledEffectError.from(error);
      }
    };
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
      return receipt ? settle(receipt) : undefined;
    };
    let value: T | undefined;
    try {
      value = recovery
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
                  timeoutMs,
                  false,
                  true,
                );
                let receipt = parseDeviceReceipt(result, identity);
                if (!receipt && args[0] === "aa") {
                  const streamed = parseStreamedDeviceReceipt(result, identity);
                  if (streamed) {
                    const bytes = `${prefix}\n${identity}\n${streamed.exitCode}\n${streamed.stdout}`;
                    const dir = quote(directory);
                    const publication = `test ! -L ${dir} && test -d ${dir} && test ! -e ${dir}/receipt && test ! -L ${dir}/receipt.tmp && test ! -e ${dir}/receipt.tmp && test ! -L ${dir}/exit && test "$(cat ${dir}/exit)" = '${streamed.exitCode}' && (set -C; printf '%s' '${Buffer.from(bytes).toString("base64")}' | base64 -d > ${dir}/receipt.tmp) && mv ${dir}/receipt.tmp ${dir}/receipt\n${scripts.read}`;
                    const published = await this.transport.shell(target, ["sh", "-c", publication], signal, 10000, false, true);
                    receipt = parseDeviceReceipt(published, identity);
                    invariant(receipt && receipt.exitCode === streamed.exitCode && receipt.stdout === streamed.stdout, "DEVICE_RECEIPT_MISSING", "Published device acknowledgement differs from the observed stream");
                  }
                }
                invariant(
                  receipt,
                  "DEVICE_RECEIPT_MISSING",
                  "Device operation has no complete matching receipt",
                );
                guard.confirmClosed();
                stopped = true;
                return settle(receipt);
              } catch (error) {
                if (!stopped) guard.unconfirmed();
                throw error;
              }
            },
            read,
          );
    } catch (error) {
      if (error instanceof SettledEffectError)
        await this.cleanup(target, directory, runId);
      throw error;
    }
    if (value !== undefined) await this.cleanup(target, directory, runId);
    return value;
  }
  private async cleanup(target: string, directory: string, runId: string) {
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
}
