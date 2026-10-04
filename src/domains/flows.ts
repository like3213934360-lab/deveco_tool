import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { kvDelete, kvGet, kvSet } from "../core/db.js";
import { invariant, ToolError } from "../core/errors.js";
import { atomicWrite } from "../core/files.js";
import { forceStop, launch } from "./device.js";
import { acceptAgreements, act, center, describe, dumpTree, select, waitFor, type Action, type Selector } from "./ui.js";

/* Flows are stored in <project>/.arkpilot/flows/<id>.json (compatible with v0.x files). */

const legacySelector = z.object({
  text: z.string().optional(), textMode: z.enum(["contains", "exact"]).optional(), key: z.string().optional(),
  type: z.string().optional(), node_id: z.string().optional(), bundle_name: z.string().optional(),
  checked: z.boolean().optional(), selected: z.boolean().optional(), enabled: z.boolean().optional(),
  clickableOnly: z.boolean().optional(),
}).passthrough();
const pct = z.object({ xPercent: z.number(), yPercent: z.number() });
const stepSchema = z.object({
  id: z.string(),
  action: z.string(),
  timeoutMs: z.number().optional(),
  selector: legacySelector.optional(),
  alternates: z.array(legacySelector).optional(),
  point: pct.optional(),
  value: z.string().optional(),
  key: z.string().optional(),
  keys: z.array(z.string()).optional(),
  gesture: z.object({ fromXPercent: z.number(), fromYPercent: z.number(), toXPercent: z.number(), toYPercent: z.number(), velocity: z.number().optional() }).optional(),
  direction: z.number().optional(),
}).passthrough();
export const flowSchema = z.object({
  version: z.number().default(2),
  id: z.string().regex(/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/),
  name: z.string(),
  app: z.object({ bundleName: z.string(), module: z.string(), ability: z.string() }),
  start: z.object({ mode: z.enum(["restart", "attach"]).default("restart") }).default({ mode: "restart" }),
  variables: z.record(z.string(), z.object({ required: z.boolean().default(true), secret: z.boolean().default(true) }).passthrough()).default({}),
  steps: z.array(stepSchema).max(200),
  assert: z.object({ visible: legacySelector.optional(), hidden: legacySelector.optional(), timeoutMs: z.number().optional(), alternates: z.array(legacySelector).optional() }).optional(),
}).passthrough();
export type Flow = z.infer<typeof flowSchema>;
type Step = Flow["steps"][number];
type LegacySelector = z.infer<typeof legacySelector>;

export function toSelector(s: LegacySelector): Selector {
  return {
    text: s.text, exact: s.textMode === "exact", key: s.key, type: s.type, id: s.node_id, bundle: s.bundle_name,
    checked: s.checked, selected: s.selected, enabled: s.enabled, clickable: s.clickableOnly ? true : undefined,
  };
}
export function fromSelector(s: Selector): LegacySelector {
  return Object.fromEntries(Object.entries({
    text: s.text, textMode: s.text ? (s.exact ? "exact" : "contains") : undefined, key: s.key, type: s.type, node_id: s.id,
    bundle_name: s.bundle, checked: s.checked, selected: s.selected, enabled: s.enabled, clickableOnly: s.clickable || undefined,
  }).filter(([, v]) => v !== undefined)) as LegacySelector;
}

