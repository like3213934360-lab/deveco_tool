import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";
import { WorkflowEngine, type StepContext } from "../src/core/workflows.js";
import { atomicWrite } from "../src/core/files.js";
import { ProjectService } from "../src/services/project.js";
import type { Toolchain } from "../src/core/toolchain.js";

for (const phase of ["ohpm", "sync", "build", "rejected-build"]) {
  test(`project ${phase} response loss preserves command results and resumes fixed phases once`, async (t) => {
    const root = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "deveco-project-recovery-")),
      ),
      sdk = path.join(root, "sdk"),
      tool = fileURLToPath(
        new URL("./fixtures/native-project-command.js", import.meta.url),
      ),
      toolchain: Toolchain = {
        root,
        sdk,
        kind: "studio",
        version: "fixture",
        versions: {},
        fingerprint: "fixture",
        components: { node: process.execPath, ohpm: tool, hvigor: tool },
      };
    atomicWrite(
      path.join(sdk, "default/sdk-pkg.json"),
      JSON.stringify({
        data: {
          apiVersion: "26",
          platformVersion: "26.0.0",
          version: "26.0.0.105",
        },
      }),
    );
    let store = new StateStore(path.join(root, "state")),
      processes = new ProcessService(new PersistentProcessObserver(store)),
      projects = new ProjectService(processes, () => toolchain, store),
      engine: WorkflowEngine | undefined;
    try {
      const project = await projects.create({
        project_path: path.join(root, "application"),
        app_name: "Recovery",
        bundle_name: "com.deveco.recovery",
        sdk_version: "26",
      });
      if (phase === "rejected-build")
        atomicWrite(path.join(project.root, "reject-build"), "reject");
      const definitions = () => [
        {
          id: "project",
          description: "Project command recovery",
          capabilities: [],
          completion: "Project build completed",
          resources: () => ["project:" + project.root],
          steps: [
            {
              id: "sync",
              kind: "effect" as const,
              execute: (call: StepContext) =>
                projects.sync(project, true, call.signal),
              reconcile: (call: StepContext) =>
                projects.sync(project, true, call.signal),
            },
            {
              id: "build",
              kind: "effect" as const,
              execute: (call: StepContext) =>
                projects.build(project, {}, call.signal),
              reconcile: (call: StepContext) =>
                projects.build(project, {}, call.signal),
            },
          ],
        },
      ];
      let loseResponse = true;
      const original = processes.run.bind(processes);
      t.mock.method(
        processes,
        "run",
        async (
          command: Parameters<typeof original>[0],
          options: Parameters<typeof original>[1],
        ) => {
          const actual = command.args.includes("install")
            ? "ohpm"
            : command.args.includes("--sync")
              ? "sync"
              : "build";
          try {
            return await original(command, options);
          } finally {
            if (loseResponse && actual === phase.replace("rejected-", "")) {
              loseResponse = false;
              throw new Error(
                "Response lost after the command completion was persisted",
              );
            }
          }
        },
      );
      engine = new WorkflowEngine(store, definitions(), async () => {});
      const { run_id } = engine.start("project", { parameters: {} });
      const settle = async () => {
        for (let i = 0; i < 200; i++) {
          const status = await engine!.status(run_id, 100);
          if (!["queued", "running"].includes(status.status)) return status;
        }
        throw new Error("Project recovery did not settle");
      };
      assert.equal((await settle()).status, "needs_input");
      await engine.close();
      await processes.close();
      store.close();
      t.mock.restoreAll();
      store = new StateStore(path.join(root, "state"));
      processes = new ProcessService(new PersistentProcessObserver(store));
      projects = new ProjectService(processes, () => toolchain, store);
      engine = new WorkflowEngine(store, definitions(), async () => {});
      await engine.resume(run_id, { action: "recheck" });
      const result = await settle();
      assert.equal(
        result.status,
        phase === "rejected-build" ? "failed" : "succeeded",
        JSON.stringify(result),
      );
      for (const name of ["ohpm", "sync", "build"])
        assert.equal(
          fs.readFileSync(path.join(project.root, name + ".count"), "utf8"),
          "x",
        );
      assert.deepEqual(store.uncertainOperations(run_id), []);
      if (phase === "rejected-build") {
        const failure = store.get(run_id).error ?? "";
        assert.match(failure, /PROJECT_BUILD_FAILED/);
        assert.match(failure, /fixture compiler rejection/);
        assert.ok(
          failure.length < 20000,
          "Large compiler output stays in an artifact",
        );
      } else assert.equal(projects.buildArtifacts(project).length, 1);
    } finally {
      await engine?.close();
      await processes.close();
      store.close();
      t.mock.restoreAll();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
