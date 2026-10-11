// Real SDK is the independent compiler oracle; runtime-only claims have separate device tests.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { violations, legal, runtime } from "../fixtures/checker.mjs";
import { session, required } from "../support/acceptance.mjs";
import { waitJob } from "../support/mcp.mjs";

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
  const { call, directory } = await session(t);
  const api = (await call("device", { action: "info", target })).api_level;
  for (const [rule, source] of Object.entries(runtime)) await t.test(rule, async () => {
    const project = path.join(directory, rule);
    await call("project", { action: "create", project, app_name: "Rules", bundle_name: "com.devecomcp.rules", compatible_api: api });
    fs.writeFileSync(path.join(project, "entry/src/main/ets/pages/Index.ets"), source);
    const checked = await call("code", { action: "check", project });
    assert.equal(checked.issues.some((d) => d.rule === rule), rule !== "object-link-observed-type");
    const result = await waitJob(call, await call("run", { action: "build_run", project, target, preflight: false, wait: 0 }));
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
