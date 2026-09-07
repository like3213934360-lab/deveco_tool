import test from "node:test";
import assert from "node:assert/strict";
import { UiIndex, flattenDump, parseRect } from "../src/services/device.js";
import { selectorSchema } from "../src/core/contracts.js";

test("snapshot indexes preserve duplicate selectors and isolate equal window IDs on separate displays", () => {
  const tree = new UiIndex(
    flattenDump(
      [0, 1].map((displayId) => ({
        attributes: {
          type: "WindowScene",
          id: "same-window",
          displayId,
          bounds: displayId === 0 ? "[0,0][100,100]" : "[500,500][1000,1000]",
        },
        children: [0, 1].map((i) => ({
          attributes: {
            type: "Button",
            id: "duplicate",
            text: "测试 LABEL",
            checked: i === 0,
            bounds: displayId === 0 ? "[5,5][10,10]" : "[505,505][510,510]",
          },
        })),
      })),
    ),
  );
  assert.equal(
    tree.select(selectorSchema.parse({ key: "duplicate" })).length,
    4,
  );
  assert.equal(
    tree.select(selectorSchema.parse({ text: "测试 label", textMode: "exact" }))
      .length,
    4,
  );
  assert.equal(
    tree.select(
      selectorSchema.parse({ type: "BUTTON", checked: true, displayId: 1 }),
    ).length,
    1,
  );
  assert.equal(
    tree.select(selectorSchema.parse({ key: "duplicate", type: "Text" }))
      .length,
    0,
  );
  assert.equal(tree.select(selectorSchema.parse({ text: "LABEL" })).length, 4);
  // Another snapshot with changed content must build its own index.
  const changed = new UiIndex(
    flattenDump({
      attributes: { id: "new", text: "changed", bounds: "[0,0][10,10]" },
    }),
  );
  assert.equal(
    changed.select(selectorSchema.parse({ key: "duplicate" })).length,
    0,
  );
  assert.equal(changed.select(selectorSchema.parse({ key: "new" })).length, 1);
});

test("nonfinite UI rectangles are not actionable", () => {
  assert.equal(parseRect(`[0,0][${"9".repeat(400)},100]`), null);
});
