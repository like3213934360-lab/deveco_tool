import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "../src/core/config.js";
import { auditCapabilities } from "../scripts/lib/upstream-capabilities.js";
import { classify, mappingSchema } from "../scripts/lib/upstream.js";
const matrix = () =>
  JSON.parse(
    fs.readFileSync(
      path.join(packageRoot, "provenance/upstream-capabilities.json"),
      "utf8",
    ),
  ) as { tools: { tool: string; operations: { id: string }[] }[] };
test("operation coverage inventory contains every current upstream built-in and cannot silently omit LSP operations", () => {
  assert.equal(auditCapabilities(packageRoot, matrix()).tools, 28);
  const missing = matrix();
  missing.tools.find((row) => row.tool === "lsp")!.operations.pop();
  assert.throws(() => auditCapabilities(packageRoot, missing), {
    code: "CAPABILITY_OPERATION_MISSING",
  });
  const duplicate = matrix();
  duplicate.tools[1] = duplicate.tools[0]!;
  assert.throws(() => auditCapabilities(packageRoot, duplicate), {
    code: "CAPABILITY_DUPLICATE",
  });
});
test("unaccepted operation rows cannot pass the formal-release capability gate", () => {
  const pending = matrix();
  Object.assign(pending.tools[0]!.operations[0]!, {
    status: "pending",
    evidence: [],
  });
  assert.throws(() => auditCapabilities(packageRoot, pending, true), {
    code: "CAPABILITY_ACCEPTANCE_PENDING",
  });
});
test("upstream tool bodies, prompts, registry, LSP and Skill customization no longer disappear under host-package exclusion", () => {
  const mapping = mappingSchema.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, "provenance/upstream-mapping.json"),
        "utf8",
      ),
    ),
  );
  for (const file of [
    "tool/registry.ts",
    "tool/lsp.ts",
    "tool/lsp.txt",
    "tool/plan.ts",
    "tool/ui-verification/ui-verification-tool.ts",
    "lsp/lsp.ts",
  ])
    assert.equal(
      classify(mapping, "deveco-code", `packages/opencode/src/${file}`)
        ?.disposition,
      "adapt",
      file,
    );
  assert.equal(
    classify(
      mapping,
      "deveco-code",
      "packages/opencode/src/tool/future-tool.ts",
    )?.disposition,
    "unmapped",
  );
  assert.equal(
    classify(
      mapping,
      "deveco-code",
      "packages/opencode/resources/skills/customize-deveco/SKILL.md",
    )?.disposition,
    "adapt",
  );
  assert.equal(
    classify(mapping, "deveco-cli", "src/skills/install.ts")?.disposition,
    "adapt",
  );
});
