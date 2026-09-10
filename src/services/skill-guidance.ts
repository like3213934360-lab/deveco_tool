import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resourceRoot } from "../core/config.js";
import { digest, fileDigest, inside } from "../core/files.js";
import { invariant } from "../core/errors.js";
import { SkillService } from "./skills.js";

export const guidedKinds = [
  "plan",
  "debug",
  "spec",
  "customize",
  "arkts",
  "repair",
  "create",
  "ui_test",
] as const;
export type GuidedKind = (typeof guidedKinds)[number];
export const guidedPhases = [
  "planning",
  "implementing",
  "verifying",
  "completed",
  "cancelled",
] as const;
type Phase = (typeof guidedPhases)[number];
type Recipe = {
  description: string;
  skills: string[];
  knowledge: string[];
  native_workflows: string[];
  completion_workflows: string[];
  guidance: Record<"planning" | "implementing" | "verifying", string>;
};
const core = "arkts-grammar-standards/recipes-core";
const engineering = {
  planning:
    "Inspect the captured project, SDK, original requirements and entry routes. Read the included Skill and knowledge before editing. Write the implementation plan and concrete acceptance criteria through skill_workflow write.",
  implementing:
    "Use the client's file editing capability to make the scoped changes. Native operations use the returned MCP tools and workflow schemas. Inspect business results, repair blocking diagnostics and recheck. Record progress without removing the original requirements.",
  verifying:
    "Use the native workflows appropriate to the original acceptance criteria. Read their terminal results and artifacts. Record applicable evidence_run_ids and compare the observations to the requirement. Failed, unrelated or insufficient evidence cannot justify completion.",
};
export const guidedRecipes: Record<GuidedKind, Recipe> = {
  plan: {
    description: "Plan and carry out a scoped HarmonyOS task",
    skills: ["deveco-native-tools"],
    knowledge: [],
    native_workflows: [
      "project_create",
      "project_sync",
      "project_build",
      "code_diagnose",
      "build_deploy_verify",
      "crash_diagnose",
      "api_compatibility",
    ],
    completion_workflows: [],
    guidance: engineering,
  },
  debug: {
    description: "Reproduce, investigate, repair and verify a runtime failure",
    skills: ["deveco-runtime-debug", "deveco-native-tools"],
    knowledge: [],
    native_workflows: [
      "crash_diagnose",
      "code_diagnose",
      "project_build",
      "build_deploy_verify",
    ],
    completion_workflows: ["build_deploy_verify", "ui_test", "ui_flow"],
    guidance: {
      ...engineering,
      planning:
        "Capture the original symptom, app, device and reproduction in notes.md. Read the bundled debugging Skill. Collect bounded crash/log evidence, distinguish facts from hypotheses, and choose the next observation that can distinguish causes.",
    },
  },
  spec: {
    description:
      "Implement a specification with persistent requirements, plan, tasks and evidence",
    skills: ["deveco-arkts-standards", "deveco-native-tools"],
    knowledge: [core],
    native_workflows: [
      "project_sync",
      "code_diagnose",
      "project_build",
      "build_deploy_verify",
    ],
    completion_workflows: ["project_build", "build_deploy_verify", "ui_test"],
    guidance: {
      ...engineering,
      planning:
        "Write spec.md with requirements, user scenarios and acceptance criteria; plan.md with technical context and project structure; tasks.md with checkable work. All documents must be complete before implementing. Read the bundled ArkTS rules before the first edit.",
    },
  },
  customize: {
    description:
      "Configure a selected MCP client using its actual supported interfaces",
    skills: ["deveco-customize-host"],
    knowledge: [],
    native_workflows: [],
    completion_workflows: [],
    guidance: {
      ...engineering,
      planning:
        "Identify the selected client and the requested configuration change. Inspect its actual supported schema. Record the minimal change, validation and recovery in notes.md. Bundled HarmonyOS Skills already run through MCP; do not install Skill files into the client.",
    },
  },
  arkts: {
    description:
      "Implement ArkTS/ArkUI changes using bundled standards and native validation",
    skills: ["deveco-arkts-standards"],
    knowledge: [core],
    native_workflows: ["code_diagnose", "project_build", "build_deploy_verify"],
    completion_workflows: ["project_build", "build_deploy_verify"],
    guidance: engineering,
  },
  repair: {
    description: "Repair blocking ArkTS diagnostics, recheck and build",
    skills: ["deveco-arkts-errors", "deveco-arkts-standards"],
    knowledge: [core],
    native_workflows: ["code_diagnose", "project_build"],
    completion_workflows: ["project_build"],
    guidance: {
      ...engineering,
      planning:
        "Capture the failing native diagnostic and affected declarations. Search the bundled arkts-error-fixes knowledge and read the matching cases. Record the actual cause and repair plan; retain the original failing evidence.",
    },
  },
  create: {
    description:
      "Create an SDK-matched project, implement its launch flow and build it",
    skills: ["deveco-project-create", "deveco-arkts-standards"],
    knowledge: [core],
    native_workflows: [
      "project_create",
      "project_sync",
      "project_build",
      "build_deploy_verify",
    ],
    completion_workflows: ["project_build", "build_deploy_verify"],
    guidance: engineering,
  },
  ui_test: {
    description:
      "Execute an original UI test plan with persistent steps, scoped actions and image review",
    skills: ["deveco-native-tools", "deveco-runtime-debug"],
    knowledge: [],
    native_workflows: ["app_deploy", "build_deploy_verify"],
    completion_workflows: ["ui_test"],
    guidance: {
      ...engineering,
      implementing:
        "Use ui_test start/plan/resume with the captured app, target and original test plan. Follow the current step using fresh UI evidence and bounded actions. Check, read the exact review images and submit actual observations via ui_review. Replan when no progress is detected; do not replay uncertain actions.",
      verifying:
        "Every original step must satisfy its native assertion and required image review. Call ui_test finish, read the report and attach that succeeded ui_test run as evidence. Export retained screenshots and logs when requested.",
    },
  },
};
export function guidedCatalog() {
  return {
    delivery: "builtin_mcp",
    client_skill_installation: false,
    workflows: guidedKinds.map((kind) => ({
      kind,
      ...guidedRecipes[kind],
      phases: guidedPhases,
      start: { tool: "skill_workflow", action: "start", kind },
      definition_sha256: digest(guidedRecipes[kind]),
    })),
  };
}

