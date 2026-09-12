import { z } from "zod";
import { release, protocolVersion } from "../../src/core/config.js";
import { digest } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";
import {
  requiredAcceptance,
  requiredPerformance,
  currentAcceptance,
  mandatoryCurrentAcceptance,
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

const commonScope = z.strictObject({
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
});

const historicalScope = commonScope.extend({
  format: z.literal(1),
  // A historical waiver is tied to the release that the owner authorized.
  // Merely editing its release field must not waive a new release's checks.
  release: z.literal("0.3.0"),
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

const currentScope = commonScope.extend({
  format: z.literal(2),
  breaking_api: z.strictObject({
    change: z.enum(["compatible", "breaking"]),
    reason,
  }),
  device_retest: z.strictObject({
    status: z.literal("isolated_retest"),
    historical_evidence_accepted: z.literal(false),
    reason,
  }),
  verified_migration_receipts: z.strictObject({
    identity: z.literal("current"),
    reason,
  }),
  upstream_historical_checks: z.array(z.string()).length(0),
  acceptance_exceptions: z.array(
    exception.extend({ id: z.enum(currentAcceptance) }),
  ),
  acceptance_required: z.array(z.enum(currentAcceptance)).min(1),
  performance_required: z.array(z.enum(requiredPerformance)),
  performance_exceptions: z
    .array(exception.extend({ id: z.enum(requiredPerformance) }))
    .length(0),
  soak: z.strictObject({ disposition: z.literal("required_current"), reason }),
});

export const releaseScopeSchema = z.discriminatedUnion("format", [
  historicalScope,
  currentScope,
]);

/** A current scope may describe individual external gaps, but never makes all
 * otherwise verified migration rows current merely by supplying a scope file. */
export function migrationEvidencePolicy(scope?: z.infer<typeof releaseScopeSchema>) {
  return {
    requireCurrentIdentity: scope?.verified_migration_receipts.identity !== "historical",
    allowPending: Boolean(scope?.migration_exceptions.length),
  };
}

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
  invariant(
    String(scope.release) === release,
    "RELEASE_SCOPE_STALE",
    "Release scope belongs to another release",
  );
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
    scope.format === 1 ? requiredAcceptance : currentAcceptance,
    "RELEASE_SCOPE_ACCEPTANCE",
    "Every acceptance case must be required or explicitly dispositioned exactly once",
  );
  exactIds(
    scope.format === 1
      ? scope.performance_exceptions.map((item) => item.id)
      : scope.performance_required,
    requiredPerformance,
    "RELEASE_SCOPE_PERFORMANCE",
    "Every performance capability must have an exact historical disposition or current required measurement",
  );
  if (scope.format === 2)
    invariant(
      mandatoryCurrentAcceptance.every((id) =>
        scope.acceptance_required.includes(id),
      ),
      "RELEASE_SCOPE_NEW_CAPABILITY_WAIVER",
      "New and changed native contracts require current acceptance and cannot be waived by a release scope",
    );
  invariant(
    new Set(scope.upstream_historical_checks).size ===
      scope.upstream_historical_checks.length,
    "RELEASE_SCOPE_UPSTREAM",
    "Historical upstream checks must be unique",
  );
  return scope;
}
