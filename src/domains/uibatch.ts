import { errorResult, ToolError } from "../core/errors.js";
import { automaticActions, automaticResult, acceptAgreements, act, center, describe, dumpTree, invalidate, nativeScrollBudget, scrollTarget, pickMatch, select, treeSignature, waitFor, type Action, type AutomaticResult, type Selector, type UiNode } from "./ui.js";

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
  to?: Selector;
  x?: number; y?: number; x2?: number; y2?: number;
  text?: string; append?: boolean; key?: string; keys?: string[];
  touch?: { scale?: number; degrees?: number; radius?: number };
  direction?: "up" | "down" | "left" | "right"; speed?: number;
  scroll_offset?: number;
  duration_ms?: number;
  button?: "left" | "right" | "middle"; ticks?: number;
  /** wait: selector to wait for (visible); ms: fixed pause */
  ms?: number; timeout_ms?: number;
}

export const needsPoint = new Set(["click", "double_click", "long_click", "input", "clear_text", "swipe", "drag", "mouse_click", "mouse_double_click", "mouse_long_click", "mouse_move", "mouse_scroll"]);
export const SYNC_HOLD_MS = 30000;

export function uiActionJob(input: { action?: string; op?: string; duration_ms?: number; timeout_ms?: number; wait?: number; request_key?: string }) {
  if (input.action !== "act") return undefined;
  const requested = input.wait !== undefined || input.request_key !== undefined;
  if (input.op === "long_click" && input.duration_ms !== undefined && (input.duration_ms > SYNC_HOLD_MS || requested)) return "ui_long_press";
  if (nativeScrollBudget(input.op) !== undefined && ((input.timeout_ms ?? 0) > 38000 || requested)) return "ui_scroll";
  return undefined;
}

