import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverToolchain,
  installedSdkMetadata,
  component,
  toolCommand,
} from "../src/core/toolchain.js";
import { atomicWrite, parseObject } from "../src/core/files.js";
import { ProcessService } from "../src/core/process.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";
import { StateStore } from "../src/core/store.js";
import { LanguageService } from "../src/services/lsp.js";
import type { Project } from "../src/services/project.js";

test("default SDK metadata reports the installed API independently and never reuses stale or malformed fields", () => {
  const sdk = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-sdk-metadata-"));
  const file = path.join(sdk, "default/sdk-pkg.json");
  try {
    assert.throws(() => installedSdkMetadata({ sdk }), { code: "SDK_METADATA_MISSING" });
    atomicWrite(file, JSON.stringify({ data: { apiVersion: "26", platformVersion: "26.0.0", version: "26.0.0.105" } }));
    assert.deepEqual(installedSdkMetadata({ sdk }), { api_level: 26, platform_version: "26.0.0", package_version: "26.0.0.105", metadata_path: file });
    const stamp = fs.statSync(file);
    fs.writeFileSync(file, JSON.stringify({ data: { apiVersion: "27", platformVersion: "27.0.0", version: "27.0.0.105" } }));
    fs.utimesSync(file, stamp.atime, stamp.mtime);
    assert.equal(installedSdkMetadata({ sdk }).api_level, 27);
    atomicWrite(file, JSON.stringify({ data: { apiVersion: 24, platformVersion: "6.1.1" } }));
    assert.deepEqual(installedSdkMetadata({ sdk }), { api_level: 24, platform_version: "6.1.1", metadata_path: file });
    for (const data of [undefined, [], { apiVersion: null, platformVersion: "26.0.0" }, { apiVersion: true, platformVersion: "26.0.0" }, { apiVersion: "", platformVersion: "26.0.0" }, { apiVersion: "26.5", platformVersion: "26.0.0" }, { apiVersion: 0, platformVersion: "26.0.0" }, { apiVersion: "26", platformVersion: " " }]) {
      atomicWrite(file, JSON.stringify({ data }));
      assert.throws(() => installedSdkMetadata({ sdk }), { code: "SDK_METADATA_INVALID" });
    }
    for (const source of ["broken metadata", "[]", " ".repeat(65537)]) {
      atomicWrite(file, source);
      assert.throws(() => installedSdkMetadata({ sdk }), { code: "SDK_METADATA_INVALID" });
    }
    fs.rmSync(file); fs.mkdirSync(file);
    assert.throws(() => installedSdkMetadata({ sdk }), { code: "SDK_METADATA_INVALID" });
  } finally { fs.rmSync(sdk, { recursive: true, force: true }); }
});

test("object parsing accepts JSON and JSON5 while rejecting non-object documents", () => {
  assert.deepEqual(parseObject('{"version":"26.0.0", "data":{"api":26}}'), { version: "26.0.0", data: { api: 26 } });
  assert.deepEqual(parseObject("{ // SDK configuration\n version: '26.0.0', data: {api: 26,}, }"), { version: "26.0.0", data: { api: 26 } });
  for (const source of ["null", "[]", "42", '"version"', "{version:"]) assert.throws(() => parseObject(source));
});

