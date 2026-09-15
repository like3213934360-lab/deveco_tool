import { z } from "zod";
import {
  domainAcceptanceSchema,
  requirementBindingsSchema,
} from "../core/acceptance-contracts.js";
import { digest } from "../core/files.js";
import { invariant, errorResult } from "../core/errors.js";
import type { StateStore } from "../core/store.js";
import {
  evidenceSealSchema,
  resolveEvidenceResult,
} from "./evidence-result.js";

type Input = z.infer<typeof domainAcceptanceSchema>;
type Reference = Input["evidence"][number];
const stepsSchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string(),
        requirement_ids: z.array(z.string()).optional(),
        task_ids: z.array(z.string()).optional(),
        check: z
          .object({ review_id: z.string().uuid().optional() })
          .nullable()
          .optional(),
      }),
    )
    .max(100),
});

/** Resolve only selected runs and recorded, digest-bound build/deployment links. */
export function resolveAcceptanceReferences(
  store: StateStore,
  input: Input,
  uiStatus: (id: string) => Record<string, unknown>,
) {
  const references: Reference[] = [...input.evidence];
  const keys = new Set(references.map((item) => digest(item)));
  const retained = new Set<string>();
  const visited = new Map<string, number>();
  const issues: Record<string, unknown>[] = [];
  const issueKeys = new Set<string>();
  const issue = (row: Record<string, unknown>) => {
    const key = digest(row);
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    if (issues.length < 100) issues.push(row);
  };
  const add = (reference: Reference) => {
    reference = domainAcceptanceSchema.shape.evidence
      .unwrap()
      .element.parse(reference);
    if (keys.has(digest(reference))) return;
    invariant(
      references.length < 400,
      "ACCEPTANCE_EVIDENCE_LIMIT",
      "Resolved evidence exceeds 400 references; select a narrower set of runs/tasks",
    );
    references.push(reference);
    keys.add(digest(reference));
  };
  const visit = (run_id: string, depth: number, expected?: string) => {
    try {
      const run = store.get(run_id);
      retained.add(run.id);
      invariant(
        run.status === "succeeded",
        "EVIDENCE_NOT_SUCCEEDED",
        "Selected evidence is not a succeeded native run",
      );
      const result = resolveEvidenceResult(
        store,
        JSON.parse(run.result ?? "{}"),
      );
      invariant(
        !expected || digest(result) === expected,
        "EVIDENCE_LINK_CHANGED",
        "Recorded build/deployment result digest does not match the retained run",
      );
      if ((visited.get(run.id) ?? Infinity) <= depth) return;
      visited.set(run.id, depth);
      const seal = evidenceSealSchema.parse(result._evidence);
      const bindings =
        seal.requirements ??
        z
          .object({ requirements: requirementBindingsSchema.optional() })
          .parse(JSON.parse(run.input)).requirements;
      const steps =
        run.workflow === "ui_test"
          ? stepsSchema.parse(uiStatus(run.id)).steps
          : [];
      for (const requirement of input.requirements) {
        if (requirement.mode === "host-review") continue;
        if (
          !bindings?.some(
            (row) =>
              row.id === requirement.id &&
              row.revision === requirement.revision &&
              row.text === requirement.text,
          )
        ) {
          issue({
            run_id,
            requirement_id: requirement.id,
            code: "REQUIREMENT_EVIDENCE_UNBOUND",
            reason:
              "This run did not capture the declared requirement text/revision; it cannot be relabeled.",
          });
          continue;
        }
        const base = {
          requirement_id: requirement.id,
          requirement_revision: requirement.revision,
          run_id,
        };
        if (requirement.mode === "ui" && run.workflow === "ui_test") {
          let mapped = false;
          for (const step of steps)
            if (step.requirement_ids?.includes(requirement.id))
              for (const task_id of step.task_ids ?? [])
                if (requirement.task_ids.includes(task_id)) {
                  add({
                    ...base,
                    task_id,
                    assertion_id: step.id,
                    ...(step.check?.review_id
                      ? { review_id: step.check.review_id }
                      : {}),
                  });
                  mapped = true;
                }
          if (!mapped)
            issue({
              run_id,
              requirement_id: requirement.id,
              code: "EVIDENCE_TASK_MAPPING_REQUIRED",
              reason:
                "No captured UI step matches the declared requirement/task IDs.",
            });
          continue;
        }
        const eligible =
          requirement.mode === "build-only"
            ? ["project_build", "build_run", "build_deploy_verify"].includes(
                run.workflow,
              )
            : requirement.mode === "run"
              ? ["app_deploy", "build_run", "build_deploy_verify"].includes(
                  run.workflow,
                )
              : run.workflow === "build_deploy_verify";
        if (!eligible) continue;
        if (requirement.task_ids.length !== 1) {
          issue({
            run_id,
            requirement_id: requirement.id,
            code: "EVIDENCE_TASK_MAPPING_REQUIRED",
            task_ids: requirement.task_ids,
            reason:
              "The run captured the requirement but no task mapping. Provide explicit evidence references for multiple tasks.",
          });
          continue;
        }
        add({
          ...base,
          task_id: requirement.task_ids[0]!,
          ...(requirement.mode === "ui"
            ? { assertion_id: "final_assertion" }
            : {}),
        });
      }
      if (depth < 2)
        for (const link of [seal.deployment, seal.build])
          if (link) visit(link.run_id, depth + 1, link.result_sha256);
    } catch (error) {
      if (errorResult(error).code === "ACCEPTANCE_EVIDENCE_LIMIT") throw error;
      issue({ run_id, ...errorResult(error) });
    }
  };
  for (const run_id of new Set(input.evidence_run_ids)) visit(run_id, 0);
  return {
    references,
    retained_runs: [...retained],
    issues,
    issue_count: issueKeys.size,
    issues_truncated: issueKeys.size > issues.length,
  };
}
