import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectService, projectTargets } from "../src/services/project.js";
import { ProcessService } from "../src/core/process.js";
import { atomicWrite, destinationPath, readObject } from "../src/core/files.js";
import { resourceRoot } from "../src/core/config.js";
import { workflowInputs } from "../src/core/contracts.js";
import { DirectoryPublication } from "../src/core/directory-publication.js";

function fixture() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "deveco-project-")),
  );
  const sdk = path.join(root, "sdk");
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
  atomicWrite(path.join(sdk, "default/hms/ets/build-tools/ts-checker-hooks/sdkApiVersionMap.json"), JSON.stringify({
    "22": ["6.0.2(22)"], "24": ["6.1.1(24)"], "26.0.0": ["26.0.0"],
  }));
  const service = new ProjectService(new ProcessService(), () => ({
    root,
    sdk,
    version: "fixture",
    versions: {},
    fingerprint: "fixture",
    kind: "studio",
    components: {},
  }));
  const input = {
    project_path: path.join(root, "application"),
    app_name: "Canary",
    bundle_name: "com.deveco.canary",
    sdk_version: "26",
  };
  return {
    root,
    service,
    input,
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("module target selection is independent of product, retains defaults and separates fingerprints", async () => {
  const f = fixture();
  try {
    await f.service.create(f.input);
    const file = path.join(f.input.project_path, "build-profile.json5"), profile = readObject(file);
    profile.modules = [{ name: "entry", srcPath: "./entry", targets: [
      { name: "default", applyToProducts: ["default"] },
      { name: "preview", applyToProducts: ["default"] },
    ] }];
    atomicWrite(file, JSON.stringify(profile));
    const implicit = f.service.resolve(f.input.project_path),
      explicit = f.service.resolve(f.input.project_path, "default", { entry: "default" }),
      requested = { entry: "preview" },
      preview = f.service.resolve(f.input.project_path, "default", requested);
    requested.entry = "default";
    assert.deepEqual(projectTargets(preview), { entry: "preview" });
    assert.equal(implicit.fingerprint, explicit.fingerprint);
    assert.notEqual(preview.fingerprint, implicit.fingerprint);
    assert.deepEqual(f.service.resolveSelection(f.input.project_path, "default", { entry: "preview" }).modules, preview.modules);
    const extracted = projectTargets(preview);
    extracted.entry = "default";
    assert.equal(preview.modules[0]?.target, "preview");
  } finally { f.close(); }
});

test("explicit targets resolve ambiguity and reject unknown modules and inapplicable targets", async () => {
  const f = fixture();
  try {
    await f.service.create(f.input);
    const file = path.join(f.input.project_path, "build-profile.json5"), profile = readObject(file);
    profile.modules = [{ name: "entry", srcPath: "./entry", targets: [
      { name: "phone", applyToProducts: ["default"] },
      { name: "preview", applyToProducts: ["default"] },
      { name: "tablet", applyToProducts: ["tablet"] },
    ] }];
    atomicWrite(file, JSON.stringify(profile));
    assert.throws(() => f.service.resolve(f.input.project_path), { code: "TARGET_AMBIGUOUS" });
    assert.equal(f.service.resolve(f.input.project_path, undefined, { entry: "preview" }).modules[0]?.target, "preview");
    assert.throws(() => f.service.resolve(f.input.project_path, undefined, { missing: "preview" }), { code: "MODULE_INVALID" });
    for (const target of ["missing", "tablet"]) assert.throws(
      () => f.service.resolve(f.input.project_path, undefined, { entry: target }), { code: "TARGET_INVALID" },
    );
  } finally { f.close(); }
});

test("product APP packaging cannot silently discard explicit module selectors", async () => {
  const f = fixture();
  try {
    const project = await f.service.create(f.input);
    for (const selector of [{ modules: ["entry"] }, { module_targets: { entry: "default" } }]) {
      const input = { task: "assembleApp", ...selector };
      assert.equal(workflowInputs.project_build.safeParse(input).success, false);
      await assert.rejects(f.service.build(project, input), { code: "APP_TARGET_SELECTION_UNSUPPORTED" });
    }
    assert.equal(workflowInputs.project_build.safeParse({ task: "assembleApp" }).success, true);
  } finally { f.close(); }
});

test("project creation rejects SDK-invalid bundle names before allocating any destination files", async () => {
  const f = fixture();
  try {
    for (const bundle_name of [
      "a", "a.b.c", "com.example", "com..example.app", "com.example.app.",
      "_com.example.app", "com._example.app", "com.example_.app",
      "com.example._app", "com.example.app_", "1com.example.app",
      "com.example.应用", "com.example.app\n", `com.example.${"a".repeat(117)}`,
    ]) {
      const input = { ...f.input, project_path: path.join(f.root, "unused", "application"), bundle_name };
      assert.equal(workflowInputs.project_create.safeParse(input).success, false, bundle_name);
      await assert.rejects(f.service.create(input), { code: "BUNDLE_INVALID" });
      assert.equal(fs.existsSync(path.dirname(input.project_path)), false);
    }
  } finally { f.close(); }
});

test("project creation preserves valid SDK bundle names including interior underscores and length boundaries", async () => {
  const f = fixture();
  try {
    for (const [index, bundle_name] of ["a.b.cde", "C_om.1example.App_2", `com.example.${"a".repeat(116)}`].entries()) {
      const input = { ...f.input, project_path: path.join(f.root, `valid-${index}`), bundle_name };
      assert.equal(workflowInputs.project_create.safeParse(input).success, true);
      const created = await f.service.create(input);
      const app = readObject(path.join(created.root, "AppScope/app.json5"));
      assert.equal((app.app as Record<string, unknown>).bundleName, bundle_name);
    }
  } finally { f.close(); }
});

test("project creation validates the complete application name before allocating the destination", async () => {
  const f = fixture();
  try {
    for (const app_name of ["", "1App", "_App", "My App", "应用", "Canary\n", "Canary\r\n", "Canary\u2028", "A".repeat(129)]) {
      const input = { ...f.input, app_name };
      assert.equal(workflowInputs.project_create.safeParse(input).success, false);
      await assert.rejects(f.service.create(input), { code: "APP_NAME_INVALID" });
      assert.equal(fs.existsSync(input.project_path), false);
    }
    for (const [index, app_name] of ["A", `A${"_".repeat(127)}`].entries()) {
      const input = { ...f.input, project_path: path.join(f.root, `name-${index}`), app_name };
      assert.equal(workflowInputs.project_create.safeParse(input).success, true);
      const created = await f.service.create(input);
      const label = readObject(path.join(created.root, "AppScope/resources/base/element/string.json"));
      assert.deepEqual(label.string, [{ name: "app_name", value: app_name }]);
    }
  } finally { f.close(); }
});

test("project creation accepts an existing empty directory but requires explicit merge for existing files", async () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.input.project_path);
    const created = await f.service.create(f.input);
    assert.equal(created.root, f.input.project_path);
    atomicWrite(path.join(f.input.project_path, "user.txt"), "preserve me");
    await assert.rejects(f.service.create(f.input), { code: "PROJECT_EXISTS" });
    assert.equal(
      fs.readFileSync(path.join(f.input.project_path, "user.txt"), "utf8"),
      "preserve me",
    );
  } finally {
    f.close();
  }
});

