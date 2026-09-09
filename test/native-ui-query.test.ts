import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DeviceService,
  UiIndex,
  type Snapshot,
} from "../src/services/device.js";
import { parseUiDump } from "../src/services/ui-parse.js";
import { inspectSnapshot } from "../src/services/ui-inspection.js";
import { StateStore } from "../src/core/store.js";
import { ProcessService } from "../src/core/process.js";
import { selectorSchema, tools } from "../src/core/contracts.js";
import { Runtime } from "../src/services/runtime.js";
import { setImmediate as nextTurn } from "node:timers/promises";

const tree = () =>
  [0, 1].map((displayId) => ({
    attributes: {
      type: "WindowScene",
      id: "same",
      displayId,
      bundleName: `com.display${displayId}`,
      bounds: "[0,0][100,100]",
    },
    children: [
      {
        attributes: { type: "Column", bounds: "[0,0][100,100]" },
        children: [0, 1].map((i) => ({
          attributes: {
            type: "Button",
            text: "相同按钮",
            id: `button-${i}`,
            focused: i === 0,
            bounds: "[1,1][20,20]",
          },
        })),
      },
    ],
  }));
function snapshot(): Snapshot {
  const parsed = parseUiDump(JSON.stringify(tree()));
  return {
    id: "snapshot",
    device: "device",
    created: Date.now(),
    ...parsed,
    query: new UiIndex(parsed.nodes),
  };
}
test("UI hierarchy signatures detect reparenting without changes to node order or attributes", () => {
  const flat = tree(),
    first = parseUiDump(JSON.stringify(flat));
  const original = flat[0]!.children[0]!;
  const altered = [
    {
      ...flat[0],
      children: [{ ...original, children: [] }, ...original.children],
    },
    flat[1],
  ];
  const second = parseUiDump(JSON.stringify(altered));
  assert.equal(first.nodes.length, second.nodes.length);
  assert.deepEqual(
    first.nodes.map(({ parent: _parent, depth: _depth, ...node }) => node),
    second.nodes.map(({ parent: _parent, depth: _depth, ...node }) => node),
  );
  assert.notEqual(first.signature, second.signature);
  assert.notEqual(first.structureSignature, second.structureSignature);
  assert.deepEqual(
    first.nodes.map((n) => n.parent),
    [null, 0, 1, 1, null, 4, 5, 5],
  );
});
test("UI inspection keeps global parent references across depth filters, displays and pages", () => {
  const captured = snapshot(),
    scoped = inspectSnapshot(captured, {
      display_id: 1,
      window_id: "same",
      offset: 0,
      limit: 2,
    });
  assert.equal(scoped.matching_nodes, 4);
  assert.equal(scoped.window_count, 1);
  assert.equal(scoped.windows[0]!.root_index, 4);
  assert.deepEqual(scoped.windows[0]!.bundle_names, ["com.display1"]);
  assert.equal(scoped.windows[0]!.focused, true);
  assert.equal(scoped.next_offset, 2);
  const page = inspectSnapshot(captured, {
    display_id: 1,
    offset: 2,
    limit: 2,
  });
  assert.deepEqual(
    page.nodes.map((n) => [n.index, n.parent]),
    [
      [6, 5],
      [7, 5],
    ],
  );
  assert.equal(page.next_offset, null);
  const shallow = inspectSnapshot(captured, {
    max_depth: 1,
    offset: 0,
    limit: 20,
  });
  assert.deepEqual(
    shallow.nodes.map((n) => n.index),
    [0, 1, 4, 5],
  );
  assert.equal(
    inspectSnapshot(captured, { display_id: 7, offset: 0, limit: 20 })
      .matching_nodes,
    0,
  );
  assert.equal(
    inspectSnapshot(captured, {
      selector: selectorSchema.parse({ text: "相同", displayId: 1 }),
      offset: 0,
      limit: 20,
    }).matching_nodes,
    2,
  );
});
test("UI named queries share one capture and retain untruncated counts for ambiguous selectors", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-ui-query-")),
    store = new StateStore(root),
    processes = new ProcessService(),
    device = new DeviceService(processes, store);
  let captures = 0;
  device.snapshot = async () => {
    captures++;
    return snapshot();
  };
  try {
    const input = tools.ui_observe.schema.parse({
      selectors: [
        { id: "both", selector: { text: "相同", limit: 1 } },
        { id: "display", selector: { key: "button-0", displayId: 1 } },
        { id: "missing", selector: { key: "absent" } },
      ],
    });
    const result = await device.findMany("device", input.selectors!);
    assert.equal(captures, 1);
    assert.deepEqual(
      result.queries.map((x) => [
        x.id,
        x.match_count,
        x.matches.length,
        x.truncated,
      ]),
      [
        ["both", 4, 1, true],
        ["display", 1, 1, false],
        ["missing", 0, 0, false],
      ],
    );
    assert.throws(() =>
      tools.ui_find.schema.parse({ selector: {}, selectors: input.selectors }),
    );
    assert.throws(() =>
      tools.ui_find.schema.parse({
        selectors: [
          { id: "same", selector: {} },
          { id: "same", selector: {} },
        ],
      }),
    );
    assert.throws(() =>
      tools.ui_find.schema.parse({
        selectors: Array.from({ length: 33 }, (_, i) => ({
          id: String(i),
          selector: {},
        })),
      }),
    );
  } finally {
    device.close();
    await processes.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("observation overlaps tree and image reads but retains the device lease until both finish on success, failure and cancellation", async () => {
  for (const mode of ["success", "failure", "cancel"] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-observe-"));
    const previous = process.env.DEVECO_STATE_DIR;
    process.env.DEVECO_STATE_DIR = root;
    const runtime = new Runtime();
    if (previous === undefined) delete process.env.DEVECO_STATE_DIR;
    else process.env.DEVECO_STATE_DIR = previous;
    let treeStarted = false, imageStarted = false;
    const treeDone = Promise.withResolvers<void>(), imageDone = Promise.withResolvers<void>();
    const controller = new AbortController(), failure = new Error("tree failed");
    const frame = {
      target: "device", display_id: null, format: "jpeg" as const, mime: "image/jpeg",
      bytes: 100, width: 100, height: 200, native_width: 100, native_height: 200,
      coordinate_scale: { x: 1, y: 1 }, sha256: "frame", frame_signature: "frame", unchanged: true,
    };
    runtime.devices.target = async () => "device";
    runtime.devices.find = async (_target, input, _snapshot, signal) => runtime.store.lease("device:device", async () => {
      treeStarted = true;
      await treeDone.promise;
      signal?.throwIfAborted();
      if (mode === "failure") throw failure;
      return runtime.devices.query(snapshot(), input);
    }, signal);
    runtime.devices.screenshot = async (_target, _input, signal) => runtime.store.lease("device:device", async () => {
      imageStarted = true;
      await imageDone.promise;
      signal?.throwIfAborted();
      return frame;
    }, signal);
    let settled = false;
    const operation = runtime.call("ui_observe", { selector: { key: "button-0" }, capture: {} }, controller.signal);
    void operation.then(() => { settled = true; }, () => { settled = true; });
    try {
      await nextTurn();
      assert.equal(treeStarted && imageStarted, true, "Both reads must start before either finishes");
      if (mode === "cancel") controller.abort(failure);
      treeDone.resolve();
      await nextTurn();
      assert.equal(settled, false, "A completed/failed tree must not release the still-running image capture");
      assert.deepEqual(runtime.store.db.prepare("SELECT resource FROM leases").all(), [{ resource: "device:device" }]);
      imageDone.resolve();
      if (mode === "success") assert.deepEqual(await operation, { ...runtime.devices.query(snapshot(), { key: "button-0" }), screenshot: frame });
      else await assert.rejects(operation, (error: unknown) => error === failure);
      assert.deepEqual(runtime.store.db.prepare("SELECT resource FROM leases").all(), []);
    } finally {
      treeDone.resolve(); imageDone.resolve();
      await operation.catch(() => {});
      await runtime.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