test("CLT resolves documented linter layouts and external JDK identity, without accepting directories or losing command argument boundaries", () => {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "deveco-clt-布局 空格-")),
    ),
    previous = {
      config: process.env.DEVECO_CONFIG,
      java: process.env.JAVA_HOME,
    },
    clt = path.join(root, "clt"),
    config = path.join(root, "config.json"),
    jdk = path.join(root, "external-jdk"),
    exe = (name: string) =>
      process.platform === "win32" ? `${name}.exe` : name;
  try {
    atomicWrite(config, JSON.stringify({ clt, java_home: jdk }));
    process.env.DEVECO_CONFIG = config;
    process.env.JAVA_HOME = path.join(root, "unselected-jdk");
    atomicWrite(path.join(jdk, "bin", exe("java")), "java-fixture");
    atomicWrite(path.join(jdk, "release"), 'JAVA_VERSION="21.0.1"\n');
    atomicWrite(path.join(clt, "version.txt"), "# Version: 6.0.0.100\r\n");
    const paths = {
      node:
        process.platform === "win32"
          ? "tool/node/node.exe"
          : "tool/node/bin/node",
      ohpm: "ohpm/bin/pm-cli.js",
      hvigor: "hvigor/bin/hvigorw.js",
      hdc: `sdk/default/openharmony/toolchains/${exe("hdc")}`,
      arkts: "arkts-lsp/lib/out/standardIndex/index.js",
      apiscan: "plugins/harmony/arkanalyzer-apiscan/api-change-scan.js",
      clangd: `sdk/default/openharmony/native/llvm/bin/${exe("clangd")}`,
      emulator: `emulator/${exe("Emulator")}`,
      signer: "sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar",
    } as const;
    for (const file of Object.values(paths))
      atomicWrite(path.join(clt, file), "fixture");
    for (const file of [
      "codelinter/index.js",
      "codelinter/run/index.js",
      "tool/codelinter/bin/codelinter.js",
      "tool/codelinter/codelinter.js",
    ]) {
      const entry = path.join(clt, file);
      atomicWrite(entry, "linter-fixture");
      const chain = discoverToolchain();
      assert.equal(chain.kind, "clt");
      assert.equal(chain.version, "6.0.0.100");
      assert.equal(chain.versions["java/release"], "21.0.1");
      assert.equal(component(chain, "linter"), entry);
      for (const [name, relative] of Object.entries(paths))
        assert.equal(
          chain.components[name as keyof typeof paths],
          path.join(clt, relative),
        );
      assert.equal(
        component(chain, "java"),
        path.join(jdk, "bin", exe("java")),
      );
      const args = ["--path", "中文 path; $(ignored)"];
      const lint = toolCommand(chain, "linter", args, root);
      assert.deepEqual(lint.args, [entry, ...args]);
      assert.equal(lint.executable, component(chain, "node"));
      assert.equal(lint.env?.JAVA_HOME, jdk);
      assert.deepEqual(toolCommand(chain, "signer", args).args, [
        "-jar",
        component(chain, "signer"),
        ...args,
      ]);
      fs.rmSync(entry);
    }
    const first = discoverToolchain();
    assert.equal(first.components.linter, undefined);
    fs.rmSync(path.join(clt, paths.apiscan));
    assert.equal(discoverToolchain().components.apiscan, undefined, "Incomplete CLT installations must not advertise a missing API scanner");
    atomicWrite(path.join(clt, paths.apiscan), "fixture");
    assert.deepEqual(discoverToolchain(), first);
    const emulator = first.components.emulator!, initialStat = fs.statSync(emulator);
    fs.utimesSync(emulator, initialStat.atime, new Date(initialStat.mtimeMs + 10000));
    assert.deepEqual(discoverToolchain(), first, "SDK startup touching an unchanged executable preserves its content identity");
    fs.writeFileSync(emulator, "changed"); // Same size as the original fixture.
    fs.utimesSync(emulator, initialStat.atime, initialStat.mtime);
    assert.notEqual(discoverToolchain().fingerprint, first.fingerprint, "Same-size replacement with restored mtime must invalidate the cached digest");
    fs.writeFileSync(emulator, "fixture");
    assert.deepEqual(discoverToolchain(), first);
    const alias = path.join(root, "clt-alias");
    fs.symlinkSync(clt, alias, "junction");
    for (const configured of [
      alias,
      path.join(os.tmpdir(), path.basename(root), "clt"),
    ]) {
      atomicWrite(config, JSON.stringify({ clt: configured, java_home: jdk }));
      assert.deepEqual(
        discoverToolchain(),
        first,
        "Equivalent SDK paths must preserve the captured identity",
      );
    }
    atomicWrite(config, JSON.stringify({ clt, java_home: jdk }));
    fs.mkdirSync(path.join(clt, "codelinter/index.js"));
    assert.equal(discoverToolchain().components.linter, undefined);
    atomicWrite(path.join(jdk, "release"), 'JAVA_VERSION="21.0.2"\n');
    assert.notEqual(discoverToolchain().fingerprint, first.fingerprint);
    const second = discoverToolchain();
    atomicWrite(path.join(clt, "version.txt"), "# Version: 6.0.0.101\n");
    assert.notEqual(discoverToolchain().fingerprint, second.fingerprint);
    atomicWrite(config, JSON.stringify({ clt }));
    process.env.JAVA_HOME = jdk;
    assert.equal(
      discoverToolchain().components.java,
      path.join(jdk, "bin", exe("java")),
    );
    atomicWrite(
      config,
      JSON.stringify({ clt, java_home: path.join(root, "missing") }),
    );
    assert.throws(discoverToolchain, { code: "JAVA_HOME_INVALID" });
  } finally {
    if (previous.config === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = previous.config;
    if (previous.java === undefined) delete process.env.JAVA_HOME;
    else process.env.JAVA_HOME = previous.java;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SDK package updates and executable replacement change captured toolchain identity even when Studio is unchanged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-toolchain-"));
  const previous = process.env.DEVECO_CONFIG;
  const config = path.join(root, "config.json"),
    clt = path.join(root, "clt");
  atomicWrite(config, JSON.stringify({ clt }));
  process.env.DEVECO_CONFIG = config;
  try {
    const sdk = path.join(clt, "sdk/default"),
      component = path.join(sdk, "openharmony/toolchains");
    const entry = path.join(
      component,
      process.platform === "win32" ? "hdc.exe" : "hdc",
    );
    atomicWrite(entry, "entry-v1");
    atomicWrite(
      path.join(sdk, "sdk-pkg.json"),
      JSON.stringify({ data: { apiVersion: "26", version: "26.0.0.105" } }),
    );
    const manifest = path.join(component, "oh-uni-package.json");
    atomicWrite(manifest, JSON.stringify({ version: "26.0.0.105" }));
    const first = discoverToolchain();
    assert.equal(first.versions["sdk/default/sdk-pkg.json"], "26.0.0.105");
    assert.equal(discoverToolchain().fingerprint, first.fingerprint);
    atomicWrite(manifest, JSON.stringify({ version: "26.0.0.106" }));
    const updated = discoverToolchain();
    assert.equal(updated.version, first.version);
    assert.notEqual(updated.fingerprint, first.fingerprint);
    const stat = fs.statSync(manifest);
    fs.writeFileSync(manifest, JSON.stringify({ version: "26.0.0.107" }));
    fs.utimesSync(manifest, stat.atime, stat.mtime);
    const restoredTime = discoverToolchain();
    assert.equal(restoredTime.versions["sdk/default/openharmony/toolchains/oh-uni-package.json"], "26.0.0.107");
    assert.notEqual(restoredTime.fingerprint, updated.fingerprint, "Parsed metadata must follow actual bytes even when size and mtime match the cached file");
    const replacement = path.join(component, "replacement.json");
    atomicWrite(replacement, JSON.stringify({ version: "26.0.0.109" }));
    fs.utimesSync(replacement, stat.atime, stat.mtime);
    fs.renameSync(replacement, manifest);
    assert.equal(discoverToolchain().versions["sdk/default/openharmony/toolchains/oh-uni-package.json"], "26.0.0.109", "An atomic replacement cannot reuse metadata from the previous inode");
    fs.writeFileSync(manifest, '{version: "26.0.0.108",}');
    assert.equal(discoverToolchain().versions["sdk/default/openharmony/toolchains/oh-uni-package.json"], "26.0.0.108");
    fs.writeFileSync(manifest, "invalid updated metadata");
    assert.throws(discoverToolchain, "A previous valid record must never hide a malformed update");
    fs.rmSync(manifest);
    assert.equal(discoverToolchain().versions["sdk/default/openharmony/toolchains/oh-uni-package.json"], undefined);
    atomicWrite(manifest, JSON.stringify({ version: "26.0.0.106" }));
    assert.equal(discoverToolchain().fingerprint, updated.fingerprint);
    atomicWrite(entry, "entry-v2");
    assert.notEqual(discoverToolchain().fingerprint, updated.fingerprint);
  } finally {
    if (previous === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SDK metadata changes remain visible when filesystem identities alias", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-metadata-alias-"));
  const previous = process.env.DEVECO_CONFIG;
  const config = path.join(root, "config.json"), clt = path.join(root, "clt");
  const manifest = path.join(clt, "sdk/default/sdk-pkg.json");
  atomicWrite(config, JSON.stringify({ clt }));
  atomicWrite(manifest, '{"version":"26.0.0.105"}');
  process.env.DEVECO_CONFIG = config;
  const statSync = fs.statSync;
  const frozen = statSync(manifest), frozenBig = statSync(manifest, { bigint: true });
  const mock = t.mock.method(fs, "statSync", ((file, options) => {
    if (file === manifest) return typeof options === "object" && options?.bigint ? frozenBig : frozen;
    return Reflect.apply(statSync, fs, [file, options]);
  }) as typeof fs.statSync);
  try {
    const initial = discoverToolchain();
    fs.writeFileSync(manifest, '{"version":"26.0.0.106"}');
    const changed = discoverToolchain();
    assert.equal(changed.versions["sdk/default/sdk-pkg.json"], "26.0.0.106");
    assert.notEqual(changed.fingerprint, initial.fingerprint);
    fs.writeFileSync(manifest, "!".repeat(frozen.size));
    assert.throws(discoverToolchain, { code: "SDK_METADATA_INVALID" });
    fs.writeFileSync(manifest, '{"version":"26.0.0.105"}');
    assert.equal(discoverToolchain().fingerprint, initial.fingerprint);
  } finally {
    mock.mock.restore();
    if (previous === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a native language request reuses unchanged SDK sessions and replaces the cache identity after a package update", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-lsp-sdk-"));
  const previous = {
    config: process.env.DEVECO_CONFIG,
    state: process.env.DEVECO_STATE_DIR,
  };
  const config = path.join(root, "config.json"),
    clt = path.join(root, "clt");
  atomicWrite(config, JSON.stringify({ clt }));
  process.env.DEVECO_CONFIG = config;
  process.env.DEVECO_STATE_DIR = path.join(root, "state");
  const store = new StateStore(),
    processes = new ProcessService(new PersistentProcessObserver(store)),
    service = new LanguageService(processes, undefined, undefined, store);
  try {
    const node = path.join(
      clt,
      "tool/node",
      process.platform === "win32" ? "node.exe" : "bin/node",
    );
    const directory = path.dirname(node);
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    // Keep the selected Node binary beside its actual shared libraries.
    fs.symlinkSync(
      path.dirname(process.execPath),
      directory,
      process.platform === "win32" ? "junction" : "dir",
    );
    atomicWrite(
      path.join(clt, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    const server = path.join(clt, "arkts-lsp/lib/out/standardIndex/index.js");
    // The generated SDK fixture imports the compiled TypeScript test server.
    atomicWrite(
      server,
      `import ${JSON.stringify(new URL("./fixtures/native-lsp.js", import.meta.url).href)};\n`,
    );
    const metadata = path.join(clt, "sdk/default/sdk-pkg.json");
    atomicWrite(metadata, JSON.stringify({ data: { version: "26.0.0.105" } }));
    const project: Project = {
      root: path.join(root, "project"),
      fingerprint: "same-project",
      product: {
        name: "default",
        compatibleSdkVersion: 26,
        runtimeOS: "HarmonyOS",
      },
      modules: [],
    };
    atomicWrite(path.join(project.root, "Model.ets"), "source");
    for (let n = 0; n < 2; n++)
      await service.request(project, { action: "hover", file: "Model.ets" });
    assert.equal(processes.size, 1);
    atomicWrite(metadata, JSON.stringify({ data: { version: "26.0.0.106" } }));
    await service.request(project, { action: "hover", file: "Model.ets" });
    assert.equal(
      processes.size,
      2,
      "An unchanged command path must not reuse the old SDK process",
    );
  } finally {
    await service.close();
    await processes.close();
    assert.deepEqual(
      store.db.prepare("SELECT * FROM native_directories").all(),
      [],
    );
    store.close();
    if (previous.config === undefined) delete process.env.DEVECO_CONFIG;
    else process.env.DEVECO_CONFIG = previous.config;
    if (previous.state === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = previous.state;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
