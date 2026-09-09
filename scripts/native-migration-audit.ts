import { fileURLToPath } from "node:url";
import { auditMigration } from "./lib/migration.js";

const result = auditMigration(
  fileURLToPath(new URL("../../", import.meta.url)),
);
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes("--release") && !result.release_ready)
  process.exitCode = 1;
