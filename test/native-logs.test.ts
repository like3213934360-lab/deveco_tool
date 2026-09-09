import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { StateStore } from "../src/core/store.js";
import { ProcessService, type ProcessResult } from "../src/core/process.js";
import { DeviceService } from "../src/services/device.js";
import {
  LogService,
  faultlogTimestamp,
  faultlogBundle,
  readLogFile,
} from "../src/services/logs.js";
import { parseCrash } from "../src/services/crash.js";
import { Runtime } from "../src/services/runtime.js";
import { tools, workflowInputs } from "../src/core/contracts.js";
import { ToolError } from "../src/core/errors.js";
import { withTrace } from "../src/core/trace.js";

function receipt(stdout: string, truncated = false): ProcessResult {
  return {
    stdout,
    stderr: "",
    truncated,
    exitCode: 0,
    signal: null,
    elapsedMs: 1,
    pid: 42,
  };
}
function fixture() {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-logs-")),
    ),
    store = new StateStore(root),
    devices = new DeviceService(new ProcessService(), store),
    logs = new LogService(devices, store);
  return {
    root,
    store,
    devices,
    logs,
    close: () => {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
const now = Date.UTC(2026, 8, 7, 4, 0, 0),
  recent = "jscrash-com.example.target-20010000-20260907115959001.log";
const readArtifact = (store: StateStore, id: string) => {
  const chunks: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const part = store.readArtifact(id, offset, 65536);
    chunks.push(Buffer.from(part.data, "base64"));
    if (part.next_offset >= part.bytes) break;
    offset = part.next_offset;
  }
  return Buffer.concat(chunks).toString("utf8");
};

test("faultlog timestamps honor the device timezone, calendar validity and epoch formats", () => {
  assert.equal(faultlogTimestamp(recent, 480), now - 999);
  assert.equal(
    faultlogTimestamp(
      recent.replace("20260907115959001", "20260907115959"),
      480,
    ),
    now - 1000,
  );
  assert.equal(faultlogTimestamp(`cppcrash-1122-${now}.log`, -330), now);
  assert.equal(faultlogTimestamp(`cppcrash-1122-${now / 1000}`, -330), now);
  for (const value of [
    "20260230120000",
    "20261307120000",
    "20260907240000",
    "20260907126000",
    "20260907125960",
  ])
    assert.equal(
      faultlogTimestamp(`jscrash-com.example.target-${value}.log`, 480),
      null,
    );
  assert.equal(faultlogBundle(recent), "com.example.target");
  assert.equal(faultlogBundle(`cppcrash-1122-${now}`), null);
});

test("faultlog probe filters exact bundles and age without falling back to unrelated evidence or inventing extensions", async (t) => {
  const f = fixture();
  try {
    const extensionless = recent.replace(".log", ""),
      expired = recent.replace("20260907115959001", "20260906120000000"),
      future = recent.replace("20260907115959001", "20260907120000001"),
      other = recent.replace("target", "target2"),
      calls: string[][] = [];
    t.mock.method(
      f.devices,
      "shell",
      async (_target: string, args: string[]) => {
        calls.push(args);
        return receipt(
          args[0] === "date"
            ? `${now / 1000} +0800`
            : [extensionless, recent, expired, future, other, recent].join(
                "\n",
              ),
        );
      },
    );
    const result = await f.logs.probe("test-device", {
      bundle_name: "com.example.target",
      max_age_minutes: 30,
    });
    assert.equal(result.device_time, "2026-09-07T04:00:00.000Z");
    assert.equal(result.complete, true);
    assert.deepEqual(
      new Set(result.files.map((file) => file.name)),
      new Set([recent, extensionless]),
    );
    assert.ok(
      calls.some((args) => args.includes("-p Faultlogger %s -LogSuffixWithMs")),
    );
    assert.equal(
      (
        await f.logs.probe("test-device", {
          bundle_name: "com.example.missing",
        })
      ).matching_count,
      0,
    );
    assert.equal(
      (
        await f.logs.probe("test-device", {
          bundle_name: "com.example.target",
          max_age_minutes: 0,
          limit: 1,
        })
      ).has_more,
      true,
    );
    assert.equal(
      (
        await f.logs.probe("test-device", {
          bundle_name: "com.example.target",
          max_age_minutes: 0,
        })
      ).files.length,
      4,
    );
  } finally {
    f.close();
  }
});

test("faultlog source failures, incomplete inventories, clock errors and cancellation remain explicit", async (t) => {
  const f = fixture();
  try {
    let mode = "partial";
    t.mock.method(
      f.devices,
      "shell",
      async (_target: string, args: string[]) => {
        if (args[0] === "date")
          return receipt(
            mode === "clock" ? "123 +2460" : `${now / 1000} +0800`,
          );
        if (mode === "both" || args[0] === "ls")
          throw new ToolError("HDC_REMOTE_FAILED", "Permission denied");
        return receipt(mode === "empty" ? "" : recent, mode === "truncated");
      },
    );
    const partial = await f.logs.probe("d", {});
    assert.equal(partial.files[0]?.name, recent);
    assert.equal(partial.complete, false);
    assert.equal(partial.warnings.length, 1);
    mode = "truncated";
    assert.equal((await f.logs.probe("d", {})).warnings.length, 2);
    mode = "empty";
    await assert.rejects(f.logs.collect("d", { kind: "crash" }), {
      code: "CRASH_EVIDENCE_INCOMPLETE",
    });
    mode = "both";
    await assert.rejects(f.logs.probe("d", {}), {
      code: "FAULTLOG_UNAVAILABLE",
    });
    mode = "clock";
    await assert.rejects(f.logs.probe("d", {}), {
      code: "DEVICE_CLOCK_INVALID",
    });
    mode = "partial";
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.logs.probe("d", {}, controller.signal), {
      name: "AbortError",
    });
  } finally {
    f.close();
  }
});

