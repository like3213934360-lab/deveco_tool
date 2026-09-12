import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { packageRoot } from "../src/core/config.js";
import { atomicWrite, digest, fileDigest, inside } from "../src/core/files.js";
import { evidenceIdentity } from "./lib/evidence.js";
import {
  capabilityPath,
  validateCapabilityReport,
  validateCapabilityOutcomes,
  type CapabilityCase,
} from "./lib/capability-evidence.js";
import { capabilityFacts } from "./lib/capability-receipts.js";
import {
  auditCapabilities,
  capabilityMatrixSchema,
} from "./lib/upstream-capabilities.js";

/** Publish only asserted, sanitized facts from successful current executions.
 * Never refresh a historical receipt's identity or infer a native pass from a
 * local refusal. The matrix is replaced only when all 50 operations qualify. */
const [destination, ...inputs] = z
  .tuple([capabilityPath])
  .rest(z.string())
  .parse(process.argv.slice(2));
assert.ok(
  destination.startsWith("provenance/capability-evidence/") &&
    inputs.length > 0,
);
const output = inside(packageRoot, path.join(packageRoot, destination));
assert.equal(
  fs.existsSync(output),
  false,
  "Choose a new public evidence directory",
);
const matrixFile = path.join(
    packageRoot,
    "provenance/upstream-capabilities.json",
  ),
  original = fileDigest(matrixFile);
const matrix = capabilityMatrixSchema.parse(
    JSON.parse(fs.readFileSync(matrixFile, "utf8")),
  ),
  tested = evidenceIdentity();
const files = new Map<string, string>(),
  observations = new Map<
    string,
    {
      item: CapabilityCase;
      reference: { file: string; sha256: string; case: string };
    }[]
  >();
const sha = (content: string) =>
  createHash("sha256").update(content).digest("hex");
for (const [index, input] of inputs.entries()) {
  assert.ok(path.isAbsolute(input));
  const privateRoot = fs.realpathSync(path.dirname(input));
  const accepted = z
    .object({
      passed: z.literal(true),
      completed: z.literal(true),
      closed: z.literal(true),
      unchanged: z.literal(true),
      tested: z.unknown(),
    })
    .parse(
      JSON.parse(
        fs.readFileSync(path.join(privateRoot, "evidence.json"), "utf8"),
      ),
    );
  const report = validateCapabilityReport(
    JSON.parse(fs.readFileSync(input, "utf8")),
    tested,
  );
  // Check the companion lifecycle receipt too, not merely a standalone claim.
  validateCapabilityReport({ ...report, tested: accepted.tested }, tested);
  for (const item of report.cases) {
    assert.equal(item.artifacts.length, 1);
    for (const artifact of item.artifacts) {
      const file = inside(privateRoot, path.join(privateRoot, artifact.file));
      assert.equal(fs.lstatSync(file).isFile(), true);
      assert.equal(fileDigest(file), artifact.sha256);
      const facts = capabilityFacts.parse(
        JSON.parse(fs.readFileSync(file, "utf8")),
      );
      assert.equal(facts.operation, item.operation);
      assert.equal(item.scope, facts.checks.join(" "));
      const rawFile = inside(
        privateRoot,
        path.join(privateRoot, "capability-private", `${item.operation}.json`),
      );
      assert.equal(fs.lstatSync(rawFile).isFile(), true);
      assert.equal(
        digest(JSON.parse(fs.readFileSync(rawFile, "utf8"))),
        facts.observation_sha256,
      );
      const publicFile = `${destination}/group-${index}/${item.operation}.json`,
        content = JSON.stringify(facts, null, 2) + "\n";
      assert.equal(files.has(publicFile), false);
      files.set(publicFile, content);
      artifact.file = publicFile;
      artifact.sha256 = sha(content);
    }
  }
  const publicReport = `${destination}/group-${index}/report.json`,
    content = JSON.stringify(report, null, 2) + "\n";
  files.set(publicReport, content);
  for (const item of report.cases) {
    const list = observations.get(item.operation) ?? [];
    list.push({
      item,
      reference: { file: publicReport, sha256: sha(content), case: item.id },
    });
    observations.set(item.operation, list);
  }
}
const expected = matrix.tools.flatMap((tool) =>
  tool.operations.map((operation) => `${tool.tool}.${operation.id}`),
);
assert.deepEqual([...observations.keys()].sort(), [...expected].sort());
assert.equal(expected.length, 50);
for (const tool of matrix.tools)
  for (const operation of tool.operations) {
    const values = observations.get(`${tool.tool}.${operation.id}`)!;
    validateCapabilityOutcomes(
      `${tool.tool}.${operation.id}`,
      operation,
      values.map((value) => value.item),
    );
    operation.implementation =
      operation.disposition === "required" ? "implemented" : "not_applicable";
    operation.acceptance =
      operation.disposition === "required" ? "verified" : "boundary_verified";
    operation.evidence = values.map((value) => value.reference);
    operation.boundary = [
      ...new Set(values.map((value) => value.item.scope)),
    ].join(" ");
  }
assert.equal(
  fileDigest(matrixFile),
  original,
  "Matrix changed during publication preparation",
);
for (const [file, content] of files) {
  const target = inside(packageRoot, path.join(packageRoot, file));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  atomicWrite(target, content, false);
}
auditCapabilities(packageRoot, matrix, true);
assert.equal(fileDigest(matrixFile), original);
atomicWrite(matrixFile, JSON.stringify(matrix, null, 2) + "\n");
console.log(
  JSON.stringify({
    published: destination,
    operations: expected.length,
    required: 36,
    boundaries: 14,
    reports: inputs.length,
  }),
);
