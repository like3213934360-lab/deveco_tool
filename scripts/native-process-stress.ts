import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ProcessService } from "../src/core/process.js";
import { invariant } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const output = path.resolve(process.argv[2] ?? ""),
  rounds = Number(process.argv[3] ?? 20);
invariant(
  process.argv[2] && !fs.existsSync(output),
  "OUTPUT_EXISTS",
  "Provide a new evidence directory",
);
invariant(
  Number.isInteger(rounds) && rounds >= 1 && rounds <= 30,
  "ROUNDS_INVALID",
  "Use 1–30 stress rounds",
);
fs.mkdirSync(output, { recursive: true });
const identity = evidenceIdentity(),
  service = new ProcessService(),
  root = fileURLToPath(new URL("../../", import.meta.url)),
  files = [
    "native-runtime",
    "native-process-tree",
    "native-emulator",
    "native-context",
  ].map((name) => path.join(root, "dist/test", `${name}.test.js`)),
  results: {
    round: number;
    passed: boolean;
    exit_code: number | null;
    signal: string | null;
    elapsed_ms: number;
  }[] = [];
try {
  for (let round = 1; round <= rounds; round++) {
    const result = await service.run(
      {
        executable: process.execPath,
        args: ["--test", "--test-reporter=tap", ...files],
        cwd: root,
      },
      {
        allowFailure: true,
        timeoutMs: 120000,
        outputFile: path.join(output, `round-${round}.tap`),
      },
    );
    const passed =
      result.exitCode === 0 &&
      result.signal === null &&
      /^# fail 0\r?$/m.test(result.stdout) &&
      /^# skipped 0\r?$/m.test(result.stdout) &&
      /^# cancelled 0\r?$/m.test(result.stdout) &&
      /^# todo 0\r?$/m.test(result.stdout);
    const row = {
      round,
      passed,
      exit_code: result.exitCode,
      signal: result.signal,
      elapsed_ms: result.elapsedMs,
    };
    results.push(row);
    console.log(JSON.stringify(row));
    // One failing round blocks the gate; it is never erased by a later pass.
    if (!passed) break;
  }
  const after = evidenceIdentity();
  invariant(
    identity.compiled_sha256 === after.compiled_sha256 &&
      identity.package_lock_sha256 === after.package_lock_sha256,
    "TESTED_FILES_CHANGED",
    "Process implementation or tests changed during stress validation",
  );
  const passed =
    results.length === rounds && results.every((row) => row.passed);
  fs.writeFileSync(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        identity,
        scope:
          "Repeated real process ownership/session/recovery regressions; no SDK acceptance",
        requested_rounds: rounds,
        passed,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  if (!passed) {
    process.exitCode = 1;
    // A native test-child abort can lose stderr while the test runner drains
    // its IPC reporting channel. Reproduce in the runner process itself to
    // retain the OS/CRT diagnostic; this never changes the original failure.
    const diagnostics = path.join(output, "diagnostics");
    fs.mkdirSync(diagnostics);
    for (let round = 1; round <= 10; round++) {
      const result = await service.run(
        {
          executable: process.execPath,
          args: [
            "--input-type=module",
            "--test-reporter=tap",
            "--eval",
            `await import(${JSON.stringify(pathToFileURL(files[0]!).href)})`,
          ],
          cwd: root,
          env: { ...process.env, DEVECO_TEST_RECOVERY_TRACE: "1" },
        },
        {
          allowFailure: true,
          timeoutMs: 120000,
          outputFile: path.join(diagnostics, `direct-${round}.log`),
        },
      );
      const row = {
        round,
        exit_code: result.exitCode,
        signal: result.signal,
      };
      fs.writeFileSync(
        path.join(diagnostics, `direct-${round}.json`),
        JSON.stringify(row) + "\n",
      );
      if (result.exitCode !== 0 || result.signal !== null) break;
    }
  }
} finally {
  await service.close();
}
