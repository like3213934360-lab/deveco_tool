import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildProject, runDevecoCli } from "../src/deveco-cli.mjs";

async function fixture(t, script) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-output-中文 空格-"));
  const entry = path.join(directory, "cli.mjs");
  await fs.writeFile(entry, script);
  const previous = process.env.DEVECO_CLI_ENTRY;
  process.env.DEVECO_CLI_ENTRY = entry;
  t.after(async () => {
    if (previous === undefined) delete process.env.DEVECO_CLI_ENTRY; else process.env.DEVECO_CLI_ENTRY = previous;
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("abrupt CLI failure drains both large pipes and preserves late compiler errors", async t => {
  const directory = await fixture(t, `
    const warnings = 'ArkTS:WARN File: /app/Old.ets:1:2\\ndeprecated API\\n'.repeat(40000);
    console.log(warnings + 'STDOUT_END');
    console.error(warnings + "Error Message: Cannot find name 'woc'. At File: /app/Border.ets:456:9\\nSTDERR_END");
    process.exit(255);
  `);
  const file = path.join(directory, "full.log");
  const result = await runDevecoCli(["build"], { cwd: directory, logPath: file, timeoutMs: 10000 });
  assert.equal(result.exitCode, 255);
  assert.equal(result.outputDrain, "drained");
  const full = await fs.readFile(file, "utf8");
  assert.match(full, /STDOUT_END/);
  assert.match(full, /STDERR_END/);
  assert.match(full, /Cannot find name 'woc'/);
  assert.equal(result.diagnostics.counts.deprecatedApi, 80000);
  assert.equal(result.diagnostics.examples[0].location, "/app/Border.ets:456:9");
  assert.equal(result.outputTruncated, true, "only the bounded response tail may be truncated");
  await assert.rejects(buildProject({ project_path: directory, log_path: file }), error => {
    assert.match(error.message, /compilerError/);
    assert.match(error.message, /Border.ets:456:9/);
    assert.match(error.message, /CLI stream drain: drained/);
    return error.code === "DEVECO_CLI_BUILD_FAILED";
  });
});

test("failure logs survive without an explicit path and successful natural exits remain successful", async t => {
  const directory = await fixture(t, "console.error('Error Message: Invalid component. At File: /app/Test.ets:9:2'); process.exit(1);");
  const result = await runDevecoCli(["build"], { cwd: directory, timeoutMs: 5000 });
  t.after(() => fs.rm(result.logPath, { force: true }));
  assert.equal(result.outputTruncated, false);
  assert.match(await fs.readFile(result.logPath, "utf8"), /Invalid component/);
  await fs.writeFile(process.env.DEVECO_CLI_ENTRY, "console.log('Build completed successfully.');");
  const success = await runDevecoCli(["build"], { cwd: directory });
  assert.equal(success.exitCode, 0);
  assert.equal(success.outputDrain, "natural");
  assert.equal(success.logPath, null);
});

test("stalled output drain is bounded and cannot report build success", async t => {
  const directory = await fixture(t, "console.log('Build completed successfully.'); process.stdout.write = () => false; process.exit(0);");
  const result = await runDevecoCli(["build"], { cwd: directory, timeoutMs: 5000 });
  t.after(() => fs.rm(result.logPath, { force: true }));
  assert.equal(result.exitCode, 0, "preserve the original requested status");
  assert.equal(result.outputDrain, "timeout");
  assert.ok(result.logPath, "even exit-zero drain failure keeps its log");
  const { devecoCliFailureMessage } = await import("../src/deveco-cli.mjs");
  assert.match(devecoCliFailureMessage(result), /diagnostics may be incomplete/);
});
