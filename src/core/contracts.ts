import { selectorSchema, meaningfulSelector, assertionSchema, type Selector } from "./ui-assertion.js";
export { selectorSchema, meaningfulSelector, assertionSchema, type Selector } from "./ui-assertion.js";
import { UI_CONTROL_ACTIONS, UI_FLOW_ACTIONS, UI_FLOW_TO_CONTROL, UI_V2_ACTIONS, UI_ASSERTION_ACTIONS, uiControlIssues } from "./ui-action-contract.js";
import { preflightPolicySchema } from "../services/build-preflight.js";
import { z } from "zod";
import { workflowStartContract, workflowObservationContract, storageContract, storageContracts } from "./workflow-run-contract.js";
import { docCatalogNames } from "./doc-catalog.js";
import { visualAssessmentSchema } from "../services/ui-review.js";
import { skillManageSchema } from "../services/skills.js";
import { skillWorkflowSchema } from "../services/skill-workflow.js";
import { domainRecipeSchema } from "../services/domain-recipes.js";
import { domainAcceptanceSchema, requirementBindingsSchema, requirementBindingSchema } from "./acceptance-contracts.js";
import {
  emulatorManageSchema,
  emulatorScenarioSchema,
} from "./emulator-contracts.js";

export const signingConfigurationOptionsSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
});

export const screenshotOptionsSchema = z.strictObject({
  format: z.enum(["jpeg", "png"]).default("jpeg"),
  width: z.number().int().min(64).max(4096).optional(),
  display_id: z.number().int().nonnegative().safe().optional(),
  if_changed_from: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

const queryFields = {
  selector: selectorSchema.optional(),
  selectors: z
    .array(
      z.strictObject({
        id: z.string().trim().min(1).max(64),
        selector: selectorSchema,
      }),
    )
    .min(1)
    .max(32)
    .optional(),
};
function checkQueries(
  input: { selector?: unknown; selectors?: { id: string }[] },
  ctx: z.RefinementCtx,
) {
  if (input.selector && input.selectors)
    ctx.addIssue({
      code: "custom",
      message: "Provide selector or selectors, not both",
    });
  if (
    input.selectors &&
    new Set(input.selectors.map((x) => x.id)).size !== input.selectors.length
  )
    ctx.addIssue({
      code: "custom",
      path: ["selectors"],
      message: "Query IDs must be unique",
    });
}
const point = z.strictObject({
  xPercent: z.number().min(0).max(100),
  yPercent: z.number().min(0).max(100),
});
const gesture = z.strictObject({
  fromXPercent: z.number().min(0).max(100),
  fromYPercent: z.number().min(0).max(100),
  toXPercent: z.number().min(0).max(100),
  toYPercent: z.number().min(0).max(100),
  velocity: z.number().int().min(200).max(40000).optional(),
  stepLength: z.number().int().min(1).max(65535).optional(),
});
export const controlSchema = z.strictObject({
  action: z.enum(UI_CONTROL_ACTIONS),
  x: z.number().int().nonnegative().optional(),
  y: z.number().int().nonnegative().optional(),
  x2: z.number().int().nonnegative().optional(),
  y2: z.number().int().nonnegative().optional(),
  direction: z.number().int().min(0).max(3).optional(),
  velocity: z.number().int().min(200).max(40000).optional(),
  step_length: z.number().int().min(1).max(65535).optional(),
  display_id: z.number().int().min(0).max(2147483647).optional(),
  window: z
    .strictObject({
      id: z.string().min(1).optional(),
      bundle_name: z.string().min(1).optional(),
    })
    .refine(
      (value) => !!(value.id || value.bundle_name),
      "Window needs an id or bundle_name",
    )
    .optional(),
  point: point.optional(),
  gesture: gesture.optional(),
  text: z.string().min(1).optional(),
  button: z.enum(["left", "right", "middle"]).optional(),
  scroll_down: z.boolean().optional(),
  ticks: z.number().int().min(1).max(1000).optional(),
  mouse_scroll_speed: z.number().int().min(1).max(500).optional(),
  keys: z
    .array(z.string().regex(/^[A-Za-z0-9_]+$/))
    .min(1)
    .max(3)
    .optional(),
  selector: selectorSchema.optional(),
}).superRefine((input, ctx) => {
  for (const issue of uiControlIssues(input)) ctx.addIssue({ code: "custom", ...issue });
});
export const flowIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/);
export const stepSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
  action: z.enum(UI_FLOW_ACTIONS),
  timeoutMs: z.number().int().min(100).max(600000).default(30000)
    .describe("Total step deadline including locator sampling, native input and before/after progress evidence; explicit saved deadlines are preserved"),
  selector: meaningfulSelector.optional(),
  alternates: z.array(meaningfulSelector).max(5).optional(),
  point: point.optional(),
  fragile: z.boolean().optional(),
  value: z
    .string()
    .regex(/^\$\{[A-Za-z][A-Za-z0-9_]*\}$/)
    .optional(),
  key: z
    .string()
    .regex(/^[A-Za-z0-9_]+$/)
    .optional(),
  gesture: gesture.optional(),
  keys: controlSchema.shape.keys,
  direction: controlSchema.shape.direction,
  velocity: controlSchema.shape.velocity,
  step_length: controlSchema.shape.step_length,
  button: controlSchema.shape.button,
  scroll_down: controlSchema.shape.scroll_down,
  ticks: controlSchema.shape.ticks,
  mouse_scroll_speed: controlSchema.shape.mouse_scroll_speed,
  scope: z.strictObject({
    display_id: controlSchema.shape.display_id,
    window_type: z.string().min(1),
    ability_name: z.string().min(1).optional(),
  }).optional().describe("v2 records window identity without persisting an ephemeral window ID; replay requires one matching focused app window"),
});
export const flowSchema = z
  .strictObject({
    version: z.union([z.literal(1), z.literal(2)]),
    id: flowIdSchema,
    name: z.string().min(1),
    app: z.strictObject({
      bundleName: z.string().min(1),
      module: z.string().min(1),
      ability: z.string().min(1),
    }),
    start: z
      .strictObject({ mode: z.enum(["restart", "attach"]).default("restart") })
      .default({ mode: "restart" }),
    variables: z
      .record(
        z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
        z.strictObject({
          required: z.boolean().default(true),
          secret: z.boolean().default(true),
        }),
      )
      .default({}),
    steps: z.array(stepSchema).max(200),
    assert: assertionSchema.optional(),
  })
  .superRefine((flow, context) => {
    const ids = flow.steps.map((step) => step.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: "custom", message: "Step IDs must be unique" });
    for (const step of flow.steps) {
      const nativeAction = UI_FLOW_TO_CONTROL[step.action as keyof typeof UI_FLOW_TO_CONTROL];
      const extended = nativeAction !== undefined && UI_V2_ACTIONS.includes(nativeAction);
      if (flow.version === 1 && (extended || [step.keys, step.scope, step.direction, step.velocity, step.step_length, step.button, step.scroll_down, step.ticks, step.mouse_scroll_speed].some(v => v !== undefined)))
        context.addIssue({ code: "custom", message: `${step.id}: extended actions and fields require flow version 2` });
      if (extended && !step.scope)
        context.addIssue({ code: "custom", message: `${step.id}: extended actions require a recorded window scope` });
      if (
        [
          "tap",
          "doubleTap",
          "longTap",
          "input",
          "waitVisible",
          "waitHidden",
          "assertVisible",
          "assertHidden",
        ].includes(step.action) &&
        !step.selector &&
        !step.point
      )
        context.addIssue({
          code: "custom",
          message: `${step.id}: selector or point required`,
        });
      if (
        ["input", "focusInput"].includes(step.action) &&
        (!step.value || !Object.hasOwn(flow.variables, step.value.slice(2, -1)))
      )
        context.addIssue({
          code: "custom",
          message: `${step.id}: declared input variable required`,
        });
      if (step.action === "key" && ((!step.key && !step.keys) || (step.key && step.keys)))
        context.addIssue({
          code: "custom",
          message: `${step.id}: exactly one key or keys contract required`,
        });
      if (["swipe", "fling", "drag", "mouseMoveWithTrack", "mouseDrag"].includes(step.action) && !step.gesture)
        context.addIssue({
          code: "custom",
          message: `${step.id}: gesture required`,
        });
      if (step.action === "focusInput" && (!step.selector || step.point || step.alternates?.some(selector => selector.text !== undefined || selector.value !== undefined) || step.selector.text !== undefined || step.selector.value !== undefined))
        context.addIssue({ code: "custom", message: `${step.id}: focused text requires a stable selector without captured input values` });
      if (["mouseClick", "mouseDoubleClick", "mouseLongClick", "mouseMoveTo", "mouseScroll"].includes(step.action) && !step.selector && !step.point)
        context.addIssue({ code: "custom", message: `${step.id}: mouse action requires selector or point` });
      if (step.action === "dircFling" && step.direction === undefined)
        context.addIssue({ code: "custom", message: `${step.id}: direction required` });
      if (step.action === "mouseScroll" && (step.scroll_down === undefined || step.ticks === undefined))
        context.addIssue({ code: "custom", message: `${step.id}: scroll direction and ticks required` });
      if (nativeAction) {
        const { id: _id, action: _action, timeoutMs: _timeout, fragile: _fragile, scope: _scope, alternates, value, key, ...fields } = step;
        // Saved-step spelling is translated into the same native action contract;
        // unused parameters are rejected at save time rather than silently lost.
        if (nativeAction === "text") delete fields.selector;
        const operation = { ...fields, action: nativeAction, ...(value !== undefined ? { text: value } : {}), ...(key !== undefined ? { keys: [key] } : {}) };
        for (const issue of uiControlIssues(operation)) context.addIssue({ code: "custom", path: ["steps", flow.steps.indexOf(step), ...issue.path], message: `${step.id}: ${issue.message}` });
        if (alternates && ["keyEvent", "dircFling"].includes(nativeAction)) context.addIssue({ code: "custom", message: `${step.id}: alternates do not apply to ${step.action}` });
      }
      if (UI_ASSERTION_ACTIONS.includes(step.action)) {
        if (!step.selector) context.addIssue({ code: "custom", message: `${step.id}: assertion/wait steps require a selector` });
        for (const field of ["point", "gesture", "value", "key", "keys", "direction", "velocity", "step_length", "button", "scroll_down", "ticks", "mouse_scroll_speed"] as const)
          if (step[field] !== undefined) context.addIssue({ code: "custom", message: `${step.id}: ${field} does not apply to ${step.action}` });
      }

    }
  });
