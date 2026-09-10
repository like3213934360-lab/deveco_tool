import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PayloadCipher } from "../core/crypto.js";
import { atomicWrite, destinationPath, digest } from "../core/files.js";
import { invariant, ToolError } from "../core/errors.js";
import type { StateStore } from "../core/store.js";
import { SkillService } from "./skills.js";
import {
  guidedKinds,
  guidedPhases,
  guidedCatalog,
  guidedRecipes,
  SkillGuidance,
} from "./skill-guidance.js";

const kindSchema = z.enum(guidedKinds);
const phaseSchema = z.enum(guidedPhases);
const documentName = z.enum(["plan.md", "spec.md", "tasks.md", "notes.md"]);
const revision = z.number().int().min(1).max(200);
const deviceScope = z.strictObject({
  target: z.string().trim().min(1).max(256),
  bundle_name: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_.]*$/)
    .max(256),
});
export const skillWorkflowSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("catalog") }),
  z.strictObject({
    action: z.literal("start"),
    kind: kindSchema,
    project_path: z.string().min(1),
    objective: z.string().trim().min(1).max(8192),
    device: deviceScope.optional(),
    request_key: z.string().min(1).max(128).optional(),
  }),
  z.strictObject({
    action: z.literal("list"),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  z.strictObject({ action: z.literal("read"), run_id: z.string().uuid() }),
  z.strictObject({
    action: z.literal("write"),
    run_id: z.string().uuid(),
    expected_revision: revision,
    name: documentName,
    content: z.string().trim().min(1).max(65536),
  }),
  z.strictObject({
    action: z.literal("transition"),
    run_id: z.string().uuid(),
    expected_revision: revision,
    phase: phaseSchema,
    rationale: z.string().trim().min(10).max(8192),
    evidence_run_ids: z.array(z.string().uuid()).max(32).default([]),
  }),
  z.strictObject({
    action: z.literal("publish"),
    run_id: z.string().uuid(),
    expected_revision: revision,
    name: documentName,
    file: z.string().min(1),
  }),
]);
const documentSchema = z.strictObject({
  content: z.string(),
  content_sha256: z.string(),
  artifact_id: z.string(),
  validation: z.array(z.string()),
});
const payloadSchema = z.strictObject({
  project_path: z.string(),
  objective: z.string(),
  kind: kindSchema,
  revision,
  phase: phaseSchema,
  definition_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  device: deviceScope.optional(),
});
// A partial enum-key record allows documents to be written independently.
const stateSchema = payloadSchema.extend({
  documents: z.partialRecord(documentName, documentSchema),
  transitions: z
    .array(
      z.object({
        phase: phaseSchema,
        rationale: z.string(),
        evidence: z.array(
          z.object({
            run_id: z.string(),
            workflow: z.string(),
            result_sha256: z.string(),
          }),
        ),
        at: z.number(),
      }),
    )
    .max(200),
});
type State = z.infer<typeof stateSchema>;
type Row = {
  run_id: string;
  revision: number;
  phase: State["phase"];
  kind: State["kind"];
  payload: string;
  updated: number;
};