test("a completed project creation can be reconciled only for its operation, input and unchanged files", async () => {
  const f = fixture();
  try {
    const result = await f.service.create(f.input, undefined, "operation-1");
    assert.equal(result.product.compatibleSdkVersion, "26.0.0");
    assert.equal(
      f.service.reconcileCreate(f.input, "operation-1")?.root,
      result.root,
    );
    assert.equal(
      f.service.reconcileCreate(f.input, "another-operation"),
      undefined,
    );
    assert.equal(
      f.service.reconcileCreate(
        { ...f.input, app_name: "Changed" },
        "operation-1",
      ),
      undefined,
    );
    atomicWrite(
      path.join(result.root, "entry/src/main/ets/pages/Index.ets"),
      "user modification",
    );
    assert.equal(f.service.reconcileCreate(f.input, "operation-1"), undefined);
    assert.equal(
      fs.readFileSync(
        path.join(result.root, "entry/src/main/ets/pages/Index.ets"),
        "utf8",
      ),
      "user modification",
    );
  } finally {
    f.close();
  }
});

test("project templates copy complete nested files into Unicode paths without changing source resources", async () => {
  const f = fixture();
  try {
    const project_path = path.join(f.root, "中文 空格🙂", "工程"),
      source = path.join(
        resourceRoot,
        "templates/application/entry/src/main/ets/pages/Index.ets",
      ),
      bytes = fs.readFileSync(source),
      created = await f.service.create(
        { ...f.input, project_path },
        undefined,
        "unicode-create",
      );
    assert.equal(created.root, fs.realpathSync.native(project_path));
    assert.deepEqual(
      fs.readFileSync(
        path.join(created.root, "entry/src/main/ets/pages/Index.ets"),
      ),
      bytes,
    );
    assert.deepEqual(fs.readFileSync(source), bytes);
    assert.equal(
      f.service.reconcileCreate({ ...f.input, project_path }, "unicode-create")
        ?.root,
      created.root,
    );
    assert.equal(
      fs.statSync(path.join(created.root, ".gitignore")).isFile(),
      true,
    );
    await assert.rejects(f.service.create({ ...f.input, project_path }), {
      code: "PROJECT_EXISTS",
    });
  } finally {
    f.close();
  }
});

