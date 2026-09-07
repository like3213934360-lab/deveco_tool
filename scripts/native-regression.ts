import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProcessService } from "../src/core/process.js";
import { invariant, errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { digest } from "../src/core/files.js";

const output = path.resolve(process.argv[2] ?? "");
invariant(
  process.argv[2],
  "OUTPUT_REQUIRED",
  "Provide a new evidence directory",
);
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
      args: ["--test", "--test-reporter=spec", ...tests],
      cwd: root,
    },
    {
      outputFile: path.join(output, "tests.log"),
      timeoutMs: 120000,
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
    result.exitCode === 0 && summary.fail === 0 && summary.cancelled === 0;
  fs.writeFileSync(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        identity,
        scope:
          "Native compiled regressions on this Node version and operating system; mocked SDK/device cases are not real-device acceptance",
        passed,
        ...summary,
        test_files: tests.length,
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
  fs.writeFileSync(
    path.join(output, "failure.json"),
    JSON.stringify({ identity, error: errorResult(error) }, null, 2) + "\n",
  );
  console.error(JSON.stringify(errorResult(error)));
  process.exitCode = 1;
} finally {
  await processes.close();
}
