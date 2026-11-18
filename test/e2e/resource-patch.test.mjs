import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import JSON5 from "json5";
import { app, sha } from "../support/acceptance.mjs";

function modulePage(raw, res, context, imports = "", label = "'code-original'") {
  return `import { util } from '@kit.ArkTS';
import { fileIo } from '@kit.CoreFileKit';
${imports}

@Entry
@Component
struct Index {
  @State raw: string = '';
  @State res: string = '';

  aboutToAppear(): void {
    const host = this.getUIContext().getHostContext()!;
    const context = ${context};
    this.raw = util.TextDecoder.create('utf-8').decodeToString(context.resourceManager.getRawFileContentSync('${raw}'));
    this.res = fileIo.readTextSync(context.resourceDir + '/${res}');
  }

  build() {
    Column() {
      Text(this.raw)
      Text(this.res)
      Text(${label})
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
  }
}
`;
}

test("shared module resources patch the installed HSP and restore the package set", async (t) => {
  const { call, raw, job, project, target, file, visible, launch, defer } = await app(t, true, "emulator");
  const name = "patchshared", depName = "patchshim", root = path.join(project, name), depRoot = path.join(project, depName);
  for (const file of [root, depRoot]) assert.ok(!fs.existsSync(file), `Refusing to overwrite ${file}`);
  const profile = path.join(project, "build-profile.json5"), manifest = path.join(project, "entry/oh-package.json5"), page = path.join(project, file);
  const originals = [profile, manifest, page].map((file) => [file, fs.readFileSync(file)]);
  const deploy = (extra = {}) => job("run", { action: "build_run", project, target, run_mode: "full", wait: 0, ...extra });
  defer(async () => {
    for (const [file, contents] of originals) fs.writeFileSync(file, contents);
    for (const module of [root, depRoot]) fs.rmSync(module, { recursive: true, force: true });
    await deploy();
  });
  const model = JSON5.parse(fs.readFileSync(profile, "utf8")), pkg = JSON5.parse(fs.readFileSync(manifest, "utf8"));
  assert.ok(!pkg.dependencies?.[name]);
  const sharedCode = `import { assetModuleName } from '${depName}';\nexport function assetModule(): string { return assetModuleName(); }\nexport function assetLabel(): string { return 'hsp-code-original'; }\n`;
  for (const [lib, moduleName, source, dependencies] of [
    [depRoot, depName, `export function assetModuleName(): string { return '${name}'; }\n`, {}],
    [root, name, sharedCode, { [depName]: `file:../${depName}` }],
  ]) {
    assert.ok(!model.modules.some((module) => module.name === moduleName));
    fs.mkdirSync(path.join(lib, "src/main/ets"), { recursive: true });
    fs.writeFileSync(path.join(lib, "src/main/module.json5"), JSON.stringify({ module: { name: moduleName, type: "shared", deviceTypes: ["phone"], deliveryWithInstall: true, installationFree: false } }));
    fs.writeFileSync(path.join(lib, "build-profile.json5"), JSON.stringify({ apiType: "stageMode", buildOption: {}, targets: [{ name: "default" }] }));
    fs.writeFileSync(path.join(lib, "hvigorfile.ts"), "import { hspTasks } from '@ohos/hvigor-ohos-plugin';\nexport default { system: hspTasks, plugins: [] };\n");
    fs.writeFileSync(path.join(lib, "oh-package.json5"), JSON.stringify({ name: moduleName, version: "1.0.0", main: "Index.ets", dependencies }));
    fs.writeFileSync(path.join(lib, "Index.ets"), source);
    model.modules.push({ name: moduleName, srcPath: `./${moduleName}`, targets: [{ name: "default", applyToProducts: ["default"] }] });
  }
  pkg.dependencies = { ...pkg.dependencies, [name]: `file:../${name}` };
  fs.writeFileSync(profile, JSON.stringify(model));
  fs.writeFileSync(manifest, JSON.stringify(pkg));
  const rawName = "mcp_hsp_raw.txt", resName = "mcp_hsp_res.txt";
  const rawfile = path.join(root, "src/main/resources/rawfile", rawName), resfile = path.join(root, "src/main/resources/resfile", resName);
  for (const [file, text] of [[rawfile, "hsp-raw-original"], [resfile, "hsp-res-original"]]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  fs.writeFileSync(page, modulePage(rawName, resName, "host.createModuleContext(assetModule())", `import { assetModule, assetLabel } from '${name}';`, "assetLabel()"));
  const invalid = await raw("run", { action: "build_run", project, target, hot_reload_module: name });
  assert.equal(invalid.isError, true); assert.equal(invalid.data.error.code, "INVALID_INPUT");
  const { result } = await deploy({ hot_reload: true, hot_reload_module: name });
  assert.deepEqual(result.installed.packages.map((p) => path.extname(p)).sort(), [".hap", ".hsp", ".hsp"]);
  const packages = result.installed.package_files.map(({ path: file, sha256 }) => [file, sha256]);
  await visible("hsp-raw-original"); await visible("hsp-res-original"); await visible("hsp-code-original");

  const patch = (files) => call("hot_reload", { action: "apply", project, target, module: name, files, restart: true });
  const source = path.join(root, "Index.ets");
  fs.writeFileSync(source, sharedCode.replace("hsp-code-original", "hsp-code-patched"));
  const code = await patch([source]);
  assert.deepEqual(code.files, [path.relative(project, source)]);
  await visible("hsp-code-patched"); await visible("hsp-raw-original"); await visible("hsp-res-original");
  fs.writeFileSync(rawfile, "hsp-raw-changed");
  const first = await patch([rawfile]);
  assert.equal(first.resource_files, 1); assert.equal(first.launch.started, true);
  await visible("hsp-raw-changed"); await visible("hsp-res-original");
  fs.writeFileSync(resfile, "hsp-res-changed");
  const second = await patch([resfile]);
  assert.equal(second.resource_files, 2); assert.ok(second.patch_version > first.patch_version);
  await visible("hsp-raw-changed"); await visible("hsp-res-changed"); await visible("hsp-code-patched");
  for (const [file, digest] of packages) assert.equal(sha(fs.readFileSync(file)), digest);

  const reset = await call("hot_reload", { action: "reset", project, target, module: name });
  assert.equal(reset.patch_version, 0); assert.equal(reset.packages.length, 3);
  await launch();
  await visible("hsp-raw-original"); await visible("hsp-res-original"); await visible("hsp-code-original");

  await t.test("entry and shared HQFs are installed, replaced and reset together", async () => {
    const originalPage = fs.readFileSync(page, "utf8");
    fs.writeFileSync(source, sharedCode);
    fs.writeFileSync(rawfile, "hsp-raw-original");
    fs.writeFileSync(resfile, "hsp-res-original");
    const grouped = (await deploy({ hot_reload: true, hot_reload_module: [name, "entry"] })).result;
    const originals = grouped.installed.package_files.map(({ path: file, sha256 }) => [file, sha256]);
    await visible("hsp-code-original");
    fs.writeFileSync(source, sharedCode.replace("hsp-code-original", "hsp-group-patch"));
    fs.writeFileSync(page, originalPage.replace("Text(assetLabel())", "Text(assetLabel())\n      Text('entry-group-patch')"));
    const apply = (files) => call("hot_reload", { action: "apply", project, target, module: "entry", files, restart: true });
    const together = await apply([source, page]);
    assert.deepEqual(together.patches.map((p) => p.module).sort(), ["entry", name]);
    await visible("hsp-group-patch"); await visible("entry-group-patch");
    fs.writeFileSync(rawfile, "hsp-resource-group-patch");
    const patchedPage = fs.readFileSync(page, "utf8");
    fs.writeFileSync(page, patchedPage.replace("entry-group-patch", "unsent-entry-edit"));
    const refused = await raw("hot_reload", { action: "apply", project, target, module: "entry", files: [rawfile], restart: true });
    assert.equal(refused.data.error.code, "CONFLICT");
    await visible("entry-group-patch"); await visible("hsp-raw-original");
    fs.writeFileSync(page, patchedPage);
    const cumulative = await apply([rawfile]);
    assert.deepEqual(cumulative.patches.map((p) => p.module).sort(), ["entry", name]);
    assert.ok(cumulative.patch_version > together.patch_version);
    await visible("hsp-group-patch"); await visible("entry-group-patch"); await visible("hsp-resource-group-patch");
    for (const [file, digest] of originals) assert.equal(sha(fs.readFileSync(file)), digest);
    const reset = await call("hot_reload", { action: "reset", project, target, module: "entry" });
    assert.equal(reset.patch_version, 0); assert.equal(reset.packages.length, 3);
    await launch();
    await visible("hsp-code-original"); await visible("hsp-raw-original");
    assert.equal((await call("ui", { action: "find", target, selector: { text: "entry-group-patch", exact: true } })).count, 0);
  });
});

test("feature module patches and auto runs preserve the installed HAP for source edits", async (t) => {
  const { call, job, project, target, bundle, visible, defer } = await app(t, true, "emulator");
  const name = "patchfeature", root = path.join(project, name), entry = path.join(project, "entry");
  assert.ok(!fs.existsSync(root), `Refusing to overwrite ${root}`);
  const profile = path.join(project, "build-profile.json5"), originalProfile = fs.readFileSync(profile);
  const run = (args) => job("run", { action: "build_run", project, target, wait: 0, ...args });
  defer(async () => {
    fs.writeFileSync(profile, originalProfile);
    fs.rmSync(root, { recursive: true, force: true });
    await run({ run_mode: "full" });
  });
  fs.mkdirSync(root);
  for (const file of ["src", "build-profile.json5", "oh-package.json5", "hvigorfile.ts", "obfuscation-rules.txt"])
    fs.cpSync(path.join(entry, file), path.join(root, file), { recursive: true });
  const manifest = path.join(root, "src/main/module.json5"), { module } = JSON5.parse(fs.readFileSync(manifest, "utf8"));
  module.name = name;
  module.type = "feature";
  module.mainElement = module.abilities[0].name = "FeatureAbility";
  delete module.abilities[0].skills;
  delete module.extensionAbilities;
  fs.writeFileSync(manifest, JSON.stringify({ module }));
  const pkgFile = path.join(root, "oh-package.json5"), pkg = JSON5.parse(fs.readFileSync(pkgFile, "utf8"));
  fs.writeFileSync(pkgFile, JSON.stringify({ ...pkg, name }));
  const config = JSON5.parse(originalProfile.toString());
  assert.ok(!config.modules.some((module) => module.name === name));
  config.modules.push({ name, srcPath: `./${name}`, targets: [{ name: "default", applyToProducts: ["default"] }] });
  fs.writeFileSync(profile, JSON.stringify(config));
  const asset = (kind, filename) => path.join(root, "src/main/resources", kind, filename);
  const rawName = "mcp_feature_raw.txt", resName = "mcp_feature_res.txt";
  const rawfile = asset("rawfile", rawName), resfile = asset("resfile", resName);
  for (const [file, text] of [[rawfile, "feature-raw-original"], [resfile, "feature-res-original"]]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const page = path.join(root, "src/main/ets/pages/Index.ets"), source = modulePage(rawName, resName, `host.createModuleContext('${name}')`);
  fs.writeFileSync(page, source);
  const modules = ["entry", name], selection = { modules, module: name };
  const baseline = await run({ ...selection, run_mode: "full", hot_reload: true, hot_reload_module: name });
  assert.equal(baseline.result.installed.packages.length, 2);
  await visible("feature-raw-original");

  await t.test("explicit feature rawfile and resfile patch", async () => {
    fs.writeFileSync(rawfile, "feature-raw-patched");
    fs.writeFileSync(resfile, "feature-res-patched");
    try {
      const patched = await call("hot_reload", { action: "apply", project, target, module: name, files: [rawfile, resfile], restart: true });
      assert.equal(patched.resource_files, 2); assert.equal(patched.launch.started, true);
      const screen = await call("ui", { action: "tree", target, bundle });
      assert.match(screen.tree, /feature-raw-patched/);
      assert.match(screen.tree, /feature-res-patched/);
    } finally {
      fs.writeFileSync(rawfile, "feature-raw-original");
      fs.writeFileSync(resfile, "feature-res-original");
      const reset = await call("hot_reload", { action: "reset", project, target, module: name });
      assert.equal(reset.patch_version, 0); assert.equal(reset.packages.length, 2);
      await call("run", { action: "launch", project, target, module: name });
      await visible("feature-raw-original");
    }
  });

  const auto = () => run({ ...selection, run_mode: "auto" });
  const first = (await auto()).result;
  assert.equal(first.path, "full"); assert.equal(first.baseline, undefined);
  const second = (await auto()).result;
  assert.equal(second.path, "full"); assert.equal(second.baseline?.recorded, true);
  const packageBytes = second.installed.package_files.map(({ path: file, sha256 }) => [file, sha256]);
  const installedAt = async () => {
    const { output } = await call("device", { action: "shell", target, command: `bm dump -n ${bundle}` });
    const times = [...output.matchAll(/"(installTime|updateTime)":\s*(\d+)/g)].map(([, key, value]) => `${key}:${value}`);
    for (const field of ["installTime", "updateTime"]) assert.ok(times.some((entry) => entry.startsWith(`${field}:`)), `Missing ${field}`);
    return times;
  };
  const stamp = await installedAt();
  fs.writeFileSync(page, source.replace("code-original", "code-auto-patched"));
  const incremental = (await auto()).result;
  assert.equal(incremental.path, "hot_reload", incremental.fallback_reason);
  assert.deepEqual(incremental.hot_reload.files, [path.relative(project, page)]);
  assert.equal(incremental.build, undefined); assert.equal(incremental.installed, null);
  assert.equal(incremental.launch.started, true);
  await visible("code-auto-patched");
  assert.deepEqual(await installedAt(), stamp);
  for (const [file, digest] of packageBytes) assert.equal(sha(fs.readFileSync(file)), digest);
  const unchanged = (await auto()).result;
  assert.equal(unchanged.path, "relaunch"); assert.equal(unchanged.installed, null);
  await visible("code-auto-patched");
  assert.deepEqual(await installedAt(), stamp);

  fs.writeFileSync(resfile, "feature-res-full-deploy");
  const changedResource = (await auto()).result;
  assert.equal(changedResource.path, "full"); assert.match(changedResource.fallback_reason, /resources/);
  await visible("feature-res-full-deploy");
});

test("resource patches preserve prior edits and restore the installed baseline", async (t) => {
  const { call, raw, job, project, target, file, visible, launch, defer, info, directory } = await app(t, true, "emulator");
  assert.ok(info.emulator.name, "Use a disposable emulator");
  const page = path.join(project, file), original = fs.readFileSync(page);
  const rawfile = path.join(project, "entry/src/main/resources/rawfile/deveco_resource_proof.txt");
  const resfile = path.join(project, "entry/src/main/resources/resfile/deveco_resource_proof.txt");
  const har = path.join(directory, "ResourceHar"), bridge = path.join(directory, "BridgeHar");
  const harRawfile = path.join(har, "src/main/resources/rawfile/deveco_har_proof.txt");
  const harSource = path.join(har, "Index.ets");
  const profile = path.join(project, "build-profile.json5"), manifest = path.join(project, "entry/oh-package.json5");
  const originalProfile = fs.readFileSync(profile), originalManifest = fs.readFileSync(manifest);
  for (const resource of [rawfile, resfile]) assert.ok(!fs.existsSync(resource), `Refusing to overwrite ${resource}`);
  const deploy = (hot_reload = false) => job("run", { action: "build_run", project, target, hot_reload, run_mode: "full", wait: 0 });
  defer(async () => {
    fs.writeFileSync(page, original);
    fs.writeFileSync(profile, originalProfile);
    fs.writeFileSync(manifest, originalManifest);
    for (const resource of [rawfile, resfile]) fs.rmSync(resource, { force: true });
    await deploy();
  });
  fs.copyFileSync(new URL("../fixtures/resource-patch-page.ets", import.meta.url), page);
  const harCode = "export const assetName = 'deveco_har_proof.txt';\nexport function harLabel(): string { return 'har-code-original'; }\n";
  const model = JSON5.parse(originalProfile.toString());
  for (const [root, name, code, dependencies] of [
    [har, "patchassets", harCode, {}],
    [bridge, "patchbridge", "export { assetName, harLabel } from 'patchassets';\n", { patchassets: `file:${path.relative(bridge, har)}` }],
  ]) {
    assert.ok(!model.modules.some((module) => module.name === name));
    fs.mkdirSync(path.join(root, "src/main"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/main/module.json5"), JSON.stringify({ module: { name, type: "har", deviceTypes: ["phone"] } }));
    fs.writeFileSync(path.join(root, "build-profile.json5"), "{ apiType: 'stageMode', targets: [{ name: 'default' }] }");
    fs.writeFileSync(path.join(root, "hvigorfile.ts"), "import { harTasks } from '@ohos/hvigor-ohos-plugin';\nexport default { system: harTasks, plugins: [] };\n");
    fs.writeFileSync(path.join(root, "oh-package.json5"), JSON.stringify({ name, version: "1.0.0", main: "Index.ets", dependencies }));
    fs.writeFileSync(path.join(root, "Index.ets"), code);
    model.modules.push({ name, srcPath: path.relative(project, root), targets: [{ name: "default", applyToProducts: ["default"] }] });
  }
  fs.writeFileSync(profile, JSON.stringify(model));
  const pkg = JSON5.parse(originalManifest.toString());
  assert.ok(!pkg.dependencies?.patchbridge);
  pkg.dependencies = { ...pkg.dependencies, patchbridge: `file:${path.relative(path.dirname(manifest), bridge)}` };
  fs.writeFileSync(manifest, JSON.stringify(pkg));
  for (const [resource, content] of [[rawfile, "raw-original"], [resfile, "res-original"], [harRawfile, "har-original"]]) {
    fs.mkdirSync(path.dirname(resource), { recursive: true });
    fs.writeFileSync(resource, content, { flag: "wx" });
  }
  const baseline = await deploy(true);
  const packages = baseline.result.build.artifacts.filter((artifact) => artifact.endsWith(".hap"));
  assert.ok(packages.length > 0);
  const packageDigests = packages.map((artifact) => sha(fs.readFileSync(artifact)));
  await visible("raw-original"); await visible("res-original"); await visible("har-original"); await visible("har-code-original");
  const patch = (changed) => ({ action: "apply", project, target, files: [changed], restart: true });
  fs.writeFileSync(rawfile, "raw-updated");
  const first = await call("hot_reload", patch(rawfile));
  assert.equal(first.resource_files, 1); assert.equal(first.launch.started, true);
  await visible("raw-updated"); await visible("res-original");

  fs.writeFileSync(rawfile, "unsent-edit"); fs.writeFileSync(resfile, "res-updated");
  const unsent = await raw("hot_reload", patch(resfile));
  assert.equal(unsent.isError, true); assert.equal(unsent.data.error.code, "CONFLICT");
  await visible("raw-updated"); await visible("res-original");
  fs.writeFileSync(rawfile, "raw-updated");
  const second = await call("hot_reload", patch(resfile));
  assert.equal(second.resource_files, 2); assert.ok(second.patch_version > first.patch_version);
  await visible("raw-updated"); await visible("res-updated");

  fs.writeFileSync(harRawfile, "har-updated");
  fs.writeFileSync(manifest, originalManifest);
  const disconnected = await raw("hot_reload", patch(harRawfile));
  assert.equal(disconnected.isError, true); assert.equal(disconnected.data.error.code, "CONFLICT");
  fs.writeFileSync(manifest, JSON.stringify(pkg));
  const dependency = await call("hot_reload", { action: "apply", project, target, restart: true });
  assert.equal(dependency.resource_files, 3); assert.ok(dependency.patch_version > second.patch_version);
  await visible("har-updated");

  fs.writeFileSync(harSource, harCode.replace("har-code-original", "har-code-updated"));
  const dependencyCode = await call("hot_reload", patch(harSource));
  assert.equal(dependencyCode.resource_files, 3); assert.ok(dependencyCode.patch_version > dependency.patch_version);
  await visible("har-code-updated");

  fs.writeFileSync(page, fs.readFileSync(page, "utf8").replace("code-original", "code-updated"));
  const mixed = await call("hot_reload", patch(file));
  assert.equal(mixed.resource_files, 3); assert.ok(mixed.patch_version > dependencyCode.patch_version);
  const output = path.join(project, "entry/build/default/outputs/default");
  const signed = path.join(output, "entry-default-signed.hqf"), unsigned = path.join(output, "entry-default-unsigned.hqf");
  assert.equal(mixed.patch_sha256, sha(fs.readFileSync(fs.existsSync(signed) ? signed : unsigned)));
  await visible("code-updated"); await visible("raw-updated"); await visible("res-updated"); await visible("har-updated"); await visible("har-code-updated");
  assert.deepEqual(packages.map((artifact) => sha(fs.readFileSync(artifact))), packageDigests);

  const restored = await call("hot_reload", { action: "reset", project, target });
  assert.equal(restored.patch_version, 0);
  await launch();
  await visible("code-original"); await visible("raw-original"); await visible("res-original"); await visible("har-original"); await visible("har-code-original");
});
