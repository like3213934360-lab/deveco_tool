import test from "node:test";
import assert from "node:assert/strict";
import {
  epochNanoseconds,
  selectTestLog,
  type UiLogAnchor,
} from "../src/services/ui-test-log.js";

const anchor = (timestamp: string, pids = ["42"]): UiLogAnchor => ({
  device_epoch_ns: String(epochNanoseconds(timestamp)),
  pids,
  host_started_at: 0,
  host_completed_at: 0,
});
test("test logs retain only exact epoch intervals and sampled application PIDs, excluding unassociated continuation lines", () => {
  const low = anchor("1789025600.123456789"),
    high = anchor("1789025601.000000001", ["43"]);
  const result = selectTestLog(
    [
      "1789025600.123456788 42 42 I too early",
      "1789025600.123456789 42 42 I lower boundary already read",
      "1789025600.123456790 42 42 I one nanosecond later 中文",
      "1789025601.000000001 43 43 I replacement process",
      "1789025601.000000002 42 42 I too late",
      "1789025600.999999999 99 99 I unrelated app",
      "unattributed continuation",
    ].join("\n"),
    low,
    high,
  );
  assert.equal(result.line_count, 2);
  assert.equal(result.skipped_lines, 5);
  assert.match(result.content, /中文/);
  assert.match(result.content, /replacement process/);
  assert.doesNotMatch(
    result.content,
    /too early|too late|unrelated|unattributed|already read/,
  );
});
test("unsupported timestamps and a backwards device clock cannot be interpreted as test-time evidence", () => {
  for (const value of [
    "Permission denied",
    "1789025600.%N",
    "1789025600",
    "1789025600.1234567890",
    "09-10 14:13:20.123",
  ])
    assert.throws(() => epochNanoseconds(value), {
      code: "UI_TEST_CLOCK_UNSUPPORTED",
    });
  assert.throws(
    () =>
      selectTestLog(
        "1789025600.5 42 42 I message",
        anchor("1789025601.0"),
        anchor("1789025600.0"),
      ),
    { code: "UI_TEST_CLOCK_CHANGED" },
  );
});
