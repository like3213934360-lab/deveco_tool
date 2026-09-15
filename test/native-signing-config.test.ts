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
import { object, ToolError } from "../src/core/errors.js";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { WorkflowEngine, type WorkflowDefinition } from "../src/core/workflows.js";
import { SignatureService } from "../src/services/signature.js";
import { AuthService } from "../src/services/auth.js";
import { Runtime } from "../src/services/runtime.js";

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
      inspectProject(f.project, "default"),
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
        inspectProject(f.project, "default"),
        f.descriptor,
        f.output,
        "Next",
      ),
      { code: "SIGN_OUTPUT_EXISTS" },
    );
    await assert.rejects(
      configureSigning(
        inspectProject(f.project, "default"),
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

test("signing configuration revalidates the captured module targets without falling back to default", async () => {
  const f = fixture();
  try {
    const profile = readObject(f.file);
    profile.modules = [{ name: "entry", srcPath: "entry", targets: [{ name: "default" }, { name: "preview" }] }];
    atomicWrite(f.file, JSON.stringify(profile));
    const selected = inspectProject(f.project, "default", { entry: "preview" });
    const result = await configureSigning(selected, f.descriptor, f.output, "Personal");
    assert.equal(result.configured, true);
    assert.equal(inspectProject(f.project, "default", { entry: "preview" }).modules[0]?.target, "preview");
    assert.equal(fileDigest(f.file), result.build_profile_sha256);
    await assert.rejects(configureSigning(selected, f.descriptor, f.output + "-new", "New"), { code: "SIGN_PROJECT_CHANGED" });
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("signing configuration stops before mutation for stale projects, active watch, missing inputs and cancellation", async () => {
  const f = fixture();
  try {
    const project = inspectProject(f.project, "default");
    fs.appendFileSync(f.file, "\n");
    await assert.rejects(
      configureSigning(project, f.descriptor, f.output, "Personal"),
      { code: "SIGN_PROJECT_CHANGED" },
    );
    const current = inspectProject(f.project, "default"),
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

test("public signing workflow settles an existing configuration before publication and recovers a lost publication receipt", async (t) => {
  const f = fixture(), store = new StateStore(path.join(f.root, "state")),
    processes = new ProcessService(), auth = new AuthService(store, processes),
    signatures = new SignatureService(processes, store, auth);
  const runtime = Object.assign(Object.create(Runtime.prototype) as Runtime, {
    store, signatures, project: () => inspectProject(f.project, "default"),
  });
  const definitions = (Reflect.get(runtime, "definitions") as () => WorkflowDefinition[]).call(runtime),
    engine = new WorkflowEngine(store, definitions, async () => {}),
    node = "execute_native_operation", child = `${node}:private:native-signature`,
    before = fileDigest(f.file);
  const start = (name: string) => engine.start("native_operation", {
    project_path: f.project, product: "default",
    parameters: { tool: "app_signature", input: { action: "configure", file: f.descriptor, output: f.output, options: { name } } },
  }).run_id;
  const finish = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const result = await engine.status(id, 100);
      if (["failed", "needs_input", "succeeded"].includes(result.status)) return result;
    }
    throw new Error("Signing workflow did not settle");
  };
  try {
    const rejected = start("Existing"), failed = await finish(rejected);
    assert.equal(failed.status, "failed");
    assert.equal(object(failed.error).code, "SIGN_CONFIG_EXISTS");
    for (const operation of [node, child]) assert.equal(store.operationState(rejected, operation), "failed");
    assert.equal(fileDigest(f.file), before);
    assert.equal(fs.existsSync(f.output), false);
    await engine.resume(rejected);
    assert.equal((await finish(rejected)).status, "failed");
    assert.equal(fs.existsSync(f.output), false);

    // Lose only the encrypted child completion receipt after real publication.
    // The prepared commit remains durable and must be reconciled, not re-run.
    let lost = false;
    const journal = store as unknown as { receipt(runId: string, node: string, result: unknown): void },
      receipt = journal.receipt.bind(store);
    t.mock.method(journal, "receipt", (runId: string, operation: string, result: unknown) => {
      if (!lost && operation === child) { lost = true; throw new ToolError("RECEIPT_INTERRUPTED", "Injected receipt interruption"); }
      return receipt(runId, operation, result);
    });
    const interrupted = start("Current"), uncertain = await finish(interrupted);
    assert.equal(uncertain.status, "needs_input");
    assert.equal(lost, true);
    assert.equal(fs.existsSync(f.output), true);
    const published = fileDigest(f.file), material = walk(f.output).map(file => [file, fileDigest(file)]);
    assert.notEqual(published, before);
    for (const operation of [node, child]) assert.equal(store.operationState(interrupted, operation), "started");
    await engine.resume(interrupted, { action: "recheck" });
    assert.equal((await finish(interrupted)).status, "succeeded");
    assert.equal(fileDigest(f.file), published);
    assert.deepEqual(walk(f.output).map(file => [file, fileDigest(file)]), material);
    assert.equal((object(readObject(f.file).app).signingConfigs as unknown[]).length, 2);
    for (const operation of [node, child]) assert.equal(store.operationState(interrupted, operation), "done");
  } finally {
    await engine.close(); await processes.close(); store.close();
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
