import test from "node:test";
import assert from "node:assert/strict";
import { encode } from "jpeg-js";
import { progressFrameSignature, progressWindows } from "../src/services/ui-progress.js";
import { flattenDump } from "../src/services/ui-tree.js";

const output = { width: 64, height: 128 }, native = { width: 128, height: 256 };
const windows = [{ x1: 0, y1: 64, x2: 128, y2: 256 }];
function frame(region?: "system" | "canvas", comments?: string[]) {
  const data = Buffer.alloc(output.width * output.height * 4, 255);
  if (region) {
    const top = region === "system" ? 0 : 64;
    for (let y = top; y < top + 8; y++)
      for (let x = 0; x < 8; x++) data.fill(0, (y * output.width + x) * 4, (y * output.width + x) * 4 + 3);
  }
  return encode({ ...output, data, ...(comments ? { comments } : {}) }, 90).data;
}
test("progress ignores system pixels and encoded metadata while preserving canvas-only application changes", () => {
  const original = frame(), system = frame("system"), metadata = frame(undefined, ["capture two"]);
  assert.notDeepEqual(original, system);
  assert.notDeepEqual(original, metadata);
  const sign = (bytes: Buffer) => progressFrameSignature(bytes, native, output, windows);
  assert.equal(sign(original), sign(system));
  assert.equal(sign(original), sign(metadata));
  assert.notEqual(sign(original), sign(frame("canvas")));
  assert.notEqual(sign(original), progressFrameSignature(original, native, output, [{ ...windows[0]!, y1: 80 }]));
});
test("progress uses captured bounds for multiple windows and refuses missing, empty or invalid scope", () => {
  const nodes = flattenDump([{ attributes: { type: "WindowScene", bounds: "[0,64][128,256]" } },
    { attributes: { type: "WindowScene", bounds: "[32,96][96,192]" } }]);
  const scope = progressWindows(nodes);
  assert.deepEqual(scope[0], windows[0]);
  assert.equal(progressFrameSignature(frame(), native, output, scope), progressFrameSignature(frame(), native, output, scope.toReversed()));
  for (const bad of [[], [{ x1: 0, y1: 0, x2: 0, y2: 0 }], [{ x1: NaN, y1: 0, x2: 12, y2: 12 }], [{ x1: 1000, y1: 0, x2: 1100, y2: 10 }]])
    assert.throws(() => progressFrameSignature(frame(), native, output, bad), { code: "UI_PROGRESS_SCOPE_INVALID" });
  assert.throws(() => progressWindows(flattenDump({ attributes: { type: "WindowScene" } })), { code: "UI_PROGRESS_SCOPE_INVALID" });
});
test("progress never falls back to a full frame for corrupt or mismatched JPEG evidence", () => {
  assert.throws(() => progressFrameSignature(Buffer.from([255, 216, 255, 217]), native, output, windows), { code: "UI_PROGRESS_IMAGE_INVALID" });
  assert.throws(() => progressFrameSignature(frame(), native, { width: 65, height: 128 }, windows), { code: "UI_PROGRESS_IMAGE_INVALID" });
});
