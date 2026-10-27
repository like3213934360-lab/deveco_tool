// Real SDK is the independent compiler oracle; runtime-only claims have separate device tests.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { violations, legal, runtime } from "../fixtures/checker.mjs";
import { session, required, hashes } from "../support/acceptance.mjs";
import { waitJob } from "../support/mcp.mjs";

test("checker file scope and complete report", async (t) => {
  const { call, raw, directory } = await session(t);
  const project = path.join(directory, "scope");
  await call("project", { action: "create", project, app_name: "Scope", bundle_name: "com.devecomcp.scope" });
  const file = "entry/src/main/ets/pages/Index.ets";
  const helper = "entry/src/main/ets/pages/Helper.ets";
  const typescript = "entry/src/main/ets/pages/Typed.ts";
  fs.writeFileSync(path.join(project, helper), Array.from({ length: 61 }, (_, i) => `export const bad${i}: string = ${i};`).join("\n"));
  fs.writeFileSync(path.join(project, file), "import { bad0 } from './Helper';\n@Entry\n@Component\nstruct Index { build() { Column() { Text(bad0) } } }\n");
  fs.writeFileSync(path.join(project, typescript), "export const typed: string = 1;\n");
  const before = hashes(project);
  for (const files of [[], ["missing.ets"], [file, "missing.ets"], ["entry/src/main/ets"], ["AppScope/app.json5"]]) {
    const rejected = await raw("code", { action: "check", project, files, fix: true });
    assert.equal(rejected.isError, true);
    assert.equal(rejected.data.error.code, "INVALID_INPUT", JSON.stringify(rejected.data));
    assert.deepEqual(hashes(project), before, "An invalid scope cannot write source or checker caches");
  }
  const checked = await call("code", { action: "check", project, files: [file] });
  assert.equal(checked.files, 1);
  assert.equal(checked.scope.mode, "files");
  assert.equal(checked.scope.requested_files, 1);
  assert.ok(checked.scope.additional_files >= 1, JSON.stringify(checked));
  assert.ok(checked.total > 50);
  assert.equal(checked.truncated, true);
  assert.equal(checked.issues.length, 50);
  let content = "", line = 0, pages = 0;
  do {
    const page = await call("job", { action: "read", artifact_id: checked.report_artifact, line, limit: 41 });
    content += page.content + "\n";
    line = page.next_line;
    pages++;
  } while (line !== null);
  const report = JSON.parse(content);
  assert.ok(pages > 1);
  assert.equal(report.issues.length, checked.total);
  assert.equal(report.issues.filter((issue) => issue.file === path.normalize(helper) && issue.severity === "error").length, 61);
  assert.equal(report.scope.diagnostic_files, new Set(report.issues.map((issue) => issue.file).filter(Boolean)).size);
  assert.deepEqual(report.checked_files, [path.normalize(file)]);
  const typed = await call("code", { action: "check", project, files: [typescript] });
  assert.equal(typed.files, 1);
  assert.equal(typed.passed, false, "An explicit .ts input must reach the real SDK compiler");
  assert.ok(typed.issues.some((issue) => issue.file === path.normalize(typescript) && issue.severity === "error"));
  const all = await call("code", { action: "check", project });
  assert.equal(all.scope.mode, "project");
  assert.equal(all.scope.requested_files, null);
  assert.ok(all.files > 1, "Omitting files still checks the project");
});

test("checker fix retains one current project diagnostic", async (t) => {
  const { call, directory } = await session(t);
  const project = path.join(directory, "fix"), source = "entry/src/main/ets/pages/Index.ets";
  await call("project", { action: "create", project, app_name: "Fix", bundle_name: "com.devecomcp.fix" });
  fs.writeFileSync(path.join(project, source), '@Entry\n@Component\nstruct Index {\n  @Local count: number = 0\n  build() { Column() { Text(`${this.count}`) } }\n}\n');
  fs.writeFileSync(path.join(project, "entry/src/main/resources/base/profile/route_map.json"), JSON.stringify({ routerMap: [{ name: "Page" }] }));
  const before = await call("code", { action: "check", project });
  assert.ok(before.issues.some(d => d.rule === "component-decorator-version-mismatch"));
  const expected = before.issues.filter(d => d.rule === "route-map-missing-key");
  assert.equal(expected.length, 2);
  const after = await call("code", { action: "check", project, fix: true });
  assert.match(fs.readFileSync(path.join(project, source), "utf8"), /@ComponentV2/);
  assert.equal(after.issues.some(d => d.rule === "component-decorator-version-mismatch"), false);
  assert.equal(after.issues.filter(d => d.rule === "route-map-missing-key").length, expected.length);
  const again = await call("code", { action: "check", project });
  assert.deepEqual(after.issues, again.issues);
});

