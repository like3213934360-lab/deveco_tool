import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ProcessService } from "../src/core/process.js";
import { invariant, errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { digest } from "../src/core/files.js";

const output = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), `deveco-regression-${randomUUID()}`));
invariant(
  !fs.existsSync(output),
  "OUTPUT_EXISTS",
  "Evidence output must not already exist",
);
fs.mkdirSync(output, { recursive: true });
const root = fileURLToPath(new URL("../../", import.meta.url)),
  identity = evidenceIdentity(),
  processes = new ProcessService(),
  tests = fs
    .readdirSync(path.join(root, "dist/test"))
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => path.join(root, "dist/test", name));
// Windows process-ownership checks invoke real native enumeration. Bound their
// parallel pressure and give the complete suite its own deadline; individual
// process/recovery deadlines and performance acceptance remain unchanged.
const execution = {
  timeout_ms: process.platform === "win32" ? 600000 : 120000,
  concurrency: process.platform === "win32" ? 2 : "node-default",
};
const started = performance.now();
fs.writeFileSync(
  path.join(output, "identity.json"),
  JSON.stringify(identity, null, 2) + "\n",
);
try {
  invariant(
    tests.length > 0,
    "TESTS_MISSING",
    "No compiled native tests found",
  );
  const result = await processes.run(
    {
      executable: process.execPath,
      args: [
        "--test",
        ...(process.platform === "win32" ? ["--test-concurrency=2"] : []),
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        "--test-reporter=tap",
        `--test-reporter-destination=${path.join(output, "tests.tap")}`,
        ...tests,
      ],
      cwd: root,
    },
    {
      outputFile: path.join(output, "tests.log"),
      timeoutMs: execution.timeout_ms,
      allowFailure: true,
    },
  );
  const after = evidenceIdentity(),
    unchanged = [
      "compiled_sha256",
      "runtime_sha256",
      "package_lock_sha256",
      "resource_manifest_sha256",
      "upstream_lock_sha256",
    ] as const;
  invariant(
    unchanged.every((key) => identity[key] === after[key]) &&
      digest(identity.resources) === digest(after.resources),
    "TESTED_FILES_CHANGED",
    "Runtime, tests, dependencies or resources changed during regression",
  );
  const summary = Object.fromEntries(
    ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((key) => [
      key,
      Number(
        new RegExp(`(?:^|\\n).*?\\b${key} (\\d+)(?:\\r?\\n|$)`).exec(
          result.stdout,
        )?.[1] ?? NaN,
      ),
    ]),
  );
  invariant(
    Object.values(summary).every(Number.isSafeInteger),
    "TEST_SUMMARY_MISSING",
    "Node did not return a complete regression summary",
  );
  const passed =
    result.exitCode === 0 &&
    summary.fail === 0 &&
    summary.cancelled === 0 &&
    summary.skipped === 0 &&
    summary.todo === 0;
  fs.writeFileSync(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        identity,
        execution,
        scope:
          "Native compiled regressions on this Node version and operating system; mocked SDK/device cases are not real-device acceptance",
        passed,
        ...summary,
        test_files: tests.length,
        executed_tests: tests.map((file) => path.relative(root, file).split(path.sep).join("/")),
        elapsed_ms: result.elapsedMs,
        exit_code: result.exitCode,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      output,
      node: process.version,
      platform: process.platform,
      passed,
      ...summary,
    }),
  );
  if (!passed) process.exitCode = 1;
} catch (error) {
  const failure = {
    identity,
    execution,
    passed: false,
    requested_tests: tests.map((file) => path.relative(root, file).split(path.sep).join("/")),
    elapsed_ms: performance.now() - started,
    error: errorResult(error),
  };
  fs.writeFileSync(
    path.join(output, "failure.json"),
    JSON.stringify(failure, null, 2) + "\n",
  );
  fs.writeFileSync(path.join(output, "evidence.json"), JSON.stringify(failure, null, 2) + "\n");
  console.error(JSON.stringify(errorResult(error)));
  process.exitCode = 1;
} finally {
  await processes.close();
}
