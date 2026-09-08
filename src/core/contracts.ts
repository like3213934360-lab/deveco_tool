import { z } from "zod";
import { docCatalogNames } from "./doc-catalog.js";
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

export const selectorSchema = z.strictObject({
  text: z.string().optional(),
  textMode: z.enum(["contains", "exact"]).default("contains"),
  key: z.string().optional(),
  type: z.string().optional(),
  node_id: z.string().optional(),
  window_id: z.string().optional(),
  bundle_name: z.string().min(1).optional(),
  displayId: z.union([z.string(), z.number()]).optional(),
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  enabled: z.boolean().optional(),
  value: z.union([z.string(), z.number()]).optional(),
  clickableOnly: z.boolean().default(false),
  onScreenOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(20),
});
export type Selector = z.infer<typeof selectorSchema>;
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
  action: z.enum([
    "click",
    "doubleClick",
    "longClick",
    "swipe",
    "fling",
    "drag",
    "dircFling",
    "keyEvent",
    "inputText",
  ]),
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
  keys: z
    .array(z.string().regex(/^[A-Za-z0-9_]+$/))
    .min(1)
    .max(3)
    .optional(),
  selector: selectorSchema.optional(),
});
export const flowIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/);
export const meaningfulSelector = selectorSchema.refine(
  (s) => !!(s.key || s.text || s.type || s.node_id),
  "Selector needs key, text, type or node_id",
);
export const assertionSchema = z
  .strictObject({
    visible: meaningfulSelector.optional(),
    hidden: meaningfulSelector.optional(),
    timeoutMs: z.number().int().min(100).max(600000).default(5000),
    alternates: z.array(meaningfulSelector).max(5).optional(),
  })
  .refine(
    (input) => (input.visible !== undefined) !== (input.hidden !== undefined),
    "Provide exactly one visible or hidden assertion",
  );
