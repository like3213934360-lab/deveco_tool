import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resourceRoot } from "../src/core/config.js";
import { parseCrash } from "../src/services/crash.js";
import { rankCrashFrames } from "../src/services/crash-frames.js";
import {
  compileCrashReference,
  matchCrashPatterns,
  type CrashSignature,
} from "../src/services/crash-patterns.js";
import { KnowledgeService } from "../src/services/knowledge.js";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { AuthService } from "../src/services/auth.js";
import { CpuPool } from "../src/core/cpu-pool.js";

const referenceRoot = path.join(resourceRoot, "knowledge/arkts-runtime-fix");
const reference = (name: string) =>
  fs.readFileSync(path.join(referenceRoot, name + ".md"), "utf8");
const patterns = fs
  .readdirSync(referenceRoot)
  .flatMap((file) =>
    compileCrashReference(
      "arkts-runtime-fix/" + file.replace(/\.md$/, ""),
      fs.readFileSync(path.join(referenceRoot, file), "utf8"),
    ),
  );
function signature(
  kind: string,
  message: string | null,
  code: string | null = null,
): CrashSignature {
  return {
    status: "detected",
    kind,
    error_message: message,
    error_code: code,
    selection_complete: true,
  };
}

test("crash locations rank application evidence above framework and dependency frames without rewriting the stack", () => {
  const frames = [
    "at invoke (/system/framework/runtime.js:70:3)",
    "at helper (oh_modules/vendor/entry/src/main/ets/pages/Helper.ets:2:1)",
    "at callback (entry/src/main/ets/system/Index.ets:31:9)",
    "at build (entry/src/main/ets/pages/Home.ets:52:7)",
  ];
  const parsed = parseCrash(
    [
      "Process name: com.example.app",
      "TypeError: Cannot load property of null or undefined",
      ...frames,
    ].join("\n"),
  );
  assert.deepEqual(parsed.frames, frames);
  assert.equal(parsed.suspected_file, "entry/src/main/ets/pages/Home.ets");
  assert.equal(parsed.suspected_location?.line, 52);
  assert.equal(parsed.suspected_location?.column, 7);
  assert.equal(parsed.suspected_location?.stack_index, 3);
  assert.equal(parsed.suspected_location?.file_verified, false);
  assert.equal(
    parsed.ranked_frames.find((f) => f.stack_index === 2)?.classification,
    "application_candidate",
  );
  assert.equal(
    parsed.ranked_frames.find((f) => f.stack_index === 1)?.classification,
    "dependency",
  );
  const dependencyOnly = parseCrash("TypeError: failure\n" + frames[0]);
  assert.equal(dependencyOnly.suspected_location, null);
  assert.equal(
    dependencyOnly.next_action,
    "inspect_stack_or_collect_symbolized_evidence",
  );
  assert.equal(parsed.diagnosisComplete, false);
});

test("crash locations preserve Unicode, Windows paths, spaces and source coordinates while rejecting unusable locations", () => {
  const paths = [
    "at run (C:\\工程 (验收)\\entry\\src\\页面.ts:9:4)",
    "onclick@entry/src/中文 页面.ets:10:2",
    "at /tmp/a (b)/entry/src/main.ets:11",
    "at run (file:///project/entry/src/main.ets:12:5)",
  ];
  const ranked = rankCrashFrames(paths, null);
  assert.equal(ranked.length, 4);
  for (const [index, frame] of paths.entries()) {
    const location = ranked.find((item) => item.raw === frame)!;
    assert.equal(location.line, index + 9);
    assert.equal(location.column, [4, 2, null, 5][index]);
    assert.equal(location.file_verified, false);
  }
  assert.deepEqual(
    rankCrashFrames(
      [
        "at run (Index.ets:0:3)",
        "at run (Index.ets:1:0)",
        "at run (Index.ets:9007199254740993:1)",
        "at run (Index.ets:2147483648:1)",
        "at run (Bad\u0000.ets:1:1)",
        "#00 pc 001 native_function",
        "at <anonymous>",
      ],
      null,
    ),
    [],
  );
});

test("crash metadata includes code and HybridStack, and repeated headers preserve the same event", () => {
  const parsed = parseCrash(
    [
      "Process name: com.example.app",
      "Reason: BusinessError",
      "Error name: BusinessError",
      "Error message: Parameter error",
      "Error code: 401",
      "HybridStack:",
      "at run (entry/src/main/ets/pages/Index.ets:20:3)",
    ].join("\n"),
  );
  assert.equal(parsed.kind, "BusinessError");
  assert.equal(parsed.error_code, "401");
  assert.equal(parsed.error_message, "Parameter error");
  assert.equal(parsed.event_count, 1);
  assert.equal(parsed.suspected_location?.line, 20);
  const typed = parseCrash(
    "Error type: ReferenceError\nError message: absent is not defined\nat run (Index.ets:1:2)",
  );
  assert.equal(typed.kind, "ReferenceError");
  assert.equal(typed.suspected_file, "Index.ets");
});

