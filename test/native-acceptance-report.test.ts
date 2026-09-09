import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finishAcceptance } from "../scripts/lib/acceptance-report.js";
import { evidenceIdentity } from "../scripts/lib/evidence.js";

test("acceptance cannot pass with incomplete work, unconfirmed shutdown, or changed tested bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acceptance-report-")),
    file = path.join(root, "evidence.json"), tested = evidenceIdentity(), prior = process.exitCode;
  try {
    fs.writeFileSync(file, JSON.stringify({ observations: [{ name: "fixture", passed: true }] }));
    assert.equal(finishAcceptance(file, tested, true, true), true);
    for (const [identity, completed, closed] of [
      [tested, false, true], [tested, true, false],
      [{ ...tested, compiled_sha256: "0".repeat(64) }, true, true],
    ] as const) {
      process.exitCode = 0;
      assert.equal(finishAcceptance(file, identity, completed, closed), false);
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.equal(saved.passed, false);
      assert.equal(saved.observations.length, 1);
      assert.equal(process.exitCode, 1);
    }
  } finally {
    process.exitCode = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
