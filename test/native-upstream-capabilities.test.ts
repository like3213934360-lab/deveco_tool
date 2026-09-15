import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "../src/core/config.js";
import {
  auditCapabilities,
  capabilityMatrixSchema,
  readDiscoveredCapabilities,
} from "../scripts/lib/upstream-capabilities.js";
import {
  capabilityCase,
  capabilityIdentityFields,
  validateCapabilityOutcomes,
  validateCapabilityPolicy,
  validateCapabilityReport,
} from "../scripts/lib/capability-evidence.js";
import { classify, mappingSchema } from "../scripts/lib/upstream.js";
const matrix = () =>
  capabilityMatrixSchema.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, "provenance/upstream-capabilities.json"),
        "utf8",
      ),
    ),
  );
test("operation coverage inventory contains every current upstream built-in and cannot silently omit LSP operations", () => {
  assert.equal(auditCapabilities(packageRoot, matrix()).tools, readDiscoveredCapabilities(packageRoot).tools.length);
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
    acceptance: "pending",
    evidence: [],
  });
  assert.throws(() => auditCapabilities(packageRoot, pending, true), {
    code: "CAPABILITY_ACCEPTANCE_PENDING",
  });
});

const lspOperation = () =>
  matrix()
    .tools.find((row) => row.tool === "lsp")!
    .operations.find((operation) => operation.id === "outgoingCalls")!;
const observedCase = () =>
  capabilityCase.parse({
    id: "arkts.outgoing.cross-file",
    operation: "lsp.outgoingCalls",
    passed: true,
    service_support: "available",
    outcome: "executed",
    source: "public_mcp",
    policy: null,
    environment: {
      language: "arkts",
      platform: "darwin",
      sdk: "26.0.0.105",
      node: "v24.14.1",
      server: "Studio 26 ArkTS",
      client: "stdio acceptance",
    },
    scope:
      "Semantic caller/callee identity and exact UTF-16 ranges checked via public MCP; empty result is legitimate when the fixture has no calls.",
    valid_until: null,
    artifacts: [{ file: "evidence/results.json", sha256: "a".repeat(64) }],
  });
