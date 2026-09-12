import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { release } from "../src/core/config.js";
import { auditMigration } from "../scripts/lib/migration.js";
import { migrationEvidencePolicy, releaseScopeSchema, validateReleaseScope } from "../scripts/lib/release-scope.js";
import {
  currentAcceptance,
  requiredPerformance,
  mandatoryCurrentAcceptance,
} from "../scripts/lib/acceptance-requirements.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scopeFile = path.join(root, `provenance/release-scope-${release}.json`);
const readScope = () =>
  JSON.parse(fs.readFileSync(scopeFile, "utf8")) as Record<string, unknown>;

test("current release scope does not waive pending migration rows or omit acceptance", () => {
  const migration = auditMigration(root);
  // The checked-in policy is a release requirement, not a receipt that unfinished
  // matrix work has passed. It must fail until those actual gaps are closed.
  if (migration.incomplete.length)
    assert.throws(() => validateReleaseScope(readScope(), migration.incomplete), { code: "RELEASE_SCOPE_MIGRATION" });
  const scope = validateReleaseScope(readScope(), []);
  assert.equal(scope.format, 2);
  assert.equal(scope.migration_exceptions.length, 0);
  assert.equal(scope.acceptance_exceptions.length, 0);
  assert.equal(scope.acceptance_required.length, currentAcceptance.length);
  assert.deepEqual(migrationEvidencePolicy(scope), { requireCurrentIdentity: true, allowPending: false });
  assert.deepEqual(migrationEvidencePolicy(), { requireCurrentIdentity: true, allowPending: false });

  const missing = readScope();
  (missing.acceptance_required as unknown[]).pop();
  assert.throws(() => validateReleaseScope(missing, []), {
    code: "RELEASE_SCOPE_ACCEPTANCE",
  });

  const duplicate = readScope();
  (duplicate.acceptance_required as string[]).push(
    scope.acceptance_required[0]!,
  );
  assert.throws(() => validateReleaseScope(duplicate, []), {
    code: "RELEASE_SCOPE_ACCEPTANCE",
  });

  const rewritten = readScope();
  rewritten.migration_exceptions = [{ source: "tool:fixture", disposition: "environment_limited", limitations: ["broader unreviewed waiver"], reason: "Synthetic policy validation fixture, not an owner authorization." }];
  assert.throws(() => validateReleaseScope(rewritten, [{ source: "tool:fixture", remaining: ["one specifically unavailable device"] }]), {
    code: "RELEASE_SCOPE_LIMITATIONS",
  });
});

test("current release scope requires fresh performance, soak and changed contracts; old scope cannot be relabelled", () => {
  const current = {
    ...readScope(),
    format: 2,
    release,
    acceptance_exceptions: [],
    acceptance_required: [...currentAcceptance],
    performance_exceptions: [],
    performance_required: [...requiredPerformance],
    soak: {
      disposition: "required_current",
      reason:
        "Current one-hour active workload and six-minute idle reclamation are mandatory.",
    },
  };
  assert.doesNotThrow(() =>
    validateReleaseScope(current, []),
  );
  for (const id of mandatoryCurrentAcceptance) {
    assert.throws(
      () =>
        validateReleaseScope(
          {
            ...current,
            acceptance_required: current.acceptance_required.filter(
              (item) => item !== id,
            ),
            acceptance_exceptions: [
              {
                id,
                disposition: "historical_evidence",
                reason:
                  "This test attempts to substitute old evidence for a changed contract.",
              },
            ],
          },
          [],
        ),
      { code: "RELEASE_SCOPE_NEW_CAPABILITY_WAIVER" },
    );
  }
  for (const performance_required of [
    [],
    current.performance_required.slice(1),
    [...current.performance_required.slice(1), current.performance_required[1]],
  ]) {
    assert.throws(
      () =>
        validateReleaseScope(
          { ...current, performance_required },
          [],
        ),
      { code: "RELEASE_SCOPE_PERFORMANCE" },
    );
  }
  assert.throws(() =>
    validateReleaseScope(
      {
        ...current,
        soak: { ...current.soak, disposition: "historical_evidence" },
      },
      [],
    ),
  );
  assert.throws(() =>
    validateReleaseScope(
      {
        ...current,
        performance_exceptions: [
          {
            id: "lsp",
            disposition: "historical_evidence",
            reason:
              "This test attempts to waive a current performance capability.",
          },
        ],
      },
      [],
    ),
  );
  assert.throws(() =>
    validateReleaseScope(
      { ...readScope(), format: 1, release: "0.999.0" },
      [],
    ),
  );
  for (const fields of [
    { verified_migration_receipts: { identity: "historical", reason: "Old receipts do not establish current behavior." } },
    { upstream_historical_checks: ["scripts/native-sdk-acceptance.ts"] },
    { device_retest: { status: "isolated_retest", historical_evidence_accepted: true, reason: "Historical device identity must not replace current runs." } },
  ]) assert.throws(() => releaseScopeSchema.parse({ ...current, ...fields }));
  const historical = releaseScopeSchema.parse(JSON.parse(fs.readFileSync(path.join(root, "provenance/release-scope-0.3.0.json"), "utf8")));
  assert.deepEqual(migrationEvidencePolicy(historical), { requireCurrentIdentity: false, allowPending: true });
  assert.throws(() => validateReleaseScope(historical, []), { code: "RELEASE_SCOPE_STALE" });
});
