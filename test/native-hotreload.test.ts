import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { HvigorSession } from "../src/services/hvigor/session.js";
import { BuildReceipts } from "../src/services/hvigor/receipts.js";
import {
  HotConfiguration,
  hotPaths,
  assertNoHotWatch,
} from "../src/services/hvigor/hot-config.js";
import type { BuildOptions } from "../src/services/hvigor/protocol.js";
import { ProcessService } from "../src/core/process.js";
import { ProjectService, type Project } from "../src/services/project.js";
import { StateStore } from "../src/core/store.js";
import {
  sourceFiles,
  assertHotSourcesUnchanged,
  hotBaselineTasks,
  hotBaselinePackages,
  hotChanges,
  nextHotPatchVersion,
} from "../src/services/hotreload.js";

test("watch baseline carries entry, feature and required HSP together and rejects incomplete or mismatched outputs", async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deveco-hot-packages-"))),
    processes = new ProcessService(), projects = new ProjectService(processes), model = project(root),
    app = { bundle_name: "com.example.hotmodules", module: "entry", ability: "EntryAbility" };
  const types: Record<string, string> = { entry: "entry", feature: "feature", shared: "shared", library: "har" };
  model.modules = Object.keys(types).map((name) => ({ name, root: path.join(root, name), target: "preview" }));
  const writePackage = (name: string, actualName = name) => {
    const file = path.join(root, name, `${name}-signed.${name === "shared" ? "hsp" : "hap"}`), zip = new AdmZip();
    zip.addFile("module.json", Buffer.from(JSON.stringify({
      app: { bundleName: app.bundle_name, versionCode: 1, versionName: "1.0.0" },
      module: { name: actualName, type: types[name], abilities: name === "shared" ? [] : [{ name: app.ability }],
        dependencies: name === "shared" ? [] : [{ moduleName: "shared" }] },
    })));
    zip.writeZip(file);
    return file;
  };
  try {
    for (const module of model.modules) {
      fs.mkdirSync(path.join(module.root, "src/main"), { recursive: true });
      fs.writeFileSync(path.join(module.root, "src/main/module.json5"), JSON.stringify({ module: { type: types[module.name] } }));
      fs.writeFileSync(path.join(module.root, "oh-package.json5"), JSON.stringify({ dependencies: module.name === "library" ? {} : { library: "file:../library" } }));
    }
    const runnable = model.modules.filter((module) => module.name !== "library");
    const files = new Map(runnable.map((module) => [module.root, writePackage(module.name)]));
    projects.buildArtifacts = (_project, roots, task) => roots!.flatMap((root) => {
      const file = files.get(root)!;
      assert.equal(task, file.endsWith(".hsp") ? "assembleHsp" : "assembleHap");
      return [{ path: file, bytes: fs.statSync(file).size, sha256: "fixture" }];
    });
    assert.deepEqual(hotBaselineTasks(runnable), ["assembleHap", "assembleHsp"]);
    assert.throws(() => hotBaselineTasks(model.modules), { code: "HOT_MODULE_INVALID" });
    assert.equal((await hotBaselinePackages(projects, model, runnable, app)).length, 3);
    await assert.rejects(hotBaselinePackages(projects, model, runnable.slice(0, 2), app), { code: "HOT_BASE_DEPENDENCY_MISSING" });
    writePackage("feature", "old-feature");
    await assert.rejects(hotBaselinePackages(projects, model, runnable, app), { code: "HOT_BASE_MODULE_MISMATCH" });
    const featureSource = path.join(root, "feature/src/main/Feature.ets"), harSource = path.join(root, "library/src/main/Shared.ets");
    fs.writeFileSync(featureSource, "export const value = 1");
    fs.writeFileSync(harSource, "export const value = 2");
    assert.deepEqual([...hotChanges(model, [featureSource]).keys()], ["feature"]);
    assert.deepEqual([...hotChanges(model, [harSource]).keys()].sort(), ["entry", "feature", "shared"]);
  } finally { await processes.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
test("a hot package set advances beyond divergent module patch versions and rejects an unrelated base", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-hot-version-")),
    model = project(root), app = { bundleName: "com.example.patch", versionCode: 1 };
  model.modules = ["entry", "feature", "shared"].map((name) => ({ name, root: path.join(root, name), target: "default" }));
  try {
    for (const [index, module] of model.modules.entries()) {
      fs.mkdirSync(module.root, { recursive: true });
      fs.writeFileSync(path.join(module.root, "patch.json"), JSON.stringify({ app: { ...app, patchVersionCode: index === 1 ? 2000002 : 2000001 } }));
    }
    assert.equal(nextHotPatchVersion(model.modules, app), 2000003);
    assert.throws(() => nextHotPatchVersion(model.modules, { ...app, versionCode: 2 }), { code: "HOT_PATCH_BASE_CHANGED" });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
const options: BuildOptions = {
  _: ["assembleHap"],
  mode: "module",
  prop: ["module=entry@phone,shared@tablet"],
  parallel: true,
  incremental: true,
  daemon: true,
  analyze: "normal",
  env: { DEVECO_SDK_HOME: "/fixture/sdk" },
};
function session(mode: string) {
  const processes = new ProcessService();
  return {
    processes,
    worker: new HvigorSession(processes, {
      executable: process.execPath,
      args: [
        fileURLToPath(new URL("./fixtures/native-hvigor.js", import.meta.url)),
        mode,
      ],
    }),
  };
}
test("hot compilation waits for every SDK watch worker, and rejects a partial or mismatched baseline", () => {
  const receipts = new BuildReceipts();
  receipts.begin(crypto.randomUUID(), { ...options, watch: true });
  receipts.watchWorker(1);
  receipts.watchWorker(2);
  assert.equal(receipts.complete(true)?.success, true);
  assert.throws(
    () =>
      receipts.begin(crypto.randomUUID(), {
        ...options,
        hotCompile: true,
        prop: ["module=entry@phone"],
      }),
    { code: "HVIGOR_WATCH_REQUIRED" },
  );
  receipts.begin(crypto.randomUUID(), { ...options, hotCompile: true });
  assert.equal(receipts.complete(true), undefined);
  assert.equal(receipts.busy, true);
  assert.equal(
    receipts.complete(false, "second module failed")?.success,
    false,
  );
  const partial = new BuildReceipts();
  partial.begin(crypto.randomUUID(), { ...options, watch: true });
  partial.watchWorker(1);
  assert.throws(() => partial.complete(true), {
    code: "HVIGOR_PROTOCOL_INVALID",
  });
});
test("a duplex worker handles repeated requests and bounds its log tail", async () => {
  const { processes, worker } = session("logs");
  try {
    await worker.ready();
    const identity = worker.identity;
    for (let i = 0; i < 2; i++) {
      const result = await worker.build(options);
      assert.equal(result.truncated, true);
      assert.ok(Buffer.byteLength(result.text) <= 262144);
      assert.deepEqual(worker.identity, identity);
    }
    await worker.stop();
    assert.equal(worker.connected, false);
    assert.equal(processes.size, 0);
    await assert.rejects(worker.build(options), {
      code: "HVIGOR_SESSION_BUSY",
    });
  } finally {
    await processes.close();
  }
});
test("cancellation waits for owned worker exit; no close acknowledgement is used", async () => {
  const { processes, worker } = session("hang"),
    controller = new AbortController();
  try {
    await worker.ready();
    const pid = worker.identity.pid!;
    await assert.rejects(
      worker.build(options, controller.signal, () => controller.abort()),
      { name: "AbortError" },
    );
    assert.equal(processes.size, 0);
    assert.equal(worker.connected, false);
    assert.throws(() => process.kill(pid, 0));
  } finally {
    await processes.close();
  }
});
test("failure and malformed SDK frames invalidate and stop the owned worker", async () => {
  for (const mode of ["fail", "invalid"]) {
    const { processes, worker } = session(mode);
    try {
      await worker.ready();
      await assert.rejects(worker.build(options));
      assert.equal(worker.connected, false);
      assert.equal(processes.size, 0);
    } finally {
      await processes.close();
    }
  }
});
function project(root: string): Project {
  return {
    root,
    product: { name: "demo", compatibleSdkVersion: 26, runtimeOS: "HarmonyOS" },
    modules: [
      { name: "entry", root: path.join(root, "entry"), target: "tablet" },
    ],
    fingerprint: "fixture",
  };
}
test("watch baseline rejects build-time edits and retains installation-time edits for the next patch", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-hot-sources-"));
  try {
    const model = project(root),
      file = path.join(root, "entry/src/main/ets/Index.ets");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "first version");
    const baseline = sourceFiles(model);
    assertHotSourcesUnchanged(model, baseline);
    fs.writeFileSync(file, "edited while SDK was compiling");
    assert.throws(() => assertHotSourcesUnchanged(model, baseline), {
      code: "HOT_SOURCE_CHANGED",
    });
    const rebuilt = sourceFiles(model);
    assertHotSourcesUnchanged(model, rebuilt);
    const libraryExport = path.join(model.modules[0]!.root, "Index.ets");
    fs.writeFileSync(libraryExport, "export const value = 1");
    assert.throws(() => assertHotSourcesUnchanged(model, rebuilt), { code: "HOT_SOURCE_CHANGED" });
    const withExport = sourceFiles(model);
    fs.writeFileSync(libraryExport, "export const value = 2");
    assert.notEqual(sourceFiles(model).get(libraryExport), withExport.get(libraryExport));
    fs.rmSync(libraryExport);
    fs.writeFileSync(file, "edited during installation");
    assert.notEqual(sourceFiles(model).get(file), rebuilt.get(file));
    fs.writeFileSync(file, "edited while SDK was compiling");
    const resource = path.join(path.dirname(file), "config.json");
    fs.writeFileSync(resource, "{}");
    assert.throws(() => assertHotSourcesUnchanged(model, rebuilt), {
      code: "HOT_SOURCE_CHANGED",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("watch config enables patch output, distinguishes product and target, and restores existing bytes", () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-hot-config-")),
  );
  try {
    const model = project(root),
      paths = hotPaths(model, model.modules[0]!);
    fs.mkdirSync(path.dirname(paths.config), { recursive: true });
    const before = '{"compileConfig":{"deviceType":"tablet"}}\n';
    fs.writeFileSync(paths.config, before);
    const config = HotConfiguration.prepare(model, model.modules);
    assert.match(fs.readFileSync(paths.config, "utf8"), /hotReload/);
    assert.ok(
      paths.symbols.endsWith(
        path.join("demo/intermediates/loader_out/tablet/ets"),
      ),
    );
    assert.throws(() => assertNoHotWatch(model), {
      code: "HOT_SESSION_ACTIVE",
    });
    assert.throws(() => HotConfiguration.prepare(model, model.modules), {
      code: "HOT_SESSION_ACTIVE",
    });
    config.restore();
    assert.equal(fs.readFileSync(paths.config, "utf8"), before);
    assertNoHotWatch(model);
    config.restore();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("watch cleanup preserves external configuration changes and its recovery marker", () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-hot-config-")),
  );
  try {
    const model = project(root),
      paths = hotPaths(model, model.modules[0]!);
    const config = HotConfiguration.prepare(model, model.modules);
    fs.writeFileSync(paths.config, '{"user":"changed"}');
    assert.throws(() => config.restore(), { code: "HOT_CONFIG_CHANGED" });
    assert.equal(fs.readFileSync(paths.config, "utf8"), '{"user":"changed"}');
    assert.ok(fs.existsSync(paths.receipt));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("a new runtime restores a dead owner's watch config but cannot recover a live owner", async () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-hot-recover-")),
  );
  const processes = new ProcessService();
  try {
    const model = project(root),
      paths = hotPaths(model, model.modules[0]!);
    await processes.run({
      executable: process.execPath,
      args: [
        fileURLToPath(new URL("./fixtures/native-hvigor.js", import.meta.url)),
        "prepare-config",
        root,
      ],
    });
    assert.ok(fs.existsSync(paths.receipt));
    HotConfiguration.recover(model);
    assert.equal(fs.existsSync(paths.config), false);
    assertNoHotWatch(model);
    const active = HotConfiguration.prepare(model, model.modules);
    assert.throws(() => HotConfiguration.recover(model), {
      code: "HOT_SESSION_ACTIVE",
    });
    active.restore();
  } finally {
    await processes.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("a failing process lifecycle hook still stops and observes its child", async () => {
  const processes = new ProcessService();
  let pid: number | undefined;
  try {
    await assert.rejects(
      processes.run(
        {
          executable: process.execPath,
          args: [
            fileURLToPath(
              new URL("./fixtures/native-hvigor.js", import.meta.url),
            ),
            "hang",
          ],
        },
        {
          onSpawn: (child) => {
            pid = child.pid;
            throw new Error("hook failed");
          },
        },
      ),
      /hook failed/,
    );
    assert.equal(processes.size, 0);
    assert.ok(pid);
    assert.throws(() => process.kill(pid!, 0));
  } finally {
    await processes.close();
  }
});
test("unconfirmed SDK sessions survive runtime restart and prevent reusing the project", async () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-sdk-guard-")),
  );
  let store = new StateStore(root);
  try {
    const session = store.trackExternalSession(
      "hvigor_watch",
      ["project:fixture"],
      { daemon_pid: process.pid },
    );
    session.unconfirmed();
    await assert.rejects(
      store.lease("project:fixture", async () => 1),
      { code: "RESOURCE_RECOVERY_REQUIRED" },
    );
    session.confirmClosed();
    assert.equal(await store.lease("project:fixture", async () => 2), 2);
    store.trackExternalSession("hvigor_watch", ["project:fixture"], {
      daemon_pid: process.pid,
    });
    store.close();
    store = new StateStore(root);
    await assert.rejects(
      store.lease("project:fixture", async () => 3),
      { code: "RESOURCE_RECOVERY_REQUIRED" },
    );
    assert.equal(store.externalGuards().length, 1);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