test("modern packaged and hybrid frames survive SourceMap notices, and appended HiLog cannot replace the fault report", () => {
  const log = [
    "Process name: com.example.target",
    "Reason: TypeError",
    "Error name: TypeError",
    "Error message: handler is not callable",
    "Stacktrace:",
    "Cannot get SourceMap info, dump raw stack:",
    "    at callback (com.example.target|entry|1.0.0|src/main/ets/pages/Index.ets:25:9)",
    "HybridStack:",
    "#00 pc 001 /system/lib64/libark.so",
    "#01 at callback (com.example.target|entry|1.0.0|src/main/ets/pages/Index.ets:25:9)",
    "HiLog:",
    "09-08 12:00:00.123 22 22 E App: RangeError: older buffered error",
    "09-08 12:00:00.124 22 22 E App: at other (entry/src/pages/Other.ets:7:3)",
  ].join("\n");
  const parsed = parseCrash(log);
  assert.equal(parsed.kind, "TypeError");
  assert.equal(parsed.event_count, 1);
  assert.equal(parsed.frames.length, 3);
  assert.equal(parsed.ranked_frames.length, 2);
  assert.equal(parsed.suspected_file, "src/main/ets/pages/Index.ets");
  assert.equal(parsed.suspected_location?.frame_bundle, "com.example.target");
  assert.equal(parsed.suspected_location?.module, "entry");
  assert.equal(parsed.suspected_location?.version, "1.0.0");
  assert.equal(parsed.source_map_status, "unavailable");
  assert.doesNotMatch(JSON.stringify(parsed), /RangeError|Other\.ets/);
  const next = parseCrash(
    log +
      "\nSource: jscrash-com.example.next-1788854400.log\nReason: RangeError\nError message: next fault",
  );
  assert.equal(next.kind, "RangeError");
  assert.equal(next.event_count, 2);
});

test("long chatter cannot displace crash evidence and every bounded diagnostic field marks incomplete selection", () => {
  const prelude = "I App: normal operation\n".repeat(200);
  const parsed = parseCrash(
    prelude +
      [
        "TypeError: handler is not callable",
        "at run (entry/src/Index.ets:7:1)",
      ].join("\n"),
  );
  assert.ok(parsed.excerpt.some((line) => line.startsWith("TypeError:")));
  assert.ok(parsed.excerpt.length <= 32);
  assert.equal(parsed.selection_complete, true);
  for (const log of [
    "TypeError: " + "a".repeat(2049),
    "Error name: TypeError\nError message: " + "a".repeat(2049),
    "Process name: " + "a".repeat(257) + "\nTypeError: failure",
    "a".repeat(257) + "Error: failure",
    "TypeError: handler is not callable\nat " + "a".repeat(2049),
    "TypeError: handler is not callable\n" +
      "at run (Index.ets:1:1)\n".repeat(101),
  ]) {
    const bounded = parseCrash(log);
    assert.equal(bounded.selection_complete, false);
    assert.ok(bounded.kind.length <= 256);
    assert.ok((bounded.error_message?.length ?? 0) <= 2048);
    assert.ok(bounded.frames.length <= 100);
    assert.ok(bounded.frames.every((frame) => frame.length <= 2048));
    assert.ok(
      matchCrashPatterns(patterns, bounded).every(
        (match) => !match.evidence_complete,
      ),
    );
  }
});

test("runtime tables apply type-scoped AND/OR conditions, numeric code boundaries and retain ambiguous candidates", () => {
  assert.equal(patterns.length, 45);
  const match = (kind: string, message: string, code: string | null = null) =>
    matchCrashPatterns(patterns, signature(kind, message, code));
  assert.equal(
    match("TypeError", "Cannot read property of undefined").length,
    1,
  );
  assert.equal(match("TypeError", "Cannot read property").length, 0);
  assert.equal(
    match("TypeError", "Cannot load property of null or undefined").length,
    1,
  );
  assert.equal(
    match("SyntaxError", "Cannot load property of null or undefined").length,
    0,
  );
  assert.equal(match("BusinessError", "Unexpected Text in JSON").length, 0);
  assert.equal(
    match("BusinessError", "Unexpected Text in JSON: SyntaxError").length,
    1,
  );
  assert.equal(match("Error", "failure (14800014)").length, 1);
  assert.equal(match("Error", "80148000142").length, 0);
  assert.equal(match("Error", "request failed", "14800014").length, 1);
  const ambiguous = match("BusinessError", "request failed", "10200002");
  assert.equal(ambiguous.length, 2);
  assert.ok(
    ambiguous.every(
      (item) => item.match_status === "candidate" && !item.root_cause_verified,
    ),
  );
  for (const result of [
    ...ambiguous,
    ...match("ApiError", "application-specific failure"),
  ]) {
    const lines = reference(result.source_id.split("/")[1]!).split(/\r?\n/);
    assert.ok(lines[result.source_line - 1]!.includes(result.pattern));
    assert.ok(result.suggestion.length > 0 && result.conclusion.length > 0);
  }
});