test("CodeLinter retains real await misuse and explains declaration package limits", async (t) => {
  const { call, directory } = await session(t);
  const project = path.join(directory, "declarations"), file = "entry/src/main/ets/pages/LintProbe.ets";
  await call("project", { action: "create", project, app_name: "Declarations", bundle_name: "com.devecomcp.declarations" });
  const names = ["libprobe.so", "typed-probe"];
  for (const name of names) {
    const root = path.join(project, "entry/src/main/types", name);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "index.d.ts"), "export const declarationPromise: () => Promise<void>;\n");
    fs.writeFileSync(path.join(root, "oh-package.json5"), JSON.stringify({ name, version: "1.0.0", types: "./index.d.ts" }));
  }
  const manifestFile = path.join(project, "entry/oh-package.json5");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.dependencies = { ...manifest.dependencies, ...Object.fromEntries(names.map((name) => [name, `file:./src/main/types/${name}`])) };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.writeFileSync(path.join(project, "entry/src/main/ets/pages/typed.d.ts"), "export const declarationPromise: () => Promise<void>;\n");
  fs.writeFileSync(path.join(project, file), [
    "import { declarationPromise as nativePromise } from 'libprobe.so';",
    "import { declarationPromise as packagePromise } from 'typed-probe';",
    "import { declarationPromise as relativePromise } from './typed';",
    "export async function nativeCall(): Promise<void> { await nativePromise(); }",
    "export async function packageCall(): Promise<void> { await packagePromise(); }",
    "export async function relativeCall(): Promise<void> { await relativePromise(); }",
    "export async function ordinaryPromise(): Promise<void> { await Promise.resolve(1); }",
    "export async function realMisuse(): Promise<void> { await 1; }",
  ].join("\n"));
  await call("project", { action: "sync", project, wait: 1000 }).then((result) => waitJob(call, result));
  const result = await call("code", { action: "lint", project, file });
  const awaits = result.issues.filter((issue) => issue.rule === "@typescript-eslint/await-thenable");
  assert.ok(awaits.some((issue) => issue.line === 8), "A real non-Promise await must remain a negative");
  assert.ok(!awaits.some((issue) => issue.line === 6 || issue.line === 7), "Relative declarations and local Promise types remain valid");
  assert.match(result.hints.join(" "), /declaration-only packages.*\.so.*before changing await/);
  const raw = JSON.parse((await call("job", { action: "read", artifact_id: result.report_artifact, limit: 200 })).content);
  const messages = raw.flatMap((item) => item.messages);
  assert.equal(result.total, messages.length);
  assert.equal(result.counts.error, messages.filter((message) => message.severity === "Error" || message.severity === "error" || message.severity === 2).length);
  t.diagnostic(`Declaration package diagnostics on lines 4/5: ${awaits.filter((issue) => issue.line === 4 || issue.line === 5).length}; SDK output retained`);
});

for (const [kind, cases] of [["violations", violations], ["legal", legal]]) test(`checker ${kind}`, async (t) => {
  const { call, job, directory } = await session(t);
  const base = path.join(directory, "base");
  await call("project", { action: "create", project: base, app_name: "Rules", bundle_name: "com.devecomcp.rules" });
  await job("project", { action: "build", project: base, preflight: false, wait: 0 });
  for (const [name, spec] of Object.entries(cases)) {
    if (spec.runtime) continue; // Exercised below with the exact runtime trigger, not declared compiled = passed.
    await t.test(name, async () => {
      const project = path.join(directory, name.replace(/[^\w-]/g, "_")), rule = spec.rule ?? name;
      fs.cpSync(base, project, { recursive: true, filter: (p) => !/[\\/](build|\.hvigor)$/.test(p) });
      for (const [file, text] of Object.entries(spec.files ?? {})) fs.writeFileSync(path.join(project, file), text);
      if (spec.src) fs.writeFileSync(path.join(project, "entry/src/main/ets/pages/Index.ets"), spec.src);
      spec.edit?.(project);
      if (name.includes("nested")) await job("project", { action: "sync", project, wait: 0 });
      const checked = await call("code", { action: "check", project });
      assert.ok(Array.isArray(checked.issues), "A failed checker cannot be interpreted as zero issues");
      const fired = checked.issues.filter((d) => d.rule === rule || (rule === "regular-property-init" && /property-init/.test(d.rule ?? "")));
      const built = await waitJob(call, await call("project", { action: "build", project, preflight: false, wait: 0 }));
      const accepted = kind === "legal" || rule === "object-link-observed-type";
      assert.equal(fired.length > 0, !accepted, JSON.stringify(checked));
      assert.equal(built.status, accepted ? "succeeded" : "failed", JSON.stringify(built));
      if (!accepted) assert.equal(built.error.code, "BUILD_FAILED", "An infrastructure failure is not a compiler rejection");
    });
  }
});

