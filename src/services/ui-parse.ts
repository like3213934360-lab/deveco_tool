import { createHash } from "node:crypto";
import { invariant, ToolError } from "../core/errors.js";
import { flattenDump, type UiNode } from "./ui-tree.js";
import { uiNodesSchema } from "./ui-node-schema.js";

/** Preserve the canonical digest with explicit sorted keys, without recursively
 * sorting/copying the whole tree twice or keeping two extra trees in memory. */
export function uiSignatures(nodes: UiNode[]) {
  const full = createHash("sha256").update("["),
    structure = createHash("sha256").update("[");
  for (let i = 0; i < nodes.length; i++) {
    if (i) {
      full.update(",");
      structure.update(",");
    }
    const node = nodes[i]!;
    const stable = {
      abilityName: node.abilityName,
      bundleName: node.bundleName,
      checkable: node.checkable,
      checked: node.checked,
      clickable: node.clickable,
      depth: node.depth,
      displayId: node.displayId,
      enabled: node.enabled,
      focused: node.focused,
      key: node.key,
      pagePath: node.pagePath,
      parent: node.parent,
      rect: node.rect
        ? {
            x1: node.rect.x1,
            x2: node.rect.x2,
            y1: node.rect.y1,
            y2: node.rect.y2,
          }
        : null,
      selected: node.selected,
      text: node.text,
      type: node.type,
      value: node.value,
      visible: node.visible,
      windowId: node.windowId,
    };
    full.update(JSON.stringify(stable));
    const {
      checked: _checked,
      selected: _selected,
      text: _text,
      value: _value,
      ...shape
    } = stable;
    structure.update(JSON.stringify(shape));
  }
  return {
    signature: full.update("]").digest("hex"),
    structureSignature: structure.update("]").digest("hex"),
  };
}
export function parseUiDump(
  content: string,
  format: "uitest" | "nodes" = "uitest",
) {
  invariant(
    Buffer.byteLength(content) <= 32 * 1024 * 1024,
    "UI_DUMP_INVALID",
    "UI dump limit is 32 MiB",
  );
  let raw: unknown;
  try {
    raw = JSON.parse(content) as unknown;
  } catch {
    throw new ToolError("UI_TREE_INVALID", "UI tree must contain valid JSON");
  }
  const nodes =
    format === "nodes" ? uiNodesSchema.parse(raw) : flattenDump(raw);
  if (format === "nodes") {
    const ancestry: number[] = [];
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]!;
      invariant(
        (node.parent === null && node.depth === 0) ||
          (node.depth > 0 &&
            node.depth <= ancestry.length &&
            node.parent === ancestry[node.depth - 1]),
        "UI_TREE_INVALID",
        "Imported nodes must preserve preorder parent and depth relationships",
      );
      invariant(
        !node.rect ||
          (node.rect.x1 <= node.rect.x2 && node.rect.y1 <= node.rect.y2),
        "UI_TREE_INVALID",
        "Imported node rectangles must be ordered",
      );
      ancestry.length = node.depth;
      ancestry.push(index);
    }
  }
  return { nodes, ...uiSignatures(nodes) };
}