test("project aliases, Windows short temp names and asynchronous file paths share one captured identity", async () => {
  const f = fixture(),
    alias = `${f.root}-alias`;
  try {
    fs.symlinkSync(f.root, alias, "junction");
    const created = await f.service.create({
        ...f.input,
        project_path: path.join(alias, "application"),
      }),
      direct = f.service.resolve(f.input.project_path),
      linked = f.service.resolve(path.join(alias, "application")),
      temporaryAlias = f.service.resolve(
        path.join(os.tmpdir(), path.basename(f.root), "application"),
      );
    assert.equal(
      created.root,
      await fs.promises.realpath(f.input.project_path),
    );
    assert.deepEqual(linked, direct);
    assert.deepEqual(temporaryAlias, direct);
    assert.equal(
      destinationPath(path.join(alias, "future", "output")),
      destinationPath(path.join(f.root, "future", "output")),
    );
    for (const module of created.modules)
      assert.equal(module.root, await fs.promises.realpath(module.root));
  } finally {
    fs.rmSync(alias, { force: true });
    f.close();
  }
});

test("explicit concurrent project scopes and legacy switch descriptors cannot change another call", async () => {
  const f=fixture();
  try {
    const first=await f.service.create(f.input), second=await f.service.create({...f.input,project_path:path.join(f.root,"second")});
    const selections=await Promise.all([Promise.resolve().then(()=>f.service.resolve(first.root)),Promise.resolve().then(()=>{f.service.select(second.root);return f.service.resolve(second.root);})]);
    assert.deepEqual(selections.map(row=>row.root),[first.root,second.root]);
    assert.equal(f.service.select(first.root).immutable,true);
    assert.throws(()=>f.service.resolve(),{code:"PROJECT_REQUIRED"});
    assert.throws(()=>f.service.resolveSelection(),{code:"PROJECT_REQUIRED"});
    assert.throws(()=>f.service.resolve("application"),{code:"PROJECT_PATH_ABSOLUTE_REQUIRED"});
    assert.throws(()=>f.service.select(path.join(f.root,"missing")));
    assert.equal(f.service.resolve(second.root).root,second.root);
    const config=path.join(f.root,"legacy-config.json"),previous=process.env.DEVECO_CONFIG;
    atomicWrite(config,JSON.stringify({default_project:first.root}));process.env.DEVECO_CONFIG=config;
    try {const other=new ProjectService(new ProcessService());assert.throws(()=>other.resolve(),{code:"PROJECT_REQUIRED"});}
    finally {if(previous===undefined) delete process.env.DEVECO_CONFIG;else process.env.DEVECO_CONFIG=previous;}
  } finally {f.close();}
});

