import { z } from "zod";
import { resourceRoot } from "../core/config.js";
import { digest } from "../core/files.js";
import { readContentFile } from "./content-file.js";
import { guidedKinds, guidedRecipes } from "./skill-guidance.js";

export const hostCapabilityNames = ["reasoning", "file_read", "file_edit", "image_review", "client_configuration"] as const;
export const domainRecipeSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("catalog"), query: z.string().trim().max(256).default("") }),
  z.strictObject({ action: z.literal("read"), id: z.enum(guidedKinds), host_capabilities: z.array(z.enum(hostCapabilityNames)).max(hostCapabilityNames.length).optional() }),
]);

const methods: Record<(typeof guidedKinds)[number], { purpose: string; method: string[]; dependencies: (typeof hostCapabilityNames)[number][]; acceptance: string[] }> = {
  plan: {
    purpose: "On-demand planning guidance for a HarmonyOS change.",
    method: ["Read the original requirement, selected project, product/module and SDK constraints.", "Choose the smallest native workflows needed for implementation and verification; retain requirement IDs and revisions in host-owned notes.", "The host performs planning and editing. A plan document is coordination output, not native execution or business verification."],
    dependencies: ["reasoning", "file_read"],
    acceptance: ["Select build-only, run, UI or host review per requirement; do not require a device for text-only planning."],
  },
  customize: {
    purpose: "Optional host MCP connection recipe.",
    method: ["Read the chosen host's actual MCP configuration interface and use its supported stdio launch mechanism.", "Use project_path explicitly. Configure optional signing-admin/emulator-admin tool groups once when opening a connection.", "Keep models, providers, permissions, agents, commands and plugins in the host. This recipe does not manage those host subsystems."],
    dependencies: ["reasoning", "client_configuration"],
    acceptance: ["The host confirms connection and tool discovery using its own supported interface; a nonempty configuration document is not a working connection."],
  },
  spec: {
    purpose: "Optional specification templates and domain acceptance relationships.",
    method: ["Preserve the original requirement and subsequent revisions, assign requirement/story IDs, and link implementation task IDs.", "For each requirement define a native assertion or host review and the scope in which it applies.", "Keep spec.md, plan.md and tasks.md in the host's project when useful; no MCP project-management lifecycle is created."],
    dependencies: ["reasoning", "file_read", "file_edit"],
    acceptance: ["Maintain requirement/story -> task -> assertion/review -> evidence references.", "Choose build-only/run/UI/host-review separately per requirement. Match final evidence to the current source, configuration, toolchain, artifact, scope and requirement revision.", "Structured assertions passing does not establish that the host translated every natural-language requirement correctly."],
  },
  arkts: {
    purpose: "Implement ArkTS/ArkUI changes with domain rules and native checks.",
    method: ["Read arkts-grammar-standards/recipes-core when the task needs ArkTS rules; fetch specific references as needed.", "Use host editing while preserving entry-page, module/product and routing declarations.", "For ordinary compilation call project_build directly: it already runs fresh full-scope preflight. For ordinary build and launch use build_run; use build_deploy_verify for an explicit UI assertion. Do not precede these with another full code_diagnose.", "Investigate a specific issue with arkts_check, code_lint or an LSP query. Use code_diagnose when comparing multiple diagnostic sources. Use api_compatibility for an SDK/API upgrade or an explicitly requested scan."],
    dependencies: ["reasoning", "file_read", "file_edit"],
    acceptance: ["ArkTS preflight is not compilation proof. A successful build proves the captured build contract, not every business requirement."],
  },
  repair: {
    purpose: "Repair ArkTS diagnostics using source-linked cases.",
    method: ["Use the failed build's diagnostic positions, report reads and candidate case references first. Search harmony_knowledge only when additional repair evidence is needed.", "Use host editing to repair the cause, then run project_build on the current sources; its fresh preflight replaces a duplicate full diagnostic pass. Use an atomic diagnostic for a focused investigation, or code_diagnose when correlating several checkers.", "For runtime regressions add the corresponding app/UI assertion rather than treating the absence of a compiler error as complete behavior validation."],
    dependencies: ["reasoning", "file_read", "file_edit"],
    acceptance: ["The original failure is absent in applicable fresh diagnostics and the selected current build succeeds; additional business behavior needs its own evidence."],
  },
  create: {
    purpose: "Create an SDK-matched HarmonyOS project with fixed native workflows.",
    method: ["Use project_create for a new or empty destination; nonempty directories require explicit merge=true and must pass non-overwriting conflict checks. Omitted SDK selection uses installed/default configuration under the declared constraints.", "Use the returned descriptor and build input; edit through the host while retaining app, product/module and routing declarations.", "Build and, when required by the user story, deploy and assert the intended launch behavior."],
    dependencies: ["reasoning", "file_read", "file_edit"],
    acceptance: ["A valid generated project is creation evidence. Build, runtime and user-story completion are separate contracts."],
  },
  debug: {
    purpose: "Investigate and repair an observed HarmonyOS runtime failure.",
    method: ["Capture the original symptom, app/device scope and reproduction. Separate observations from hypotheses.", "One-off reproduction can observe and act directly. When a saved path or repeated navigation helps, use ui_flow list/routes with project_path. Read/validate a matching saved flow before run, or record the first reusable authorized navigation with record_start, ui_control and record_stop with an assertion. Keep the business regression assertion separate from navigation success.", "For a failed deployment/UI task, start crash_diagnose with source_run_id to reuse its captured app, device, time window and retained logs. collect_missing=true explicitly supplements only missing historical evidence; inspect gaps/truncation and never replay the failure automatically. Use hdc_log probe/fetch for a separately selected observed faultlog.", "Choose an observation that distinguishes hypotheses, edit through the host, and reproduce again with fresh evidence."],
    dependencies: ["reasoning", "file_read", "file_edit"],
    acceptance: ["Distinguish launch acceptance, process survival, visible application frame and explicit business assertion.", "If evidence is insufficient, retain that status and the next diagnostic action instead of claiming a repair."],
  },
  ui_test: {
    purpose: "Guide the retained stateful UI test protocol.",
    method: ["For a one-off test, start directly with scoped observations/actions. When reusable navigation setup is useful, use ui_flow list/routes with project_path. Prefer a suitable public route or read/validate and run a matching saved flow. If the path will be reused and none fits, record the first authorized traversal with record_start and ui_control, then record_stop with an assertion. Finish setup before starting ui_test with fresh_start=false (default), preserving that application state; true explicitly stops and relaunches.", "Use ui_test start to capture the original plan, app, device and display scope; supply explicit assertion/review steps to initialize in that call, or defer using initialize=false and resume. Once active, use ui_test act/check for its steps; do not substitute flow replay to evade captured scope, budgets or evidence.", "Observe with ui_query and use ui_test act check_after={} for an action with bounded stability observation and a check of its original step. A failed check can be repeated without another action. Three unchanged captures or exhausted action budgets require fresh evidence and a changed strategy.", "Follow response next calls; inspect inline pending-review images or their artifact fallback and submit actual host observations through ui_review; finish only after every required step passes."],
    dependencies: ["reasoning", "image_review"],
    acceptance: ["Native control assertions and host visual assessment remain separate evidence types.", "An image-read receipt proves access to those bytes, not that a visual judgment is objectively correct. Unknown side effects require reconciliation before replay."],
  },
};

