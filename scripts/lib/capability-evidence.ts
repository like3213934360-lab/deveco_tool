import path from "node:path";
import { z } from "zod";
import { invariant } from "../../src/core/errors.js";

export const capabilitySha = z.string().regex(/^[a-f0-9]{64}$/);
export const capabilityPath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !path.isAbsolute(value) &&
      !/[\\:\x00-\x1f]/.test(value) &&
      value.split("/").every((part) => part && part !== "." && part !== ".."),
  );
export const capabilityIdentityFields = [
  "source_sha256",
  "runtime_sha256",
  "compiled_sha256",
  "package_lock_sha256",
  "resource_manifest_sha256",
  "upstream_lock_sha256",
] as const;
export const capabilityScope = z.strictObject({
  language: z.enum(["arkts", "cpp", "none"]),
  platform: z.enum(["darwin", "win32", "linux", "any"]),
  // Null means this requirement does not constrain the SDK. Never substitute
  // another SDK for a concrete version in a language acceptance requirement.
  sdk: z.string().min(1).nullable(),
});
export const capabilityOperation = z.strictObject({
  id: z.string().min(1),
  parameters: z.array(z.string()),
  replacement: z.string().min(10),
  disposition: z.enum(["required", "client_required", "explicitly_excluded"]),
  policy: z.enum(["host-general-tools", "builtin-mcp-skills-only"]).nullable(),
  implementation: z.enum(["pending", "implemented", "not_applicable"]),
  acceptance: z.enum(["pending", "verified", "boundary_verified"]),
  required_scopes: z.array(capabilityScope),
  targets: z.array(capabilityPath).min(1),
  tests: z.array(capabilityPath).min(1),
  evidence: z.array(
    z.strictObject({
      file: capabilityPath,
      sha256: capabilitySha,
      case: z.string().min(1),
    }),
  ),
  boundary: z.string().min(10),
});
const artifact = z.strictObject({
  file: capabilityPath,
  sha256: capabilitySha,
});
export const capabilityCase = z.strictObject({
  id: z.string().min(1),
  operation: z.string().min(1),
  passed: z.boolean(),
  service_support: z.enum([
    "available",
    "unavailable",
    "unknown",
    "not_applicable",
  ]),
  outcome: z.enum([
    "executed",
    "unsupported",
    "unverified",
    "client_required",
    "explicitly_excluded",
  ]),
  environment: capabilityScope.extend({
    platform: z.enum(["darwin", "win32", "linux"]),
    node: z.string().regex(/^v?(?:22|24)\.\d+\.\d+$/),
    server: z.string().min(1).nullable(),
    client: z.string().min(1),
  }),
  source: z.enum([
    "public_mcp",
    "sdk_response",
    "client_contract",
    "product_decision",
  ]),
  // Unsupported is a server observation, never a local capability gate or
  // missing executable. The original response must remain in the artifacts.
  support_evidence: z
    .strictObject({
      layer: z.enum(["sdk", "service"]),
      request_dispatched: z.literal(true),
      response_code: z.union([z.number().int(), z.string().min(1)]),
      method: z.string().min(1),
    })
    .optional(),
  policy: z.enum(["host-general-tools", "builtin-mcp-skills-only"]).nullable(),
  scope: z.string().min(20),
  valid_until: z.iso.datetime().nullable(),
  artifacts: z.array(artifact).min(1),
});
export const capabilityReport = z.strictObject({
  format: z.literal(2),
  passed: z.boolean(),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime(),
  tested: z.object(
    Object.fromEntries(
      capabilityIdentityFields.map((key) => [key, capabilitySha]),
    ) as Record<
      (typeof capabilityIdentityFields)[number],
      typeof capabilitySha
    >,
  ),
  cases: z.array(capabilityCase).min(1),
});
export type CapabilityOperation = z.infer<typeof capabilityOperation>;
export type CapabilityCase = z.infer<typeof capabilityCase>;
export function validateCapabilityReport(
  raw: unknown,
  tested: Record<(typeof capabilityIdentityFields)[number], string | null>,
  now = Date.now(),
) {
  const report = capabilityReport.parse(raw);
  invariant(
    report.passed &&
      Date.parse(report.started_at) <= Date.parse(report.finished_at) &&
      Date.parse(report.finished_at) <= now + 60000,
    "CAPABILITY_REPORT_INVALID",
    "Capability reports must finish successfully within a real observation interval",
  );
  invariant(
    new Set(report.cases.map((item) => item.id)).size === report.cases.length,
    "CAPABILITY_DUPLICATE",
    "Evidence case ids must be unique within a report",
  );
  for (const field of capabilityIdentityFields)
    invariant(
      report.tested[field] === tested[field],
      "CAPABILITY_EVIDENCE_STALE",
      `Evidence is not bound to the final source, compiled code and locks: ${field}`,
    );
  return report;
}
const clientTools = new Set([
  "invalid",
  "shell",
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "task",
  "webfetch",
  "websearch",
  "apply_patch",
  "question",
]);

