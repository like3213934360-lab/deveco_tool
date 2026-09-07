import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { Runtime } from "../src/services/runtime.js";
import { discoverToolchain } from "../src/core/toolchain.js";
import { atomicWrite, readObject } from "../src/core/files.js";
import { errorResult, object } from "../src/core/errors.js";
import { inspectApplicationPackages } from "../src/services/package.js";
import { evidenceIdentity } from "./lib/evidence.js";

const tested = evidenceIdentity(),
  root = path.resolve(z.string().min(1).parse(process.argv[2]));
assert.equal(fs.existsSync(root), false, "Acceptance directory must be new");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.DEVECO_STATE_DIR = path.join(root, "state");
const runtime = new Runtime(),
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
      bundle_name: "com.deveco.nativemodules",
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
          bundle_name: "com.deveco.nativemodules",
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
          bundle_name: "com.deveco.nativemodules",
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
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify(errorResult(error))}\n`);
  process.exitCode = 1;
} finally {
  await runtime.close();
}
