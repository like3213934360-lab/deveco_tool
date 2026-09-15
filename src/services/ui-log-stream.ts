import { z } from "zod";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { invariant, ToolError, errorResult } from "../core/errors.js";
import { discoverToolchain, toolCommand } from "../core/toolchain.js";
import { epochNanoseconds } from "./ui-test-log.js";
import type { DeviceService } from "./device.js";

export interface LogIdentity {
  epoch_ns: string;
  uid?: string;
  host_start: number;
  host_end: number;
  /** PID -> Linux /proc/PID/stat starttime, never PID alone. */
  processes: Record<string, string>;
}
export interface LogTransport {
  identify(signal: AbortSignal): Promise<LogIdentity>;
  stream(
    pids: string[],
    signal: AbortSignal,
    hooks: {
      output(chunk: Buffer): void;
      pause(controls: { pause(): void; resume(): void }): void;
    },
  ): Promise<void>;
}
export function processGeneration(stat: string): [string, string] {
  const match = /^(\d+) \(.*\) (\S(?:.*))$/.exec(stat.trim());
  invariant(
    match,
    "UI_LOG_IDENTITY_INVALID",
    "Invalid process identity response",
  );
  const fields = match[2]!.split(/\s+/),
    start = fields[19];
  invariant(
    start && /^\d+$/.test(start),
    "UI_LOG_IDENTITY_INVALID",
    "Process start time is missing",
  );
  return [match[1]!, start];
}
export function sameGeneration(a: LogIdentity, b: LogIdentity) {
  const keys = Object.keys(a.processes).sort();
  return (
    a.uid === b.uid &&
    keys.join(",") === Object.keys(b.processes).sort().join(",") &&
    keys.every((key) => a.processes[key] === b.processes[key])
  );
}
export function continuousClock(a: LogIdentity, b: LogIdentity) {
  const elapsed = Number(BigInt(b.epoch_ns) - BigInt(a.epoch_ns)) / 1e6;
  return (
    elapsed >= 0 &&
    elapsed >= b.host_start - a.host_end - 1000 &&
    elapsed <= b.host_end - a.host_start + 1000
  );
}
export function deviceLogTransport(
  devices: DeviceService,
  target: string,
  bundle: string,
): LogTransport {
  invariant(
    /^[A-Za-z0-9_.]+$/.test(bundle),
    "UI_LOG_BUNDLE_INVALID",
    "Invalid application identifier",
  );
  return {
    async identify(signal) {
      const started = Date.now();
      const metadata = await devices.shell(
        target,
        ["bm", "dump", "-n", bundle],
        signal,
        3000,
        true,
        true,
      );
      invariant(
        metadata.exitCode === 0 &&
          !metadata.truncated &&
          !metadata.stderr.trim(),
        "UI_LOG_UID_UNAVAILABLE",
        "Application UID could not be verified",
      );
      const start = metadata.stdout.indexOf("{");
      let raw: unknown;
      try {
        raw = JSON.parse(metadata.stdout.slice(start));
      } catch {
        throw new ToolError(
          "UI_LOG_UID_UNAVAILABLE",
          "Package manager returned an invalid application identity",
        );
      }
      const info = z
        .object({
          applicationInfo: z.object({
            bundleName: z.literal(bundle),
            uid: z.number().int().min(10000),
          }),
        })
        .safeParse(raw);
      invariant(
        info.success,
        "UI_LOG_UID_UNAVAILABLE",
        "Continuous collection requires this application's distinct non-system UID",
      );
      const uid = String(info.data.applicationInfo.uid);
      // List only numeric PID/UID metadata, never command lines. Include native
      // child processes and extension names that an exact pidof bundle misses.
      const inventory = await devices.shell(
        target,
        ["ps", "-A", "-o", "PID,UID"],
        signal,
        3000,
        true,
        true,
      );
      invariant(
        inventory.exitCode === 0 &&
          !inventory.truncated &&
          !inventory.stderr.trim(),
        "UI_LOG_PID_UNAVAILABLE",
        "Complete application process inventory is unavailable",
      );
      const rows = inventory.stdout.trim().split(/\r?\n/);
      invariant(
        /^\s*PID\s+UID\s*$/.test(rows.shift() ?? ""),
        "UI_LOG_PID_UNAVAILABLE",
        "Process inventory does not declare numeric PID/UID columns",
      );
      const expected: string[] = [];
      for (const row of rows) {
        const pair = /^\s*(\d+)\s+(\d+)\s*$/.exec(row);
        invariant(
          pair,
          "UI_LOG_PID_UNAVAILABLE",
          "Process inventory contains an unsupported entry",
        );
        if (pair[2] === uid) expected.push(pair[1]!);
      }
      invariant(
        expected.length <= 5,
        "UI_LOG_PID_BUDGET",
        "Continuous capture supports at most five simultaneously observed application UID processes",
      );
      const result = await devices.shell(
        target,
        [
          "sh",
          "-c",
          "date +%s.%N; " +
            (expected.length
              ? expected
                  .map((pid) => `cat /proc/${pid}/stat || exit 1`)
                  .join("; ")
              : ":"),
        ],
        signal,
        3000,
        true,
        true,
      );
      invariant(
        result.exitCode === 0 && !result.truncated && !result.stderr.trim(),
        "UI_LOG_IDENTITY_UNAVAILABLE",
        "Application process generations could not be verified",
      );
      const lines = result.stdout.trim().split(/\r?\n/),
        epoch = epochNanoseconds(lines.shift() ?? "");
      const processes = Object.fromEntries(
        lines.filter(Boolean).map(processGeneration),
      );
      invariant(
        Object.keys(processes).length === expected.length &&
          expected.every((pid) => processes[pid]),
        "UI_LOG_IDENTITY_CHANGED",
        "Application processes changed during identification",
      );
      return {
        epoch_ns: String(epoch),
        host_start: started,
        host_end: Date.now(),
        processes,
        uid,
      };
    },
    async stream(pids, signal, hooks) {
      invariant(
        pids.length > 0 &&
          pids.length <= 5 &&
          pids.every((pid) => /^\d+$/.test(pid)),
        "UI_LOG_PID_INVALID",
        "Continuous capture requires validated application PIDs",
      );
      // No -z/-x: Hilog remains attached. Never clear or alter global buffers.
      await devices.processes.run(
        {
          ...toolCommand(discoverToolchain(), "hdc", [
            "-t",
            target,
            "shell",
            "hilog",
            "-v",
            "epoch",
            "-v",
            "nsec",
            "-P",
            pids.join(","),
          ]),
          sensitive: true,
        },
        {
          signal,
          timeoutMs: null,
          limitBytes: 0,
          onSpawn: (child) =>
            hooks.pause({
              pause: () => {
                child.stdout?.pause();
              },
              resume: () => {
                child.stdout?.resume();
              },
            }),
          onOutput: (stream, chunk) => {
            if (stream === "stdout") hooks.output(chunk);
            else if (chunk.toString("utf8").trim())
              throw new ToolError(
                "UI_LOG_STREAM_ERROR",
                "Log transport reported an error; raw output was withheld",
              );
          },
        },
      );
    },
  };
}

