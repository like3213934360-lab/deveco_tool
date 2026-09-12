import { z } from "zod";
import { invariant } from "../../src/core/errors.js";
import type { evidenceIdentity } from "./evidence.js";
import { requiredPerformance } from "./acceptance-requirements.js";
import { validatePerformance } from "./performance-gate.js";
import { validateSoak } from "./soak-gate.js";
import type { releaseScopeSchema } from "./release-scope.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const releaseIdentitySchema = z.object({
  source_sha256: sha,
  runtime_sha256: sha,
  compiled_sha256: sha,
  package_lock_sha256: sha,
  resource_manifest_sha256: sha,
  upstream_lock_sha256: sha,
});
export function sameReleaseIdentity(
  raw: unknown,
  expected: ReturnType<typeof evidenceIdentity>,
) {
  const actual = releaseIdentitySchema.parse(raw);
  invariant(
    Object.entries(actual).every(
      ([key, value]) => value === expected[key as keyof typeof expected],
    ),
    "RELEASE_EVIDENCE_STALE",
    "Evidence must cover the final source, compiled runtime, tests, lock and resources",
  );
}

/** Only the already-published 0.3.0 policy permits historical measurements.
 * Current bounded environment limitations never waive performance or soak. */
export function validateReleaseMeasurements(
  performanceRaw: unknown,
  soakRaw: unknown,
  tested: ReturnType<typeof evidenceIdentity>,
  scope?: z.infer<typeof releaseScopeSchema>,
) {
  const historical = scope?.format === 1 && scope.release === "0.3.0";
  const performance = historical
    ? z
        .object({
          format: z.literal(3),
          passed: z.literal(true),
          tested: z.record(z.string(), z.unknown()),
          direct: z
            .array(
              z.object({
                capability: z.enum(requiredPerformance),
                native_ms: z.array(z.number().finite().nonnegative()).min(1000),
              }),
            )
            .min(1),
          scope: z.string().min(1),
        })
        .parse(performanceRaw)
    : validatePerformance(performanceRaw);
  if (!historical) sameReleaseIdentity(performance.tested, tested);
  const soak = validateSoak(soakRaw, { requireMixed: !historical });
  if (!historical) sameReleaseIdentity(soak.tested, tested);
  return { performance, soak };
}
