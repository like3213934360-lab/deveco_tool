import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  LogStreamCollector,
  processGeneration,
  type LogIdentity,
  type LogBatch,
  type LogTransport,
} from "../src/services/ui-log-stream.js";
import { ToolError } from "../src/core/errors.js";

const base = 1789000000000000000n;
function identity(at = 0, generation = "123", pids = ["42"]): LogIdentity {
  return {
    epoch_ns: String(base + BigInt(at) * 1000000n),
    host_start: at,
    host_end: at,
    processes: Object.fromEntries(pids.map((pid) => [pid, generation])),
  };
}
function line(index: number, content = `序号 ${index} 中文🙂`, pid = "42") {
  const ns = base + BigInt(index + 1);
  return `${ns / 1000000000n}.${String(ns % 1000000000n).padStart(9, "0")} ${pid} ${pid} I App: ${content}\n`;
}
async function until(predicate: () => boolean, timeout = 3000) {
  const start = Date.now();
  while (!predicate()) {
    assert.ok(Date.now() - start < timeout, "condition timed out");
    await delay(5);
  }
}
async function scenario(options: {
  buffers: Buffer[];
  next?: () => LogIdentity;
  batch?: (batch: LogBatch) => void;
  secrets?: string[];
  finish?: boolean;
}) {
  const controller = new AbortController(),
    batches: LogBatch[] = [],
    gaps: string[] = [];
  let samples = 0,
    pauses = 0,
    resumes = 0,
    settled = 0,
    streams = 0,
    ready = 0,
    emitted = false;
  const transport: LogTransport = {
    identify: async () =>
      samples++ === 0 ? identity() : (options.next?.() ?? identity(100)),
    async stream(_pids, signal, hooks) {
      streams++;
      let paused = false;
      hooks.pause({
        pause: () => {
          paused = true;
          pauses++;
        },
        resume: () => {
          paused = false;
          resumes++;
        },
      });
      try {
        if (!emitted) {
          emitted = true;
          for (const buffer of options.buffers) {
            while (paused && !signal.aborted) await delay(1);
            if (signal.aborted) break;
            hooks.output(buffer);
            await delay(0);
          }
        }
        if (!options.finish)
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else
              signal.addEventListener("abort", () => resolve(), { once: true });
          });
      } finally {
        settled++;
      }
    },
  };
  const collector = new LogStreamCollector(
    transport,
    {
      batch: (batch) => {
        options.batch?.(batch);
        batches.push(batch);
      },
      gap: (code) => {
        gaps.push(code);
      },
      ready: () => {
        ready++;
      },
    },
    5,
  );
  collector.redact(options.secrets ?? []);
  const done = collector.run(controller.signal);
  return {
    batches,
    gaps,
    collector,
    stats: () => ({ pauses, resumes, settled, streams, ready }),
    close: async () => {
      controller.abort();
      await done;
    },
    done,
  };
}

test("continuous capture retains more than 2000 UTF-8 lines, applies backpressure and excludes other PIDs", async () => {
  const bytes = Buffer.from(
    Array.from({ length: 6000 }, (_, i) => line(i)).join("") +
      line(7000, "OTHER PRIVATE APP", "99"),
  );
  const buffers = [];
  // Deliberately split Chinese characters and emoji across transport chunks.
  for (let offset = 0; offset < bytes.length; offset += 8191)
    buffers.push(bytes.subarray(offset, offset + 8191));
  const h = await scenario({ buffers });
  try {
    await until(
      () => h.batches.reduce((sum, batch) => sum + batch.lines, 0) === 6000,
    );
    const content = h.batches.map((batch) => batch.content).join("");
    assert.equal(content.match(/序号 /g)?.length, 6000);
    assert.match(content, /5999 中文🙂/);
    assert.doesNotMatch(content, /OTHER|�/);
    // Normal batches are bounded even when the producer exceeds the old ring query.
    assert.ok(
      h.batches.every(
        (batch) => Buffer.byteLength(batch.content) <= 512 * 1024,
      ),
    );
    assert.ok(h.stats().ready > 0);
  } finally {
    await h.close();
  }
  assert.equal(h.stats().settled, h.stats().streams);
});

