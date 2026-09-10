import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";
import { atomicWrite } from "../../src/core/files.js";
import { invariant } from "../../src/core/errors.js";

const magic = Buffer.from("deveco-evidence-v1\n"),
  maximumBytes = 512 * 1024 * 1024;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const digest = (bytes: Buffer) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
function read(file: string, bound: number) {
  invariant(
    fs.lstatSync(file).isFile() && fs.statSync(file).size <= bound,
    "TRANSFER_LIMIT",
    "Transfer input must be a bounded regular file",
  );
  const bytes = fs.readFileSync(file);
  invariant(
    bytes.length <= bound,
    "TRANSFER_LIMIT",
    "Transfer input grew beyond its bound",
  );
  return bytes;
}
function key(value: string | undefined) {
  invariant(
    value && /^[a-f0-9]{64}$/.test(value),
    "TRANSFER_KEY",
    "RELEASE_EVIDENCE_KEY must contain a 256-bit hex key",
  );
  return Buffer.from(value, "hex");
}

/** Public-repository artifacts are readable by repository readers. Only this
 * authenticated ciphertext crosses the artifact service; the key stays local
 * or in a protected GitHub environment secret and is never a CLI argument. */
export function encryptEvidence(
  input: string,
  output: string,
  expectedSha: string,
  secret: string | undefined,
) {
  const bytes = read(input, maximumBytes);
  invariant(
    digest(bytes) === sha.parse(expectedSha),
    "TRANSFER_DIGEST",
    "Evidence ZIP differs from its reviewed digest",
  );
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(magic);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const envelope = Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]);
  atomicWrite(output, envelope, false);
  return { evidence_sha256: expectedSha, transfer_sha256: digest(envelope) };
}

export function decryptEvidence(
  input: string,
  output: string,
  transferSha: string,
  evidenceSha: string,
  secret: string | undefined,
) {
  const envelope = read(input, maximumBytes + magic.length + 28);
  invariant(
    digest(envelope) === sha.parse(transferSha),
    "TRANSFER_DIGEST",
    "Encrypted transfer differs from its reviewed digest",
  );
  invariant(
    envelope.length > magic.length + 28 &&
      envelope.subarray(0, magic.length).equals(magic),
    "TRANSFER_FORMAT",
    "Unknown evidence encryption format",
  );
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(secret),
    envelope.subarray(magic.length, magic.length + 12),
  );
  decipher.setAAD(magic);
  decipher.setAuthTag(envelope.subarray(magic.length + 12, magic.length + 28));
  const bytes = Buffer.concat([
    decipher.update(envelope.subarray(magic.length + 28)),
    decipher.final(),
  ]);
  invariant(
    digest(bytes) === sha.parse(evidenceSha),
    "TRANSFER_DIGEST",
    "Decrypted ZIP differs from its reviewed digest",
  );
  atomicWrite(output, bytes, false);
  return { evidence_sha256: evidenceSha, transfer_sha256: transferSha };
}

const id = z.number().int().positive().safe();
const repository = z.object({ id, full_name: z.string() });
const runSchema = z.object({
  id,
  run_attempt: id,
  head_sha: z.string().regex(/^[a-f0-9]{40}$/),
  head_branch: z.string(),
  path: z.string(),
  event: z.literal("workflow_dispatch"),
  status: z.literal("completed"),
  conclusion: z.literal("success"),
  repository,
  head_repository: repository,
});
const artifactSchema = z.object({
  id,
  name: z.string(),
  expired: z.literal(false),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  workflow_run: z.object({
    id,
    repository_id: id,
    head_repository_id: id,
    head_sha: z.string(),
  }),
});
export const evidenceSelectionSchema = z.object({
  run: z.string().regex(/^[1-9][0-9]*$/),
  attempt: z.string().regex(/^[1-9][0-9]*$/),
  artifact: z.string().regex(/^[1-9][0-9]*$/),
  artifact_digest: sha,
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  branch: z.string().min(1),
});

/** Accept one exact successful trusted dispatch, never a latest/name search or
 * a PR/fork artifact. Attempts have different immutable artifact names. */
export function verifyEvidenceArtifact(
  runRaw: unknown,
  artifactRaw: unknown,
  selection: z.infer<typeof evidenceSelectionSchema>,
) {
  const selected = evidenceSelectionSchema.parse(selection),
    run = runSchema.parse(runRaw),
    artifact = artifactSchema.parse(artifactRaw);
  invariant(
    String(run.id) === selected.run &&
      String(run.run_attempt) === selected.attempt &&
      run.head_sha === selected.commit &&
      run.head_branch === selected.branch &&
      run.path === ".github/workflows/release-evidence.yml" &&
      run.repository.full_name === selected.repository &&
      run.head_repository.full_name === selected.repository &&
      run.head_repository.id === run.repository.id,
    "EVIDENCE_RUN_UNTRUSTED",
    "Evidence must come from the exact successful release-evidence dispatch on the trusted branch and commit",
  );
  invariant(
    String(artifact.id) === selected.artifact &&
      artifact.name === `release-input-${selected.run}-${selected.attempt}` &&
      artifact.digest === `sha256:${selected.artifact_digest}` &&
      artifact.workflow_run.id === run.id &&
      artifact.workflow_run.head_sha === selected.commit &&
      artifact.workflow_run.repository_id === run.repository.id &&
      artifact.workflow_run.head_repository_id === run.repository.id,
    "EVIDENCE_ARTIFACT_UNTRUSTED",
    "Artifact ID, name, digest and workflow ownership must all match",
  );
  return {
    artifact_id: artifact.id,
    artifact_name: artifact.name,
    run: run.id,
    attempt: run.run_attempt,
  };
}
