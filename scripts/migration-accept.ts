import path from "node:path";
import { packageRoot } from "../src/core/config.js";
import { invariant } from "../src/core/errors.js";
import { readJson } from "./lib/upstream-adaptation.js";
import { acceptMigration } from "./lib/migration-acceptance.js";
invariant(process.argv[2], "MIGRATION_USAGE", "Provide a reviewed migration acceptance plan with passing current report references");
console.log(JSON.stringify(acceptMigration(packageRoot, readJson(path.resolve(process.argv[2]))), null, 2));
