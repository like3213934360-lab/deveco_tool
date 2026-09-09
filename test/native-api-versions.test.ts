import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apiVersions } from "../src/services/diagnostics.js";
import { ToolError } from "../src/core/errors.js";
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
