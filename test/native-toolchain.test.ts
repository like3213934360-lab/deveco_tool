import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverToolchain } from "../src/core/toolchain.js";
import { atomicWrite } from "../src/core/files.js";
import { ProcessService } from "../src/core/process.js";
import { PersistentProcessObserver } from "../src/core/process-observer.js";
import { StateStore } from "../src/core/store.js";
import { LanguageService } from "../src/services/lsp.js";
import type { Project } from "../src/services/project.js";

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
