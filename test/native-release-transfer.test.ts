import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileDigest } from "../src/core/files.js";
import { packageRoot } from "../src/core/config.js";
import {
  encryptEvidence,
  decryptEvidence,
  verifyEvidenceArtifact,
} from "../scripts/lib/release-transfer.js";
import { verifyPublish } from "../scripts/verify-publish.js";

function fixture(t: import("node:test").TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-transfer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("artifact transport encrypts with fresh nonces and authenticates both ciphertext and reviewed plaintext before any write", (t) => {
  const root = fixture(t),
    input = path.join(root, "evidence.zip"),
    encrypted = path.join(root, "evidence.enc"),
    output = path.join(root, "restored.zip");
  const secret = "ab".repeat(32),
    content = Buffer.from("private-fixture-report-never-upload-in-plaintext");
  fs.writeFileSync(input, content);
  const sealed = encryptEvidence(input, encrypted, fileDigest(input), secret);
  const other = path.join(root, "second.enc");
  encryptEvidence(input, other, fileDigest(input), secret);
  assert.notEqual(fileDigest(encrypted), fileDigest(other));
  assert.equal(fs.readFileSync(encrypted).includes(content), false);
  assert.throws(
    () =>
      decryptEvidence(
        encrypted,
        output,
        "0".repeat(64),
        sealed.evidence_sha256,
        secret,
      ),
    { code: "TRANSFER_DIGEST" },
  );
  assert.throws(
    () =>
      decryptEvidence(
        encrypted,
        output,
        sealed.transfer_sha256,
        "0".repeat(64),
        secret,
      ),
    { code: "TRANSFER_DIGEST" },
  );
  assert.throws(() =>
    decryptEvidence(
      encrypted,
      output,
      sealed.transfer_sha256,
      sealed.evidence_sha256,
      "cd".repeat(32),
    ),
  );
  assert.throws(
    () =>
      decryptEvidence(
        encrypted,
        output,
        sealed.transfer_sha256,
        sealed.evidence_sha256,
        undefined,
      ),
    { code: "TRANSFER_KEY" },
  );
  assert.equal(fs.existsSync(output), false);
  decryptEvidence(
    encrypted,
    output,
    sealed.transfer_sha256,
    sealed.evidence_sha256,
    secret,
  );
  assert.deepEqual(fs.readFileSync(output), content);
  assert.throws(
    () =>
      decryptEvidence(
        encrypted,
        output,
        sealed.transfer_sha256,
        sealed.evidence_sha256,
        secret,
      ),
    { code: "EEXIST" },
  );
  assert.deepEqual(fs.readFileSync(output), content);
  const corrupted = fs.readFileSync(encrypted);
  corrupted[corrupted.length - 1]! ^= 1;
  fs.writeFileSync(encrypted, corrupted);
  const rejected = path.join(root, "rejected.zip");
  assert.throws(() =>
    decryptEvidence(
      encrypted,
      rejected,
      fileDigest(encrypted),
      sealed.evidence_sha256,
      secret,
    ),
  );
  assert.equal(fs.existsSync(rejected), false);
  fs.writeFileSync(encrypted, Buffer.from("truncated"));
  assert.throws(
    () =>
      decryptEvidence(
        encrypted,
        rejected,
        fileDigest(encrypted),
        sealed.evidence_sha256,
        secret,
      ),
    { code: "TRANSFER_FORMAT" },
  );
});

function selectionFixture() {
  const selection = {
    run: "12",
    attempt: "2",
    artifact: "34",
    artifact_digest: "a".repeat(64),
    commit: "b".repeat(40),
    repository: "owner/repo",
    branch: "main",
  };
  const run = {
    id: 12,
    run_attempt: 2,
    head_sha: selection.commit,
    head_branch: "main",
    path: ".github/workflows/release-evidence.yml",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    repository: { id: 56, full_name: "owner/repo" },
    head_repository: { id: 56, full_name: "owner/repo" },
  };
  const artifact = {
    id: 34,
    name: "release-input-12-2",
    expired: false,
    digest: `sha256:${selection.artifact_digest}`,
    workflow_run: {
      id: 12,
      repository_id: 56,
      head_repository_id: 56,
      head_sha: selection.commit,
    },
  };
  return { selection, run, artifact };
}
test("release selection requires the exact successful trusted workflow, attempt, commit, artifact owner and digest", () => {
  const f = selectionFixture();
  assert.equal(
    verifyEvidenceArtifact(f.run, f.artifact, f.selection).artifact_id,
    34,
  );
  for (const change of [
    { id: 13 },
    { run_attempt: 1 },
    { head_sha: "c".repeat(40) },
    { head_branch: "feature" },
    { path: ".github/workflows/native-ci.yml" },
    { event: "pull_request" },
    { event: "pull_request_target" },
    { event: "workflow_run" },
    { status: "in_progress" },
    { conclusion: "cancelled" },
    { conclusion: "failure" },
    { head_repository: { id: 57, full_name: "fork/repo" } },
    { repository: { id: 57, full_name: "other/repo" } },
  ])
    assert.throws(
      () =>
        verifyEvidenceArtifact(
          { ...f.run, ...change },
          f.artifact,
          f.selection,
        ),
      JSON.stringify(change),
    );
  for (const change of [
    { id: 35 },
    { name: "release-input-12-1" },
    { expired: true },
    { digest: `sha256:${"c".repeat(64)}` },
    { workflow_run: { ...f.artifact.workflow_run, id: 13 } },
    { workflow_run: { ...f.artifact.workflow_run, head_repository_id: 57 } },
    { workflow_run: { ...f.artifact.workflow_run, repository_id: 57 } },
    { workflow_run: { ...f.artifact.workflow_run, head_sha: "c".repeat(40) } },
  ])
    assert.throws(
      () =>
        verifyEvidenceArtifact(
          f.run,
          { ...f.artifact, ...change },
          f.selection,
        ),
      JSON.stringify(change),
    );
});

test("publication refuses changed receipts, archives and extra assets after crossing the job boundary", (t) => {
  const root = fixture(t),
    archive = path.join(root, "deveco-tool-0.2.1.zip"),
    receipt = path.join(root, "acceptance.json");
  fs.writeFileSync(archive, "sealed zip fixture");
  const archiveSha = fileDigest(archive);
  fs.writeFileSync(
    `${archive}.sha256`,
    `${archiveSha}  ${path.basename(archive)}\n`,
  );
  fs.writeFileSync(
    receipt,
    JSON.stringify({
      release: "0.2.1",
      passed: true,
      archive_sha256: archiveSha,
    }),
  );
  const receiptSha = fileDigest(receipt),
    check = () => verifyPublish(root, "v0.2.1", archiveSha, receiptSha);
  check();
  fs.writeFileSync(path.join(root, "unreviewed.txt"), "extra");
  assert.throws(check);
  fs.rmSync(path.join(root, "unreviewed.txt"));
  fs.appendFileSync(receipt, " ");
  assert.throws(check);
  fs.truncateSync(receipt, fs.statSync(receipt).size - 1);
  fs.appendFileSync(archive, "tampered");
  assert.throws(check);
});

test("workflow trust and cleanup boundaries forbid public evidence relays and floating Action tags", () => {
  const workflows = path.join(packageRoot, ".github/workflows");
  for (const name of fs
    .readdirSync(workflows)
    .filter((name) => name.endsWith(".yml"))) {
    const source = fs.readFileSync(path.join(workflows, name), "utf8");
    for (const line of source.split("\n").filter((line) => /uses:/.test(line)))
      assert.match(line, /uses: actions\/[a-z-]+@[a-f0-9]{40} # v[0-9.]+$/);
  }
  const evidence = fs.readFileSync(
    path.join(workflows, "release-evidence.yml"),
    "utf8",
  );
  assert.doesNotMatch(
    evidence,
    /releases\/assets|gh release|git tag|contents: write|pull_request_target|workflow_run:/,
  );
  assert.match(evidence, /permissions: \{\}/);
  assert.match(evidence, /needs: import/);
  assert.match(
    evidence,
    /release-input-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/,
  );
  assert.match(
    evidence,
    /path: \$\{\{ runner.temp \}\}\/release-transfer\/evidence.enc/,
  );
  assert.match(evidence, /retention-days: 7/);
  assert.match(
    evidence,
    /if: always\(\)\n\s+run: rm -rf -- "\$RUNNER_TEMP\/evidence.zip"/,
  );
  const release = fs.readFileSync(path.join(workflows, "release.yml"), "utf8");
  assert.match(
    release,
    /artifact-ids: \$\{\{ inputs.evidence_artifact_id \}\}/,
  );
  assert.match(
    release,
    /artifact-ids: \$\{\{ needs.gate.outputs.artifact_id \}\}/,
  );
  assert.match(release, /node dist\/scripts\/release-artifact.js/);
  assert.match(
    release,
    /node --experimental-strip-types scripts\/verify-publish.ts/,
  );
});
