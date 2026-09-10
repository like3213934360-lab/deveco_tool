import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "../src/core/config.js";
import { fileDigest } from "../src/core/files.js";
import { z } from "zod";

test("maintenance coverage classifies every original exception without promoting fixture evidence to release acceptance", () => {
  const read = (name: string): unknown =>
    JSON.parse(
      fs.readFileSync(path.join(packageRoot, "provenance", name), "utf8"),
    ) as unknown;
  const scope = z
    .object({
      migration_exceptions: z.array(z.object({ source: z.string() })),
      acceptance_exceptions: z.array(z.object({ id: z.string() })),
      performance_exceptions: z.array(z.object({ id: z.string() })),
    })
    .parse(read("release-scope-0.2.0.json"));
  const maintenance = z
    .object({
      baseline_scope_sha256: z.string(),
      categories: z.strictObject({
        local: z.array(z.string()),
        controlled_cloud: z.array(z.string()),
        emulator: z.array(z.string()),
        physical_device: z.array(z.string()),
        historical: z.array(z.string()),
      }),
      local_completed: z
        .array(
          z.object({
            id: z.string(),
            check: z.string().regex(/^test\/native-[a-z-]+\.test\.ts$/),
            covers: z.array(z.string()).min(1),
            result_scope: z.string().min(40),
          }),
        )
        .min(6),
    })
    .parse(read("maintenance-scope-0.2.1.json"));
  assert.equal(
    fileDigest(path.join(packageRoot, "provenance/release-scope-0.2.0.json")),
    maintenance.baseline_scope_sha256,
  );
  const expected = [
    ...scope.migration_exceptions.map(
      (item) =>
        `migration.${item.source.startsWith("tool:") ? "tools" : "scripts"}.${item.source.split(":")[1]}`,
    ),
    ...scope.acceptance_exceptions.map((item) => `acceptance.${item.id}`),
    ...scope.performance_exceptions.map((item) => `performance.${item.id}`),
    "soak",
  ];
  const actual = Object.values(maintenance.categories).flat();
  assert.equal(new Set(actual).size, actual.length);
  assert.deepEqual(actual.sort(), expected.sort());
  for (const item of maintenance.local_completed) {
    assert.ok(fs.statSync(path.join(packageRoot, item.check)).isFile());
    assert.ok(item.covers.every((id) => expected.includes(id)));
  }
  const row = z.object({
    source: z.string(),
    acceptance: z.string(),
    checks: z.array(z.string()),
  });
  const matrix = z
    .object({ tools: z.array(row), scripts: z.array(row) })
    .parse(read("migration-matrix.json"));
  const pending = [
    ...matrix.tools
      .filter((r) => r.acceptance === "pending")
      .map((r) => `migration.tools.${r.source}`),
    ...matrix.scripts
      .filter((r) => r.acceptance === "pending")
      .map((r) => `migration.scripts.${r.source}`),
  ];
  assert.deepEqual(
    pending.sort(),
    expected.filter((id) => id.startsWith("migration.")).sort(),
  );
  assert.ok(
    matrix.tools
      .find((r) => r.source === "arkts_knowledge_search")!
      .checks.includes("test/native-cloud-knowledge.test.ts"),
  );
});
