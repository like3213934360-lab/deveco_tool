import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { inside, fileDigest } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import { evidenceIdentity } from "./evidence.js";
import { lockSchema } from "./upstream.js";
import { readJson } from "./upstream-adaptation.js";
import {
  capabilitySha as sha,
  capabilityPath as relative,
  capabilityOperation as operation,
  capabilityReport,
  capabilityAccepted,
  validateCapabilityReport,
  validateCapabilityPolicy,
  validateCapabilityOutcomes,
  type CapabilityCase,
} from "./capability-evidence.js";

export const upstreamTools = [
  "invalid",
  "shell",
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "task",
  "webfetch",
  "todowrite",
  "websearch",
  "skill",
  "apply_patch",
  "question",
  "lsp",
  "plan_exit",
  "plan_write",
  "plan_enter",
  "spec_write",
  "hdc_log",
  "switch_cwd",
  "arkts_check",
  "build_project",
  "start_app",
  "verify_ui",
  "get_ui_verification_log",
  "save_ui_screenshot",
  "debug_exit",
] as const;
// This is the reviewed public registry, independent of editable matrix rows.
// An upstream lock update requires reviewing the registry and operation union.
const reviewedSource = {
  commit: "aeb4536e56d1bfe8b5a0ff3bb02acb99f3523f2a",
  registry_file: "packages/opencode/src/tool/registry.ts",
  registry_sha256:
    "b171bf1fa1501d1a1b34a3f74751c0e16c470311326c55d32ed9e6ff7efda110",
};
const expandedOperations: Partial<
  Record<(typeof upstreamTools)[number], readonly string[]>
> = {
  skill: ["list", "search", "read", "install", "uninstall"],
  lsp: [
    "goToDefinition",
    "findReferences",
    "hover",
    "documentSymbol",
    "workspaceSymbol",
    "goToImplementation",
    "prepareCallHierarchy",
    "incomingCalls",
    "outgoingCalls",
  ],
  spec_write: ["spec", "design", "tasks"],
  hdc_log: ["collect", "clear", "list_devices"],
  verify_ui: [
    "testPlan",
    "freshStart",
    "step_execution",
    "visual_review",
    "resume",
    "cancel",
  ],
  get_ui_verification_log: ["read", "search"],
  save_ui_screenshot: ["export_steps"],
};
export const capabilityMatrixSchema = z.strictObject({
  format: z.literal(2),
  source: z.strictObject({
    url: z.literal("https://gitcode.com/openharmony-sig/deveco-code"),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    registry_file: relative,
    registry_sha256: sha,
  }),
  scope: z.string().min(20),
  tools: z
    .array(
      z.strictObject({
        tool: z.enum(upstreamTools),
        upstream_file: relative,
        upstream_sha256: sha,
        delivery: z.enum(["native", "mcp_guided", "client_required"]),
        operations: z.array(operation).min(1),
      }),
    )
    .length(upstreamTools.length),
});
export function auditCapabilities(
  root: string,
  raw: unknown,
  requireEvidence = false,
) {
  const matrix = capabilityMatrixSchema.parse(raw),
    seen = new Set<string>(),
    pending: string[] = [];
  const lock = lockSchema.parse(
    readJson(path.join(root, "provenance/upstream-lock.json")),
  );
  invariant(
    lock.sources.find((source) => source.id === "deveco-code")?.commit ===
      matrix.source.commit &&
      Object.entries(reviewedSource).every(
        ([key, value]) =>
          matrix.source[key as keyof typeof reviewedSource] === value,
      ),
    "CAPABILITY_REGISTRY_UNREVIEWED",
    "Source lock and capability matrix must refer to the explicitly reviewed upstream registry",
  );
  for (const row of matrix.tools) {
    invariant(
      !seen.has(row.tool),
      "CAPABILITY_DUPLICATE",
      `Duplicate tool ${row.tool}`,
    );
    seen.add(row.tool);
    const operations = new Set<string>();
    for (const operation of row.operations) {
      const id = `${row.tool}.${operation.id}`;
      invariant(
        !operations.has(operation.id),
        "CAPABILITY_DUPLICATE",
        `Duplicate operation ${id}`,
      );
      operations.add(operation.id);
      for (const file of [...operation.targets, ...operation.tests])
        invariant(
          fs.existsSync(inside(root, file)),
          "CAPABILITY_TARGET_MISSING",
          `Missing ${file} for ${id}`,
        );
      validateCapabilityPolicy(row.tool, row.delivery, operation);
      if (!capabilityAccepted(operation)) pending.push(id);
    }
  }
  invariant(
    upstreamTools.every((tool) => seen.has(tool)),
    "CAPABILITY_TOOL_MISSING",
    "Every registered upstream built-in must be represented",
  );
  for (const row of matrix.tools) {
    const expected = expandedOperations[row.tool] ?? ["execute"];
    invariant(
      expected.length === row.operations.length &&
        expected.every((id) =>
          row.operations.some((operation) => operation.id === id),
        ),
      "CAPABILITY_OPERATION_MISSING",
      `Every reviewed upstream operation must be represented: ${row.tool}`,
    );
  }
  invariant(
    !requireEvidence || !pending.length,
    "CAPABILITY_ACCEPTANCE_PENDING",
    `Unaccepted upstream operations: ${pending.join(", ")}`,
  );
  if (requireEvidence) {
    const tested = evidenceIdentity(root),
      now = Date.now();
    const reports = new Map<
      string,
      ReturnType<typeof capabilityReport.parse>
    >();
    for (const row of matrix.tools)
      for (const operation of row.operations) {
        const id = `${row.tool}.${operation.id}`,
          cases: CapabilityCase[] = [];
        for (const ref of operation.evidence) {
          const file = inside(root, ref.file);
          invariant(
            fileDigest(file) === ref.sha256,
            "CAPABILITY_EVIDENCE_CHANGED",
            `Changed evidence for ${id}`,
          );
          let report = reports.get(file);
          if (!report) {
            report = validateCapabilityReport(readJson(file), tested, now);
            reports.set(file, report);
          }
          const item = report.cases.find((item) => item.id === ref.case);
          invariant(
            item && item.operation === id,
            "CAPABILITY_CASE_MISSING",
            `Evidence does not cover ${id}`,
          );
          for (const artifact of item.artifacts)
            invariant(
              fileDigest(inside(root, artifact.file)) === artifact.sha256,
              "CAPABILITY_ARTIFACT_CHANGED",
              `Changed behavior evidence for ${id}`,
            );
          cases.push(item);
        }
        validateCapabilityOutcomes(id, operation, cases, now);
      }
  }
  return {
    ready: !pending.length,
    tools: seen.size,
    verified_operations: matrix.tools
      .flatMap((row) => row.operations)
      .filter((operation) => operation.acceptance === "verified").length,
    verified_boundaries: matrix.tools
      .flatMap((row) => row.operations)
      .filter((operation) => operation.acceptance === "boundary_verified")
      .length,
    operations: matrix.tools.reduce(
      (sum, row) => sum + row.operations.length,
      0,
    ),
    pending,
    source: matrix.source,
  };
}
export function upstreamCapabilityGate(root: string) {
  return auditCapabilities(
    root,
    JSON.parse(
      fs.readFileSync(
        path.join(root, "provenance/upstream-capabilities.json"),
        "utf8",
      ),
    ),
    true,
  );
}
