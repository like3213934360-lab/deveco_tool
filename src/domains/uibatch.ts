import { ToolError } from "../core/errors.js";
import { act, center, describe, dumpTree, invalidate, select, treeSignature, waitFor, type Action, type Selector, type UiNode } from "./ui.js";

/* ------------------------------ screen diff ------------------------------ */

/** Labelled / interactive nodes identify what a user sees; layout-only containers are noise. */
function labels(nodes: UiNode[], bundle?: string) {
  const out = new Map<string, UiNode>();
  for (const n of nodes) {
    if (!n.rect || n.visible === false || n.rect.x2 <= n.rect.x1 || n.rect.y2 <= n.rect.y1) continue;
    if (bundle && n.bundle !== bundle) continue;
    if (!n.text && !n.key) continue;
    const id = `${n.type}|${n.text}|${n.key ?? ""}`;
    if (!out.has(id)) out.set(id, n);
  }
  return out;
}
/**
 * What the user can act on, app content first: system UI (status bar, launcher) is skipped when the
 * app's bundle is known or can be inferred as the bundle owning most labelled nodes.
 */
export function visibleLabels(nodes: UiNode[], bundle?: string, limit = 25) {
  const counts = new Map<string, number>();
  for (const n of nodes) if (n.bundle && (n.text || n.key)) counts.set(n.bundle, (counts.get(n.bundle) ?? 0) + 1);
  const system = /^com\.(ohos|huawei\.hmos)\.(systemui|sceneboard|launcher)/;
  const app = bundle ?? [...counts].filter(([b]) => !system.test(b)).sort((x, y) => y[1] - x[1])[0]?.[0];
  const own = [...labels(nodes, app).values()].filter((n) => n.text || n.clickable);
  return (own.length ? own : [...labels(nodes).values()]).slice(0, limit).map(label);
}

const label = (n: UiNode) => {
  const text = n.text ? `"${n.text.slice(0, 40)}"` : `key=${n.key}`;
  return `${n.type} ${text}${n.clickable ? " clickable" : ""}`;
};

/**
 * Another page: most of what was on screen is gone AND most of what is on screen now is new
 * (a dialog or an expanded row keeps most of the old content; a tab switch keeps the tab bar only).
 */
function navigated(beforeSize: number, afterSize: number, added: number, removed: number) {
  return removed >= 3 && added >= 3 && removed / Math.max(1, beforeSize) >= 0.6 && added / Math.max(1, afterSize) >= 0.5;
}

/**
 * What changed on screen after an action, in a few hundred bytes: added/removed labelled elements
 * (the new page's content when navigating) so the caller rarely needs a follow-up observe.
 */
export function screenDiff(before: UiNode[], after: UiNode[], limit = 10) {
  const a = labels(before), b = labels(after);
  const added = [...b].filter(([k]) => !a.has(k)).map(([, n]) => n);
  const removed = [...a].filter(([k]) => !b.has(k)).map(([, n]) => n);
  // Stable order: top-to-bottom, left-to-right, the way a person reads the page.
  const order = (x: UiNode, y: UiNode) => x.rect!.y1 - y.rect!.y1 || x.rect!.x1 - y.rect!.x1;
  added.sort(order); removed.sort(order);
  // Same labels can still change state or position (toggle checked, list scrolled): the full tree
  // signature (type, text, bounds, checked, selected) catches those.
  const changed = added.length > 0 || removed.length > 0 || treeSignature(before) !== treeSignature(after);
  return {
    changed,
    added: added.slice(0, limit).map(label),
    removed: removed.slice(0, limit).map(label),
    ...(added.length > limit ? { more_added: added.length - limit } : {}),
    ...(removed.length > limit ? { more_removed: removed.length - limit } : {}),
    // Mostly replaced content = navigated to another page; otherwise an in-page update.
    kind: !changed ? "none" : navigated(a.size, b.size, added.length, removed.length) ? "navigated" : added.length || removed.length ? "updated" : "state",
  } as const;
}