function flowDir(project: string) {
  return path.join(path.resolve(project), ".arkpilot", "flows");
}
function flowFile(project: string, id: string) {
  invariant(/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(id), "INVALID_INPUT", "Flow id must be lowercase letters, digits, - or _");
  return path.join(flowDir(project), `${id}.json`);
}
export function readFlow(project: string, id: string): Flow {
  const file = flowFile(project, id);
  invariant(fs.existsSync(file), "NOT_FOUND", `Flow ${id} not found`, { available: listFlows(project).map((f) => f.id) });
  try {
    return flowSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    // A hand-edited or truncated file: say which one and what to do, not a raw parser message.
    const detail = error instanceof z.ZodError ? z.prettifyError(error) : (error as Error).message;
    throw new ToolError("FLOW_INVALID", `Flow ${id} cannot be read: ${detail.slice(0, 300)}`, { file },
      "Fix the JSON in that file, or delete it (ui_flow action=delete) and record the path again (ui act steps + save_flow)");
  }
}
export function writeFlow(project: string, flow: Flow) {
  atomicWrite(flowFile(project, flow.id), JSON.stringify(flowSchema.parse(flow), null, 2) + "\n");
}
export function listFlows(project: string): { id: string; name?: string; bundle?: string; steps?: number; variables?: string[]; has_assert?: boolean; invalid?: string }[] {
  const dir = flowDir(project);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    try {
      const flow = flowSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      return { id: flow.id, name: flow.name, bundle: flow.app.bundleName, steps: flow.steps.length, variables: Object.keys(flow.variables), has_assert: !!flow.assert };
    } catch (error) {
      return { id: f.replace(/\.json$/, ""), invalid: (error as Error).message.slice(0, 200) };
    }
  });
}

/* --------------------------------- recording --------------------------------- */

interface Draft { project: string; target: string; flow: Flow; values: Record<string, string>; started?: number }

async function draft(target: string): Promise<Draft | undefined> {
  const raw = await kvGet(`recording:${target}`);
  return raw ? (JSON.parse(raw) as Draft) : undefined;
}
export async function listDrafts(project: string) {
  const { kvEntries } = await import("../core/db.js");
  return (await kvEntries("recording:")).map((r) => JSON.parse(r.value) as Draft)
    .filter((d) => path.resolve(d.project) === path.resolve(project))
    .map((d) => ({ id: d.flow.id, name: d.flow.name, target: d.target, steps: d.flow.steps.length,
      started: d.started ? new Date(d.started).toISOString() : undefined, status: "draft" as const }));
}
export async function showFlow(project: string, id: string) {
  if (fs.existsSync(flowFile(project, id))) return readFlow(project, id);
  const matches = (await listDrafts(project)).filter((d) => d.id === id);
  invariant(matches.length, "NOT_FOUND", `Flow ${id} not found`, { available: listFlows(project).map((f) => f.id) });
  invariant(matches.length === 1, "CONFLICT", "More than one target has this flow draft", { targets: matches.map((d) => d.target) });
  const d = (await draft(matches[0]!.target))!;
  // Deliberately omit the stored input values (they can contain secrets).
  return { ...d.flow, status: "draft", target: d.target, next: "ui_flow stop with final assert, or discard=true" };
}

export async function startRecording(project: string, target: string, id: string, name: string, app: Flow["app"]) {
  const open = await draft(target);
  // Drafts survive server restarts: say whose it is, so a forgotten one can be dealt with.
  invariant(!open, "CONFLICT", `A recording is already active on ${target}`,
    open ? { flow: open.flow.id, project: open.project, steps: open.flow.steps.length, started: open.started ? new Date(open.started).toISOString() : undefined } : undefined,
    "Finish it with ui_flow action=stop (project of that recording, with an assert) or drop it with discard=true");
  const flow: Flow = { version: 2, id, name, app, start: { mode: "restart" }, variables: {}, steps: [] };
  await kvSet(`recording:${target}`, JSON.stringify({ project, target, flow, values: {}, started: Date.now() } satisfies Draft));
  return { recording: id, target, note: "Perform steps with ui act (selector-based actions are recorded). Finish with ui_flow action=stop and an assert." };
}

/**
 * Turn one executed UI action into a replayable flow step (shared by recording and batch save_flow).
 * Input text becomes a secret ${inputN} variable; returns undefined for actions flows cannot replay.
 */
