import { z } from "zod";

export const recoverySchema = z.strictObject({
  kind: z.enum([
    "reconcile",
    "resume",
    "select_device",
    "select_project_target",
    "correct_input",
    "restore_toolchain",
    "fix_code",
    "new_run",
    "inspect_and_fix",
    "inspect",
  ]),
  message: z.string(),
  automatic_retry: z.literal(false),
  next: z.array(z.record(z.string(), z.unknown())),
  new_run_required: z.literal(true).optional(),
  request_key: z.string().optional(),
  previous_input: z
    .strictObject({
      tool: z.literal("workflow_run"),
      action: z.literal("read_result"),
      run_id: z.string(),
      section: z.literal("input"),
    })
    .optional(),
});

/** Advice is descriptive and never authorizes replay of an external effect. */
export function recoveryAdvice(
  code: string,
  context: {
    tool?: string;
    workflow?: string;
    run_id?: string;
    status?: string;
    project_path?: string;
  } = {},
) {
  const { workflow, run_id, status, project_path } = context;
  const read = run_id
    ? [
        {
          tool: "workflow_run",
          action: "read_result",
          run_id,
          section: "error",
        },
      ]
    : [];
  const catalog = workflow
    ? [{ tool: "workflow_catalog", action: "get", workflow }]
    : [];
  const advice = (
    kind: string,
    message: string,
    next: object[],
    newRun = false,
  ) => ({
    kind,
    message,
    automatic_retry: false,
    next,
    ...(newRun
      ? {
          new_run_required: true,
          request_key: "Use a new request_key after changing inputs or source",
          ...(run_id
            ? {
                previous_input: {
                  tool: "workflow_run",
                  action: "read_result",
                  run_id,
                  section: "input",
                },
              }
            : {}),
        }
      : {}),
  });
  if (
    [
      "RUN_VERSION_MISMATCH",
      "WORKFLOW_DEFINITION_CHANGED",
      "WORKFLOW_RUNTIME_CHANGED",
      "RUNTIME_CHANGED",
    ].includes(code)
  )
    return advice(
      "inspect",
      "This run belongs to different runtime or workflow bytes. Use its original installation to inspect and reconcile pending effects before starting current work. Do not replay uncertain effects in a new run.",
      [
        ...read,
        ...(run_id
          ? [
              {
                tool: "workflow_run",
                action: "read_result",
                run_id,
                section: "input",
              },
            ]
          : []),
      ],
    );
  if (
    status === "needs_input" ||
    [
      "EFFECT_UNCERTAIN",
      "CANCEL_UNCONFIRMED",
      "RESOURCE_RECOVERY_REQUIRED",
    ].includes(code)
  )
    return advice(
      "reconcile",
      "Inspect the retained operation evidence, then recheck this run. Do not repeat installation or UI input while its outcome is uncertain.",
      [
        ...read,
        ...(run_id
          ? [
              {
                tool: "workflow_run",
                action: "resume",
                run_id,
                resume_input: { action: "recheck" },
              },
            ]
          : []),
      ],
    );
  if (status === "interrupted")
    return advice(
      "resume",
      "Resume the original run after restoring its captured environment; identity checks and operation receipts still apply.",
      [
        ...read,
        ...(run_id ? [{ tool: "workflow_run", action: "resume", run_id }] : []),
      ],
    );
  if (
    ["DEVICE_AMBIGUOUS", "DEVICE_NOT_FOUND", "HDC_TARGET_REQUIRED"].includes(
      code,
    )
  )
    return advice(
      "select_device",
      "Select an available device from device_info and submit explicit target. An existing run remains bound to its original device.",
      [{ tool: "device_info", list: true }],
      !!run_id,
    );
  if (
    [
      "PRODUCT_AMBIGUOUS",
      "TARGET_AMBIGUOUS",
      "TARGET_INVALID",
      "APP_TARGET_SELECTION_UNSUPPORTED",
      "APPLICATION_AMBIGUOUS",
      "APPLICATION_NOT_FOUND",
    ].includes(code)
  )
    return advice(
      "select_project_target",
      "Inspect the project candidates and supply an explicit product/module selection.",
      [
        { tool: "deveco_doctor", ...(project_path ? { project_path } : {}) },
        ...catalog,
      ],
      !!run_id,
    );
  if (
    [
      "INVALID_ARGUMENT",
      "WORKFLOW_INPUT_REQUIRED",
      "PROJECT_REQUIRED",
      "PROJECT_PATH_ABSOLUTE_REQUIRED",
      "WORKFLOW_REQUIRED",
      "SDK_API_RANGE_INVALID",
      "BUILD_REFERENCE_INVALID",
      "BUILD_INPUT_MISMATCH",
      "BUILD_REQUIREMENTS_MISMATCH",
      "BUILD_REFERENCE_UNSUPPORTED",
      "PACKAGE_DEPENDENCY_MISSING",
      "DEPLOY_ARTIFACT_MISSING",
    ].includes(code)
  )
    return advice(
      "correct_input",
      "Correct the reported fields using the tool/workflow schema before submitting.",
      catalog,
      !!run_id,
    );
  if (/^(SDK_|TOOLCHAIN_|COMPONENT_|NODE_|OHPM_)/.test(code))
    return advice(
      "restore_toolchain",
      "Inspect installed components and the reported failure. Restore the required environment before submitting a new run.",
      [
        ...read,
        { tool: "deveco_doctor", ...(project_path ? { project_path } : {}) },
      ],
      !!run_id,
    );
  if (code === "BUILD_CHECK_BLOCKED")
    return advice(
      "fix_code",
      "Read the current ArkTS diagnostics and fix the blocking sources, then submit a new build. This preflight failure is not a compiler result.",
      [
        ...read,
        ...(run_id
          ? [
              {
                tool: "workflow_run",
                action: "read_result",
                run_id,
                section: "artifacts",
              },
            ]
          : []),
        ...catalog,
      ],
      true,
    );
  if (
    [
      "SOURCE_CHANGED",
      "INPUT_CHANGED",
      "EVIDENCE_STALE",
      "PROJECT_CHANGED",
      "TOOLCHAIN_CHANGED",
      "RUN_VERSION_MISMATCH",
      "WORKFLOW_DEFINITION_CHANGED",
      "WORKFLOW_RUNTIME_CHANGED",
      "CHECK_EVIDENCE_STALE",
      "BUILD_INPUT_STALE",
      "EVIDENCE_ARTIFACT_CHANGED",
    ].includes(code)
  )
    return advice(
      "new_run",
      "Captured inputs no longer match. Submit a new run using current source and environment.",
      [...read, ...catalog],
      true,
    );
  if (status === "failed")
    return advice(
      "inspect_and_fix",
      "Read this failure and its retained artifacts. Fix the cause and submit a new run; a settled failed effect must not be replayed by resuming it.",
      [
        ...read,
        ...(run_id
          ? [
              {
                tool: "workflow_run",
                action: "read_result",
                run_id,
                section: "artifacts",
              },
            ]
          : []),
        ...catalog,
      ],
      true,
    );
  return advice(
    "inspect",
    "Inspect the reported error and correct its cause before retrying. No automatic replay is recommended.",
    [...read, ...catalog],
  );
}