test("named faultlog reads are path-safe, bounded and preserve exact filenames and truncation", async (t) => {
  const f = fixture();
  try {
    const calls: string[][] = [];
    let truncated = false;
    t.mock.method(
      f.devices,
      "shell",
      async (_target: string, args: string[]) => {
        calls.push(args);
        return receipt("a".repeat(262145), truncated);
      },
    );
    const name = recent.replace(".log", ""),
      result = await f.logs.fetch("d", name);
    assert.equal(result.truncated, true);
    assert.equal(result.artifact.bytes, 262144);
    assert.deepEqual(calls[0], [
      "head",
      "-c",
      "262145",
      `/data/log/faultlog/faultlogger/${name}`,
    ]);
    for (const bad of [
      "../escape",
      "jscrash-x/../file",
      "jscrash-x;id",
      "-f",
      "unrelated.log",
    ])
      await assert.rejects(f.logs.fetch("d", bad));
    assert.equal(calls.length, 1);
    truncated = true;
    await assert.rejects(f.logs.fetch("d", name), {
      code: "FAULTLOG_TRANSPORT_TRUNCATED",
    });
  } finally {
    f.close();
  }
});

test("faultlog permission failures use the exact HDC file service name and clean bounded private transfer data", async (t) => {
  const f = fixture();
  try {
    const name = recent.replace(".log", ""),
      calls: string[][] = [];
    let mode = "success";
    t.mock.method(f.devices, "shell", async () => ({
      ...receipt("head: permission denied"),
      exitCode: 1,
    }));
    t.mock.method(f.devices, "command", async (args: string[]) => {
      calls.push(args);
      fs.writeFileSync(
        args.at(-1)!,
        mode === "long"
          ? "a".repeat(262145)
          : "TypeError: handler is not callable",
      );
      return receipt("FileTransfer finish, Size: 33");
    });
    const first = await f.logs.fetch("fixed-device", name);
    assert.equal(first.read_method, "hdc_file_recv");
    assert.equal(first.faultlog_name, name);
    assert.equal(first.truncated, false);
    assert.equal(
      readArtifact(f.store, first.artifact.artifact_id),
      "TypeError: handler is not callable",
    );
    assert.deepEqual(calls[0]!.slice(0, -1), [
      "-t",
      "fixed-device",
      "file",
      "recv",
      "/data/log/faultlog/faultlogger/" + name,
    ]);
    assert.ok(
      calls[0]!.at(-1)!.startsWith(path.join(f.root, "tmp") + path.sep),
    );
    assert.equal(fs.existsSync(calls[0]!.at(-1)!), false);
    mode = "long";
    const bounded = await f.logs.fetch("fixed-device", name);
    assert.equal(bounded.truncated, true);
    assert.equal(bounded.artifact.bytes, 262144);
    assert.deepEqual(
      f.store.db.prepare("SELECT id FROM native_directories").all(),
      [],
    );
  } finally {
    f.close();
  }
});

