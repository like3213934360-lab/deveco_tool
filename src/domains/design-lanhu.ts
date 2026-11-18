import { z } from "zod";
import { invariant } from "../core/errors.js";
import { layoutFrame } from "./design-figma.js";

const extent = z.object({ width: z.number().positive(), height: z.number().positive() });
const typography = z.object({
  font_size: z.number().positive().nullish(), font_weight: z.union([z.number().int(), z.string()]).nullish(),
  color: z.string().nullish(), text_align: z.string().nullish(),
});
const layer = z.object({
  node_id: z.string().min(1), parent_id: z.string().min(1).nullable(), source_order: z.number().int().nonnegative(),
  name: z.string(), node_type: z.string(), source_visible: z.boolean().nullable(), text: z.string().nullable(),
  bounds: extent.extend({ x: z.number(), y: z.number() }).nullable(), asset_ids: z.array(z.string()),
  raw_style: z.object({ opacity: z.number().min(0).max(1).optional(), transform: z.unknown(), relativeTransform: z.unknown() }).optional(),
  text_spec: z.object({ base_style: typography.optional(), text_runs: z.array(typography.extend({
    start: z.number().int().nullable(), length: z.number().int().nullable(), offset_unit: z.literal("utf16"), text: z.string().nullable(),
  })) }).optional(),
});
const context = z.object({
  schemaVersion: z.literal(1), identity: z.object({ snapshotId: z.string().min(1) }), canvas: extent,
  coordinateSpace: z.literal("source_canvas"), coordinateMapping: z.object({ verified: z.literal(true) }),
  nodeIndex: z.object({ complete: z.literal(true), count: z.number().int().positive(), total: z.number().int().positive() }),
});
const index = z.object({
  schemaVersion: z.literal(1), snapshotId: z.string().min(1), complete: z.literal(true), total: z.number().int().positive(),
  nodes: z.array(layer).min(1).max(499),
});
const containers = new Set(["artboard", "artboard-group", "group", "layer-group", "grouplayer", "frame"]);
type Layer = z.output<typeof layer>;

export function lanhuFrame(indexData: unknown, contextData: unknown, selectedAssets: Set<string>) {
  const design = context.parse(contextData), data = index.parse(indexData);
  invariant(design.identity.snapshotId === data.snapshotId && design.nodeIndex.count === data.nodes.length &&
    design.nodeIndex.total === data.nodes.length && data.total === data.nodes.length,
  "EVIDENCE_MISSING", "Lanhu context and complete node index must come from the same snapshot");
  const byId = new Map(data.nodes.map((node) => [node.node_id, node]));
  invariant(byId.size === data.nodes.length, "INVALID_INPUT", "Duplicate Lanhu layer ID");
  const groups = new Map<string | null, Layer[]>();
  for (const node of data.nodes.toSorted((a, b) => a.source_order - b.source_order)) {
    const parent = node.parent_id;
    invariant(parent === null || byId.has(parent), "EVIDENCE_MISSING", "Lanhu parent layer is missing", { node: node.node_id, parent });
    const group = groups.get(parent) ?? [];
    group.push(node);
    groups.set(parent, group);
  }
  const roots = groups.get(null) ?? [], pending = [...roots];
  let reachable = 0;
  while (pending.length) {
    const node = pending.pop()!;
    ++reachable;
    pending.push(...(groups.get(node.node_id) ?? []));
  }
  invariant(reachable === byId.size, "INVALID_INPUT", "Lanhu layer hierarchy contains a cycle");
  function normalize(node: Layer, depth: number): unknown {
    if (node.source_visible === false) return null;
    invariant(node.bounds && depth < 31, "EVIDENCE_MISSING", "Lanhu layer needs verified bounds within 31 levels", { node: node.node_id });
    const base = { id: node.node_id, name: node.name, absoluteBoundingBox: node.bounds, opacity: node.raw_style?.opacity };
    if (selectedAssets.has(node.node_id)) return { ...base, type: "VECTOR" };
    const kind = node.node_type.toLowerCase();
    invariant(!node.raw_style?.transform && !node.raw_style?.relativeTransform,
      "CAPABILITY_UNAVAILABLE", "Use the exported image for transformed Lanhu layers", { node: node.node_id });
    invariant(!node.asset_ids.length, "EVIDENCE_MISSING", "Supply the exported image for this Lanhu layer", { node: node.node_id });
    if (node.text !== null) {
      const runs = node.text_spec?.text_runs ?? [], run = runs[0];
      const style = run ?? node.text_spec?.base_style;
      invariant(style?.font_size && (!run || runs.length === 1 && run.start === 0 && run.length === node.text.length && run.text === node.text),
        "CAPABILITY_UNAVAILABLE", "Use uniform Lanhu text with a source font size", { node: node.node_id });
      const weight = style.font_weight === "normal" ? 400 : style.font_weight === "bold" ? 700 : Number(style.font_weight ?? undefined);
      invariant(style.font_weight == null || /^[1-9]00$/.test(String(weight)), "CAPABILITY_UNAVAILABLE", "Unsupported Lanhu font weight", { node: node.node_id });
      const fill = style.color ? [{ type: "SOLID", color: rgba(style.color, node.node_id) }] : undefined;
      return { ...base, type: "TEXT", characters: node.text, fills: fill, style: { fontSize: style.font_size,
        fontWeight: style.font_weight == null ? undefined : weight, textAlignHorizontal: style.text_align?.toUpperCase().replace(/^JUSTIFY$/, "JUSTIFIED") } };
    }
    invariant(containers.has(kind), "CAPABILITY_UNAVAILABLE", "Use an exported image for unsupported Lanhu layers", { node: node.node_id, type: node.node_type });
    return { ...base, type: "GROUP", children: (groups.get(node.node_id) ?? []).map((child) => normalize(child, depth + 1)).filter(Boolean) };
  }
  let canvasId = "lanhu-canvas";
  while (byId.has(canvasId)) canvasId += "-";
  return layoutFrame({ id: canvasId, type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, ...design.canvas },
    children: roots.map((node) => normalize(node, 0)).filter(Boolean) });
}

function rgba(value: string, node: string) {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (hex) {
    const [r, g, b, a] = (hex[1]! + (hex[2] ?? "ff")).match(/../g)!.map((part) => parseInt(part, 16) / 255);
    return { r, g, b, a };
  }
  const css = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d(?:\.\d+)?|\.\d+)\s*\)$/.exec(value);
  invariant(css, "CAPABILITY_UNAVAILABLE", "Unsupported Lanhu text color", { node });
  return { r: Number(css[1]) / 255, g: Number(css[2]) / 255, b: Number(css[3]) / 255, a: Number(css[4]) };
}