/* ------------------------------ batch steps ------------------------------ */

export interface BatchStep {
  op: Action["action"] | "wait";
  selector?: Selector;
  x?: number; y?: number; x2?: number; y2?: number;
  text?: string; append?: boolean; key?: string; keys?: string[];
  direction?: "up" | "down" | "left" | "right"; speed?: number;
  button?: "left" | "right" | "middle"; ticks?: number;
  /** wait: selector to wait for (visible); ms: fixed pause */
  ms?: number; timeout_ms?: number;
}

const needsPoint = new Set(["click", "double_click", "long_click", "input", "mouse_click", "mouse_double_click", "mouse_long_click", "mouse_move", "mouse_scroll"]);

/** Concrete Action for a step once its selector (if any) resolved to a point. Pure. */
export function stepAction(s: BatchStep, point?: { x: number; y: number }): Action {
  const x = point?.x ?? s.x, y = point?.y ?? s.y;
  const need = (ok: unknown, what: string) => { if (!ok) throw new ToolError("INVALID_INPUT", `${s.op} needs ${what}`); };
  switch (s.op) {
    case "click": case "double_click": case "long_click": need(x !== undefined && y !== undefined, "selector or x,y"); return { action: s.op, x: x!, y: y! };
    case "input": need(x !== undefined && s.text !== undefined, "selector or x,y and text"); return { action: "input", x: x!, y: y!, text: s.text!, append: s.append };
    case "type": need(s.text !== undefined, "text"); return { action: "type", text: s.text! };
    case "swipe": case "drag": case "fling":
      need([s.x, s.y, s.x2, s.y2].every((v) => v !== undefined), "x,y,x2,y2");
      return { action: s.op, x: s.x!, y: s.y!, x2: s.x2!, y2: s.y2!, speed: s.speed };
    case "scroll": need(s.direction, "direction"); return { action: "scroll", direction: s.direction!, speed: s.speed };
    case "key": need(s.key || s.keys, "key or keys"); return s.keys ? { action: "keys", keys: s.keys } : { action: "key", key: s.key! };
    case "mouse_click": case "mouse_double_click": case "mouse_long_click":
      need(x !== undefined && y !== undefined, "selector or x,y"); return { action: s.op, x: x!, y: y!, button: s.button, keys: s.keys };
    case "mouse_move": need(x !== undefined && y !== undefined, "selector or x,y"); return { action: "mouse_move", x: x!, y: y! };
    case "mouse_scroll":
      need(x !== undefined && y !== undefined && (s.direction === "up" || s.direction === "down"), "selector or x,y and direction up/down");
      return { action: "mouse_scroll", x: x!, y: y!, direction: s.direction as "up" | "down", ticks: s.ticks, keys: s.keys };
    case "mouse_drag": need([s.x, s.y, s.x2, s.y2].every((v) => v !== undefined), "x,y,x2,y2"); return { action: "mouse_drag", x: s.x!, y: s.y!, x2: s.x2!, y2: s.y2!, speed: s.speed };
    default: throw new ToolError("INVALID_INPUT", `Unknown op ${s.op}`);
  }
}

/** Pick one node for a selector: exact single match, the single clickable one, or explicit index. */
function pick(matches: UiNode[], selector: Selector) {
  if (matches.length === 1 || selector.index !== undefined) return matches[0];
  const clickable = matches.filter((m) => m.clickable);
  if (clickable.length === 1) return clickable[0];
  // Same label twice (e.g. a tab title repeated in the page header): the top-most is the stable choice.
  if (matches.every((m) => m.text === matches[0]!.text)) return [...matches].sort((a, b) => a.rect!.y1 - b.rect!.y1 || a.rect!.x1 - b.rect!.x1)[0];
  return undefined;
}

export interface BatchResult {
  passed: boolean;
  steps: { i: number; op: string; ok: boolean; target?: string; ms: number; error?: string }[];
  failed_step?: number;
  error?: { code: string; message: string };
  visible?: string[];
  after?: ReturnType<typeof screenDiff>;
  assert?: unknown;
  executed: { action: Action; selector?: Selector }[];
}