export function makeStep(flow: Flow, values: Record<string, string>, action: Action, selector: Selector | undefined, screen: { w: number; h: number } | undefined): Step | undefined {
  const step: Step = { id: `s${flow.steps.length + 1}`, action: "tap", timeoutMs: 10000 };
  const pctOf = (x: number, y: number) => screen ? { xPercent: +(x * 100 / screen.w).toFixed(2), yPercent: +(y * 100 / screen.h).toFixed(2) } : undefined;
  switch (action.action) {
    case "click": step.action = "tap"; break;
    case "double_click": step.action = "doubleTap"; break;
    case "long_click": step.action = "longTap"; break;
    case "input": {
      step.action = "input";
      const variable = `input${Object.keys(flow.variables).length + 1}`;
      flow.variables[variable] = { required: true, secret: true };
      values[variable] = action.text;
      step.value = `\${${variable}}`;
      break;
    }
    case "key": step.action = "key"; step.key = action.key; break;
    case "swipe": case "drag": case "fling":
      step.action = action.action;
      if (screen) step.gesture = { fromXPercent: +(action.x * 100 / screen.w).toFixed(2), fromYPercent: +(action.y * 100 / screen.h).toFixed(2), toXPercent: +(action.x2 * 100 / screen.w).toFixed(2), toYPercent: +(action.y2 * 100 / screen.h).toFixed(2) };
      break;
    case "scroll": step.action = "dircFling"; step.direction = { left: 0, right: 1, up: 2, down: 3 }[action.direction]; break;
    case "type": step.action = "focusInput"; break;
    default: return undefined;
  }
  if (selector) step.selector = fromSelector(selector);
  else if ("x" in action && ["tap", "doubleTap", "longTap", "input"].includes(step.action)) step.point = pctOf(action.x, action.y);
  return step;
}

/** Called by ui act: append a replayable step when a recording is active. */
export async function recordStep(target: string, action: Action, selector: Selector | undefined, screen: { w: number; h: number } | undefined) {
  const current = await draft(target);
  if (!current) return undefined;
  const step = makeStep(current.flow, current.values, action, selector, screen);
  if (!step) return { recorded_step: null, note: `${action.action} is not recorded in flows (not replayable across devices)` };
  current.flow.steps.push(step);
  await kvSet(`recording:${target}`, JSON.stringify(current));
  return { recorded_step: step.id };
}

/**
 * Save an already executed, assert-verified action sequence as a flow (ui act steps + save_flow).
 * Replays restart the app first, so the sequence should start from the app's launch screen.
 */
export function saveExecutedFlow(project: string, id: string, name: string, app: Flow["app"], executed: { action: Action; selector?: Selector }[],
  assert: { visible?: Selector; hidden?: Selector; timeout_ms?: number }, screen: { w: number; h: number } | undefined) {
  flowFile(project, id); // validates the id before anything is written
  const flow: Flow = { version: 2, id, name, app, start: { mode: "restart" }, variables: {}, steps: [] };
  const values: Record<string, string> = {};
  const skipped: string[] = [];
  for (const e of executed) {
    const step = makeStep(flow, values, e.action, e.selector, screen);
    if (step) flow.steps.push(step); else skipped.push(e.action.action);
  }
  invariant(flow.steps.length > 0, "INVALID_INPUT", "None of the steps can be saved as a flow", { skipped });
  flow.assert = {
    ...(assert.visible ? { visible: fromSelector(assert.visible) } : { hidden: fromSelector(assert.hidden!) }),
    timeoutMs: assert.timeout_ms ?? 5000,
  };
  writeFlow(project, flow);
  return { saved: id, steps: flow.steps.length, variables: Object.keys(flow.variables), file: flowFile(project, id), ...(skipped.length ? { not_saved: skipped } : {}) };
}

