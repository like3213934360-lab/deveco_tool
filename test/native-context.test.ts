import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { atomicWrite, readObject } from "../src/core/files.js";
import { projectTargets, type Project } from "../src/services/project.js";
import { errorResult } from "../src/core/errors.js";

test("workflow restart retains explicit module targets and request deduplication rejects a different target", async (t) => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deveco-target-context-"))),
    first = path.join(root, "first"), second = path.join(root, "second"),
    oldState = process.env.DEVECO_STATE_DIR, oldConfig = process.env.DEVECO_CONFIG;
  let runtime: Runtime | undefined;
  try {
    for (const project of [first, second]) {
      fs.cpSync(fileURLToPath(new URL("../../test/fixtures/harmony-app", import.meta.url)), project, { recursive: true });
      const file = path.join(project, "build-profile.json5"), profile = readObject(file);
      profile.modules = [{ name: "entry", srcPath: "./entry", targets: [
        { name: "default", applyToProducts: ["default"] },
        { name: "preview", applyToProducts: ["default"] },
      ] }];
      atomicWrite(file, JSON.stringify(profile));
    }
    fs.mkdirSync(path.join(root, "clt"));
    process.env.DEVECO_STATE_DIR = path.join(root, "state");
    process.env.DEVECO_CONFIG = path.join(root, "config.json");
    atomicWrite(process.env.DEVECO_CONFIG, JSON.stringify({ clt: path.join(root, "clt") }));
    runtime = new Runtime();
    const seen: { root: string; targets: Record<string, string> }[] = [];
    t.mock.method(runtime.projects, "sync", async (project: Project) => {
      seen.push({ root: project.root, targets: projectTargets(project) });
      throw new Error("Response loss at synchronization boundary");
    });
    const request = { action: "start", workflow: "project_sync", request_key: "captured-target", input: {
      project_path: first, product: "default", module_targets: { entry: "preview" }, install: false,
    } };
    const { run_id } = z.object({ run_id: z.string() }).parse(await runtime.call("workflow_run", request));
    const settle = async () => {
      for (let i = 0; i < 100; i++) {
        const result = z.object({ status: z.string() }).passthrough().parse(await runtime!.call("workflow_run", { action: "status", run_id, wait_ms: 100 }));
        if (!["queued", "running"].includes(result.status)) return result;
      }
      throw new Error("Target workflow did not settle");
    };
    assert.equal((await settle()).status, "needs_input");
    const captured = z.object({ project_path: z.literal(first), module_targets: z.record(z.string(), z.string()) }).parse(JSON.parse(runtime.store.get(run_id).input) as unknown);
    assert.deepEqual(captured.module_targets, { entry: "preview" });
    assert.equal((await runtime.close()).closed, true);
    t.mock.restoreAll();
    runtime = new Runtime();
    await runtime.call("switch_cwd", { project_path: second });
    t.mock.method(runtime.projects, "sync", async (project: Project) => {
      seen.push({ root: project.root, targets: projectTargets(project) });
      return { synchronized: true };
    });
    await runtime.call("workflow_run", { action: "resume", run_id, resume_input: { action: "recheck" } });
    const status = await settle();
    assert.equal(status.status, "succeeded", JSON.stringify(status));
    assert.deepEqual(seen, [0, 1].map(() => ({ root: first, targets: { entry: "preview" } })));
    assert.equal(z.object({ run_id: z.string() }).parse(await runtime.call("workflow_run", request)).run_id, run_id);
    await assert.rejects(runtime.call("workflow_run", { ...request, input: { ...request.input, module_targets: { entry: "default" } } }), { code: "REQUEST_KEY_CONFLICT" });
  } finally {
    await runtime?.close(); t.mock.restoreAll();
    if (oldState === undefined) delete process.env.DEVECO_STATE_DIR; else process.env.DEVECO_STATE_DIR = oldState;
    if (oldConfig === undefined) delete process.env.DEVECO_CONFIG; else process.env.DEVECO_CONFIG = oldConfig;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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
