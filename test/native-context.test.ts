import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { atomicWrite } from "../src/core/files.js";
import type { Project } from "../src/services/project.js";
import { errorResult } from "../src/core/errors.js";

test("doctor follows selected projects while submitted diagnostic workflows retain their captured project", async (t) => {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-context-中文 空格-")),
    ),
    oldState = process.env.DEVECO_STATE_DIR,
    oldConfig = process.env.DEVECO_CONFIG,
    first = path.join(root, "first"),
    second = path.join(root, "second"),
    alias = path.join(root, "alias"),
    config = path.join(root, "config.json");
  for (const project of [first, second])
    await fs.promises.cp(
      fileURLToPath(
        new URL("../../test/fixtures/harmony-app", import.meta.url),
      ),
      project,
      { recursive: true },
    );
  for (const project of [first, second])
    assert.ok(
      fs.statSync(path.join(project, "build-profile.json5")).isFile(),
      "The fixture copy must finish before aliases or the runtime are created",
    );
  fs.symlinkSync(first, alias, "junction");
  const sdkRoot = path.join(root, "clt");
  fs.mkdirSync(sdkRoot);
  atomicWrite(config, JSON.stringify({ clt: sdkRoot }));
  process.env.DEVECO_STATE_DIR = path.join(root, "state");
  process.env.DEVECO_CONFIG = config;
  const runtime = new Runtime(),
    observed: string[] = [],
    started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  t.mock.method(runtime.diagnostics, "arkts", async (project: Project) => {
    observed.push(project.root);
    started.resolve();
    await release.promise;
    return {
      checkKind: "static-precheck",
      compilationVerified: false,
      success: true,
      diagnostics: [],
      summary: { errorCount: 0, warnCount: 0 },
    };
  });
  let stage = "doctor-empty";
  try {
    assert.equal(
      z
        .object({ project: z.null() })
        .parse(await runtime.call("deveco_doctor", {})).project,
      null,
    );
    stage = "switch-alias";
    assert.deepEqual(
      await runtime.call("switch_cwd", { project_path: alias }),
      { project_path: first },
    );
    assert.equal(
      z
        .object({ project: z.object({ root: z.string() }) })
        .parse(await runtime.call("deveco_doctor", {})).project.root,
      first,
    );
    stage = "submit-workflow";
    const run = z.object({ run_id: z.string() }).parse(
      await runtime.call("workflow_run", {
        action: "start",
        workflow: "code_diagnose",
        input: { checks: ["arkts"] },
        request_key: "captured-project",
      }),
    );
    const deadline = setTimeout(
      () => started.reject(new Error("Diagnostic workflow did not start")),
      10000,
    );
    try {
      await started.promise;
    } finally {
      clearTimeout(deadline);
    }
    stage = "switch-second";
    await runtime.call("switch_cwd", { project_path: second });
    assert.equal(
      z
        .object({ project: z.object({ root: z.string() }) })
        .parse(await runtime.call("deveco_doctor", {})).project.root,
      second,
    );
    assert.equal(
      z
        .object({ project_path: z.string() })
        .parse(JSON.parse(runtime.store.get(run.run_id).input) as unknown)
        .project_path,
      first,
    );
    release.resolve();
    let status = "running";
    for (
      let i = 0;
      i < 50 && !["succeeded", "failed", "needs_input"].includes(status);
      i++
    )
      status = z.object({ status: z.string() }).parse(
        await runtime.call("workflow_run", {
          action: "status",
          run_id: run.run_id,
          wait_ms: 100,
        }),
      ).status;
    assert.equal(status, "succeeded");
    assert.deepEqual(observed, [first]);
    stage = "remove-second";
    fs.rmSync(second, { recursive: true });
    const failed = z
      .object({ project: z.object({ error: z.object({ code: z.string() }) }) })
      .parse(await runtime.call("deveco_doctor", {}));
    assert.ok(failed.project.error.code);
    assert.equal(
      z
        .object({ project: z.object({ root: z.string() }) })
        .parse(await runtime.call("deveco_doctor", { project_path: first }))
        .project.root,
      first,
    );
  } catch (error) {
    const observe = (read: () => unknown) => {
      try {
        return read();
      } catch (failure) {
        return { error: errorResult(failure) };
      }
    };
    t.diagnostic(
      JSON.stringify({
        stage,
        error: errorResult(error),
        paths: [root, first, second, alias].map((file) => ({
          file,
          stat: observe(() => {
            const s = fs.lstatSync(file);
            return { directory: s.isDirectory(), link: s.isSymbolicLink() };
          }),
          target: observe(() => fs.readlinkSync(file)),
          native: observe(() => fs.realpathSync.native(file)),
          javascript: observe(() => fs.realpathSync(file)),
          entries: observe(() => fs.readdirSync(file)),
        })),
      }),
    );
    throw error;
  } finally {
    release.resolve();
    await runtime.close();
    if (oldState === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = oldState;
    if (oldConfig === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = oldConfig;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
