import { z } from "zod";
import { createHash } from "node:crypto";
import { protocolVersion } from "./config.js";
import { guidedCatalog } from "../services/skill-guidance.js";
import {
  tools,
  workflowInputs,
  workflowNames,
  type WorkflowName,
} from "./contracts.js";

export const workflowMetadata: Record<
  WorkflowName,
  { description: string; capabilities: string[]; completion: string }
> = {
  project_create: {
    description:
      "Create an SDK-matched project without overwriting a directory.",
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
      "Optionally sync, run a fresh ArkTS preflight, stop on blocking diagnostics, then build and validate matching package artifacts.",
    capabilities: ["hvigor"],
    completion:
      "Native compilation succeeds and each reported artifact exists with a digest.",
  },
  app_deploy: {
    description:
      "Validate a package, install, launch and inspect application state.",
    capabilities: ["hdc"],
    completion:
      "Installation is acknowledged and the requested application process runs.",
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
      "Run requested native diagnostics and associate local rules and cases.",
    capabilities: ["arkts"],
    completion:
      "Requested checks complete with classified diagnostics; this is not compilation proof.",
  },
  crash_diagnose: {
    description:
      "Collect bounded crash evidence, parse frames and associate local cases.",
    capabilities: [],
    completion:
      "Evidence and parsed findings are reported, including insufficient-evidence status.",
  },
  api_compatibility: {
    description:
      "Validate source/target versions, scan and return native reports.",
    capabilities: ["apiscan", "hvigor"],
    completion:
      "The API scanner completes with reports or an explicit no-change result.",
  },
};
export function workflowCatalog(id?: WorkflowName) {
  return {
    protocol: protocolVersion,
    skill_workflows: guidedCatalog(),
    workflows: (id ? [id] : workflowNames).map((name) => ({
      id: name,
      ...workflowMetadata[name],
      input_schema: z.toJSONSchema(workflowInputs[name], { io: "input" }),
      resume_input_schema: {
        type: "object",
        properties: { action: { const: "recheck" } },
        required: ["action"],
        additionalProperties: false,
      },
    })),
  };
}
export const resultSchema = z.strictObject({
  ok: z.boolean(),
  request_id: z.string(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
      retryable: z.boolean(),
    })
    .optional(),
});
const resultJsonSchema = z.toJSONSchema(resultSchema);
// MCP clients cache compiled validators by schema identity. Include the content digest
// so repeated catalog reads reuse validation without accidentally reusing an old schema.
const outputSchema = {
  ...resultJsonSchema,
  $id: `urn:deveco-tool:result:${createHash("sha256").update(JSON.stringify(resultJsonSchema)).digest("hex")}`,
  type: "object" as const,
};
export const toolCatalog = Object.entries(tools).map(([name, definition]) => ({
  name,
  description: definition.description,
  inputSchema: {
    ...z.toJSONSchema(definition.schema, { io: "input" }),
    type: "object" as const,
  },
  outputSchema,
}));
