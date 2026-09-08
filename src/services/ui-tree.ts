import type { Selector } from "../core/contracts.js";
import { invariant } from "../core/errors.js";

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface UiNode {
  parent: number | null;
  depth: number;
  id: string | null;
  type: string;
  key: string | null;
  text: string;
  rect: Rect | null;
  checked: boolean | null;
  selected: boolean | null;
  enabled: boolean | null;
  clickable: boolean | null;
  visible: boolean | null;
  value: string | number | null;
  displayId: string | null;
  windowId: string | null;
  bundleName: string | null;
  abilityName: string | null;
  focused: boolean | null;
  checkable: boolean | null;
  pagePath: string | null;
}
/** UiTest emits application window roots as root; SceneBoard uses WindowScene.
 * A nested control named root is not an independent window. */
export function isWindowSurface(node: UiNode): boolean {
  return (
    node.type === "WindowScene" || (node.type === "root" && node.depth <= 1)
  );
}
export function parseRect(value: unknown): Rect | null {
  if (typeof value !== "string") return null;
  const pattern = /-?\d+(?:\.\d+)?/g;
  const a = Number(pattern.exec(value)?.[0] ?? NaN),
    b = Number(pattern.exec(value)?.[0] ?? NaN),
    c = Number(pattern.exec(value)?.[0] ?? NaN),
    d = Number(pattern.exec(value)?.[0] ?? NaN);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(c) ||
    !Number.isFinite(d)
  )
    return null;
  return {
    x1: Math.min(a, c),
    y1: Math.min(b, d),
    x2: Math.max(a, c),
    y2: Math.max(b, d),
  };
}
const nullableText = (v: unknown): string | null =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
const textKeys = [
  "content",
  "text",
  "label",
  "accessibilityText",
  "description",
] as const;
function nodeText(attrs: Record<string, unknown>): string {
  for (const key of textKeys) {
    const value = attrs[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return "";
}
const flag = (v: unknown): boolean | null =>
  v === true || v === "true"
    ? true
    : v === false || v === "false"
      ? false
      : null;
export function flattenDump(raw: unknown): UiNode[] {
  const nodes: UiNode[] = [];
  const stack: {
    value: unknown;
    window: string | null;
    bundle?: string | null;
    ability?: string | null;
    display?: string | null;
    parent: number | null;
    depth: number;
  }[] = [{ value: raw, window: null, parent: null, depth: 0 }];
  while (stack.length) {
    const current = stack.pop()!;
    const value = current.value;
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--)
        stack.push({ ...current, value: value[i] });
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    if (
      node.content &&
      !node.attributes &&
      !node.$attrs &&
      !node.children &&
      !node.$children
    ) {
      stack.push({ ...current, value: node.content });
      continue;
    }
    const attrs = (node.attributes ?? node.$attrs ?? {}) as Record<
      string,
      unknown
    >;
    const type = String(node.$type ?? node.type ?? attrs.type ?? ""),
      window =
        nullableText(
          attrs.windowId ??
            node.windowId ??
            (type === "WindowScene" ? attrs.id : undefined),
        ) ?? current.window;
    const bundle = nullableText(attrs.bundleName) ?? current.bundle ?? null,
      ability = nullableText(attrs.abilityName) ?? current.ability ?? null,
      display = nullableText(attrs.displayId) ?? current.display ?? null;
    nodes.push({
      parent: current.parent,
      depth: current.depth,
      id: nullableText(node.$ID ?? node.id ?? attrs.id),
      type,
      key: nullableText(attrs.key ?? attrs.id),
      text: nodeText(attrs),
      rect: parseRect(node.$rect ?? attrs.bounds ?? attrs.rect),
      checked: flag(attrs.checked ?? attrs.isChecked ?? attrs.isOn),
      selected: flag(attrs.selected ?? attrs.isSelected),
      enabled: flag(attrs.enabled),
      clickable: flag(attrs.clickable),
      visible: flag(attrs.visible),
      value:
        typeof attrs.value === "string" ||
        (typeof attrs.value === "number" && Number.isFinite(attrs.value))
          ? attrs.value
          : null,
      displayId: display,
      windowId: window,
      bundleName: bundle,
      abilityName: ability,
      focused: flag(attrs.focused),
      checkable: flag(attrs.checkable),
      pagePath: nullableText(attrs.pagePath),
    });
    invariant(
      nodes.length <= 100000,
      "UI_TREE_TOO_LARGE",
      "UI tree exceeds 100000 nodes",
    );
    const children = node.children ?? node.$children;
    const parent = nodes.length - 1;
    if (Array.isArray(children))
      for (let i = children.length - 1; i >= 0; i--)
        stack.push({
          value: children[i],
          window,
          bundle,
          ability,
          display,
          parent,
          depth: current.depth + 1,
        });
  }
  invariant(nodes.length > 0, "UI_TREE_INVALID", "UI tree contains no nodes");
  return nodes;
}
/** One index per immutable snapshot. Dropping the snapshot releases every index. */
export class UiIndex {
  private readonly onScreen = new WeakSet<UiNode>();
  private readonly fields: Partial<
    Record<"key" | "type" | "node_id" | "text", Map<string, UiNode[]>>
  > = {};
  constructor(readonly nodes: UiNode[]) {
    const displays = new Map<string | null, Map<string | null, Rect>>();
    for (const node of nodes) {
      const rect = node.rect;
      if (!rect) continue;
      let windows = displays.get(node.displayId);
      if (!windows) {
        windows = new Map();
        displays.set(node.displayId, windows);
      }
      let screen = windows.get(node.windowId);
      if (!screen) {
        screen = rect;
        windows.set(node.windowId, screen);
      }
      if (
        rect &&
        node.visible !== false &&
        rect.x2 > rect.x1 &&
        rect.y2 > rect.y1 &&
        (!screen ||
          (rect.x2 > screen.x1 &&
            rect.x1 < screen.x2 &&
            rect.y2 > screen.y1 &&
            rect.y1 < screen.y2))
      )
        this.onScreen.add(node);
    }
  }
  visible(node: UiNode) {
    return this.onScreen.has(node);
  }
  private field(field: keyof UiIndex["fields"]) {
    const cached = this.fields[field];
    if (cached) return cached;
    const index = new Map<string, UiNode[]>();
    for (const node of this.nodes) {
      const value =
        field === "node_id"
          ? node.id
          : field === "key"
            ? node.key
            : node[field].toLowerCase();
      if (value === null) continue;
      const entries = index.get(value);
      if (entries) entries.push(node);
      else index.set(value, [node]);
    }
    this.fields[field] = index;
    return index;
  }
  candidates(selector: Selector): UiNode[] {
    let result = this.nodes;
    for (const [field, value] of [
      ["key", selector.key],
      ["type", selector.type?.toLowerCase()],
      ["node_id", selector.node_id],
      [
        "text",
        selector.textMode === "exact"
          ? selector.text?.toLowerCase()
          : undefined,
      ],
    ] as const) {
      if (value === undefined) continue;
      const candidates = this.field(field).get(value) ?? [];
      if (candidates.length < result.length) result = candidates;
    }
    return result;
  }
  select(selector: Selector): UiNode[] {
    return selectNodes(this.nodes, selector, this);
  }
}
export function selectNodes(
  nodes: UiNode[],
  selector: Selector,
  index = new UiIndex(nodes),
): UiNode[] {
  const wantedText = selector.text?.toLowerCase(),
    wantedType = selector.type?.toLowerCase();
  const wantedDisplay =
    selector.displayId === undefined ? undefined : String(selector.displayId);
  const targeted =
    selector.text !== undefined ||
    selector.key !== undefined ||
    selector.type !== undefined ||
    selector.node_id !== undefined ||
    selector.clickableOnly ||
    [
      selector.checked,
      selector.selected,
      selector.enabled,
      selector.value,
    ].some((value) => value !== undefined);
  const matches: UiNode[] = [];
  for (const node of index.candidates(selector)) {
    if (
      selector.text !== undefined &&
      !(selector.textMode === "exact"
        ? node.text.toLowerCase() === wantedText
        : node.text.toLowerCase().includes(wantedText!))
    )
      continue;
    if (
      (selector.key !== undefined && node.key !== selector.key) ||
      (selector.type !== undefined && node.type.toLowerCase() !== wantedType)
    )
      continue;
    if (
      (selector.node_id !== undefined && node.id !== selector.node_id) ||
      (selector.window_id !== undefined && node.windowId !== selector.window_id)
    )
      continue;
    if (selector.displayId !== undefined && node.displayId !== wantedDisplay)
      continue;
    if (
      selector.bundle_name !== undefined &&
      node.bundleName !== selector.bundle_name
    )
      continue;
    if (
      (selector.checked !== undefined && node.checked !== selector.checked) ||
      (selector.selected !== undefined &&
        node.selected !== selector.selected) ||
      (selector.enabled !== undefined && node.enabled !== selector.enabled) ||
      (selector.value !== undefined && node.value !== selector.value)
    )
      continue;
    if (
      (!targeted && !node.text) ||
      (selector.clickableOnly && node.clickable !== true)
    )
      continue;
    if (selector.onScreenOnly && !index.visible(node)) continue;
    matches.push(node);
  }
  return matches;
}
