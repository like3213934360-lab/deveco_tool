import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  appSchema,
  assertionSchema,
  controlSchema,
  tools,
  uiTestPlanSchema,
  uiTestStepSchema,
} from "../core/contracts.js";
import { PayloadCipher } from "../core/crypto.js";
import { errorResult, invariant, ToolError } from "../core/errors.js";
import { digest } from "../core/files.js";
import type { StateStore } from "../core/store.js";
import { currentTrace, withTrace } from "../core/trace.js";
import { protocolVersion, release } from "../core/config.js";
import { isWindowSurface } from "./ui-tree.js";
import { progressWindows } from "./ui-progress.js";
import type { DeviceService, Snapshot } from "./device.js";
import type { VerificationService } from "./verification.js";
import type { UiReviewService } from "./ui-review.js";
import { resolveControl, uiInputArguments } from "./ui-control.js";
import {
  UiTestLogService,
  uiLogAnchorSchema,
  uiLogChunkSchema,
} from "./ui-test-log.js";
import type { StorageService } from "./storage.js";

const sampleSchema = z.strictObject({
  snapshot_id: z.string(),
  signature: z.string(),
  frame_signature: z.string(),
  artifact_id: z.string().uuid(),
  sha256: z.string(),
  sampled_at: z.number(),
});
const actionSchema = z.strictObject({
  id: z.string().uuid(),
  step_id: z.string(),
  operation: controlSchema,
  state: z.enum(["pending", "accepted", "uncertain"]),
  before: sampleSchema,
  after: sampleSchema.optional(),
  created: z.number(),
  error_code: z.string().optional(),
  reconciled: z.boolean().default(false),
});
const checkSchema = z.strictObject({
  step_id: z.string(),
  assertion_passed: z.boolean(),
  review_id: z.string().optional(),
  report_artifact: z.string().optional(),
  error_code: z.string().optional(),
  created: z.number(),
  action_count: z.number().int().nonnegative(),
});
const payloadSchema = z.strictObject({
  test_plan: z.string().max(16384),
  app: appSchema,
  fresh_start: z.boolean(),
  allowed_bundles: z.array(appSchema.shape.bundle_name).min(1).max(17),
  display_id: z.number().int().min(0).max(2147483647).optional(),
  steps: z.array(uiTestStepSchema).max(100),
  initialized: z.boolean().default(false),
  actions: z.array(actionSchema).max(200).default([]),
  checks: z.array(checkSchema).max(200).default([]),
  no_progress: z.number().int().default(0),
  blocked: z.enum(["no_progress", "uncertain", "budget"]).optional(),
  replans: z
    .array(
      z.strictObject({
        reason: z.string(),
        strategy: z.string(),
        sample: sampleSchema,
        review_id: z.string().uuid(),
        reconcile_attempt_ids: z.array(z.string().uuid()).max(200),
        accepted: z.boolean(),
        created: z.number(),
      }),
    )
    .max(20)
    .default([]),
  strategy_operation_hash: z.string().optional(),
  strategy_signature: z.string().optional(),
  log_anchor: uiLogAnchorSchema.optional(),
  log_chunks: z.array(uiLogChunkSchema).max(500).default([]),
  last_report: z
    .strictObject({
      artifact_id: z.string().uuid(),
      sha256: z.string(),
      bytes: z.number(),
      content_hash: z.string(),
    })
    .optional(),
  report_count: z.number().int().min(0).max(64).default(0),
});
type Payload = z.infer<typeof payloadSchema>;
type Sample = z.infer<typeof sampleSchema>;
interface Row {
  run_id: string;
  target: string;
  state: "active" | "finished" | "cancelled";
  payload: string;
}
type Input = z.infer<typeof tools.ui_test.schema>;