test("checker runtime claims", async (t) => {
  const target = required("E2E_TARGET");
  const { call, job, directory } = await session(t);
  const api = (await call("device", { action: "info", target })).api_level;
  const installed = async (bundle) => {
    let offset = 0;
    do {
      const page = await call("device", { action: "app", operation: "list", target, offset, limit: 200 });
      assert.ok(Array.isArray(page.bundles));
      if (page.bundles.includes(bundle)) return true;
      assert.ok(page.next_offset === null || Number.isInteger(page.next_offset) && page.next_offset > offset);
      offset = page.next_offset;
    } while (offset !== null);
    return false;
  };
  for (const [rule, source] of Object.entries(runtime)) await t.test(rule, async () => {
    const project = path.join(directory, rule), bundle = `com.devecomcp.rules.r${crypto.randomUUID().replaceAll("-", "")}`;
    await call("project", { action: "create", project, app_name: "Rules", bundle_name: bundle, compatible_api: api });
    fs.writeFileSync(path.join(project, "entry/src/main/ets/pages/Index.ets"), source);
    const checked = await call("code", { action: "check", project });
    assert.equal(checked.issues.some((d) => d.rule === rule), rule !== "object-link-observed-type");
    await job("project", { action: "build", project, preflight: false, wait: 0 });
    assert.equal(await installed(bundle), false, "Never replace or uninstall a pre-existing application");
    let deployment, failure;
    try {
      deployment = await call("run", { action: "deploy", project, target, wait: 0 });
      deployment = await waitJob(call, deployment);
      if (rule === "appstorage-observedv2-mixing") {
        assert.equal(deployment.status, "failed"); assert.equal(deployment.error.code, "LAUNCH_FAILED");
      } else {
        assert.equal(deployment.status, "succeeded", JSON.stringify(deployment));
        if (rule.startsWith("nav-destination")) await call("ui", { action: "act", target, op: "click", selector: { key: "go" } });
        const expected = rule === "nav-destination-single-builder" ? "B" : rule === "nav-destination-root-node" ? "ROUTED" : "Hello World";
        if (rule !== "object-link-observed-type") assert.equal((await call("ui", { action: "assert", target,
          [rule === "nav-destination-single-builder" ? "visible" : "hidden"]: { text: expected, exact: true }, timeout_ms: 5000 })).passed, true);
      }
    } catch (error) { failure = error; throw error; }
    finally {
      try {
        assert.ok(deployment?.job_id, `Deploy response unavailable; retain ${bundle} until its job is resolved explicitly`);
        if (["queued", "running"].includes(deployment.status)) {
          deployment = await waitJob(call, await call("job", { action: "cancel", job_id: deployment.job_id }));
        }
        assert.ok(["succeeded", "failed", "cancelled"].includes(deployment.status), "Deploy must end before uninstall");
        assert.equal((await call("project", { action: "info", project })).bundle_name, bundle, "Project ownership changed; do not uninstall");
        const cleaned = await call("run", { action: "uninstall", project, target });
        assert.equal(cleaned.bundle, bundle);
        assert.ok(cleaned.uninstalled === true || cleaned.uninstalled === false && cleaned.reason === "not_installed", JSON.stringify(cleaned));
        assert.equal(await installed(bundle), false, "Runtime application was not removed");
      } catch (cleanup) {
        if (failure) throw new AggregateError([failure, cleanup], "Runtime check and owned-app cleanup failed", { cause: failure });
        throw cleanup;
      }
    }
  });
});
