import type { Snapshot, Rect } from "./device.js";
import type { Selector } from "../core/contracts.js";

export function inspectSnapshot(
  snapshot: Snapshot,
  options: {
    selector?: Selector;
    display_id?: string | number;
    window_id?: string;
    max_depth?: number;
    offset: number;
    limit: number;
  },
) {
  const matches = options.selector
      ? new Set(snapshot.query.select(options.selector))
      : undefined,
    selected: number[] = [],
    windows = new Map<
      string,
      {
        display_id: string | null;
        window_id: string | null;
        root_index: number;
        bounds: Rect | null;
        node_count: number;
        focused: boolean;
        bundle_names: Set<string>;
      }
    >();
  for (let index = 0; index < snapshot.nodes.length; index++) {
    const node = snapshot.nodes[index]!;
    if (
      options.display_id !== undefined &&
      node.displayId !== String(options.display_id)
    )
      continue;
    if (options.window_id !== undefined && node.windowId !== options.window_id)
      continue;
    const key = JSON.stringify([node.displayId, node.windowId]);
    let window = windows.get(key);
    if (!window) {
      window = {
        display_id: node.displayId,
        window_id: node.windowId,
        root_index: index,
        bounds: node.rect,
        node_count: 0,
        focused: false,
        bundle_names: new Set(),
      };
      windows.set(key, window);
    }
    window.node_count++;
    window.focused ||= node.focused === true;
    if (node.bundleName) window.bundle_names.add(node.bundleName);
    if (options.max_depth !== undefined && node.depth > options.max_depth)
      continue;
    if (matches && !matches.has(node)) continue;
    selected.push(index);
  }
  const indexes = selected.slice(
    options.offset,
    options.offset + options.limit,
  );
  return {
    node_count: snapshot.nodes.length,
    matching_nodes: selected.length,
    offset: options.offset,
    next_offset:
      options.offset + indexes.length < selected.length
        ? options.offset + indexes.length
        : null,
    nodes: indexes.map((index) => ({ index, ...snapshot.nodes[index]! })),
    window_count: windows.size,
    windows_truncated: windows.size > 200,
    windows: [...windows.values()]
      .slice(0, 200)
      .map((window) => ({
        ...window,
        bundle_names: [...window.bundle_names].slice(0, 200),
      })),
    hierarchy:
      "parent refers to the full snapshot node index; depth starts at zero for each root",
  };
}