export async function stopRecording(target: string, options: { project?: string; assert?: { visible?: Selector; hidden?: Selector; timeout_ms?: number }; discard?: boolean }, signal?: AbortSignal) {
  const current = await draft(target);
  invariant(current, "NOT_FOUND", `No active recording on ${target}`);
  // The flow is saved into the project it was recorded for; a different project here is a mistake.
  // Discarding also belongs to that project; omitted project permits explicit-target recovery.
  invariant(!options.project || path.resolve(options.project) === path.resolve(current.project), "INVALID_INPUT",
    `The recording on ${target} belongs to ${current.project}, not ${path.resolve(options.project ?? "")}`,
    { flow: current.flow.id, project: current.project }, "Pass the project of the recording to save or discard it");
  if (options.discard) {
    await kvDelete(`recording:${target}`);
    return { discarded: current.flow.id };
  }
  invariant(options.assert && (options.assert.visible || options.assert.hidden), "INVALID_INPUT", "A final assert (visible or hidden selector) is required to save a flow",
    undefined, "The assert proves the flow reached its goal, e.g. {visible:{text:'订单已提交'}}");
  invariant(current.flow.steps.length > 0, "INVALID_INPUT", "Recording has no steps");
  const selector = (options.assert.visible ?? options.assert.hidden)!;
  const verdict = await waitFor(target, selector, options.assert.visible ? "visible" : "hidden", options.assert.timeout_ms ?? 5000, signal);
  invariant(verdict.passed, "ASSERTION_FAILED", "Final assert failed on the current screen; the flow was not saved", { matches: verdict.matches },
    "Reach the goal state first, or fix the assert selector");
  current.flow.assert = {
    ...(options.assert.visible ? { visible: fromSelector(options.assert.visible) } : { hidden: fromSelector(options.assert.hidden!) }),
    timeoutMs: options.assert.timeout_ms ?? 5000,
  };
  writeFlow(current.project, current.flow);
  await kvDelete(`recording:${target}`);
  return { saved: current.flow.id, steps: current.flow.steps.length, variables: Object.keys(current.flow.variables), file: flowFile(current.project, current.flow.id) };
}

/* ---------------------------------- replay ---------------------------------- */

