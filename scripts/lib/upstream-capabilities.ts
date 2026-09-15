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

import { discoveryHash, reviewDiscovery, type UpstreamDiscovery } from "./upstream-discovery.js";

export function readDiscoveredCapabilities(root: string) {
  const discovery = readJson(path.join(root, "provenance/upstream-discovery.json")) as UpstreamDiscovery;
  const { sha256, ...body } = discovery;
  invariant(discovery.format === 1 && discoveryHash(JSON.stringify(body)) === sha256, "CAPABILITY_DISCOVERY_CHANGED", "The fixed-source discovery inventory digest changed");
  const review = readJson(path.join(root, "provenance/upstream-discovery-review.json")) as Parameters<typeof reviewDiscovery>[1];
  const result = reviewDiscovery(discovery, review);
  invariant(result.ready, "CAPABILITY_REGISTRY_UNREVIEWED", `Unreviewed source assets or schemas: ${result.pending.join(", ")}`);
  return discovery;
}
export const capabilityMatrixSchema = z.strictObject({
  format: z.literal(2),
  source: z.strictObject({
    url: z.literal("https://gitcode.com/openharmony-sig/deveco-code"),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    registry_file: relative,
    registry_sha256: sha,
    discovery_sha256: sha,
  }),
  scope: z.string().min(20),
  tools: z
    .array(
      z.strictObject({
        tool: z.string().min(1),
        upstream_file: relative,
        upstream_sha256: sha,
        delivery: z.enum(["native", "mcp_guided", "client_required"]),
        operations: z.array(operation.extend({ source_operations: z.array(z.string().min(1)).min(1) })).min(1),
      }),
    )
    .min(1),
});
export function auditCapabilities(
  root: string,
  raw: unknown,
  requireEvidence = false,
) {
  const matrix = capabilityMatrixSchema.parse(raw),
    seen = new Set<string>(),
    pending: string[] = [];
  const discovery = readDiscoveredCapabilities(root);
const behaviorReview = readJson(path.join(root, "provenance/upstream-discovery-review.json")) as { tool_behaviors?: { tool: string; source_schema_sha256: string; behaviors: string[] }[] };

  const lock = lockSchema.parse(
    readJson(path.join(root, "provenance/upstream-lock.json")),
  );
  invariant(
    lock.sources.find((source) => source.id === "deveco-code")?.commit ===
      matrix.source.commit &&
      discovery.source.commit === matrix.source.commit &&
      discovery.registry.file === matrix.source.registry_file &&
      discovery.registry.sha256 === matrix.source.registry_sha256 &&
      discovery.sha256 === matrix.source.discovery_sha256,
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
      const delegated = ["bash", "plan_enter", "plan_exit", "plan_write", "debug_exit", "todowrite", "spec_write"].includes(row.tool);
      validateCapabilityPolicy(delegated ? "shell" : row.tool, row.delivery, operation);
      if (!capabilityAccepted(operation)) pending.push(id);
    }
  }
  invariant(
    discovery.tools.length === seen.size && discovery.tools.every((tool) => seen.has(tool.id)),
    "CAPABILITY_TOOL_MISSING", "Every discovered registry tool must be represented, without invented source tools",
  );
  for (const row of matrix.tools) {
    const source = discovery.tools.find((tool) => tool.id === row.tool)!;
    const expectedBehavior = behaviorReview.tool_behaviors?.find((item) => item.tool === row.tool);
    invariant(expectedBehavior?.source_schema_sha256 === source.schema_sha256 && expectedBehavior.behaviors.length === row.operations.length && expectedBehavior.behaviors.every((id) => row.operations.some((operation) => operation.id === id)), "CAPABILITY_OPERATION_MISSING", `Every reviewed behavior is required independently of schema operation coverage: ${row.tool}`);
    invariant(row.upstream_file === source.file && row.upstream_sha256 === source.sha256, "CAPABILITY_SOURCE_CHANGED", `Changed source definition for ${row.tool}`);
    const represented = new Set(row.operations.flatMap((operation) => operation.source_operations));
    invariant(source.operations.every((id) => represented.has(id)) && [...represented].every((id) => source.operations.includes(id)), "CAPABILITY_OPERATION_MISSING", `Every discovered schema operation must map to reviewed behavior: ${row.tool}`);
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
    classification: {
      required_native: matrix.tools.flatMap((row) => row.operations).filter((op) => op.disposition === "required").length,
      host_delegated: matrix.tools.flatMap((row) => row.operations).filter((op) => op.disposition === "client_required").length,
      intentional_boundary: matrix.tools.flatMap((row) => row.operations).filter((op) => op.disposition === "explicitly_excluded").length,
    },
    implementation: {
      implemented: matrix.tools.flatMap((row) => row.operations).filter((op) => op.implementation === "implemented").length,
      pending: matrix.tools.flatMap((row) => row.operations).filter((op) => op.implementation === "pending").length,
      not_applicable: matrix.tools.flatMap((row) => row.operations).filter((op) => op.implementation === "not_applicable").length,
    },
    environment: "Per-case service_support and language/platform/SDK remain evidence fields; unsupported never satisfies required-native acceptance",
    schema_operations: discovery.tools.reduce((sum, tool) => sum + tool.operations.length, 0),
    discovery_sha256: discovery.sha256,
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