/** MCP owns the bundled instructions, phases, documents and completion gates. */
export class SkillWorkflowService {
  private readonly cipher: PayloadCipher;
  readonly guidance: SkillGuidance;
  constructor(
    readonly store: StateStore,
    skills = new SkillService(store),
  ) {
    this.cipher = new PayloadCipher(
      path.join(store.root, "skill-workflow.key"),
    );
    this.guidance = new SkillGuidance(skills, skills.resources);
  }
  private row(id: string) {
    const row = this.store.db
      .prepare("SELECT * FROM skill_workflows WHERE run_id=?")
      .get(id) as Row | undefined;
    invariant(
      row,
      "SKILL_WORKFLOW_NOT_FOUND",
      "Unknown builtin Skill workflow; use skill_workflow list",
    );
    return row;
  }
  private state(row: Row) {
    return stateSchema.parse(
      JSON.parse(this.cipher.open(row.run_id, row.payload)),
    );
  }
  read(id: string) {
    const row = this.row(id),
      state = this.state(row);
    const definitionCurrent =
      state.definition_sha256 === this.guidance.identity(state.kind);
    return {
      run_id: id,
      ...state,
      status: this.store.get(id).status,
      verified: false,
      assessment_source: "skill_workflow",
      definition_current: definitionCurrent,
      guidance: {
        ...this.guidance.read(
          state.kind,
          definitionCurrent ? state.phase : "cancelled",
        ),
        blocked: definitionCurrent ? null : "SKILL_WORKFLOW_DEFINITION_CHANGED",
      },
      completion_meaning:
        "The builtin workflow reached its completion gates. Native evidence and the client's recorded assessment remain distinct from proof of arbitrary prose requirements.",
    };
  }
  private persist(id: string, state: State, quotaRecovery = false) {
    const json = JSON.stringify(stateSchema.parse(state));
    if (!quotaRecovery) this.store.capacity(Buffer.byteLength(json) * 2 + 4096);
    this.store.db
      .prepare(
        "UPDATE skill_workflows SET revision=?,phase=?,payload=?,updated=? WHERE run_id=?",
      )
      .run(
        state.revision,
        state.phase,
        this.cipher.seal(id, json),
        Date.now(),
        id,
      );
  }
  private validate(name: z.infer<typeof documentName>, content: string) {
    const required =
      name === "spec.md"
        ? [
            "Requirements|需求",
            "Success Criteria|成功标准|验收标准",
            "User Scenarios|用户场景",
          ]
        : name === "plan.md"
          ? [
              "Technical Context|技术背景|技术上下文",
              "Project Structure|项目结构",
            ]
          : [];
    const headings = content
      .split(/\r?\n/)
      .filter((line) => /^#{1,6} /.test(line));
    const issues = required
      .filter(
        (pattern) =>
          !headings.some((heading) => new RegExp(pattern, "i").test(heading)),
      )
      .map((pattern) => `Missing section: ${pattern}`);
    if (name === "tasks.md" && !/^\s*[-*] \[[ xX]\] /m.test(content))
      issues.push("No checkable implementation tasks");
    return issues;
  }
  call(raw: unknown, signal?: AbortSignal) {
    const input = skillWorkflowSchema.parse(raw);
    signal?.throwIfAborted();
    if (input.action === "catalog") return guidedCatalog();
    if (input.action === "list")
      return this.store.db
        .prepare(
          "SELECT run_id,kind,phase,revision,updated FROM skill_workflows ORDER BY updated DESC,run_id DESC LIMIT ? OFFSET ?",
        )
        .all(input.limit, input.offset);
    if (input.action === "read") return this.read(input.run_id);
    if (input.action === "start")
      return this.store.db
        .transaction(() => {
          invariant(
            path.isAbsolute(input.project_path) &&
              (fs.existsSync(input.project_path)
                ? fs.statSync(input.project_path).isDirectory()
                : input.kind === "create"),
            "PROJECT_PATH_REQUIRED",
            "Use an existing absolute project directory, or a new absolute destination for kind=create",
          );
          const project = fs.existsSync(input.project_path)
              ? fs.realpathSync.native(input.project_path)
              : destinationPath(input.project_path),
            identity = {
              kind: input.kind,
              project_path: project,
              objective: input.objective,
              ...(input.device ? { device: input.device } : {}),
            };
          invariant(
            input.kind !== "ui_test" || input.device,
            "SKILL_WORKFLOW_DEVICE_REQUIRED",
            "Start a UI test workflow with its explicit device target and bundle_name",
          );
          const created = this.store.create(
            "skill_workflow",
            identity,
            input.request_key,
            identity,
          );
          if (!created.created) return this.read(created.run.id);
          const id = created.run.id,
            state: State = {
              ...identity,
              revision: 1,
              phase: "planning",
              definition_sha256: this.guidance.identity(input.kind),
              documents: {},
              transitions: [],
            };
          this.store.capacity(
            Buffer.byteLength(JSON.stringify(state)) * 2 + 4096,
          );
          this.store.db
            .prepare("INSERT INTO skill_workflows VALUES (?,?,?,?,?,?)")
            .run(
              id,
              state.kind,
              1,
              state.phase,
              this.cipher.seal(id, JSON.stringify(state)),
              Date.now(),
            );
          this.store.update(id, "needs_input", {
            run_id: id,
            phase: state.phase,
            verified: false,
          });
          return this.read(id);
        })
        .immediate();
    return this.store.db
      .transaction(() => {
        const row = this.row(input.run_id),
          state = this.state(row);
        invariant(
          state.revision === input.expected_revision,
          "SKILL_WORKFLOW_REVISION_CONFLICT",
          "Read the current document revision before updating",
        );
        invariant(
          !this.store.db
            .prepare("SELECT 1 FROM run_pins WHERE run_id=?")
            .get(input.run_id),
          "RUN_PINNED",
          "Builtin workflow evidence is being exported",
        );
        if (input.action === "publish") {
          const doc = state.documents[input.name];
          invariant(
            doc,
            "SKILL_WORKFLOW_DOCUMENT_MISSING",
            "Write the selected document first",
          );
          invariant(
            path.isAbsolute(input.file) &&
              path.basename(input.file) === input.name,
            "SKILL_WORKFLOW_DOCUMENT_PATH_INVALID",
            "Use an absolute new file with the selected document name",
          );
          atomicWrite(input.file, doc.content, false);
          return {
            run_id: input.run_id,
            file: input.file,
            content_sha256: doc.content_sha256,
            published: true,
            revision: state.revision,
          };
        }
        const cancelling =
          input.action === "transition" && input.phase === "cancelled";
        invariant(
          cancelling ||
            state.definition_sha256 === this.guidance.identity(state.kind),
          "SKILL_WORKFLOW_DEFINITION_CHANGED",
          "The packaged workflow, Skill or knowledge changed; start a new workflow",
        );
        invariant(
          !["completed", "cancelled"].includes(state.phase) &&
            (cancelling || state.revision < 200),
          "SKILL_WORKFLOW_SETTLED",
          "Start a new workflow after completion or the 200-revision limit",
        );
        this.store.claim(input.run_id);
        if (input.action === "write") {
          const validation = this.validate(input.name, input.content),
            artifact = this.store.artifact(
              input.run_id,
              input.content,
              "text/markdown",
            );
          state.documents[input.name] = {
            content: input.content,
            content_sha256: createHash("sha256")
              .update(input.content)
              .digest("hex"),
            artifact_id: artifact.artifact_id,
            validation,
          };
        } else {
          const allowed: Record<State["phase"], string[]> = {
            planning: ["implementing", "cancelled"],
            implementing: ["planning", "verifying", "cancelled"],
            verifying: ["implementing", "completed", "cancelled"],
            completed: [],
            cancelled: [],
          };
          invariant(
            allowed[state.phase].includes(input.phase),
            "SKILL_WORKFLOW_PHASE_INVALID",
            "Follow planning, implementing, verifying, then completed; revisit an earlier phase when evidence requires it",
          );
          if (input.phase !== "cancelled")
            invariant(
              Object.keys(state.documents).length > 0,
              "SKILL_WORKFLOW_DOCUMENT_MISSING",
              "Write the plan, investigation, specification or customization notes before implementation",
            );
          if (
            state.kind === "spec" &&
            ["implementing", "verifying", "completed"].includes(input.phase)
          ) {
            for (const name of ["spec.md", "plan.md", "tasks.md"] as const)
              invariant(
                state.documents[name] &&
                  state.documents[name]!.validation.length === 0,
                "SKILL_WORKFLOW_SPEC_INCOMPLETE",
                "Spec work requires requirements/scenarios/acceptance, technical plan and checkable tasks",
              );
          }
          const evidence = input.evidence_run_ids.map((id) => {
            const run = this.store.get(id);
            invariant(
              id !== input.run_id &&
                run.workflow !== "skill_workflow" &&
                run.status === "succeeded",
              "SKILL_WORKFLOW_EVIDENCE_INCOMPLETE",
              "Evidence must refer to a completed native workflow or UI test",
            );
            invariant(
              [
                ...guidedRecipes[state.kind].native_workflows,
                ...guidedRecipes[state.kind].completion_workflows,
              ].includes(run.workflow),
              "SKILL_WORKFLOW_EVIDENCE_UNRELATED",
              "Select native evidence applicable to this builtin workflow",
            );
            const context = z
              .object({
                project_path: z.string().optional(),
                target: z.string().optional(),
                app: z
                  .object({ bundle_name: z.string() })
                  .passthrough()
                  .optional(),
                parameters: z
                  .object({
                    app: z
                      .object({ bundle_name: z.string() })
                      .passthrough()
                      .optional(),
                  })
                  .passthrough()
                  .optional(),
                flow: z
                  .object({
                    app: z.object({ bundleName: z.string() }).passthrough(),
                  })
                  .passthrough()
                  .optional(),
              })
              .passthrough()
              .parse(JSON.parse(run.input));
            const app =
              context.app ??
              context.parameters?.app ??
              (context.flow
                ? { bundle_name: context.flow.app.bundleName }
                : undefined);
            const projectMatches = context.project_path === state.project_path;
            const deviceMatches = Boolean(
              state.device &&
              context.target === state.device.target &&
              app?.bundle_name === state.device.bundle_name,
            );
            invariant(
              (context.project_path ? projectMatches : deviceMatches) &&
                (!state.device || !context.target || deviceMatches),
              "SKILL_WORKFLOW_EVIDENCE_SCOPE_MISMATCH",
              "Evidence must belong to the captured project and, for device-only evidence, the explicit device and application",
            );
            if (input.phase === "completed") {
              const implementation = state.transitions.findLast(
                (item) => item.phase === "implementing",
              );
              invariant(
                implementation && run.created >= implementation.at,
                "SKILL_WORKFLOW_EVIDENCE_STALE",
                "Completion requires native evidence started after the latest implementation phase began",
              );
            }
            return {
              run_id: id,
              workflow: run.workflow,
              result_sha256: digest(run.result),
            };
          });
          if (
            input.phase === "completed" &&
            guidedRecipes[state.kind].completion_workflows.length
          )
            invariant(
              evidence.length > 0,
              "SKILL_WORKFLOW_EVIDENCE_REQUIRED",
              "Complete this builtin workflow with applicable successful native evidence; continue when verification is unavailable",
            );
          if (
            input.phase === "completed" &&
            evidence.length &&
            guidedRecipes[state.kind].completion_workflows.length
          )
            invariant(
              evidence.some((item) =>
                guidedRecipes[state.kind].completion_workflows.includes(
                  item.workflow,
                ),
              ),
              "SKILL_WORKFLOW_EVIDENCE_UNRELATED",
              "The completed native workflow does not meet this recipe's completion gate",
            );
          if (input.phase === "completed" && state.kind === "spec")
            invariant(
              !/^\s*[-*] \[ \] /m.test(state.documents["tasks.md"]!.content),
              "SKILL_WORKFLOW_TASKS_INCOMPLETE",
              "Open specification tasks remain; complete or revise them against the original requirements before concluding",
            );
          state.phase = input.phase;
          for (const item of evidence)
            this.store.db
              .prepare("INSERT OR IGNORE INTO run_dependencies VALUES (?,?)")
              .run(input.run_id, item.run_id);
          state.transitions.push({
            phase: input.phase,
            rationale: input.rationale,
            evidence,
            at: Date.now(),
          });
        }
        state.revision = Math.min(200, state.revision + 1);
        this.persist(input.run_id, state, cancelling);
        if (state.phase === "completed")
          this.store.artifact(
            input.run_id,
            JSON.stringify({
              ...state,
              verified: false,
              source: "skill_workflow",
            }),
            "application/json",
          );
        this.store.update(
          input.run_id,
          state.phase === "completed"
            ? "succeeded"
            : state.phase === "cancelled"
              ? "cancelled"
              : "needs_input",
          {
            run_id: input.run_id,
            phase: state.phase,
            revision: state.revision,
            verified: false,
          },
        );
        try {
          this.store.event(input.run_id, "skill_workflow_updated", {
            action: input.action,
            kind: state.kind,
            phase: state.phase,
            revision: state.revision,
          });
        } catch (error) {
          if (
            !cancelling ||
            !(error instanceof ToolError) ||
            error.code !== "STATE_CAPACITY"
          )
            throw error;
        }
        return cancelling
          ? {
              run_id: input.run_id,
              status: "cancelled",
              phase: "cancelled",
              revision: state.revision,
              verified: false,
            }
          : this.read(input.run_id);
      })
      .immediate();
  }
  close() {
    this.cipher.close();
  }
}
