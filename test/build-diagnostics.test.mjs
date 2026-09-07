import test from "node:test";
import assert from "node:assert/strict";
import { createBuildDiagnostics, formatBuildDiagnostics } from "../src/build-diagnostics.mjs";

test("diagnostics survive UTF-8/chunk boundaries and output tails with bounded examples", () => {
  const tracker = createBuildDiagnostics();
  const warning = Buffer.from("\x1b[33mArkTS:WARN File: /项目/Test.ets:7:8\x1b[0m\nThis API is provided since API version 26, compatible SDK version is 23.\n");
  for (const byte of warning) tracker.push("stdout", Buffer.from([byte]));
  tracker.push("stderr", "sourceMaps.json not found\n");
  tracker.push("stdout", "deprecated API\n".repeat(500));
  tracker.push("stdout", "x".repeat(300000));
  const result = tracker.finish();
  assert.equal(result.counts.sdkCompatibility, 1);
  assert.equal(result.counts.deprecatedApi, 500);
  assert.equal(result.counts.sourceMaps, 1);
  assert.ok(result.examples.length <= 10);
  assert.match(result.examples[0].location, /项目\/Test.ets:7:8/);
  assert.match(formatBuildDiagnostics(result), /separate from MCP transport failures/);
});

test("late errors and SDK risks retain locations after a flood of deprecation warnings", () => {
  const tracker = createBuildDiagnostics();
  tracker.push("stdout", "ArkTS:WARN File: /app/Old.ets:1:2\ndeprecated API\n".repeat(2000));
  tracker.push("stdout", "ArkTS:WARN File: C:\\项目\\New.ets:17:8\nThe 'fill' API is supported since SDK version 26.0.0. However, the current compatible SDK version is 6.1.0(23).\n");
  tracker.push("stderr", "Error Message: Cannot find name 'woc'. At File: /app/Border.ets:456:9\n");
  tracker.push("stderr", "/app/native.cpp:198:63: error: use of undeclared identifier 'Clamp01'\n");
  tracker.push("stdout", "sourceMaps.json not found\n[commonjs--resolver] duplicate export\n");
  const result = tracker.finish();
  assert.equal(result.counts.deprecatedApi, 2000);
  assert.equal(result.counts.compilerError, 2);
  assert.equal(result.examples[0].category, "compilerError");
  assert.equal(result.examples[0].location, "/app/Border.ets:456:9");
  assert.equal(result.examples[1].location, "/app/native.cpp:198:63");
  assert.equal(result.examples.find(x => x.category === "sdkCompatibility").location, "ArkTS:WARN File: C:\\项目\\New.ets:17:8");
  assert.deepEqual(new Set(result.examples.map(x => x.category)), new Set(["compilerError", "sdkCompatibility", "deprecatedApi", "sourceMaps", "dependencyBundling"]));
  assert.equal(result.examples.filter(x => x.category === "deprecatedApi").length, 1, "repeated warnings do not waste example slots");
});

test("standalone warnings do not inherit an unrelated source location", () => {
  const tracker = createBuildDiagnostics();
  tracker.push("stdout", "ArkTS:WARN File: /app/Foo.ets:7:8\nFunction may throw exceptions.\nArkTS:WARN Property 'sourceMapsPath' not found in 'dependency'.\n");
  assert.equal(tracker.finish().examples[0].location, null);
});
