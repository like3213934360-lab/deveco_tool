import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { atomicWrite, digest, fileDigest } from "../../src/core/files.js";
import { release } from "../../src/core/config.js";
import { evidenceIdentity } from "./evidence.js";
import {
  capabilityCase,
  capabilityIdentityFields,
  capabilityReport,
  type CapabilityCase,
} from "./capability-evidence.js";

// Public receipts contain explicit asserted facts and a digest of the private
// observation. Raw responses, paths, screenshots and input values stay private.
export const capabilityFacts = z.strictObject({
  format: z.literal(1),
  operation: z.string().regex(/^[A-Za-z_]+\.[A-Za-z_]+$/),
  checks: z.array(z.string().min(10).max(1024)).min(1).max(32),
  observation_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export class CapabilityReceipts {
  readonly started_at = new Date().toISOString();
  private readonly cases: CapabilityCase[] = [];
  constructor(
    readonly root: string,
    readonly tested: ReturnType<typeof evidenceIdentity>,
  ) {}
  add(
    operation: string,
    checks: string[],
    observation: unknown,
    options: {
      language?: "arkts" | "cpp";
      sdk?: string;
      boundary?: "client_required" | "explicitly_excluded";
    } = {},
  ) {
    assert.equal(
      this.cases.some((item) => item.operation === operation),
      false,
    );
    const facts = capabilityFacts.parse({
      format: 1,
      operation,
      checks,
      observation_sha256: digest(observation),
    });
    const privateFile = path.join(
      this.root,
      "capability-private",
      `${operation}.json`,
    );
    fs.mkdirSync(path.dirname(privateFile), { recursive: true, mode: 0o700 });
    atomicWrite(privateFile, JSON.stringify(observation), false);
    const relative = `capability-facts/${operation}.json`,
      file = path.join(this.root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    atomicWrite(file, JSON.stringify(facts, null, 2) + "\n", false);
    this.cases.push(
      capabilityCase.parse({
        id: operation,
        operation,
        passed: true,
        service_support: options.boundary ? "not_applicable" : "available",
        outcome: options.boundary ?? "executed",
        environment: {
          language: options.language ?? "none",
          platform: process.platform,
          sdk: options.sdk ?? null,
          node: process.version,
          server: options.boundary ? null : `native-mcp/${release}`,
          client:
            "generic-stdio-mcp-sdk/1.30.0; Codex GPT-6 visual assessment when required",
        },
        source:
          options.boundary === "client_required"
            ? "client_contract"
            : options.boundary
              ? "product_decision"
              : "public_mcp",
        policy:
          options.boundary === "client_required"
            ? "host-general-tools"
            : options.boundary
              ? "builtin-mcp-skills-only"
              : null,
        scope: checks.join(" "),
        valid_until: null,
        artifacts: [{ file: relative, sha256: fileDigest(file) }],
      }),
    );
  }
  finish(acceptancePassed: boolean) {
    if (!acceptancePassed) return;
    const current = evidenceIdentity();
    for (const field of capabilityIdentityFields)
      assert.equal(current[field], this.tested[field], field);
    const report = capabilityReport.parse({
      format: 2,
      passed: true,
      started_at: this.started_at,
      finished_at: new Date().toISOString(),
      tested: Object.fromEntries(
        capabilityIdentityFields.map((field) => [field, this.tested[field]]),
      ),
      cases: this.cases,
    });
    atomicWrite(
      path.join(this.root, "capabilities.json"),
      JSON.stringify(report, null, 2) + "\n",
      false,
    );
  }
}