/** Concrete Action for a step once its selector (if any) resolved to a point. Pure. */
export function stepAction(s: BatchStep, point?: { x: number; y: number }, end?: { x: number; y: number }): Action {
  const x = point?.x ?? s.x, y = point?.y ?? s.y;
  const x2 = end?.x ?? s.x2, y2 = end?.y ?? s.y2;
  const need = (ok: unknown, what: string) => { if (!ok) throw new ToolError("INVALID_INPUT", `${s.op} needs ${what}`); };
  if (s.to && s.op !== "swipe" && s.op !== "drag" && s.op !== "scroll_find") throw new ToolError("INVALID_INPUT", "to selects a swipe/drag endpoint or scroll_find target");
  if (s.touch && s.op !== "pinch" && s.op !== "rotate") throw new ToolError("INVALID_INPUT", "touch options require pinch or rotate");
  if (s.scroll_offset !== undefined) need(s.op === "scroll_find" && Number.isSafeInteger(s.scroll_offset) && s.scroll_offset >= 0, "a nonnegative pixel scroll_offset for scroll_find");
  if (s.duration_ms !== undefined) need(s.op === "long_click" && Number.isInteger(s.duration_ms) && s.duration_ms >= 500 && s.duration_ms <= 60000, "long_click with duration_ms in 500–60000");
  switch (s.op) {
    case "click": case "double_click": need(x !== undefined && y !== undefined, "selector or x,y"); return { action: s.op, x: x!, y: y! };
    case "long_click": need(x !== undefined && y !== undefined, "selector or x,y"); return { action: s.op, x: x!, y: y!, durationMs: s.duration_ms };
    case "input": need(x !== undefined && y !== undefined && s.text !== undefined, "selector or x,y and text"); return { action: "input", x: x!, y: y!, text: s.text!, append: s.append };
    case "clear_text": need((x === undefined) === (y === undefined), "both x,y or neither"); return { action: "clear_text", x, y };
    case "pinch": case "rotate": {
      need((s.x === undefined) === (s.y === undefined) && (!s.selector || s.x === undefined), "selector, x,y, or neither for screen center");
      const { scale, degrees, radius } = s.touch ?? {};
      if (s.op === "pinch") need(scale !== undefined && scale >= 0.1 && scale <= 10 && scale !== 1 && degrees === undefined, "scale within 0.1–10, excluding 1");
      else need(degrees !== undefined && Math.abs(degrees) <= 360 && degrees !== 0 && scale === undefined, "signed degrees within ±360, excluding 0");
      need(radius === undefined || Number.isInteger(radius) && radius >= 10 && radius <= 2000, "radius of 10–2000 pixels");
      return { action: s.op, x: s.x, y: s.y, selector: s.selector, scale, degrees, radius, speed: s.speed };
    }
    case "type": need(s.text !== undefined, "text"); return { action: "type", text: s.text! };
    case "swipe": case "drag":
      need([x, y, x2, y2].every((v) => v !== undefined), "x,y,x2,y2 or selector/to for the corresponding endpoint");
      return { action: s.op, x: x!, y: y!, x2: x2!, y2: y2!, speed: s.speed, to: s.to };
    case "fling":
      need([s.x, s.y, s.x2, s.y2].every((v) => v !== undefined), "x,y,x2,y2");
      return { action: s.op, x: s.x!, y: s.y!, x2: s.x2!, y2: s.y2!, speed: s.speed };
    case "scroll": need(s.direction, "direction"); return { action: "scroll", direction: s.direction!, speed: s.speed, ...(s.selector ? { selector: s.selector } : {}) };
    case "scroll_start": case "scroll_end": case "scroll_find":
      need(s.selector, "a scrollable container selector");
      need(s.timeout_ms === undefined || Number.isInteger(s.timeout_ms) && s.timeout_ms >= 1 && s.timeout_ms <= 3600000, "timeout_ms in 1–3600000 for the UITest operation");
      if (s.op === "scroll_find") { need(s.to, "a to matcher"); scrollTarget(s.to!); }
      return { action: s.op, selector: s.selector!, to: s.to, direction: s.direction, speed: s.speed, scrollOffset: s.scroll_offset, timeoutMs: s.timeout_ms };
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

export function validateBatchSteps(steps: BatchStep[]) {
  for (const step of steps) {
    if (step.timeout_ms !== undefined && nativeScrollBudget(step.op) === undefined && step.timeout_ms < 100)
      throw new ToolError("INVALID_INPUT", "Selector waits require at least 100 ms");
    if (step.op === "wait" && !step.to) continue;
    const point = { x: 0, y: 0 };
    stepAction(step, step.selector ? point : undefined, step.to ? point : undefined);
  }
}

const pick = pickMatch;

export interface BatchResult extends AutomaticResult {
  passed: boolean;
  steps: { i: number; op: string; ok: boolean; target?: string; ms: number; error?: string }[];
  failed_step?: number;
  /** First unexecuted step; inspect any observation failure before continuing. */
  stopped_at?: number;
  error?: { code: string; message: string };
  visible?: string[];
  after?: ReturnType<typeof screenDiff>;
  observation_error?: ReturnType<typeof errorResult>;
  assert?: unknown;
  executed: { action: Action; selector?: Selector }[];
}

/**
 * Run several UI steps in one call. Each selector step polls the (fresh) tree until its element
 * appears. Each new tree is evidence of the current UI, not proof of business correctness.
 * Stops at the first failing step or observation.
 */
export async function runBatch(target: string, steps: BatchStep[], options: { assert?: { visible?: Selector; hidden?: Selector; timeout_ms?: number }; bundle?: string; budgetMs?: number }, signal: AbortSignal): Promise<BatchResult> {
  validateBatchSteps(steps);
  if (steps.some((step) => (step.duration_ms ?? 0) > SYNC_HOLD_MS))
    throw new ToolError("INVALID_INPUT", "Use a single ui act for a long press exceeding 30000 ms");
  if (steps.some((step) => nativeScrollBudget(step.op) !== undefined && (step.timeout_ms ?? 0) > 38000))
    throw new ToolError("INVALID_INPUT", "Use a single ui act for scroll deadlines exceeding 38000 ms");
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
  for (let i = 0; i < steps.length; i++) {
    signal.throwIfAborted();
    const s = steps[i]!;
    const started = Date.now();
    let action: Action | undefined;
    const scroll = nativeScrollBudget(s.op);
    const budget = s.duration_ms !== undefined ? s.duration_ms + 7000 : scroll !== undefined ? (s.timeout_ms ?? scroll) + 4000
      : ["pinch", "rotate"].includes(s.op) ? 26000 : 1500;
    if (left() < budget) {
      // Out of time: report what was done and where to resume, instead of letting the host time out.
      return {
        passed: false, steps: results, failed_step: i, stopped_at: i, executed, ...agreements(),
        error: { code: "TIMEOUT", message: `Stopped before step ${i}: one call may take at most ${Math.round((options.budgetMs ?? 52000) / 1000)} s` },
        observation_error: errorResult(new ToolError("TIMEOUT", "No time remains for a fresh UI observation")),
      };
    }
    try {
      if (s.op === "wait") {
        if (s.selector) {
          const verdict = await waitFor(target, s.selector, "visible", Math.min(s.timeout_ms ?? 10000, left() - 1000), signal, true);
          accepted.push(...automaticActions(verdict));
          if (!verdict.passed) throw new ToolError("UI_NOT_FOUND", "Element did not appear", { selector: s.selector });
        } else await new Promise((r) => setTimeout(r, Math.min(s.ms ?? 500, 10000, Math.max(0, left() - 1500))));
        fresh = false;
        results.push({ i, op: "wait", ok: true, ms: Date.now() - started });
        continue;
      }
      const start = needsPoint.has(s.op) ? s.selector : undefined;
      let hit: UiNode | undefined, end: UiNode | undefined;
      const finish = s.op === "scroll_find" ? undefined : s.to;
      if (start || finish) {
        if (!fresh) { await new Promise((r) => setTimeout(r, 250)); invalidate(target); last = await ready(await dumpTree(target, signal)); fresh = true; }
        const deadline = Date.now() + Math.min(s.timeout_ms ?? 10000, left() - (s.duration_ms === undefined ? 1000 : budget));
        let ambiguous: UiNode[] | undefined;
        for (;;) {
          const matches = start ? select(last, start) : [], ends = finish ? select(last, finish) : [];
          hit = start && matches.length ? pick(matches, start) : undefined;
          end = finish && ends.length ? pick(ends, finish) : undefined;
          if ((!start || hit) && (!finish || end)) break;
          ambiguous = !hit && matches.length > 1 ? matches : !end && ends.length > 1 ? ends : undefined;
          // A dump takes ~1s: stop when the next one would end past the deadline.
          if (Date.now() + 1000 > deadline) {
            if (ambiguous) throw new ToolError("UI_AMBIGUOUS", `${ambiguous.length} elements match; refine selector or pass index`, { candidates: ambiguous.slice(0, 6).map(describe) });
            throw new ToolError("UI_NOT_FOUND", "No element matches the selector", { selector: !hit && start ? start : finish });
          }
          await new Promise((r) => setTimeout(r, 200));
          invalidate(target);
          last = await ready(await dumpTree(target, signal));
        }
      }
      action = stepAction(s, hit && center(hit), end && center(end));
      const performed = await act(target, action, signal);
      accepted.push(...automaticActions(performed));
      executed.push({ action, selector: s.selector });
      results.push({ i, op: s.op, ok: true, ...(hit ? { target: label(hit) } : {}), ms: Date.now() - started });
      fresh = false;
    } catch (error) {
      const e = error as ToolError;
      const completed = action !== undefined && e.details?.action_completed === true;
      if (completed) {
        executed.push({ action: action!, selector: s.selector });
        accepted.push(...automaticActions(e.details));
        results.push({ i, op: s.op, ok: true, ms: Date.now() - started });
      }
      if (!completed) results.push({ i, op: s.op, ok: false, ms: Date.now() - started, error: e.message });
      let observation: Pick<BatchResult, "visible" | "after" | "observation_error">;
      try {
        signal.throwIfAborted();
        if (left() < 1500) throw new ToolError("TIMEOUT", "No time remains for a fresh UI observation");
        invalidate(target);
        const nodes = await dumpTree(target, signal);
        observation = { visible: visibleLabels(nodes, options.bundle), after: screenDiff(first, nodes, 10, options.bundle) };
      } catch (error) { observation = { observation_error: errorResult(error) }; }
      return {
        passed: false, steps: results, ...(completed ? { stopped_at: i + 1 } : { failed_step: i }), executed, ...agreements(),
        error: { code: completed ? "UI_OBSERVATION_FAILED" : e.code ?? "UI_ACTION_FAILED", message: e.message },
        ...observation,
      };
    }
  }
  try {
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
  } catch (error) {
    return { passed: false, steps: results, executed, ...agreements(), observation_error: errorResult(error),
      error: { code: "UI_OBSERVATION_FAILED", message: "Actions completed but the final observation failed; inspect the UI before deciding whether further actions are needed" } };
  }
}
