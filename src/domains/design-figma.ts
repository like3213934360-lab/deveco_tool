import { z } from "zod";
import { invariant } from "../core/errors.js";
import type { Element } from "./design-markup.js";

const box = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() });
type Bounds = z.output<typeof box>;
const color = z.object({ r: z.number().min(0).max(1), g: z.number().min(0).max(1), b: z.number().min(0).max(1), a: z.number().min(0).max(1) });
const layer = z.object({
  id: z.string().min(1), type: z.string(), name: z.string().optional(), visible: z.boolean().optional(),
  absoluteBoundingBox: box.nullable().optional(), children: z.array(z.unknown()).optional(),
  fills: z.array(z.object({ type: z.string(), visible: z.boolean().optional(), color: color.optional(), opacity: z.number().min(0).max(1).optional() })).optional(),
  strokes: z.array(z.object({ visible: z.boolean().optional() })).optional(), effects: z.array(z.object({ visible: z.boolean().optional() })).optional(),
  opacity: z.number().min(0).max(1).optional(), rotation: z.number().optional(), cornerRadius: z.number().min(0).optional(),
  rectangleCornerRadii: z.array(z.number()).optional(), clipsContent: z.boolean().optional(),
  characters: z.string().optional(), characterStyleOverrides: z.array(z.number()).optional(),
  style: z.object({ fontSize: z.number().positive(), fontWeight: z.number().int().optional(), fontFamily: z.string().optional(),
    textAlignHorizontal: z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]).optional() }).optional(),
});
const containers = new Set(["FRAME", "GROUP", "COMPONENT", "INSTANCE", "COMPONENT_SET"]);
const images = new Set(["VECTOR", "ELLIPSE", "REGULAR_POLYGON", "LINE", "STAR", "BOOLEAN_OPERATION"]);

export function figmaFrame(raw: unknown, id?: string) {
  const input = raw as { nodes?: Record<string, { document: unknown } | null>; document?: unknown } | null;
  let root: unknown;
  if (input?.nodes) {
    const ids = Object.keys(input.nodes);
    invariant(id || ids.length === 1, "INVALID_INPUT", "Pick one Figma node from the nodes response", { nodes: ids.slice(0, 20) });
    root = input.nodes[id ?? ids[0]!]?.document;
  } else root = input?.document ?? raw;
  if (id && !input?.nodes) {
    const pending = [root];
    let count = 0;
    root = undefined;
    while (pending.length) {
      invariant(++count <= 10000, "INVALID_INPUT", "Figma document search exceeds 10000 layers");
      const candidate = pending.pop() as { id?: string; children?: unknown[] } | undefined;
      if (candidate?.id === id) { root = candidate; break; }
      if (Array.isArray(candidate?.children)) for (const child of candidate.children) pending.push(child);
    }
  }
  invariant(root, "NOT_FOUND", "Figma response does not contain the requested node", { node: id });
  return layoutFrame(root);
}

export function layoutFrame(root: unknown) {
  let total = 0;
  function toElement(value: unknown, parent: Bounds | undefined, depth: number): Element | undefined {
    invariant(++total <= 500 && depth < 32, "INVALID_INPUT", "Design frame exceeds 500 layers or 32 levels");
    const item = layer.parse(value);
    if (item.visible === false) return;
    const b = item.absoluteBoundingBox;
    invariant(b, "EVIDENCE_MISSING", "Design layer has no geometry", { node: item.id, type: item.type });
    const px = (n: number) => n.toFixed(3);
    const style = ["width:" + px(b.width), "height:" + px(b.height)];
    if (parent) style.push("position:absolute", "left:" + px(b.x - parent.x), "top:" + px(b.y - parent.y));
    const fills = item.fills?.filter((fill) => fill.visible !== false) ?? [];
    const isImage = images.has(item.type) || fills.some((fill) => fill.type === "IMAGE");
    if (isImage) {
      invariant(parent, "CAPABILITY_UNAVAILABLE", "Export a containing frame for image layers");
      return { tag: "img", attrs: { style: style.join(";"), src: item.id, alt: item.name ?? "", id: item.id }, children: [] };
    }
    invariant(containers.has(item.type) || item.type === "RECTANGLE" || item.type === "TEXT",
      "CAPABILITY_UNAVAILABLE", "Unsupported design layer type", { node: item.id, type: item.type });
    invariant(!item.rotation && !item.effects?.some((effect) => effect.visible !== false) &&
      !item.strokes?.some((stroke) => stroke.visible !== false) && !item.rectangleCornerRadii?.some((radius) => radius !== (item.cornerRadius ?? 0)),
    "CAPABILITY_UNAVAILABLE", "Native conversion needs unrotated layers without effects, strokes or mixed corner radii", { node: item.id });
    if (item.opacity !== undefined) style.push("opacity:" + item.opacity);
    if (item.cornerRadius) style.push("border-radius:" + px(item.cornerRadius));
    if (item.clipsContent) style.push("overflow:hidden");
    invariant(fills.length <= 1 && fills.every((fill) => fill.type === "SOLID" && fill.color),
      "CAPABILITY_UNAVAILABLE", "Use a single solid fill for native conversion", { node: item.id });
    const fill = fills[0];
    if (fill?.color) {
      const { r, g, b, a } = fill.color;
      const hex = "#" + [r, g, b, a * (fill.opacity ?? 1)].map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("");
      style.push((item.type === "TEXT" ? "color:" : "background-color:") + hex);
    }
    if (item.type === "TEXT") {
      const text = item.style;
      invariant(text && item.characters !== undefined && !item.characterStyleOverrides?.some(Boolean),
        "CAPABILITY_UNAVAILABLE", "Native labels need uniform text styling", { node: item.id });
      style.push("font-size:" + px(text.fontSize), "white-space:pre-wrap");
      if (text.fontWeight !== undefined) style.push("font-weight:" + text.fontWeight);
      if (text.textAlignHorizontal) style.push("text-align:" + text.textAlignHorizontal.toLowerCase());
      return { tag: "span", attrs: { style: style.join(";"), id: item.id }, children: [item.characters] };
    }
    if (containers.has(item.type)) style.push("display:stack");
    return { tag: "div", attrs: { style: style.join(";"), id: item.id },
      children: (item.children ?? []).map((child) => toElement(child, b, depth + 1)).filter((child) => child !== undefined) };
  }
  const view = toElement(root, undefined, 0);
  invariant(view, "INVALID_INPUT", "The selected design node is hidden");
  return view;
}
