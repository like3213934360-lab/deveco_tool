import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { test } from "node:test";
import { session } from "../support/acceptance.mjs";
import { waitJob as terminal } from "../support/mcp.mjs";

test("template SDK build", async (t) => {
  const { call, directory } = await session(t);
  const project = path.join(directory, "Template"), bundle = "com.devecomcp.template";
  const waitJob = (status) => terminal(call, status);
  await t.test("doctor", async () => {
    const report = await call("doctor", {});
    assert.equal(report.ok, true, JSON.stringify(report.checks));
  });

  await t.test("create + info", async () => {
    const created = await call("project", { action: "create", project, app_name: "Smoke", bundle_name: bundle });
    assert.ok(created.files > 10);
    const info = await call("project", { action: "info", project });
    assert.equal(info.bundle_name, bundle);
    assert.deepEqual(info.modules.map((m) => m.name), ["entry"]);
  });

  await t.test("code check (ArkTS static)", async () => {
    const check = await call("code", { action: "check", project, files: ["entry/src/main/ets/pages/Index.ets"] });
    assert.equal(check.errors, 0, JSON.stringify(check.issues));
  });

  await t.test("broken code is reported with location", async () => {
    const file = path.join(project, "entry/src/main/ets/pages/Broken.ets");
    fs.writeFileSync(file, "let x: any = 1;\nexport function f(): number { return x; }\n");
    const check = await call("code", { action: "check", project, files: ["entry/src/main/ets/pages/Broken.ets"] });
    assert.ok(check.errors >= 1, JSON.stringify(check));
    assert.ok(check.issues[0].file.includes("Broken.ets"));
    fs.rmSync(file);
  });

  await t.test("build (job) produces a HAP", async () => {
    const status = await waitJob(await call("project", { action: "build", project, wait: 60000 }));
    assert.equal(status.status, "succeeded", JSON.stringify(status.error ?? status).slice(0, 3000));
    assert.ok(status.result.artifacts[0].path.endsWith(".hap"));
    assert.equal(status.result.synced, true);
    assert.equal(status.result.sync_reason, "dependencies not installed");
    const incremental = await waitJob(await call("project", { action: "build", project, wait: 60000 }));
    assert.equal(incremental.status, "succeeded"); assert.equal(incremental.result.synced, false);
    assert.equal(incremental.result.sync_reason, undefined);
  });

  await t.test("resuming a repaired build refreshes preflight instead of claiming a false positive", async () => {
    const file = path.join(project, "entry/src/main/ets/pages/Index.ets"), original = fs.readFileSync(file, "utf8");
    try {
      fs.writeFileSync(file, `let brokenResumeValue: any = 1;\n${original}`);
      const failed = await waitJob(await call("project", { action: "build", project, wait: 0 }));
      assert.equal(failed.status, "failed");
      assert.equal(failed.error.code, "BUILD_FAILED");
      const detail = await call("job", { action: "status", job_id: failed.job_id, detail: true });
      assert.ok(detail.outputs.preflight.errors > 0);
      const first = detail.outputs.preflight;
      fs.writeFileSync(file, original);
      const resumed = await waitJob(await call("job", { action: "resume", job_id: failed.job_id }));
      assert.equal(resumed.status, "succeeded", JSON.stringify(resumed.error));
      assert.equal(resumed.result.preflight.errors, 0);
      assert.equal(resumed.result.preflight.overruled, undefined);
      assert.notEqual(resumed.result.preflight.source_identity, first.source_identity);
      assert.equal(resumed.result.preflight.source_identity, resumed.result.source_identity);
      assert.ok(resumed.recent_events.some((line) => line.includes("preflight source changed or unverified")));
      assert.ok((await call("job", { action: "read", artifact_id: first.report_artifact, limit: 10 })).content);
    } finally { fs.writeFileSync(file, original); }
  });

  await t.test("lsp resolves HMS kits against the SDK (signature + @since for source conflicts)", async () => {
    const file = "entry/src/main/ets/pages/PushProbe.ets";
    fs.writeFileSync(path.join(project, file), "import { pushService } from '@kit.PushKit';\n\nexport function probe(): void {\n  pushService.getToken();\n}\n");
    try {
      const hover = await call("code", { action: "lsp", op: "hover", project, file, symbol: "getToken", line: 4 });
      assert.match(hover.hover ?? "", /getToken\(\): Promise<string>/, JSON.stringify(hover));
      assert.match(hover.hover, /@since 4\.0\.0\(10\)/);
      const diag = await call("code", { action: "lsp", op: "diagnostics", project, file });
      assert.equal(diag.errors, 0, JSON.stringify(diag.diagnostics));
    } finally {
      fs.rmSync(path.join(project, file));
    }
  });
});

