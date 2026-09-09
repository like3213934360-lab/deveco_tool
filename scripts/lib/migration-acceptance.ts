import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { atomicWrite, digest, fileDigest, inside } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import { evidenceIdentity } from "./evidence.js";
import { readJson } from "./upstream-adaptation.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema = z.object({ runtime_sha256: sha, compiled_sha256: sha, package_lock_sha256: sha, resource_manifest_sha256: sha, upstream_lock_sha256: sha });
const checkSchema = z.strictObject({ check: z.string().regex(/^(?:test|scripts)\/.+\.ts$/), original_sha256: sha });
const receiptSchema = z.strictObject({ format: z.literal(1), passed: z.literal(true), source: z.string(), row_sha256: sha, tested: identitySchema, reviewer: z.string().min(1), reason: z.string().min(20), completed_scenarios: z.array(z.string()), checks: z.array(checkSchema).min(1) });
const rowSchema = z.object({ source: z.string(), checks: z.array(z.string()).min(1), remaining: z.array(z.string()), acceptance: z.enum(["pending", "verified"]), evidence: z.array(z.string()) }).passthrough();
const matrixSchema = z.object({ tools: z.array(rowSchema), scripts: z.array(rowSchema) }).passthrough();
const rowIdentity = (row: z.infer<typeof rowSchema>) => {
  const { acceptance: _acceptance, evidence: _evidence, remaining: _remaining, ...implementation } = row;
  return digest(implementation);
};

/** Each source row requires a deliberately reviewed completion declaration and
 * passing current reports that actually ran all mapped checks. Raw reports never
 * enter provenance; only scope and byte identities are published. */
export function acceptMigration(root: string, raw: unknown) {
  const plan = z.strictObject({ format: z.literal(1), source: z.string(), reviewer: z.string().min(1), reason: z.string().min(20), completed_scenarios: z.array(z.string()), checks: z.array(z.strictObject({ check: checkSchema.shape.check, report: z.string(), sha256: sha })).min(1) }).parse(raw);
  const file = path.join(root, "provenance/migration-matrix.json"), before = fileDigest(file), matrix = matrixSchema.parse(readJson(file)), tested = identitySchema.parse(evidenceIdentity(root));
  const rows = (["tools", "scripts"] as const).flatMap((kind) => matrix[kind].map((row) => ({ source: `${kind}:${row.source}`, row })));
  const selected = rows.filter(({ source }) => source === plan.source);
  invariant(selected.length === 1, "MIGRATION_SOURCE_UNKNOWN", "Select exactly one migration source row");
  const row = selected[0]!.row;
  const prior = row.acceptance === "verified" ? row.evidence.map((file) => receiptSchema.parse(readJson(inside(root, file)))).find((receipt) => receipt.source === plan.source && receipt.row_sha256 === rowIdentity(row)) : undefined;
  const scenarios = prior?.completed_scenarios ?? row.remaining;
  invariant(digest([...plan.completed_scenarios].sort()) === digest([...scenarios].sort()), "MIGRATION_SCENARIOS_INCOMPLETE", "Review every remaining scenario before acceptance");
  invariant(new Set(plan.checks.map((item) => item.check)).size === plan.checks.length && row.checks.every((check) => plan.checks.some((item) => item.check === check)), "MIGRATION_CHECK_MISSING", "Each mapped check requires one passing current report");
  const checks = plan.checks.map((item) => {
    invariant(fileDigest(item.report) === item.sha256, "MIGRATION_REPORT_CHANGED", "Original validation bytes changed");
    const report = z.object({ passed: z.boolean().optional(), status: z.string().optional(), tested: z.record(z.string(), z.unknown()).optional(), identity: z.record(z.string(), z.unknown()).optional(), executed_tests: z.array(z.string()).optional() }).parse(readJson(item.report));
    invariant(fileDigest(item.report) === item.sha256 && (report.passed === true || report.status === "passed"), "MIGRATION_CHECK_FAILED", "Mapped check did not pass");
    const actual = report.tested ?? report.identity, compiled = `dist/${item.check.replace(/\.ts$/, ".js")}`;
    invariant(actual && digest(identitySchema.parse(actual)) === digest(tested), "MIGRATION_EVIDENCE_STALE", "Migration acceptance must use current compiled and resource bytes");
    invariant(actual.entrypoint === compiled || report.executed_tests?.includes(compiled), "MIGRATION_CHECK_SCOPE", "Report did not execute the mapped check");
    return { check: item.check, original_sha256: item.sha256 };
  });
  const receipt = receiptSchema.parse({ format: 1, passed: true, source: plan.source, row_sha256: rowIdentity(row), tested, reviewer: plan.reviewer, reason: plan.reason, completed_scenarios: plan.completed_scenarios, checks });
  const relative = `provenance/migration-acceptance/${digest(receipt)}.json`, destination = inside(root, relative);
  if (fs.existsSync(destination)) invariant(digest(readJson(destination)) === digest(receipt), "MIGRATION_RECEIPT_CHANGED", "Existing receipt changed");
  else atomicWrite(destination, JSON.stringify(receipt, null, 2) + "\n", false);
  invariant(fileDigest(file) === before, "MIGRATION_MATRIX_CHANGED", "Migration matrix changed during acceptance");
  const deduplicated = row.acceptance === "verified" && digest(row.evidence) === digest([relative]);
  row.acceptance = "verified"; row.remaining = []; row.evidence = [relative];
  atomicWrite(file, JSON.stringify(matrix, null, 2) + "\n");
  return { accepted: true, source: plan.source, receipt: relative, deduplicated, release_ready: false };
}

export function verifyMigrationEvidence(root: string) {
  const matrix = matrixSchema.parse(readJson(path.join(root, "provenance/migration-matrix.json"))), tested = identitySchema.parse(evidenceIdentity(root));
  for (const kind of ["tools", "scripts"] as const) for (const row of matrix[kind]) {
    invariant(row.acceptance === "verified" && !row.remaining.length && row.evidence.length > 0, "MIGRATION_ACCEPTANCE_UNPROVEN", "Migration row still needs behavior acceptance");
    const checks = new Set<string>();
    for (const file of row.evidence) {
      const receipt = receiptSchema.parse(readJson(inside(root, file)));
      invariant(receipt.source === `${kind}:${row.source}` && receipt.row_sha256 === rowIdentity(row) && digest(receipt.tested) === digest(tested), "MIGRATION_EVIDENCE_STALE", "Historical or unrelated evidence cannot accept this migration row");
      for (const item of receipt.checks) checks.add(item.check);
    }
    invariant(row.checks.every((check) => checks.has(check)), "MIGRATION_CHECK_MISSING", "Migration receipt omits a mapped check");
  }
  return { verified_rows: matrix.tools.length + matrix.scripts.length };
}
