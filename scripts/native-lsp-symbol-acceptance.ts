import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Runtime } from "../src/services/runtime.js";
import { atomicWrite } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { acceptLanguageSymbols, acceptCppSymbols } from "./lib/lsp-symbols.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";

const root = path.resolve(process.argv[2] ?? ""),
  project = process.argv[3];
assert.ok(
  project && process.argv[2],
  "Provide a new evidence directory and an isolated existing acceptance project",
);
assert.equal(fs.existsSync(root), false, "Evidence directory must be new");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const runtime = new Runtime(),
  tested = evidenceIdentity();
let completed = false;
try {
  const result = {
    arkts: await acceptLanguageSymbols(runtime, path.resolve(project)),
    cpp: await acceptCppSymbols(runtime, path.resolve(project)),
  };
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify({ result }, null, 2),
  );
  completed = true;
} catch (error) {
  atomicWrite(
    path.join(root, "evidence.json"),
    JSON.stringify({ error: errorResult(error) }, null, 2),
  );
} finally {
  const closed = await runtime.close();
  const passed = finishAcceptance(
    path.join(root, "evidence.json"),
    tested,
    completed,
    closed.closed,
  );
  process.stdout.write(
    `LSP symbol SDK acceptance: ${passed ? "passed" : "failed"}\n`,
  );
}
