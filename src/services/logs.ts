import path from "node:path";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { DeviceService } from "./device.js";
import { StateStore } from "../core/store.js";
import { errorResult, invariant, ToolError } from "../core/errors.js";
import { faultlogNameSchema } from "../core/contracts.js";
import { currentTrace } from "../core/trace.js";
import { NativeDirectory } from "../core/native-directory.js";

import { faultlogTimestamp, faultlogBundle } from "./faultlog-format.js";
export { faultlogTimestamp, faultlogBundle } from "./faultlog-format.js";

const directory = "/data/log/faultlog/faultlogger";
const fileLimit = 256 * 1024;
const rejected =
  /(?:permission denied|no such file|unknown service|invalid service|^\s*(?:Invalid|Unknown|Mutlti commands))/im;
const hilogRejected =
  /^\s*(?:hilog:\s*(?:invalid|unknown|permission denied)|(?:Invalid|Unknown)\s+(?:argument|option|command)|Mutlti commands|Permission denied)/im;

export async function readLogFile(file: string): Promise<Buffer> {
  const handle = await fs.open(
    path.resolve(file),
    constants.O_RDONLY | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    invariant(
      before.isFile(),
      "LOG_FILE_INVALID",
      "Crash evidence must be a regular file",
    );
    invariant(
      before.size <= 8 * 1024 * 1024,
      "LOG_TOO_LARGE",
      "Crash evidence limit is 8 MiB",
    );
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    invariant(
      offset === before.size &&
        after.size === before.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      "LOG_CHANGED",
      "Crash evidence changed while being captured; submit it again",
    );
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export interface FaultlogQuery {
  bundle_name?: string;
  max_age_minutes?: number;
  limit?: number;
}
export class LogService {
  constructor(
    readonly devices: DeviceService,
    readonly store: StateStore,
  ) {}

  async probe(target: string, input: FaultlogQuery, signal?: AbortSignal) {
    const clock = await this.devices.shell(target, ["date", "+%s %z"], signal),
      match = /^(\d+)\s+([+-])(\d{2})(\d{2})$/.exec(clock.stdout.trim());
    invariant(
      !clock.truncated &&
        match &&
        Number(match[3]) <= 23 &&
        Number(match[4]) <= 59,
      "DEVICE_CLOCK_INVALID",
      "Cannot determine the device clock and timezone",
    );
    const now = Number(match[1]) * 1000,
      offsetMinutes =
        (Number(match[3]) * 60 + Number(match[4])) *
        (match[2] === "+" ? 1 : -1);
    invariant(
      Number.isSafeInteger(now) && !Number.isNaN(new Date(now).getTime()),
      "DEVICE_CLOCK_INVALID",
      "Device timestamp is invalid",
    );
    const commands = [
      ["ls", "-1", directory],
      ["hidumper", "-s", "1201", "-a", "-p Faultlogger %s -LogSuffixWithMs"],
    ];
    const listings = await Promise.allSettled(
      commands.map(async (args) => {
        const result = await this.devices.shell(target, args, signal);
        invariant(
          !rejected.test(result.stdout + result.stderr),
          "FAULTLOG_LIST_FAILED",
          "Device rejected faultlog listing",
        );
        return result;
      }),
    );
    signal?.throwIfAborted();
    const warnings: { source: string; code: string; message: string }[] = [],
      names = new Map<string, Set<string>>();
    let available = false,
      complete = true;
    for (const [index, result] of listings.entries()) {
      const source = index === 0 ? "directory" : "faultlogger";
      if (result.status === "rejected") {
        const error = errorResult(result.reason);
        warnings.push({ source, code: error.code, message: error.message });
        complete = false;
        continue;
      }
      available = true;
      if (result.value.truncated) {
        complete = false;
        warnings.push({
          source,
          code: "FAULTLOG_LIST_TRUNCATED",
          message: "Faultlog inventory was truncated",
        });
      }
      // Keep exact observed names, including extensionless names. Never synthesize a filename.
      for (const name of result.value.stdout.match(
        /(?:^|[\s/])((?:jscrash|cppcrash|appfreeze)-[A-Za-z0-9_.-]+)/gm,
      ) ?? []) {
        const file = name.trim().replace(/^\//, "");
        if (!faultlogNameSchema.safeParse(file).success) continue;
        if (!names.has(file)) names.set(file, new Set());
        names.get(file)!.add(source);
      }
    }
    if (!available)
      throw new ToolError(
        "FAULTLOG_UNAVAILABLE",
        "Neither device faultlog source is readable",
        { warnings },
      );
    const age = input.max_age_minutes ?? 30,
      candidates = [...names].map(([name, sources]) => ({
        name,
        timestamp: faultlogTimestamp(name, offsetMinutes),
        bundle_name: faultlogBundle(name),
        sources: [...sources],
      }));
    const matching = candidates
      .filter(
        (file) =>
          (!input.bundle_name || file.bundle_name === input.bundle_name) &&
          (age === 0 ||
            (file.timestamp !== null &&
              file.timestamp <= now &&
              now - file.timestamp <= age * 60000)),
      )
      .sort(
        (a, b) =>
          (b.timestamp ?? 0) - (a.timestamp ?? 0) ||
          a.name.localeCompare(b.name),
      );
    return {
      target,
      device_time: new Date(now).toISOString(),
      device_offset_minutes: offsetMinutes,
      max_age_minutes: age,
      complete,
      warnings,
      observed_count: candidates.length,
      matching_count: matching.length,
      unknown_timestamp_count: candidates.filter(
        (file) => file.timestamp === null,
      ).length,
      unknown_bundle_count: candidates.filter(
        (file) => file.bundle_name === null,
      ).length,
      files: matching.slice(0, input.limit ?? 10),
      has_more: matching.length > (input.limit ?? 10),
    };
  }

  private async readFaultlog(
    target: string,
    name: string,
    signal?: AbortSignal,
  ) {
    faultlogNameSchema.parse(name);
    const result = await this.devices.shell(
      target,
      ["head", "-c", String(fileLimit + 1), path.posix.join(directory, name)],
      signal,
      30000,
      true,
    );
    invariant(
      !result.truncated,
      "FAULTLOG_TRANSPORT_TRUNCATED",
      "Faultlog transport did not retain the complete bounded read",
    );
    if (
      (result.exitCode !== 0 ||
        /^head:/.test(result.stdout) ||
        result.stderr) &&
      /permission denied|operation not permitted/i.test(
        result.stdout + result.stderr,
      )
    )
      return this.receiveFaultlog(target, name, signal);
    invariant(
      result.exitCode === 0 &&
        !rejected.test(result.stderr) &&
        !/^head:/.test(result.stdout),
      "FAULTLOG_FETCH_FAILED",
      "Device rejected faultlog read",
    );
    const bytes = Buffer.from(result.stdout);
    return {
      name,
      read_method: "shell_head" as const,
      content: new TextDecoder().decode(bytes.subarray(0, fileLimit), {
        stream: bytes.length > fileLimit,
      }),
      truncated: bytes.length > fileLimit,
    };
  }
  private async receiveFaultlog(
    target: string,
    name: string,
    signal?: AbortSignal,
  ) {
    // On production devices shell cannot read the faultlogger directory, while
    // the supported HDC file service can. Fetch only the exact validated name.
    signal?.throwIfAborted();
    const scope = new NativeDirectory(this.store, 8 * 1024 * 1024);
    return scope.execute(async (managedSignal) => {
      const local = path.join(scope.file, "faultlog.txt");
      const result = await this.devices.command(
        ["-t", target, "file", "recv", path.posix.join(directory, name), local],
        managedSignal,
      );
      invariant(
        result.exitCode === 0 &&
          !result.truncated &&
          /FileTransfer finish/i.test(result.stdout) &&
          !/\[Fail\]|error:|permission denied/i.test(
            result.stdout + result.stderr,
          ),
        "FAULTLOG_FETCH_FAILED",
        "HDC did not confirm the requested faultlog transfer",
      );
      await scope.check();
      const handle = await fs.open(
        local,
        constants.O_RDONLY | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat();
        invariant(
          before.isFile(),
          "LOG_FILE_INVALID",
          "Transferred faultlog must be a regular file",
        );
        const bytes = Buffer.alloc(Math.min(before.size, fileLimit) + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(
            bytes,
            offset,
            bytes.length - offset,
            offset,
          );
          if (!bytesRead) break;
          offset += bytesRead;
        }
        const after = await handle.stat();
        invariant(
          before.size === after.size &&
            before.mtimeMs === after.mtimeMs &&
            offset === Math.min(before.size, bytes.length),
          "LOG_CHANGED",
          "Transferred faultlog changed while being read",
        );
        managedSignal.throwIfAborted();
        return {
          name,
          read_method: "hdc_file_recv" as const,
          content: new TextDecoder().decode(
            bytes.subarray(0, Math.min(offset, fileLimit)),
            {
              stream: before.size > fileLimit,
            },
          ),
          truncated: before.size > fileLimit,
        };
      } finally {
        await handle.close();
      }
    }, signal);
  }
  async fetch(target: string, name: string, signal?: AbortSignal) {
    const file = await this.readFaultlog(target, name, signal);
    return {
      ...this.report(target, "crash", file.content, file.truncated),
      faultlog_name: name,
      read_method: file.read_method,
    };
  }
  async clear(target: string, signal?: AbortSignal) {
    return this.store.lease(
      `device:${target}`,
      async () => {
        signal?.throwIfAborted();
        const result = await this.devices.shell(
          target,
          ["hilog", "-r"],
          signal,
        );
        invariant(
          !result.truncated &&
            !/permission denied|operation not permitted|not found|invalid (?:argument|option)|failed|failure/i.test(
              result.stdout + result.stderr,
            ),
          "HILOG_CLEAR_FAILED",
          "Device did not confirm Hilog clear",
        );
        return {
          target,
          cleared: true,
          scope: "device_hilog_app_core_buffers",
          concurrent_new_logs_possible: true,
        };
      },
      signal,
    );
  }
  async collect(
    target: string,
    input: {
      kind?: "hilog" | "crash";
      lines?: number;
      bundle_name?: string;
      contains?: string;
      max_age_minutes?: number;
    },
    signal?: AbortSignal,
  ) {
    if (input.kind === "crash") {
      const inventory = await this.probe(
        target,
        { ...input, limit: 5 },
        signal,
      );
      invariant(
        inventory.files.length,
        inventory.complete
          ? "CRASH_EVIDENCE_MISSING"
          : "CRASH_EVIDENCE_INCOMPLETE",
        "No matching recent faultlogs found in the available inventory",
      );
      const files = [];
      for (const file of inventory.files)
        files.push(await this.readFaultlog(target, file.name, signal));
      return {
        ...this.report(
          target,
          "crash",
          [...files]
            .reverse()
            .map((file) => `Source: ${file.name}\n${file.content}`)
            .join("\n\n"),
          files.some((file) => file.truncated),
          input.lines,
        ),
        inventory,
        selection_complete: inventory.complete && !inventory.has_more,
        files: files.map(({ name, truncated, read_method }) => ({
          name,
          truncated,
          read_method,
        })),
      };
    }
    const args = ["hilog", "-z", String(input.lines ?? 200)];
    if (input.bundle_name) {
      const pids = await this.devices.shell(
        target,
        ["pidof", input.bundle_name],
        signal,
        10000,
        true,
      );
      invariant(
        !pids.truncated && /^\d+(?:\s+\d+)*$/.test(pids.stdout.trim()),
        "APP_NOT_RUNNING",
        "No process found for log filtering",
      );
      args.push("-P", pids.stdout.trim().split(/\s+/).join(","));
    }
    const result = input.contains
      ? await this.filteredHilog(
          target,
          input.contains,
          input.lines ?? 200,
          args.slice(3),
          signal,
        )
      : await this.devices.shell(target, args, signal, 30000);
    invariant(
      !hilogRejected.test(result.stdout + result.stderr),
      "HILOG_FAILED",
      "Device rejected log query",
    );
    return this.report(
      target,
      "hilog",
      result.stdout,
      result.truncated,
      input.lines,
    );
  }
  private async filteredHilog(
    target: string,
    contains: string,
    lines: number,
    filters: string[],
    signal?: AbortSignal,
  ) {
    const marker = `__DEVECO_HILOG_${randomUUID().replaceAll("-", "")}__`;
    // Hilog's -e matches only the message, not tags. Filtering rendered lines preserves
    // literal matching semantics. Each producer reports its own status outside the pipe;
    // grep's no-match exit is distinct from a failed Hilog producer, and tail runs remotely.
    const script = `deveco_filter=$1; deveco_lines=$2; shift 2\n{ hilog -x "$@"; printf '\\n${marker}:hilog:%s\\n' "$?" >&2; } | { grep -F -- "$deveco_filter"; printf '\\n${marker}:grep:%s\\n' "$?" >&2; } | tail -n "$deveco_lines"`;
    const result = await this.devices.shell(
        target,
        [
          "sh",
          "-c",
          script,
          "deveco-hilog",
          contains,
          String(lines),
          ...filters,
        ],
        signal,
        30000,
      ),
      combined = result.stdout + "\n" + result.stderr;
    for (const stage of ["hilog", "grep"] as const) {
      const receipts = [
        ...combined.matchAll(
          new RegExp(`^${marker}:${stage}:(\\d+)\\r?$`, "gm"),
        ),
      ];
      invariant(
        receipts.length === 1,
        "HILOG_RECEIPT_MISSING",
        `The ${stage} stage did not return an unambiguous completion receipt`,
      );
      const code = Number(receipts[0]![1]);
      invariant(
        stage === "grep" ? code === 0 || code === 1 : code === 0,
        "HILOG_FAILED",
        `The ${stage} stage exited with ${code}`,
      );
    }
    const removeReceipts = (value: string) =>
      value
        .replace(new RegExp(`^${marker}:(?:hilog|grep):\\d+\\r?\\n?`, "gm"), "")
        .trim();
    return {
      ...result,
      stdout: removeReceipts(result.stdout),
      stderr: removeReceipts(result.stderr),
    };
  }
  private report(
    target: string,
    kind: "crash" | "hilog",
    content: string,
    truncated: boolean,
    lineLimit = 200,
  ) {
    const lines = content ? content.replace(/\r?\n$/, "").split(/\r?\n/) : [];
    return {
      target,
      kind,
      line_count: lines.length,
      excerpt: lines.slice(-Math.min(lineLimit, 200)).join("\n").slice(-16384),
      artifact: this.store.artifact(currentTrace().run_id ?? "logs", content),
      truncated,
    };
  }
}
