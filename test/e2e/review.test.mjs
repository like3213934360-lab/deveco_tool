// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { app, required, sha } from "../support/acceptance.mjs";

test("capture", async (t) => {
  const { raw, directory, target, project, ui } = await app(t);

  await t.test("ui.test_start-step-review-capture", async () => {
    const started = await ui({ action: "test_start", project, fresh_start: true, plan: "1. 显示 Hello World\n2. 点击后显示 Welcome" });
    assert.equal(started.checklist.length, 2);
    const test_id = started.test_id;
    assert.equal((await ui({ action: "test_step", test_id, visible: { text: "Hello World", exact: true } })).passed, true);
    assert.equal((await ui({ action: "test_step", test_id, op: "click", selector: { key: "HelloWorld" } })).passed, true);
    assert.equal((await ui({ action: "test_step", test_id, visible: { text: "Welcome", exact: true } })).passed, true);
    const review = await raw("ui", { action: "review", target, test_id, requirement: "Welcome is visible at the top of the test app, with the gesture controls below it" });
    assert.equal(review.isError, false); assert.equal(review.images.length, 1);
    fs.writeFileSync(path.join(directory, "pending-review.json"), JSON.stringify({ test_id, review_id: review.data.review_id, image: review.images[0].file }, null, 2));
  });

});

test("finish", async (t) => {
  const { directory, project, ui } = await app(t);

  await t.test("ui.review-finish-log-export", async () => {
    const captured = required("E2E_REVIEW");
    const pending = JSON.parse(fs.readFileSync(path.join(captured, "pending-review.json"), "utf8"));
    // A host must actually inspect the image and write this decision; the test never auto-approves it.
    const decision = JSON.parse(fs.readFileSync(required("E2E_DECISION"), "utf8"));
    assert.equal(decision.test_id, pending.test_id); assert.equal(decision.review_id, pending.review_id);
    assert.equal(decision.image_sha256, sha(fs.readFileSync(path.join(captured, pending.image))));
    assert.ok(decision.reason && ["passed", "failed", "insufficient"].includes(decision.outcome));
    const test_id = pending.test_id;
    await ui({ action: "review", test_id, review_id: pending.review_id, outcome: decision.outcome, reason: decision.reason });
    assert.equal((await ui({ action: "test_finish", test_id })).status, "passed");
    assert.ok((await ui({ action: "test_log", test_id, max_chars: 5000 })).chars > 0);
    const out = path.join(directory, "review-export");
    const exported = await ui({ action: "test_export", test_id, directory: out });
    assert.ok(exported.files.includes("report.md") && exported.files.includes("test.json"));
    const report = JSON.parse(fs.readFileSync(path.join(out, "test.json"), "utf8"));
    assert.equal(report.status, "passed"); assert.equal(report.reviews[0].reason, decision.reason);
    assert.ok(exported.files.some((f) => f.startsWith("review0") && fs.statSync(path.join(out, f)).size > 1000));
  });
  await t.test("ui.test-failed-assertion", async () => {
    const { test_id } = await ui({ action: "test_start", project, plan: "A missing control must fail the session" });
    const step = await ui({ action: "test_step", test_id, visible: { text: "MCP_MISSING_CONTROL", exact: true }, timeout_ms: 500 });
    assert.equal(step.passed, false);
    assert.equal((await ui({ action: "test_finish", test_id })).status, "failed");
  });

});
