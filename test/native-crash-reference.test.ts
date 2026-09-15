import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { DeviceService } from "../src/services/device.js";
import { LogService } from "../src/services/logs.js";
import { withTrace } from "../src/core/trace.js";
import { ToolError } from "../src/core/errors.js";
import { workflowInputs } from "../src/core/contracts.js";
import {
  captureCrashReference,
  readCrashSnapshot,
  diagnoseCrashSnapshot,
  supplementCrashSnapshot,
} from "../src/services/crash-reference.js";
import { resolveEvidenceResult } from "../src/services/evidence-result.js";

const bundle = "com.example.original",
  target = "original-device";
const second = 1789440000;
const anchor = (seconds: number) => ({
  device_epoch_ns: `${seconds}000000000`,
  host_started_at: seconds * 1000,
  host_completed_at: seconds * 1000 + 10,
  pids: ["42"],
});
const crash = (at = second + 1, pid = 42) =>
  `${at}.100000 ${pid} ${pid} E App: TypeError: object is not callable\n${at}.100001 ${pid} ${pid} E App: at click (entry/src/main/ets/pages/Original.ets:12:3)\n`;
function captured(store: StateStore, id: string, content: string) {
  const artifact = store.artifact(id, content);
  return {
    id: 0,
    step_id: "startup",
    stage: "post-launch",
    status: "captured",
    start: anchor(second),
    end: anchor(second + 4),
    artifact_id: artifact.artifact_id,
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: artifact.bytes,
    truncated: false,
    complete: false,
  };
}
function source(store: StateStore, workflow = "app_deploy") {
  const run = store.create(workflow, {
    target,
    project_path: "/deleted/historical/project",
    source_hash: "old-source",
    parameters: {
      app: {
        bundle_name: bundle,
        ability: "EntryAbility",
        parameters: { secret: "never in diagnosis" },
      },
    },
  }).run;
  store.claim(run.id);
  store.activate(run.id);
  return run.id;
}

