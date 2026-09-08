import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureSigning } from "../src/services/signing-config.js";
import { decryptMaterial } from "../src/services/signing-material.js";
import { inspectProject } from "../src/services/project.js";
import {
  atomicWrite,
  readObject,
  fileDigest,
  walk,
} from "../src/core/files.js";
import { object } from "../src/core/errors.js";

function fixture() {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-sign-config-")),
    ),
    project = path.join(root, "application");
  fs.cpSync(
    fileURLToPath(
      new URL("../../resources/templates/application", import.meta.url),
    ),
    project,
    { recursive: true },
  );
  const file = path.join(project, "build-profile.json5");
  atomicWrite(
    file,
    JSON.stringify({
      app: {
        signingConfigs: [
          {
            name: "Existing",
            type: "HarmonyOS",
            material: { storeFile: "preserved" },
          },
        ],
        products: [
          { name: "default", compatibleSdkVersion: 26, runtimeOS: "HarmonyOS" },
          {
            name: "tablet",
            compatibleSdkVersion: 26,
            signingConfig: "Existing",
          },
        ],
      },
      modules: [
        { name: "entry", srcPath: "entry", targets: [{ name: "default" }] },
      ],
    }),
  );
  const descriptor = path.join(root, "input.json"),
    options = {
      keystoreFile: "input.p12",
      appCertFile: "input.cer",
      profileFile: "input.p7b",
      keyAlias: "canary",
      keyPwd: "Chinese 中文 密码",
      keystorePwd: "独立密钥库密码",
    };
  for (const file of [
    options.keystoreFile,
    options.appCertFile,
    options.profileFile,
  ])
    atomicWrite(path.join(root, file), `fixture ${file}`);
  atomicWrite(descriptor, JSON.stringify(options));
  return {
    root,
    project,
    file,
    descriptor,
    options,
    output: path.join(root, "signing"),
  };
}

test("project signing creates private Hvigor material and preserves other products/configurations without reusing an existing destination", async () => {
  const f = fixture();
  try {
    const result = await configureSigning(
      inspectProject(f.project),
      f.descriptor,
      f.output,
      "Personal",
    );
    assert.equal(result.configured, true);
    const app = object(readObject(f.file).app),
      configs = app.signingConfigs as Record<string, unknown>[],
      products = app.products as Record<string, unknown>[],
      material = object(configs[1]!.material);
    assert.equal(products[0]!.signingConfig, "Personal");
    assert.equal(products[1]!.signingConfig, "Existing");
    assert.deepEqual(configs[0], {
      name: "Existing",
      type: "HarmonyOS",
      material: { storeFile: "preserved" },
    });
    assert.equal(
      decryptMaterial(
        path.join(f.output, "material"),
        String(material.keyPassword),
      ),
      f.options.keyPwd,
    );
    assert.equal(
      decryptMaterial(
        path.join(f.output, "material"),
        String(material.storePassword),
      ),
      f.options.keystorePwd,
    );
    assert.equal(
      fileDigest(String(material.storeFile)),
      fileDigest(path.join(f.root, f.options.keystoreFile)),
    );
    const before = fileDigest(f.file),
      original = fileDigest(String(material.storeFile));
    await assert.rejects(
      configureSigning(
        inspectProject(f.project),
        f.descriptor,
        f.output,
        "Next",
      ),
      { code: "SIGN_OUTPUT_EXISTS" },
    );
    await assert.rejects(
      configureSigning(
        inspectProject(f.project),
        f.descriptor,
        f.output + "-next",
        "Personal",
      ),
      { code: "SIGN_CONFIG_EXISTS" },
    );
    assert.equal(fileDigest(f.file), before);
    assert.equal(fileDigest(String(material.storeFile)), original);
    for (const file of walk(f.output)) {
      if (process.platform !== "win32")
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.includes(Buffer.from(f.options.keyPwd)), false);
      assert.equal(bytes.includes(Buffer.from(f.options.keystorePwd)), false);
    }
    const corrupted = Buffer.from(String(material.keyPassword), "hex");
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    assert.throws(() =>
      decryptMaterial(
        path.join(f.output, "material"),
        corrupted.toString("hex"),
      ),
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("signing configuration stops before mutation for stale projects, active watch, missing inputs and cancellation", async () => {
  const f = fixture();
  try {
    const project = inspectProject(f.project);
    fs.appendFileSync(f.file, "\n");
    await assert.rejects(
      configureSigning(project, f.descriptor, f.output, "Personal"),
      { code: "SIGN_PROJECT_CHANGED" },
    );
    const current = inspectProject(f.project),
      before = fileDigest(f.file);
    await assert.rejects(
      configureSigning(
        current,
        f.descriptor,
        f.output,
        "Personal",
        AbortSignal.abort(),
      ),
      { name: "AbortError" },
    );
    const watch = path.join(
      f.project,
      "entry/build/config/deveco-hot-reload.json",
    );
    atomicWrite(watch, "{}");
    await assert.rejects(
      configureSigning(current, f.descriptor, f.output, "Personal"),
      { code: "HOT_SESSION_ACTIVE" },
    );
    fs.rmSync(watch);
    fs.rmSync(path.join(f.root, f.options.profileFile));
    await assert.rejects(
      configureSigning(current, f.descriptor, f.output, "Personal"),
      { code: "ENOENT" },
    );
    atomicWrite(f.descriptor, `{"keystorePwd":"${f.options.keystorePwd}",`);
    await assert.rejects(
      configureSigning(current, f.descriptor, f.output, "Personal"),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "SIGN_DESCRIPTOR_INVALID",
        );
        assert.equal(String(error).includes(f.options.keystorePwd), false);
        return true;
      },
    );
    assert.equal(fs.existsSync(f.output), false);
    assert.equal(fileDigest(f.file), before);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
