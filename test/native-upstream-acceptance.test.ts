import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite, digest, fileDigest } from "../src/core/files.js";
import { mappingSchema, sourceSchema } from "../scripts/lib/upstream.js";
import { applyBaseline, acceptBaseline, upstreamAcceptanceGate, refreshBaseline } from "../scripts/lib/upstream-adaptation.js";
import { acceptMigration, verifyMigrationEvidence } from "../scripts/lib/migration-acceptance.js";
import { evidenceIdentity } from "../scripts/lib/evidence.js";

function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "native-source-acceptance-")));
  const write = (file: string, value: unknown) => atomicWrite(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
  const sources = ["one", "two"].map((id) => sourceSchema.parse({ id, url: `https://example.invalid/${id}.git`, ref: "refs/heads/main", commit: "a".repeat(40), tree: "b".repeat(40), version: "fixture", role: "protocol_reference", acceptance: "pending" }));
  const mapping = mappingSchema.parse({ format: 1, rules: sources.map(({ id }) => ({ id: `${id}-rule`, source: id, path: "protocol.ts", disposition: "adapt", reason: "Fixture protocol is implemented by a native typed adapter", targets: ["src/fixture.ts"], tests: ["test/fixture.test.ts"] })) });
  write("provenance/upstream-lock.json", { format: 1, sources }); write("provenance/upstream-mapping.json", mapping);
  atomicWrite(path.join(root, "LICENSE"), "Fixture license\n"); atomicWrite(path.join(root, "resources/knowledge.json"), "[]\n");
  const resourceHash = fileDigest(path.join(root, "resources/knowledge.json"));
  write("provenance/resources.json", { format: 1, sources: [{ id: "fixture", version: "fixture", url: "https://example.invalid/", integrity: "fixture", license: "LICENSE" }], files: [{ file: "resources/knowledge.json", sha256: resourceHash, source: "fixture", source_path: "knowledge.json", source_sha256: resourceHash, transformation: "unchanged" }] });
  write("package-lock.json", {});
  for (const file of ["src/fixture.ts", "test/fixture.test.ts", "dist/src/fixture.js", "dist/test/fixture.test.js"]) atomicWrite(path.join(root, file), "// Synthetic acceptance gate fixture; not release evidence.\n");
  const targets = ["src/fixture.ts", "test/fixture.test.ts"].map((file) => ({ path: file, sha256: digest([{ path: file, sha256: fileDigest(path.join(root, file)) }]) }));
  for (const source of sources) applyBaseline(root, { format: 1, source, mapping_sha256: digest(mapping), reviews: [{ rule: `${source.id}-rule`, reason: "Synthetic test verifies the native receipt contract only", reviewer: "unit fixture" }], targets, required_tests: ["test/fixture.test.ts"] });
  const evidence = (name: string) => {
    const report = path.join(root, `${name}.private.json`);
    write(`${name}.private.json`, { passed: true, identity: evidenceIdentity(root), executed_tests: ["dist/test/fixture.test.js"], private_path: "/private/DO-NOT-PUBLISH", device: "PRIVATE-DEVICE", token: "PRIVATE-TOKEN" });
    return { checks: [{ check: "test/fixture.test.ts", report, sha256: fileDigest(report) }] };
  };
  return { root, write, evidence };
}

