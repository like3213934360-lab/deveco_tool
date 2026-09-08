import path from "node:path";
import { packageRoot } from "../src/core/config.js";
import { invariant } from "../src/core/errors.js";
import { readJson, prepareAdaptation, applyAdaptation, acceptAdaptation, prepareBaseline, applyBaseline, acceptBaseline, refreshBaseline } from "./lib/upstream-adaptation.js";
const [action, input, arg, output] = process.argv.slice(2);
invariant(input, "UPSTREAM_USAGE", "prepare REPOSITORY REPORT OUTPUT | apply BUNDLE PLAN | accept SOURCE EVIDENCE");
let result: unknown;
if (action === "prepare") { invariant(arg && output, "UPSTREAM_USAGE", "Provide report and new output directory"); result = await prepareAdaptation(packageRoot, path.resolve(input), readJson(path.resolve(arg)), path.resolve(output)); }
else if (action === "apply") { invariant(arg, "UPSTREAM_USAGE", "Provide bundle and plan"); result = applyAdaptation(packageRoot, path.resolve(input), readJson(path.resolve(arg))); }
else if (action === "accept") { invariant(arg, "UPSTREAM_USAGE", "Provide source and evidence manifest"); result = acceptAdaptation(packageRoot, input, readJson(path.resolve(arg))); }
else if (action === "baseline-prepare") { invariant(arg && output, "UPSTREAM_USAGE", "baseline-prepare SOURCE REPOSITORY OUTPUT"); result = await prepareBaseline(packageRoot, path.resolve(arg), input, path.resolve(output)); }
else if (action === "baseline-apply") result = applyBaseline(packageRoot, readJson(path.resolve(input)));
else if (action === "baseline-refresh") result = refreshBaseline(packageRoot, readJson(path.resolve(input)));
else if (action === "baseline-accept") { invariant(arg, "UPSTREAM_USAGE", "baseline-accept SOURCE EVIDENCE"); result = acceptBaseline(packageRoot, input, readJson(path.resolve(arg))); }
else invariant(false, "UPSTREAM_USAGE", "Unknown adaptation action");
console.log(JSON.stringify(result, null, 2));
