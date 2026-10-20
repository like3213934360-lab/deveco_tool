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
    assert.equal((await ui({ action: "test_step", test_id, checklist_item: 1, visible: { text: "Hello World", exact: true } })).passed, true);
    assert.equal((await ui({ action: "test_step", test_id, checklist_item: 2, op: "click", selector: { key: "HelloWorld" } })).passed, true);
    assert.equal((await ui({ action: "test_step", test_id, checklist_item: 2, visible: { text: "Welcome", exact: true } })).passed, true);
    const requirement = "Welcome is visible at the top of the test app, with the gesture controls below it";
    const review = await raw("ui", { action: "review", target, test_id, checklist_item: 2, requirement });
    assert.equal(review.isError, false); assert.equal(review.images.length, 1);
    fs.writeFileSync(path.join(directory, "pending-review.json"), JSON.stringify({ test_id, review_id: review.data.review_id,
      target, project, checklist_item: 2, requirement, image: review.images[0].file, image_sha256: review.images[0].sha256 }, null, 2), { flag: "wx", mode: 0o600 });
    t.diagnostic(`Review is pending: inspect ${path.join(directory, review.images[0].file)} against ${JSON.stringify(requirement)} before writing E2E_DECISION; capture is not a visual pass.`);
  });

});

test("finish", async (t) => {
  const { directory, project, target, ui } = await app(t);

  await t.test("ui.review-finish-log-export", async () => {
    const captured = required("E2E_REVIEW");
    const pending = JSON.parse(fs.readFileSync(path.join(captured, "pending-review.json"), "utf8"));
    // A host must actually inspect the image and write this decision; the test never auto-approves it.
    const decision = JSON.parse(fs.readFileSync(required("E2E_DECISION"), "utf8"));
    assert.equal(pending.target, target); assert.equal(pending.project, project); assert.equal(pending.checklist_item, 2);
    assert.equal(decision.test_id, pending.test_id); assert.equal(decision.review_id, pending.review_id);
    const imageHash = sha(fs.readFileSync(path.join(captured, pending.image)));
    assert.equal(pending.image_sha256, imageHash); assert.equal(decision.image_sha256, imageHash);
    assert.ok(typeof decision.reason === "string" && decision.reason.trim() && decision.reason.length <= 2000
      && ["passed", "failed", "insufficient"].includes(decision.outcome));
    const test_id = pending.test_id;
    const reviewed = await ui({ action: "review", test_id, review_id: pending.review_id, checklist_item: pending.checklist_item,
      outcome: decision.outcome, reason: decision.reason });
    assert.equal(reviewed.recorded, decision.outcome);
    const finished = await ui({ action: "test_finish", test_id });
    const expected = { passed: "passed", failed: "failed", insufficient: "inconclusive" }[decision.outcome];
    assert.equal(finished.status, expected);
    const out = path.join(directory, "review-export");
    const exported = await ui({ action: "test_export", test_id, directory: out });
    assert.ok(exported.files.includes("report.md") && exported.files.includes("test.json"));
    assert.ok((await ui({ action: "test_log", test_id, max_chars: 5000 })).chars > 0);
    const report = JSON.parse(fs.readFileSync(path.join(out, "test.json"), "utf8"));
    assert.equal(report.status, expected); assert.equal(report.reviews[0].reason, decision.reason);
    assert.equal(report.reviews[0].checklist_item, 2); assert.equal(report.reviews[0].outcome, decision.outcome);
    assert.deepEqual(finished.checklist_coverage, { total: 2, completed: 2, missing: [] });
    assert.ok(exported.files.some((f) => f.startsWith("review0") && fs.statSync(path.join(out, f)).size > 1000));
    assert.equal(finished.status, "passed", `Visual acceptance is ${expected}: ${decision.reason}; evidence was exported to ${out}`);
  });
  await t.test("ui.test-failed-assertion", async () => {
    const { test_id } = await ui({ action: "test_start", project, plan: "A missing control must fail the session" });
    const step = await ui({ action: "test_step", test_id, visible: { text: "MCP_MISSING_CONTROL", exact: true }, timeout_ms: 500 });
    assert.equal(step.passed, false);
    assert.equal((await ui({ action: "test_finish", test_id })).status, "failed");
  });

});
