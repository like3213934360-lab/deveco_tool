import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverToolchain,
  component,
  toolCommand,
} from "../src/core/toolchain.js";
import { atomicWrite } from "../src/core/files.js";
import { ProcessService } from "../src/core/process.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";
import { StateStore } from "../src/core/store.js";
import { LanguageService } from "../src/services/lsp.js";
import type { Project } from "../src/services/project.js";

test("CLT resolves documented linter layouts and external JDK identity, without accepting directories or losing command argument boundaries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-clt-布局 空格-")),
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
    atomicWrite(entry, "entry-v2");
    assert.notEqual(discoverToolchain().fingerprint, updated.fingerprint);
  } finally {
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