test("read-only project selections stay fresh while task contexts retain their captured build fingerprint", async () => {
  const f = fixture();
  try {
    const created = await f.service.create(f.input);
    f.service.select(created.root);
    const captured = f.service.resolve(created.root), selection = f.service.resolveSelection(created.root);
    const { fingerprint, ...location } = captured;
    assert.deepEqual(selection, location);
    const appFile = path.join(created.root, "AppScope/app.json5");
    const app = readObject(appFile);
    atomicWrite(appFile, JSON.stringify({ ...app, queryFixture: "changed-build-input" }));
    assert.deepEqual(f.service.resolveSelection(created.root), selection);
    assert.notEqual(f.service.resolve(created.root).fingerprint, fingerprint);
    assert.equal(captured.fingerprint, fingerprint);

    const file = path.join(created.root, "build-profile.json5"), profile = readObject(file);
    profile.app = { products: [{ name: "phone", compatibleSdkVersion: 26 }, { name: "tablet", compatibleSdkVersion: 24 }] };
    atomicWrite(file, JSON.stringify(profile));
    assert.throws(() => f.service.resolveSelection(created.root), { code: "PRODUCT_AMBIGUOUS" });
    assert.throws(() => f.service.resolveSelection(created.root, "tablet"), { code: "PRODUCT_HAS_NO_MODULES" });
    profile.modules = [{ name: "entry", srcPath: "./entry" }];
    atomicWrite(file, JSON.stringify(profile));
    assert.equal(f.service.resolveSelection(created.root, "tablet").product.compatibleSdkVersion, 24);
    const tablet = f.service.resolve(created.root, "tablet"), stat = fs.statSync(file), bytes = fs.readFileSync(file, "utf8");
    tablet.product.compatibleSdkVersion = 99;
    tablet.modules[0]!.name = "caller-edited";
    assert.equal(f.service.resolveSelection(created.root, "tablet").product.compatibleSdkVersion, 24);
    assert.equal(f.service.resolveSelection(created.root, "tablet").modules[0]!.name, "entry");
    fs.writeFileSync(file, bytes.replace('"compatibleSdkVersion":24', '"compatibleSdkVersion":25'));
    fs.utimesSync(file, stat.atime, stat.mtime);
    const changed = f.service.resolve(created.root, "tablet");
    assert.equal(changed.product.compatibleSdkVersion, 25);
    assert.notEqual(changed.fingerprint, tablet.fingerprint, "Same-size edits with restored timestamps must change the captured project identity");
    fs.writeFileSync(file, "invalid profile");
    assert.throws(() => f.service.resolveSelection(created.root, "tablet"), "Invalid current bytes cannot reuse a previously valid parsed profile");
    fs.writeFileSync(file, bytes);
    assert.equal(selection.product.name, "default");
    fs.rmSync(path.join(created.root, "entry"), { recursive: true });
    assert.throws(() => f.service.resolveSelection(created.root, "phone"), { code: "ENOENT" });
  } finally { f.close(); }
});

