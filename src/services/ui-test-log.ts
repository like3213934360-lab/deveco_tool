import { z } from "zod";
import { errorResult, invariant } from "../core/errors.js";
import type { StateStore } from "../core/store.js";
import { currentTrace } from "../core/trace.js";
import type { DeviceService } from "./device.js";

export const uiLogAnchorSchema = z.strictObject({
  device_epoch_ns: z.string().regex(/^\d{19}$/),
  host_started_at: z.number(),
  host_completed_at: z.number(),
  pids: z.array(z.string().regex(/^\d+$/)).max(5),
});
export const uiLogChunkSchema = z.strictObject({
  id: z.number().int().nonnegative(),
  step_id: z.string(),
  stage: z.string(),
  status: z.enum(["captured", "unavailable"]),
  start: uiLogAnchorSchema.optional(),
  end: uiLogAnchorSchema.optional(),
  artifact_id: z.string().uuid().optional(),
  bytes: z.number().optional(),
  line_count: z.number().optional(),
  skipped_lines: z.number().optional(),
  truncated: z.boolean().optional(),
  code: z.string().optional(),
  complete: z.literal(false),
});
export type UiLogAnchor = z.infer<typeof uiLogAnchorSchema>;
export type UiLogChunk = z.infer<typeof uiLogChunkSchema>;

export function epochNanoseconds(value: string): bigint {
  const match = /^(\d{10})\.(\d{1,9})$/.exec(value);
  invariant(
    match,
    "UI_TEST_CLOCK_UNSUPPORTED",
    "Device must return an unambiguous epoch timestamp with fractional seconds",
  );
  return BigInt(match[1]!) * 1_000_000_000n + BigInt(match[2]!.padEnd(9, "0"));
}
/** Hilog renders epoch timestamps before pid/tid. Unknown lines are excluded,
 * not attributed to an app merely because they followed one matching line. */
export function selectTestLog(
  content: string,
  start: UiLogAnchor,
  end: UiLogAnchor,
) {
  const pids = new Set([...start.pids, ...end.pids]),
    low = BigInt(start.device_epoch_ns),
    high = BigInt(end.device_epoch_ns);
  invariant(
    high >= low,
    "UI_TEST_CLOCK_CHANGED",
    "Device wall clock moved backwards; this interval cannot be attributed safely",
  );
  const selected: string[] = [];
  let skipped = 0;
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    const prefix = /^\s*(\d{10}\.\d{1,9})\s+(\d+)\s+(\d+)\s+/.exec(line);
    if (!prefix) {
      skipped++;
      continue;
    }
    const at = epochNanoseconds(prefix[1]!);
    if (at > low && at <= high && pids.has(prefix[2]!)) selected.push(line);
    else skipped++;
  }
  return {
    content: selected.join("\n") + (selected.length ? "\n" : ""),
    line_count: selected.length,
    skipped_lines: skipped,
  };
}

export class UiTestLogService {
  constructor(
    readonly store: StateStore,
    readonly devices: DeviceService,
  ) {}
  async anchor(
    target: string,
    bundle: string,
    signal: AbortSignal,
  ): Promise<UiLogAnchor> {
    const started = Date.now();
    const clock = await this.devices.shell(
      target,
      ["date", "+%s.%N"],
      signal,
      10000,
      true,
      true,
    );
    invariant(
      clock.exitCode === 0 && !clock.truncated && !clock.stderr.trim(),
      "UI_TEST_CLOCK_UNSUPPORTED",
      "Device clock query failed",
    );
    const nanos = epochNanoseconds(clock.stdout.trim());
    const result = await this.devices.shell(
      target,
      ["pidof", bundle],
      signal,
      10000,
      true,
      true,
    );
    invariant(
      !result.truncated &&
        !result.stderr.trim() &&
        (!result.stdout.trim() ||
          /^\d+(?:\s+\d+)*$/.test(result.stdout.trim())),
      "UI_TEST_LOG_PID_UNAVAILABLE",
      "Cannot identify this application's processes for bounded log collection",
    );
    const pids = result.stdout.trim() ? result.stdout.trim().split(/\s+/) : [];
    return uiLogAnchorSchema.parse({
      device_epoch_ns: String(nanos),
      host_started_at: started,
      host_completed_at: Date.now(),
      pids,
    });
  }
  async capture(
    target: string,
    bundle: string,
    start: UiLogAnchor | undefined,
    id: number,
    step: string,
    stage: string,
    signal: AbortSignal,
  ): Promise<{ chunk: UiLogChunk; anchor?: UiLogAnchor }> {
    let end: UiLogAnchor | undefined;
    try {
      end = await this.anchor(target, bundle, signal);
      invariant(
        start,
        "UI_TEST_LOG_START_MISSING",
        "No reliable previous device time anchor; collection begins at this sample",
      );
      const elapsed =
        Number(BigInt(end.device_epoch_ns) - BigInt(start.device_epoch_ns)) /
        1e6;
      const minimum = end.host_started_at - start.host_completed_at - 2000,
        maximum = end.host_completed_at - start.host_started_at + 2000;
      invariant(
        elapsed >= 0 && elapsed >= minimum && elapsed <= maximum,
        "UI_TEST_CLOCK_CHANGED",
        "Device and host elapsed times diverged; do not merge this interval into test logs",
      );
      const pids = [...new Set([...start.pids, ...end.pids])];
      invariant(
        pids.length > 0 && pids.length <= 5,
        "UI_TEST_LOG_PID_UNAVAILABLE",
        "A test log query requires 1-5 sampled application PIDs",
      );
      const result = await this.devices.shell(
        target,
        [
          "hilog",
          "-z",
          "2000",
          "-v",
          "epoch",
          "-v",
          "usec",
          "-P",
          pids.join(","),
        ],
        signal,
        30000,
        true,
        true,
      );
      invariant(
        result.exitCode === 0 &&
          !result.stderr.trim() &&
          (!result.stdout.trim() ||
            /^\s*\d{10}\.\d{1,9}\s+\d+\s+\d+\s+/m.test(result.stdout)),
        "UI_TEST_LOG_UNSUPPORTED",
        "Device rejected the bounded epoch/PID Hilog query",
      );
      const selected = selectTestLog(result.stdout, start, end);
      invariant(
        Buffer.byteLength(selected.content) <= 1024 * 1024,
        "UI_TEST_LOG_BUDGET",
        "One bounded test-log interval cannot exceed 1 MiB",
      );
      const artifact = this.store.artifact(
        currentTrace().run_id!,
        selected.content,
        "text/plain",
      );
      return {
        anchor: end,
        chunk: {
          id,
          step_id: step,
          stage,
          status: "captured",
          start,
          end,
          artifact_id: artifact.artifact_id,
          bytes: artifact.bytes,
          line_count: selected.line_count,
          skipped_lines: selected.skipped_lines,
          truncated: result.truncated,
          complete: false,
        },
      };
    } catch (error) {
      signal.throwIfAborted();
      return {
        ...(end ? { anchor: end } : {}),
        chunk: {
          id,
          step_id: step,
          stage,
          status: "unavailable",
          ...(start ? { start } : {}),
          ...(end ? { end } : {}),
          code: errorResult(error).code,
          complete: false,
        },
      };
    }
  }
}
