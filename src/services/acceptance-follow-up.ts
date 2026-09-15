/** Suggestions never replay the original task or infer unaffected files from a digest. */
export function acceptanceFollowUp(
  mode: "build-only" | "run" | "ui" | "host-review",
  reference: {
    requirement_id: string;
    requirement_revision: number;
    task_id: string;
    run_id: string;
  },
  error: { code: string; details?: unknown },
  workflow?: string,
  projectBound = true,
) {
  const details =
    error.details &&
    typeof error.details === "object" &&
    !Array.isArray(error.details)
      ? (error.details as Record<string, unknown>)
      : {};
  const uncertain = ["EVIDENCE_NOT_SUCCEEDED", "RUN_NOT_FOUND"].includes(
    error.code,
  );
  const chain =
    mode === "build-only"
      ? ["project_build"]
      : mode === "run"
        ? [projectBound ? "build_run" : "app_deploy"]
        : workflow === "build_deploy_verify"
          ? ["build_deploy_verify"]
          : projectBound
            ? ["build_run", "ui_test"]
            : ["ui_test"];
  return {
    requirement_id: reference.requirement_id,
    requirement_revision: reference.requirement_revision,
    task_id: reference.task_id,
    original_run_id: reference.run_id,
    changed_inputs: Array.isArray(details.changed_inputs)
      ? details.changed_inputs
      : [],
    granularity: "captured_identity_components",
    unaffected_file_scope_proven: false,
    ...(mode === "host-review"
      ? {
          action: "host_assessment",
          reason:
            "This requirement uses the explicit host assessment; native evidence cannot replace it.",
        }
      : uncertain
        ? {
            action: "inspect_original_run",
            call: {
              tool: "workflow_run",
              action: "status",
              run_id: reference.run_id,
              wait_ms: 0,
            },
            reason:
              "Inspect the retained outcome and its recovery instructions before repeating any side effect.",
          }
        : {
            action: "fresh_bound_evidence",
            workflow_chain: chain,
            reason:
              "The receipt cannot prove a narrower file/module rerun. Obtain fresh evidence for this declared task and requirement; other references are checked independently.",
          }),
    automatic_replay: false,
  };
}
