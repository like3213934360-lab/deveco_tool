import test from "node:test";
import assert from "node:assert/strict";
import { requestAction, requestOutcome } from "../src/core/request-outcome.js";
test("normal tool returns distinguish semantic failure, pending visual review, accepted actions and proven success", () => {
  assert.equal(
    requestOutcome({ success: false, summary: { errorCount: 1 } }).outcome,
    "failed",
  );
  assert.equal(
    requestOutcome({ success: true, summary: { errorCount: 1 } }).outcome,
    "failed",
  );
  assert.equal(
    requestOutcome({ verified: false, review: { status: "required" } }).outcome,
    "pending",
  );
  assert.equal(
    requestOutcome({ commandAccepted: true, outcomeVerified: false }).outcome,
    "accepted",
  );
  assert.equal(requestOutcome({ verified: true }).outcome, "passed");
  assert.equal(requestOutcome({ reports: [] }).outcome, "returned");
  assert.equal(
    requestOutcome({
      status: "passed",
      verified: false,
      assertion_status: "failed",
    }).outcome,
    "failed",
  );
  assert.equal(
    requestOutcome({ status: "insufficient", verified: false }).outcome,
    "pending",
  );
  assert.equal(
    requestOutcome({ status: "passed", verified: false }).outcome,
    "unverified",
  );
});
test("telemetry only selects safe action and outcome fields without request/result secrets", () => {
  const input = {
    action: "start",
    workflow: "project_build",
    input: { password: "private-value" },
    operation: { action: "inputText", text: "private-value" },
  };
  assert.deepEqual(requestAction(input), {
    action: "start",
    workflow: "project_build",
    operation: "inputText",
  });
  assert.doesNotMatch(
    JSON.stringify(
      requestOutcome({
        ...input,
        success: true,
        token: "private-value",
        result: input,
        status: "private-value",
        run_id: "r1",
      }),
    ),
    /private-value|password|token/,
  );
  assert.deepEqual(
    requestAction({
      action: "a\nforged",
      operation: { action: "secret.value" },
    }),
    {},
  );
});
