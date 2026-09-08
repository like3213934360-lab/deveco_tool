import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectService } from "../src/services/project.js";
import { ProcessService } from "../src/core/process.js";
import { atomicWrite, destinationPath, readObject } from "../src/core/files.js";
import { resourceRoot } from "../src/core/config.js";
import { workflowInputs } from "../src/core/contracts.js";

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

test("project creation exclusively claims a new directory and never merges into existing files or an empty directory", async () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.input.project_path);
    await assert.rejects(f.service.create(f.input), { code: "PROJECT_EXISTS" });
    assert.deepEqual(fs.readdirSync(f.input.project_path), []);
    atomicWrite(path.join(f.input.project_path, "user.txt"), "preserve me");
    await assert.rejects(f.service.create(f.input), { code: "PROJECT_EXISTS" });
    assert.equal(
      fs.readFileSync(path.join(f.input.project_path, "user.txt"), "utf8"),
      "preserve me",
    );
    assert.deepEqual(fs.readdirSync(f.input.project_path), ["user.txt"]);
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

test("project switching is independent of product selection and invalid switches preserve the previous default", async () => {
  const f = fixture();
  try {
    const first = await f.service.create(f.input),
      file = path.join(first.root, "build-profile.json5"),
      profile = readObject(file);
    profile.app = {
      products: [
        { name: "phone", compatibleSdkVersion: 26 },
        { name: "tablet", compatibleSdkVersion: 23 },
      ],
    };
    profile.modules = [{ name: "entry", srcPath: "./entry" }];
    atomicWrite(file, JSON.stringify(profile));
    assert.deepEqual(f.service.select(first.root), {
      project_path: first.root,
    });
    assert.throws(() => f.service.resolve(), { code: "PRODUCT_AMBIGUOUS" });
    const phone = f.service.resolve(undefined, "phone");
    assert.equal(phone.product.name, "phone");
    for (const invalid of [path.join(f.root, "missing"), file, f.root]) {
      assert.throws(() => f.service.select(invalid));
      assert.deepEqual(f.service.resolve(undefined, "phone"), phone);
    }
    const second = await f.service.create({
      ...f.input,
      project_path: path.join(f.root, "second"),
    });
    f.service.select(second.root);
    assert.equal(f.service.resolve().root, second.root);
    assert.equal(
      phone.root,
      first.root,
      "Previously captured context is not mutated",
    );
    fs.rmSync(second.root, { recursive: true });
    assert.throws(() => f.service.resolve(), { code: "ENOENT" });
    assert.equal(
      f.service.resolve(first.root, "tablet").product.name,
      "tablet",
    );
  } finally {
    f.close();
  }
});

test("read-only project selections stay fresh while task contexts retain their captured build fingerprint", async () => {
  const f = fixture();
  try {
    const created = await f.service.create(f.input);
    f.service.select(created.root);
    const captured = f.service.resolve(), selection = f.service.resolveSelection();
    const { fingerprint, ...location } = captured;
    assert.deepEqual(selection, location);
    const appFile = path.join(created.root, "AppScope/app.json5");
    const app = readObject(appFile);
    atomicWrite(appFile, JSON.stringify({ ...app, queryFixture: "changed-build-input" }));
    assert.deepEqual(f.service.resolveSelection(), selection);
    assert.notEqual(f.service.resolve().fingerprint, fingerprint);
    assert.equal(captured.fingerprint, fingerprint);

    const file = path.join(created.root, "build-profile.json5"), profile = readObject(file);
    profile.app = { products: [{ name: "phone", compatibleSdkVersion: 26 }, { name: "tablet", compatibleSdkVersion: 24 }] };
    atomicWrite(file, JSON.stringify(profile));
    assert.throws(() => f.service.resolveSelection(), { code: "PRODUCT_AMBIGUOUS" });
    assert.throws(() => f.service.resolveSelection(undefined, "tablet"), { code: "PRODUCT_HAS_NO_MODULES" });
    profile.modules = [{ name: "entry", srcPath: "./entry" }];
    atomicWrite(file, JSON.stringify(profile));
    assert.equal(f.service.resolveSelection(undefined, "tablet").product.compatibleSdkVersion, 24);
    assert.equal(selection.product.name, "default");
    fs.rmSync(path.join(created.root, "entry"), { recursive: true });
    assert.throws(() => f.service.resolveSelection(undefined, "phone"), { code: "ENOENT" });
  } finally { f.close(); }
});

test("cancelling an asynchronous template copy preserves an incomplete receipt and never permits blind replay", async () => {
  const f = fixture(),
    controller = new AbortController();
  try {
    const creating = f.service.create(
      f.input,
      controller.signal,
      "cancel-copy",
    );
    controller.abort();
    await assert.rejects(creating, { name: "AbortError" });
    assert.equal(
      readObject(path.join(f.input.project_path, ".deveco-mcp/create.json"))
        .status,
      "started",
    );
    assert.equal(f.service.reconcileCreate(f.input, "cancel-copy"), undefined);
    await assert.rejects(f.service.create(f.input, undefined, "cancel-copy"), {
      code: "PROJECT_EXISTS",
    });
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