export const stepSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
  action: z.enum([
    "tap",
    "doubleTap",
    "longTap",
    "input",
    "key",
    "swipe",
    "fling",
    "drag",
    "waitVisible",
    "waitHidden",
    "assertVisible",
    "assertHidden",
  ]),
  timeoutMs: z.number().int().min(100).max(600000).default(5000),
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
});
export const flowSchema = z
  .strictObject({
    version: z.literal(1),
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
        step.action === "input" &&
        (!step.value || !Object.hasOwn(flow.variables, step.value.slice(2, -1)))
      )
        context.addIssue({
          code: "custom",
          message: `${step.id}: declared input variable required`,
        });
      if (step.action === "key" && !step.key)
        context.addIssue({
          code: "custom",
          message: `${step.id}: key required`,
        });
      if (["swipe", "fling", "drag"].includes(step.action) && !step.gesture)
        context.addIssue({
          code: "custom",
          message: `${step.id}: gesture required`,
        });
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
export const appSchema = z.strictObject({
  bundle_name: z.string().regex(/^[A-Za-z][A-Za-z0-9_.]*$/),
  module: aaArgument.optional(),
  ability: aaArgument,
  uri: aaArgument.optional(),
  action: aaArgument.optional(),
  mime_type: aaArgument.optional(),
  entities: z.array(aaArgument).max(32).optional(),
  parameters: wantParametersSchema.optional(),
});
export type ApplicationTarget = z.infer<typeof appSchema>;
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
  modules: z.array(z.string().min(1)).min(1).optional(),
  mode: z.enum(["debug", "release"]).default("debug"),
  clean: z.boolean().default(false),
  sync: z.boolean().default(true),
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
    sdk_version: z.union([z.string(), z.number().int().positive()]),
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
  app_deploy: z.strictObject({
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
    target,
    app: appSchema,
  }),
  build_deploy_verify: z.strictObject({
    ...buildFields,
    target,
    app: appSchema,
    assert: assertionSchema,
    flow_id: flowIdSchema.optional(),
    variables: z.record(z.string(), z.string()).default({}),
    hot_reload: z.boolean().default(false),
  }),
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
    }),
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
export const tools = {
  workflow_catalog: {
    description:
      "Read deterministic workflow input schemas, required capabilities and completion criteria.",
    schema: z.strictObject({
      action: z.enum(["list", "get"]).default("list"),
      workflow: z.enum(workflowNames).optional(),
    }),
  },
  workflow_run: {
    description:
      "Persist and start a workflow, inspect it, resume an interrupted run, cancel, or read an artifact. read_artifact defaults to base64 pages; as=image returns a complete PNG/JPEG as MCP image content (at most 8 MiB), without offset/limit. Start requires a catalog workflow and validated input. Status waits at most 20 seconds.",
    schema: z
      .strictObject({
        action: z.enum([
          "start",
          "list",
          "status",
          "resume",
          "cancel",
          "read_artifact",
        ]),
        workflow: z.enum(workflowNames).optional(),
        input: z.record(z.string(), z.unknown()).optional(),
        request_key: z.string().min(1).max(256).optional(),
        run_id: z.string().uuid().optional(),
        wait_ms: z.number().int().min(0).max(20000).default(0),
        resume_input: z
          .strictObject({ action: z.literal("recheck") })
          .optional(),
        artifact_id: z.string().uuid().optional(),
        as: z.enum(["page", "image"]).default("page"),
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(65536).optional(),
      })
      .refine(
        (input) =>
          input.as !== "image" ||
          (input.action === "read_artifact" &&
            input.offset === 0 &&
            input.limit === undefined),
        "as=image requires read_artifact with no pagination",
      ),
  },
  harmony_knowledge: {
    description:
      "Search local HarmonyOS documentation and rule/case resources. kind=docs catalog returns the six catalog names and paged documents; catalog filters local docs catalog/search. Read pages UTF-16 characters (default 16384); catalog/search pages at most 100 entries. Cloud search requires source=cloud and a CodeGenie login.",
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
    description:
      "Select the default project for future requests. Submitted workflows keep their captured context.",
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
    description:
      "Direct ArkTS language-server hover, definition, implementation, references and diagnostics. Positions are zero based UTF-16 offsets and must lie within the current file. Unsupported server capabilities are reported explicitly.",
    schema: z.strictObject({
      ...projectFields,
      action: z.enum([
        "hover",
        "definition",
        "implementation",
        "references",
        "diagnostics",
      ]),
      file: z.string().min(1),
      line: z.number().int().nonnegative().default(0),
      character: z.number().int().nonnegative().default(0),
      includeDeclaration: z.boolean().default(false),
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
    description:
      "Inspect declared app routes and saved flows. Run/navigate/record_start persist tasks; use workflow_run for status, resume and cancel. Navigate selects one route, flow ID or goal. Routes require assert; saved flows keep their original assertion. An unmatched goal starts a recording at one exported entry (home, mainElement, then unique ability), returning navigation=recording and recording_id; no replay inputs or assertion are accepted at this point. Ambiguous entries/goals never execute. Record_start needs id, name and ability route. Wait for needs_input, then ui_tap/ui_control records accepted actions. Record_stop needs recording_id and assert; saving follows verification. Input text becomes secret variables; selector repairs require the original assertion to pass.",
    schema: z.strictObject({
      ...projectFields,
      action: z.enum([
        "list",
        "read",
        "validate",
        "save",
        "delete",
        "routes",
        "run",
        "navigate",
        "record_start",
        "record_status",
        "record_stop",
        "record_cancel",
      ]),
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
    }),
  },
  verify_ui: {
    description:
      "Poll a final control assertion and/or capture evidence for host visual review. review.requirement is saved with the screenshot; any requested visual review remains required and verified=false. Read its image using workflow_run.read_artifact as=image. Assertion and screenshot are sequential samples under one device lease. A screenshot alone never verifies an outcome.",
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
      "Send a validated UiTest operation or lossless Unicode input. Use selector or absolute x/y; point/gesture percentages are relative to a unique selector or explicit window id/bundle_name. Display follows the selected node/window; display_id may be explicit. Accepted commands still require verify_ui.",
    schema: z.strictObject({ target, operation: controlSchema }),
  },
  emulator_manage: {
    description:
      "Manage native emulator instances, images and licenses. license_view reads installed agreement files without changing acceptance. license_accept requires the exact reviewed license_sha256. Mutations return a persistent run_id for workflow_run status/resume/cancel; instance and image mutations verify inventory.",
    schema: emulatorManageSchema,
  },
  emulator_scenario: {
    description:
      "Control a running modern emulator as a persistent job returning run_id; use workflow_run for status/resume/cancel. Range and operation fields are checked before SDK calls; native help must declare the selected capability. Command acceptance does not prove application sensor state.",
    schema: emulatorScenarioSchema,
  },
};
export type ToolName = keyof typeof tools;
