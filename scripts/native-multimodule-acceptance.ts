import { finishAcceptance } from "./lib/acceptance-report.js";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { discoverToolchain } from "../src/core/toolchain.js";
import { atomicWrite, readObject, fileDigest } from "../src/core/files.js";
import { errorResult, object } from "../src/core/errors.js";
import { inspectApplicationPackages } from "../src/services/package.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { nativeOperation } from "./lib/native-operation.js";

let completed = false;
const tested = evidenceIdentity(),
  root = path.resolve(z.string().min(1).parse(process.argv[2]));
const signing = process.argv.length > 3 ? (() => {
  const [preparedRoot, signingRoot] = z.tuple([z.string(), z.string()]).parse(process.argv.slice(3));
  const prepared = z.object({ bundle_name: z.string().startsWith("com.deveco.mcpacceptance.") }).parse(readObject(path.join(preparedRoot, "prepared.json")));
  const journal = z.object({ operations: z.object({
    preflight: z.object({ result: z.object({ target: z.string() }) }),
    configure: z.object({ status: z.literal("succeeded") }),
    certificate: z.object({ result: z.object({ path: z.string(), sha256: z.string() }) }),
  }) }).parse(readObject(path.join(signingRoot, "operations.private.json")));
  assert.equal(fileDigest(journal.operations.certificate.result.path), journal.operations.certificate.result.sha256);
  const options = z.record(z.string(), z.string()).parse(readObject(path.join(signingRoot, "project-signing.private.json")));
  return { bundle: prepared.bundle_name, target: journal.operations.preflight.result.target, options };
})() : undefined;
const bundle = signing?.bundle ?? "com.deveco.nativemodules";
assert.equal(fs.existsSync(root), false, "Acceptance directory must be new");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
let runtime = new Runtime();
const
  projectPath = path.join(root, "application"),
  observations: {
    name: string;
    elapsed_ms: number;
    result?: unknown;
    error?: unknown;
  }[] = [];
const write = (file: string, value: unknown) =>
  atomicWrite(path.join(projectPath, file), JSON.stringify(value, null, 2));