test("fault modes match ordered wildcard templates without treating unmatched error types as root causes", () => {
  const cases: [string, string][] = [
    ["ReferenceError", "account is not defined"],
    ["URIError", "DecodeURI: invalid character: %E0%A4"],
    [
      "OutOfMemoryError",
      "OutOfMemory when trying to allocate 4096 bytes function name: newObject, shared heap oom, total size 8192 bytes, used size 8190 bytes",
    ],
    ["TerminationError", "Terminate execution!"],
    ["AggregateError", "None"],
  ];
  for (const [kind, message] of cases) {
    const found = matchCrashPatterns(patterns, signature(kind, message));
    assert.ok(
      found.some((item) => item.level === "fault_mode"),
      kind,
    );
  }
  for (const message of [
    " is not defined",
    "account is not defined later",
    "account is defined",
  ]) {
    assert.equal(
      matchCrashPatterns(patterns, signature("ReferenceError", message)).filter(
        (item) => item.level === "fault_mode",
      ).length,
      0,
    );
  }
  assert.deepEqual(
    matchCrashPatterns(patterns, {
      ...signature("TypeError", "handler is not callable"),
      status: "insufficient_evidence",
    }),
    [],
  );
  assert.deepEqual(
    matchCrashPatterns(
      patterns,
      signature("UnmappedError", "handler is not callable"),
    ),
    [],
  );
});

test("new upstream table shapes and unreviewed natural-language matching requirements fail closed", () => {
  const type = reference("typeerror_patterns"),
    modes = reference("fault-mode-library");
  for (const [id, content] of [
    ["new-source", type],
    [
      "typeerror_patterns",
      type.replace("## Pattern Matrix", "## Changed Matrix"),
    ],
    [
      "typeerror_patterns",
      type.replace("Fix suggestion", "More columns | Fix suggestion"),
    ],
    [
      "typeerror_patterns",
      type.replace(
        "## Pattern Matrix",
        "## Pattern Matrix\nInterpret an arbitrary new condition.",
      ),
    ],
    ["typeerror_patterns", type.replace(" + ", " then ")],
    [
      "fault-mode-library",
      modes.replaceAll("<heap-type>", "<unknown-placeholder>"),
    ],
  ] as const)
    assert.throws(
      () => compileCrashReference("arkts-runtime-fix/" + id, content),
      { code: "CRASH_PATTERN_UNMAPPED" },
    );
});

test("crash knowledge exposes only matching runtime cases and attributable source metadata", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "deveco-crash-knowledge-"),
  );
  const store = new StateStore(root),
    processes = new ProcessService(),
    auth = new AuthService(store, processes),
    knowledge = new KnowledgeService(store, auth);
  try {
    const found = knowledge.crashCases(
      signature("TypeError", "handler is not callable"),
    );
    assert.equal(found.status, "candidate_patterns");
    assert.equal(found.matches.length, 1);
    assert.ok(
      found.references.every(
        (entry) =>
          entry.id.startsWith("arkts-runtime-fix/") &&
          entry.source === "deveco-code" &&
          /^[a-f0-9]{40}$/.test(entry.commit) &&
          /^[a-f0-9]{64}$/.test(entry.sha256) &&
          entry.source_path.includes("arkts-runtime-fix/reference/"),
      ),
    );
    assert.ok(found.references.every((entry) => !("file" in entry)));
    assert.equal(
      knowledge.crashCases(signature("TypeError", "unlisted detail")).status,
      "unlisted_subtype",
    );
    assert.equal(
      knowledge.crashCases(signature("NativeCrash", "SIGSEGV")).status,
      "unlisted_error_type",
    );
    const missing = knowledge.crashCases({
      ...signature("TypeError", "handler is not callable"),
      status: "insufficient_evidence",
    });
    assert.equal(missing.status, "evidence_required");
    assert.deepEqual(missing.matches, []);
    assert.deepEqual(missing.references, []);
    assert.equal(found.root_cause_verified, false);
    assert.throws(() =>
      knowledge.crashCases(signature("TypeError", "x".repeat(2049))),
    );
  } finally {
    knowledge.close();
    await auth.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("large interleaved logs produce identical attributed crash evidence through the bounded CPU worker", async () => {
  const pool = new CpuPool();
  try {
    const line = (pid: number, text: string) =>
      "09-08 12:00:00.123 " + pid + " " + pid + " E App: " + text;
    const log =
      "I App: normal operation\n".repeat(8000) +
      [
        line(11, "Process name: com.example.target"),
        line(22, "Process name: com.example.other"),
        line(11, "Reason: BusinessError"),
        line(22, "TypeError: unrelated failure"),
        line(11, "Error message: Parameter error"),
        line(22, "at other (entry/src/pages/Other.ets:7:3)"),
        line(11, "Error code: 401"),
        line(11, "HybridStack:"),
        line(11, "at run (entry/src/pages/Target.ets:9:4)"),
      ].join("\n");
    const options = { bundle_name: "com.example.target", process_hint: "11" };
    const result = await pool.run({ kind: "crash", content: log, options });
    assert.deepEqual(result, parseCrash(log, options));
    assert.doesNotMatch(JSON.stringify(result), /Other\.ets|unrelated failure/);
  } finally {
    await pool.close();
  }
});
