import { z } from "zod";
import { invariant } from "../core/errors.js";
import { layoutFrame } from "./design-figma.js";

const local = z.object({
  id: z.string().min(1), type: z.string(), name: z.string().optional(), visible: z.boolean().optional(), opacity: z.number().min(0).max(1).optional(),
  layoutStyle: z.object({
    width: z.number().positive(), height: z.number().positive(), relativeX: z.number().optional(), relativeY: z.number().optional(),
    rotate: z.number().optional(), rotateX: z.number().optional(), rotateY: z.number().optional(),
  }),
  fill: z.string().optional(), _color: z.string().optional(), textColor: z.union([z.string(), z.array(z.string()).length(1)]).optional(),
  text: z.array(z.object({ text: z.string(), font: z.string(), link: z.unknown().optional() })).optional(),
  children: z.array(z.unknown()).optional(), strokeColor: z.unknown().optional(), interactive: z.array(z.unknown()).optional(),
  effects: z.array(z.unknown()).optional(), cornerRadius: z.number().min(0).optional(),
});
const shape = z.object({ nodes: z.array(z.unknown()).min(1), styles: z.record(z.string(), z.object({ value: z.unknown() })).default({}) });
const font = z.object({ size: z.coerce.number().positive(), weight: z.coerce.number().int() });

export function mastergoFrame(raw: unknown, id?: string) {
  const payload = shape.parse((raw as { dsl?: unknown } | null)?.dsl ?? raw);
  const roots = payload.nodes.filter((node) => (node as { visible?: boolean } | null)?.visible !== false);
  invariant(id || roots.length === 1, "INVALID_INPUT", "Select the MasterGo layer ID");
  const root = id ? roots.find((node) => (node as { id?: string } | null)?.id === id) : roots[0];
  invariant(root, "NOT_FOUND", "MasterGo snapshot does not contain the selected layer", { id });
  let count = 0;
  const styleValue = (key: string) => Object.hasOwn(payload.styles, key) ? payload.styles[key]!.value : undefined;
  function normalize(raw: unknown, baseX: number, baseY: number, depth: number): unknown {
    invariant(++count <= 500 && depth < 32, "INVALID_INPUT", "MasterGo frame exceeds 500 layers or 32 levels");
    const node = local.parse(raw), layer = node.layoutStyle;
    if (node.visible === false) return null;
    invariant(!node.interactive?.length && !node.text?.some((part) => part.link),
      "CAPABILITY_UNAVAILABLE", "MasterGo links and event bindings require a reviewed ArkTS page", { node: node.id });
    invariant(!layer.rotateX && !layer.rotateY && !node.effects?.length && !node.strokeColor,
      "CAPABILITY_UNAVAILABLE", "Native MasterGo conversion cannot preserve these effects or strokes", { node: node.id });
    const x = baseX + (layer.relativeX ?? 0), y = baseY + (layer.relativeY ?? 0);
    const type = node.type === "PATH" ? "VECTOR" : node.type === "IMAGE" ? "VECTOR" : node.type;
    const styleKey = node.type === "TEXT" ? [node.textColor].flat()[0] ?? node.fill : node.fill;
    const paint = node._color ?? (styleKey && (styleValue(styleKey) ?? styleKey));
    const rgba = Array.isArray(paint) && paint.length === 1 ? paint[0] : paint;
    let fills;
    if (rgba !== undefined && type !== "VECTOR") {
      invariant(typeof rgba === "string" && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(rgba),
        "CAPABILITY_UNAVAILABLE", "A native MasterGo layer needs a solid color from its style table", { node: node.id, style: styleKey });
      const [r, g, b, a = 1] = rgba.slice(1).match(/../g)!.map((channel) => Number.parseInt(channel, 16) / 255);
      fills = [{ type: "SOLID", color: { r, g, b, a } }];
    }
    let style, characters;
    if (type === "TEXT") {
      const parts = node.text ?? [], key = parts[0]?.font;
      invariant(key && parts.every((part) => part.font === key), "CAPABILITY_UNAVAILABLE", "MasterGo text needs one resolved font style", { node: node.id });
      const chosen = font.parse(styleValue(key));
      style = { fontSize: chosen.size, fontWeight: chosen.weight };
      characters = parts.map((part) => part.text).join("");
    }
    return { id: node.id, type, name: node.name, absoluteBoundingBox: { x, y, width: layer.width, height: layer.height },
      fills, style, characters, opacity: node.opacity, rotation: layer.rotate, cornerRadius: node.cornerRadius,
      children: (node.children ?? []).map((child) => normalize(child, x, y, depth + 1)).filter(Boolean) };
  }
  return layoutFrame(normalize(root, 0, 0, 0));
}