export type Flow = z.infer<typeof flowSchema>;
export const recordingTaskSchema = z
  .strictObject({ draft: flowSchema })
  .refine(
    ({ draft }) =>
      draft.steps.length === 0 &&
      Object.keys(draft.variables).length === 0 &&
      draft.assert === undefined,
    "A recording starts with an empty draft and receives its final assertion when sealed",
  );

export const moduleTargetsSchema = z.record(z.string().min(1).max(256), z.string().min(1).max(256))
  .refine((value) => Object.keys(value).length <= 128, "At most 128 module targets")
  .describe("Build target per module, for example {entry: phone, shared: default}. These are Hvigor targets, independent of the HDC device target.");
export type ModuleTargets = z.infer<typeof moduleTargetsSchema>;
const projectFields = {
  project_path: z.string().min(1).optional(),
  product: z.string().min(1).optional(),
  module_targets: moduleTargetsSchema.optional(),
};
const target = z.string().min(1).optional();
const wantText = z
  .string()
  .max(16384)
  .refine((value) => !value.includes("\0"), "NUL is not supported by aa");
const aaArgument = wantText.refine(
  (value) => value.length > 0 && !value.startsWith("-"),
  "aa arguments must be nonempty and cannot begin with a hyphen",
);
export const wantParametersSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(256)
      .regex(/^[^-\s\0][^\s\0]*$/),
    z.union([
      wantText.refine(
        (value) => !value.startsWith("-"),
        "aa string values cannot begin with a hyphen",
      ),
      z.number().int().min(0).max(4294967295),
      z.boolean(),
    ]),
  )
  .refine(
    (value) => Object.keys(value).length <= 64,
    "At most 64 Want parameters",
  );
