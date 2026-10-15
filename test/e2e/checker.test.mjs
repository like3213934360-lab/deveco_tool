// Real SDK is the independent compiler oracle; runtime-only claims have separate device tests.
import assert from "node:assert/strict";
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
  for (const [rule, source] of Object.entries(runtime)) await t.test(rule, async () => {
    const project = path.join(directory, rule);
    await call("project", { action: "create", project, app_name: "Rules", bundle_name: "com.devecomcp.rules", compatible_api: api });
    fs.writeFileSync(path.join(project, "entry/src/main/ets/pages/Index.ets"), source);
    const checked = await call("code", { action: "check", project });
    assert.equal(checked.issues.some((d) => d.rule === rule), rule !== "object-link-observed-type");
    await job("project", { action: "build", project, preflight: false, wait: 0 });
    const result = await waitJob(call, await call("run", { action: "deploy", project, target, wait: 0 }));
    if (rule === "appstorage-observedv2-mixing") {
      assert.equal(result.status, "failed"); assert.equal(result.error.code, "LAUNCH_FAILED");
    } else {
      assert.equal(result.status, "succeeded", JSON.stringify(result));
      if (rule.startsWith("nav-destination")) await call("ui", { action: "act", target, op: "click", selector: { key: "go" } });
      const expected = rule === "nav-destination-single-builder" ? "B" : rule === "nav-destination-root-node" ? "ROUTED" : "Hello World";
      if (rule !== "object-link-observed-type") assert.equal((await call("ui", { action: "assert", target,
        [rule === "nav-destination-single-builder" ? "visible" : "hidden"]: { text: expected, exact: true }, timeout_ms: 5000 })).passed, true);
    }
    await call("run", { action: "uninstall", project, target });
  });
});