test("cancelling staging leaves the destination untouched and removes only the private staging directory", async () => {
  const f = fixture(),
    controller = new AbortController();
  try {
    const creating = f.service.create(
      f.input,
      controller.signal,
      "cancel-copy",
    );
    controller.abort();
    await assert.rejects(creating, { code: "CANCELLED" });
    assert.equal(fs.existsSync(f.input.project_path), false);
    assert.equal(fs.readdirSync(f.root).some(name => name.startsWith(".deveco-create-")), false);
    assert.equal(f.service.reconcileCreate(f.input, "cancel-copy"), undefined);
    assert.equal((await f.service.create(f.input, undefined, "cancel-copy")).root, f.input.project_path);
  } finally {
    f.close();
  }
});

test("an incomplete creation receipt never authorizes replay or completion", async () => {
  const f = fixture();
  try {
    atomicWrite(
      path.join(f.input.project_path, ".deveco-mcp/create.json"),
      JSON.stringify({
        status: "started",
        operation_id: "operation-1",
        input_hash: "incomplete",
      }),
    );
    assert.equal(f.service.reconcileCreate(f.input, "operation-1"), undefined);
    await assert.rejects(f.service.create(f.input, undefined, "operation-1"), {
      code: "PROJECT_EXISTS",
    });
  } finally {
    f.close();
  }
});

test("safe merge preserves existing files and returns the actual reusable descriptor", async () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.input.project_path, "entry"), { recursive: true });
    fs.writeFileSync(path.join(f.input.project_path, "entry/user-note.txt"), "keep");
    const created = await f.service.create({ ...f.input, merge: true, sdk_version: undefined });
    assert.equal(fs.readFileSync(path.join(created.root, "entry/user-note.txt"), "utf8"), "keep");
    assert.equal(created.app.bundle_name, f.input.bundle_name);
    assert.equal(created.app.ability, "EntryAbility");
    assert.equal(created.sdk.selection, "configured_default");
    assert.equal(created.sdk.compile_api, 26);
    assert.equal(workflowInputs.project_build.safeParse(created.next.input).success, true);
    assert.deepEqual(created.next.input.module_targets, { entry: "default" });
    assert.equal(fs.readdirSync(f.root).some(name => name.startsWith(".deveco-create-")), false);
  } finally { f.close(); }
});

test("merge preflight reports file, directory and symlink conflicts without changing the destination", async () => {
  const f = fixture();
  try {
    for (const kind of ["file", "directory", "symlink"]) {
      const target = path.join(f.root, kind), conflict = path.join(target, "entry");
      fs.mkdirSync(target);
      if (kind === "file") fs.writeFileSync(conflict, "keep");
      else if (kind === "directory") fs.mkdirSync(path.join(target, "build-profile.json5"));
      else {
        fs.mkdirSync(path.join(f.root, "outside"));
        fs.symlinkSync(path.join(f.root, "outside"), conflict, "dir");
      }
      const before = fs.readdirSync(target);
      await assert.rejects(f.service.create({ ...f.input, project_path: target, merge: true }), (error: unknown) => {
        assert.equal((error as {code:string}).code, "CREATE_CONFLICT");
        assert.ok((error as {details:{conflicts:string[]}}).details.conflicts.length > 0);
        return true;
      });
      assert.deepEqual(fs.readdirSync(target), before);
      if (kind === "symlink") assert.deepEqual(fs.readdirSync(path.join(f.root, "outside")), []);
    }
  } finally { f.close(); }
});

test("an interrupted merge reconciles only its owned hardlinks and retains concurrent user additions", async t => {
  const f = fixture();
  const input = { ...f.input, merge: true }, link = DirectoryPublication.prototype.link;
  try {
    fs.mkdirSync(f.input.project_path);
    let published = 0;
    t.mock.method(DirectoryPublication.prototype, "link", function (this: DirectoryPublication, source: DirectoryPublication, relative: string) {
      if (++published === 3) throw new Error("simulated publication interruption");
      return link.call(this, source, relative);
    });
    await assert.rejects(f.service.create(input, undefined, "merge-interruption"), /simulated publication interruption/);
    t.mock.restoreAll();
    assert.equal(f.service.reconcileCreate(input, "different-operation"), undefined);
    fs.writeFileSync(path.join(f.input.project_path, "concurrent.txt"), "user");
    const recovered = f.service.reconcileCreate(input, "merge-interruption");
    assert.equal(recovered?.root, f.input.project_path);
    assert.equal(fs.readFileSync(path.join(f.input.project_path, "concurrent.txt"), "utf8"), "user");
    assert.equal(f.service.reconcileCreate(input, "merge-interruption")?.root, f.input.project_path);
  } finally { t.mock.restoreAll(); f.close(); }
});

