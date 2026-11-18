import { z } from "zod";
import { invariant } from "../core/errors.js";
import { layoutFrame } from "./design-figma.js";

const range = z.number().min(0).max(255);
const sourceColor = z.object({ r: range, g: range, b: range, a: z.number().min(0).max(1).optional() });
const paint = z.object({ type: z.string(), visible: z.boolean().optional(), opacity: z.number().min(0).max(1).optional(), color: sourceColor.optional() });
const full = z.object({
  guid: z.string().min(1), name: z.string().optional(), type: z.string(), visible: z.boolean().optional(),
  width: z.number().positive(), height: z.number().positive(), left: z.number().optional(), top: z.number().optional(),
  nodeText: z.string().optional(), fontSize: z.number().positive().optional(), fontWeight: z.number().int().optional(),
  textAlignHorizontal: z.string().optional(), fillPaints: z.array(paint).optional(), strokePaints: z.array(paint).optional(),
  childNode: z.array(z.unknown()).optional(), effects: z.array(z.object({ visible: z.boolean().optional() })).optional(),
  angle: z.number().optional(), opacity: z.number().min(0).max(1).optional(), cornerRadius: z.number().min(0).optional(),
  svgSha: z.string().optional(), mask: z.boolean().optional(), frameMaskDisabled: z.boolean().optional(),
  inheritFillStyleID: z.string().optional(), inheritTextStyleID: z.string().optional(), inheritEffectStyleID: z.string().optional(),
});

export function pixsoFrame(raw: unknown, id?: string) {
  const payload = z.object({ pixTreeNodes: z.array(z.unknown()).min(1) }).parse(raw);
  const roots = payload.pixTreeNodes.filter((node) => (node as { visible?: boolean } | null)?.visible !== false);
  invariant(id || roots.length === 1, "INVALID_INPUT", "Select the GUID of a Pixso frame");
  let nodes = 0;
  function normalize(value: unknown, originX: number, originY: number, depth: number): unknown {
    invariant(++nodes <= 500 && depth < 32, "INVALID_INPUT", "Pixso frame exceeds 500 layers or 32 levels");
    const node = full.parse(value);
    if (node.visible === false) return null;
    invariant(!node.mask && !node.inheritFillStyleID && !node.inheritTextStyleID && !node.inheritEffectStyleID,
      "CAPABILITY_UNAVAILABLE", "Expand Pixso masks and inherited styles in the source before native conversion", { node: node.guid });
    invariant(node.type !== "INSTANCE" || node.childNode?.length,
      "CAPABILITY_UNAVAILABLE", "Export expanded children for Pixso component instances", { node: node.guid });
    const x = originX + (node.left ?? 0), y = originY + (node.top ?? 0);
    const type = node.svgSha ? "VECTOR" : node.type === "PARAGRAPH" ? "TEXT" : node.type === "SYMBOL" ? "COMPONENT" : node.type;
    const fills = node.fillPaints?.map((entry) => {
      if (!entry.color) return entry;
      const { r, g, b, a } = entry.color;
      return { ...entry, color: { r: r / 255, g: g / 255, b: b / 255, a: a ?? 1 } };
    });
    const style = type === "TEXT" && node.fontSize && node.fontWeight ? {
      fontSize: node.fontSize, fontWeight: node.fontWeight, textAlignHorizontal: node.textAlignHorizontal?.toUpperCase().replace(/^JUSTIFY$/, "JUSTIFIED"),
    } : undefined;
    return { id: node.guid, type, name: node.name, absoluteBoundingBox: { x, y, width: node.width, height: node.height },
      fills, strokes: node.strokePaints, effects: node.effects, rotation: node.angle, opacity: node.opacity, cornerRadius: node.cornerRadius,
      clipsContent: node.type === "FRAME" && node.frameMaskDisabled === false,
      characters: node.nodeText, style, children: (node.childNode ?? []).map((child) => normalize(child, x, y, depth + 1)).filter(Boolean) };
  }
  const root = id ? roots.find((node) => (node as { guid?: string } | null)?.guid === id) : roots[0];
  invariant(root, "NOT_FOUND", "Pixso snapshot does not contain the selected frame GUID", { node: id });
  return layoutFrame(normalize(root, 0, 0, 0));
}
