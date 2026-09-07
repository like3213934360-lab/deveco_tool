import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditMigration } from "../scripts/lib/migration.js";
import { z } from "zod";

test("migration coverage cannot omit a baseline tool, parameter or action, or confuse implementation with acceptance", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url)),
    result = auditMigration(root);
  assert.equal(result.tools, 40);
  assert.equal(result.scripts, 7);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-migration-"));
  try {
    fs.mkdirSync(path.join(temporary, "provenance"));
    fs.copyFileSync(
      path.join(root, "provenance/baseline-capabilities.json"),
      path.join(temporary, "provenance/baseline-capabilities.json"),
    );
    const original = fs.readFileSync(
      path.join(root, "provenance/migration-matrix.json"),
      "utf8",
    );
    const mutate = (
      action: (value: {
        tools: {
          source: string;
          parameters: Record<string, unknown>;
          actions: unknown[];
        }[];
      }) => void,
    ) => {
      const value = JSON.parse(original) as {
        tools: {
          source: string;
          parameters: Record<string, unknown>;
          actions: unknown[];
        }[];
      };
      action(value);
      fs.writeFileSync(
        path.join(temporary, "provenance/migration-matrix.json"),
        JSON.stringify(value),
      );
      assert.throws(() => auditMigration(temporary), {
        code: "MIGRATION_COVERAGE",
      });
    };
    mutate((value) => {
      value.tools.pop();
    });
    mutate((value) => {
      delete value.tools[0]!.parameters.action;
    });
    mutate((value) => {
      value.tools[0]!.actions.pop();
    });
    const matrix = z
      .object({
        tools: z.array(
          z
            .object({
              adapters: z.array(z.string()),
              checks: z.array(z.string()),
              acceptance: z.string(),
            })
            .passthrough(),
        ),
        scripts: z.array(
          z
            .object({
              adapters: z.array(z.string()),
              checks: z.array(z.string()),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .parse(JSON.parse(original) as unknown);
    for (const row of [...matrix.tools, ...matrix.scripts])
      for (const file of [...row.adapters, ...row.checks]) {
        const target = path.join(temporary, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "// fixture\n");
      }
    matrix.tools[0]!.acceptance = "verified";
    fs.writeFileSync(
      path.join(temporary, "provenance/migration-matrix.json"),
      JSON.stringify(matrix),
    );
    assert.throws(() => auditMigration(temporary), {
      code: "MIGRATION_ACCEPTANCE_UNPROVEN",
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