export async function replayFlow(project: string, id: string, target: string, variables: Record<string, string>, options: { repair?: boolean; screen?: { w: number; h: number }; attach?: boolean }, signal: AbortSignal, log: (m: string) => void) {
  const flow = readFlow(project, id);
  const accepted: { text: string; kind: string }[] = [];
  const ready = async (nodes?: Awaited<ReturnType<typeof dumpTree>>) => {
    const consent = await acceptAgreements(target, signal, nodes);
    accepted.push(...consent.accepted);
    return consent.nodes;
  };
  const wait = async (selector: Selector, state: "visible" | "hidden", timeout: number) => {
    const verdict = await waitFor(target, selector, state, timeout, signal, true);
    accepted.push(...(verdict.agreements_accepted ?? []));
    return verdict;
  };
  const missing = Object.entries(flow.variables).filter(([k, v]) => v.required && variables[k] === undefined).map(([k]) => k);
  invariant(!missing.length, "INVALID_INPUT", `Missing flow variables: ${missing.join(", ")}`, { variables: Object.keys(flow.variables) });
  // attach: the app was just (re)launched by the caller (run then_flow), so do not restart it again.
  if (flow.start.mode === "restart" && !options.attach) {
    await forceStop(target, flow.app.bundleName, signal).catch(() => {});
    await launch(target, flow.app.bundleName, flow.app.ability, flow.app.module, signal);
    (await import("./repeat.js")).noteLaunch(target);
  }
  await ready();
  if (flow.start.mode === "restart") await wait({ bundle: flow.app.bundleName }, "visible", 10000);
  let repaired = false;
  const results: { step: string; ok: boolean; detail?: unknown }[] = [];
  const screen = options.screen;
  const point = (p: { xPercent: number; yPercent: number }) => {
    invariant(screen, "UI_SCREEN_UNKNOWN", "Screen size unknown for percentage point");
    return { x: Math.round((p.xPercent * screen.w) / 100), y: Math.round((p.yPercent * screen.h) / 100) };
  };
  for (const step of flow.steps) {
    signal.throwIfAborted();
    const timeout = step.timeoutMs ?? 10000;
    try {
      await ready();
      if (["waitVisible", "assertVisible", "waitHidden", "assertHidden"].includes(step.action)) {
        invariant(step.selector, "FLOW_INVALID", `${step.id} needs a selector`);
        const verdict = await wait(toSelector(step.selector), /Visible/.test(step.action) ? "visible" : "hidden", timeout);
        invariant(verdict.passed, "ASSERTION_FAILED", `${step.id} ${step.action} failed`, { matches: verdict.matches });
        results.push({ step: step.id, ok: true });
        continue;
      }
      let xy: { x: number; y: number } | undefined;
      if (step.selector) {
        const candidates = [step.selector, ...(step.alternates ?? [])];
        const deadline = Date.now() + timeout;
        for (;;) {
          const nodes = await ready(await dumpTree(target, signal)) ?? await dumpTree(target, signal);
          const hit = candidates.map((c, i) => ({ i, m: select(nodes, toSelector(c)) })).find((c) => c.m.length > 0);
          if (hit) {
            xy = center(hit.m.find((n) => n.clickable) ?? hit.m[0]!);
            if (hit.i > 0 && options.repair) {
              // Promote the alternate that worked so future replays are fast and stable.
              step.alternates = [step.selector, ...(step.alternates ?? []).filter((_, j) => j !== hit.i - 1)];
              step.selector = candidates[hit.i]!;
              repaired = true;
            }
            break;
          }
          if (Date.now() > deadline) throw new ToolError("UI_NOT_FOUND", `${step.id}: element not found`, { selector: step.selector });
          await new Promise((r) => setTimeout(r, 400));
        }
      } else if (step.point) xy = point(step.point);
      const value = step.value?.replace(/^\$\{(\w+)\}$/, (_, name: string) => variables[name] ?? "");
      const g = step.gesture;
      const gesture = g && screen ? { ...point({ xPercent: g.fromXPercent, yPercent: g.fromYPercent }), ...Object.fromEntries(Object.entries(point({ xPercent: g.toXPercent, yPercent: g.toYPercent })).map(([k, v]) => [`${k}2`, v])) } as { x: number; y: number; x2: number; y2: number } : undefined;
      const map: Record<string, () => Action> = {
        tap: () => ({ action: "click", ...xy! }),
        doubleTap: () => ({ action: "double_click", ...xy! }),
        longTap: () => ({ action: "long_click", ...xy! }),
        input: () => ({ action: "input", ...xy!, text: value ?? "" }),
        focusInput: () => ({ action: "type", text: value ?? "" }),
        key: () => ({ action: "key", key: step.key ?? step.keys?.[0] ?? "Back" }),
        swipe: () => ({ action: "swipe", ...gesture! }),
        drag: () => ({ action: "drag", ...gesture! }),
        fling: () => ({ action: "fling", ...gesture! }),
        dircFling: () => ({ action: "scroll", direction: (["left", "right", "up", "down"] as const)[step.direction ?? 3]! }),
      };
      const build = map[step.action];
      invariant(build, "FLOW_UNSUPPORTED", `${step.id}: action ${step.action} is not supported by this version`);
      const performed = await act(target, build(), signal);
      accepted.push(...(performed.agreements_accepted ?? []));
      log(`${step.id} ${step.action} ok`);
      results.push({ step: step.id, ok: true });
      await new Promise((r) => setTimeout(r, 300));
    } catch (error) {
      results.push({ step: step.id, ok: false, detail: (error as Error).message });
      if (repaired) writeFlow(project, flow);
      const nodes = await dumpTree(target, signal).catch(() => []);
      throw new ToolError("FLOW_STEP_FAILED", `Flow ${id} failed at ${step.id}`, {
        results, ...(accepted.length ? { agreements_accepted: accepted } : {}), visible: nodes.filter((n) => n.text && n.bundle === flow.app.bundleName).slice(0, 20).map(describe),
      }, "Inspect with ui observe; update the flow by re-recording or pass repair=true with alternates");
    }
  }
  let assertion: unknown = null;
  if (flow.assert) {
    const selector = flow.assert.visible ?? flow.assert.hidden;
    const verdict = await wait(toSelector(selector!), flow.assert.visible ? "visible" : "hidden", flow.assert.timeoutMs ?? 5000);
    assertion = verdict;
    invariant(verdict.passed, "ASSERTION_FAILED", `Flow ${id} final assert failed`, { results, matches: verdict.matches });
  }
  if (repaired) writeFlow(project, flow);
  return { flow: id, passed: true, steps: results.length, repaired, assertion, ...(accepted.length ? { agreements_accepted: accepted } : {}) };
}