export interface LogBatch {
  uid?: string;
  content: string;
  lines: number;
  start_ns: string;
  end_ns: string;
  sha256: string;
  skipped: number;
  processes: Record<string, string>;
}
export interface CollectorHooks {
  batch(batch: LogBatch): void;
  gap(
    code: string,
    details: { discarded_bytes?: number; from_ns?: string; to_ns?: string },
  ): void;
  ready(identity: LogIdentity, first: string): void;
}
/** Holds output in quarantine until process generation is checked again. This
 * also supplies real pipe backpressure rather than an unbounded promise queue. */
export class LogStreamCollector {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private fragment = "";
  private lines: string[] = [];
  private bytes = 0;
  private skipped = 0;
  private first?: string;
  private last?: string;
  private controls?: { pause(): void; resume(): void };
  private paused = false;
  private wake?: () => void;
  private terminal?: string;
  private checkpoints: (() => void)[] = [];
  private secrets: string[] = [];
  private readonly maxPending = 512 * 1024;
  private readonly pauseAt = 128 * 1024;
  constructor(
    readonly transport: LogTransport,
    readonly hooks: CollectorHooks,
    readonly pollMs = 1000,
  ) {}
  redact(values: string[]) {
    const secrets = [
      ...new Set(
        [...this.secrets, ...values]
          .flatMap((value) => [value, ...value.split(/\r?\n/)])
          .filter(Boolean),
      ),
    ].sort((a, b) => b.length - a.length);
    invariant(secrets.length <= 4096 && secrets.reduce((bytes, value) => bytes + Buffer.byteLength(value), 0) <= 8 * 1024 * 1024,
      "UI_LOG_REDACTION_BUDGET", "Continuous log redaction exceeded its bounded input budget");
    this.secrets = secrets;
  }
  async checkpoint() {
    // A bounded observation fence, not a claim that the OS emitted every log.
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.checkpoints = this.checkpoints.filter((item) => item !== done);
        resolve();
      };
      const timer = setTimeout(done, 3500);
      this.checkpoints.push(done);
      this.wake?.();
    });
  }
  private receive(chunk: Buffer, identity: LogIdentity, low: bigint) {
    invariant(
      chunk.length + this.bytes + Buffer.byteLength(this.fragment) <=
        this.maxPending,
      "UI_LOG_MEMORY_BUDGET",
      "Continuous log quarantine exceeded its bounded memory budget",
    );
    let decoded: string;
    try {
      decoded = this.decoder.decode(chunk, { stream: true });
    } catch {
      throw new ToolError(
        "UI_LOG_UTF8_INVALID",
        "Invalid UTF-8 was withheld from test logs",
      );
    }
    this.fragment += decoded;
    let newline: number;
    while ((newline = this.fragment.indexOf("\n")) >= 0) {
      const line = this.fragment.slice(0, newline).replace(/\r$/, "");
      this.fragment = this.fragment.slice(newline + 1);
      invariant(
        Buffer.byteLength(line) <= 65536,
        "UI_LOG_LINE_BUDGET",
        "A continuous log line exceeded 64 KiB",
      );
      if (!line) continue;
      const prefix = /^\s*(\d{10}\.\d{1,9})\s+(\d+)\s+\d+\s+/.exec(line);
      if (!prefix) {
        this.skipped++;
        this.hooks.gap("unattributed_or_system_notice", {});
        continue;
      }
      const at = epochNanoseconds(prefix[1]!);
      // Excluding the entire old timestamp boundary avoids duplicate ring-buffer
      // replay after a reconnect; the reconnect boundary is explicitly a gap.
      if (!identity.processes[prefix[2]!] || at <= low) {
        this.skipped++;
        continue;
      }
      // Different Hilog writers may arrive out of order within this interval.
      this.first =
        !this.first || at < BigInt(this.first) ? String(at) : this.first;
      this.last = !this.last || at > BigInt(this.last) ? String(at) : this.last;
      this.lines.push(line);
      this.bytes += Buffer.byteLength(line) + 1;
    }
    invariant(
      Buffer.byteLength(this.fragment) <= 65536,
      "UI_LOG_LINE_BUDGET",
      "An unterminated log line exceeded 64 KiB",
    );
    if (this.bytes >= this.pauseAt && !this.paused) {
      this.paused = true;
      this.controls?.pause();
      this.wake?.();
    }
  }
  private clear() {
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    this.lines = [];
    this.bytes = 0;
    this.fragment = "";
    this.first = undefined;
    this.last = undefined;
    this.skipped = 0;
  }
  private flush(identity: LogIdentity, end: LogIdentity) {
    if (!sameGeneration(identity, end))
      throw new ToolError(
        "UI_LOG_PROCESS_CHANGED",
        "Application generation changed; pending output cannot be attributed safely",
      );
    if (
      !continuousClock(identity, end) ||
      (this.last && BigInt(this.last) > BigInt(end.epoch_ns))
    )
      throw new ToolError(
        "UI_LOG_CLOCK_CHANGED",
        "Device clock or stream range could not be verified",
      );
    if (this.lines.length) {
      let content = this.lines.join("\n") + "\n";
      for (const secret of this.secrets)
        content = content.replaceAll(secret, "[redacted]");
      this.hooks.batch({
        content,
        lines: this.lines.length,
        start_ns: this.first!,
        end_ns: this.last!,
        sha256: createHash("sha256").update(content).digest("hex"),
        skipped: this.skipped,
        processes: identity.processes,
        ...(identity.uid ? { uid: identity.uid } : {}),
      });
      this.hooks.ready(identity, this.first!);
    }
    this.lines = [];
    this.bytes = 0;
    this.first = undefined;
    this.skipped = 0;
    this.last = undefined;
    // Keep partial UTF-8 until this exact stream ends.
    if (this.paused) {
      this.paused = false;
      this.controls?.resume();
    }
  }
  async run(signal: AbortSignal) {
    while (!signal.aborted && !this.terminal) {
      let identity: LogIdentity | undefined,
        stop: AbortController | undefined,
        stream: Promise<void> | undefined;
      let discardedReported = false;
      try {
        identity = await this.transport.identify(signal);
        if (!Object.keys(identity.processes).length) {
          this.hooks.gap("application_not_running", {
            from_ns: identity.epoch_ns,
          });
          await delay(this.pollMs, undefined, { signal });
          continue;
        }
        this.hooks.gap("capture_registration_boundary", {
          to_ns: identity.epoch_ns,
        });
        stop = new AbortController();
        const streamSignal = AbortSignal.any([signal, stop.signal]);
        let ended = false,
          streamError: unknown;
        this.clear();
        const low = BigInt(identity.epoch_ns),
          initial = identity;
        stream = this.transport
          .stream(Object.keys(identity.processes), streamSignal, {
            output: (chunk) => this.receive(chunk, initial, low),
            pause: (controls) => {
              this.controls = controls;
              if (this.paused) controls.pause();
            },
          })
          .then(
            () => {
              ended = true;
              this.wake?.();
            },
            (error) => {
              streamError = error;
              ended = true;
              this.wake?.();
            },
          );
        while (!signal.aborted && !ended) {
          await new Promise<void>((resolve) => {
            let timer: NodeJS.Timeout;
            const done = () => {
              clearTimeout(timer);
              signal.removeEventListener("abort", done);
              this.wake = undefined;
              resolve();
            };
            this.wake = done;
            timer = setTimeout(done, this.paused ? 0 : this.pollMs);
            signal.addEventListener("abort", done, { once: true });
            if (signal.aborted) done();
          });
          if (signal.aborted || ended) break;
          // Freeze receipt before sampling the device clock. Otherwise Hilog
          // may deliver newer lines while the asynchronous identity request is
          // returning, falsely making a healthy stream look like a clock jump.
          // Buffered pipe data stays unread until this generation is verified.
          if (!this.paused) {
            this.paused = true;
            this.controls?.pause();
          }
          const end = await this.transport.identify(signal);
          if (ended) break;
          this.flush(identity, end);
          identity = end;
          for (const done of [...this.checkpoints]) done();
        }
        if (signal.aborted) break;
        throw (
          streamError ??
          new ToolError(
            "UI_LOG_STREAM_ENDED",
            "Continuous Hilog transport ended before the test",
          )
        );
      } catch (error) {
        if (!signal.aborted) {
          const code =
            error instanceof Error &&
            "code" in error &&
            ["ENOSPC", "SQLITE_FULL", "EIO"].includes(String(error.code))
              ? String(error.code)
              : errorResult(error).code;
          this.hooks.gap(code, {
            discarded_bytes: this.bytes + Buffer.byteLength(this.fragment),
            ...(identity ? { from_ns: identity.epoch_ns } : {}),
          });
          discardedReported = true;
          if (
            [
              "UI_LOG_MEMORY_BUDGET",
              "UI_LOG_LINE_BUDGET",
              "UI_LOG_DISK_BUDGET",
              "UI_LOG_CHUNK_BUDGET",
              "STATE_CAPACITY",
              "ENOSPC",
              "SQLITE_FULL",
              "EIO",
            ].includes(code)
          )
            this.terminal = code;
        }
      } finally {
        stop?.abort(new ToolError("CANCELLED", "Log capture stopped"));
        await stream;
        if (this.bytes || this.fragment)
          this.hooks.gap("unverified_tail_discarded", {
            discarded_bytes: discardedReported ? 0 : this.bytes + Buffer.byteLength(this.fragment),
          });
        this.clear();
        this.controls = undefined;
        this.paused = false;
        for (const done of [...this.checkpoints]) done();
      }
      if (!signal.aborted && !this.terminal)
        await delay(this.pollMs, undefined, { signal }).catch(() => {});
    }
    return this.terminal;
  }
}