test("a racing file never overwrites user content and blocks reconciliation", async t => {
  const f = fixture(), input = { ...f.input, merge: true }, link = DirectoryPublication.prototype.link;
  try {
    fs.mkdirSync(f.input.project_path);
    let collision: string | undefined;
    t.mock.method(DirectoryPublication.prototype, "link", function (this: DirectoryPublication, source: DirectoryPublication, relative: string) {
      if (!collision) {
        collision = path.join(this.root, relative); fs.writeFileSync(collision, "concurrent user file");
      }
      return link.call(this, source, relative);
    });
    await assert.rejects(f.service.create(input, undefined, "racing-create"), { code: "CREATE_CONFLICT" });
    t.mock.restoreAll();
    assert.equal(fs.readFileSync(collision!, "utf8"), "concurrent user file");
    assert.throws(() => f.service.reconcileCreate(input, "racing-create"), { code: "CREATE_CONFLICT" });
    assert.equal(fs.readFileSync(collision!, "utf8"), "concurrent user file");
  } finally { t.mock.restoreAll(); f.close(); }
});

test("SDK omission follows the configured default even if other SDKs are installed", async () => {
  const f = fixture();
  try {
    atomicWrite(path.join(f.root, "sdk/older/sdk-pkg.json"), JSON.stringify({ data: { apiVersion: "22", platformVersion: "6.0.2", version: "older" } }));
    const created = await f.service.create({ ...f.input, sdk_version: undefined, target_api: 24, compatible_api: 22 });
    assert.equal(created.sdk.compile_api, 26); assert.equal(created.sdk.target_api, 24); assert.equal(created.sdk.compatible_api, 22);
    fs.rmSync(path.join(f.root, "sdk/default/sdk-pkg.json"));
    await assert.rejects(f.service.create({ ...f.input, project_path: path.join(f.root, "missing-sdk"), sdk_version: undefined }), { code: "SDK_METADATA_MISSING" });
    assert.equal(fs.existsSync(path.join(f.root, "missing-sdk")), false);
  } finally { f.close(); }
});

test("a directory-to-symlink race cannot publish outside the project and can recover after restoring the same directory", async t => {
  const f = fixture(), link = DirectoryPublication.prototype.link, input = { ...f.input, merge: true };
  let replaced: string | undefined;
  try {
    fs.mkdirSync(f.input.project_path);
    const outside = path.join(f.root, "outside"); fs.mkdirSync(outside);
    t.mock.method(DirectoryPublication.prototype, "link", function (this: DirectoryPublication, source: DirectoryPublication, relative: string) {
      if (!replaced && relative.includes("/")) {
        replaced = path.dirname(path.join(this.root, relative));
        fs.renameSync(replaced, replaced + ".moved");
        fs.symlinkSync(outside, replaced, "dir");
      }
      return link.call(this, source, relative);
    });
    await assert.rejects(f.service.create(input, undefined, "symlink-race"), { code: "CREATE_PATH_CHANGED" });
    t.mock.restoreAll();
    assert.deepEqual(fs.readdirSync(outside), []);
    fs.unlinkSync(replaced!); fs.renameSync(replaced! + ".moved", replaced!);
    assert.equal(f.service.reconcileCreate(input, "symlink-race")?.root, f.input.project_path);
  } finally { t.mock.restoreAll(); f.close(); }
});

