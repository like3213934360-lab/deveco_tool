import fs from "node:fs";
import { discoverUpstream, discoverCliDependency } from "./lib/upstream-discovery.js";
const [repository, commit, output] = process.argv.slice(2);
if (!repository || !commit || !output) throw new Error("Usage: upstream-discover <official-checkout> <full-commit> <output.json>");
fs.writeFileSync(output, `${JSON.stringify(process.argv[5] === "--cli" ? discoverCliDependency(repository, commit) : discoverUpstream(repository, commit), null, 2)}\n`);
console.log(JSON.stringify({ output, status: "inventory_generated", acceptance: "pending_review_and_final_validation" }));