export function domainRecipeCatalog(query = "") {
  const normalized = query.toLocaleLowerCase();
  return {
    delivery: "on_demand_guidance", persistence: "host_owned", creates_run: false,
    recipes: guidedKinds.filter(id => `${id} ${methods[id].purpose}`.toLocaleLowerCase().includes(normalized)).map(id => ({
      id, description: methods[id].purpose, uri: `deveco://recipe/${id}`,
      read: { tool: "domain_recipe", action: "read", id },
      kind: id === "customize" ? "optional_host_setup" : id === "spec" ? "optional_template" : "domain_recipe",
    })),
  };
}

/** Stateless content shared by tools, MCP Resources and Prompts. No run is created. */
export function domainRecipeCall(raw: unknown, resources = resourceRoot) {
  const input = domainRecipeSchema.parse(raw);
  if (input.action === "catalog") return domainRecipeCatalog(input.query);
  const definition = methods[input.id], recipe = guidedRecipes[input.id];
  const skillCatalog = z.object({ skills: z.array(z.object({ name: z.string(), upstream: z.unknown(), files: z.array(z.object({ path: z.string(), sha256: z.string() })) })) }).parse(JSON.parse(readContentFile(resources, "skills.json").text));
  const knowledge = z.array(z.object({ id: z.string(), sha256: z.string(), source: z.string(), commit: z.string(), source_path: z.string() })).parse(JSON.parse(readContentFile(resources, "knowledge.json", undefined, 1024 * 1024).text));
  const sourceCatalog = z.object({ entries: z.array(z.object({ id: z.string(), path: z.string(), sha256: z.string(), source: z.string(), commit: z.string(), url: z.string(), kind: z.string(), classification: z.string(), local_file: z.string().nullable() })) }).parse(JSON.parse(readContentFile(resources, "domain-sources.json", undefined, 4 * 1024 * 1024).text));
  const sourceAssets = sourceCatalog.entries.filter(entry => entry.local_file && (
    input.id === "spec" ? ["sdd-command", "sdd-template"].includes(entry.kind) || (entry.kind === "agent-prompt" && /spec-(?:implementation|verify)\.txt$/.test(entry.path))
      : input.id === "debug" ? ["agent-prompt", "builtin-command"].includes(entry.kind) && /debug\.txt$/.test(entry.path)
        : input.id === "plan" ? entry.kind === "agent-prompt" && /prompt\/plan\.txt$/.test(entry.path)
          : false
  )).map(({ id, path, sha256, source, commit, url, kind, classification }) => ({ id, path, sha256, source, commit, url, kind, classification, uri: `deveco://source/${id}`, read: { tool: "domain_content", action: "read", uri: `deveco://source/${id}` }, use: "Source method/reference only; host-specific commands and agent execution remain delegated to the host." }));
  const references = {
    source_assets: sourceAssets,
    skills: recipe.skills.map(name => {
      const entry = skillCatalog.skills.find(item => item.name === name);
      if (!entry) throw new Error(`Recipe ${input.id} references missing Skill ${name}`);
      return { name, uri: `deveco://skill/${name}/SKILL.md`, source: entry.upstream, files: entry.files, read: { tool: "skill_manage", action: "read", name } };
    }),
    knowledge: recipe.knowledge.map(id => {
      const entry = knowledge.find(item => item.id === id);
      if (!entry) throw new Error(`Recipe ${input.id} references missing knowledge ${id}`);
      return { ...entry, uri: `deveco://knowledge/${id}`, read: { tool: "harmony_knowledge", action: "read", id } };
    }),
  };
  const missing = input.host_capabilities ? definition.dependencies.filter(capability => !input.host_capabilities!.includes(capability)) : undefined;
  const content = {
    id: input.id, description: definition.purpose,
    ...(input.id === "customize" ? { upstream_adaptation: { classification: "intentional-boundary", retained: "HarmonyOS MCP connection and domain-content access", host_responsibilities: ["models", "providers", "agents/subagents", "commands", "plugins", "permissions"], equivalent_to_full_DevEco_Code_customization: false } } : {}),
    delivery: "on_demand_guidance", creates_run: false,
    method: definition.method, acceptance: definition.acceptance, references,
    acceptance_policy: {
      required_for_ordinary_development: false,
      use_when: "The user needs delivery assessed against explicitly declared requirements and tasks.",
      ordinary_results: "project_build reports compilation; build_run reports build and startup; UI checks report their declared assertions/reviews.",
      original_bindings: "Capture requirement IDs, revisions and text before producing requirement-bound evidence. Do not retrofit old unbound runs.",
    },
    native_workflows: recipe.native_workflows.map(workflow => ({ tool: "workflow_catalog", action: "get", workflow })),
    host_boundary: { required: definition.dependencies, owns: ["reasoning", "editing", "planning", "model/provider", "sessions", "agents", "permissions"], capability_status: missing === undefined ? "not_declared" : missing.length ? "missing" : "declared", missing: missing ?? [], alternative: missing?.length ? "Use a host or human with the listed missing capabilities; continue available native diagnostics and artifact reads. No embedded model or agent fallback is provided." : null },
    ...(input.id === "spec" ? { template: { requirement: { id: "R1", revision: 1, original_text: "", revisions: [], task_ids: ["T1"], verification_mode: "build-only|run|ui|host-review", assertion_or_review_ids: ["A1"], evidence_run_ids: [] } } } : {}),
  };
  return { ...content, content_sha256: digest(content), completion_claim: "guidance_only" };
}
