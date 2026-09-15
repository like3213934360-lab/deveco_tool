import path from "node:path";
import { z } from "zod";
import { PayloadCipher } from "../core/crypto.js";
import { invariant, ToolError } from "../core/errors.js";
import type { StateStore } from "../core/store.js";
import { SkillService } from "./skills.js";
import {
  guidedKinds,
  guidedPhases,
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
  z.strictObject({ action: z.literal("export"), run_id: z.string().uuid() }),
  z.strictObject({ action: z.literal("archive"), run_id: z.string().uuid(), expected_revision: revision }),
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

/** Readable archive of native-7 guidance runs. New work uses domain recipes and native workflows. */
export class SkillWorkflowService {
  private readonly cipher: PayloadCipher;
  constructor(readonly store: StateStore, _skills?: SkillService) {
    this.cipher = new PayloadCipher(path.join(store.root, "skill-workflow.key"));
  }
  private row(id: string) {
    const row = this.store.db.prepare("SELECT * FROM skill_workflows WHERE run_id=?").get(id) as Row | undefined;
    invariant(row, "SKILL_WORKFLOW_NOT_FOUND", "Unknown legacy guidance run; use skill_workflow list");
    return row;
  }
  private state(row: Row) {
    return stateSchema.parse(JSON.parse(this.cipher.open(row.run_id, row.payload)));
  }
  read(id: string) {
    const row = this.row(id), state = this.state(row);
    return { run_id: id, ...state, status: this.store.get(id).status, verified: false,
      assessment_source: "legacy_guidance_archive", read_only: true,
      completion_meaning: "Historical coordination state, not proof of native or business acceptance.",
      migration: { next_tool: "domain_recipe", recipe: state.kind,
        export: "skill_workflow export", archive: "skill_workflow archive",
        evidence: "Native evidence and dependency references remain protected until explicit maintenance cleanup." } };
  }
  call(raw: unknown, signal?: AbortSignal) {
    const input = skillWorkflowSchema.parse(raw);
    signal?.throwIfAborted();
    if (input.action === "catalog") return { legacy: true, read_only: true, next_tool: "domain_recipe", recipes: guidedKinds };
    if (input.action === "list") return this.store.db.prepare("SELECT run_id,kind,phase,revision,updated FROM skill_workflows ORDER BY updated DESC,run_id DESC LIMIT ? OFFSET ?").all(input.limit,input.offset);
    if (input.action === "read") return this.read(input.run_id);
    if (input.action === "export") {
      const value = this.read(input.run_id), json = JSON.stringify({ format: 1, ...value }, null, 2);
      return { run_id: input.run_id, verified: false, archive: this.store.artifact(input.run_id, json, "application/json"),
        next_action: "Read this artifact or use maintenance export to retain all dependent native evidence." };
    }
    if (input.action === "archive" || (input.action === "transition" && input.phase === "cancelled")) {
      return this.store.db.transaction(() => {
        const row = this.row(input.run_id), state = this.state(row);
        invariant(state.revision === input.expected_revision, "SKILL_WORKFLOW_REVISION_CONFLICT", "Read the latest legacy revision before archiving");
        const run = this.store.get(input.run_id);
        invariant(!run.owner && !["running", "cancelling"].includes(run.status), "RUN_BUSY", "Wait for the existing operation to settle");
        // Preserve documents, original objective, revisions and all evidence links.
        // The archived outcome is cancellation, never newly claimed success.
        if (!["cancelled", "completed"].includes(state.phase)) {
          this.store.claim(input.run_id);
          state.phase = "cancelled";
          state.revision = Math.min(200, state.revision + 1);
          if (state.transitions.length < 200) state.transitions.push({ phase: "cancelled", rationale: "Archived during migration to stateless domain recipes", evidence: [], at: Date.now() });
          this.store.db.prepare("UPDATE skill_workflows SET revision=?,phase=?,payload=?,updated=? WHERE run_id=?").run(state.revision,state.phase,this.cipher.seal(input.run_id,JSON.stringify(state)),Date.now(),input.run_id);
          this.store.update(input.run_id,"cancelled",{run_id:input.run_id,phase:state.phase,revision:state.revision,verified:false});
        }
        return this.read(input.run_id);
      }).immediate();
    }
    throw new ToolError("GUIDANCE_LIFECYCLE_RETIRED", "Use domain_recipe for methods/templates, native workflow_run for effects, and ui_test for stateful UI acceptance. Existing guidance runs remain readable/exportable/archivable.", { action: input.action, next_tool: "domain_recipe" });
  }
  close() { this.cipher.close(); }
}
