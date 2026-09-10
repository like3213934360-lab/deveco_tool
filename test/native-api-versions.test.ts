import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apiVersions, DiagnosticService } from "../src/services/diagnostics.js";
import { ToolError } from "../src/core/errors.js";
import { ProcessService } from "../src/core/process.js";
import { StateStore } from "../src/core/store.js";
import type { Project } from "../src/services/project.js";

test("API compatibility rejects unknown, reversed, equal and conflicting scopes before starting SDK processes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-api-input-"));
  const store = new StateStore(root), processes = new ProcessService();
  const diagnostics = new DiagnosticService(processes, store);
  const versions = ["HarmonyOS_5.0.0(12)_Release", "HarmonyOS_6.0.0(20)_Beta2", "HarmonyOS_6.0.0(20)_Release", "HarmonyOS_26.0.0(26)_Release"];
  t.mock.method(diagnostics, "versions", () => versions);
  const run = t.mock.method(processes, "run", async () => { throw new Error("Unexpected SDK process"); });
  try {
    for (const [source, target, code] of [["missing", versions[3]!, "API_VERSION_INVALID"], [versions[3]!, versions[0]!, "API_VERSION_ORDER"], [versions[1]!, versions[1]!, "API_VERSION_ORDER"]])
      await assert.rejects(diagnostics.compatibility({ root } as Project, { source_version: source!, target_version: target! }), { code });
    await assert.rejects(diagnostics.compatibility({ root } as Project, {
      source_version: versions[1]!, target_version: versions[2]!, files: ["file.ets"], modules: ["entry"],
    }), { code: "API_SCOPE_CONFLICT" });
    assert.equal(run.mock.callCount(), 0);
  } finally {
    await diagnostics.lsp.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("API version catalog requires real change data and orders beta/release versions numerically", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-api-versions-")),
    scanner = path.join(root, "api-change-scan.js"),
    directory = path.join(root, "resources/apiChange");
  const error = (code: string) => (value: unknown) =>
    value instanceof ToolError && value.code === code;
  try {
    assert.throws(
      () => apiVersions(scanner),
      error("API_VERSION_DATA_MISSING"),
    );
    fs.mkdirSync(directory, { recursive: true });
    assert.throws(() => apiVersions(scanner), error("API_VERSION_DATA_EMPTY"));
    for (const version of [
      "HarmonyOS_6.0.0(20)_Beta10",
      "HarmonyOS_6.0.0(20)_Beta2",
      "HarmonyOS_6.0.0(20)_Release",
      "HarmonyOS_26.0.0(26)_Release",
    ])
      fs.writeFileSync(path.join(directory, `${version}.json`), "[]");
    assert.deepEqual(apiVersions(scanner), [
      "HarmonyOS_5.0.0(12)_Release",
      "HarmonyOS_6.0.0(20)_Beta2",
      "HarmonyOS_6.0.0(20)_Beta10",
      "HarmonyOS_6.0.0(20)_Release",
      "HarmonyOS_26.0.0(26)_Release",
    ]);
    fs.writeFileSync(path.join(directory, "unrecognized.json"), "[]");
    assert.throws(
      () => apiVersions(scanner),
      error("API_VERSION_DATA_INVALID"),
    );
    fs.rmSync(path.join(directory, "unrecognized.json"));
    fs.writeFileSync(
      path.join(directory, "HarmonyOS_6.0.0(20)_Beta2.json"),
      "",
    );
    assert.throws(
      () => apiVersions(scanner),
      error("API_VERSION_DATA_INVALID"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
