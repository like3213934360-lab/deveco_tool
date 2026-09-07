import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { controlSchema } from "../src/core/contracts.js";
import { ProcessService } from "../src/core/process.js";
import { StateStore } from "../src/core/store.js";
import {
  DeviceService,
  UiIndex,
  type Snapshot,
} from "../src/services/device.js";
import { parseUiDump } from "../src/services/ui-parse.js";
import {
  resolveControl,
  uiInputArguments,
} from "../src/services/ui-control.js";
import { textRequest } from "../src/services/text.js";

function snapshot(): Snapshot {
  const parsed = parseUiDump(
    JSON.stringify(
      [0, 1].map((displayId) => ({
        attributes: {
          type: "WindowScene",
          id: "window",
          bundleName: "com.test",
          displayId,
          bounds: "[100,200][500,1000]",
        },
        children: [
          {
            attributes: {
              type: "Button",
              id: "submit",
              bounds: "[110,210][130,230]",
              enabled: true,
            },
          },
        ],
      })),
    ),
  );
  return {
    ...parsed,
    query: new UiIndex(parsed.nodes),
    id: "snapshot",
    device: "device",
    created: Date.now(),
  };
}
const encode = (value: unknown) => uiInputArguments(controlSchema.parse(value));

test("native UI display routing fills gesture and numeric chord slots without treating the display as another key", () => {
  for (const [input, expected] of [
    [
      { action: "click", x: 10, y: 20, display_id: 1 },
      ["click", "10", "20", "1"],
    ],
    [{ action: "doubleClick", x: 10, y: 20 }, ["doubleClick", "10", "20"]],
    [
      { action: "swipe", x: 10, y: 20, x2: 10, y2: 120, display_id: 1 },
      ["swipe", "10", "20", "10", "120", "600", "1"],
    ],
    [
      { action: "fling", x: 10, y: 20, x2: 10, y2: 120, display_id: 1 },
      ["fling", "10", "20", "10", "120", "600", "2", "1"],
    ],
    [
      { action: "dircFling", direction: 2, display_id: 1 },
      ["dircFling", "2", "600", "50", "1"],
    ],
    [
      { action: "keyEvent", keys: ["Home"], display_id: 1 },
      ["keyEvent", "Home", "1"],
    ],
    [
      { action: "keyEvent", keys: ["2038"], display_id: 1 },
      ["keyEvent", "2038", "0", "0", "1"],
    ],
    [
      { action: "keyEvent", keys: ["2072", "2038"], display_id: 1 },
      ["keyEvent", "2072", "2038", "0", "1"],
    ],
    [
      { action: "keyEvent", keys: ["2072", "2038"] },
      ["keyEvent", "2072", "2038"],
    ],
  ])
    assert.deepEqual(encode(input), expected);
  for (const input of [
    { action: "click", x: 0, y: 1 },
    { action: "click", x: 10, y: 20, velocity: 600 },
    { action: "swipe", x: 10, y: 20, x2: 10, y2: 120, step_length: 1 },
    { action: "fling", x: 10, y: 20, x2: 10, y2: 120, step_length: 101 },
    { action: "fling", x: 10, y: 20, x2: 10, y2: 20 },
    { action: "keyEvent", keys: ["Home", "1"] },
    { action: "keyEvent", keys: ["CTRL", "A"] },
  ])
    assert.throws(() => encode(input));
});

test("window percentages clamp to the selected display while duplicate window IDs and contradictory targeting reject", () => {
  const captured = snapshot();
  assert.deepEqual(
    encode(
      resolveControl(
        controlSchema.parse({
          action: "click",
          selector: { key: "submit", displayId: 1 },
        }),
        captured,
      ),
    ),
    ["click", "120", "220", "1"],
  );
  assert.deepEqual(
    encode(
      resolveControl(
        controlSchema.parse({
          action: "drag",
          selector: { key: "submit", displayId: 1 },
          gesture: {
            fromXPercent: 0,
            fromYPercent: 50,
            toXPercent: 100,
            toYPercent: 50,
          },
        }),
        captured,
      ),
    ),
    ["drag", "110", "220", "129", "220", "600", "1"],
  );
  assert.deepEqual(
    encode(
      resolveControl(
        controlSchema.parse({
          action: "fling",
          window: { id: "window" },
          display_id: 1,
          gesture: {
            fromXPercent: 0,
            fromYPercent: 0,
            toXPercent: 100,
            toYPercent: 100,
            velocity: 800,
            stepLength: 2,
          },
        }),
        captured,
      ),
    ),
    ["fling", "100", "200", "499", "999", "800", "2", "1"],
  );
  for (const value of [
    {
      action: "click",
      window: { id: "window" },
      point: { xPercent: 50, yPercent: 50 },
    },
    { action: "click", selector: { key: "submit", limit: 1 } },
    {
      action: "click",
      selector: { key: "submit", displayId: 1 },
      display_id: 0,
    },
    {
      action: "click",
      window: { id: "window" },
      display_id: 1,
      point: { xPercent: 50, yPercent: 50 },
      x: 300,
      y: 300,
    },
    { action: "click", window: { id: "window" }, display_id: 1, x: 10, y: 20 },
    { action: "click", point: { xPercent: 50, yPercent: 50 } },
  ])
    assert.throws(() => resolveControl(controlSchema.parse(value), captured));
});

test("direct controls use one capture, route the selected display and reject nonempty native error receipts even on exit zero", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-ui-control-")),
    store = new StateStore(root),
    processes = new ProcessService(),
    device = new DeviceService(processes, store);
  const receipt = {
    stdout: "",
    stderr: "",
    elapsedMs: 1,
    pid: null,
    exitCode: 0,
    signal: null,
    truncated: false,
  };
  let captures = 0;
  t.mock.method(device, "snapshot", async () => {
    captures++;
    return snapshot();
  });
  const shell = t.mock.method(device, "shell", async () => receipt);
  try {
    await device.control("device", {
      action: "click",
      selector: { key: "submit", displayId: 1 },
    });
    assert.equal(captures, 1);
    assert.deepEqual(shell.mock.calls[0]!.arguments[1], [
      "uitest",
      "uiInput",
      "click",
      "120",
      "220",
      "1",
    ]);
    await assert.rejects(
      device.control("device", {
        action: "click",
        selector: { key: "submit", limit: 1 },
      }),
      { code: "UI_TARGET_AMBIGUOUS" },
    );
    assert.equal(shell.mock.callCount(), 1);
    receipt.stdout = "No target window found";
    await assert.rejects(
      device.control("device", { action: "click", x: 10, y: 20 }),
      { code: "UI_ACTION_FAILED" },
    );
  } finally {
    await device.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Unicode paste requests retain display identity and validate it before a connection can be made", () => {
  assert.deepEqual(textRequest({ x: 10, y: 20, displayId: 1 }, "中文🙂"), [
    { x: 10, y: 20, displayId: 1 },
    "中文🙂",
    { paste: true },
  ]);
  for (const displayId of [-1, 0.5, 2147483648])
    assert.throws(() => textRequest({ x: 10, y: 20, displayId }, "中文"), {
      code: "UI_DISPLAY_INVALID",
    });
});
