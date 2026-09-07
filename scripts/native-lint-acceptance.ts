import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { discoverToolchain } from "../src/core/toolchain.js";
import { atomicWrite, readObject } from "../src/core/files.js";
import { errorResult } from "../src/core/errors.js";
import { evidenceIdentity } from "./lib/evidence.js";

const tested = evidenceIdentity(),
  root = path.resolve(z.string().min(1).parse(process.argv[2]));
assert.equal(fs.existsSync(root), false, "Use a new evidence directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const runtime = new Runtime(),
  toolchain = discoverToolchain(),
  project_path = path.join(root, "application"),
  observations: {
    name: string;
    elapsed_ms: number;
    result?: unknown;
    error?: unknown;
  }[] = [];
let failed = false;
async function observe(name: string, task: () => Promise<unknown>) {
  const started = performance.now();
  try {
    const result = await task();
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      result,
    });
    process.stdout.write(`${name}: passed\n`);
  } catch (error) {
    failed = true;
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      error: errorResult(error),
    });
    process.stdout.write(`${name}: failed\n`);
  } finally {
    atomicWrite(
      path.join(root, "evidence.json"),
      JSON.stringify(
        {
          tested,
          toolchain,
          scope:
            "Native Code Linter on an isolated generated project; explicit fixes modify this canary only. No build, signing or device acceptance.",
          observations,
        },
        null,
        2,
      ),
    );
  }
}
const reportSchema = z.object({
  summary: z.object({ issues: z.number(), errors: z.number() }),
  report: z.array(z.object({ rule: z.string() })),
  truncated: z.boolean(),
  artifact: z.object({ artifact_id: z.string() }),
});
try {
  const metadata = z
    .object({ data: z.object({ platformVersion: z.string() }) })
    .parse(readObject(path.join(toolchain.sdk, "default/sdk-pkg.json")));
  await runtime.projects.create({
    project_path,
    app_name: "LintCanary",
    bundle_name: "com.deveco.lintcanary",
    sdk_version: metadata.data.platformVersion,
  });
  const project = runtime.projects.resolve(project_path);
  await runtime.projects.sync(project);
  await observe("clean_project", async () => {
    const result = reportSchema.parse(
      await runtime.call("code_lint", { project_path }),
    );
    assert.equal(result.summary.issues, 0);
    return result;
  });
  const file = "entry/src/main/ets/LintFixture.ets",
    absolute = path.join(project_path, file),
    config_path = "lint fixture.json5";
  atomicWrite(
    path.join(project_path, config_path),
    JSON.stringify({
      files: ["**/*.ets"],
      rules: { "prefer-const": "error" },
    }),
  );
  const defects =
    "let first: number = 1;\nlet second: string = 'fixture';\nexport { first, second };\n";
  atomicWrite(absolute, defects);
  await observe("scoped_findings_and_preview_limit", async () => {
    const result = reportSchema.parse(
      await runtime.call("code_lint", {
        project_path,
        path: file,
        config_path,
        limit: 1,
      }),
    );
    assert.equal(result.summary.errors, 2);
    assert.equal(result.report.length, 1);
    assert.equal(result.report[0]?.rule, "prefer-const");
    assert.equal(result.truncated, true);
    assert.equal(fs.readFileSync(absolute, "utf8"), defects);
    return result;
  });
  await observe("explicit_fix_and_recheck", async () => {
    const fixed = await runtime.call("code_lint", {
      project_path,
      path: file,
      config_path,
      fix: true,
    });
    assert.doesNotMatch(
      fs.readFileSync(absolute, "utf8"),
      /\blet (?:first|second)/,
    );
    const after = reportSchema.parse(
      await runtime.call("code_lint", {
        project_path,
        path: file,
        config_path,
      }),
    );
    assert.equal(after.summary.issues, 0);
    return { fixed, after };
  });
  await observe("invalid_config_is_execution_failure", async () => {
    const bad = "invalid-linter.json5";
    atomicWrite(path.join(project_path, bad), "{ invalid: [");
    let captured: unknown;
    await assert.rejects(
      runtime.call("code_lint", { project_path, path: file, config_path: bad }),
      (error: unknown) => {
        const failure = errorResult(error);
        assert.equal(failure.code, "LINT_CONFIG_INVALID");
        captured = failure;
        return true;
      },
    );
    return captured;
  });
  await observe("incremental_requires_git", async () => {
    await assert.rejects(
      runtime.call("code_lint", {
        project_path,
        path: file,
        config_path,
        incremental: true,
      }),
    );
    return { rejected: true };
  });
  await observe("incremental_changed_tracked_file", async () => {
    for (const args of [
      ["init"],
      ["add", "."],
      [
        "-c",
        "user.name=Native Canary",
        "-c",
        "user.email=native-canary@example.invalid",
        "commit",
        "--no-gpg-sign",
        "-m",
        "Initialize isolated lint fixture",
      ],
    ])
      await runtime.processes.run({
        executable: "git",
        args,
        cwd: project_path,
      });
    atomicWrite(absolute, defects);
    const result = reportSchema.parse(
      await runtime.call("code_lint", {
        project_path,
        path: file,
        config_path,
        incremental: true,
      }),
    );
    assert.equal(result.summary.errors, 2);
    return result;
  });
} catch (error) {
  failed = true;
  atomicWrite(
    path.join(root, "failure.json"),
    JSON.stringify({ tested, error: errorResult(error) }, null, 2),
  );
  process.stderr.write(JSON.stringify(errorResult(error)) + "\n");
} finally {
  await runtime.close();
  if (failed) process.exitCode = 1;
}
