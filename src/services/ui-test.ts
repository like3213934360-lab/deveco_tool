import { evidenceSealSchema, resolveEvidenceResult, verifyEvidenceArtifacts } from "./evidence-result.js";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withinDeadline } from "../core/deadline.js";
import { requirementBindingsSchema } from "../core/acceptance-contracts.js";
import { captureEvidenceIdentity, compareEvidenceIdentity, evidenceIdentitySchema } from "./evidence-identity.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  appSchema,
  assertionSchema,
  controlSchema,
  tools,
  uiTestPlanSchema,
  uiTestCheckAfterSchema,
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
import { UiTestContinuousLogService } from "./ui-test-continuous-log.js";

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
  check_after: uiTestCheckAfterSchema.optional(),
  settling: z.strictObject({ state: z.enum(["stable", "timeout"]), samples: z.number().int(), elapsed_ms: z.number() }).optional(),
  state: z.enum(["pending", "accepted", "uncertain"]),
  before: sampleSchema,
  after: sampleSchema.optional(),
  created: z.number(),
  error_code: z.string().optional(),
  reconciled: z.boolean().default(false),
});
const checkSchema = z.strictObject({
  attempt_id: z.string().uuid().optional(),
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
  requirements: requirementBindingsSchema.optional(),
  evidence_scope: z.object({project_path:z.string().optional(),product:z.string().optional(),module_targets:z.record(z.string(),z.string()).optional(),target:z.string(),app:appSchema,display_id:z.number().optional()}).optional(),
  evidence_identity: evidenceIdentitySchema.optional(),
  deployment:z.object({run_id:z.string().uuid(),result_sha256:z.string()}).optional(),
  app: appSchema,
  fresh_start: z.boolean(),
  allowed_bundles: z.array(appSchema.shape.bundle_name).min(1).max(17),
  display_id: z.number().int().min(0).max(2147483647).optional(),
  steps: z.array(uiTestStepSchema).max(100),
  initialized: z.boolean().default(false),
  initialization_stage: z.enum(["stop", "launch", "sample"]).optional(),
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
  readonly continuousLogs: UiTestContinuousLogService;
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
    this.continuousLogs = UiTestContinuousLogService.forDevice(store, devices);
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
  captureIdentity = captureEvidenceIdentity;
  private evidenceFreshness(payload: Payload) {
    if (!payload.evidence_identity || !payload.evidence_scope) return { current: false, status: "legacy_unbound", changed: ["evidence_identity"] };
    try {
      if(payload.deployment) this.checkDeployment(payload,payload.deployment.run_id,payload.deployment.result_sha256);
      const changed=compareEvidenceIdentity(payload.evidence_identity,this.captureIdentity(payload.evidence_scope,payload.requirements,!!payload.evidence_identity.toolchain_sha256));
      return {current: !changed.length,status:changed.length?"stale":"current",changed};
    } catch(error) {return {current:false,status:"unavailable",changed:[],error:errorResult(error)};}
  }
  private boundSteps(payload: Payload, steps: Payload["steps"]) {
    const ids=payload.requirements?.map(item=>item.id) ?? ["original"];
    return steps.map(step=>({...step,requirement_ids:step.requirement_ids ?? (ids.length===1 ? ids : undefined), task_ids:step.task_ids ?? [step.id]}));
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
  private next(row: Row, payload: Payload): {
    state: string; step_id?: string; reason: string;
    calls: { tool: string; arguments: Record<string, unknown>; requires?: string[] }[];
    review?: ReturnType<UiReviewService["status"]>;
  } {
    const id = row.run_id;
    const call = (action: string, args: Record<string, unknown> = {}, requires?: string[]) =>
      ({ tool: "ui_test", arguments: { action, test_id: id, ...args }, ...(requires ? { requires } : {}) });
    if (row.state !== "active") return { state: "complete", reason: "Inspect or export retained evidence", calls: [call("report")] };
    if (!payload.evidence_identity) return { state: "legacy_unbound", reason: "Export/cancel this unbound test and start fresh scoped evidence", calls: [call("report"), call("cancel")] };
    if (!payload.steps.length) return { state: "plan_required", reason: "Capture ordered assertions/reviews once", calls: [call("plan", {}, ["steps"])] };
    if (!payload.initialized) return { state: "initialization_required", reason: "Resume initialization of the captured app; fresh_start=false preserves its state", calls: [call("resume")] };
    const step = payload.steps.find(step => !this.passed(payload, step));
    const reviewNext = (reviewId: string, reason: string) => {
      const review = this.reviews.status(reviewId);
      return { state: "visual_review_required", ...(step ? { step_id: step.id } : {}), reason, review,
        calls: [{ tool: "workflow_run", arguments: { action: "read_artifact", artifact_id: review.artifact_id, as: "image" } },
          { tool: "ui_review", arguments: { action: "complete", review_id: review.review_id, artifact_id: review.artifact_id, sha256: review.sha256 }, requires: ["read_token", "assessment"] }] };
    };
    const replan = payload.replans.at(-1);
    if (replan && !replan.accepted) {
      const review = this.reviews.status(replan.review_id);
      if (review.status === "required") return reviewNext(replan.review_id, "Inspect current state before accepting the changed strategy or reconciling an uncertain action");
      if (review.verified) return { state: "replan_ready", reason: "Apply the completed review to the captured strategy", calls: [call("resume")] };
    }
    const uncertain = payload.actions.some(action => action.state !== "accepted" && !action.reconciled);
    if (uncertain) return { state: "action_uncertain", reason: "Inspect fresh state and explicitly reconcile; do not replay this attempt", calls: [call("replan", { reconcile_uncertain: true }, ["reason", "strategy"])] };
    if (!step) return { state: "ready_to_finish", reason: "Every original step passed; finish rechecks evidence identity", calls: [call("finish")] };
    const check = payload.checks.findLast(item => item.step_id === step.id);
    const freshCheck = check && payload.actions.findLastIndex(item => item.step_id === step.id) < check.action_count;
    if (freshCheck && check.assertion_passed && !check.error_code && check.review_id) {
      const review = this.reviews.status(check.review_id);
      if (review.status === "required") return reviewNext(check.review_id, "The native assertion passed or was not requested; the host still needs to assess this image");
      if (!review.verified) return { state: "visual_review_failed", step_id: step.id, reason: "Keep the original requirement; change the UI or explicitly recapture delayed evidence", calls: [call("check", { recapture: true })] };
    }
    if (payload.actions.length >= 200 || payload.actions.filter(action => action.step_id === step.id).length >= 40)
      return { state: "action_budget_reached", step_id: step.id, reason: "No further actions fit this test budget; check the result or retain evidence and cancel", calls: [call("check"), call("cancel")] };
    if (payload.blocked) return { state: "no_progress", step_id: step.id, reason: "No observed progress; check the outcome or review fresh evidence with a changed strategy", calls: [call("check"), call("replan", {}, ["reason", "strategy"])] };
    return { state: freshCheck ? "assertion_failed" : "check_required", step_id: step.id,
      reason: freshCheck ? "Correct the UI or recheck a delayed result; the action does not need to be repeated" : "Check this step's current outcome; use a scoped action if the intended state is not reached",
      calls: [call("check", freshCheck ? { recapture: true } : {}), call("act", { step_id: step.id }, ["attempt_id", "operation"])] };
  }
  status(id: string, checkedFreshness?: ReturnType<UiTestService["evidenceFreshness"]>) {
    const row = this.row(id),
      payload = this.payload(row),
      run = this.store.get(id);
    const freshness = checkedFreshness ?? {current:null,status:payload.evidence_identity?"not_rechecked":"legacy_unbound",changed:[]};
    const pending = payload.actions.some(
      (action) => action.state !== "accepted" && !action.reconciled,
    );
    const next = this.next(row, payload);
    return {
      test_id: id,
      run_id: id,
      next,
      target: row.target,
      bundle_name: payload.app.bundle_name,
      allowed_bundles: payload.allowed_bundles,
      display_id: payload.display_id ?? null,
      test_plan: payload.test_plan,
      requirements: payload.requirements ?? [{id:"original",revision:1,text:payload.test_plan}],
      evidence_freshness: freshness,
      deployment:payload.deployment ?? null,
      application_identity_scope:payload.deployment ? "Linked native deployment receipt; this task blocks conflicting MCP device mutations. External installation changes are not independently attested." : "Observed device/application only; no claim that local project artifacts are installed",
      verification_scope: "Captured assertions and host visual assessments; original prose translation is host-owned",
      status: run.status,
      initialized: payload.initialized,
      initialization_stage: payload.initialized ? "complete" : payload.initialization_stage ?? (payload.fresh_start ? "stop" : "sample"),
      verified: row.state === "finished" && run.status === "succeeded" && !!payload.evidence_identity,
      ...(row.state === "finished" && run.status === "succeeded" && payload.evidence_identity ? {
        optional_acceptance: { tool: "domain_acceptance", arguments: { action: "assess", evidence_run_ids: [id] },
          requires: ["requirements"], purpose: "For requested requirement-level delivery, resolve this test's original task/assertion/review links." },
      } : {}),
      verification_time: "at_capture",
      current_verified: checkedFreshness ? checkedFreshness.current && row.state==="finished" : null,
      blocked: pending ? "uncertain" : (payload.blocked ?? null),
      next_action:
        row.state !== "active"
          ? "inspect report or export retained evidence"
          : !payload.evidence_identity
            ? "Legacy evidence is unbound: export/cancel this test and start a new scoped test; retained images are not silently rebound"
          : !payload.steps.length
            ? "plan"
            : !payload.initialized
              ? "resume"
              : next.state,
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
      optional_crash_diagnosis: { tool: "workflow_run", arguments: { action: "start", workflow: "crash_diagnose", input: { source_run_id: id } },
        purpose: "When investigating a failure, analyze this test's retained log snapshot without replaying UI actions." },
      continuous_logs: this.continuousLogs.status(id),
      log_scope:
        "Continuous capture and legacy interval samples are separate sources. Continuous chunks verify PID generations and time bounds; gaps and unknown system delivery remain explicit. Step labels describe receipt context, not causality.",
      report_artifact: payload.last_report ?? null,
    };
  }
  private report(id: string, payload: Payload, final = false, freshness?: ReturnType<UiTestService["evidenceFreshness"]>) {
    if(final) invariant(freshness?.current,"UI_EVIDENCE_STALE","A final report requires a fresh completion check");
    const { report_artifact: _previous, ...status } = this.status(id,freshness);
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
        ? { status: "succeeded", verified: true, next_action: "complete", next: { state: "complete", calls: [] } }
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
      continuous_chunks: this.continuousLogs.chunks(id, 0, 8192),
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
  private checkDeployment(payload: Payload, run_id: string, expectedDigest?: string) {
    const run=this.store.get(run_id), result=resolveEvidenceResult(this.store,run.result ? JSON.parse(run.result):{});
    invariant(run.status==="succeeded" && ["app_deploy","build_run","build_deploy_verify"].includes(run.workflow),"UI_DEPLOYMENT_INVALID","UI evidence must link a succeeded application deployment");
    const seal=evidenceSealSchema.parse(result._evidence), scope=payload.evidence_scope!;
    invariant(seal.scope.target===scope.target && digest(seal.scope.app)===digest(scope.app),"UI_DEPLOYMENT_SCOPE_MISMATCH","UI test and deployment must target the same device/application component");
    if(scope.project_path) invariant(seal.identity.project_path===payload.evidence_identity?.project_path && seal.identity.product===payload.evidence_identity?.product && digest(seal.identity.module_targets)===digest(payload.evidence_identity?.module_targets),"UI_DEPLOYMENT_SCOPE_MISMATCH","Project UI acceptance must link a deployment built from the same project/product/modules");
    invariant(!compareEvidenceIdentity(seal.identity,this.captureIdentity(seal.scope,seal.requirements,!!seal.identity.toolchain_sha256)).length,"UI_DEPLOYMENT_STALE","Deployment inputs have changed; deploy current artifacts before creating project UI evidence");
    invariant(seal.artifacts.length>0,"UI_DEPLOYMENT_UNBOUND","Deployment has no retained artifact identity");
    verifyEvidenceArtifacts(seal.artifacts,this.store);
    const result_sha256=digest(result);
    invariant(!expectedDigest || result_sha256===expectedDigest,"UI_DEPLOYMENT_CHANGED","Linked deployment result changed");
    return {run_id,result_sha256};
  }
  private deploymentInput(input: Extract<Input, { action: "start" }>) {
    if (!input.deployment_run_id) return input;
    const run = this.store.get(input.deployment_run_id);
    invariant(run.status === "succeeded" && ["app_deploy", "build_run", "build_deploy_verify"].includes(run.workflow),
      "UI_DEPLOYMENT_INVALID", "Select a succeeded application deployment");
    const result = resolveEvidenceResult(this.store, JSON.parse(run.result ?? "{}"));
    const seal = evidenceSealSchema.parse(result._evidence);
    const scope = z.object({
      project_path:z.string().optional(),product:z.string().optional(),module_targets:z.record(z.string(),z.string()).optional(),
      target:z.string(),app:appSchema,display_id:z.number().int().nonnegative().optional(),
    }).parse(seal.scope);
    return { ...input, project_path:input.project_path ?? scope.project_path,
      product:input.product ?? scope.product,module_targets:input.module_targets ?? scope.module_targets,
      target:input.target ?? scope.target,app:input.app ?? scope.app,
      requirements:input.requirements ?? seal.requirements,display_id:input.display_id ?? scope.display_id };
  }
  private start(input: Extract<Input, { action: "start" }>, target: string, captured?: Extract<Input, { action: "start" }>) {
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
        const selected = captured ?? input;
        invariant(selected.app, "UI_APPLICATION_REQUIRED", "Provide app or a succeeded deployment_run_id");
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
          requirements: selected.requirements ?? [{id:"original",revision:1,text:input.test_plan}],
          app: selected.app,
          fresh_start: input.fresh_start,
          steps: input.steps ?? [],
          allowed_bundles: [
            ...new Set([selected.app.bundle_name, ...input.allowed_bundles]),
          ],
          display_id: selected.display_id,
        });
        payload.steps=this.boundSteps(payload,payload.steps);
        payload.evidence_scope={project_path:selected.project_path,product:selected.product,module_targets:selected.module_targets,target,app:selected.app,display_id:selected.display_id};
        payload.evidence_identity=this.captureIdentity(payload.evidence_scope,payload.requirements);
        if(input.deployment_run_id) payload.deployment=this.checkDeployment(payload,input.deployment_run_id);
        this.validatePlan(payload, payload.steps);
        const json = JSON.stringify(payload);
        this.store.capacity(Buffer.byteLength(json) * 4 + 16384);
        const { run } = this.store.create(
          "ui_test",
          { target, app: selected.app, requirements:payload.requirements },
          input.request_key,
          { ...input, target },
        );
        if(payload.deployment) this.store.db.prepare("INSERT OR IGNORE INTO run_dependencies VALUES (?,?)").run(run.id,payload.deployment.run_id);
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
    if (payload.requirements && steps.length) {
      const known=new Set(payload.requirements.map(item=>item.id));
      invariant(steps.every(step=>step.requirement_ids?.length && step.requirement_ids.every(id=>known.has(id)) && step.task_ids?.length),"UI_REQUIREMENT_REFERENCE_INVALID","Every step must link declared requirements and task IDs");
      invariant(payload.requirements.every(item=>steps.some(step=>step.requirement_ids?.includes(item.id))),"UI_REQUIREMENT_UNCOVERED","Each captured requirement needs at least one assertion/review step");
    }
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
      if (payload.fresh_start && (!payload.initialization_stage || payload.initialization_stage === "stop")) {
        await withTrace({ node: "initialize-stop" }, () =>
          this.devices.stopApplication(
            row.target,
            payload.app.bundle_name,
            signal,
          ),
        );
        payload.initialization_stage = "launch";
        this.write(row.run_id, payload);
      }
      if (payload.fresh_start && payload.initialization_stage === "launch") {
        await withTrace({ node: "initialize-launch" }, () =>
          this.devices.launch(row.target, payload.app, signal, true),
        );
        payload.initialization_stage = "sample";
        this.write(row.run_id, payload);
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
      this.logSecrets(payload),
    );
    if (result.anchor) payload.log_anchor = result.anchor;
    payload.log_chunks.push(result.chunk);
  }
  diagnosticLogs(id: string) {
    const row = this.row(id), payload = this.payload(row), continuous = this.continuousLogs.status(id);
    const current = this.continuousLogs.chunks(id, Math.max(0, continuous.chunk_count - 64), 64);
    const legacy = payload.log_chunks.slice(-64);
    return { target: row.target, bundle_name: payload.app.bundle_name, chunks: [...legacy, ...current],
      omitted_chunks: payload.log_chunks.length + continuous.chunk_count - legacy.length - current.length, continuous };
  }
  private readLogs(input: Extract<Input, { action: "logs" }>) {
    const row = this.row(input.test_id),
      payload = this.payload(row);
    if (input.chunk_id === undefined) {
      const continuous = this.continuousLogs.status(input.test_id),
        legacyCount = payload.log_chunks.length,
        offset = input.chunk_offset,
        legacy = payload.log_chunks.slice(offset, offset + input.chunk_limit),
        current = this.continuousLogs.chunks(input.test_id, Math.max(0, offset - legacyCount), input.chunk_limit - legacy.length),
        count = legacyCount + continuous.chunk_count,
        next = offset + legacy.length + current.length;
      return {
        test_id: input.test_id,
        run_id: input.test_id,
        target: row.target,
        bundle_name: payload.app.bundle_name,
        complete: false,
        continuous,
        chunks: [...legacy, ...current],
        chunk_count: count,
        chunk_offset: offset,
        next_chunk_offset: next < count ? next : null,
      };
    }
    const chunk = input.chunk_id >= 500 ? this.continuousLogs.chunk(input.test_id, input.chunk_id) : payload.log_chunks.find(
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
      `This interval has no attributable log artifact: ${"code" in chunk ? chunk.code : "unknown"}`,
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
  private logSecrets(payload: Payload, extra?: z.infer<typeof controlSchema>) {
    return [...payload.actions.map((action) => action.operation), ...(extra ? [extra] : [])]
      .flatMap((operation) => operation.text ? [operation.text] : []);
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
          digest(prior.operation) === digest(input.operation) &&
          digest(prior.check_after ?? null) === digest(input.check_after ?? null),
        "UI_TEST_ATTEMPT_CONFLICT",
        "attempt_id already names different action input",
      );
      invariant(
        prior.state === "accepted",
        "EFFECT_UNCERTAIN",
        "This attempt may have executed; inspect current state and replan, never replay it",
      );
      return { ...await this.checkAfter(row, payload, prior, signal), deduplicated: true };
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
      check_after: input.check_after,
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
    return this.checkAfter(row, payload, record, signal);
  }
  private async checkAfter(row: Row, payload: Payload, action: Payload["actions"][number], signal: AbortSignal) {
    const response = () => ({ ...this.status(row.run_id), ...(action.check_after ? { action_check: {
      attempt_id: action.id, step_id: action.step_id, settling: action.settling ?? null,
      check: payload.checks.findLast(check => check.attempt_id === action.id) ?? null,
    }} : {}) });
    if (!action.check_after || payload.checks.some(check => check.attempt_id === action.id)) return response();
    // A retry may arrive after another action/check advanced the plan. It cannot check a later step.
    const step = payload.steps.find(step => !this.passed(payload, step));
    if (payload.actions.at(-1)?.id !== action.id || step?.id !== action.step_id ||
        payload.actions.some(item => item.state !== "accepted" && !item.reconciled)) return response();
    if (!action.settling) {
      const started = performance.now();
      let samples = 0, stableSince = started;
      let previous = action.after;
      try {
        await withinDeadline(action.check_after.timeout_ms, signal, "UI_TEST_SETTLE_TIMEOUT", async bounded => {
          // At most 21 new samples within the caller's bounded window; no claim of business success.
          for (let index = 0; index < 21; index++) {
            await delay(Math.min(250, action.check_after!.stable_ms), undefined, { signal: bounded });
            const current = (await this.sample(row, payload, bounded)).saved;
            samples++;
            if (!previous || previous.signature !== current.signature || previous.frame_signature !== current.frame_signature) stableSince = performance.now();
            previous = current;
            if (performance.now() - stableSince >= action.check_after!.stable_ms) return;
          }
          throw new ToolError("UI_TEST_SETTLE_TIMEOUT", "Stability observation budget reached");
        });
        action.settling = { state: "stable", samples, elapsed_ms: performance.now() - started };
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof ToolError) || error.code !== "UI_TEST_SETTLE_TIMEOUT") throw error;
        action.settling = { state: "timeout", samples, elapsed_ms: performance.now() - started };
      }
      this.write(row.run_id, payload);
    }
    if (action.settling.state === "stable") await this.check(row, payload, signal, false, action.id);
    return response();
  }
  private async check(
    row: Row,
    payload: Payload,
    signal: AbortSignal,
    recapture: boolean,
    attemptId?: string,
  ) {
    invariant(
      payload.initialized,
      "UI_TEST_NOT_READY",
      "Resume the captured test first",
    );
    invariant(!payload.actions.some(action => action.state !== "accepted" && !action.reconciled),
      "UI_TEST_UNCERTAIN", "Inspect and reconcile uncertain actions before checking a step");
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
      ...(attemptId ? { attempt_id: attemptId } : {}),
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
      if (report.review_id) record.review_id = report.review_id;
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
    this.write(row.run_id, payload);
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
              payload.steps = this.boundSteps(payload,uiTestPlanSchema.parse(input.steps));
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
              await this.continuousLogs.stop(id, "test_finished");
              const freshness=this.evidenceFreshness(payload);
              invariant(freshness.current,"UI_EVIDENCE_STALE","The captured source/configuration/runtime/requirement identity is stale or unbound; retain this test and start fresh acceptance");
              const report = this.report(id, payload, true, freshness);
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
                    _evidence: {format:1,identity:payload.evidence_identity,scope:payload.evidence_scope,requirements:payload.requirements,deployment:payload.deployment,recorded_at:Date.now(),workflow:"ui_test"},
                  });
                })
                .immediate();
              return this.status(id,freshness);
            } else
              result = await this.store.lease(
                `device:${row.target}`,
                async () => {
                  this.checkRecording(row.target);
                  // Resume/check have no caller-supplied step_id. Attribute
                  // receipt to the pending plan step, including after restart;
                  // an invalid act step must not relabel the live collector.
                  const logStep = payload.steps.find((step) => !this.passed(payload, step))?.id ?? "test";
                  await this.continuousLogs.ensure(id, row.target, payload.app.bundle_name,
                    logStep, input.action,
                    this.logSecrets(payload, input.action === "act" ? input.operation : undefined));
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
            await this.continuousLogs.stop(id, signal.aborted ? "operation_cancelled" : "operation_failed");
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
      const previous = input.request_key && this.store.byRequest(input.request_key);
      if (previous) invariant(previous.workflow === "ui_test", "REQUEST_KEY_CONFLICT", "Request key belongs to a different workflow");
      const captured = previous ? input : this.deploymentInput(input);
      const target = previous ? input.target ?? this.row(previous.id).target : await this.devices.target(captured.target, signal);
      const started = previous ? this.start(input, target) : await this.store.lease(`device:${target}`, async () => this.start(input, target, captured), signal);
      const id = started.test_id;
      if (!(input.initialize ?? !!input.steps?.length) || !input.steps?.length || started.initialized ||
          this.row(id).state !== "active" || this.active.has(id)) return started;
      try {
        return { ...await this.call({ action: "resume", test_id: id }, signal) as object,
          ...(previous ? { deduplicated: true } : {}) };
      } catch (error) {
        // Creation was already committed. Keep its ID available even if initialization needs recovery.
        return { ...this.status(id), initialization_error: errorResult(error),
          ...(previous ? { deduplicated: true } : {}) };
      }
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
              await this.continuousLogs.stop(input.test_id, "evidence_export");
              const exportReport = this.report(input.test_id, payload);
              const exported = await this.storage.export(
                [input.test_id],
                input.directory,
                combined,
              );
              return {
                ...exported,
                test_id: input.test_id,
                report_artifact: exportReport,
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
        await this.continuousLogs.stop(id, "test_cancelled");
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
    await this.continuousLogs.close();
    this.cipher.close();
  }
}
