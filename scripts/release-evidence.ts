import path from "node:path";
import { packageRoot } from "../src/core/config.js";
import { invariant } from "../src/core/errors.js";
import { prepareEvidence, extractEvidence } from "./lib/release-evidence.js";
import { encryptEvidence, decryptEvidence } from "./lib/release-transfer.js";

const [action, input, output, sha, plaintextSha] = process.argv.slice(2);
invariant(input && output, "EVIDENCE_USAGE", "prepare RELEASE_JSON NEW_ZIP | extract ZIP NEW_DIRECTORY SHA256");
let result: unknown;
if (action === "prepare") result = prepareEvidence(packageRoot, path.resolve(input), path.resolve(output));
else if (action === "encrypt") {
  invariant(sha, "EVIDENCE_USAGE", "encrypt ZIP NEW_ENCRYPTED ZIP_SHA256; key comes from RELEASE_EVIDENCE_KEY");
  result = encryptEvidence(path.resolve(input), path.resolve(output), sha, process.env.RELEASE_EVIDENCE_KEY);
} else if (action === "decrypt") {
  invariant(sha && plaintextSha, "EVIDENCE_USAGE", "decrypt ENCRYPTED NEW_ZIP TRANSFER_SHA256 ZIP_SHA256; key comes from RELEASE_EVIDENCE_KEY");
  result = decryptEvidence(path.resolve(input), path.resolve(output), sha, plaintextSha, process.env.RELEASE_EVIDENCE_KEY);
}
else {
  invariant(action === "extract" && sha, "EVIDENCE_USAGE", "extract requires the expected SHA-256");
  result = extractEvidence(path.resolve(input), path.resolve(output), sha);
}
console.log(JSON.stringify(result));
