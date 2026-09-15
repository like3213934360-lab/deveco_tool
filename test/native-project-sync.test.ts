import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/core/store.js";
import { WorkflowEngine, type StepContext } from "../src/core/workflows.js";
import { workflowInputs } from "../src/core/contracts.js";
import { atomicWrite, digest } from "../src/core/files.js";
import { ToolError } from "../src/core/errors.js";
import { ProcessService } from "../src/core/process.js";
import type { Toolchain } from "../src/core/toolchain.js";
import { inspectProject, ProjectService } from "../src/services/project.js";
import {
  captureSyncReceipt,
  synchronizeProject,
  type SyncPolicy,
} from "../src/services/project-sync.js";

function fixture() {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-auto-sync-")),
    ),
    projectRoot = path.join(root, "app"),
    store = new StateStore(path.join(root, "state")),
    processes = new ProcessService(),
    projects = new ProjectService(processes);
  fs.cpSync(
    new URL("../../test/fixtures/harmony-app/", import.meta.url),
    projectRoot,
    { recursive: true },
  );
  const write = (relative: string, text: string) =>
    atomicWrite(path.join(projectRoot, relative), text);
  const repair = () => {
    write(
      "oh_modules/@ohos/hypium/oh-package.json5",
      '{"name":"@ohos/hypium","version":"1.0.25"}',
    );
    write(
      "oh_modules/@ohos/hamock/oh-package.json5",
      '{"name":"@ohos/hamock","version":"1.0.0"}',
    );
    write("oh-package-lock.json5", '{"lockfileVersion":3,"fixture":true}');
    write(
      ".hvigor/outputs/sync/output.json",
      JSON.stringify({
        "ohos-project": { SELECT_PRODUCT_NAME: "default" },
        "ohos-module-entry": { TARGETS: { default: {} } },
      }),
    );
  };
  repair();
  const toolchain: Toolchain = {
    root: "/fixture/studio",
    kind: "studio",
    sdk: "/fixture/sdk",
    version: "1",
    versions: {},
    fingerprint: "sdk-original",
    components: {},
  };
  const capture = () => {
    const project = inspectProject(projectRoot);
    return captureSyncReceipt(
      project,
      () => toolchain,
      () => projects.model(project),
    );
  };
  return {
    root,
    projectRoot,
    store,
    toolchain,
    write,
    repair,
    capture,
    async close() {
      await processes.close();
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("sync identity ignores stock ArkTS implementation edits, but checks dependency bytes, locks, model, config and SDK", async () => {
  const f = fixture();
  try {
    const original = f.capture();
    assert.equal(original.available, true, JSON.stringify(original));
    const identity = () => {
      const state = f.capture();
      assert.equal(state.available, true, JSON.stringify(state));
      return digest(state);
    };
    const first = identity();
    f.write("entry/src/main/ets/pages/Index.ets", "// modified source\n");
    assert.equal(identity(), first);
    for (const [file, value] of [
      ["oh_modules/@ohos/hypium/runtime.js", "module.exports='original'"],
      ["oh_modules/@ohos/hypium/runtime.js", "module.exports='modified'"],
      ["oh-package-lock.json5", '{"lockfileVersion":3,"fixture":"changed"}'],
      [
        "entry/build-profile.json5",
        '{"apiType":"stageMode","targets":[{"name":"default"}],"buildOption":{"fixture":true}}',
      ],
    ]) {
      const before = identity();
      f.write(file!, value!);
      assert.notEqual(identity(), before, file);
    }
    const beforeSdk = identity();
    f.toolchain.fingerprint = "sdk-changed";
    assert.notEqual(identity(), beforeSdk);
    f.write(
      ".hvigor/outputs/sync/output.json",
      '{"ohos-project":{"SELECT_PRODUCT_NAME":"different"}}',
    );
    const model = f.capture();
    assert.equal(model.available, false);
    if (!model.available)
      assert.equal(model.reason.code, "SYNC_MODEL_PRODUCT_MISMATCH");
    f.repair();
    fs.rmSync(path.join(f.projectRoot, "oh_modules/@ohos/hypium"), {
      recursive: true,
    });
    const missing = f.capture();
    assert.equal(missing.available, false);
    if (!missing.available)
      assert.equal(missing.reason.code, "SYNC_DEPENDENCY_MISSING");
    f.repair();
    const external = path.join(f.root, "external");
    fs.mkdirSync(external);
    atomicWrite(path.join(external, "runtime.js"), "one");
    fs.symlinkSync(external, path.join(f.projectRoot, "oh_modules/external"));
    const beforeLink = identity();
    atomicWrite(path.join(external, "runtime.js"), "two");
    assert.notEqual(identity(), beforeLink);
    f.write(
      "hvigorfile.ts",
      "import { appTasks } from '@ohos/hvigor-ohos-plugin';\nprocess.env.EXTRA = 'custom';\nexport default {system:appTasks,plugins:[]};",
    );
    const custom = f.capture();
    assert.equal(custom.available, false);
    if (!custom.available)
      assert.equal(custom.reason.code, "SYNC_CUSTOM_TASKS");
  } finally {
    await f.close();
  }
});

test("durable auto sync reuses a retained matching native sync, retains its proof, and repairs changed/missing dependencies", async () => {
  const f = fixture();
  let syncs = 0;
  const execute = async (call: StepContext, recovering = false) =>
    synchronizeProject({
      store: f.store,
      run_id: call.run_id,
      project: inspectProject(f.projectRoot),
      policy: call.context.parameters.sync as SyncPolicy,
      recovering,
      capture: f.capture,
      synchronize: async () => {
        syncs++;
        f.repair();
        return { synced: true };
      },
    });
  const engine = new WorkflowEngine(
    f.store,
    [
      {
        id: "project_build",
        description: "sync fixture",
        capabilities: [],
        completion: "synced",
        resources: () => [`project:${f.projectRoot}`],
        steps: [
          {
            id: "sync_project",
            kind: "effect",
            execute,
            reconcile: (call) => execute(call, true),
          },
        ],
      },
    ],
    async () => {},
  );
  const run = async (sync: SyncPolicy) => {
    const { run_id } = engine.start("project_build", {
      project_path: f.projectRoot,
      parameters: { sync },
    });
    const result = await engine.status(run_id, 20000);
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    return {
      id: run_id,
      result: result.result as {
        sync_project: {
          skipped: boolean;
          sync_receipt: unknown;
          reused_run_id?: string;
        };
      },
    };
  };
  try {
    const first = await run("auto");
    assert.equal(syncs, 1);
    f.write("entry/src/main/ets/pages/Index.ets", "// changed source\n");
    const second = await run("auto");
    assert.equal(syncs, 1);
    assert.equal(second.result.sync_project.skipped, true);
    assert.equal(second.result.sync_project.reused_run_id, first.id);
    assert.ok(
      f.store.db
        .prepare(
          "SELECT 1 FROM run_dependencies WHERE parent_run_id=? AND run_id=?",
        )
        .get(second.id, first.id),
    );
    await run(true);
    assert.equal(syncs, 2);
    await run("force");
    assert.equal(syncs, 3);
    fs.rmSync(path.join(f.projectRoot, "oh_modules/@ohos/hypium"), {
      recursive: true,
    });
    await run(false);
    assert.equal(syncs, 3);
    await run("skip");
    assert.equal(syncs, 3);
    await run("auto");
    assert.equal(syncs, 4);
    const rootScript = fs.readFileSync(
      path.join(f.projectRoot, "hvigorfile.ts"),
      "utf8",
    );
    f.write("hvigorfile.ts", rootScript + "\nconsole.log('custom');\n");
    await run("auto");
    await run("auto");
    assert.equal(syncs, 6);
  } finally {
    await engine.close();
    await f.close();
  }
});

test("sync recovery cannot use another run to skip reconciliation or create a new receipt; install=false is not install proof", async () => {
  const f = fixture(),
    run = f.store.create("project_sync", {}).run;
  let calls = 0;
  const options = {
    store: f.store,
    run_id: run.id,
    project: inspectProject(f.projectRoot),
    policy: "auto" as const,
    capture: f.capture,
    synchronize: async () => {
      calls++;
      return { synced: true };
    },
  };
  try {
    const recovered = await synchronizeProject({
      ...options,
      recovering: true,
    });
    assert.equal(calls, 1);
    assert.equal(recovered.skipped, false);
    assert.equal(recovered.sync_receipt, null);
    const noInstall = await synchronizeProject({
      ...options,
      policy: "force",
      install: false,
    });
    assert.equal(calls, 2);
    assert.equal(noInstall.sync_receipt, null);
    const uncertain = new ToolError(
      "EFFECT_UNCERTAIN",
      "original native sync needs reconciliation",
    );
    await assert.rejects(
      synchronizeProject({
        ...options,
        recovering: true,
        synchronize: async () => {
          throw uncertain;
        },
      }),
      (error) => error === uncertain,
    );
    assert.equal(workflowInputs.project_build.parse({}).sync, "auto");
    assert.equal(workflowInputs.project_build.parse({ sync: true }).sync, true);
    for (const sync of ["auto", "force", "skip", true, false])
      assert.equal(
        workflowInputs.project_build.safeParse({ sync }).success,
        true,
      );
    assert.equal(
      workflowInputs.project_build.safeParse({ sync: "occasionally" }).success,
      false,
    );
  } finally {
    await f.close();
  }
});
