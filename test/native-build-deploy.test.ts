import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { Runtime } from "../src/services/runtime.js";
import {
  workflowInputs,
  type ApplicationTarget,
} from "../src/core/contracts.js";
import { fileDigest, readObject } from "../src/core/files.js";
import { digest } from "../src/core/files.js";
import { object, ToolError, SettledEffectError } from "../src/core/errors.js";
import {
  inspectProject,
  projectTargets,
  type Project,
} from "../src/services/project.js";
import type { CapturedFile } from "../src/core/captured-file.js";
import {
  resolveBuildReference,
  resolveProjectApplication,
  resolvePackageApplication,
} from "../src/services/application-input.js";
import { evidenceSealSchema } from "../src/services/evidence-result.js";

const app = {
  bundle_name: "com.example.myapplication",
  module: "entry",
  ability: "EntryAbility",
};
const requirements = [
  { id: "run-app", revision: 1, text: "Build and start the application" },
];
const startup = {
  status: "passed",
  process: "stable",
  screen: "nonuniform",
  business_outcome_verified: false,
};
function pkg(
  file: string,
  module = "entry",
  type = "entry",
  dependencies: { moduleName: string }[] = [],
  abilities = ["EntryAbility"],
) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const zip = new AdmZip();
  zip.addFile(
    "module.json",
    Buffer.from(
      JSON.stringify({
        app: { bundleName: app.bundle_name, versionCode: 1, versionName: "1" },
        module: {
          name: module,
          type,
          mainElement: abilities[0],
          abilities: abilities.map((name) => ({ name })),
          dependencies,
        },
      }),
    ),
  );
  zip.writeZip(file);
  return {
    path: file,
    bytes: fs.statSync(file).size,
    sha256: fileDigest(file),
  };
}
async function fixture(
  t: TestContext,
  run: (f: {
    runtime: Runtime;
    root: string;
    project: string;
    source: string;
    counters: {
      builds: number;
      installs: number;
      launches: number;
      assertions: number;
      syncs: number;
    };
    start: (
      workflow: string,
      input: Record<string, unknown>,
      extra?: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  }) => Promise<void>,
) {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-build-deploy-")),
    ),
    project = path.join(root, "app"),
    old = {
      state: process.env.DEVECO_STATE_DIR,
      config: process.env.DEVECO_CONFIG,
    };
  fs.cpSync(
    new URL("../../test/fixtures/harmony-app/", import.meta.url),
    project,
    { recursive: true },
  );
  const appFile = path.join(project, "AppScope/app.json5"),
    data = readObject(appFile);
  object(data.app).bundleName = app.bundle_name;
  fs.writeFileSync(appFile, JSON.stringify(data));
  fs.mkdirSync(path.join(root, "clt"));
  process.env.DEVECO_STATE_DIR = path.join(root, "state");
  process.env.DEVECO_CONFIG = path.join(root, "config.json");
  fs.writeFileSync(
    process.env.DEVECO_CONFIG,
    JSON.stringify({ clt: path.join(root, "clt") }),
  );
  const runtime = new Runtime(),
    source = path.join(
      project,
      "entry/build/default/outputs/default/entry-default-signed.hap",
    );
  const counters = {
    builds: 0,
    installs: 0,
    launches: 0,
    assertions: 0,
    syncs: 0,
  };
  t.mock.method(
    runtime.devices,
    "target",
    async (target?: string) => target ?? "device-1",
  );
  t.mock.method(runtime.projects, "sync", async () => {
    counters.syncs++;
    return { synchronized: true };
  });
  t.mock.method(runtime.diagnostics, "arkts", async () => ({
    success: true,
    checked_file_count: 1,
    summary: { errorCount: 0, warnCount: 0 },
    artifact: runtime.store.artifact("preflight", "fixture"),
  }));
  const build = async (_project: Project) => {
    counters.builds++;
    return { artifacts: [pkg(source)], elapsedMs: 1 };
  };
  t.mock.method(runtime.projects, "build", build);
  t.mock.method(runtime.projects, "buildApplication", build);
  t.mock.method(
    runtime.devices,
    "install",
    async (
      _target: string,
      files: CapturedFile[],
      targetApp: ApplicationTarget,
    ) => {
      counters.installs++;
      assert.deepEqual(targetApp, app);
      return {
        installed: true,
        packages: files.map((file) => ({
          artifact_id: file.artifact_id,
          sha256: file.sha256,
        })),
      };
    },
  );
  t.mock.method(runtime.devices, "launch", async () => {
    counters.launches++;
    return { started: true, startup_check: startup };
  });
  t.mock.method(runtime.devices, "verify", async () => {
    counters.assertions++;
    return { verified: true };
  });
  t.mock.method(runtime.devices, "checkStartup", async () => {
    throw new Error("duplicate startup check");
  });
  const start = async (
    workflow: string,
    input: Record<string, unknown>,
    extra = {},
  ) => {
    let result = object(
      await runtime.call("workflow_run", {
        action: "start",
        workflow,
        input,
        wait_ms: 1000,
        detail: "full",
        ...extra,
      }),
    );
    for (
      let i = 0;
      i < 60 && ["queued", "running"].includes(String(result.status));
      i++
    )
      result = object(
        await runtime.call("workflow_run", {
          action: "status",
          run_id: result.run_id,
          wait_ms: 1000,
          detail: "full",
        }),
      );
    assert.ok(
      !["queued", "running"].includes(String(result.status)),
      JSON.stringify(result),
    );
    return result;
  };
  try {
    await run({ runtime, root, project, source, counters, start });
  } finally {
    await runtime.close();
    t.mock.restoreAll();
    if (old.state === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = old.state;
    if (old.config === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = old.config;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("ordinary build/run and strict package/reference alternatives have distinct contracts", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.ok(
    workflowInputs.build_run.safeParse({ project_path: "/app" }).success,
  );
  assert.equal(
    workflowInputs.build_deploy_verify.safeParse({ project_path: "/app" })
      .success,
    false,
  );
  for (const schema of [
    workflowInputs.build_run,
    workflowInputs.build_deploy_verify,
  ]) {
    const extra =
      schema === workflowInputs.build_deploy_verify
        ? { assert: { visible: { text: "hello" } } }
        : {};
    assert.ok(schema.safeParse({ build_run_id: id, ...extra }).success);
    for (const invalid of [
      { clean: true },
      { hot_reload: true },
      { sync: false },
      { modules: ["entry"] },
      { mode: "release" },
    ])
      assert.equal(
        schema.safeParse({ build_run_id: id, ...extra, ...invalid }).success,
        false,
      );
  }
  assert.ok(workflowInputs.app_deploy.safeParse({ build_run_id: id }).success);
  assert.equal(
    workflowInputs.app_deploy.safeParse({
      build_run_id: id,
      packages: [{ path: "a.hap" }],
    }).success,
    false,
  );
});

test("build reference reuses packages and captured scope, inheriting only original bindings", (t) =>
  fixture(t, async (f) => {
    const built = await f.start(
      "project_build",
      { project_path: f.project, sync: false },
      { requirements },
    );
    assert.equal(built.status, "succeeded", JSON.stringify(built));
    const request = { build_run_id: built.run_id };
    const deployed = await f.start("build_run", request, {
      request_key: "reuse-build",
    });
    assert.equal(deployed.status, "succeeded", JSON.stringify(deployed));
    assert.deepEqual(f.counters, {
      builds: 1,
      installs: 1,
      launches: 1,
      assertions: 0,
      syncs: 0,
    });
    const context = object(
      JSON.parse(f.runtime.store.get(String(deployed.run_id)).input),
    );
    assert.equal(context.project_path, f.project);
    assert.equal(context.target, "device-1");
    assert.deepEqual(object(context.parameters).app, app);
    assert.deepEqual(context.requirements, requirements);
    const seal = evidenceSealSchema.parse(object(deployed.result)._evidence);
    assert.equal(seal.build?.run_id, built.run_id);
    assert.ok(
      f.runtime.store.db
        .prepare(
          "SELECT 1 FROM run_dependencies WHERE parent_run_id=? AND run_id=?",
        )
        .get(deployed.run_id, built.run_id),
    );
    assert.equal(seal.identity.source_sha256, context.source_hash);
    assert.equal(
      object(object(deployed.result).build_or_hot_apply).reused,
      true,
    );
    assert.equal(object(deployed.result).final_assertion, undefined);
    assert.equal(
      (await f.start("build_run", request, { request_key: "reuse-build" }))
        .run_id,
      deployed.run_id,
    );
    assert.equal(f.counters.installs, 1);
    await assert.rejects(
      f.start("app_deploy", request, {
        requirements: [{ ...requirements[0], revision: 2 }],
      }),
      { code: "BUILD_REQUIREMENTS_MISMATCH" },
    );
    assert.deepEqual(
      f.runtime.store.db
        .prepare("SELECT id FROM artifacts WHERE run_id='workflow-input'")
        .all(),
      [],
    );
  }));

test("ordinary build/run performs shared startup while explicit verification still requires its assertion", (t) =>
  fixture(t, async (f) => {
    const ordinary = await f.start("build_run", {
      project_path: f.project,
      sync: false,
    });
    assert.equal(ordinary.status, "succeeded", JSON.stringify(ordinary));
    assert.equal(f.counters.assertions, 0);
    assert.match(String(ordinary.completion), /does not evaluate business/);
    t.mock.method(f.runtime.devices, "verify", async () => {
      f.counters.assertions++;
      throw new ToolError("VERIFICATION_FAILED", "Original assertion failed");
    });
    const verified = await f.start("build_deploy_verify", {
      build_run_id: ordinary.run_id,
      assert: { visible: { text: "Hello" } },
    });
    assert.equal(verified.status, "failed", JSON.stringify(verified));
    assert.equal(object(verified.error).code, "VERIFICATION_FAILED");
    assert.equal(f.counters.builds, 1);
    assert.ok(f.counters.assertions > 0);
  }));

test("reference validation rejects stale source, package changes, wrong selection and non-build runs before install", (t) =>
  fixture(t, async (f) => {
    const built = await f.start("project_build", {
      project_path: f.project,
      sync: false,
    });
    assert.equal(built.status, "succeeded", JSON.stringify(built));
    const id = String(built.run_id),
      source = path.join(f.project, "entry/src/main/ets/pages/Index.ets"),
      original = fs.readFileSync(source);
    for (const selection of [
      { product: "other" },
      { module_targets: { entry: "other" } },
      { project_path: f.root },
    ])
      assert.throws(
        () => resolveBuildReference(f.runtime.store, id, selection),
        { code: "BUILD_INPUT_MISMATCH" },
      );
    fs.appendFileSync(source, "\n// changed\n");
    await assert.rejects(f.start("app_deploy", { build_run_id: id }), {
      code: "BUILD_INPUT_STALE",
    });
    fs.writeFileSync(source, original);
    const packageBytes = fs.readFileSync(f.source);
    fs.appendFileSync(f.source, "changed");
    await assert.rejects(f.start("app_deploy", { build_run_id: id }), {
      code: "EVIDENCE_ARTIFACT_CHANGED",
    });
    fs.writeFileSync(f.source, packageBytes);
    fs.renameSync(f.source, f.source + ".saved");
    await assert.rejects(f.start("app_deploy", { build_run_id: id }), {
      code: "EVIDENCE_ARTIFACT_CHANGED",
    });
    fs.renameSync(f.source + ".saved", f.source);
    const unrelated = f.runtime.store.create("code_diagnose", {}).run;
    f.runtime.store.update(unrelated.id, "failed", null, { code: "fixture" });
    await assert.rejects(
      f.start("app_deploy", { build_run_id: unrelated.id }),
      { code: "BUILD_REFERENCE_INVALID" },
    );
    assert.equal(f.counters.installs, 0);
  }));

test("application and product ambiguity expose candidates and package dependencies must be complete", (t) =>
  fixture(t, async (f) => {
    const entry = inspectProject(f.project);
    assert.deepEqual(resolveProjectApplication(entry), app);
    const profileFile = path.join(f.project, "build-profile.json5"),
      profile = readObject(profileFile);
    object(profile.app).products = [{ name: "default" }, { name: "phone" }];
    fs.writeFileSync(profileFile, JSON.stringify(profile));
    assert.throws(
      () => inspectProject(f.project),
      (error) =>
        error instanceof ToolError &&
        error.code === "PRODUCT_AMBIGUOUS" &&
        JSON.stringify(error.details).includes("phone"),
    );
    const hap = path.join(f.root, "entry.hap"),
      hsp = path.join(f.root, "shared.hsp"),
      second = path.join(f.root, "second.hap");
    pkg(hap, "entry", "entry", [{ moduleName: "shared" }]);
    await assert.rejects(resolvePackageApplication([hap]), {
      code: "PACKAGE_DEPENDENCY_MISSING",
    });
    pkg(hsp, "shared", "shared", [], []);
    assert.deepEqual(await resolvePackageApplication([hap, hsp]), app);
    pkg(second, "other");
    await assert.rejects(resolvePackageApplication([hap, hsp, second]), {
      code: "APPLICATION_AMBIGUOUS",
    });
    assert.deepEqual(
      await resolvePackageApplication([hap, hsp, second], app),
      app,
    );
  }));

test("hot apply shares startup evidence, never installs, and cannot masquerade as a reusable full build", (t) =>
  fixture(t, async (f) => {
    t.mock.method(f.runtime.hot, "call", async () => ({
      applied: true,
      startup_check: startup,
    }));
    const applied = await f.start("build_run", {
      project_path: f.project,
      hot_reload: true,
    });
    assert.equal(applied.status, "succeeded", JSON.stringify(applied));
    assert.equal(
      object(object(applied.result).build_or_hot_apply).hot_reload,
      true,
    );
    assert.deepEqual(f.counters, {
      builds: 0,
      installs: 0,
      launches: 0,
      assertions: 0,
      syncs: 0,
    });
    await assert.rejects(
      f.start("app_deploy", { build_run_id: applied.run_id }),
      { code: "BUILD_REFERENCE_UNSUPPORTED" },
    );
    t.mock.method(f.runtime.hot, "call", async () => {
      throw new SettledEffectError("HOT_APPLY_FAILED", "Patch rejected");
    });
    const failed = await f.start("build_run", {
      project_path: f.project,
      hot_reload: true,
    });
    assert.equal(failed.status, "failed", JSON.stringify(failed));
    assert.equal(object(failed.error).code, "HOT_APPLY_FAILED");
    assert.equal(f.counters.installs, 0);
  }));

test("hot apply rejects changing the active watch application or device before native work", (t) =>
  fixture(t, async (f) => {
    const project = inspectProject(f.project),
      sessions = Reflect.get(f.runtime.hot, "sessions") as Map<string, unknown>;
    const key = digest([
      project.root,
      project.product.name,
      projectTargets(project),
    ]);
    sessions.set(key, {
      project,
      target: "watch-device",
      app,
      connection: { connected: true },
    });
    try {
      await assert.rejects(
        f.runtime.hot.call(
          { action: "apply", target: "other-device", app },
          project,
        ),
        { code: "HOT_TARGET_CHANGED" },
      );
      await assert.rejects(
        f.runtime.hot.call(
          { action: "apply", app: { ...app, ability: "OtherAbility" } },
          project,
        ),
        { code: "HOT_APP_CHANGED" },
      );
      await assert.rejects(
        f.runtime.hot.call(
          {
            action: "apply",
            app: { ...app, startup_check: { mode: "process_only" } },
          },
          project,
        ),
        { code: "HOT_APP_CHANGED" },
      );
      const captured = f.runtime.hot.activeApplication(project)!;
      captured.ability = "Mutation";
      assert.equal(
        f.runtime.hot.activeApplication(project)!.ability,
        app.ability,
      );
      assert.equal(f.counters.installs, 0);
    } finally {
      sessions.delete(key);
    }
  }));

test("combined run resumes its lost launch receipt without rebuilding or reinstalling", (t) =>
  fixture(t, async (f) => {
    t.mock.method(f.runtime.devices, "launch", async () => {
      f.counters.launches++;
      throw new Error("launch response lost");
    });
    const run = await f.start("build_run", {
      project_path: f.project,
      sync: false,
    });
    assert.equal(run.status, "needs_input", JSON.stringify(run));
    t.mock.method(f.runtime.devices, "reconcileLaunch", async () => ({
      started: true,
      startup_check: startup,
    }));
    const recovered = object(
      await f.runtime.call("workflow_run", {
        action: "resume",
        run_id: run.run_id,
        resume_input: { action: "recheck" },
        wait_ms: 1000,
      }),
    );
    assert.equal(recovered.status, "succeeded", JSON.stringify(recovered));
    assert.deepEqual(f.counters, {
      builds: 1,
      installs: 1,
      launches: 1,
      assertions: 0,
      syncs: 0,
    });
  }));
