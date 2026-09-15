import { z } from "zod";
import { createHash } from "node:crypto";
import { protocolVersion } from "./config.js";
import { invariant } from "./errors.js";
import { recoverySchema } from "./recovery.js";
import {
  tools,
  dailySignatureSchema,
  dailyEmulatorSchema,
  signatureAdminActions,
  emulatorAdminActions,
  type ToolName,
  workflowInputs,
  workflowNames,
  type WorkflowName,
  publicWorkflowRunSchema,
} from "./contracts.js";
import { storageContract } from "./workflow-run-contract.js";

export const workflowMetadata: Record<
  WorkflowName,
  { description: string; capabilities: string[]; completion: string }
> = {
  project_create: {
    description:
      "Create an SDK-matched project in a new or empty directory; explicit merge publishes conflict-free additions.",
    capabilities: ["sdk", "templates"],
    completion:
      "The generated project model and application identity are valid.",
  },
  project_sync: {
    description:
      "Install dependencies, synchronize and verify the native project model.",
    capabilities: ["ohpm", "hvigor"],
    completion: "OHPM and Hvigor complete and a current model is present.",
  },
  project_build: {
    description:
      "Auto-sync when needed, run a fresh ArkTS preflight, then build and validate matching package artifacts.",
    capabilities: ["hvigor"],
    completion:
      "Native compilation succeeds and each reported artifact exists with a digest.",
  },
  app_deploy: {
    description:
      "Validate a package, install, launch and check delayed process stability and the application frame.",
    capabilities: ["hdc"],
    completion:
      "Installation and launch are acknowledged and the bounded startup check passes. UI startup checks are default; a declared headless contract checks only process stability. Business behavior still needs a separate assertion.",
  },
  build_run: {
    description: "Build or reuse a succeeded build, install and launch the captured application; hot apply preserves the running process.",
    capabilities: ["hvigor", "hdc"],
    completion: "Build or hot apply succeeds and the bounded startup check passes. This does not evaluate business behavior or a UI assertion.",
  },
  build_deploy_verify: {
    description:
      "Check current ArkTS sources, build or hot apply only after preflight, deploy, execute a saved route and verify an explicit UI assertion.",
    capabilities: ["hvigor", "hdc", "uitest"],
    completion:
      "The specified final UI assertion passes on the captured target.",
  },
  code_diagnose: {
    description:
      "Correlate multiple native diagnostic sources and local cases. For one checker use arkts_check, code_lint or an LSP query; ordinary builds already run preflight.",
    capabilities: ["arkts"],
    completion:
      "Requested checks complete with classified diagnostics; this is not compilation proof.",
  },
  crash_diagnose: {
    description:
      "Analyze retained deployment/UI-task logs via source_run_id, fixed local evidence or bounded device logs. Historical analysis keeps gaps and never replays the failure.",
    capabilities: [],
    completion:
      "Evidence and parsed findings are reported, including insufficient-evidence status.",
  },
  api_compatibility: {
    description:
      "For an SDK/API upgrade or requested scan, validate source/target versions and report affected code. Ordinary source builds do not require this scan.",
    capabilities: ["apiscan", "hvigor"],
    completion:
      "The API scanner completes with reports or an explicit no-change result.",
  },
};
export function workflowCatalog(id?: WorkflowName) {
  return {
    protocol: protocolVersion,
    recipes: { tool: "domain_recipe", action: "catalog" },
    ui_action_contract: { tool: "workflow_catalog", action: "ui_actions" },
    workflows: (id ? [id] : workflowNames).map((name) => ({
      id: name,
      ...workflowMetadata[name],
      ...(id ? {
        input_schema: z.toJSONSchema(workflowInputs[name], { io: "input" }),
        resume_input_schema: {
          type: "object",
          properties: { action: { const: "recheck" } },
          required: ["action"],
          additionalProperties: false,
        },
      } : { read: { tool: "workflow_catalog", action: "get", workflow: name } }),
    })),
  };
}
export const resultSchema = z.union([
  z.strictObject({ ok: z.literal(true), request_id: z.string(), data: z.unknown() }),
  z.strictObject({ ok: z.literal(false), request_id: z.string(), error: z.strictObject({
    code: z.string(), message: z.string(), details: z.unknown().optional(), retryable: z.boolean(), recovery: recoverySchema.optional(),
  }) }),
]);
const resultJsonSchema = z.toJSONSchema(resultSchema);
// MCP clients cache compiled validators by schema identity. Include the content digest
// so repeated catalog reads reuse validation without accidentally reusing an old schema.
const outputSchema = {
  ...resultJsonSchema,
  $id: `urn:deveco-tool:result:${createHash("sha256").update(JSON.stringify(resultJsonSchema)).digest("hex")}`,
  type: "object" as const,
};
export const toolGroupNames = ["core", "signing-admin", "emulator-admin", "compatibility"] as const;
export type ToolGroup = (typeof toolGroupNames)[number];
const compatibilityTools = new Set<ToolName>(["skill_workflow", "switch_cwd", "deveco_restart", "ui_observe", "ui_find", "ui_inspect", "ui_tap"]);
const readOnlyTools = new Set<ToolName>(["skill_manage", "domain_content", "domain_recipe", "workflow_catalog", "harmony_knowledge", "project_context", "deveco_doctor", "device_info", "switch_cwd", "lsp"]);
const destructiveTools = new Set<ToolName>(["workflow_run", "maintenance", "deveco_restart", "skill_workflow", "harmony_auth", "hot_reload", "app_signature", "signature_admin", "ui_control", "ui_tap", "ui_flow", "ui_test", "emulator_manage", "emulator_admin", "emulator_scenario", "hdc_log"]);
const openWorldTools = new Set<ToolName>(["harmony_auth", "harmony_knowledge", "signature_admin", "workflow_run", "emulator_admin"]);

