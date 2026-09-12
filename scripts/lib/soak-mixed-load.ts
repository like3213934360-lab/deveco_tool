import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { z } from "zod";
import type { ToolName } from "../../src/core/contracts.js";
import { flowSchema } from "../../src/core/contracts.js";
import { atomicWrite, digest } from "../../src/core/files.js";
import { errorResult, ToolError } from "../../src/core/errors.js";

type Call = (name: ToolName, input: unknown) => Promise<unknown>;
type App = { bundle_name: string; module: string; ability: string };
const state = z.object({
  run_id: z.string(),
  status: z.string(),
  result: z.unknown(),
  error: z.unknown().optional(),
});
/** Mixed workload for the same public MCP/worker as the SDK soak. Recording,
 * recovery and logs take turns on the owned device; no concurrent mutations. */
export class SoakMixedLoad {
  readonly rounds: unknown[] = [];
  readonly logSessions: unknown[] = [];
  private recording?: string;
  private test?: { id: string; started: number };
  private requests = 0;
  constructor(
    readonly root: string,
    readonly target: string,
    readonly project: string,
    readonly app: App,
    readonly invoke: Call,
    readonly elapsed: () => number,
  ) {}
  private async call(name: ToolName, input: unknown) {
    let result: unknown;
    try {
      result = await this.invoke(name, input);
    } catch (error) {
      fs.appendFileSync(path.join(this.root, "mixed-requests.ndjson"), JSON.stringify({
        sequence: ++this.requests, elapsed_ms: this.elapsed(), tool: name,
        input_sha256: digest(input), error: errorResult(error),
      }) + "\n", { mode: 0o600 });
      // This fixture only enters owned, non-secret canary values. Preserve the
      // current failure surface before cancellation or emulator cleanup changes it.
      if (name === "ui_control") {
        try {
          const surface = await this.invoke("ui_inspect", { target: this.target, screenshot: true, limit: 200 });
          atomicWrite(path.join(this.root, `mixed-failure-surface-${this.requests}.json`), JSON.stringify(surface, null, 2));
        } catch (captureError) {
          atomicWrite(path.join(this.root, `mixed-failure-surface-${this.requests}.json`), JSON.stringify({ error: errorResult(captureError) }));
        }
      }
      throw error;
    }
    // Raw values entered below are owned, non-secret canary strings. Persist a
    // digest of inputs, never introduce a general input-logging precedent.
    fs.appendFileSync(
      path.join(this.root, "mixed-requests.ndjson"),
      JSON.stringify({
        sequence: ++this.requests,
        elapsed_ms: this.elapsed(),
        tool: name,
        input_sha256: digest(input),
        result,
      }) + "\n",
      { mode: 0o600 },
    );
    return result;
  }
  private selector(key: string, text?: string) {
    return {
      key,
      bundle_name: this.app.bundle_name,
      ...(text === undefined ? {} : { text, textMode: "exact" }),
    };
  }
  private async settle(id: string, expected: string) {
    const deadline = performance.now() + 90000;
    do {
      const value = state.parse(
        await this.call("workflow_run", {
          action: "status",
          run_id: id,
          wait_ms: 1000,
        }),
      );
      if (["queued", "running", "cancelling"].includes(value.status)) continue;
      if (value.status !== expected) {
        const surface = await this.call("ui_inspect", { target: this.target, screenshot: true, limit: 200 });
        atomicWrite(path.join(this.root, `mixed-unexpected-${id}.json`), JSON.stringify({ state: value, surface }, null, 2));
      }
      assert.equal(value.status, expected, JSON.stringify(value));
      return value;
    } while (performance.now() < deadline);
    throw new ToolError(
      "SOAK_MIXED_TIMEOUT",
      "Inspect the recorded task; never resubmit an uncertain effect",
    );
  }
  private async flow(
    id: string,
    variables: Record<string, string>,
    suffix: string,
  ) {
    return z.object({ run_id: z.string() }).parse(
      await this.call("ui_flow", {
        action: "run",
        project_path: this.project,
        target: this.target,
        id,
        variables,
        request_key: `soak:${path.basename(this.root)}:${id}:${suffix}`,
      }),
    ).run_id;
  }
  private async enter(value: string) {
    for (const operation of [
      { action: "click", selector: this.selector("mcp-input") },
      // Native current-focus text inserts at the caret. Record explicit Ctrl+A
      // so subsequent rounds replace the prior value through real key semantics.
      { action: "keyEvent", keys: ["2072", "2017"] },
      {
        action: "text",
        window: { bundle_name: this.app.bundle_name },
        text: value,
      },
      { action: "keyEvent", keys: ["Back"] },
      { action: "click", selector: this.selector("mcp-confirm") },
    ])
      await this.call("ui_control", { target: this.target, operation });
  }
  private operations(run: string) {
    const db = new Database(path.join(this.root, "state/state.sqlite"), {
      readonly: true,
    });
    try {
      return db
        .prepare(
          "SELECT node,input_hash,status,result FROM operations WHERE run_id=? AND node LIKE 'execute_ui_path:flow:%' AND status='done' ORDER BY node",
        )
        .all(run);
    } finally {
      db.close();
    }
  }
  async recordReplayRecover() {
    assert.equal(
      this.test,
      undefined,
      "Finish the log test before other device mutations",
    );
    const index = this.rounds.length + 1,
      id = `soak-mixed-${index}`,
      started = this.elapsed();
    const expected = `长稳录制中文🙂第${index}轮`,
      assertion = {
        visible: this.selector("mcp-status", expected),
        timeoutMs: 1500,
      };
    this.recording = z.object({ recording_id: z.string() }).parse(
      await this.call("ui_flow", {
        action: "record_start",
        project_path: this.project,
        target: this.target,
        id,
        name: `长稳录制与恢复 ${index}`,
        route: { module: this.app.module, ability: this.app.ability },
        mode: "attach",
        request_key: `soak:${path.basename(this.root)}:${id}:record`,
      }),
    ).recording_id;
    await this.settle(this.recording, "needs_input");
    await this.enter(expected);
    await this.call("ui_flow", {
      action: "record_stop",
      recording_id: this.recording,
      assert: assertion,
    });
    await this.settle(this.recording, "succeeded");
    const recording = this.recording;
    this.recording = undefined;
    const saved = flowSchema.parse(
      await this.call("ui_flow", {
        action: "read",
        project_path: this.project,
        id,
      }),
    );
    assert.equal(saved.version, 2);
    assert.deepEqual(
      saved.steps.map((step) => step.action),
      ["tap", "key", "focusInput", "key", "tap"],
    );
    assert.equal(saved.start.mode, "attach");
    assert.equal(saved.variables.input1?.secret, true);
    // A different starting state makes replay progress observable.
    await this.enter(`长稳重放前 ${index}`);
    const replay = await this.flow(id, { input1: expected }, "replay");
    await this.settle(replay, "succeeded");
    const failed = await this.flow(
      id,
      { input1: `长稳故意错误 ${index}` },
      "failed-assertion",
    );
    const failedState = await this.settle(failed, "needs_input");
    assert.equal(
      z
        .object({
          code: z.literal("EFFECT_UNCERTAIN"),
          details: z.object({ cause: z.object({ code: z.string() }) }),
        })
        .parse(failedState.error ?? z.object({ interrupts: z.array(z.object({ value: z.object({ error: z.unknown() }) })).length(1) }).parse(failedState.result).interrupts[0]!.value.error).details.cause.code,
      "VERIFICATION_FAILED",
    );
    const before = this.operations(failed);
    assert.ok(before.length > 0);
    // Explicitly fix the owned UI, then resume the original workflow. Completed
    // effects must not run again and overwrite this repaired state.
    await this.enter(expected);
    await this.call("workflow_run", { action: "resume", run_id: failed, resume_input: { action: "recheck" } });
    await this.settle(failed, "succeeded");
    assert.deepEqual(
      this.operations(failed),
      before,
      "Resume must reuse all completed UI effects",
    );
    await this.call("verify_ui", { target: this.target, assert: assertion });
    const flowAfter = await this.call("ui_flow", {
      action: "read",
      project_path: this.project,
      id,
    });
    assert.equal(digest(flowAfter), digest(saved));
    this.rounds.push({
      started_ms: started,
      finished_ms: this.elapsed(),
      recording_run_id: recording,
      replay_run_id: replay,
      recovered_run_id: failed,
      expected_failure: "VERIFICATION_FAILED",
      failure_status: "needs_input",
      failure_code: "EFFECT_UNCERTAIN",
      saved_flow_sha256: digest(saved),
      recovered_operations_sha256: digest(before),
      recovered_effects_unchanged: true,
    });
    this.save();
  }
  async startLogs() {
    assert.equal(this.test, undefined);
    const start = z.object({ test_id: z.string() }).parse(
      await this.call("ui_test", {
        action: "start",
        target: this.target,
        app: this.app,
        fresh_start: false,
        test_plan:
          "Collect owned heartbeat logs while repeated real LSP, UI and SDK watch observations run; verify the visible canary before finishing.",
        steps: [
          {
            id: "mixed-observation",
            goal: "Owned canary remains visible",
            assert: {
              visible: this.selector("mcp-confirm"),
              timeoutMs: 10000,
            },
          },
        ],
        request_key: `soak:${path.basename(this.root)}:logs:${this.logSessions.length}`,
      }),
    );
    this.test = { id: start.test_id, started: this.elapsed() };
    await this.call("ui_test", { action: "resume", test_id: this.test.id });
  }
  async finishLogs() {
    if (!this.test) return;
    const { id, started } = this.test;
    await this.call("ui_test", { action: "check", test_id: id });
    const final = await this.call("ui_test", { action: "finish", test_id: id });
    assert.equal(
      z.object({ status: z.string() }).parse(final).status,
      "succeeded",
    );
    const chunks: {
      id: number;
      source: string;
      step_id: string;
      artifact_id: string;
      sha256: string;
    }[] = [];
    let chunkOffset = 0;
    for (;;) {
      const page = z
        .object({
          chunks: z.array(
            z.object({
              id: z.number(),
              source: z.string().optional(),
              step_id: z.string(),
              artifact_id: z.string(),
              sha256: z.string().optional(),
            }),
          ),
          next_chunk_offset: z.number().nullable(),
        })
        .parse(
          await this.call("ui_test", {
            action: "logs",
            test_id: id,
            chunk_offset: chunkOffset,
            chunk_limit: 100,
          }),
        );
      for (const chunk of page.chunks.filter(
        (chunk) => chunk.source === "continuous",
      )) {
        chunks.push(
          z
            .object({
              id: z.number(),
              source: z.literal("continuous"),
              step_id: z.string(),
              artifact_id: z.string(),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .parse(chunk),
        );
      }
      if (page.next_chunk_offset === null) break;
      assert.ok(page.next_chunk_offset > chunkOffset);
      chunkOffset = page.next_chunk_offset;
    }
    assert.ok(
      chunks.length > 0,
      "Mixed workload must actually retain continuous log chunks",
    );
    let lines = 0;
    for (const chunk of chunks) {
      assert.equal(chunk.step_id, "mixed-observation");
      let offset = 0;
      for (;;) {
        const page = z
          .object({ content: z.string(), next_offset: z.number().nullable() })
          .parse(
            await this.call("ui_test", {
              action: "logs",
              test_id: id,
              chunk_id: chunk.id,
              search_keywords: ["MCPSOAK:"],
              offset,
              limit: 65536,
            }),
          );
        lines += [...page.content.matchAll(/MCPSOAK:\d+:\d+:中文🙂/g)].length;
        if (page.next_offset === null) break;
        assert.ok(page.next_offset > offset);
        offset = page.next_offset;
      }
    }
    assert.ok(
      lines >= 2,
      "Owned application heartbeat must be present in retained logs",
    );
    this.logSessions.push({
      test_id: id,
      started_ms: started,
      finished_ms: this.elapsed(),
      heartbeat_lines: lines,
      chunks,
      status: "succeeded",
    });
    this.test = undefined;
    this.save();
  }
  save() {
    atomicWrite(
      path.join(this.root, "mixed-evidence.json"),
      JSON.stringify(
        {
          rounds: this.rounds,
          log_sessions: this.logSessions,
          requests_recorded: this.requests,
        },
        null,
        2,
      ) + "\n",
    );
  }
  async cancel() {
    if (this.test) {
      await this.call("ui_test", { action: "cancel", test_id: this.test.id });
      this.test = undefined;
    }
    if (this.recording) {
      await this.call("ui_flow", {
        action: "record_cancel",
        recording_id: this.recording,
      });
      this.recording = undefined;
    }
  }
}