test("unavailable SDK fails before claiming the requested project directory", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.create({ ...f.input, sdk_version: "999" }), {
      code: "SDK_VERSION_UNAVAILABLE",
    });
    assert.equal(fs.existsSync(f.input.project_path), false);
  } finally {
    f.close();
  }
});

test("project creation keeps compile SDK, target API and minimum device API independent", async () => {
  const f = fixture();
  try {
    for (const [index, levels] of [
      { target_api: 24, compatible_api: 22 },
      { target_api: 24 },
      { compatible_api: 22 },
    ].entries()) {
      const input = { ...f.input, project_path: path.join(f.root, `api-${index}`), ...levels };
      assert.equal(workflowInputs.project_create.safeParse(input).success, true);
      const created = await f.service.create(input);
      assert.equal(created.product.compileSdkVersion, "26.0.0");
      assert.equal(created.product.targetSdkVersion, levels.target_api ? "6.1.1(24)" : "26.0.0");
      assert.equal(created.product.compatibleSdkVersion, levels.compatible_api ? "6.0.2(22)" : "6.1.1(24)");
      assert.equal(readObject(path.join(created.root, "hvigor/hvigor-config.json5")).modelVersion, "26.0.0");
    }
  } finally { f.close(); }
});

test("missing, ambiguous or malformed SDK API mappings fail before allocating a project", async () => {
  const f = fixture();
  try {
    const map = path.join(f.root, "sdk/default/hms/ets/build-tools/ts-checker-hooks/sdkApiVersionMap.json");
    for (const mapping of [undefined, {}, { "24": ["6.1.1(23)"] }, { "24": ["6.1.1(24)", "6.1.2(24)"] }, { "24": ["6.1.1(24)\n"] }]) {
      if (mapping === undefined) fs.unlinkSync(map);
      else atomicWrite(map, JSON.stringify(mapping));
      const input = { ...f.input, project_path: path.join(f.root, "untouched/application"), target_api: 24 };
      await assert.rejects(f.service.create(input), { code: "SDK_API_MAPPING_UNAVAILABLE" });
      assert.equal(fs.existsSync(path.dirname(input.project_path)), false);
    }
  } finally { f.close(); }
});

test("invalid API ranges fail before creating the destination or its parents", async () => {
  const f = fixture();
  try {
    for (const levels of [
      { target_api: 27 }, { target_api: 24, compatible_api: 25 },
      { compatible_api: 27 }, { compatible_api: 3 }, { target_api: 7 },
      { target_api: 24.5 }, { compatible_api: NaN }, { target_api: Infinity },
    ]) {
      const input = { ...f.input, project_path: path.join(f.root, "untouched/application"), ...levels };
      await assert.rejects(f.service.create(input), { code: "SDK_API_RANGE_INVALID" });
      assert.equal(fs.existsSync(path.dirname(input.project_path)), false);
    }
  } finally { f.close(); }
});

test("creation recovery binds requested runtime APIs as part of the original input", async () => {
  const f = fixture();
  try {
    const input = { ...f.input, target_api: 24, compatible_api: 22 };
    const created = await f.service.create(input, undefined, "api-recovery");
    assert.equal(f.service.reconcileCreate(input, "api-recovery")?.root, created.root);
    assert.equal(f.service.reconcileCreate({ ...input, target_api: 25 }, "api-recovery"), undefined);
    assert.equal(f.service.reconcileCreate({ ...input, compatible_api: 23 }, "api-recovery"), undefined);
  } finally { f.close(); }
});

test("resource names canonicalize existing parents of future project destinations", () => {
  const f = fixture();
  try {
    assert.equal(
      destinationPath(
        path.join(os.tmpdir(), path.basename(f.root), "not-yet/created"),
      ),
      path.join(f.root, "not-yet/created"),
    );
  } finally {
    f.close();
  }
});
