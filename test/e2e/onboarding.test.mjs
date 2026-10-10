// Runs on the explicit E2E target; no device settings or original smoke tests are changed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";

test("generic onboarding preserves defaults, reports transitions and leaves business Next alone", { skip: !process.env.E2E_TARGET }, async () => {
  const target = process.env.E2E_TARGET, work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-onboarding-"));
  const project = path.join(work, "Guide"), client = connect({ DEVECO_STATE_DIR: path.join(work, "state") });
  const call = async (tool, args) => {
    const result = await client.call(tool, args);
    assert.equal(result.isError, false, JSON.stringify(result.data));
    return result.data;
  };
  try {
    await client.initialize();
    const api = (await call("device", { action: "info", target })).api_level;
    await call("project", { action: "create", project, bundle_name: "com.devecomcp.onboarding", app_name: "Guide", compatible_api: api });
    fs.copyFileSync(new URL("./onboarding-page.ets", import.meta.url), path.join(project, "entry/src/main/ets/pages/Index.ets"));
    let job = await call("run", { action: "build_run", project, target, run_mode: "full", wait: 60000 });
    while (["running", "queued"].includes(job.status)) job = await call("job", { action: "wait", job_id: job.job_id, wait: 60000 });
    assert.equal(job.status, "succeeded", JSON.stringify(job));
    assert.match((await call("ui", { action: "tree", target })).tree, /欢迎使用示例工具/);
    const session = await call("ui", { action: "test_start", target, plan: "默认选项保留，引导完成后进入订单页面" });
    const result = await call("ui", { action: "test_step", target, test_id: session.test_id, op: "click", selector: { id: "Business" }, visible: { id: "Result" } });
    assert.equal(result.passed, true, JSON.stringify(result));
    assert.equal(result.onboarding_completed.length, 3, JSON.stringify(result));
    // UiTest exposes Radio.value as text; the rendered result below verifies the retained theme.
    assert.equal(result.onboarding_completed[1].text, "请选择应用主题: 下一步 (system)");
    assert.match(result.onboarding_completed[2].text, /跳过介绍/);
    const node = (await call("ui", { action: "find", target, selector: { id: "Result" } })).matches[0];
    assert.equal(node.text, "orders:0;theme:system");
    assert.equal((await call("ui", { action: "test_step", target, test_id: session.test_id, visible: { text: "orders:0;theme:system", exact: true } })).passed, true);
    assert.equal((await call("ui", { action: "test_finish", test_id: session.test_id })).status, "passed");
    const directory = path.join(work, "report");
    await call("ui", { action: "test_export", test_id: session.test_id, directory });
    const report = JSON.parse(fs.readFileSync(path.join(directory, "test.json"), "utf8"));
    assert.deepEqual(report.steps[1].onboarding_completed, result.onboarding_completed);
    console.log(JSON.stringify({ onboarding_completed: result.onboarding_completed, result: node.text }));
  } finally {
    await client.call("run", { action: "uninstall", project, target }).catch(() => {});
    await client.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
