import { createHash } from "node:crypto";
import { decode } from "jpeg-js";
import { invariant, ToolError } from "../core/errors.js";
import { isWindowSurface, type Rect, type UiNode } from "./ui-tree.js";

/** Use captured application window bounds, never fixed status-bar pixel offsets. */
export function progressWindows(nodes: readonly UiNode[]): Rect[] {
  const windows = nodes.filter(node => isWindowSurface(node) && node.visible !== false);
  invariant(windows.length > 0 && windows.length <= 32 && windows.every(node => node.rect),
    "UI_PROGRESS_SCOPE_INVALID", "Progress comparison requires captured application window bounds");
  return windows.map(node => node.rect!);
}

/** Retained screenshots stay complete; only the internal progress digest is scoped. */
export function progressFrameSignature(
  encoded: Buffer,
  native: { width: number; height: number },
  output: { width: number; height: number },
  windows: readonly Rect[],
): string {
  invariant(windows.length > 0 && windows.length <= 32 &&
    [native.width, native.height, output.width, output.height].every(n => Number.isSafeInteger(n) && n > 0),
    "UI_PROGRESS_SCOPE_INVALID", "Invalid progress image dimensions or window scope");
  const regions = windows.map(rect => {
    invariant(Object.values(rect).length === 4 && Object.values(rect).every(Number.isFinite),
      "UI_PROGRESS_SCOPE_INVALID", "Invalid application window bounds");
    const x1 = Math.max(0, Math.ceil(rect.x1 * output.width / native.width)),
      y1 = Math.max(0, Math.ceil(rect.y1 * output.height / native.height)),
      x2 = Math.min(output.width, Math.floor(rect.x2 * output.width / native.width)),
      y2 = Math.min(output.height, Math.floor(rect.y2 * output.height / native.height));
    invariant(x2 > x1 && y2 > y1, "UI_PROGRESS_SCOPE_INVALID", "Application window has no captured pixels");
    return { x1, y1, x2, y2 };
  }).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1 || a.y2 - b.y2 || a.x2 - b.x2);
  let image;
  try {
    image = decode(encoded, { useTArray: true, formatAsRGBA: false, tolerantDecoding: false,
      maxResolutionInMP: 7, maxMemoryUsageInMB: 128 });
  } catch {
    throw new ToolError("UI_PROGRESS_IMAGE_INVALID", "Progress image could not be decoded within its bounded pixel and memory budget");
  }
  invariant(image.width === output.width && image.height === output.height,
    "UI_PROGRESS_IMAGE_INVALID", "Decoded progress image dimensions differ from the capture receipt");
  const hash = createHash("sha256").update(JSON.stringify({ version: 1, native, output, regions }));
  for (const rect of regions) {
    for (let y = rect.y1; y < rect.y2; y++) {
      hash.update(image.data.subarray((y * image.width + rect.x1) * 3, (y * image.width + rect.x2) * 3));
    }
  }
  return hash.digest("hex");
}