/** All recipe content comes from this installation, never a client Skill folder. */
export class SkillGuidance {
  constructor(
    readonly skills: SkillService,
    readonly resources = resourceRoot,
  ) {}
  private knowledge(id: string) {
    const entries = z
      .array(
        z
          .object({ id: z.string(), file: z.string(), sha256: z.string() })
          .passthrough(),
      )
      .parse(
        JSON.parse(
          fs.readFileSync(path.join(this.resources, "knowledge.json"), "utf8"),
        ),
      );
    const entry = entries.find((entry) => entry.id === id);
    invariant(
      entry,
      "KNOWLEDGE_NOT_FOUND",
      "A builtin workflow requires a missing knowledge entry",
    );
    const file = inside(this.resources, entry.file);
    invariant(
      fileDigest(file) === entry.sha256,
      "KNOWLEDGE_DIGEST_MISMATCH",
      "Workflow knowledge differs from the packaged catalog",
    );
    const content = fs.readFileSync(file, "utf8");
    return {
      id,
      sha256: entry.sha256,
      content: content.slice(0, 8192),
      total_characters: content.length,
      continuation:
        content.length > 8192
          ? { tool: "harmony_knowledge", action: "read", id, offset: 8192 }
          : null,
    };
  }
  identity(kind: GuidedKind) {
    const recipe = guidedRecipes[kind];
    return digest({
      recipe,
      skills: recipe.skills.map(
        (name) => this.skills.read(name).package_sha256,
      ),
      knowledge: recipe.knowledge.map((id) => {
        const item = this.knowledge(id);
        return { id, sha256: item.sha256 };
      }),
    });
  }
  read(kind: GuidedKind, phase: Phase) {
    const recipe = guidedRecipes[kind],
      terminal = phase === "completed" || phase === "cancelled";
    return {
      delivery: "builtin_mcp",
      client_skill_installation: false,
      instruction: terminal
        ? "This workflow is settled. Its retained results remain available over MCP."
        : recipe.guidance[phase],
      skills: terminal
        ? []
        : recipe.skills.map((name) => this.skills.read(name)),
      knowledge:
        !terminal && phase === "planning"
          ? recipe.knowledge.map((id) => this.knowledge(id))
          : [],
      native_workflows: recipe.native_workflows.map((workflow) => ({
        tool: "workflow_catalog",
        action: "get",
        workflow,
      })),
      next_action: terminal
        ? null
        : {
            tool: "skill_workflow",
            action: phase === "planning" ? "write" : "transition",
            required_phase:
              phase === "planning"
                ? "implementing"
                : phase === "implementing"
                  ? "verifying"
                  : "completed",
          },
      completion_workflows: recipe.completion_workflows,
      client_capabilities: [
        "MCP tool calls",
        "reasoning",
        ...(kind === "ui_test"
          ? ["image understanding"]
          : ["project file reading and editing when required"]),
      ],
    };
  }
}
