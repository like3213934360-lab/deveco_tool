import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { tools, workflowNames } from "../../src/core/contracts.js";
import { digest, inside } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";

const disposition = z.enum(["mapped", "replaced", "removed", "pending"]);
const resolution = z.strictObject({
  status: disposition,
  replacement: z.string().min(1),
});
const rowSchema = z.strictObject({
  source: z.string().min(1),
  targets: z.array(z.string().min(1)).min(1),
  adapters: z.array(z.string().min(1)).min(1),
  checks: z.array(z.string().min(1)).min(1),
  behavior: z.string().min(1),
  parameters: z.record(z.string(), resolution),
  actions: z.array(resolution.extend({ field: z.string(), value: z.string() })),
  remaining: z.array(z.string().min(1)),
  acceptance: z.enum(["pending", "verified"]),
  evidence: z.array(z.string().min(1)),
});
const matrixSchema = z.strictObject({
  format: z.literal(1),
  baseline_commit: z.string().regex(/^[a-f0-9]{40}$/),
  baseline_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  tools: z.array(rowSchema),
  scripts: z.array(rowSchema),
});
const jsonSchema = z
  .object({
    properties: z
      .record(z.string(), z.record(z.string(), z.unknown()))
      .default({}),
  })
  .passthrough();
const baselineSchema = z.object({
  baseline_commit: z.string(),
  inventory_sha256: z.string(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      input_schema: z.record(z.string(), z.unknown()),
    }),
  ),
  scripts: z.array(z.object({ id: z.string(), response: z.unknown() })),
});
function sameSet(expected: string[], actual: string[], subject: string) {
  invariant(
    new Set(actual).size === actual.length &&
      digest([...expected].sort()) === digest([...actual].sort()),
    "MIGRATION_COVERAGE",
    `${subject} has missing, duplicate or unexpected entries`,
  );
}
/** Coverage is checked independently of acceptance; a matching adapter name is never proof of parity. */
export function auditMigration(root: string) {
  const baseline = baselineSchema.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(root, "provenance/baseline-capabilities.json"),
        "utf8",
      ),
    ) as unknown,
  );
  const matrix = matrixSchema.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(root, "provenance/migration-matrix.json"),
        "utf8",
      ),
    ) as unknown,
  );
  invariant(
    baseline.baseline_commit === "aab1405b51e00e4036bdc8f18ae4229835de77b0" &&
      matrix.baseline_commit === baseline.baseline_commit,
    "MIGRATION_BASELINE_CHANGED",
    "The matrix must reference the frozen migration commit",
  );
  invariant(
    digest({ tools: baseline.tools, scripts: baseline.scripts }) ===
      baseline.inventory_sha256 &&
      matrix.baseline_inventory_sha256 === baseline.inventory_sha256,
    "MIGRATION_BASELINE_CHANGED",
    "Frozen tool or script contracts changed",
  );
  sameSet(
    baseline.tools.map((tool) => tool.name),
    matrix.tools.map((row) => row.source),
    "Tool coverage",
  );
  sameSet(
    baseline.scripts.map((script) => script.id),
    matrix.scripts.map((row) => row.source),
    "Script coverage",
  );
  const available = new Set([
    ...Object.keys(tools).map((name) => `tool:${name}`),
    ...workflowNames.map((name) => `workflow:${name}`),
  ]);
  const incomplete: {
    source: string;
    pending_parameters: string[];
    pending_actions: string[];
    remaining: string[];
    acceptance: string;
  }[] = [];
  let parameters = 0,
    actions = 0;
  for (const [kind, rows] of [
    ["tool", matrix.tools],
    ["script", matrix.scripts],
  ] as const)
    for (const row of rows) {
      const raw =
        kind === "tool"
          ? baseline.tools.find((tool) => tool.name === row.source)!
              .input_schema
          : z
              .object({
                scripts: z.array(
                  z.object({ id: z.string(), argsSchema: z.unknown() }),
                ),
              })
              .parse(
                baseline.scripts.find((script) => script.id === row.source)!
                  .response,
              )
              .scripts.find((script) => script.id === row.source)?.argsSchema;
      const schema = jsonSchema.parse(raw);
      sameSet(
        Object.keys(schema.properties),
        Object.keys(row.parameters),
        `${kind}:${row.source} parameters`,
      );
      const variants = ["action", "operation", "script"].flatMap((field) => {
        const values = schema.properties[field]?.enum;
        return values === undefined
          ? []
          : z
              .array(z.string())
              .parse(values)
              .map((value) => `${field}:${value}`);
      });
      sameSet(
        variants,
        row.actions.map((action) => `${action.field}:${action.value}`),
        `${kind}:${row.source} actions`,
      );
      for (const target of row.targets)
        invariant(
          available.has(target),
          "MIGRATION_TARGET_MISSING",
          `${row.source}: ${target}`,
        );
      for (const file of [...row.adapters, ...row.checks, ...row.evidence]) {
        const actual = inside(root, file);
        invariant(
          fs.existsSync(actual) && fs.statSync(actual).isFile(),
          "MIGRATION_FILE_MISSING",
          file,
        );
        if (!row.evidence.includes(file))
          invariant(
            file.endsWith(".ts"),
            "MIGRATION_LEGACY_TARGET",
            "Runtime adapters and checks must be TypeScript",
          );
      }
      parameters += Object.keys(row.parameters).length;
      actions += row.actions.length;
      const pendingParameters = Object.entries(row.parameters)
        .filter(([, value]) => value.status === "pending")
        .map(([name]) => name);
      const pendingActions = row.actions
        .filter((value) => value.status === "pending")
        .map((value) => `${value.field}:${value.value}`);
      if (row.acceptance === "verified")
        invariant(
          row.evidence.length > 0 &&
            row.remaining.length === 0 &&
            pendingParameters.length === 0 &&
            pendingActions.length === 0,
          "MIGRATION_ACCEPTANCE_UNPROVEN",
          `${row.source}: verified requires reviewed fields, completed scenarios and evidence files`,
        );
      if (row.acceptance === "pending")
        incomplete.push({
          source: `${kind}:${row.source}`,
          pending_parameters: pendingParameters,
          pending_actions: pendingActions,
          remaining: row.remaining,
          acceptance: row.acceptance,
        });
    }
  return {
    baseline_commit: matrix.baseline_commit,
    tools: matrix.tools.length,
    scripts: matrix.scripts.length,
    parameters,
    actions,
    release_ready: incomplete.length === 0,
    incomplete,
  };
}