test("faultlog transfers reject failed receipts, oversized output and cancellation without keeping partial files", async (t) => {
  const f = fixture();
  try {
    let mode = "receipt";
    let transferred = 0;
    t.mock.method(f.devices, "shell", async () => ({
      ...receipt("head: permission denied"),
      exitCode: 1,
    }));
    t.mock.method(
      f.devices,
      "command",
      async (args: string[], signal?: AbortSignal) => {
        transferred++;
        const local = args.at(-1)!;
        fs.writeFileSync(local, "partial");
        if (mode === "oversized") fs.truncateSync(local, 8 * 1024 * 1024 + 1);
        if (mode === "cancel") {
          await new Promise<void>((_resolve, reject) => {
            signal!.addEventListener("abort", () => reject(signal!.reason), {
              once: true,
            });
          });
        }
        return receipt(
          mode === "receipt"
            ? "[Fail] Transfer incomplete"
            : "FileTransfer finish",
        );
      },
    );
    for (const [value, code] of [
      ["receipt", "FAULTLOG_FETCH_FAILED"],
      ["oversized", "NATIVE_DIRECTORY_CAPACITY"],
    ]) {
      mode = value!;
      await assert.rejects(f.logs.fetch("d", recent), { code });
      assert.deepEqual(
        f.store.db.prepare("SELECT id FROM native_directories").all(),
        [],
      );
      assert.deepEqual(fs.readdirSync(path.join(f.root, "tmp")), []);
    }
    mode = "cancel";
    const controller = new AbortController();
    const cancelled = assert.rejects(
      f.logs.fetch("d", recent, controller.signal),
      { name: "AbortError" },
    );
    const timer = setTimeout(() => controller.abort(), 30);
    try {
      await cancelled;
    } finally {
      clearTimeout(timer);
    }
    assert.equal(transferred, 3);
    assert.deepEqual(
      f.store.db.prepare("SELECT id FROM native_directories").all(),
      [],
    );
    assert.deepEqual(fs.readdirSync(path.join(f.root, "tmp")), []);
  } finally {
    f.close();
  }
});

test("faultlog missing files and broken head transports do not trigger a different read", async (t) => {
  const f = fixture();
  try {
    t.mock.method(f.devices, "command", async () => {
      throw new Error("Unexpected file transfer");
    });
    t.mock.method(f.devices, "shell", async () => ({
      ...receipt("head: no such file"),
      exitCode: 1,
    }));
    await assert.rejects(f.logs.fetch("d", recent), {
      code: "FAULTLOG_FETCH_FAILED",
    });
    t.mock.method(f.devices, "shell", async () =>
      receipt("head: permission denied", true),
    );
    await assert.rejects(f.logs.fetch("d", recent), {
      code: "FAULTLOG_TRANSPORT_TRUNCATED",
    });
  } finally {
    f.close();
  }
});

test("Hilog preserves ordinary application errors, pushes PID filters to the device and reports truncation", async (t) => {
  const f = fixture();
  try {
    const calls: string[][] = [];
    let mode = "success";
    t.mock.method(
      f.devices,
      "shell",
      async (_target: string, args: string[]) => {
        calls.push(args);
        return receipt(
          args[0] === "pidof"
            ? "12 34"
            : mode === "error"
              ? "Invalid option: -z"
              : "09-07 12:00:00.123 12 12 E App: no such file; permission denied",
          mode === "truncated",
        );
      },
    );
    const result = await f.logs.collect("d", {
      bundle_name: "com.example.target",
      lines: 4000,
    });
    assert.match(result.excerpt, /no such file/);
    assert.deepEqual(calls[1], ["hilog", "-z", "4000", "-P", "12,34"]);
    mode = "error";
    await assert.rejects(f.logs.collect("d", {}), { code: "HILOG_FAILED" });
    mode = "truncated";
    assert.equal((await f.logs.collect("d", {})).truncated, true);
  } finally {
    f.close();
  }
});