async function observe(name: string, execute: () => Promise<unknown>) {
  const started = performance.now();
  try {
    const result = await execute();
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      result,
    });
    process.stdout.write(`${name}: passed\n`);
    return result;
  } catch (error) {
    observations.push({
      name,
      elapsed_ms: performance.now() - started,
      error: errorResult(error),
    });
    process.stdout.write(`${name}: failed\n`);
    throw error;
  } finally {
    atomicWrite(
      path.join(root, "evidence.json"),
      JSON.stringify(
        { tested, toolchain: discoverToolchain(), observations },
        null,
        2,
      ),
    );
  }
}
try {
  const sdk = z
    .object({ data: z.object({ platformVersion: z.string() }) })
    .parse(
      readObject(path.join(discoverToolchain().sdk, "default/sdk-pkg.json")),
    ).data.platformVersion;
  await observe("create_multimodule_fixture", async () => {
    await runtime.projects.create({
      project_path: projectPath,
      app_name: "NativeModules",
      bundle_name: bundle,
      sdk_version: sdk,
    });
    const profile = readObject(path.join(projectPath, "build-profile.json5")),
      app = object(profile.app),
      products = z.array(z.record(z.string(), z.unknown())).parse(app.products);
    app.products = [products[0], { ...products[0], name: "tablet" }];
    profile.modules = ["entry", "feature", "shared", "library"].map((name) => ({
      name,
      srcPath: `./${name}`,
      targets: [{ name: "default", applyToProducts: ["default", "tablet"] }],
    }));
    write("build-profile.json5", profile);
    fs.cpSync(
      path.join(projectPath, "entry"),
      path.join(projectPath, "feature"),
      { recursive: true },
    );
    const feature = readObject(
      path.join(projectPath, "feature/src/main/module.json5"),
    );
    Object.assign(object(feature.module), { name: "feature", type: "feature" });
    write("feature/src/main/module.json5", feature);
    for (const [name, kind] of [
      ["library", "har"],
      ["shared", "shared"],
    ] as const) {
      write(`${name}/src/main/module.json5`, {
        module: {
          name,
          type: kind,
          deviceTypes: ["phone", "tablet"],
          ...(kind === "shared"
            ? { deliveryWithInstall: true, installationFree: false }
            : {}),
        },
      });
      write(`${name}/build-profile.json5`, {
        apiType: "stageMode",
        targets: [{ name: "default" }],
      });
      write(`${name}/oh-package.json5`, {
        name,
        version: "1.0.0",
        main: "Index.ets",
        dependencies: {},
      });
      atomicWrite(
        path.join(projectPath, name, "hvigorfile.ts"),
        `import { ${kind === "har" ? "harTasks" : "hspTasks"} as system } from '@ohos/hvigor-ohos-plugin';\nexport default { system, plugins: [] };\n`,
      );
      atomicWrite(
        path.join(projectPath, name, "Index.ets"),
        `export function ${name}Message(): string { return '${name}'; }\n`,
      );
    }
    for (const name of ["entry", "feature"]) {
      const nativeProfile = readObject(path.join(projectPath, name, "build-profile.json5"));
      nativeProfile.buildOption = { ...object(nativeProfile.buildOption), externalNativeOptions: {
        path: "./src/main/cpp/CMakeLists.txt", arguments: "", cppFlags: "", abiFilters: ["arm64-v8a", "x86_64"],
      } };
      write(`${name}/build-profile.json5`, nativeProfile);
      atomicWrite(path.join(projectPath, name, "src/main/cpp/CMakeLists.txt"), `cmake_minimum_required(VERSION 3.5.0)\nproject(${name}_canary)\nadd_library(${name}_canary SHARED canary.cpp)\n`);
      atomicWrite(path.join(projectPath, name, "src/main/cpp/canary.cpp"), `int ${name}_value() { return 7; }\n`);
      write(`${name}/oh-package.json5`, {
        name,
        version: "1.0.0",
        dependencies: { library: "file:../library", shared: "file:../shared" },
      });
      atomicWrite(
        path.join(projectPath, name, "src/main/ets/pages/Index.ets"),
        "import { libraryMessage } from 'library';\nimport { sharedMessage } from 'shared';\n@Entry\n@Component\nstruct Index { build() { Column() { Text(libraryMessage() + sharedMessage()).id('ModuleEvidence') } } }\n",
      );
    }
    return {
      modules: ["entry", "feature", "library", "shared"],
      products: ["default", "tablet"],
    };
  });
  for (const product of ["default", "tablet"]) {
    const project = runtime.projects.resolve(projectPath, product);
    await observe(`${product}_sync`, () => runtime.projects.sync(project));
    for (const [task, modules, extension] of [
      ["assembleHar", ["library"], ".har"],
      ["assembleHsp", ["shared"], ".hsp"],
      ["assembleHap", ["entry", "feature"], ".hap"],
    ] as const) {
      await observe(`${product}_${task}`, async () => {
        const result = await runtime.projects.build(project, {
          task,
          modules: [...modules],
        });
        assert.ok(result.artifacts.length >= modules.length);
        assert.ok(
          result.artifacts.every((file) => file.path.endsWith(extension)),
        );
        return result;
      });
    }
    await observe(`${product}_package_set_identity`, async () => {
      const packages = [
        ...runtime.projects.buildArtifacts(
          project,
          project.modules
            .filter((m) => ["entry", "feature"].includes(m.name))
            .map((m) => m.root),
        ),
        ...runtime.projects.buildArtifacts(
          project,
          project.modules.filter((m) => m.name === "shared").map((m) => m.root),
          "assembleHsp",
        ),
      ].filter((file) => /-unsigned\.(hap|hsp)$/.test(file.path));
      assert.equal(packages.length, 3);
      const identity = await inspectApplicationPackages(
        packages.map((file) => file.path),
        {
          bundle_name: bundle,
          module: "entry",
          ability: "EntryAbility",
        },
      );
      assert.deepEqual(identity.modules.map((module) => module.name).sort(), [
        "entry",
        "feature",
        "shared",
      ]);
      return { packages, identity };
    });
    await observe(`${product}_default_task_selection`, async () => {
      const result = await runtime.projects.build(project, {});
      assert.ok(result.artifacts.length >= 2);
      assert.ok(result.artifacts.every((file) => file.path.endsWith(".hap")));
      return result;
    });
    await observe(`${product}_application_dependency_closure`, async () => {
      const result = await runtime.projects.buildApplication(project, {
        modules: ["entry"],
      });
      const packages = result.artifacts.filter((file) =>
        /-unsigned\.(hap|hsp)$/.test(file.path),
      );
      assert.equal(packages.length, 2);
      const identity = await inspectApplicationPackages(
        packages.map((file) => file.path),
        {
          bundle_name: bundle,
          module: "entry",
          ability: "EntryAbility",
        },
      );
      assert.deepEqual(identity.modules.map((module) => module.name).sort(), [
        "entry",
        "shared",
      ]);
      assert.deepEqual(
        result.dependency_builds.map((build) => build.modules),
        [["shared"]],
      );
      return { result, identity };
    });
    await observe(`${product}_cross_module_lsp`, async () => {
      const results: unknown[] = [];
      for (const module of ["entry", "feature"]) {
        const definition = await runtime.call("lsp", { project_path: projectPath, product, action: "definition", file: `${module}/src/main/ets/pages/Index.ets`, line: 0, character: 12 });
        assert.match(JSON.stringify(definition), /library.*Index\.ets/);
        results.push(definition);
      }
      return results;
    });
    for (const abi of ["arm64-v8a", "x86_64"]) await observe(`${product}_${abi}_cpp_modules`, async () => {
      const files = ["entry", "feature"].map((module) => `${module}/src/main/cpp/canary.cpp`);
      const original = files.map((file) => fs.readFileSync(path.join(projectPath, file), "utf8"));
      const good = await runtime.call("check_cpp_files", { project_path: projectPath, product, abi, files });
      assert.doesNotMatch(JSON.stringify(good), /undeclared identifier/);
      try {
        for (const [index, file] of files.entries()) atomicWrite(path.join(projectPath, file), original[index]!.replace("return 7", `return missing_${index}`));
        const bad = await runtime.call("check_cpp_files", { project_path: projectPath, product, abi, files });
        assert.match(JSON.stringify(bad), /missing_0/);
        assert.match(JSON.stringify(bad), /missing_1/);
        assert.match(JSON.stringify(bad), new RegExp(abi));
        return { good, bad };
      } finally { for (const [index, file] of files.entries()) atomicWrite(path.join(projectPath, file), original[index]!); }
    });
    if (signing) await observe(`${product}_signed_package_set_recovery`, async () => {
      const unsigned = [
        ...runtime.projects.buildArtifacts(project, project.modules.filter((m) => ["entry", "feature"].includes(m.name)).map((m) => m.root)),
        ...runtime.projects.buildArtifacts(project, project.modules.filter((m) => m.name === "shared").map((m) => m.root), "assembleHsp"),
      ].filter((file) => /-unsigned\.(hap|hsp)$/.test(file.path));
      assert.equal(unsigned.length, 3);
      const packages: { path: string; sha256: string }[] = [];
      for (const [index, file] of unsigned.entries()) {
        const output = path.join(root, "signed", product, `${index}${path.extname(file.path)}`);
        const signed = z.object({ path: z.literal(output), sha256: z.string() }).parse(await nativeOperation(runtime, "app_signature", {
          action: "sign", file: file.path, output, options: signing.options,
        }, path.join(root, `${product}-sign-${index}.operation.private.json`)));
        await runtime.call("app_signature", { action: "verify", file: signed.path });
        packages.push(signed);
      }
      const input = { packages, target: signing.target, app: { bundle_name: bundle, module: "entry", ability: "EntryAbility" } };
      await inspectApplicationPackages(packages.map((file) => file.path), input.app);
      const originalShell = runtime.devices.shell.bind(runtime.devices);
      let installs = 0;
      runtime.devices.shell = async (...args) => {
        const result = await originalShell(...args);
        if (args[1][0] === "sh" && args[1][2]?.includes("mkdir -m 700") && args[1][2].includes("'bm' 'install'")) {
          installs++;
          throw new Error("Acceptance injected response loss after the real signed package-set install receipt");
        }
        return result;
      };
      const request = { action: "start", workflow: "app_deploy", request_key: `multimodule-${product}`, input };
      const submitted = z.object({ run_id: z.string() }).parse(await runtime.call("workflow_run", request));
      atomicWrite(path.join(root, `${product}-deploy.operation.private.json`), JSON.stringify(submitted));
      const wait = async (expected: string) => {
        const until = Date.now() + 180000;
        for (;;) {
          const status = z.object({ status: z.string(), error: z.unknown().optional() }).parse(await runtime.call("workflow_run", { action: "status", run_id: submitted.run_id, wait_ms: 1000 }));
          if (!["queued", "running"].includes(status.status)) { assert.equal(status.status, expected, JSON.stringify(status)); return status; }
          assert.ok(Date.now() < until, "Signed deployment did not settle");
        }
      };
      await wait("needs_input");
      assert.equal(installs, 1);
      assert.equal((await runtime.close()).closed, true);
      runtime = new Runtime();
      const recoveredShell = runtime.devices.shell.bind(runtime.devices);
      runtime.devices.shell = async (...args) => {
        assert.ok(!(args[1][0] === "sh" && args[1][2]?.includes("mkdir -m 700") && args[1][2].includes("'bm' 'install'")), "Recovery must not repeat a completed install");
        return recoveredShell(...args);
      };
      try {
      await runtime.call("workflow_run", { action: "resume", run_id: submitted.run_id, resume_input: { action: "recheck" } });
      await wait("succeeded");
      assert.equal(z.object({ run_id: z.string() }).parse(await runtime.call("workflow_run", request)).run_id, submitted.run_id);
      await runtime.call("verify_ui", { target: signing.target, assert: { visible: { key: "ModuleEvidence", text: "libraryshared", bundle_name: bundle }, timeoutMs: 10000 } });
      for (const module of ["entry", "feature", "shared"]) assert.ok(packages.length === 3 && unsigned.some((file) => file.path.includes(`/${module}/`)));
      return { run_id: submitted.run_id, packages, install_dispatches: installs, recovered_without_reinstall: true };
      } finally {
        // The no-reinstall assertion belongs to this recovery attempt only.
        runtime.devices.shell = recoveredShell;
      }
    });
  }
  completed = true;
} catch (error) {
  process.stderr.write(`${JSON.stringify(errorResult(error))}\n`);
  process.exitCode = 1;
} finally {
  const closed = await runtime.close();
  finishAcceptance(path.join(root, "evidence.json"), tested, completed, closed.closed);
}
