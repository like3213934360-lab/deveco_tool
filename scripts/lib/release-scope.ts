import { z } from "zod";
import { release, protocolVersion } from "../../src/core/config.js";
import { digest } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import {
  requiredAcceptance,
  requiredPerformance,
} from "./acceptance-requirements.js";

const reason = z.string().min(20);
const disposition = z.enum([
  "historical_evidence",
  "user_cancelled_device_retest",
  "environment_limited",
]);
const exception = z.strictObject({
  id: z.string().min(1),
  disposition,
  reason,
});

export const releaseScopeSchema = z.strictObject({
  format: z.literal(1),
  release: z.literal(release),
  protocol: z.literal(protocolVersion),
  decided_at: z.string().datetime({ offset: true }),
  authorized_by: z.literal("repository_owner"),
  breaking_api: z.strictObject({
    accepted: z.literal(true),
    reason,
  }),
  device_retest: z.strictObject({
    status: z.enum(["cancelled_by_user", "isolated_retest"]),
    historical_evidence_accepted: z.literal(true),
    reason,
  }),
  verified_migration_receipts: z.strictObject({
    identity: z.literal("historical"),
    reason,
  }),
  upstream_historical_checks: z.array(z.string().regex(/^scripts\/.+\.ts$/)),
  migration_exceptions: z.array(
    z.strictObject({
      source: z.string().regex(/^(?:tool|script):/),
      disposition: z.enum([
        "user_cancelled_device_retest",
        "environment_limited",
      ]),
      limitations: z.array(z.string().min(1)).min(1),
      reason,
    }),
  ),
  acceptance_exceptions: z.array(
    exception.extend({ id: z.enum(requiredAcceptance) }),
  ),
  acceptance_required: z.array(z.enum(requiredAcceptance)).default([]),
  performance_exceptions: z.array(
    exception.extend({ id: z.enum(requiredPerformance) }),
  ),
  soak: z.strictObject({
    disposition: z.literal("historical_evidence"),
    reason,
  }),
});

type MigrationGap = { source: string; remaining: string[] };

function exactIds(
  actual: string[],
  expected: readonly string[],
  code: string,
  message: string,
) {
  invariant(
    new Set(actual).size === actual.length &&
      digest([...actual].sort()) === digest([...expected].sort()),
    code,
    message,
  );
}

/** A scoped release never converts an untested row into a passing row. It must
 * enumerate the current matrix gaps and every waived release case exactly. */
export function validateReleaseScope(raw: unknown, incomplete: MigrationGap[]) {
  const scope = releaseScopeSchema.parse(raw);
  exactIds(
    scope.migration_exceptions.map((item) => item.source),
    incomplete.map((item) => item.source),
    "RELEASE_SCOPE_MIGRATION",
    "Release scope must enumerate every and only current migration gap",
  );
  for (const item of scope.migration_exceptions) {
    const gap = incomplete.find(
      (candidate) => candidate.source === item.source,
    )!;
    invariant(
      digest([...item.limitations].sort()) ===
        digest([...gap.remaining].sort()),
      "RELEASE_SCOPE_LIMITATIONS",
      `Release scope changed the recorded limitations for ${item.source}`,
    );
  }
  exactIds(
    [
      ...scope.acceptance_exceptions.map((item) => item.id),
      ...scope.acceptance_required,
    ],
    requiredAcceptance,
    "RELEASE_SCOPE_ACCEPTANCE",
    "Every acceptance case must be required or explicitly dispositioned exactly once",
  );
  exactIds(
    scope.performance_exceptions.map((item) => item.id),
    requiredPerformance,
    "RELEASE_SCOPE_PERFORMANCE",
    "Release scope must explicitly disposition every performance capability",
  );
  invariant(
    new Set(scope.upstream_historical_checks).size ===
      scope.upstream_historical_checks.length,
    "RELEASE_SCOPE_UPSTREAM",
    "Historical upstream checks must be unique",
  );
  return scope;
}