test("source-task crash analysis reuses failed startup logs without SDK/device calls, freezes retries and retains the original task", async () => {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "deveco-crash-reference-"),
    ),
    prior = process.env.DEVECO_STATE_DIR;
  process.env.DEVECO_STATE_DIR = root;
  const runtime = new Runtime();
  try {
    const id = source(runtime.store),
      chunk = captured(
        runtime.store,
        id,
        crash() + crash(second + 2, 99) + crash(second + 100),
      );
    const report = runtime.store.artifact(
      id,
      JSON.stringify({
        target,
        bundle_name: bundle,
        diagnostic_log: { chunk },
      }),
      "application/json",
    );
    runtime.store.update(id, "failed", undefined, {
      code: "STARTUP_PROCESS_FAILED",
      details: { evidence: report },
    });
    let externalCalls = 0;
    runtime.devices.target = async () => {
      externalCalls++;
      throw new Error("No device access expected");
    };
    runtime.devices.shell = async () => {
      externalCalls++;
      throw new Error("No device access expected");
    };
    const request = {
      action: "start",
      workflow: "crash_diagnose",
      input: { source_run_id: id },
      request_key: "historical-read",
      wait_ms: 2000,
      detail: "full",
    };
    const result = z
      .object({
        run_id: z.string(),
        status: z.literal("succeeded"),
        result: z.record(z.string(), z.unknown()),
      })
      .parse(await runtime.call("workflow_run", request));
    const parsed = resolveEvidenceResult(
      runtime.store,
      result.result.parse_crash,
    );
    assert.equal(parsed.status, "detected");
    assert.equal(parsed.historical, true);
    assert.equal(parsed.current_source_verified, false);
    assert.equal(parsed.excluded_lines, 4);
    assert.equal(parsed.source_run_id, id);
    assert.equal(parsed.bundle_name, bundle);
    assert.equal(JSON.stringify(parsed).includes("never in diagnosis"), false);
    assert.ok(
      runtime.store.db
        .prepare(
          "SELECT 1 FROM run_dependencies WHERE parent_run_id=? AND run_id=?",
        )
        .get(result.run_id, id),
    );
    const log = runtime.store.db
      .prepare("SELECT file FROM artifacts WHERE id=?")
      .get(chunk.artifact_id) as { file: string };
    fs.writeFileSync(log.file, "changed");
    const retried = z
      .object({ run_id: z.string(), deduplicated: z.literal(true) })
      .parse(await runtime.call("workflow_run", request));
    assert.equal(retried.run_id, result.run_id);
    assert.equal(externalCalls, 0);
    const again = z
      .object({
        status: z.literal("succeeded"),
        result: z.record(z.string(), z.unknown()),
      })
      .parse(
        await runtime.call("workflow_run", {
          ...request,
          request_key: "new-snapshot",
        }),
      );
    assert.equal(
      resolveEvidenceResult(runtime.store, again.result.parse_crash).status,
      "insufficient_evidence",
    );
    assert.equal(externalCalls, 0);
    assert.equal(runtime.store.get(id).status, "failed");
  } finally {
    await runtime.close();
    if (prior === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("UI log snapshots enforce run ownership, recorded hashes, PID/time boundaries and explicit partial coverage", () => {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "deveco-crash-ui-reference-"),
    ),
    store = new StateStore(root);
  try {
    const id = source(store, "ui_test"),
      other = source(store),
      chunk = captured(store, id, crash());
    const foreign = captured(store, other, crash());
    const continuous = {
      ...chunk,
      id: 500,
      source: "continuous",
      start_ns: anchor(second).device_epoch_ns,
      end_ns: anchor(second + 4).device_epoch_ns,
      processes: { "42": "123" },
      sha256: "0".repeat(64),
      received_range_verified: true,
    };
    const reference = captureCrashReference(store, id, () => ({
      target,
      bundle_name: bundle,
      chunks: [foreign, continuous],
      omitted_chunks: 4,
      continuous: { state: "interrupted", pending_gap: "runtime_interrupted" },
    }));
    const snapshot = readCrashSnapshot(store, "workflow-input", reference);
    assert.equal(
      diagnoseCrashSnapshot(snapshot).status,
      "insufficient_evidence",
    );
    assert.ok(
      snapshot.gaps.some((gap) => gap.code === "CRASH_ARTIFACT_SCOPE_MISMATCH"),
    );
    assert.ok(
      snapshot.gaps.some((gap) => gap.code === "CRASH_ARTIFACT_CHANGED"),
    );
    assert.ok(
      snapshot.gaps.some((gap) => gap.code === "CRASH_LOG_CHUNKS_OMITTED"),
    );
    const good = captureCrashReference(store, id, () => ({
      target,
      bundle_name: bundle,
      chunks: [chunk],
      omitted_chunks: 0,
      continuous: { state: "not_started" },
    }));
    const diagnosis = diagnoseCrashSnapshot(
      readCrashSnapshot(store, "workflow-input", good),
    );
    assert.equal(diagnosis.status, "detected");
    assert.equal(diagnosis.selection_complete, false);
    assert.equal(
      diagnosis.findings[0]?.diagnosis.suspected_file,
      "entry/src/main/ets/pages/Original.ets",
    );
    const file = store.db
      .prepare("SELECT file FROM artifacts WHERE id=?")
      .get(good.artifact_id) as { file: string };
    const content = fs.readFileSync(file.file);
    content[10] = content[10] === 49 ? 50 : 49;
    fs.writeFileSync(file.file, content);
    assert.throws(() => readCrashSnapshot(store, "workflow-input", good), {
      code: "CRASH_SNAPSHOT_CHANGED",
    });
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("explicit historical supplementation filters application/time before the limit, never fetches another round, and reports device or clock gaps", async () => {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "deveco-crash-supplement-"),
    ),
    store = new StateStore(root);
  const devices = new DeviceService(new ProcessService(), store),
    logs = new LogService(devices, store);
  try {
    const id = source(store, "ui_test"),
      chunk = captured(
        store,
        id,
        `${second + 1}.100000 42 42 I App: normal log\n`,
      );
    const reference = captureCrashReference(store, id, () => ({
      target,
      bundle_name: bundle,
      chunks: [chunk],
      omitted_chunks: 0,
      continuous: { state: "not_started" },
    }));
    const snapshot = readCrashSnapshot(store, "workflow-input", reference),
      reads: string[] = [];
    const matching = `jscrash-${bundle}-42-${(second + 2) * 1000}.log`;
    const calendar = new Date((second + 2) * 1000)
      .toISOString()
      .replace(/[-:TZ.]/g, "");
    const calendarName = `jscrash-${bundle}-42-${calendar}.log`;
    const newer = Array.from(
      { length: 10 },
      (_, i) => `jscrash-${bundle}-42-${(second + 20 + i) * 1000}.log`,
    );
    devices.shell = async (selected, args) => {
      assert.equal(selected, target);
      reads.push(args.join(" "));
      let stdout = "";
      if (args[0] === "date") stdout = `${second + 100} +0000`;
      else if (args[0] === "ls" || args[0] === "hidumper")
        stdout = [
          ...newer,
          matching,
          calendarName,
          `jscrash-com.other-42-${(second + 2) * 1000}.log`,
        ].join("\n");
      else if (args[0] === "head") {
        assert.ok(args.at(-1)?.endsWith(matching));
        stdout = `Process name: ${bundle}\nTypeError: historic fault\nat click (Original.ets:2:1)\n`;
      } else throw new Error("Unexpected device operation " + args.join(" "));
      return {
        stdout,
        stderr: "",
        truncated: false,
        exitCode: 0,
        signal: null,
        elapsedMs: 1,
        pid: 1,
      };
    };
    const controller = new AbortController();
    assert.equal(
      (
        await supplementCrashSnapshot(
          store,
          logs,
          id,
          snapshot,
          false,
          controller.signal,
        )
      ).parts.length,
      1,
    );
    assert.equal(reads.length, 0);
    const supplemented = await withTrace({ run_id: id }, () =>
      supplementCrashSnapshot(
        store,
        logs,
        id,
        snapshot,
        true,
        controller.signal,
      ),
    );
    assert.equal(supplemented.parts.length, 2);
    assert.ok(
      supplemented.gaps.some(
        (gap) => gap.code === "CRASH_HISTORICAL_TIMEZONE_UNAVAILABLE",
      ),
    );
    assert.equal(reads.filter((x) => x.startsWith("head ")).length, 1);
    assert.equal(diagnoseCrashSnapshot(supplemented).status, "detected");
    const count = reads.length;
    assert.equal(
      (
        await supplementCrashSnapshot(
          store,
          logs,
          id,
          supplemented,
          true,
          controller.signal,
        )
      ).supplemental_collection,
      "unnecessary",
    );
    assert.equal(reads.length, count);
    const noClock = await supplementCrashSnapshot(
      store,
      logs,
      id,
      { ...snapshot, device_window: undefined },
      true,
      controller.signal,
    );
    assert.equal(noClock.supplemental_collection, "unavailable");
    assert.equal(reads.length, count);
    devices.shell = async () => {
      throw new ToolError("DEVICE_OFFLINE", "offline");
    };
    const offline = await supplementCrashSnapshot(
      store,
      logs,
      id,
      snapshot,
      true,
      controller.signal,
    );
    assert.ok(offline.gaps.some((gap) => gap.code === "DEVICE_OFFLINE"));
    assert.equal(offline.supplemental_collection, "unavailable");
    assert.equal(
      diagnoseCrashSnapshot(offline).next.action,
      "inspect_evidence_gaps",
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("historical source input cannot relabel its app/device or mix log sources", () => {
  const source_run_id = randomUUID();
  assert.equal(
    workflowInputs.crash_diagnose.safeParse({ source_run_id }).success,
    true,
  );
  assert.equal(
    workflowInputs.crash_diagnose.safeParse({
      source_run_id,
      collect_missing: true,
    }).success,
    true,
  );
  for (const input of [
    { source_run_id, target: "another" },
    { source_run_id, bundle_name: "com.other" },
    { source_run_id, log_text: "new" },
    { source_run_id, kind: "hilog" },
    { collect_missing: false },
  ])
    assert.equal(workflowInputs.crash_diagnose.safeParse(input).success, false);
});