test("successful reports containing only unsupported native observations cannot certify execution", () => {
  const operation = lspOperation(),
    unsupported = observedCase();
  unsupported.service_support = "unavailable";
  unsupported.outcome = "unsupported";
  unsupported.support_evidence = {
    layer: "sdk",
    request_dispatched: true,
    response_code: -32601,
    method: "callHierarchy/outgoingCalls",
  };
  assert.throws(
    () =>
      validateCapabilityOutcomes("lsp.outgoingCalls", operation, [unsupported]),
    { code: "CAPABILITY_EXECUTION_MISSING" },
  );
  delete unsupported.support_evidence;
  assert.throws(
    () =>
      validateCapabilityOutcomes("lsp.outgoingCalls", operation, [unsupported]),
    { code: "CAPABILITY_UNSUPPORTED_UNPROVEN" },
  );
  assert.equal(
    capabilityCase.safeParse({
      ...unsupported,
      support_evidence: {
        layer: "sdk",
        request_dispatched: false,
        response_code: "LSP_CAPABILITY_UNAVAILABLE",
        method: "callHierarchy/outgoingCalls",
      },
    }).success,
    false,
  );
});
test("target language, SDK, platform, source and successful assertions are required while valid empty results are allowed", () => {
  const operation = lspOperation();
  validateCapabilityOutcomes("lsp.outgoingCalls", operation, [observedCase()]);
  for (const dimension of [
    { language: "cpp" },
    { sdk: "25.0.0" },
    { platform: "win32" },
  ]) {
    const observation = capabilityCase.parse({
      ...observedCase(),
      environment: { ...observedCase().environment, ...dimension },
    });
    assert.throws(
      () =>
        validateCapabilityOutcomes("lsp.outgoingCalls", operation, [
          observation,
        ]),
      { code: "CAPABILITY_EXECUTION_MISSING" },
    );
  }
  for (const change of [
    { passed: false },
    { outcome: "unverified" },
    { source: "sdk_response" },
  ]) {
    const observation = capabilityCase.parse({ ...observedCase(), ...change });
    assert.throws(
      () =>
        validateCapabilityOutcomes("lsp.outgoingCalls", operation, [
          observation,
        ]),
      { code: "CAPABILITY_EXECUTION_MISSING" },
    );
  }
  const cpp = capabilityCase.parse({
    ...observedCase(),
    id: "cpp.outgoing",
    environment: { ...observedCase().environment, language: "cpp" },
    service_support: "unavailable",
    outcome: "unsupported",
    support_evidence: {
      layer: "sdk",
      request_dispatched: true,
      response_code: -32601,
      method: "callHierarchy/outgoingCalls",
    },
  });
  validateCapabilityOutcomes("lsp.outgoingCalls", operation, [
    observedCase(),
    cpp,
  ]);
});
test("product exclusions and client boundaries cannot be applied to required native tools", () => {
  const operation = lspOperation();
  assert.throws(
    () =>
      validateCapabilityPolicy("lsp", "native", {
        ...operation,
        disposition: "explicitly_excluded",
        policy: "builtin-mcp-skills-only",
        implementation: "not_applicable",
        required_scopes: [],
      }),
    { code: "CAPABILITY_POLICY_INVALID" },
  );
  assert.throws(
    () =>
      validateCapabilityPolicy("lsp", "native", {
        ...operation,
        required_scopes: [
          { language: "cpp", sdk: "26.0.0.105", platform: "darwin" },
        ],
      }),
    { code: "CAPABILITY_SCOPE_INVALID" },
  );
  const client = matrix().tools.find((row) => row.tool === "bash")!
    .operations[0]!;
  assert.throws(
    () =>
      validateCapabilityPolicy("shell", "client_required", {
        ...client,
        acceptance: "verified",
      }),
    { code: "CAPABILITY_STATUS_INVALID" },
  );
  const contract = capabilityCase.parse({
    ...observedCase(),
    operation: "bash.execute",
    outcome: "client_required",
    source: "client_contract",
    service_support: "not_applicable",
    policy: "host-general-tools",
  });
  validateCapabilityOutcomes("bash.execute", client, [contract]);
  assert.throws(
    () =>
      validateCapabilityOutcomes("bash.execute", client, [
        { ...contract, valid_until: "2020-01-01T00:00:00Z" },
      ]),
    { code: "CAPABILITY_EVIDENCE_EXPIRED" },
  );
});
test("current evidence binds source and runtime identities, timestamps and reviewed upstream registry", () => {
  const tested = Object.fromEntries(
    capabilityIdentityFields.map((key) => [key, "a".repeat(64)]),
  ) as Record<(typeof capabilityIdentityFields)[number], string>;
  const report = {
    format: 2,
    passed: true,
    started_at: "2026-09-10T00:00:00Z",
    finished_at: "2026-09-10T00:00:01Z",
    tested,
    cases: [observedCase()],
  };
  validateCapabilityReport(report, tested, Date.parse("2026-09-11T00:00:00Z"));
  for (const key of capabilityIdentityFields)
    assert.throws(
      () =>
        validateCapabilityReport(report, { ...tested, [key]: "b".repeat(64) }),
      { code: "CAPABILITY_EVIDENCE_STALE" },
    );
  assert.throws(
    () =>
      validateCapabilityReport(
        { ...report, finished_at: "2026-09-09T00:00:00Z" },
        tested,
      ),
    { code: "CAPABILITY_REPORT_INVALID" },
  );
  const unreviewed = matrix();
  unreviewed.source.registry_sha256 = "b".repeat(64);
  assert.throws(() => auditCapabilities(packageRoot, unreviewed), {
    code: "CAPABILITY_REGISTRY_UNREVIEWED",
  });
  const missing = matrix();
  missing.tools.find((row) => row.tool === "verify_ui")!.operations.pop();
  assert.throws(() => auditCapabilities(packageRoot, missing), {
    code: "CAPABILITY_OPERATION_MISSING",
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
