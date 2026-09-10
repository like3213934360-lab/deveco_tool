import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { release } from "../src/core/config.js";
import { auditMigration } from "../scripts/lib/migration.js";
import { validateReleaseScope } from "../scripts/lib/release-scope.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scopeFile = path.join(root, `provenance/release-scope-${release}.json`);
const readScope = () => JSON.parse(fs.readFileSync(scopeFile, "utf8")) as Record<string, unknown>;

test("limited release scope exactly records current gaps and cannot silently waive another case", () => {
  const migration = auditMigration(root);
  const scope = validateReleaseScope(readScope(), migration.incomplete);
  assert.equal(scope.migration_exceptions.length, 28);
  assert.equal(scope.acceptance_exceptions.length, 43);
  assert.equal(scope.performance_exceptions.length, 19);

  const missing = readScope();
  (missing.acceptance_exceptions as unknown[]).pop();
  assert.throws(() => validateReleaseScope(missing, migration.incomplete), { code: "RELEASE_SCOPE_ACCEPTANCE" });

  const rewritten = readScope();
  const first = (rewritten.migration_exceptions as { limitations: string[] }[])[0]!;
  first.limitations = ["broader unreviewed waiver"];
  assert.throws(() => validateReleaseScope(rewritten, migration.incomplete), { code: "RELEASE_SCOPE_LIMITATIONS" });
});