/** A host plans and reasons; this service enforces durable native steps and evidence-based completion. */
export class UiTestService {
  private readonly cipher: PayloadCipher;
  private readonly shutdown = new AbortController();
  private readonly active = new Map<
    string,
    { controller: AbortController; promise: Promise<unknown> }
  >();
  private readonly logs: UiTestLogService;
  constructor(
    readonly store: StateStore,
    readonly devices: DeviceService,
    readonly verification: VerificationService,
    readonly reviews: UiReviewService,
    readonly checkRecording: (target: string) => void,
    readonly storage: StorageService,
  ) {
    this.cipher = new PayloadCipher(path.join(store.root, "ui-test.key"));
    this.logs = new UiTestLogService(store, devices);
  }
  private row(id: string) {
    const row = this.store.db
      .prepare("SELECT * FROM ui_tests WHERE run_id=?")
      .get(id) as Row | undefined;
    invariant(row, "UI_TEST_NOT_FOUND", "Unknown test_id");
    return row;
  }
  private payload(row: Row) {
    return payloadSchema.parse(
      JSON.parse(this.cipher.open(row.run_id, row.payload)),
    );
  }
  private write(id: string, payload: Payload) {
    const json = JSON.stringify(payloadSchema.parse(payload));
    invariant(
      Buffer.byteLength(json) <= 1024 * 1024,
      "UI_TEST_CAPACITY",
      "Test state exceeds 1 MiB; finish or cancel and start a smaller test",
    );
    this.store.capacity(Buffer.byteLength(json) * 2 + 4096);
    this.store.db
      .prepare("UPDATE ui_tests SET payload=?,updated=? WHERE run_id=?")
      .run(this.cipher.seal(id, json), Date.now(), id);
  }
  assertTaskTarget(target: string) {
    const row = this.store.db
      .prepare("SELECT run_id FROM ui_tests WHERE target=? AND state='active'")
      .get(target) as { run_id: string } | undefined;
    if (row && row.run_id !== currentTrace().run_id)
      throw new ToolError(
        "UI_TEST_ACTIVE",
        "Use ui_test act for the active test, or cancel that test before other device mutations",
        { test_id: row.run_id },
      );
  }
  private passed(payload: Payload, step: z.infer<typeof uiTestStepSchema>) {
    const check = payload.checks.findLast((item) => item.step_id === step.id);
    if (
      !check ||
      !check.assertion_passed ||
      check.error_code ||
      payload.actions.findLastIndex((action) => action.step_id === step.id) >=
        check.action_count
    )
      return false;
    try {
      return (
        !step.review ||
        (!!check.review_id && this.reviews.status(check.review_id).verified)
      );
    } catch (error) {
      if (error instanceof ToolError && error.code === "UI_REVIEW_NOT_FOUND")
        return false;
      throw error;
    }
  }
  private current(payload: Payload) {
    const step = payload.steps.find((step) => !this.passed(payload, step));
    invariant(
      step,
      "UI_TEST_STEPS_COMPLETE",
      "No pending step; inspect and finish the test",
    );
    return step;
  }
  status(id: string) {
    const row = this.row(id),
      payload = this.payload(row),
      run = this.store.get(id);
    const pending = payload.actions.some(
      (action) => action.state !== "accepted" && !action.reconciled,
    );
    return {
      test_id: id,
      run_id: id,
      target: row.target,
      bundle_name: payload.app.bundle_name,
      allowed_bundles: payload.allowed_bundles,
      display_id: payload.display_id ?? null,
      test_plan: payload.test_plan,
      status: run.status,
      initialized: payload.initialized,
      verified: row.state === "finished" && run.status === "succeeded",
      blocked: pending ? "uncertain" : (payload.blocked ?? null),
      next_action:
        row.state !== "active"
          ? "inspect report or export retained evidence"
          : !payload.steps.length
            ? "plan"
            : !payload.initialized
              ? "resume"
              : "inspect current step, act/check, read visual review, then finish",
      no_progress_count: payload.no_progress,
      action_count: payload.actions.length,
      steps: payload.steps.map((step) => ({
        ...step,
        status: this.passed(payload, step) ? "passed" : "pending",
        check:
          payload.checks.findLast((check) => check.step_id === step.id) ?? null,
      })),
      actions: payload.actions.map(({ operation, ...action }) => ({
        ...action,
        operation: operation.action,
      })),
      replan_count: payload.replans.length,
      replan_review_id: payload.replans.at(-1)?.review_id ?? null,
      log_chunk_count: payload.log_chunks.length,
      log_scope:
        "Device epoch interval and application PIDs sampled at interval boundaries; bounded Hilog ring-buffer reads are partial evidence, not a complete continuous log.",
      report_artifact: payload.last_report ?? null,
    };
  }
  private report(id: string, payload: Payload, final = false) {
    const { report_artifact: _previous, ...status } = this.status(id);
    const reviewIds = [
      ...new Set([
        ...payload.checks.flatMap((check) =>
          check.review_id ? [check.review_id] : [],
        ),
        ...payload.replans.map((replan) => replan.review_id),
      ]),
    ];
    const body = {
      format: 1,
      release,
      protocol: protocolVersion,
      ...status,
      ...(final
        ? { status: "succeeded", verified: true, next_action: "complete" }
        : {}),
      app: {
        bundle_name: payload.app.bundle_name,
        ability: payload.app.ability,
        module: payload.app.module ?? null,
      },
      checks: payload.checks,
      reviews: reviewIds.map((review_id) => {
        try {
          return this.reviews.status(review_id);
        } catch (error) {
          return {
            review_id,
            status: "unavailable",
            code: errorResult(error).code,
          };
        }
      }),
      replans: payload.replans,
      log_chunks: payload.log_chunks,
      scope:
        "Point-in-time test evidence. Native action inputs and launch parameters are omitted; requirements, screenshots, observations and app logs may include application data.",
    };
    const contentHash = digest(body);
    if (payload.last_report?.content_hash === contentHash)
      return payload.last_report;
    invariant(
      payload.report_count < (final ? 64 : 63),
      "UI_TEST_REPORT_BUDGET",
      "Report snapshot budget reached; finish or cancel before starting another test",
    );
    const json = JSON.stringify({ ...body, captured_at: Date.now() }, null, 2);
    const artifact = this.store.artifact(id, json, "application/json");
    payload.last_report = {
      artifact_id: artifact.artifact_id,
      sha256: createHash("sha256").update(json).digest("hex"),
      bytes: artifact.bytes,
      content_hash: contentHash,
    };
    payload.report_count++;
    this.write(id, payload);
    return payload.last_report;
  }
  private start(input: Extract<Input, { action: "start" }>, target: string) {
    return this.store.db
      .transaction(() => {
        const previous =
          input.request_key && this.store.byRequest(input.request_key);
        if (previous) {
          invariant(
            previous.workflow === "ui_test" &&
              previous.input_hash === digest({ ...input, target }),
            "REQUEST_KEY_CONFLICT",
            "Request key belongs to another test input",
          );
          return { ...this.status(previous.id), deduplicated: true };
        }
        this.checkRecording(target);
        this.assertTaskTarget(target);
        invariant(
          (
            this.store.db
              .prepare(
                "SELECT COUNT(*) AS count FROM ui_tests WHERE state='active'",
              )
              .get() as { count: number }
          ).count < 32,
          "UI_TEST_CAPACITY",
          "At most 32 unfinished UI tests",
        );
        const payload = payloadSchema.parse({
          test_plan: input.test_plan,
          app: input.app,
          fresh_start: input.fresh_start,
          steps: input.steps ?? [],
          allowed_bundles: [
            ...new Set([input.app.bundle_name, ...input.allowed_bundles]),
          ],
          display_id: input.display_id,
        });
        this.validatePlan(payload, payload.steps);
        const json = JSON.stringify(payload);
        this.store.capacity(Buffer.byteLength(json) * 4 + 16384);
        const { run } = this.store.create(
          "ui_test",
          { target, app: input.app },
          input.request_key,
          { ...input, target },
        );
        this.store.db
          .prepare("INSERT INTO ui_tests VALUES (?,?,?,?,?)")
          .run(
            run.id,
            target,
            "active",
            this.cipher.seal(run.id, json),
            Date.now(),
          );
        this.store.update(run.id, "needs_input", { test_id: run.id });
        return this.status(run.id);
      })
      .immediate();
  }
  private validatePlan(payload: Payload, steps: Payload["steps"]) {
    for (const step of steps)
      if (step.assert) this.scopedAssertion(payload, step.assert);
  }
  private scopedAssertion(
    payload: Payload,
    value: z.infer<typeof assertionSchema>,
  ) {
    const scope = (selector: NonNullable<typeof value.visible>) => {
      invariant(
        !selector.bundle_name ||
          payload.allowed_bundles.includes(selector.bundle_name),
        "UI_TEST_SCOPE_MISMATCH",
        "Assertions must name a captured application scope",
      );
      invariant(
        payload.display_id === undefined ||
          selector.displayId === undefined ||
          String(selector.displayId) === String(payload.display_id),
        "UI_TEST_SCOPE_MISMATCH",
        "Assertion display differs from the captured display",
      );
      return {
        ...selector,
        bundle_name: selector.bundle_name ?? payload.app.bundle_name,
        ...(payload.display_id === undefined
          ? {}
          : { displayId: payload.display_id }),
      };
    };
    return assertionSchema.parse({
      ...value,
      ...(value.visible ? { visible: scope(value.visible) } : {}),
      ...(value.hidden ? { hidden: scope(value.hidden) } : {}),
      ...(value.alternates ? { alternates: value.alternates.map(scope) } : {}),
    });
  }
  private async surface(row: Row, payload: Payload, signal: AbortSignal) {
    const snapshot = await this.devices.snapshot(row.target, signal);
    const scoped = (node: Snapshot["nodes"][number]) =>
      payload.allowed_bundles.includes(node.bundleName ?? "") &&
      (payload.display_id === undefined ||
        node.displayId === String(payload.display_id));
    const windows = snapshot.nodes.filter(
      (node) => isWindowSurface(node) && node.visible !== false && scoped(node),
    );
    const displays = [...new Set(windows.map((node) => node.displayId))];
    invariant(
      windows.length > 0 && displays.length === 1,
      "UI_TEST_APP_NOT_VISIBLE",
      "A captured application scope must be visible on one unambiguous display; select display_id at start for multi-display tests",
    );
    const display = displays[0];
    invariant(
      display === null || /^\d+$/.test(display!),
      "UI_DISPLAY_INVALID",
      "Invalid application display identity",
    );
    return { snapshot, display, nodes: snapshot.nodes.filter(scoped) };
  }
  private async sample(
    row: Row,
    payload: Payload,
    signal: AbortSignal,
  ): Promise<{ saved: Sample; snapshot: Snapshot }> {
    const { snapshot, display, nodes } = await this.surface(
      row,
      payload,
      signal,
    );
    const screenshot = await this.devices.screenshot(
      row.target,
      {
        format: "jpeg",
        ...(display === null ? {} : { display_id: Number(display) }),
      },
      signal,
      progressWindows(nodes),
    );
    invariant(
      screenshot.artifact,
      "UI_TEST_EVIDENCE_MISSING",
      "A fresh retained screenshot is required",
    );
    return {
      snapshot,
      saved: {
        snapshot_id: snapshot.id,
        signature: digest(nodes),
        frame_signature: screenshot.progress_signature,
        artifact_id: screenshot.artifact.artifact_id,
        sha256: screenshot.sha256,
        sampled_at: Date.now(),
      },
    };
  }
  private async initialize(row: Row, payload: Payload, signal: AbortSignal) {
    if (!payload.initialized) {
      if (!payload.log_anchor) {
        try {
          payload.log_anchor = await this.logs.anchor(
            row.target,
            payload.app.bundle_name,
            signal,
          );
          this.write(row.run_id, payload);
        } catch {
          signal.throwIfAborted();
        }
      }
      if (payload.fresh_start) {
        await withTrace({ node: "initialize-stop" }, () =>
          this.devices.stopApplication(
            row.target,
            payload.app.bundle_name,
            signal,
          ),
        );
        await withTrace({ node: "initialize-launch" }, () =>
          this.devices.launch(row.target, payload.app, signal, true),
        );
      }
      await this.sample(row, payload, signal);
      payload.initialized = true;
      await this.captureLogs(row, payload, "initialize", "initialize", signal);
      this.write(row.run_id, payload);
    }
  }
  private async captureLogs(
    row: Row,
    payload: Payload,
    step: string,
    stage: string,
    signal: AbortSignal,
  ) {
    const result = await this.logs.capture(
      row.target,
      payload.app.bundle_name,
      payload.log_anchor,
      payload.log_chunks.length,
      step,
      stage,
      signal,
    );
    if (result.anchor) payload.log_anchor = result.anchor;
    payload.log_chunks.push(result.chunk);
  }
  private readLogs(input: Extract<Input, { action: "logs" }>) {
    const row = this.row(input.test_id),
      payload = this.payload(row);
    if (input.chunk_id === undefined)
      return {
        test_id: input.test_id,
        run_id: input.test_id,
        target: row.target,
        bundle_name: payload.app.bundle_name,
        complete: false,
        chunks: payload.log_chunks,
      };
    const chunk = payload.log_chunks.find(
      (chunk) => chunk.id === input.chunk_id,
    );
    invariant(
      chunk,
      "UI_TEST_LOG_NOT_FOUND",
      "List this test's log chunks before reading one",
    );
    invariant(
      chunk.status === "captured" && chunk.artifact_id,
      "UI_TEST_LOG_UNAVAILABLE",
      `This interval has no attributable log artifact: ${chunk.code ?? "unknown"}`,
    );
    const content = chunk.bytes
      ? this.store
          .readBinaryArtifact(chunk.artifact_id, 1024 * 1024, ["text/plain"])
          .data.toString("utf8")
      : "";
    const lines = content
      .trimEnd()
      .split("\n")
      .filter(
        (line) =>
          line &&
          (!input.search_keywords.length ||
            input.search_keywords.some((keyword) => line.includes(keyword))),
      );
    const selected: string[] = [];
    let bytes = 0,
      next = input.offset;
    for (let index = input.offset; index < lines.length; index++) {
      const line = lines[index]!,
        length = Buffer.byteLength(line + "\n");
      if (bytes + length > input.limit) break;
      bytes += length;
      selected.push(line);
      next = index + 1;
    }
    invariant(
      next > input.offset || input.offset >= lines.length,
      "UI_TEST_LOG_LINE_TOO_LARGE",
      "The next matching line exceeds limit; increase it or read the raw artifact in pages",
    );
    return {
      test_id: input.test_id,
      run_id: input.test_id,
      target: row.target,
      bundle_name: payload.app.bundle_name,
      chunk,
      matching_lines: lines.length,
      offset: input.offset,
      next_offset: next < lines.length ? next : null,
      content: selected.join("\n"),
      bytes,
      matching: "literal_any_keyword",
      complete: false,
    };
  }
  private acceptReviewedReplan(id: string, payload: Payload) {
    const replan = payload.replans.at(-1);
    if (
      !replan ||
      replan.accepted ||
      !this.reviews.status(replan.review_id).verified
    )
      return;
    for (const action of payload.actions)
      if (replan.reconcile_attempt_ids.includes(action.id))
        action.reconciled = true;
    const previous = payload.actions.at(-1);
    if (previous) {
      payload.strategy_operation_hash = digest(previous.operation);
      payload.strategy_signature = replan.sample.signature;
    }
    payload.no_progress = 0;
    delete payload.blocked;
    replan.accepted = true;
    this.write(id, payload);
  }
  private async act(
    row: Row,
    payload: Payload,
    input: Extract<Input, { action: "act" }>,
    signal: AbortSignal,
  ) {
    const prior = payload.actions.find(
      (action) => action.id === input.attempt_id,
    );
    if (prior) {
      invariant(
        prior.step_id === input.step_id &&
          digest(prior.operation) === digest(input.operation),
        "UI_TEST_ATTEMPT_CONFLICT",
        "attempt_id already names different action input",
      );
      invariant(
        prior.state === "accepted",
        "EFFECT_UNCERTAIN",
        "This attempt may have executed; inspect current state and replan, never replay it",
      );
      return { ...this.status(row.run_id), deduplicated: true };
    }
    invariant(
      payload.initialized && payload.steps.length,
      "UI_TEST_NOT_READY",
      "Persist a plan and resume before actions",
    );
    const step = this.current(payload);
    invariant(
      input.step_id === step.id,
      "UI_TEST_STEP_ORDER",
      "Execute the first step whose requirements have not passed",
    );
    invariant(
      !payload.blocked &&
        !payload.actions.some(
          (action) => action.state !== "accepted" && !action.reconciled,
        ),
      "UI_TEST_REPLAN_REQUIRED",
      "Inspect fresh evidence and replan before further actions",
    );
    const replan = payload.replans.at(-1);
    invariant(
      !replan ||
        replan.accepted ||
        this.reviews.status(replan.review_id).status !== "required",
      "UI_TEST_REPLAN_REVIEW_REQUIRED",
      "Read and complete the captured replan review before further device actions",
    );
    invariant(
      payload.actions.length < 200 &&
        payload.actions.filter((action) => action.step_id === step.id).length <
          40,
      "UI_TEST_ACTION_BUDGET",
      "Action budget reached; finish/cancel this test and design a smaller plan",
    );
    const bundle =
      input.operation.window?.bundle_name ??
      input.operation.selector?.bundle_name ??
      payload.app.bundle_name;
    invariant(
      payload.allowed_bundles.includes(bundle) &&
        (!input.operation.selector?.bundle_name ||
          input.operation.selector.bundle_name === bundle),
      "UI_TEST_SCOPE_MISMATCH",
      "Action must target one captured application scope",
    );
    invariant(
      payload.display_id === undefined ||
        input.operation.display_id === undefined ||
        input.operation.display_id === payload.display_id,
      "UI_TEST_SCOPE_MISMATCH",
      "Action display differs from the captured display",
    );
    const operation = controlSchema.parse({
      ...input.operation,
      ...(payload.display_id === undefined
        ? {}
        : { display_id: payload.display_id }),
      window: { ...input.operation.window, bundle_name: bundle },
      ...(input.operation.selector
        ? { selector: { ...input.operation.selector, bundle_name: bundle } }
        : {}),
    });
    const before = await this.sample(row, payload, signal);
    // Reject ambiguous targets or malformed operations before publishing a mutation intent.
    uiInputArguments(resolveControl(operation, before.snapshot));
    invariant(
      !payload.strategy_operation_hash ||
        payload.strategy_operation_hash !== digest(input.operation) ||
        payload.strategy_signature !== before.saved.signature,
      "UI_TEST_STRATEGY_UNCHANGED",
      "The previous action and target state are unchanged; choose a different locator or operation after replanning",
    );
    const record: z.infer<typeof actionSchema> = {
      id: input.attempt_id,
      step_id: step.id,
      operation: input.operation,
      state: "pending",
      before: before.saved,
      created: Date.now(),
      reconciled: false,
    };
    payload.actions.push(record);
    this.store.db
      .transaction(() => {
        const previous = payload.checks.findLast(
          (check) => check.step_id === step.id,
        );
        if (
          previous?.review_id &&
          this.reviews.status(previous.review_id).status === "required"
        )
          this.reviews.cancel(previous.review_id);
        this.write(row.run_id, payload);
      })
      .immediate();
    try {
      const receipt = await withTrace(
        { node: `action-${input.attempt_id}` },
        () =>
          this.devices.control(row.target, operation, signal, before.snapshot),
      );
      invariant(
        receipt.commandAccepted || receipt.outcomeVerified,
        "UI_ACTION_UNCONFIRMED",
        "Native control supplied neither an acceptance receipt nor a recovered outcome",
      );
      record.state = "accepted";
      this.write(row.run_id, payload);
      record.after = (await this.sample(row, payload, signal)).saved;
      const unchanged =
        record.before.signature === record.after.signature &&
        record.before.frame_signature === record.after.frame_signature;
      payload.no_progress = unchanged ? payload.no_progress + 1 : 0;
      delete payload.strategy_operation_hash;
      delete payload.strategy_signature;
      if (payload.no_progress >= 3) payload.blocked = "no_progress";
      this.write(row.run_id, payload);
      await this.captureLogs(
        row,
        payload,
        step.id,
        `action:${record.id}`,
        signal,
      );
      this.write(row.run_id, payload);
      this.store.event(row.run_id, "ui_test_action", {
        attempt_id: record.id,
        step_id: step.id,
        action: operation.action,
        outcome: "accepted",
        progress: unchanged ? "unchanged" : "changed",
        verified: false,
      });
    } catch (error) {
      if (record.state !== "accepted") {
        record.state = "uncertain";
        payload.blocked = "uncertain";
      }
      record.error_code = errorResult(error).code;
      this.write(row.run_id, payload);
      throw error;
    }
    return this.status(row.run_id);
  }
  private async check(
    row: Row,
    payload: Payload,
    signal: AbortSignal,
    recapture: boolean,
  ) {
    invariant(
      payload.initialized,
      "UI_TEST_NOT_READY",
      "Resume the captured test first",
    );
    const step = this.current(payload),
      prior = payload.checks.findLast((check) => check.step_id === step.id);
    // Return the existing pending/settled review until a new device action changes this step.
    if (
      !recapture &&
      prior?.review_id &&
      payload.actions.findLastIndex((action) => action.step_id === step.id) <
        prior.action_count
    )
      return this.status(row.run_id);
    invariant(
      payload.checks.length < 200,
      "UI_TEST_CHECK_BUDGET",
      "Test verification budget reached",
    );
    const record: z.infer<typeof checkSchema> = {
      step_id: step.id,
      assertion_passed: false,
      created: Date.now(),
      action_count: payload.actions.length,
    };
    try {
      const { display } = await this.surface(row, payload, signal);
      if (
        recapture &&
        prior?.review_id &&
        this.reviews.status(prior.review_id).status === "required"
      )
        this.reviews.cancel(prior.review_id);
      const report = z
        .object({
          verified: z.boolean(),
          assertion: z.object({ status: z.string() }),
          review_id: z.string().optional(),
          report_artifact: z.object({ artifact_id: z.string() }),
        })
        .parse(
          await withTrace({ node: `check-${payload.checks.length}` }, () =>
            this.verification.verify(
              row.target,
              {
                ...(step.assert
                  ? { assert: this.scopedAssertion(payload, step.assert) }
                  : {}),
                review: step.review,
                capture: {
                  format: "jpeg",
                  ...(display === null ? {} : { display_id: Number(display) }),
                },
              },
              signal,
            ),
          ),
        );
      record.assertion_passed =
        report.assertion.status === "passed" ||
        (!step.assert && report.assertion.status === "not_requested");
      record.review_id = report.review_id;
      record.report_artifact = report.report_artifact.artifact_id;
    } catch (error) {
      signal.throwIfAborted();
      record.error_code = errorResult(error).code;
      if (error instanceof ToolError) {
        const detail = z
          .object({
            report_artifact: z.object({ artifact_id: z.string() }),
            review_id: z.string().optional(),
          })
          .safeParse(error.details);
        if (detail.success) {
          record.report_artifact = detail.data.report_artifact.artifact_id;
          record.review_id = detail.data.review_id;
        }
      }
    }
    payload.checks.push(record);
    await this.captureLogs(row, payload, step.id, "check", signal);
    if (this.passed(payload, step)) {
      payload.no_progress = 0;
      if (payload.blocked === "no_progress") delete payload.blocked;
    }
    this.write(row.run_id, payload);
    return this.status(row.run_id);
  }
  private async mutate(
    input: Exclude<
      Input,
      | { action: "start" }
      | { action: "status" }
      | { action: "cancel" }
      | { action: "logs" }
      | { action: "report" }
      | { action: "export" }
    >,
    signal: AbortSignal,
  ) {
    const id = input.test_id;
    return withTrace({ run_id: id }, () =>
      this.store.lease(
        `ui-test:${id}`,
        async () => {
          const row = this.row(id),
            payload = this.payload(row);
          invariant(
            row.state === "active",
            "UI_TEST_SETTLED",
            "This test is finished or cancelled",
          );
          this.store.claim(id);
          this.store.activate(id);
          try {
            this.acceptReviewedReplan(id, payload);
            let result: unknown;
            if (input.action === "plan") {
              invariant(
                !payload.steps.length && !payload.actions.length,
                "UI_TEST_PLAN_FROZEN",
                "The ordered requirements are immutable once a plan is captured; replan changes strategy, never removes requirements",
              );
              payload.steps = uiTestPlanSchema.parse(input.steps);
              this.validatePlan(payload, payload.steps);
              this.write(id, payload);
              result = this.status(id);
            } else if (input.action === "finish") {
              invariant(
                payload.initialized &&
                  payload.steps.length > 0 &&
                  payload.steps.every((step) => this.passed(payload, step)) &&
                  !payload.actions.some(
                    (action) =>
                      action.state !== "accepted" && !action.reconciled,
                  ),
                "UI_TEST_INCOMPLETE",
                "Every original step needs passing control/visual evidence, and uncertain actions must be reconciled",
              );
              const report = this.report(id, payload, true);
              this.store.db
                .transaction(() => {
                  this.store.db
                    .prepare(
                      "UPDATE ui_tests SET state='finished',updated=? WHERE run_id=?",
                    )
                    .run(Date.now(), id);
                  this.store.update(id, "succeeded", {
                    test_id: id,
                    verified: true,
                    steps: payload.steps.length,
                    report_artifact: report,
                  });
                })
                .immediate();
              return this.status(id);
            } else
              result = await this.store.lease(
                `device:${row.target}`,
                async () => {
                  this.checkRecording(row.target);
                  if (input.action === "resume") {
                    await this.initialize(row, payload, signal);
                    return this.status(id);
                  }
                  if (input.action === "act")
                    return this.act(row, payload, input, signal);
                  if (input.action === "check")
                    return this.check(row, payload, signal, input.recapture);
                  if (input.action === "replan") {
                    invariant(
                      payload.replans.length < 20,
                      "UI_TEST_REPLAN_BUDGET",
                      "Replan budget reached; inspect results and cancel this test if its goal is not reachable",
                    );
                    const uncertain = payload.actions.filter(
                      (action) =>
                        action.state !== "accepted" && !action.reconciled,
                    );
                    invariant(
                      !uncertain.length || input.reconcile_uncertain,
                      "UI_TEST_UNCERTAIN",
                      "Explicitly reconcile the uncertain action against the fresh screenshot before continuing",
                    );
                    const previousReplan = payload.replans.at(-1);
                    invariant(
                      !previousReplan ||
                        previousReplan.accepted ||
                        this.reviews.status(previousReplan.review_id).status !==
                          "required",
                      "UI_TEST_REPLAN_REVIEW_REQUIRED",
                      "Read and complete the existing replan's visual review first",
                    );
                    const sample = (await this.sample(row, payload, signal))
                      .saved;
                    const review = this.reviews.create({
                      run_id: id,
                      target: row.target,
                      artifact_id: sample.artifact_id,
                      sha256: sample.sha256,
                      assertion_status: "not_requested",
                      requirement: `Inspect this fresh screenshot and report the current application state before applying a new strategy. Reason: ${input.reason.slice(0, 1500)} Strategy: ${input.strategy.slice(0, 1500)}${
                        uncertain.length
                          ? ` Reconcile whether uncertain attempts ${uncertain
                              .map((action) => action.id)
                              .join(", ")
                              .slice(
                                0,
                                600,
                              )} changed the intended target. Use insufficient if this image cannot establish the state.`
                          : " State the visible target that justifies the new strategy."
                      }`,
                    });
                    payload.replans.push({
                      reason: input.reason,
                      strategy: input.strategy,
                      sample,
                      review_id: review.review_id,
                      reconcile_attempt_ids: uncertain.map(
                        (action) => action.id,
                      ),
                      accepted: false,
                      created: Date.now(),
                    });
                    this.write(id, payload);
                    return this.status(id);
                  }
                  throw new ToolError(
                    "UI_TEST_ACTION_INVALID",
                    "Unsupported UI test action",
                  );
                },
                signal,
              );
            this.store.update(id, "needs_input", { test_id: id });
            return { ...(result as object), status: "needs_input" };
          } catch (error) {
            this.store.update(
              id,
              "needs_input",
              { test_id: id },
              { code: errorResult(error).code },
            );
            throw error;
          }
        },
        signal,
      ),
    );
  }
  async call(input: Input, signal?: AbortSignal): Promise<unknown> {
    this.shutdown.signal.throwIfAborted();
    signal?.throwIfAborted();
    if (input.action === "start") {
      const previous =
        input.request_key && this.store.byRequest(input.request_key);
      if (previous) {
        invariant(
          previous.workflow === "ui_test",
          "REQUEST_KEY_CONFLICT",
          "Request key belongs to a different workflow",
        );
        return this.start(input, input.target ?? this.row(previous.id).target);
      }
      const target = await this.devices.target(input.target, signal);
      return this.store.lease(
        `device:${target}`,
        async () => this.start(input, target),
        signal,
      );
    }
    if (input.action === "status") return this.status(input.test_id);
    if (input.action === "logs") return this.readLogs(input);
    if (input.action === "cancel") return this.cancel(input.test_id, signal);
    invariant(
      !this.active.has(input.test_id),
      "UI_TEST_BUSY",
      "Another operation is in progress for this test",
    );
    const controller = new AbortController(),
      combined = AbortSignal.any([
        controller.signal,
        this.shutdown.signal,
        ...(signal ? [signal] : []),
      ]);
    const promise =
      input.action === "report" || input.action === "export"
        ? this.store.lease(
            `ui-test:${input.test_id}`,
            async () => {
              const row = this.row(input.test_id),
                payload = this.payload(row);
              const run = this.store.get(input.test_id);
              invariant(
                run.owner === null &&
                  !this.store.db
                    .prepare("SELECT 1 FROM run_pins WHERE run_id=?")
                    .get(input.test_id),
                "UI_TEST_BUSY",
                "Wait for the current operation or export to finish",
              );
              const report = this.report(input.test_id, payload);
              if (input.action === "report")
                return {
                  test_id: input.test_id,
                  run_id: input.test_id,
                  report_artifact: report,
                };
              const exported = await this.storage.export(
                [input.test_id],
                input.directory,
                combined,
              );
              return {
                ...exported,
                test_id: input.test_id,
                report_artifact: report,
              };
            },
            combined,
          )
        : this.mutate(input, combined);
    this.active.set(input.test_id, { controller, promise });
    try {
      return await promise;
    } finally {
      this.active.delete(input.test_id);
    }
  }
  async cancel(id: string, signal?: AbortSignal) {
    const active = this.active.get(id);
    if (active) {
      active.controller.abort(new ToolError("CANCELLED", "UI test cancelled"));
      await active.promise.catch(() => {});
    }
    return this.store.lease(
      `ui-test:${id}`,
      async () => {
        const row = this.row(id);
        const result = () => ({
          test_id: id,
          run_id: id,
          status: this.store.get(id).status,
          verified: this.store.get(id).status === "succeeded",
        });
        if (row.state !== "active") return result();
        this.store.claim(id);
        this.store.db
          .transaction(() => {
            this.store.db
              .prepare(
                "UPDATE ui_tests SET state='cancelled',updated=? WHERE run_id=?",
              )
              .run(Date.now(), id);
            this.store.db
              .prepare(
                "UPDATE ui_reviews SET status='cancelled',updated=? WHERE run_id=? AND status='required'",
              )
              .run(Date.now(), id);
            this.store.update(id, "cancelled", {
              test_id: id,
              verified: false,
            });
          })
          .immediate();
        return result();
      },
      signal,
      { quotaRecovery: true },
    );
  }
  async close() {
    this.shutdown.abort(
      new ToolError("CANCELLED", "UI test service is stopping"),
    );
    await Promise.allSettled(
      [...this.active.values()].map((active) => active.promise),
    );
    this.cipher.close();
  }
}
