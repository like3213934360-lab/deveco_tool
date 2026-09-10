import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite } from "../src/core/files.js";
import { checkerMetadata } from "../src/services/checker-metadata.js";

function fixture(t: TestContext) {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-metadata-")),
    ),
    project = {
      root,
      modules: [
        {
          name: "mobile",
          root: path.join(root, "features/手机"),
          target: "default",
        },
      ],
    },
    sdk = path.join(root, "sdk");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name: string, value: unknown) => {
    const file = path.join(project.modules[0]!.root, "src/main", name);
    atomicWrite(
      file,
      typeof value === "string" ? value : JSON.stringify(value),
    );
    return file;
  };
  write("module.json5", { module: {} });
  const permissions = () =>
    atomicWrite(
      path.join(
        sdk,
        "default/openharmony/toolchains/lib/PermissionDefinitions.json",
      ),
      JSON.stringify({
        definePermissions: [
          { name: "ohos.permission.CAMERA", grantMode: "user_grant" },
          { name: "ohos.permission.INTERNET", grantMode: "system_grant" },
        ],
      }),
    );
  return {
    root,
    project,
    sdk,
    write,
    permissions,
    check: () => checkerMetadata(project, sdk),
  };
}

test("metadata indexes renamed modules and AppScope, all qualifiers, and reports invalid resource directories and JSON", (t) => {
  const f = fixture(t);
  f.write("resources/dark/element/color.json", {
    color: [{ name: "primary", value: "#000000" }],
  });
  f.write("resources/base/media/icon.png", "image");
  f.write("resources/rawfile/nested/data.bin", "data");
  f.write("resources/base/rawfile/data.bin", "misplaced");
  f.write("resources/base/element/string.json", "{");
  atomicWrite(
    path.join(f.root, "AppScope/resources/base/element/string.json"),
    JSON.stringify({ string: [{ name: "app_name", value: "Canary" }] }),
  );
  const result = f.check();
  assert.deepEqual([...result.resources].sort(), [
    "color.primary",
    "media.icon",
    "string.app_name",
  ]);
  assert.deepEqual(result.diagnostics.map((row) => row.rule).sort(), [
    "resource-dir-name",
    "resource-element-invalid",
  ]);
  assert.equal(result.checks.permissions, "unavailable");
  assert.equal(result.checks.app_resources, "executed");
});

test("permission diagnostics distinguish unknown names, missing reasons, missing resources and optional scenes", (t) => {
  const f = fixture(t);
  f.permissions();
  f.write("module.json5", {
    module: {
      requestPermissions: [
        { name: "ohos.permission.NOTIFICATION" },
        { name: "ohos.permission.CAMERA" },
        { name: "ohos.permission.INTERNET" },
      ],
    },
  });
  assert.deepEqual(
    f.check().diagnostics.map((row) => row.rule),
    [
      "permission-name-exists",
      "permission-reason-required",
      "permission-usedscene-recommended",
    ],
  );
  f.write("module.json5", {
    module: {
      requestPermissions: [
        {
          name: "ohos.permission.CAMERA",
          reason: "$string:camera",
          usedScene: { when: "inuse" },
        },
      ],
    },
  });
  assert.deepEqual(
    f.check().diagnostics.map((row) => row.rule),
    ["permission-reason-resource"],
  );
  f.write("resources/base/element/string.json", {
    string: [{ name: "camera", value: "Take a picture" }],
  });
  assert.deepEqual(f.check().diagnostics, []);
  f.write("module.json5", {
    module: {
      definePermissions: [{ name: "com.example.CUSTOM" }],
      requestPermissions: [{ name: "com.example.CUSTOM" }],
    },
  });
  assert.deepEqual(f.check().diagnostics, []);
});

test("declared route profiles use their actual names and reject malformed entries, missing files and escapes", (t) => {
  const f = fixture(t);
  f.write("module.json5", { module: { routerMap: "$profile:custom_routes" } });
  assert.equal(f.check().diagnostics[0]?.rule, "route-map-profile-invalid");
  const profile = "resources/base/profile/custom_routes.json",
    source = "src/main/ets/pages/Page.ets";
  f.write("ets/pages/Page.ets", "@Builder export function make() {}\n");
  for (const value of [
    null,
    { name: "detail", pageSource: source, buildFunction: "make" },
    { name: 1, pageSourceFile: source, buildFunction: "make" },
  ]) {
    f.write(profile, { routerMap: [value] });
    assert.equal(f.check().diagnostics[0]?.rule, "route-map-schema");
  }
  for (const pageSourceFile of [
    "../Outside.ets",
    "C:/Outside.ets",
    "src/main/ets/Missing.ets",
    "src/main/ets/types.d.ets",
  ]) {
    f.write(profile, {
      routerMap: [{ name: "detail", pageSourceFile, buildFunction: "make" }],
    });
    assert.equal(f.check().diagnostics[0]?.rule, "route-map-page-source");
  }
  f.write(profile, {
    routerMap: [
      {
        name: "detail",
        pageSourceFile: source,
        buildFunction: "make",
        data: { marker: true },
      },
    ],
  });
  const valid = f.check();
  assert.deepEqual(valid.diagnostics, []);
  assert.equal(valid.routes[0]?.builder, "make");
  assert.equal(
    valid.routes[0]?.page,
    path.join(f.project.modules[0]!.root, source),
  );
});

test("unreadable or invalid SDK permission metadata never becomes an executed clean check", (t) => {
  const f = fixture(t);
  f.permissions();
  atomicWrite(
    path.join(
      f.sdk,
      "default/openharmony/toolchains/lib/PermissionDefinitions.json",
    ),
    "{}",
  );
  assert.throws(f.check, { code: "CHECK_PERMISSION_DEFINITIONS_INVALID" });
});
