import { packageRoot } from "../src/core/config.js";
import { verifyResources } from "./lib/resources.js";
process.stdout.write(JSON.stringify(verifyResources(packageRoot)) + "\n");
