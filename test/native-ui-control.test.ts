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
test("modern root windows retain explicit display selection and reject ambiguous application windows", () => {
  const tree = snapshot();
  for (const node of tree.nodes)
    if (node.type === "WindowScene") node.type = "root";
  const raw = {
    action: "click",
    window: { bundle_name: "com.test" },
    point: { xPercent: 50, yPercent: 50 },
  };
  assert.throws(() => resolveControl(controlSchema.parse(raw), tree), {
    code: "UI_WINDOW_AMBIGUOUS",
  });
  const operation = resolveControl(
    controlSchema.parse({ ...raw, display_id: 1 }),
    tree,
  );
  assert.equal(operation.x, 300);
  assert.equal(operation.y, 600);
  assert.equal(operation.display_id, 1);
});

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

test("direct controls use one capture, route the selected display and distinguish native success from exit-zero errors", async (t) => {
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
    receipt.stdout = "No Error\r\n";
    assert.deepEqual(
      await device.control("device", { action: "click", x: 10, y: 20 }),
      { commandAccepted: true, outcomeVerified: false },
    );
    for (const output of [
      { stdout: "No target window found", stderr: "" },
      { stdout: "No Error\nError: target disappeared", stderr: "" },
      { stdout: "No Error", stderr: "Error: operation failed" },
      { stdout: "", stderr: "No Error" },
    ]) {
      Object.assign(receipt, output);
      await assert.rejects(
        device.control("device", { action: "click", x: 10, y: 20 }),
        { code: "UI_ACTION_FAILED" },
      );
    }
  } finally {
    await device.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("focused input accepts the released UiTest help exit 1 without relaxing mutation receipts", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-focus-probe-")),
    store = new StateStore(root), processes = new ProcessService(),
    device = new DeviceService(processes, store);
  const tree = snapshot();
  const field = tree.nodes.find(node => node.type === "Button" && node.displayId === "1")!;
  field.type = "TextInput"; field.focused = true;
  t.mock.method(device, "snapshot", async () => tree);
  let helpExit = 1, helpOutput = "Missing parameter.\nUSAGE :\ntext <text> [displayId] input at current focus\n",
    inputExit = 0, mutations = 0;
  t.mock.method(device, "shell", async (...[_target, args, _signal, _timeout, allowFailure]: Parameters<DeviceService["shell"]>) => {
    const help = args[2] === "help";
    assert.equal(allowFailure, help);
    if (!help) { mutations++; assert.deepEqual(args, ["uitest", "uiInput", "text", "中文验收", "1"]); }
    return { stdout: help ? helpOutput : "No Error", stderr: "", elapsedMs: 1, pid: null,
      exitCode: help ? helpExit : inputExit, signal: null, truncated: false };
  });
  const input = { action: "text", window: { bundle_name: "com.test" }, display_id: 1, text: "中文验收" };
  try {
    assert.deepEqual(await device.control("device", input), {
      method: "uitest-current-focus", commandAccepted: true, outcomeVerified: false,
    });
    assert.equal(mutations, 1);
    helpExit = 2;
    await assert.rejects(device.control("device", input), { code: "UI_FOCUSED_TEXT_UNSUPPORTED" });
    helpExit = 1; helpOutput = "Missing parameter.";
    await assert.rejects(device.control("device", input), { code: "UI_FOCUSED_TEXT_UNSUPPORTED" });
    assert.equal(mutations, 1);
    helpOutput = "text <text> [displayId]\n"; inputExit = 1;
    await assert.rejects(device.control("device", input), { code: "UI_TEXT_UNCONFIRMED" });
    assert.equal(mutations, 2);
  } finally {
    await device.close(); await processes.close(); store.close();
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

test("focused text requires one editable field in an explicitly identified application window and preserves its focus", () => {
  const tree = snapshot();
  const field = tree.nodes.find(node => node.type === "Button" && node.displayId === "1")!;
  field.type = "TextInput"; field.focused = true;
  const input = controlSchema.parse({ action: "text", window: { bundle_name: "com.test" }, display_id: 1, text: "中文🙂 focus" });
  const resolved = resolveControl(input, tree);
  assert.equal(resolved.x, undefined); assert.equal(resolved.y, undefined);
  assert.deepEqual(uiInputArguments(resolved), ["text", "中文🙂 focus", "1"]);
  assert.throws(() => resolveControl(controlSchema.parse({ action: "text", text: "hello" }), tree), { code: "UI_SCOPE_REQUIRED" });
  assert.throws(() => resolveControl(controlSchema.parse({ ...input, x: 20, y: 30 }), tree), { code: "UI_INPUT_CONFLICT" });
  field.focused = false;
  assert.throws(() => resolveControl(input, tree), { code: "UI_FOCUS_AMBIGUOUS" });
  field.focused = true; tree.nodes.push({ ...field, id: "second-focused" });
  assert.throws(() => resolveControl(input, tree), { code: "UI_FOCUS_AMBIGUOUS" });
});

test("mouse operations retain the selected display and encode native buttons, wheel ticks and drag endpoints", async () => {
  const { mouseRequest } = await import("../src/services/ui-control.js");
  const tree = snapshot(), base = { window: { bundle_name: "com.test" }, display_id: 1 };
  const click = resolveControl(controlSchema.parse({ ...base, action: "mouseClick", point: { xPercent: 50, yPercent: 50 }, button: "right", keys: ["2072"] }), tree);
  assert.deepEqual(mouseRequest(click), { api: "Driver.mouseClick", args: [{ x: 300, y: 600, displayId: 1 }, 1, 2072] });
  const scroll = resolveControl(controlSchema.parse({ ...base, action: "mouseScroll", x: 200, y: 300, scroll_down: true, ticks: 3 }), tree);
  assert.deepEqual(mouseRequest(scroll).args, [{ x: 200, y: 300, displayId: 1 }, true, 3, 0, 0, 20]);
  const drag = resolveControl(controlSchema.parse({ ...base, action: "mouseDrag", x: 200, y: 300, x2: 210, y2: 400, velocity: 600 }), tree);
  assert.deepEqual(mouseRequest(drag).args, [{ x: 200, y: 300, displayId: 1 }, { x: 210, y: 400, displayId: 1 }, 600]);
  assert.throws(() => resolveControl(controlSchema.parse({ action: "mouseClick", x: 10, y: 20 }), tree), { code: "UI_SCOPE_REQUIRED" });
  for (const raw of [{ ...scroll, button: "left" }, { ...click, text: "secret" }, { ...click, keys: ["Back"] }, { ...click, x2: 300 }]) assert.throws(() => mouseRequest(controlSchema.parse(raw)));
});
