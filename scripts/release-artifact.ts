import fs from "node:fs";
import {
  evidenceSelectionSchema,
  verifyEvidenceArtifact,
} from "./lib/release-transfer.js";

const selected = evidenceSelectionSchema.parse({
  run: process.env.EVIDENCE_RUN,
  attempt: process.env.EVIDENCE_ATTEMPT,
  artifact: process.env.EVIDENCE_ARTIFACT_ID,
  artifact_digest: process.env.EVIDENCE_ARTIFACT_DIGEST,
  commit: process.env.GITHUB_SHA,
  repository: process.env.GITHUB_REPOSITORY,
  branch: process.env.TRUSTED_BRANCH,
});
console.log(
  JSON.stringify(
    verifyEvidenceArtifact(
      JSON.parse(fs.readFileSync(process.argv[2]!, "utf8")),
      JSON.parse(fs.readFileSync(process.argv[3]!, "utf8")),
      selected,
    ),
  ),
);