test("SDK kits and dependency changes", async (t) => {
  const { call, job, directory } = await session(t);
  const project = path.join(directory, "Modules"), file = "entry/src/main/ets/pages/Kits.ets";
  await call("project", { action: "create", project, app_name: "Modules", bundle_name: "com.devecomcp.modules" });
  const kits = {
    "@kit.PushKit": ["pushService", "getToken"], "@kit.AccountKit": ["authentication", "HuaweiIDProvider"],
    "@kit.MapKit": ["map", "MapComponentController"], "@kit.ScanKit": ["scanBarcode", "startScanForResult"],
    "@kit.PaymentKit": ["paymentService", "requestPayment"], "@kit.StoreKit": ["productViewManager", "loadProduct"],
    "@kit.ArkUI": ["promptAction", "showToast"], "@kit.AbilityKit": ["abilityAccessCtrl", "createAtManager"],
  };
  fs.writeFileSync(path.join(project, file), Object.entries(kits).map(([k, [ns]]) => `import { ${ns} } from '${k}';`).join("\n") + "\n"
    + Object.values(kits).map(([ns, member], i) => `export const v${i} = ${ns}.${member};`).join("\n") + "\n");
  for (const [kit, [ns, member]] of Object.entries(kits)) await t.test(kit, async () => {
    const hover = await call("code", { action: "lsp", op: "hover", project, file, symbol: `${ns}.${member}` });
    assert.ok(hover.hover); assert.doesNotMatch(hover.hover, /: any\b/);
  });
  assert.equal((await call("code", { action: "lsp", op: "diagnostics", project, file })).errors, 0);
  await job("project", { action: "build", project, preflight: false, wait: 0 });
  // Add actual library modules after the first build, without an explicit sync.
  for (const type of ["har", "shared"]) {
    const name = type === "har" ? "localhar" : "localhsp", lib = path.join(project, name);
    fs.mkdirSync(path.join(lib, "src/main/ets"), { recursive: true });
    fs.writeFileSync(path.join(lib, "src/main/module.json5"), JSON.stringify({ module: { name, type, deviceTypes: ["default"], ...(type === "shared" ? { deliveryWithInstall: true, installationFree: false } : {}) } }));
    fs.writeFileSync(path.join(lib, "Index.ets"), "export function hi(): string { return 'hi'; }\n");
    fs.writeFileSync(path.join(lib, "oh-package.json5"), JSON.stringify({ name, version: "1.0.0", main: "Index.ets" }));
    fs.writeFileSync(path.join(lib, "build-profile.json5"), JSON.stringify({ apiType: "stageMode", buildOption: {}, targets: [{ name: "default" }] }));
    fs.writeFileSync(path.join(lib, "hvigorfile.ts"), `import { ${type === "har" ? "harTasks" : "hspTasks"} } from '@ohos/hvigor-ohos-plugin';\nexport default { system: ${type === "har" ? "harTasks" : "hspTasks"}, plugins: [] };\n`);
    const profile = path.join(project, "build-profile.json5"), data = JSON5.parse(fs.readFileSync(profile, "utf8"));
    data.modules.push({ name, srcPath: `./${name}`, targets: [{ name: "default", applyToProducts: ["default"] }] });
    fs.writeFileSync(profile, JSON.stringify(data, null, 2));
    const manifest = path.join(project, "entry/oh-package.json5"), dependency = JSON5.parse(fs.readFileSync(manifest, "utf8"));
    dependency.dependencies = { ...dependency.dependencies, [name]: `file:../${name}` };
    fs.writeFileSync(manifest, JSON.stringify(dependency, null, 2));
    fs.writeFileSync(path.join(project, `entry/src/main/ets/pages/${name}.ets`), `import { hi } from '${name}';\nexport const value: string = hi();\n`);
    await t.test(`build after adding ${type}`, async () => {
      const built = await job("project", { action: "build", project, preflight: false, wait: 0 });
      assert.ok(built.result.artifacts.some((a) => a.path.endsWith(".hap")));
      assert.ok(fs.existsSync(path.join(project, "entry/oh_modules", name)));
    });
  }
});

test("phone and wearable entry builds remain independently selectable", async (t) => {
  const { call, job, directory } = await session(t), project = path.join(directory, "Entries");
  await call("project", { action: "create", project, app_name: "Entries", bundle_name: "com.devecomcp.entries" });
  fs.cpSync(path.join(project, "entry"), path.join(project, "watch"), { recursive: true });
  const profile = path.join(project, "build-profile.json5"), data = JSON5.parse(fs.readFileSync(profile, "utf8"));
  data.modules.push({ name: "watch", srcPath: "./watch", targets: [{ name: "default", applyToProducts: ["default"] }] });
  fs.writeFileSync(profile, JSON.stringify(data, null, 2));
  const manifest = path.join(project, "watch/src/main/module.json5"), watch = JSON5.parse(fs.readFileSync(manifest, "utf8"));
  watch.module.name = "watch"; watch.module.deviceTypes = ["wearable"];
  fs.writeFileSync(manifest, JSON.stringify(watch, null, 2));
  const info = await call("project", { action: "info", project });
  assert.deepEqual(info.modules.filter((m) => m.type === "entry").map((m) => m.name).sort(), ["entry", "watch"]);
  for (const name of ["entry", "watch"]) {
    const built = await job("project", { action: "build", project, modules: [name], wait: 0 });
    assert.equal(built.result.artifacts.length, 1);
    assert.ok(path.basename(built.result.artifacts[0].path).startsWith(`${name}-`));
  }
});
