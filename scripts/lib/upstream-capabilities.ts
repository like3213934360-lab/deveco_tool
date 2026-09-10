import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { inside, fileDigest } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import { evidenceIdentity } from "./evidence.js";

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
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const relative = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !path.isAbsolute(value) &&
      !value.includes("\\") &&
      value.split("/").every((part) => part && part !== "." && part !== ".."),
  );
const operation = z.strictObject({
  id: z.string().min(1),
  parameters: z.array(z.string()),
  replacement: z.string().min(10),
  status: z.enum(["pending", "verified"]),
  targets: z.array(relative).min(1),
  tests: z.array(relative).min(1),
  evidence: z.array(
    z.strictObject({ file: relative, sha256: sha, case: z.string().min(1) }),
  ),
  boundary: z.string().min(10),
});
export const capabilityMatrixSchema = z.strictObject({
  format: z.literal(1),
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
  const tested = requireEvidence ? evidenceIdentity(root) : undefined;
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
      if (operation.status !== "verified" || !operation.evidence.length)
        pending.push(id);
      if (!requireEvidence) continue;
      for (const ref of operation.evidence) {
        const file = inside(root, ref.file);
        invariant(
          fileDigest(file) === ref.sha256,
          "CAPABILITY_EVIDENCE_CHANGED",
          `Changed evidence for ${id}`,
        );
        const report = z
          .object({
            format: z.literal(1),
            passed: z.literal(true),
            tested: z.record(z.string(), z.unknown()),
            cases: z.array(
              z.object({
                id: z.string(),
                passed: z.literal(true),
                outcome: z.enum(["executed", "unsupported"]),
                scope: z.string().min(10),
                artifacts: z
                  .array(z.object({ file: relative, sha256: sha }))
                  .min(1),
              }),
            ),
          })
          .parse(JSON.parse(fs.readFileSync(file, "utf8")));
        for (const field of [
          "runtime_sha256",
          "compiled_sha256",
          "package_lock_sha256",
          "resource_manifest_sha256",
          "upstream_lock_sha256",
        ] as const)
          invariant(
            report.tested[field] === tested![field],
            "CAPABILITY_EVIDENCE_STALE",
            `Evidence for ${id} is not bound to the final code`,
          );
        const item = report.cases.find((item) => item.id === ref.case);
        invariant(
          item && item.id === id,
          "CAPABILITY_CASE_MISSING",
          `Evidence does not cover ${id}`,
        );
        for (const artifact of item.artifacts)
          invariant(
            fileDigest(inside(root, artifact.file)) === artifact.sha256,
            "CAPABILITY_ARTIFACT_CHANGED",
            `Changed behavior evidence for ${id}`,
          );
      }
    }
  }
  invariant(
    upstreamTools.every((tool) => seen.has(tool)),
    "CAPABILITY_TOOL_MISSING",
    "Every registered upstream built-in must be represented",
  );
  const lsp = matrix.tools.find((row) => row.tool === "lsp")!;
  invariant(
    [
      "goToDefinition",
      "findReferences",
      "hover",
      "documentSymbol",
      "workspaceSymbol",
      "goToImplementation",
      "prepareCallHierarchy",
      "incomingCalls",
      "outgoingCalls",
    ].every((id) => lsp.operations.some((op) => op.id === id)),
    "CAPABILITY_OPERATION_MISSING",
    "Every upstream LSP operation must be represented",
  );
  invariant(
    !requireEvidence || !pending.length,
    "CAPABILITY_ACCEPTANCE_PENDING",
    `Unaccepted upstream operations: ${pending.join(", ")}`,
  );
  return {
    ready: !pending.length,
    tools: seen.size,
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