test("baseline acceptance retries preserve independently accepted sources and publish only allowlisted evidence", () => {
  const f = fixture();
  try {
    const first = f.evidence("one"); acceptBaseline(f.root, "one", first);
    acceptBaseline(f.root, "two", f.evidence("two"));
    assert.equal(acceptBaseline(f.root, "one", first).deduplicated, true);
    assert.equal(upstreamAcceptanceGate(f.root).baseline_reports, 2);
    const directory = path.join(f.root, "provenance/upstream-baselines/one/checks");
    for (const file of fs.readdirSync(directory)) {
      const text = fs.readFileSync(path.join(directory, file), "utf8");
      for (const secret of ["DO-NOT-PUBLISH", "PRIVATE-DEVICE", "PRIVATE-TOKEN", f.root]) assert.equal(text.includes(secret), false);
    }
    atomicWrite(path.join(f.root, "dist/src/fixture.js"), "// changed compiled code\n");
    assert.throws(() => upstreamAcceptanceGate(f.root), { code: "UPSTREAM_EVIDENCE_STALE" });
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("verified flags without receipts and passing reports without executed scope cannot satisfy acceptance", () => {
  const f = fixture();
  try {
    const evidence = f.evidence("unscoped"), item = evidence.checks[0]!;
    const report = JSON.parse(fs.readFileSync(item.report, "utf8")); report.executed_tests = [];
    atomicWrite(item.report, JSON.stringify(report)); item.sha256 = fileDigest(item.report);
    assert.throws(() => acceptBaseline(f.root, "one", evidence), { code: "UPSTREAM_EVIDENCE_SCOPE" });
    const file = path.join(f.root, "provenance/upstream-lock.json"), lock = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const source of lock.sources) source.acceptance = "verified";
    atomicWrite(file, JSON.stringify(lock));
    assert.throws(() => upstreamAcceptanceGate(f.root));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("new baseline review archives old evidence and resumes after the new review was published", () => {
  const f = fixture();
  try {
    acceptBaseline(f.root, "one", f.evidence("old"));
    const file = path.join(f.root, "provenance/upstream-baselines/one/review.json");
    const previous = fs.readFileSync(file, "utf8"), plan = JSON.parse(previous);
    plan.source.acceptance = "verified";
    atomicWrite(path.join(f.root, "src/fixture.ts"), "// Reviewed implementation revision\n");
    atomicWrite(path.join(f.root, "dist/src/fixture.js"), "// Compiled implementation revision\n");
    plan.targets[0].sha256 = digest([{ path: "src/fixture.ts", sha256: fileDigest(path.join(f.root, "src/fixture.ts")) }]);
    const refreshed = refreshBaseline(f.root, plan);
    assert.equal(fs.readFileSync(path.join(f.root, refreshed.history, "baseline/review.json"), "utf8"), previous);
    assert.equal(fs.existsSync(path.join(f.root, "provenance/upstream-baselines/one/accepted.json")), false);
    assert.deepEqual(refreshBaseline(f.root, plan), refreshed);
    assert.equal(acceptBaseline(f.root, "one", f.evidence("new")).accepted, true);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("migration acceptance requires all scenarios and current executed checks, is retryable and redacts raw evidence", () => {
  const f = fixture();
  try {
    f.write("provenance/migration-matrix.json", { tools: [{ source: "fixture", checks: ["test/fixture.test.ts"], remaining: ["recovery"], acceptance: "pending", evidence: [], behavior: "preserved" }], scripts: [] });
    const plan = { format: 1, source: "tools:fixture", reviewer: "unit fixture", reason: "Synthetic migration contract regression only", completed_scenarios: ["recovery"], checks: f.evidence("migration").checks };
    assert.throws(() => acceptMigration(f.root, { ...plan, completed_scenarios: [] }), { code: "MIGRATION_SCENARIOS_INCOMPLETE" });
    const result = acceptMigration(f.root, plan);
    assert.equal(result.deduplicated, false);
    assert.equal(acceptMigration(f.root, plan).deduplicated, true);
    assert.equal(verifyMigrationEvidence(f.root).verified_rows, 1);
    const receipt = fs.readFileSync(path.join(f.root, result.receipt), "utf8");
    for (const secret of [f.root, "PRIVATE-TOKEN", "PRIVATE-DEVICE", "DO-NOT-PUBLISH"]) assert.equal(receipt.includes(secret), false);
    atomicWrite(path.join(f.root, "dist/src/fixture.js"), "// stale evidence\n");
    assert.throws(() => verifyMigrationEvidence(f.root), { code: "MIGRATION_EVIDENCE_STALE" });
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
