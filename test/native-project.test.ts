import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectService } from "../src/services/project.js";
import { ProcessService } from "../src/core/process.js";
import { atomicWrite, destinationPath } from "../src/core/files.js";

function fixture() {
  const root = fs.realpathSync(
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
