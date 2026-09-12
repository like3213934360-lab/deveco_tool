import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { atomicWrite, digest } from "../src/core/files.js";
import { ToolError } from "../src/core/errors.js";
import { StateStore } from "../src/core/store.js";
import { discoverToolchain } from "../src/core/toolchain.js";
import {
  WorkflowEngine,
  type WorkflowDefinition,
} from "../src/core/workflows.js";
import { HotReloadService, sourceFiles } from "../src/services/hotreload.js";
import { Runtime } from "../src/services/runtime.js";
import { projectTargets, type Project } from "../src/services/project.js";

for (const workflow of ["native_operation", "build_deploy_verify"])
  test(`${workflow} settles fresh hot preparation rejection and never uses it to settle a lost SDK receipt`, async () => {
    const root = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "deveco-hot-preparation-")),
      ),
      store = new StateStore(path.join(root, "state")),
      model: Project = {
        root: path.join(root, "project"),
        product: {
          name: "default",
          compatibleSdkVersion: 26,
          runtimeOS: "HarmonyOS",
        },
        modules: [
          {
            name: "entry",
            root: path.join(root, "project/entry"),
            target: "default",
          },
        ],
        fingerprint: "fixture",
      },
      file = path.join(model.modules[0]!.root, "src/main/ets/Index.ets"),
      added = path.join(path.dirname(file), "Added.ets"),
      app = {
        bundle_name: "com.example.hotpreparation",
        module: "entry",
        ability: "MainAbility",
      };
    atomicWrite(file, "export const value = 1;\n");
    atomicWrite(
      path.join(model.modules[0]!.root, "src/main/module.json5"),
      JSON.stringify({ module: { type: "entry" } }),
    );
    atomicWrite(path.join(model.modules[0]!.root, "oh-package.json5"), "{}");
    atomicWrite(
      path.join(model.root, "AppScope/app.json5"),
      JSON.stringify({ app: { bundleName: app.bundle_name, versionCode: 1 } }),
    );
    let builds = 0;
    const session = {
      project: model,
      target: "owned-fixture",
      app,
      modules: model.modules,
      files: sourceFiles(model),
      patchedFiles: new Set<string>(),
      toolchain: discoverToolchain(),
      lastUsed: Date.now(),
      deviceType: "phone",
      connection: {
        connected: true,
        build: async () => {
          builds++;
          throw new ToolError(
            "CONNECTION_LOST",
            "SDK compilation response was lost",
          );
        },
      },
    };
    // Retain real read-only preparation, project/device leases and durable
    // workflow definitions. Only the active SDK session is a controlled fixture.
    const hot = Object.assign(
      Object.create(HotReloadService.prototype) as HotReloadService,
      {
        store,
        sessions: new Map([
          [
            digest([model.root, model.product.name, projectTargets(model)]),
            session,
          ],
        ]),
        assertDeviceIdle: () => {},
      },
    );
    const runtime = Object.assign(Object.create(Runtime.prototype) as Runtime, {
      store,
      hot,
      project: () => model,
      diagnostics: {
        arkts: async () => ({
          success: true,
          checked_file_count: 1,
          summary: { errorCount: 0, warnCount: 0 },
          artifact: { artifact_id: "fixture" },
        }),
      },
    });
    const definitions = (
        Reflect.get(runtime, "definitions") as () => WorkflowDefinition[]
      ).call(runtime),
      engine = new WorkflowEngine(store, definitions, async () => {}),
      node =
        workflow === "native_operation"
          ? "execute_native_operation"
          : "build_or_hot_apply",
      parameters =
        workflow === "native_operation"
          ? {
              tool: "hot_reload",
              input: { action: "apply", target: session.target },
            }
          : {
              hot_reload: true,
              sync: false,
              app,
              assert: { visible: { key: "fixture" } },
            };
    const start = () => engine.start(workflow, { parameters }).run_id;
    const finish = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        const state = await engine.status(id, 100);
        if (["failed", "needs_input", "succeeded"].includes(state.status))
          return state;
      }
      throw new Error("Hot workflow did not settle");
    };
    try {
      atomicWrite(added, "export const added = 2;\n");
      const rejected = start(),
        result = await finish(rejected);
      assert.equal(result.status, "failed");
      assert.equal(
        z.object({ code: z.string() }).parse(result.error).code,
        "COLD_DEPLOY_REQUIRED",
      );
      assert.equal(store.operationState(rejected, node), "failed");
      assert.equal(builds, 0);
      assert.equal(
        fs.existsSync(path.join(model.modules[0]!.root, "patch.json")),
        false,
      );
      fs.rmSync(added);
      atomicWrite(file, "export const value = 2;\n");
      await engine.resume(rejected);
      assert.equal((await finish(rejected)).status, "failed");
      assert.equal(
        builds,
        0,
        "Resuming a settled rejection cannot silently compile repaired input",
      );
      const uncertain = start();
      assert.equal((await finish(uncertain)).status, "needs_input");
      assert.equal(builds, 1);
      atomicWrite(added, "export const added = 3;\n");
      await engine.resume(uncertain, { action: "recheck" });
      const recovery = await finish(uncertain);
      assert.equal(recovery.status, "needs_input");
      assert.match(JSON.stringify(recovery), /COLD_DEPLOY_REQUIRED/);
      assert.equal(store.operationState(uncertain, node), "started");
      assert.equal(
        builds,
        1,
        "Recovery preparation cannot dispatch a second SDK build",
      );
    } finally {
      await engine.close();
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