/** Product boundaries are a closed list, not a way to waive any failing tool. */
export function validateCapabilityPolicy(
  tool: string,
  delivery: string,
  operation: CapabilityOperation,
) {
  const excluded =
    tool === "skill" && ["install", "uninstall"].includes(operation.id);
  const client = clientTools.has(tool);
  const disposition = excluded
    ? "explicitly_excluded"
    : client
      ? "client_required"
      : "required";
  invariant(
    operation.disposition === disposition &&
      operation.policy ===
        (excluded
          ? "builtin-mcp-skills-only"
          : client
            ? "host-general-tools"
            : null) &&
      (delivery === "client_required") === client,
    "CAPABILITY_POLICY_INVALID",
    `Unapproved capability boundary: ${tool}.${operation.id}`,
  );
  invariant(
    disposition === "required"
      ? operation.implementation !== "not_applicable" &&
          operation.required_scopes.length > 0 &&
          operation.acceptance !== "boundary_verified"
      : operation.implementation === "not_applicable" &&
          !operation.required_scopes.length &&
          operation.acceptance !== "verified",
    "CAPABILITY_STATUS_INVALID",
    "Functional verification and declared product boundaries are separate states",
  );
  if (tool === "lsp")
    invariant(
      operation.required_scopes.some(
        (scope) => scope.language === "arkts" && scope.sdk !== null,
      ),
      "CAPABILITY_SCOPE_INVALID",
      "Every required LSP operation needs a concrete ArkTS SDK success scope",
    );
}
export function capabilityAccepted(operation: CapabilityOperation) {
  return (
    operation.evidence.length > 0 &&
    (operation.disposition === "required"
      ? operation.implementation === "implemented" &&
        operation.acceptance === "verified"
      : operation.acceptance === "boundary_verified")
  );
}

/** Check the operation across all referenced observations. A supported ArkTS
 * observation and a real C++ MethodNotFound may coexist without conflation. */
export function validateCapabilityOutcomes(
  id: string,
  operation: CapabilityOperation,
  cases: CapabilityCase[],
  now = Date.now(),
) {
  for (const item of cases) {
    invariant(
      item.operation === id,
      "CAPABILITY_CASE_MISSING",
      `Evidence does not cover ${id}`,
    );
    invariant(
      item.valid_until === null || Date.parse(item.valid_until) >= now,
      "CAPABILITY_EVIDENCE_EXPIRED",
      `Expired capability observation: ${item.id}`,
    );
    if (item.outcome === "unsupported")
      invariant(
        item.service_support === "unavailable" &&
          item.support_evidence?.request_dispatched === true &&
          ["public_mcp", "sdk_response"].includes(item.source),
        "CAPABILITY_UNSUPPORTED_UNPROVEN",
        "A local refusal or missing environment cannot prove SDK/service unavailability",
      );
    if (item.outcome === "executed")
      invariant(
        item.service_support === "available" && item.policy === null,
        "CAPABILITY_OUTCOME_INVALID",
        "Executed capability must identify actual service availability",
      );
  }
  if (operation.disposition === "required") {
    for (const required of operation.required_scopes)
      invariant(
        cases.some(
          (item) =>
            item.passed &&
            item.outcome === "executed" &&
            item.source === "public_mcp" &&
            item.environment.language === required.language &&
            (required.platform === "any" ||
              item.environment.platform === required.platform) &&
            (required.sdk === null || item.environment.sdk === required.sdk),
        ),
        "CAPABILITY_EXECUTION_MISSING",
        `No successful public MCP execution for ${id} in ${JSON.stringify(required)}`,
      );
  } else
    invariant(
      cases.some(
        (item) =>
          item.passed &&
          item.outcome === operation.disposition &&
          item.service_support === "not_applicable" &&
          item.policy === operation.policy &&
          item.source ===
            (operation.disposition === "client_required"
              ? "client_contract"
              : "product_decision"),
      ),
      "CAPABILITY_BOUNDARY_UNVERIFIED",
      `Missing delivery contract or owner decision for ${id}`,
    );
}