test("a burst pauses its pipe and resumes only after a second generation check", async () => {
  const h = await scenario({
    buffers: [
      Buffer.from(Array.from({ length: 4000 }, (_, i) => line(i)).join("")),
    ],
  });
  try {
    await until(() => h.batches.length > 0);
    assert.equal(h.stats().pauses, 1);
    assert.equal(h.stats().resumes, 1);
    assert.equal(h.batches[0]!.lines, 4000);
  } finally {
    await h.close();
  }
});

test("PID reuse and clock jumps discard quarantined output instead of attributing it to the app", async () => {
  for (const [next, code] of [
    [() => identity(100, "999"), "UI_LOG_PROCESS_CHANGED"],
    [
      () => ({ ...identity(100), epoch_ns: String(base - 1n) }),
      "UI_LOG_CLOCK_CHANGED",
    ],
    [
      () => ({ ...identity(100), epoch_ns: String(base + 100000000000n) }),
      "UI_LOG_CLOCK_CHANGED",
    ],
    [
      () => ({ ...identity(100), epoch_ns: String(base + 1n) }),
      "UI_LOG_CLOCK_CHANGED",
    ],
  ] as const) {
    const h = await scenario({
      buffers: [Buffer.from(line(1, "MUST NOT RETAIN"))],
      next,
    });
    try {
      await until(() => h.gaps.includes(code));
      assert.equal(h.batches.length, 0);
    } finally {
      await h.close();
    }
  }
});