/**
 * Run several UI steps in one call. Each selector step polls the (fresh) tree until its element
 * appears, so no fixed sleeps are needed between steps: the dump that locates the next element
 * also proves the previous action took effect. Stops at the first failing step.
 */
export async function runBatch(target: string, steps: BatchStep[], options: { assert?: { visible?: Selector; hidden?: Selector; timeout_ms?: number }; bundle?: string }, signal: AbortSignal): Promise<BatchResult> {
  const results: BatchResult["steps"] = [];
  const executed: BatchResult["executed"] = [];
  const first = await dumpTree(target, signal, 1500);
  let last = first;
  for (let i = 0; i < steps.length; i++) {
    signal.throwIfAborted();
    const s = steps[i]!;
    const started = Date.now();
    try {
      if (s.op === "wait") {
        if (s.selector) {
          const verdict = await waitFor(target, s.selector, "visible", s.timeout_ms ?? 10000, signal);
          if (!verdict.passed) throw new ToolError("UI_NOT_FOUND", "Element did not appear", { selector: s.selector });
        } else await new Promise((r) => setTimeout(r, Math.min(s.ms ?? 500, 10000)));
        results.push({ i, op: "wait", ok: true, ms: Date.now() - started });
        continue;
      }
      let point: { x: number; y: number } | undefined;
      let hit: UiNode | undefined;
      if (s.selector && needsPoint.has(s.op)) {
        const deadline = Date.now() + (s.timeout_ms ?? 10000);
        let ambiguous: UiNode[] | undefined;
        for (;;) {
          const matches = select(last, s.selector);
          hit = matches.length ? pick(matches, s.selector) : undefined;
          if (hit) break;
          if (matches.length > 1) ambiguous = matches;
          // A dump takes ~1s: stop when the next one would end past the deadline.
          if (Date.now() + 1000 > deadline) {
            if (ambiguous) throw new ToolError("UI_AMBIGUOUS", `${ambiguous.length} elements match; refine selector or pass index`, { candidates: ambiguous.slice(0, 6).map(describe) });
            throw new ToolError("UI_NOT_FOUND", "No element matches the selector", { selector: s.selector });
          }
          await new Promise((r) => setTimeout(r, 200));
          invalidate(target);
          last = await dumpTree(target, signal);
        }
        point = center(hit);
      }
      const action = stepAction(s, point);
      await act(target, action, signal);
      executed.push({ action, selector: s.selector });
      results.push({ i, op: s.op, ok: true, ...(hit ? { target: label(hit) } : {}), ms: Date.now() - started });
      // Next selector step re-dumps on demand; give the UI a short beat to start its transition.
      await new Promise((r) => setTimeout(r, 250));
      last = await dumpTree(target, signal);
    } catch (error) {
      const e = error as ToolError;
      results.push({ i, op: s.op, ok: false, ms: Date.now() - started, error: e.message });
      const nodes = await dumpTree(target, signal).catch(() => last);
      return {
        passed: false, steps: results, failed_step: i, executed,
        error: { code: e.code ?? "UI_ACTION_FAILED", message: e.message },
        visible: visibleLabels(nodes, options.bundle),
        after: screenDiff(first, nodes),
      };
    }
  }
  let assertion: Awaited<ReturnType<typeof waitFor>> | undefined;
  if (options.assert && (options.assert.visible || options.assert.hidden)) {
    const selector = (options.assert.visible ?? options.assert.hidden)!;
    assertion = await waitFor(target, selector, options.assert.visible ? "visible" : "hidden", options.assert.timeout_ms ?? 5000, signal);
    last = await dumpTree(target, signal, 1500);
  }
  return {
    passed: !assertion || assertion.passed, steps: results, executed, after: screenDiff(first, last),
    ...(assertion ? { assert: assertion } : {}),
  };
}
