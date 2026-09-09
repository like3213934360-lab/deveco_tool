import path from "node:path";
import { fileURLToPath } from "node:url";
import { invariant, errorResult } from "../src/core/errors.js";
import {
  prepareDistribution,
  sealDistribution,
  extractDistribution,
  verifyDistribution,
} from "./lib/distribution.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
try {
  const [action, directory, archive] = process.argv.slice(2);
  invariant(
    directory,
    "DISTRIBUTION_ARGUMENT",
    "Usage: native-distribution prepare DIR | seal DIR ZIP | extract DIR ZIP | verify DIR",
  );
  const target = path.resolve(directory);
  let result: unknown;
  if (action === "prepare") result = prepareDistribution(root, target);
  else if (action === "verify") result = verifyDistribution(target);
  else {
    invariant(archive, "DISTRIBUTION_ARGUMENT", "Provide an archive path");
    if (action === "seal")
      result = sealDistribution(
        target,
        path.resolve(archive),
        path.join(root, "package-lock.json"),
      );
    else if (action === "extract")
      result = extractDistribution(path.resolve(archive), target);
    else throw new Error("Unknown distribution action");
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify(errorResult(error)));
  process.exitCode = 1;
}