test("a clock observation freezes pipe receipt until its earlier timestamp is verified", async () => {
  const controller = new AbortController(),
    batches: LogBatch[] = [],
    gaps: string[] = [];
  let samples = 0,
    paused = false,
    pending = false,
    emitted = false;
  let output: ((chunk: Buffer) => void) | undefined;
  const later = Buffer.from(line(149999999, "arrived after the clock sample"));
  const transport: LogTransport = {
    async identify() {
      const sample = identity(samples++ * 100);
      if (samples === 2) {
        // The remote clock has already been read, but its HDC response is
        // still in flight. Concurrent log traffic is newer than that sample.
        await delay(2);
        if (paused) pending = true;
        else output!(later);
      }
      return sample;
    },
    async stream(_pids, signal, hooks) {
      assert.equal(emitted, false, "A healthy stream must not reconnect");
      emitted = true;
      output = hooks.output;
      hooks.pause({
        pause() {
          paused = true;
        },
        resume() {
          paused = false;
          if (pending) {
            pending = false;
            hooks.output(later);
          }
        },
      });
      hooks.output(Buffer.from(line(49999999, "before the clock sample")));
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
  };
  const collector = new LogStreamCollector(
    transport,
    {
      batch: (batch) => {
        batches.push(batch);
      },
      gap: (code) => {
        gaps.push(code);
      },
      ready() {},
    },
    5,
  );
  const done = collector.run(controller.signal);
  try {
    await until(
      () => batches.reduce((sum, batch) => sum + batch.lines, 0) === 2,
    );
    assert.deepEqual(
      batches.map((batch) => batch.lines),
      [1, 1],
    );
    assert.match(batches[0]!.content, /before the clock sample/);
    assert.match(batches[1]!.content, /arrived after the clock sample/);
    assert.deepEqual(gaps, ["capture_registration_boundary"]);
  } finally {
    controller.abort();
    await done;
  }
});

test("invalid UTF-8, unterminated oversized lines, disk failures and disconnects expose gaps and join their transports", async () => {
  for (const [buffers, batch, finish, code] of [
    [[Buffer.from([0xff, 0xfe])], undefined, false, "UI_LOG_UTF8_INVALID"],
    [[Buffer.alloc(65537, 65)], undefined, false, "UI_LOG_LINE_BUDGET"],
    [
      [Buffer.from(line(1))],
      () => {
        throw Object.assign(new Error("secret must not appear"), {
          code: "ENOSPC",
        });
      },
      false,
      "ENOSPC",
    ],
    [[Buffer.from(line(1))], undefined, true, "UI_LOG_STREAM_ENDED"],
  ] as const) {
    const h = await scenario({ buffers: [...buffers], batch, finish });
    try {
      await until(() => h.gaps.includes(code));
      assert.equal(h.batches.length, 0);
    } finally {
      await h.close();
    }
    assert.equal(h.stats().settled, h.stats().streams);
    assert.ok(h.gaps.every((gap) => !gap.includes("secret")));
  }
});

test("redaction precedes persistence and duplicate content in one stream remains distinct evidence", async () => {
  const value = "机密🙂值",
    row = line(1, value);
  const h = await scenario({
    buffers: [Buffer.from(row + row)],
    secrets: [value],
  });
  try {
    await until(() => h.batches.length > 0);
    assert.equal(h.batches[0]!.lines, 2);
    assert.doesNotMatch(h.batches[0]!.content, /机密/);
    assert.equal(h.batches[0]!.content.match(/\[redacted\]/g)?.length, 2);
    await h.collector.checkpoint();
  } finally {
    await h.close();
  }
});

test("Linux process names with parentheses cannot shift the start-time field", () => {
  const fields = ["S", ...Array(18).fill("0"), "999", "123"];
  assert.deepEqual(
    processGeneration(`42 (name ) with spaces) ${fields.join(" ")}`),
    ["42", "999"],
  );
  assert.throws(() => processGeneration("42 (app) S 1"), {
    code: "UI_LOG_IDENTITY_INVALID",
  });
});

test("device identity includes same-UID child processes and refuses shared system UIDs or partial inventories", async () => {
  const { deviceLogTransport } =
    await import("../src/services/ui-log-stream.js");
  type Device = Parameters<typeof deviceLogTransport>[0];
  const bundle = "com.test.owned",
    queries: string[][] = [];
  let uid = 12345,
    partial = false;
  const stat = (pid: number) =>
    `${pid} (native child) S ${Array(18).fill("0").join(" ")} 999 1`;
  const devices = {
    async shell(
      _target: string,
      args: string[],
      _signal: AbortSignal,
      _timeout: number,
      _allowFailure: boolean,
      sensitive: boolean,
    ) {
      assert.equal(sensitive, true);
      queries.push(args);
      const stdout =
        args[0] === "bm"
          ? `${bundle}:\n${JSON.stringify({ applicationInfo: { bundleName: bundle, uid } })}`
          : args[0] === "ps"
            ? "PID UID\n42 12345\n43 12345\n99 98765\n"
            : `1789000000.123456789\n${stat(42)}\n${stat(43)}\n`;
      return {
        exitCode: 0,
        stdout,
        stderr: "",
        truncated: partial && args[0] === "ps",
      };
    },
  } as unknown as Device;
  const transport = deviceLogTransport(devices, "owned", bundle);
  const identity = await transport.identify(new AbortController().signal);
  assert.deepEqual(identity.processes, { "42": "999", "43": "999" });
  assert.equal(identity.uid, "12345");
  assert.match(queries.at(-1)![2]!, /\/proc\/43\/stat/);
  assert.doesNotMatch(queries.at(-1)![2]!, /\/proc\/99\//);
  uid = 1000;
  await assert.rejects(transport.identify(new AbortController().signal), {
    code: "UI_LOG_UID_UNAVAILABLE",
  });
  uid = 12345;
  partial = true;
  await assert.rejects(transport.identify(new AbortController().signal), {
    code: "UI_LOG_PID_UNAVAILABLE",
  });
});
