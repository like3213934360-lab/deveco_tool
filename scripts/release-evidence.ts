import path from "node:path";
import { packageRoot } from "../src/core/config.js";
import { invariant } from "../src/core/errors.js";
import { prepareEvidence, extractEvidence } from "./lib/release-evidence.js";

const [action, input, output, sha] = process.argv.slice(2);
invariant(input && output, "EVIDENCE_USAGE", "prepare RELEASE_JSON NEW_ZIP | extract ZIP NEW_DIRECTORY SHA256");
let result: unknown;
if (action === "prepare") result = prepareEvidence(packageRoot, path.resolve(input), path.resolve(output));
else {
  invariant(action === "extract" && sha, "EVIDENCE_USAGE", "extract requires the expected SHA-256");
  result = extractEvidence(path.resolve(input), path.resolve(output), sha);
}
console.log(JSON.stringify(result));