/** Capture once per connection; device/auth availability never changes the tool set. */
export function configuredToolGroups(value = process.env.DEVECO_TOOL_GROUPS): ToolGroup[] {
  const groups = value ? value.split(",").map(group => group.trim()).filter(Boolean) : ["core"];
  invariant(groups.every(group => (toolGroupNames as readonly string[]).includes(group)), "TOOL_GROUP_INVALID", "DEVECO_TOOL_GROUPS accepts core,signing-admin,emulator-admin,compatibility");
  return [...new Set<ToolGroup>(["core", ...groups as ToolGroup[]])];
}
export function toolGroup(name: ToolName): ToolGroup {
  if (name === "signature_admin") return "signing-admin";
  if (name === "emulator_admin") return "emulator-admin";
  return compatibilityTools.has(name) ? "compatibility" : "core";
}
export function connectionInputSchema(name: ToolName) {
  if (name === "workflow_run") return publicWorkflowRunSchema;
  if (name === "app_signature") return dailySignatureSchema;
  if (name === "emulator_manage") return dailyEmulatorSchema;
  return tools[name].schema;
}
export function parseConnectionInput(name: ToolName, input: unknown, groups: readonly ToolGroup[]) {
  const group = toolGroup(name);
  // Hidden aliases stay callable for migration. Cloud/image administration is a
  // connection-level capability, never enabled by a device appearing mid-session.
  invariant(group === "core" || group === "compatibility" || groups.includes(group), "TOOL_GROUP_DISABLED", `Enable the ${group} group in DEVECO_TOOL_GROUPS and reconnect`);
  const action = input && typeof input === "object" && "action" in input ? (input as { action: unknown }).action : undefined;
  if (name === "workflow_run" && storageContract.options.some(option => option.shape.action.value === action))
    return storageContract.parse(input);
  const legacyAdminGroup = name === "app_signature" && (signatureAdminActions as readonly unknown[]).includes(action)
    ? "signing-admin" : name === "emulator_manage" && (emulatorAdminActions as readonly unknown[]).includes(action) ? "emulator-admin" : null;
  if (legacyAdminGroup) {
    invariant(groups.includes(legacyAdminGroup), "TOOL_GROUP_DISABLED", `This legacy management action moved to ${name === "app_signature" ? "signature_admin" : "emulator_admin"}; enable ${legacyAdminGroup} in DEVECO_TOOL_GROUPS and reconnect`);
    return tools[name].schema.parse(input);
  }
  return connectionInputSchema(name).parse(input);
}
/** Local references share repeated contracts without changing validation or discovery. */
export function compactInputSchema(schema: z.ZodType) {
  const inline = { ...z.toJSONSchema(schema, { io: "input" }), type: "object" as const };
  const referenced = { ...z.toJSONSchema(schema, { io: "input", reused: "ref" }), type: "object" as const };
  // References help nested UI contracts but add overhead to small scalar schemas.
  return JSON.stringify(referenced).length < JSON.stringify(inline).length ? referenced : inline;
}
export function createToolCatalog(groups: readonly ToolGroup[] = ["core"]) {
  return (Object.entries(tools) as [ToolName, (typeof tools)[ToolName]][])
    .filter(([name]) => groups.includes(toolGroup(name)))
    .map(([name, definition]) => ({
      name,
      description: name === "app_signature"
        ? "Inspect/configure local signing, create keypairs/CSRs, sign or verify packages. Cloud certificates/profiles/device registration use the optional signature_admin group."
        : name === "emulator_manage"
          ? "List, start or stop installed emulators. Instance/image installation and licenses use the optional emulator_admin group. Mutations retain run IDs and inventory reconciliation."
          : definition.description,
      inputSchema: compactInputSchema(connectionInputSchema(name)),
      outputSchema,
      annotations: {
        title: name.replaceAll("_", " "),
        readOnlyHint: readOnlyTools.has(name),
        destructiveHint: destructiveTools.has(name),
        idempotentHint: readOnlyTools.has(name),
        openWorldHint: openWorldTools.has(name) || (name === "app_signature" && groups.includes("signing-admin")) || (name === "emulator_manage" && groups.includes("emulator-admin")),
      },
      _meta: { "deveco/tool-group": toolGroup(name), "deveco/compatibility": compatibilityTools.has(name), "deveco/annotations-are-authorization": false },
    }));
}
export const toolCatalog = createToolCatalog();
