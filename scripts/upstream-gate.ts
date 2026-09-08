import { packageRoot } from "../src/core/config.js";
import { upstreamAcceptanceGate } from "./lib/upstream-adaptation.js";

console.log(JSON.stringify(upstreamAcceptanceGate(packageRoot)));
