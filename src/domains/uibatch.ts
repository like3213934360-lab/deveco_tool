import { ToolError } from "../core/errors.js";
import { automaticActions, automaticResult, acceptAgreements, act, center, describe, dumpTree, invalidate, pickMatch, select, treeSignature, waitFor, type Action, type AutomaticResult, type Selector, type UiNode } from "./ui.js";

/* ------------------------------ screen diff ------------------------------ */

const SYSTEM_BUNDLE = /^com\.(ohos|huawei\.hmos)\.(systemui|sceneboard|launcher|notificationdialog|permissionmanager)/;

/** The app's bundle: the non-system bundle owning most labelled nodes. Pure. */
export function appBundle(nodes: UiNode[]) {
  const counts = new Map<string, number>();
  for (const n of nodes) if (n.bundle && (n.text || n.key) && !SYSTEM_BUNDLE.test(n.bundle)) counts.set(n.bundle, (counts.get(n.bundle) ?? 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
}

/** Screen bounds: the largest root rectangle in the dump. */
function screenOf(nodes: UiNode[]) {
  let w = 0, h = 0;
  for (const n of nodes) if (n.rect && n.depth <= 1) { w = Math.max(w, n.rect.x2); h = Math.max(h, n.rect.y2); }
  return w && h ? { w, h } : undefined;
}

/**
 * Labelled / interactive nodes identify what a user sees; layout-only containers are noise.
 * With onScreen, nodes whose centre lies outside the screen (list items scrolled away, hidden tab
 * pages kept in the tree) are skipped.
 */
function labels(nodes: UiNode[], bundle?: string, onScreen = false) {
  const out = new Map<string, UiNode>();
  const screen = onScreen ? screenOf(nodes) : undefined;
  for (const n of nodes) {
    if (!n.rect || n.visible === false || n.rect.x2 <= n.rect.x1 || n.rect.y2 <= n.rect.y1) continue;
    if (bundle && n.bundle !== bundle) continue;
    if (!n.text && !n.key) continue;
    if (screen) {
      const cx = (n.rect.x1 + n.rect.x2) / 2, cy = (n.rect.y1 + n.rect.y2) / 2;
      if (cx < 0 || cy < 0 || cx > screen.w || cy > screen.h) continue;
    }
    const id = `${n.type}|${n.text}|${n.key ?? ""}`;
    if (!out.has(id)) out.set(id, n);
  }
  return out;
}

/** Page and overlay containers: when one appears or disappears the user is on another page/layer. */
const PAGE = /^(NavDestination|Dialog|Popup|Sheet|Menu)$/;
const PAGE_KEY = /modal|dialog|sheet|popup|destination/i;
function pages(nodes: UiNode[], bundle?: string) {
  const out = new Set<string>();
  for (const n of nodes) {
    if (bundle && n.bundle !== bundle) continue;
    if (!n.rect || n.visible === false || n.rect.x2 <= n.rect.x1 || n.rect.y2 <= n.rect.y1) continue;
    if (PAGE.test(n.type) || (n.key && PAGE_KEY.test(n.key))) out.add(`${n.type}|${n.key ?? ""}|${n.text}`);
  }
  return out;
}
/**
 * What the user can act on, app content first: system UI (status bar, launcher) is skipped when the
 * app's bundle is known or can be inferred as the bundle owning most labelled nodes.
 */
export function visibleLabels(nodes: UiNode[], bundle?: string, limit = 25) {
  const app = bundle ?? appBundle(nodes);
  const own = [...labels(nodes, app).values()].filter((n) => n.text || n.clickable);
  // A system dialog in front of the app (permission/notification) is what the user sees: list it first.
  const overlay = [...labels(nodes).values()].filter((n) => n.bundle && SYSTEM_BUNDLE.test(n.bundle) && /notificationdialog|permissionmanager/.test(n.bundle) && (n.text || n.clickable));
  const shown = [...overlay, ...own];
  return (shown.length ? shown : [...labels(nodes).values()]).slice(0, limit).map(label);
}

const label = (n: UiNode) => {
  const text = n.text ? `"${n.text.slice(0, 40)}"` : `key=${n.key}`;
  return `${n.type} ${text}${n.clickable ? " clickable" : ""}`;
};

/**
 * Another page or layer, from three independent signals on the app's own on-screen elements:
 *  1. a page/overlay container (NavDestination, Dialog, a "modal"/"sheet" layer...) appeared or vanished;
 *  2. at least half of the labelled elements on screen were replaced (tab switch, full-screen page);
 *  3. the app's window changed.
 */
function navigated(before: UiNode[], after: UiNode[], bundle: string | undefined, a: Map<string, UiNode>, b: Map<string, UiNode>) {
  const pa = pages(before, bundle), pb = pages(after, bundle);
  if ([...pa].some((p) => !pb.has(p)) || [...pb].some((p) => !pa.has(p))) return true;
  const added = [...b.keys()].filter((k) => !a.has(k)).length, removed = [...a.keys()].filter((k) => !b.has(k)).length;
  // Tab switches keep the tab bar, so only one side reaches half (tools tab: +20 of 25 new, -5 of 10 old).
  if (added >= 3 && removed >= 3 && (removed / Math.max(1, a.size) >= 0.5 || added / Math.max(1, b.size) >= 0.5)) return true;
  const win = (nodes: UiNode[]) => nodes.find((n) => n.bundle === bundle && n.window)?.window;
  return !!bundle && !!win(before) && !!win(after) && win(before) !== win(after);
}

/**
 * What changed on screen after an action, in a few hundred bytes: added/removed labelled elements
 * of the app (system UI such as the status bar is left out; so are elements scrolled off screen),
 * so the caller rarely needs a follow-up observe.
 */
export function screenDiff(before: UiNode[], after: UiNode[], limit = 10, bundle?: string) {
  const app = bundle ?? appBundle(after) ?? appBundle(before);
  const a = labels(before, app, true), b = labels(after, app, true);
  const added = [...b].filter(([k]) => !a.has(k)).map(([, n]) => n);
  const removed = [...a].filter(([k]) => !b.has(k)).map(([, n]) => n);
  // Stable order: top-to-bottom, left-to-right, the way a person reads the page.
  const order = (x: UiNode, y: UiNode) => x.rect!.y1 - y.rect!.y1 || x.rect!.x1 - y.rect!.x1;
  added.sort(order); removed.sort(order);
  // Same labels can still change state or position (toggle checked, list scrolled): the full tree
  // signature (type, text, bounds, checked, selected) catches those.
  const own = (nodes: UiNode[]) => (app ? nodes.filter((n) => n.bundle === app) : nodes);
  const changed = added.length > 0 || removed.length > 0 || treeSignature(own(before)) !== treeSignature(own(after));
  return {
    changed,
    added: added.slice(0, limit).map(label),
    removed: removed.slice(0, limit).map(label),
    ...(added.length > limit ? { more_added: added.length - limit } : {}),
    ...(removed.length > limit ? { more_removed: removed.length - limit } : {}),
    // Mostly replaced content = navigated to another page; otherwise an in-page update.
    kind: !changed ? "none" : navigated(before, after, app, a, b) ? "navigated" : added.length || removed.length ? "updated" : "state",
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

const pick = pickMatch;

export interface BatchResult extends AutomaticResult {
  passed: boolean;
  steps: { i: number; op: string; ok: boolean; target?: string; ms: number; error?: string }[];
  failed_step?: number;
  /** set when the call ran out of time: call again with steps from this index */
  stopped_at?: number;
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
export async function runBatch(target: string, steps: BatchStep[], options: { assert?: { visible?: Selector; hidden?: Selector; timeout_ms?: number }; bundle?: string; budgetMs?: number }, signal: AbortSignal): Promise<BatchResult> {
  const results: BatchResult["steps"] = [];
  const executed: BatchResult["executed"] = [];
  const accepted: { text: string; kind: string }[] = [];
  const agreements = () => automaticResult(accepted);
  const ready = async (nodes: UiNode[]) => {
    const consent = await acceptAgreements(target, signal, nodes);
    accepted.push(...consent.accepted);
    return consent.nodes ?? nodes;
  };
  // One call must answer before the host's request timeout: every wait is bounded by what is left.
  const callDeadline = Date.now() + (options.budgetMs ?? 52000);
  const left = () => callDeadline - Date.now();
  const first = await ready(await dumpTree(target, signal, 1500));
  let last = first;
  let fresh = true; // `last` reflects the screen after the latest action
  // A step locating its element by selector needs a tree taken after the previous action.
  const wantsTree = (s: BatchStep | undefined) => !!s && !!s.selector && needsPoint.has(s.op);
  for (let i = 0; i < steps.length; i++) {
    signal.throwIfAborted();
    const s = steps[i]!;
    const started = Date.now();
    if (left() < 1500) {
      // Out of time: report what was done and where to resume, instead of letting the host time out.
      const nodes = await dumpTree(target, signal).catch(() => last);
      return {
        passed: false, steps: results, failed_step: i, stopped_at: i, executed, ...agreements(),
        error: { code: "TIMEOUT", message: `Stopped before step ${i}: one call may take at most ${Math.round((options.budgetMs ?? 52000) / 1000)} s` },
        visible: visibleLabels(nodes, options.bundle), after: screenDiff(first, nodes, 10, options.bundle),
      };
    }
    try {
      if (s.op === "wait") {
        if (s.selector) {
          const verdict = await waitFor(target, s.selector, "visible", Math.min(s.timeout_ms ?? 10000, left() - 1000), signal, true);
          accepted.push(...automaticActions(verdict));
          if (!verdict.passed) throw new ToolError("UI_NOT_FOUND", "Element did not appear", { selector: s.selector });
          fresh = false;
        } else await new Promise((r) => setTimeout(r, Math.min(s.ms ?? 500, 10000, Math.max(0, left() - 1500))));
        results.push({ i, op: "wait", ok: true, ms: Date.now() - started });
        continue;
      }
      let point: { x: number; y: number } | undefined;
      let hit: UiNode | undefined;
      if (s.selector && needsPoint.has(s.op)) {
        if (!fresh) { invalidate(target); last = await ready(await dumpTree(target, signal)); fresh = true; }
        const deadline = Date.now() + Math.min(s.timeout_ms ?? 10000, left() - 1000);
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
          last = await ready(await dumpTree(target, signal));
        }
        point = center(hit);
      }
      const action = stepAction(s, point);
      const performed = await act(target, action, signal);
      accepted.push(...automaticActions(performed));
      executed.push({ action, selector: s.selector });
      results.push({ i, op: s.op, ok: true, ...(hit ? { target: label(hit) } : {}), ms: Date.now() - started });
      fresh = false;
      // Dump only when the next step has to find an element (it also proves this step took effect);
      // gestures, keys and coordinate taps need no tree. The final tree is taken once at the end.
      if (wantsTree(steps[i + 1])) {
        await new Promise((r) => setTimeout(r, 250));
        last = await ready(await dumpTree(target, signal)); fresh = true;
      }
    } catch (error) {
      const e = error as ToolError;
      results.push({ i, op: s.op, ok: false, ms: Date.now() - started, error: e.message });
      const nodes = await dumpTree(target, signal).catch(() => last);
      return {
        passed: false, steps: results, failed_step: i, executed, ...agreements(),
        error: { code: e.code ?? "UI_ACTION_FAILED", message: e.message },
        visible: visibleLabels(nodes, options.bundle),
        after: screenDiff(first, nodes, 10, options.bundle),
      };
    }
  }
  let assertion: Awaited<ReturnType<typeof waitFor>> | undefined;
  if (options.assert && (options.assert.visible || options.assert.hidden)) {
    const selector = (options.assert.visible ?? options.assert.hidden)!;
    assertion = await waitFor(target, selector, options.assert.visible ? "visible" : "hidden", Math.max(500, Math.min(options.assert.timeout_ms ?? 5000, left() - 1500)), signal, true);
    accepted.push(...automaticActions(assertion));
    last = await dumpTree(target, signal, 1500); fresh = true;
  }
  if (!fresh) { await new Promise((r) => setTimeout(r, 250)); invalidate(target); last = await dumpTree(target, signal); }
  return {
    passed: !assertion || assertion.passed, steps: results, executed, ...agreements(), after: screenDiff(first, last, 10, options.bundle),
    ...(assertion ? { assert: assertion } : {}),
  };
}