test("Hilog clear serializes with device operations, cancels while queued and checks device rejection", async (t) => {
  const f = fixture();
  try {
    let calls = 0,
      rejected = false,
      release: (() => void) | undefined;
    t.mock.method(
      f.devices,
      "shell",
      async (_target: string, args: string[]) => {
        calls++;
        assert.deepEqual(args, ["hilog", "-r"]);
        return receipt(rejected ? "Permission denied" : "Log buffer cleared");
      },
    );
    const held = f.store.lease(
      "device:d",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    while (!release) await delay(1);
    const controller = new AbortController(),
      pending = f.logs.clear("d", controller.signal),
      assertion = assert.rejects(pending, { name: "AbortError" });
    await delay(20);
    assert.equal(calls, 0);
    controller.abort();
    await assertion;
    release();
    await held;
    assert.equal((await f.logs.clear("d")).cleared, true);
    rejected = true;
    await assert.rejects(f.logs.clear("d"), { code: "HILOG_CLEAR_FAILED" });
  } finally {
    f.close();
  }
});

test("literal Hilog filters run before the device-side tail and require receipts from every producer", async (t) => {
  const f = fixture();
  try {
    const contains = "[DEBUG] '中文' $(echo unsafe)",
      calls: string[][] = [];
    let mode = "success";
    t.mock.method(
      f.devices,
      "shell",
      async (_target: string, args: string[]) => {
        calls.push(args);
        if (args[0] === "pidof") return receipt("12 34");
        const script = args[2]!,
          marker = /__DEVECO_HILOG_[a-f0-9]+__/.exec(script)![0];
        assert.equal(args[0], "sh");
        assert.equal(args[4], contains);
        assert.equal(args[5], "10");
        assert.ok(script.indexOf("grep -F") < script.indexOf("tail -n"));
        assert.doesNotMatch(script, /\[DEBUG\]|echo unsafe/);
        const result = receipt(
          `${mode === "success" ? `09-07 12:00:00.123 12 12 I ${contains}: value\n` : ""}${marker}:hilog:${mode === "producer_error" ? 7 : 0}\n${mode === "missing" ? "" : `${marker}:grep:${mode === "success" ? 0 : mode === "grep_error" ? 2 : 1}\n`}`,
        );
        return result;
      },
    );
    const result = await f.logs.collect("d", {
      contains,
      lines: 10,
      bundle_name: "com.example.target",
    });
    assert.deepEqual(calls[1]!.slice(6), ["-P", "12,34"]);
    assert.match(result.excerpt, /中文/);
    assert.doesNotMatch(result.excerpt, /__DEVECO_HILOG_/);
    mode = "empty";
    assert.equal(
      (await f.logs.collect("d", { contains, lines: 10 })).line_count,
      0,
    );
    mode = "producer_error";
    await assert.rejects(f.logs.collect("d", { contains, lines: 10 }), {
      code: "HILOG_FAILED",
    });
    mode = "grep_error";
    await assert.rejects(f.logs.collect("d", { contains, lines: 10 }), {
      code: "HILOG_FAILED",
    });
    mode = "missing";
    await assert.rejects(f.logs.collect("d", { contains, lines: 10 }), {
      code: "HILOG_RECEIPT_MISSING",
    });
  } finally {
    f.close();
  }
});

test("log contracts reject ignored fields, conflicting sources, traversal and oversized inline evidence", () => {
  for (const input of [
    { action: "clear", bundle_name: "com.example.target" },
    { action: "fetch" },
    { action: "fetch", faultlog_name: "../file" },
    { action: "probe", lines: 20 },
    { max_age_minutes: 10 },
  ])
    assert.equal(tools.hdc_log.schema.safeParse(input).success, false);
  for (const input of [
    { log_text: "a", log_file: "b" },
    { log_text: "a", target: "d" },
    { log_file: "a", kind: "hilog" },
    { kind: "hilog", max_age_minutes: 10 },
    { log_text: "汉".repeat(20000) },
  ])
    assert.equal(workflowInputs.crash_diagnose.safeParse(input).success, false);
  assert.equal(tools.hdc_log.schema.parse({}).action, "collect");
});

test("the literal filter pipeline preserves last matching lines and does not hide a failed producer behind successful tail", async (t) => {
  const f = fixture(),
    processes = new ProcessService(),
    shell =
      process.platform === "win32"
        ? path.join(
            process.env.ProgramFiles ?? "C:\\Program Files",
            "Git",
            "bin",
            "bash.exe",
          )
        : "/bin/sh";
  try {
    assert.ok(
      fs.existsSync(shell),
      "POSIX pipeline regression requires Git Bash on Windows",
    );
    let body =
        "[DEBUG] first\n" +
        "other\n".repeat(200) +
        "[DEBUG] second\n" +
        "other\n".repeat(200),
      exitCode = "0";
    t.mock.method(
      f.devices,
      "shell",
      async (_target: string, args: string[], signal?: AbortSignal) => {
        assert.equal(args[0], "sh");
        return processes.run(
          {
            executable: shell,
            args: [
              "-c",
              `hilog() { printf '%s\\n' "$DEVECO_TEST_LOG"; return "$DEVECO_TEST_EXIT"; }\n${args[2]!}`,
              ...args.slice(3),
            ],
            env: {
              ...process.env,
              DEVECO_TEST_LOG: body,
              DEVECO_TEST_EXIT: exitCode,
            },
          },
          { signal },
        );
      },
    );
    const result = await f.logs.collect("d", {
      contains: "[DEBUG]",
      lines: 2,
    });
    assert.equal(result.line_count, 2);
    assert.equal(
      readArtifact(f.store, result.artifact.artifact_id),
      "[DEBUG] first\n[DEBUG] second",
    );
    body = "no matching lines";
    assert.equal(
      (await f.logs.collect("d", { contains: "[DEBUG]", lines: 2 })).line_count,
      0,
    );
    exitCode = "7";
    await assert.rejects(
      f.logs.collect("d", { contains: "[DEBUG]", lines: 2 }),
      { code: "HILOG_FAILED" },
    );
  } finally {
    await processes.close();
    f.close();
  }
});

const first =
  "bundleName: com.example.first\nProcess name: com.example.first:worker\nError name: TypeError\nError message: first failure\nStacktrace:\nat run (pages/First.ets:7:3)";
const second =
  "bundleName: com.example.second\nError name: RangeError\nError message: second failure\nStacktrace:\nat run (pages/Second.ets:9:1)";
test("crash reports select one attributed event and preserve historic chatter, repeated-event and process filters", () => {
  for (const gap of ["\n", "\n" + "I App: normal operation\n".repeat(55)]) {
    const log = (first + gap + second).replaceAll("\n", "\r\n");
    assert.equal(parseCrash(log).kind, "RangeError");
    const selected = parseCrash(log, {
      bundle_name: "com.example.first",
      process_hint: "worker",
    });
    assert.equal(selected.kind, "TypeError");
    assert.equal(selected.error_message, "first failure");
    assert.match(selected.frames.join(), /First\.ets/);
    assert.doesNotMatch(selected.frames.join(), /Second\.ets/);
    assert.equal(selected.diagnosisComplete, false);
    assert.equal(
      parseCrash(log, { bundle_name: "com.example.missing" }).status,
      "no_crash_signature",
    );
  }
  const repeated = parseCrash(
    first + "\nRangeError: next failure\nat again (pages/Next.ets:9:1)",
    { bundle_name: "com.example.first" },
  );
  assert.equal(repeated.error_message, "next failure");
  assert.doesNotMatch(repeated.frames.join(), /First\.ets/);
  for (const text of [
    "I App: crash reporting initialized",
    "I Monitor: jscrash count: 0",
    "I App: TypeError handler installed",
    "normal operation",
    "09-07 12:00:00.000 1 1 I App: TypeError handler installed",
  ])
    assert.equal(parseCrash(text).status, "no_crash_signature");
  assert.equal(
    parseCrash("normal operation", { truncated: true }).status,
    "insufficient_evidence",
  );
  assert.equal(
    parseCrash("TypeError: failure\nat run (pages/Unknown.ets:1:1)", {
      bundle_name: "com.example.missing",
    }).status,
    "insufficient_evidence",
  );
});

test("crash parsing separates interleaved Hilog PIDs, native faults and file boundaries", () => {
  const line = (pid: number, text: string) =>
    `09-07 12:00:00.123 ${pid} ${pid} E App: ${text}`;
  const parsed = parseCrash(
    [
      line(11, "Process name: com.example.first"),
      line(22, "Process name: com.example.second"),
      line(11, "TypeError: first failure"),
      line(22, "RangeError: second failure"),
      line(11, "at first (First.ets:1:1)"),
      line(22, "at second (Second.ets:2:1)"),
    ].join("\n"),
    { bundle_name: "com.example.first" },
  );
  assert.equal(parsed.pid, "11");
  assert.deepEqual(parsed.frames, ["at first (First.ets:1:1)"]);
  const native = parseCrash(
    "Process name: com.example.native\nReason: Signal:SIGSEGV at 0\nFault thread info:\n#00 pc 001 function",
    { bundle_name: "com.example.native" },
  );
  assert.equal(native.kind, "NativeCrash");
  assert.equal(native.frames.length, 1);
  const files = parseCrash(
    `Source: ${recent}\nTypeError: first\nat first (First.ets:1:1)\nSource: cppcrash-1122-${now}.log\nRangeError: second\nat second (Second.ets:2:1)`,
    { bundle_name: "com.example.target" },
  );
  assert.equal(files.kind, "TypeError");
  assert.equal(files.unattributed_events, true);
  assert.equal(
    parseCrash("Reason: THREAD_BLOCK_6S\n", {
      faultlog_name: recent.replace("jscrash", "appfreeze"),
    }).kind,
    "AppFreeze",
  );
});

test("collected faultlogs select the latest event and their artifacts belong to the workflow", async (t) => {
  const f = fixture();
  try {
    const older = recent.replace("115959001", "115958001"),
      run = f.store.create("crash_diagnose", {}).run;
    t.mock.method(f.devices, "shell", async (_target: string, args: string[]) =>
      receipt(
        args[0] === "date"
          ? `${now / 1000} +0800`
          : args[0] === "head"
            ? `TypeError: ${args.at(-1)?.includes(older) ? "older" : "newer"}\nat run (Index.ets:1:1)`
            : [recent, older].join("\n"),
      ),
    );
    const result = await withTrace({ run_id: run.id }, () =>
      f.logs.collect("d", { kind: "crash", bundle_name: "com.example.target" }),
    );
    assert.equal(
      parseCrash(readArtifact(f.store, result.artifact.artifact_id))
        .error_message,
      "newer",
    );
    assert.deepEqual(
      f.store.db
        .prepare("SELECT run_id FROM artifacts WHERE id=?")
        .get(result.artifact.artifact_id),
      { run_id: run.id },
    );
  } finally {
    f.close();
  }
});

test("local crash submission snapshots bounded evidence, deduplicates and retains input without SDK or device access", async (t) => {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-crash-input-")),
    ),
    previous = process.env.DEVECO_STATE_DIR,
    previousConfig = process.env.DEVECO_CONFIG,
    config = path.join(root, "config.json");
  // Use no configured SDK; this also runs on CI hosts without Studio installed.
  fs.writeFileSync(config, "{}");
  process.env.DEVECO_CONFIG = config;
  process.env.DEVECO_STATE_DIR = path.join(root, "state");
  const runtime = new Runtime();
  try {
    t.mock.method(runtime.devices, "target", async () => {
      throw new Error("Local evidence must not access a device");
    });
    const file = path.join(root, "日志 中文.txt");
    fs.writeFileSync(file, first);
    const start = z.object({ run_id: z.string() }).parse(
      await runtime.call("workflow_run", {
        action: "start",
        workflow: "crash_diagnose",
        request_key: "snapshot",
        input: { log_file: file },
      }),
    );
    fs.writeFileSync(file, second);
    const input = runtime.store.get(start.run_id).input;
    assert.doesNotMatch(input, /log_file|first failure|second failure/);
    const captured = z
      .object({ input_artifacts: z.array(z.string()) })
      .parse(JSON.parse(input) as unknown).input_artifacts[0]!;
    assert.equal(readArtifact(runtime.store, captured), first);
    runtime.store.db
      .prepare("UPDATE artifacts SET created=0 WHERE id=?")
      .run(captured);
    runtime.store.prune();
    assert.equal(readArtifact(runtime.store, captured), first);
    assert.equal(
      z.object({ run_id: z.string() }).parse(
        await runtime.call("workflow_run", {
          action: "start",
          workflow: "crash_diagnose",
          request_key: "snapshot",
          input: { log_file: file },
        }),
      ).run_id,
      start.run_id,
    );
    let status: { status: string; result?: unknown } = { status: "queued" };
    for (
      let i = 0;
      i < 100 && ["queued", "running"].includes(status.status);
      i++
    )
      status = z
        .object({ status: z.string(), result: z.unknown().optional() })
        .parse(
          await runtime.call("workflow_run", {
            action: "status",
            run_id: start.run_id,
            wait_ms: 100,
          }),
        );
    assert.equal(status.status, "succeeded", JSON.stringify(status));
    assert.match(JSON.stringify(status.result), /TypeError/);
    assert.doesNotMatch(JSON.stringify(status.result), /RangeError/);
    const inline = z.object({ run_id: z.string() }).parse(
      await runtime.call("workflow_run", {
        action: "start",
        workflow: "crash_diagnose",
        input: { log_text: first },
      }),
    );
    assert.doesNotMatch(
      runtime.store.get(inline.run_id).input,
      /first failure|log_text/,
    );
    // The following live collection is mocked, but still captures a toolchain
    // identity. Give it its own fixture instead of relying on the developer SDK.
    fs.writeFileSync(config, JSON.stringify({ clt: path.join(root, "clt") }));
    fs.mkdirSync(path.join(root, "clt"));
    t.mock.method(runtime.devices, "target", async () => "device");
    let collected = false;
    t.mock.method(
      runtime.logs,
      "collect",
      async (_target: string, input: Parameters<LogService["collect"]>[1]) => {
        assert.equal(input.kind, "hilog");
        assert.equal(
          input.bundle_name,
          undefined,
          "A crashed process may no longer exist; filter crash events after collection",
        );
        collected = true;
        return {
          target: "device",
          kind: "hilog" as const,
          line_count: 1,
          excerpt: first,
          artifact: runtime.store.artifact("logs", first),
          truncated: true,
        };
      },
    );
    const live = z.object({ run_id: z.string() }).parse(
      await runtime.call("workflow_run", {
        action: "start",
        workflow: "crash_diagnose",
        input: {
          target: "device",
          kind: "hilog",
          bundle_name: "com.example.first",
        },
      }),
    );
    let liveStatus: { status: string; result?: unknown } = { status: "queued" };
    for (
      let i = 0;
      i < 100 && ["queued", "running"].includes(liveStatus.status);
      i++
    )
      liveStatus = z
        .object({ status: z.string(), result: z.unknown().optional() })
        .parse(
          await runtime.call("workflow_run", {
            action: "status",
            run_id: live.run_id,
            wait_ms: 100,
          }),
        );
    assert.equal(liveStatus.status, "succeeded", JSON.stringify(liveStatus));
    assert.equal(collected, true);
    assert.match(
      JSON.stringify(liveStatus.result),
      /"evidence_truncated":true/,
    );
    await assert.rejects(readLogFile(root), { code: "LOG_FILE_INVALID" });
    const large = path.join(root, "large.log");
    fs.writeFileSync(large, "");
    fs.truncateSync(large, 8 * 1024 * 1024 + 1);
    await assert.rejects(readLogFile(large), { code: "LOG_TOO_LARGE" });
  } finally {
    await runtime.close();
    if (previous === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = previous;
    if (previousConfig === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = previousConfig;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow evidence ownership is atomic and cannot adopt another run's artifact", () => {
  const f = fixture();
  try {
    const artifact = f.store.artifact("workflow-input", first),
      before = f.store.runCount();
    assert.throws(
      () =>
        f.store.create("crash_diagnose", {}, undefined, {}, [
          artifact.artifact_id,
          "missing",
        ]),
      { code: "WORKFLOW_EVIDENCE_MISSING" },
    );
    assert.equal(f.store.runCount(), before);
    assert.deepEqual(
      f.store.db
        .prepare("SELECT run_id FROM artifacts WHERE id=?")
        .get(artifact.artifact_id),
      { run_id: "workflow-input" },
    );
    const owner = f.store.create("crash_diagnose", {}, undefined, {}, [
      artifact.artifact_id,
    ]).run.id;
    assert.throws(
      () =>
        f.store.create("crash_diagnose", {}, undefined, {}, [
          artifact.artifact_id,
        ]),
      { code: "WORKFLOW_EVIDENCE_MISSING" },
    );
    assert.deepEqual(
      f.store.db
        .prepare("SELECT run_id FROM artifacts WHERE id=?")
        .get(artifact.artifact_id),
      { run_id: owner },
    );
  } finally {
    f.close();
  }
});