export const routeRequestSchema = z
  .strictObject({
    id: z.string().min(1).optional(),
    module: z.string().min(1).optional(),
    ability: z.string().min(1).optional(),
    action: z.string().min(1).optional(),
    uri: wantText.optional(),
    mime_type: z
      .string()
      .regex(/^[^\s/*]+\/[^\s/*]+$/)
      .optional(),
  })
  .refine(
    (value) =>
      !!(
        value.id ||
        value.ability ||
        value.action ||
        value.uri ||
        value.mime_type
      ),
    "Select a declared route by id, ability, action, URI or MIME type",
  );
export const startupCheckSchema = z.strictObject({
  mode: z.enum(["ui", "process_only"]).default("ui")
    .describe("UI checks are default. Use process_only for a deliberately headless ability; it verifies process stability only"),
  stable_ms: z.number().int().min(500).max(5000).default(1500),
  timeout_ms: z.number().int().min(2000).max(30000).default(10000),
  allow_uniform: z.boolean().default(false)
    .describe("An explicit contract that a solid-color screen is valid at startup. It is never a business UI assertion"),
  display_id: z.number().int().min(0).max(2147483647).optional(),
}).refine(value => value.timeout_ms >= value.stable_ms + 1000, "Startup timeout must include the stability window and a query margin");
export const appSchema = z.strictObject({
  bundle_name: z.string().regex(/^[A-Za-z][A-Za-z0-9_.]*$/),
  module: aaArgument.optional(),
  ability: aaArgument,
  uri: aaArgument.optional(),
  action: aaArgument.optional(),
  mime_type: aaArgument.optional(),
  entities: z.array(aaArgument).max(32).optional(),
  parameters: wantParametersSchema.optional(),
  startup_check: startupCheckSchema.optional(),
});
export type ApplicationTarget = z.infer<typeof appSchema>;
export const uiTestStepSchema = z.strictObject({
  requirement_ids: z.array(requirementBindingSchema.shape.id).min(1).max(100).refine(ids => new Set(ids).size === ids.length, "Requirement references must be unique").optional(),
  task_ids: z.array(requirementBindingSchema.shape.id).min(1).max(100).refine(ids => new Set(ids).size === ids.length, "Task references must be unique").optional(),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
  goal: z.string().trim().min(1).max(4096),
  assert: assertionSchema.optional(),
  review: z.strictObject({ requirement: z.string().trim().min(1).max(4096) }).optional(),
}).refine(step => !!(step.assert || step.review), "Each step needs a control assertion or a visual requirement");
export const uiTestCheckAfterSchema = z.strictObject({
  stable_ms: z.number().int().min(100).max(1000).default(250),
  timeout_ms: z.number().int().min(250).max(5000).default(1500),
}).refine(value => value.timeout_ms > value.stable_ms, "timeout_ms must exceed stable_ms");
export const uiTestPlanSchema = z.array(uiTestStepSchema).min(1).max(100).refine(steps => new Set(steps.map(step => step.id)).size === steps.length, "Step IDs must be unique");
export const uiTaskSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("flow"),
    variables: z.record(z.string(), z.string()),
  }),
  z.strictObject({
    kind: z.literal("route"),
    app: appSchema,
    assert: assertionSchema,
  }),
]);
const buildFields = {
  ...projectFields,
  preflight: preflightPolicySchema.default({ mode: "check" }).describe("Default: run a fresh full-scope ArkTS preflight and stop on blocking diagnostics before Hvigor. A deliberate manual_override requires its reason and is recorded."),
  modules: z.array(z.string().min(1)).min(1).optional(),
  mode: z.enum(["debug", "release"]).default("debug"),
  clean: z.boolean().default(false),
  sync: z.union([z.enum(["auto", "force", "skip"]), z.boolean()]).default("auto")
    .describe("auto reuses a retained sync only when installed dependencies, configuration, toolchain and model still match; force always syncs, skip explicitly omits sync. Legacy true=force and false=skip."),
};
const applicationFields = { target, app: appSchema.optional() };
const buildReferenceFields = {
  ...projectFields,
  ...applicationFields,
  build_run_id: z.string().uuid().describe("Reuse a succeeded build with unchanged inputs and packages; no synchronization or compilation is repeated."),
};
const applicationBuildFields = { ...buildFields, ...applicationFields, hot_reload: z.boolean().default(false) };
const verifyApplicationFields = {
  assert: assertionSchema,
  flow_id: flowIdSchema.optional(),
  variables: z.record(z.string(), z.string()).default({}),
};
export const faultlogNameSchema = z
  .string()
  .max(255)
  .regex(/^(?:jscrash|cppcrash|appfreeze)-[A-Za-z0-9_.-]+$/);
const logBundle = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/)
  .optional();
const faultlogAge = z.number().min(0).max(525600).optional();
// SDK modulecheck/app.json: 7–128 ASCII characters, at least three domain
// segments, and no empty segment or leading/trailing segment underscore.
export const projectBundleNameSchema = z.string().min(7).max(128).regex(
  /^[A-Za-z](?:[A-Za-z0-9_]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9_]*[A-Za-z0-9])?){2,}(?![\s\S])/,
);
export const projectAppNameSchema = z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9_]*(?![\s\S])/);
// Hvigor product schema separates the minimum runtime API, target behavior
// API and SDK used for compilation. Component support is checked by the SDK.
export const projectCompatibleApiSchema = z.number().int().min(4);
export const projectTargetApiSchema = z.number().int().min(8);
export const workflowInputs = {
  project_create: z.strictObject({
    project_path: z.string().min(1),
    app_name: projectAppNameSchema,
    bundle_name: projectBundleNameSchema,
    sdk_version: z.union([z.string(), z.number().int().positive()]).optional().describe("Omit to use the configured toolchain's installed default SDK. Explicit versions must match it; no SDK download or toolchain switch occurs."),
    merge: z.boolean().optional().describe("Allow non-overwriting creation into a nonempty directory. Conflicting files/directories/symlinks are rejected before publication."),
    compatible_api: projectCompatibleApiSchema.optional().describe("Minimum device API; defaults to target_api. Must not exceed the target API."),
    target_api: projectTargetApiSchema.optional().describe("Target runtime behavior API; defaults to the selected SDK API. Must not exceed the installed compile SDK API."),
  }),
  project_sync: z.strictObject({
    ...projectFields,
    install: z.boolean().default(true),
  }),
  project_build: z.strictObject({
    ...buildFields,
    task: z
      .enum(["assembleHap", "assembleHar", "assembleHsp", "assembleApp"])
      .default("assembleHap"),
  }).refine((input) => input.task !== "assembleApp" || (!input.modules && Object.keys(input.module_targets ?? {}).length === 0), {
    message: "assembleApp packages the product's configured targets; use assembleHap/Har/Hsp for explicit module or target selection",
    path: ["task"],
  }),
  app_deploy: z.union([z.strictObject({
    packages: z
      .array(
        z.strictObject({
          path: z.string().min(1),
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        }),
      )
      .min(1)
      .max(64),
    ...applicationFields,
  }), z.strictObject(buildReferenceFields)]),
  build_run: z.union([z.strictObject(applicationBuildFields), z.strictObject(buildReferenceFields)]),
  build_deploy_verify: z.union([
    z.strictObject({ ...applicationBuildFields, ...verifyApplicationFields }),
    z.strictObject({ ...buildReferenceFields, ...verifyApplicationFields }),
  ]),
  code_diagnose: z.strictObject({
    ...projectFields,
    files: z.array(z.string()).min(1).optional(),
    checks: z
      .array(z.enum(["arkts", "linter", "lsp", "cpp"]))
      .min(1)
      .default(["arkts"]),
  }),
  crash_diagnose: z
    .strictObject({
      source_run_id: z.string().uuid().optional().describe("Read retained deployment/UI-task logs in their captured scope."),
      collect_missing: z.boolean().optional().describe("With source_run_id, explicitly supplement missing evidence using faultlogs inside the captured device-time window."),
      target,
      log_file: z.string().min(1).optional(),
      log_artifact_id: z.string().uuid().optional(),
      log_text: z.string().min(1).max(32768).optional(),
      faultlog_name: faultlogNameSchema.optional(),
      kind: z.enum(["crash", "hilog"]).optional(),
      lines: z.number().int().min(1).max(10000).optional(),
      max_age_minutes: faultlogAge,
      bundle_name: logBundle,
      process_hint: z.string().min(1).max(256).optional(),
    })
    .superRefine((input, ctx) => {
      const sources = [
        input.source_run_id,
        input.log_file,
        input.log_artifact_id,
        input.log_text,
        input.faultlog_name,
      ].filter((value) => value !== undefined);
      if (sources.length > 1)
        ctx.addIssue({
          code: "custom",
          message: "Provide at most one evidence source",
        });
      if (input.source_run_id && [input.target, input.kind, input.lines, input.max_age_minutes, input.bundle_name, input.process_hint].some(value => value !== undefined))
        ctx.addIssue({ code: "custom", message: "A source task fixes the application, device and historical window; do not override its scope" });
      if (input.collect_missing !== undefined && !input.source_run_id)
        ctx.addIssue({ code: "custom", message: "collect_missing requires source_run_id" });
      const local =
        input.log_file !== undefined ||
        input.log_artifact_id !== undefined ||
        input.log_text !== undefined;
      if (
        (local || input.faultlog_name) &&
        (input.kind !== undefined ||
          input.lines !== undefined ||
          input.max_age_minutes !== undefined)
      )
        ctx.addIssue({
          code: "custom",
          message: "Collection options require live device collection",
        });
      if (local && input.target !== undefined)
        ctx.addIssue({
          code: "custom",
          path: ["target"],
          message: "A device target does not apply to local evidence",
        });
      if (input.kind === "hilog" && input.max_age_minutes !== undefined)
        ctx.addIssue({
          code: "custom",
          path: ["max_age_minutes"],
          message: "Age filtering applies to faultlogs",
        });
      if (
        input.log_text !== undefined &&
        Buffer.byteLength(input.log_text) > 32768
      )
        ctx.addIssue({
          code: "custom",
          path: ["log_text"],
          message:
            "Inline evidence is limited to 32 KiB; use log_file for larger evidence",
        });
    }).meta({ allOf: [
      { if: { required: ["source_run_id"] }, then: { not: { anyOf:
        ["log_file", "log_artifact_id", "log_text", "faultlog_name", "target", "kind", "lines", "max_age_minutes", "bundle_name", "process_hint"].map(name => ({ required: [name] })) } } },
      { if: { required: ["collect_missing"] }, then: { required: ["source_run_id"] } },
    ] }),
  api_compatibility: z.strictObject({
    ...projectFields,
    source_version: z.string().min(1),
    target_version: z.string().min(1),
    files: z.array(z.string()).min(1).optional(),
    modules: z.array(z.string()).min(1).optional(),
  }),
};
export type WorkflowName = keyof typeof workflowInputs;
export type ProjectCreateInput = z.infer<typeof workflowInputs.project_create>;
export const workflowNames = Object.keys(workflowInputs) as WorkflowName[];
const provider = z.enum(["developer", "codegenie"]);
const pagination = {
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(50),
};
const logFields = {
  action: z.enum(["collect", "probe", "fetch", "clear"]).default("collect"),
  target,
  bundle_name: logBundle,
  contains: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[^\u0000-\u001f\u007f]+$/)
    .optional(),
  lines: z.number().int().min(1).max(10000).optional(),
  kind: z.enum(["hilog", "crash"]).optional(),
  faultlog_name: faultlogNameSchema.optional(),
  max_age_minutes: faultlogAge,
  limit: z.number().int().min(1).max(100).optional(),
};
const name = z.string().min(1).max(256);
const uiFlowFields = {
  ...projectFields,
      id: flowIdSchema.optional(),
      flow: z.unknown().optional(),
      replace: z.boolean().default(false),
      target,
      variables: z.record(z.string(), z.string()).default({}),
      route: routeRequestSchema.optional(),
      goal: z.string().trim().min(1).max(512).optional(),
      name: z.string().trim().min(1).max(256).optional(),
      recording_id: z.string().uuid().optional(),
      mode: z.enum(["restart", "attach"]).optional(),
      parameters: wantParametersSchema.default({}),
      assert: assertionSchema.optional(),
      request_key: z.string().min(1).max(256).optional(),
};
function uiFlowAction<A extends string>(action: A) {
  const followup = ["record_status", "record_stop", "record_cancel"].includes(action);
  const forbidden = (message: string) => z.never({ error: message }).optional();
  return z.strictObject({
    ...uiFlowFields,
    action: z.literal(action),
    mode: action === "record_start" ? uiFlowFields.mode : forbidden("mode belongs to record_start; run uses the saved flow start mode"),
    name: action === "record_start" ? z.string().trim().min(1).max(256) : forbidden("name belongs to record_start"),
    goal: action === "navigate" ? uiFlowFields.goal : forbidden("goal belongs to navigate"),
    recording_id: followup ? z.string().uuid() : forbidden("recording_id belongs to record_status, record_stop or record_cancel"),
    id: ["read", "delete", "run", "record_start"].includes(action) ? flowIdSchema : uiFlowFields.id,
    project_path: followup ? forbidden("Recording follow-ups use the captured project_path") : uiFlowFields.project_path,
    product: followup ? forbidden("Recording follow-ups use the captured product") : uiFlowFields.product,
    module_targets: followup ? forbidden("Recording follow-ups use the captured module_targets") : uiFlowFields.module_targets,
    target: followup ? forbidden("Recording follow-ups use the captured target") : uiFlowFields.target,
    route: action === "record_start" ? routeRequestSchema : uiFlowFields.route,
  });
}
// All workflow input contracts remain discoverable and validated, including start.
export const publicWorkflowRunSchema = z.union([
  z.discriminatedUnion("workflow", [
    workflowStartContract("project_create", workflowInputs.project_create),
    workflowStartContract("project_sync", workflowInputs.project_sync),
    workflowStartContract("project_build", workflowInputs.project_build),
    workflowStartContract("app_deploy", workflowInputs.app_deploy),
    workflowStartContract("build_run", workflowInputs.build_run),
    workflowStartContract("build_deploy_verify", workflowInputs.build_deploy_verify),
    workflowStartContract("code_diagnose", workflowInputs.code_diagnose),
    workflowStartContract("crash_diagnose", workflowInputs.crash_diagnose),
    workflowStartContract("api_compatibility", workflowInputs.api_compatibility),
  ]),
  workflowObservationContract,
]);
const nativeTools = {
  skill_manage: {
    description: "Catalog/search bundled HarmonyOS Skills or read a catalogued file with source and digest. No host installation is required. Use domain_recipe for task methods.",
    schema: skillManageSchema,
  },
  skill_workflow: {
    description: "Compatibility access to persisted guidance tasks: list/read/export/archive. New guidance uses domain_recipe; native work uses workflow_run. Legacy mutations return migration guidance and never create a new planning lifecycle.",
    schema: skillWorkflowSchema,
  },
  workflow_catalog: {
    description:
      "List fixed native workflows compactly; get reads one input schema/capabilities/completion contract; ui_actions reads the shared versioned direct/recorded action contract.",
    schema: z.strictObject({
      action: z.enum(["list", "get", "ui_actions"]).default("list"),
      workflow: z.enum(workflowNames).optional(),
    }).refine(input => input.action === "get" ? input.workflow !== undefined : input.workflow === undefined, "Specify workflow only for get"),
  },
  workflow_run: {
    description: "Start, observe, reconcile or cancel native tasks. Each workflow has a typed input. Start/status/resume return bounded summaries after wait_ms. Read complete results by byte page, events by ID cursor, artifacts by page or image. Storage actions use maintenance.",
    schema: z.union([publicWorkflowRunSchema, storageContract]),
  },
  harmony_knowledge: {
    description:
      "Search errors, rules, cases or full HarmonyOS documentation (kind=docs); follow result read parameters. catalog discovers unknown IDs and document categories. Read pages use UTF-16 characters (default 16384); catalog/search returns at most 100 entries. Cloud search requires source=cloud and CodeGenie login.",
    schema: z
      .strictObject({
        action: z.enum(["catalog", "search", "read"]),
        source: z.enum(["local", "cloud"]).default("local"),
        kind: z.enum(["rules", "docs"]).default("rules"),
        catalog: z.enum(["all", ...docCatalogNames]).optional(),
        query: z.string().min(1).max(4096).optional(),
        id: z.string().optional(),
        offset: pagination.offset,
        limit: z.number().int().min(1).max(65536).optional(),
      })
      .refine(
        (input) =>
          input.action === "read" ||
          input.limit === undefined ||
          input.limit <= 100,
        "Catalog/search limit is at most 100",
      )
      .refine(
        (input) =>
          input.catalog === undefined ||
          (input.source === "local" &&
            input.kind === "docs" &&
            input.action !== "read"),
        "Catalog filters apply only to local docs catalog/search",
      ),
  },
  harmony_auth: {
    description:
      "Explicit browser login, status, logout and developer teams. Developer signing and CodeGenie knowledge credentials are isolated.",
    schema: z.strictObject({
      action: z.enum(["login", "status", "logout", "teams"]),
      provider,
      open_browser: z.boolean().default(true),
    }),
  },
  switch_cwd: {
    description: "Deprecated alias for immutable project_context resolve. Returns the selected project descriptor without changing any shared default; pass project_path on later project calls.",
    schema: z.strictObject({ project_path: z.string().min(1) }),
  },
  deveco_doctor: {
    description:
      "Inspect runtime, component paths, versions and available capabilities. With explicit target, read device architecture/UiTest version and native text component availability without starting a daemon or injecting input. Without target no device is probed. Detection does not imply a verified UI operation or completed platform validation.",
    schema: z.strictObject({ ...projectFields, target }),
  },
  deveco_restart: {
    description:
      "Gracefully interrupt running tasks and close owned sessions, then start a new runtime worker.",
    schema: z.strictObject({}),
  },
  lsp: {
    description: "Native ArkTS/C++ language queries. Positions use zero-based UTF-16 offsets. C++ needs a built CMake translation unit with selected ABI/mode. Symbols use query; call hierarchy uses current source and item_index. Unsupported capabilities and oversized results return explicit errors.",
    schema: z
      .strictObject({
        ...projectFields,
        action: z.enum([
          "hover",
          "definition",
          "implementation",
          "references",
          "diagnostics",
          "documentSymbol",
          "workspaceSymbol",
          "prepareCallHierarchy",
          "incomingCalls",
        "outgoingCalls",
      ]),
      language: z.enum(["arkts", "cpp"]).default("arkts"),
      abi: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
      mode: z.enum(["debug", "release"]).optional(),
        file: z.string().min(1),
        line: z.number().int().nonnegative().default(0),
        character: z.number().int().nonnegative().default(0),
        includeDeclaration: z.boolean().default(false),
        query: z.string().max(4096).optional(),
        item_index: z.number().int().min(0).max(9999).optional(),
      })
      .superRefine((input, ctx) => {
        if (input.language !== "cpp" && (input.abi !== undefined || input.mode !== undefined))
          ctx.addIssue({ code: "custom", message: "abi and mode apply only to language=cpp" });
        if (input.query !== undefined && input.action !== "workspaceSymbol")
          ctx.addIssue({
            code: "custom",
            path: ["query"],
            message: "query is only used by workspaceSymbol",
          });
        if (
          input.item_index !== undefined &&
          !["incomingCalls", "outgoingCalls"].includes(input.action)
        )
          ctx.addIssue({
            code: "custom",
            path: ["item_index"],
            message:
              "item_index selects a prepared item for incomingCalls or outgoingCalls",
          });
      }),
  },
  arkts_check: {
    description:
      "SDK-backed ArkTS static preflight. This does not compile or validate a device build.",
    schema: z.strictObject({
      ...projectFields,
      files: z.array(z.string().min(1)).min(1).max(100000).optional(),
    }),
  },
  code_lint: {
    description:
      "Run the native Code Linter with a bounded issue preview and complete report artifact. Fixing requires fix=true; incremental requires a Git working tree. Counts cover the complete report, not only the preview.",
    schema: z.strictObject({
      ...projectFields,
      path: z.string().optional(),
      config_path: z.string().optional(),
      fix: z.boolean().default(false),
      incremental: z.boolean().default(false),
      limit: z.number().int().min(1).max(200).default(50),
    }),
  },
  check_cpp_files: {
    description:
      "Query clangd using native CMake compilation commands. Select an ABI when multiple architectures are built.",
    schema: z.strictObject({
      ...projectFields,
      files: z.array(z.string()).min(1),
      abi: z
        .string()
        .regex(/^[A-Za-z0-9_-]+$/)
        .optional(),
      mode: z.enum(["debug", "release"]).default("debug"),
    }),
  },
  device_info: {
    description:
      "List reachable device IDs or read one device's name, type and OS properties. Missing/truncated properties are explicit; kind_source identifies transport-address inference. A complete inventory is required before selecting a device.",
    schema: z
      .strictObject({ target, list: z.boolean().default(false) })
      .refine((input) => !input.list || input.target === undefined, {
        path: ["target"],
        message: "Target is not used by a device inventory query",
      }),
  },
  hdc_log: {
    description:
      "Collect bounded Hilog/crash evidence (contains matches literal rendered Hilog lines), probe recent faultlogs using device time, fetch an exact faultlog name, or explicitly clear the default app/core Hilog buffers. Full retained output uses artifacts; truncated evidence is identified.",
    schema: z.strictObject(logFields).superRefine((input, ctx) => {
      const allowed: Record<typeof input.action, string[]> = {
        collect: [
          "action",
          "target",
          "bundle_name",
          "contains",
          "lines",
          "kind",
          "max_age_minutes",
        ],
        probe: ["action", "target", "bundle_name", "max_age_minutes", "limit"],
        fetch: ["action", "target", "faultlog_name"],
        clear: ["action", "target"],
      };
      for (const [key, value] of Object.entries(input))
        if (value !== undefined && !allowed[input.action].includes(key))
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `Field does not apply to ${input.action}`,
          });
      if (input.action === "fetch" && !input.faultlog_name)
        ctx.addIssue({
          code: "custom",
          path: ["faultlog_name"],
          message: "An exact faultlog name is required",
        });
      if (
        input.action === "collect" &&
        (input.kind ?? "hilog") === "hilog" &&
        input.max_age_minutes !== undefined
      )
        ctx.addIssue({
          code: "custom",
          path: ["max_age_minutes"],
          message: "Age filtering applies to faultlogs",
        });
      if (input.contains !== undefined && input.kind === "crash")
        ctx.addIssue({
          code: "custom",
          path: ["contains"],
          message: "Literal filtering applies to Hilog",
        });
    }),
  },
  hot_reload: {
    description:
      "Start, inspect, apply or stop a native Hvigor watch session. Start and apply return a persistent run_id: inspect/resume/cancel with workflow_run. It builds and signs HQF patches and verifies quickfix receipts.",
    schema: z.strictObject({
      ...projectFields,
      request_key: z.string().min(1).max(200).optional(),
      action: z.enum(["start", "status", "apply", "stop"]),
      target,
      app: appSchema.optional(),
      modules: z.array(z.string()).min(1).optional(),
      files: z.array(z.string()).min(1).optional(),
    }),
  },
  app_signature: {
    description:
      "Use native SDK signing tools and developer cloud certificate/profile management. Mutations return a persistent run_id; use workflow_run for status, resume, cancellation and artifact reads. configure reads a private JSON descriptor from file, creates a new material directory at output, and selects options.name for the current product; existing configurations are preserved.",
    schema: z.strictObject({
      ...projectFields,
      request_key: z.string().min(1).max(200).optional(),
      action: z.enum([
        "inspect",
        "configure",
        "keypair",
        "csr",
        "sign",
        "verify",
        "certificates",
        "certificate_create",
        "certificate_delete",
        "profile_create",
        "profile_delete",
        "devices",
        "device_register",
      ]),
      file: z.string().optional(),
      output: z.string().optional(),
      team_id: z.string().optional(),
      options: z.record(z.string(), z.string()).default({}),
    }).superRefine((input, ctx) => {
      if (input.action !== "configure") return;
      const options = signingConfigurationOptionsSchema.safeParse(input.options);
      if (!options.success) for (const issue of options.error.issues) ctx.addIssue({ ...issue, path: ["options", ...issue.path] });
      for (const field of ["file", "output"] as const) if (!input[field]) ctx.addIssue({ code: "custom", path: [field], message: "Signing configuration requires a descriptor file and a new output directory" });
    }),
  },
  ui_snapshot: {
    description:
      "Capture an image, tree or both as artifacts. Image mode skips the layout dump. JPEG preserves aspect ratio and caps the long edge at 2576px; PNG stays native unless width is explicit. if_changed_from compares fresh encoded bytes and omits an unchanged image artifact. Tree snapshot IDs expire after actions or 30 seconds.",
    schema: z
      .strictObject({
        target,
        mode: z.enum(["image", "tree", "both"]).default("image"),
        capture: screenshotOptionsSchema.optional(),
      })
      .refine((input) => input.mode !== "tree" || !input.capture, {
        message: "Tree-only capture does not accept image options",
      }),
  },
  ui_observe: {
    description:
      "Capture the current UI once and evaluate a selector or up to 32 named selectors against the same snapshot.",
    schema: z
      .strictObject({
        target,
        ...queryFields,
        capture: screenshotOptionsSchema.optional(),
      })
      .superRefine(checkQueries),
  },
  ui_find: {
    description:
      "Find UI nodes by stable selectors and explicit state, window or display. For offline queries provide tree_file (absolute path) or tree_artifact_id and tree_format=uitest or nodes. Saved trees never verify current device state and cannot be combined with target or snapshot_id. Multiple matches are reported.",
    schema: z
      .strictObject({
        target,
        ...queryFields,
        snapshot_id: z.string().uuid().optional(),
        tree_file: z.string().min(1).max(4096).optional(),
        tree_artifact_id: z.string().uuid().optional(),
        tree_format: z.enum(["uitest", "nodes"]).optional(),
      })
      .superRefine(checkQueries)
      .superRefine((input, ctx) => {
        const sources = [input.tree_file, input.tree_artifact_id].filter(
          (value) => value !== undefined,
        );
        if (
          sources.length > 1 ||
          (sources.length === 1 &&
            (input.target !== undefined || input.snapshot_id !== undefined)) ||
          (sources.length === 0 && input.tree_format !== undefined)
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Use one saved tree source without a device target or live snapshot; tree_format requires a saved source",
          });
      }),
  },
  ui_tap: {
    description:
      "Resolve exactly one enabled UI element and tap it under the same device lease. Use verify_ui for outcome verification.",
    schema: z.strictObject({ target, selector: meaningfulSelector }),
  },
  ui_flow: {
    description: "Reuse or record navigation when useful: list/routes, read/validate, then run. Saved flows retain their assertion; routes require assert. Mutations return durable run IDs. Recording setup and action contracts: domain_recipe ui_test and workflow_catalog ui_actions. Never replay uncertain effects or bypass active ui_test act/check.",
    schema: z.discriminatedUnion("action", [
      uiFlowAction("list"), uiFlowAction("read"), uiFlowAction("validate"), uiFlowAction("save"), uiFlowAction("delete"), uiFlowAction("routes"),
      uiFlowAction("run"), uiFlowAction("navigate"), uiFlowAction("record_start"), uiFlowAction("record_status"), uiFlowAction("record_stop"), uiFlowAction("record_cancel"),
    ]),
  },
  verify_ui: {
    description: "Evaluate a control assertion and/or capture a host visual review. Pending reviews include the image and completion parameters, with artifact-read fallback. Image delivery alone is not verification; host assessment cannot override a failed assertion. Samples share a device lease.",
    schema: z
      .strictObject({
        target,
        assert: assertionSchema.optional(),
        review: z
          .strictObject({ requirement: z.string().trim().min(1).max(4096) })
          .optional(),
        capture: screenshotOptionsSchema
          .omit({ if_changed_from: true })
          .optional(),
      })
      .refine(
        (input) => !!(input.assert || input.review),
        "Provide assert or review.requirement",
      ),
  },
  ui_review: {
    description: "Read or complete a visual review. Submit the exact screenshot artifact_id, sha256, delivered read_token and actual host assessment. Completion is immutable; visual assessment cannot override a failed control assertion.",
    schema: z.discriminatedUnion("action", [
      z.strictObject({ action: z.literal("list"), ...pagination }),
      z.strictObject({ action: z.literal("status"), review_id: z.string().uuid() }),
      z.strictObject({ action: z.literal("cancel"), review_id: z.string().uuid() }),
      z.strictObject({ action: z.literal("complete"), review_id: z.string().uuid(), artifact_id: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), read_token: z.string().uuid(), assessment: visualAssessmentSchema }),
    ]),
  },
  ui_test: {
    description: "Durable UI test with captured app/device and original steps. Complete plans initialize by default; fresh_start=false preserves app state. act uses attempt_id and optional check_after; identical retries do not replay. Follow next calls and inline review images. finish requires all steps and no uncertain action. Methods: domain_recipe ui_test.",
    schema: z.discriminatedUnion("action", [
      z.strictObject({ action: z.literal("start"), ...projectFields, requirements: requirementBindingsSchema.optional(), deployment_run_id: z.string().uuid().optional().describe("Link a succeeded deployment receipt before testing; required for project-bound domain acceptance"), test_plan: z.string().trim().min(1).max(16384), app: appSchema.optional(), target, fresh_start: z.boolean().default(false), allowed_bundles: z.array(appSchema.shape.bundle_name).max(16).default([]).describe("Additional explicitly captured application scopes, e.g. a permission dialog; app.bundle_name is always included"), display_id: z.number().int().min(0).max(2147483647).optional(), steps: uiTestPlanSchema.optional(), initialize: z.boolean().optional().describe("Full steps initialize in start by default; false retains separate resume. fresh_start=false preserves the current app state"), request_key: z.string().min(1).max(256).optional() }).refine(input => !!(input.app || input.deployment_run_id), "Provide app or a succeeded deployment_run_id").meta({ anyOf: [{ required: ["app"] }, { required: ["deployment_run_id"] }] }),
      z.strictObject({ action: z.literal("plan"), test_id: z.string().uuid(), steps: uiTestPlanSchema }),
      ...["status", "resume", "cancel", "finish"].map(action => z.strictObject({ action: z.literal(action as "status" | "resume" | "cancel" | "finish"), test_id: z.string().uuid() })),
      z.strictObject({ action: z.literal("check"), test_id: z.string().uuid(), recapture: z.boolean().default(false).describe("Explicitly replace an existing review with fresh evidence after an external or delayed UI change; original requirements remain fixed") }),
      z.strictObject({ action: z.literal("act"), test_id: z.string().uuid(), step_id: z.string().min(1).max(64), attempt_id: z.string().uuid(), operation: controlSchema, check_after: uiTestCheckAfterSchema.optional().describe("After an accepted action, observe bounded stability and check that same step; timeout leaves it pending. Retry the same attempt/input without replaying the action") }),
      z.strictObject({ action: z.literal("replan"), test_id: z.string().uuid(), reason: z.string().trim().min(10).max(4096), strategy: z.string().trim().min(10).max(4096), reconcile_uncertain: z.boolean().default(false) }),
      z.strictObject({ action: z.literal("logs"), test_id: z.string().uuid(), chunk_id: z.number().int().min(0).max(8691).optional(), chunk_offset: z.number().int().nonnegative().default(0).describe("Offset in the combined legacy and continuous chunk listing"), chunk_limit: z.number().int().min(1).max(100).default(100), offset: z.number().int().nonnegative().default(0).describe("Offset in matching log lines"), limit: z.number().int().min(1).max(65536).default(16384).describe("Maximum UTF-8 response bytes"), search_keywords: z.array(z.string().min(1).max(256)).max(8).default([]) }),
      z.strictObject({ action: z.literal("report"), test_id: z.string().uuid() }),
      z.strictObject({ action: z.literal("export"), test_id: z.string().uuid(), directory: z.string().min(1) }),
    ]),
  },
  ui_inspect: {
    description:
      "Inspect UI tree metadata, matching nodes and optional screenshot evidence.",
    schema: z.strictObject({
      target,
      selector: selectorSchema.optional(),
      screenshot: z.boolean().default(false),
      capture: screenshotOptionsSchema.optional(),
      display_id: z
        .union([z.string(), z.number().int().nonnegative()])
        .optional(),
      window_id: z.string().optional(),
      max_depth: z.number().int().min(0).max(100000).optional(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(200).default(50),
    }),
  },
  ui_control: {
    description:
      "Send a validated UiTest touch, keyboard, focused-text or mouse operation. One-off navigation can use direct scoped actions. Use ui_flow list/routes when reusing a saved path helps; record only navigation intended for reuse. Active ui_test steps use ui_test act. text inputs at the currently focused editable field without clicking; it requires an explicit window id/bundle_name and exactly one focused field. Mouse operations require a scoped selector or explicit window and use native Driver RPC. Use selector or absolute x/y; point/gesture percentages are relative to a unique selector or explicit window id/bundle_name. Display follows the selected node/window; display_id may be explicit. Resolve ambiguous targets from fresh bundle/window/key/type evidence. Accepted commands still require verify_ui.",
    schema: z.strictObject({ target, operation: controlSchema }),
  },
  emulator_manage: {
    description:
      "Manage native emulator instances, images and licenses. license_view reads installed agreement files without changing acceptance. license_accept requires the exact reviewed license_sha256. Mutations return a persistent run_id for workflow_run status/resume/cancel; instance and image mutations verify inventory.",
    schema: emulatorManageSchema,
  },
  emulator_scenario: {
    description:
      "Control a running modern emulator as a persistent job returning run_id; use workflow_run for status/resume/cancel. Range and operation fields are checked before SDK calls; native help must declare the selected capability. Optional verify captures a bundle_name and UI assertion, checked after the accepted command under the same device lease. Its separate verify_native_outcome result/report proves the captured application assertion, not every physical sensor property. On assertion failure, resume rechecks the assertion without repeating the accepted scenario. Without verify, command acceptance leaves application state unverified.",
    schema: emulatorScenarioSchema,
  },
};
export const signatureAdminActions = ["certificates", "certificate_create", "certificate_delete", "profile_create", "profile_delete", "devices", "device_register"] as const;
export const signatureDailyActions = ["inspect", "configure", "keypair", "csr", "sign", "verify"] as const;
export const emulatorAdminActions = ["create", "delete", "images", "image_install", "image_uninstall", "license_view", "license_accept"] as const;
export const emulatorDailyActions = ["list", "start", "stop"] as const;
// Advertise only daily fields, then run the complete existing native validator.
// Administrative aliases still use the original schema behind the group gate.
export const dailySignatureSchema = z.strictObject({
  ...projectFields,
  request_key: nativeTools.app_signature.schema.shape.request_key,
  action: z.enum(signatureDailyActions),
  file: nativeTools.app_signature.schema.shape.file,
  output: nativeTools.app_signature.schema.shape.output,
  options: nativeTools.app_signature.schema.shape.options,
}).superRefine((input, ctx) => {
  const parsed = nativeTools.app_signature.schema.safeParse(input);
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ ...issue });
});
export const dailyEmulatorSchema = z.strictObject({
  request_key: emulatorManageSchema.shape.request_key,
  target: emulatorManageSchema.shape.target,
  action: z.enum(emulatorDailyActions),
  name: emulatorManageSchema.shape.name,
}).superRefine((input, ctx) => {
  const parsed = emulatorManageSchema.safeParse(input);
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ ...issue });
});

export const tools = {
  ...nativeTools,
  domain_content: {
    description: "Read a known deveco URI with source/digest; catalog discovers Skill, knowledge, recipe and source IDs. Tool fallback for MCP Resources. Questions: harmony_knowledge search. Task methods: domain_recipe.",
    schema: z.discriminatedUnion("action", [
      z.strictObject({ action: z.literal("catalog"), kind: z.enum(["skill", "knowledge", "recipe", "source"]).optional(), query: z.string().trim().max(256).default(""), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(30) }),
      z.strictObject({ action: z.literal("read"), uri: z.string().min(1).max(2048) }),
    ]),
  },
  domain_recipe: {
    description: "Read task methods and optional specification or host-setup guidance with direct source references. catalog lists available methods; read creates no run.",
    schema: domainRecipeSchema,
  },
  domain_acceptance: {
    description: "Assess requirement/task/assertion/review/evidence links against current native results and source identity. This is an on-demand assessment, not a planning or project-management lifecycle.",
    schema: domainAcceptanceSchema,
  },
  project_context: {
    description: "Resolve an immutable project/product/module descriptor. Pass its explicit scope to later project calls; started runs retain that scope.",
    schema: z.strictObject({ action: z.literal("resolve").default("resolve"), project_path: z.string().min(1), product: projectFields.product, module_targets: projectFields.module_targets }),
  },
  ui_query: {
    description: "Observe/query UI: snapshot captures artifacts; observe samples named selectors; find queries live or saved trees; inspect pages nodes/windows/displays. Saved trees do not establish live state. Use ui_control for input, verify_ui or ui_test for outcome checks.",
    schema: z.discriminatedUnion("action", [
      z.strictObject({ action: z.literal("snapshot"), query: nativeTools.ui_snapshot.schema }),
      z.strictObject({ action: z.literal("observe"), query: nativeTools.ui_observe.schema }),
      z.strictObject({ action: z.literal("find"), query: nativeTools.ui_find.schema }),
      z.strictObject({ action: z.literal("inspect"), query: nativeTools.ui_inspect.schema }),
    ]),
  },
  maintenance: {
    description: "Recover workers or storage. restart interrupts owned sessions; capacity previews usage; cleanup_apply requires reviewed run_ids and plan_hash. export writes retained evidence to a new directory; storage_receipt reads the durable receipt.",
    schema: z.discriminatedUnion("action", [
      z.strictObject({ action: z.literal("restart") }),
      ...storageContracts,
    ]),
  },
  signature_admin: {
    description: "Optional signing-admin group: manage cloud certificates/profiles and registered devices for an explicit developer team. Uses the native signing service; credentials stay isolated from knowledge authentication. Enable the group when opening the MCP connection.",
    schema: nativeTools.app_signature.schema.safeExtend({ action: z.enum(signatureAdminActions) }),
  },
  emulator_admin: {
    description: "Optional emulator-admin group: create/delete instances, inspect/install/uninstall images and review/accept exact license digests. Native mutations retain their run IDs and reconciliation guarantees. Enable the group when opening the MCP connection.",
    schema: nativeTools.emulator_manage.schema.safeExtend({ action: z.enum(emulatorAdminActions) }),
  },
};
export type ToolName = keyof typeof tools;
