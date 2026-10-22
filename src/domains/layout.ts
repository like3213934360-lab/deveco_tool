import { errorResult, invariant, ToolError } from "../core/errors.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { stateDir } from "../core/config.js";
import { atomicWrite } from "../core/files.js";
import type { UiNode } from "./ui.js";

/*
 * Layout checks over a UI tree (one per device form / fold state). Rules only flag what is almost
 * always a bug on a multi-form ("一多") screen; each finding names the element so it can be fixed:
 *   offscreen  - labelled/interactive element partly outside the window (not inside a scroll container)
 *   overlap    - two clickable elements whose areas overlap by > 30 % of the smaller (taps hit the wrong one)
 *   clipped    - text whose box extends past its non-scrolling parent (cut-off labels)
 *   collapsed  - text element with zero width or height (text squeezed away)
 *   tiny_target - clickable element smaller than 32x32 vp (hard to tap; WCAG/HarmonyOS guidance is 40+ vp)
 */

export interface LayoutIssue { rule: "offscreen" | "overlap" | "clipped" | "collapsed" | "tiny_target"; element: string; bounds: number[]; other?: string; detail?: string }

const SCROLL = /^(Scroll|List|ListItem|ListItemGroup|Grid|GridItem|WaterFlow|FlowItem|Swiper|Tabs|TabContent|Refresh|ArcList)$/;
const label = (n: UiNode) => `${n.type}${n.text ? ` "${n.text.slice(0, 30)}"` : n.key ? ` key=${n.key}` : ` #${n.i}`}`;
const box = (n: UiNode) => [n.rect!.x1, n.rect!.y1, n.rect!.x2, n.rect!.y2];
const area = (r: { x1: number; y1: number; x2: number; y2: number }) => Math.max(0, r.x2 - r.x1) * Math.max(0, r.y2 - r.y1);

/**
 * screen: window size in px; density: px per vp (deviceInfo VirtualPixelRatio, e.g. 3.5).
 * bundle: only the app's own elements (system bars and launcher are not the app's layout). Pure.
 */
export function checkLayout(nodes: UiNode[], screen: { w: number; h: number }, options: { bundle?: string; density?: number; limit?: number; min_target_vp?: number; strict_targets?: boolean } = {}) {
  const byIndex = new Map(nodes.map((n) => [n.i, n]));
  const own = nodes.filter((n) => n.rect && n.visible !== false && (!options.bundle || n.bundle === options.bundle));
  const inScroll = (n: UiNode) => {
    for (let p = n.parent; p !== null; p = byIndex.get(p)?.parent ?? null) if (SCROLL.test(byIndex.get(p)?.type ?? "")) return true;
    return false;
  };
  const issues: LayoutIssue[] = [];
  const interesting = own.filter((n) => n.text || n.clickable);
  const density = options.density ?? 3;

  for (const n of interesting) {
    const r = n.rect!;
    const w = r.x2 - r.x1, h = r.y2 - r.y1;
    if (n.text && (w <= 0 || h <= 0)) { issues.push({ rule: "collapsed", element: label(n), bounds: box(n) }); continue; }
    if (w <= 0 || h <= 0) continue;
    // Horizontal overflow is a bug anywhere outside horizontal scrollers; vertical only outside any scroller.
    const out = r.x1 < -2 || r.x2 > screen.w + 2 || ((r.y1 < -2 || r.y2 > screen.h + 2) && !inScroll(n));
    if (out && !inScroll(n)) issues.push({ rule: "offscreen", element: label(n), bounds: box(n), detail: `screen ${screen.w}x${screen.h}` });
    if (n.clickable && (w / density < (options.min_target_vp ?? 32) || h / density < (options.min_target_vp ?? 32)) && n.type !== "Text")
      issues.push({ rule: "tiny_target", element: label(n), bounds: box(n), detail: `${Math.round(w / density)}x${Math.round(h / density)} vp` });
  }

  // Overlapping tap targets: siblings-or-cousins only (a clickable child inside a clickable card is normal).
  const clickable = interesting.filter((n) => n.clickable && area(n.rect!) > 0);
  const ancestor = (a: UiNode, b: UiNode) => {
    for (let p = b.parent; p !== null; p = byIndex.get(p)?.parent ?? null) if (p === a.i) return true;
    return false;
  };
  // Only labelled targets count: an unlabelled clickable container (gesture catcher, tab bar background
  // stack seen on HarmonyOS Tabs) legitimately underlies the real buttons.
  const targets = clickable.filter((n) => n.text || n.key); // key "" (no id) is not a label
  for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
    const a = targets[i]!, b = targets[j]!;
    if (ancestor(a, b) || ancestor(b, a)) continue;
    const ra = a.rect!, rb = b.rect!;
    const inter = area({ x1: Math.max(ra.x1, rb.x1), y1: Math.max(ra.y1, rb.y1), x2: Math.min(ra.x2, rb.x2), y2: Math.min(ra.y2, rb.y2) });
    if (inter > 0.3 * Math.min(area(ra), area(rb))) issues.push({ rule: "overlap", element: label(a), bounds: box(a), other: label(b) });
  }

  // Text cut by its parent: the parent does not scroll and the text sticks out by more than 2 px.
  for (const n of own) {
    if (!n.text || n.parent === null || inScroll(n)) continue;
    const p = byIndex.get(n.parent);
    if (!p?.rect || SCROLL.test(p.type) || area(p.rect) === 0) continue;
    const r = n.rect!, q = p.rect;
    if (r.x1 < q.x1 - 2 || r.x2 > q.x2 + 2 || r.y1 < q.y1 - 2 || r.y2 > q.y2 + 2)
      issues.push({ rule: "clipped", element: label(n), bounds: box(n), other: label(p) });
  }

  const counts = issues.reduce<Record<string, number>>((c, x) => ((c[x.rule] = (c[x.rule] ?? 0) + 1), c), {});
  // Nothing of the app on screen (covered by a system dialog, still starting, crashed): no verdict.
  if (!interesting.length) return { passed: false, checked: 0, counts, issues: [], error: "No elements of the app on screen (covered by a dialog, still loading, or not in front): nothing was checked" };
  return { passed: !issues.some((x) => options.strict_targets || x.rule !== "tiny_target"), checked: interesting.length, checked_unit: "nodes", density_source: options.density ? "device" : "assumed", counts, issues: issues.slice(0, options.limit ?? 20), ...(issues.length > (options.limit ?? 20) ? { more: issues.length - (options.limit ?? 20) } : {}) };
}

/** Forms checked by default and the fold states worth a separate look (Emulator -foldedState values). */
export const LAYOUT_FORMS: Record<string, { device_type: string; states: string[] }> = {
  foldable: { device_type: "foldable", states: ["open", "close"] },
  widefold: { device_type: "widefold", states: ["open", "close"] },
  triplefold: { device_type: "triplefold", states: ["triple", "double", "single"] },
};

/* ------------------------------- device runs ------------------------------- */

export interface LayoutInput {
  project: string; product?: string; forms?: string[]; then_flow?: string; flow_variables?: Record<string, string>;
  /** keep the emulators running afterwards (default: stop the ones this check started) */
  keep_running?: boolean;
  min_target_vp?: number; strict_targets?: boolean;
}
type Log = (m: string) => void;

/** Newest downloaded image for a device type (os_version string as the Emulator CLI wants it). */
async function newestImage(deviceType: string, signal: AbortSignal) {
  const { images } = await import("./emulator.js");
  const list = (await images(deviceType, signal)).images.filter((i) => i.downloaded && i.device_type?.toLowerCase() === deviceType);
  const api = (v: string | undefined) => Number(/\((\d+)(?:\.\d+)*\)/.exec(v ?? "")?.[1] ?? 0);
  return list.sort((a, b) => api(b.os_version) - api(a.os_version))[0]?.os_version;
}

/** One owned instance, shared by layout and card matrices. Never touches a user's instance. */
export async function withOwnedEmulator<T>(input: { owner: string; purpose: string; device_type: string; os_version: string; keep_running?: boolean },
  signal: AbortSignal, work: (instance: { name: string; target: string; instancePath: string }) => Promise<T>): Promise<T> {
  const emu = await import("./emulator.js");
  // Cleanup must be supported before creating any instance in a separate directory.
  await emu.requireScopedStop(signal);
  const available = (await emu.images(input.device_type, signal)).images;
  invariant(available.some((i) => i.downloaded && i.device_type?.toLowerCase() === input.device_type && i.os_version === input.os_version),
    "CAPABILITY_UNAVAILABLE", "No installed image matches the explicit emulator constraints", { device_type: input.device_type, os_version: input.os_version });
  const name = `deveco_${input.purpose}_${input.owner}`.replace(/[^\w]/g, "_").slice(0, 60);
  const instancePath = path.join(stateDir(), "emulators", input.owner, input.purpose), marker = path.join(instancePath, ".owner");
  invariant(!fs.existsSync(instancePath), "CONFLICT", "Owned instance directory already exists; reconcile it before another attempt", { instancePath });
  fs.mkdirSync(instancePath, { recursive: true }); atomicWrite(marker, input.owner, 0o600);
  let completed = false, original: unknown;
  try {
    await emu.createEmulator({ name, device_type: input.device_type, os_version: input.os_version, instance_path: instancePath, auto_accept_license: false }, signal);
    const started = await emu.startEmulator(name, { window: false, instance_path: instancePath, auto_accept_license: false }, signal);
    invariant(started.target, "EVIDENCE_MISSING", "Owned emulator started without a target receipt");
    const result = await work({ name, target: started.target, instancePath });
    signal.throwIfAborted(); completed = true; return result;
  } catch (error) { original = error; throw error; }
  finally {
    if (!input.keep_running || !completed) {
      const cleanup = AbortSignal.timeout(90000);
      try {
        invariant(fs.readFileSync(marker, "utf8") === input.owner, "CONFLICT", "Owned emulator marker changed");
        if ((await emu.listEmulators(cleanup, false, instancePath)).some((e) => e.name === name)) {
          await emu.stopEmulator(name, cleanup, instancePath);
          await emu.deleteEmulator(name, cleanup, instancePath);
        }
        fs.rmSync(instancePath, { recursive: true });
        const parent = path.dirname(instancePath);
        if (!fs.readdirSync(parent).length) fs.rmdirSync(parent);
      } catch (error) {
        throw new ToolError("EMULATOR_CLEANUP_FAILED", "Owned emulator cleanup failed; it is not retried automatically", { instancePath, name,
          ...(original ? { original: errorResult(original) } : {}), cleanup: errorResult(error) });
      }
    }
  }
}

/** One form: create/reuse emulator, boot, install, launch, (flow), then check each fold state. */
async function checkForm(form: string, input: LayoutInput, packages: string[], app: { bundle: string; ability: string; module: string }, signal: AbortSignal, log: Log, owner: string) {
  const spec = LAYOUT_FORMS[form]!;
  const emu = await import("./emulator.js");
  const device = await import("./device.js");
  const { dumpTree } = await import("./ui.js");
  const osVersion = await newestImage(spec.device_type, signal);
  if (!osVersion) return { form, skipped: `no downloaded ${spec.device_type} image` };
  return withOwnedEmulator({ owner, purpose: form, device_type: spec.device_type, os_version: osVersion, keep_running: input.keep_running }, signal, async ({ name, target, instancePath }) => {
    log(`${form}: installing`);
    await device.install(target, packages, signal);
    await device.forceStop(target, app.bundle, signal);
    await device.launch(target, app.bundle, app.ability, app.module, signal);
    await settleApp(target, app.bundle, signal, log);
    const info = await device.deviceInfo(target, signal);
    const results: unknown[] = [];
    for (const state of spec.states) {
      signal.throwIfAborted();
      if (state !== spec.states[0] || spec.states.length > 1) {
        try { await emu.scenario(name, { action: "fold", state }, signal); }
        catch (error) { signal.throwIfAborted(); results.push({ state, passed: false, checked: 0, error: `Fold state was not applied: ${(error as Error).message}` }); continue; }
        await new Promise((r) => setTimeout(r, 2500)); // re-layout after the fold animation
        await settleApp(target, app.bundle, signal, log);
      }
      if (state === spec.states[0] && input.then_flow) {
        const { replayFlow } = await import("./flows.js");
        const flow = await replayFlow(input.project, input.then_flow, target, input.flow_variables ?? {}, { attach: true, screen: info.screen ? { w: info.screen.width, h: info.screen.height } : undefined }, signal, log)
          .catch((e: Error) => ({ passed: false, error: e.message }));
        if (!(flow as { passed?: boolean }).passed) results.push({ state, passed: false, checked: 0, flow });
      }
      const size = await windowSize(target, app.bundle, signal) ?? (info.screen ? { w: info.screen.width, h: info.screen.height } : { w: 1080, h: 2400 });
      const nodes = await dumpTree(target, signal, 0);
      const density = await pixelRatio(target, signal);
      const check = checkLayout(nodes, size, { bundle: app.bundle, density, min_target_vp: input.min_target_vp, strict_targets: input.strict_targets });
      const { saveTree } = await import("./ui.js");
      const tree = await saveTree(nodes).catch(() => undefined);
      const shot = await (await import("./ui.js")).screenshot(target, { format: "jpeg", width: 720 }, signal).catch(() => undefined);
      results.push({ state, window: `${size.w}x${size.h}`, ...check, ...(shot ? { screenshot: shot.artifact_id } : {}), ...(tree ? { tree: tree.artifact_id } : {}) });
    }
    return { form, device: info.model ?? name, results, ...(input.keep_running ? { emulator: name, instance_path: instancePath, retained: true } : {}) };
  });
}

/**
 * Handle initial consent and setup pages, then wait until the app's own UI is on screen.
 */
async function settleApp(target: string, bundle: string, signal: AbortSignal, log: Log) {
  const { dumpTree, acceptAgreements, invalidate } = await import("./ui.js");
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    invalidate(target);
    const initial = await dumpTree(target, signal);
    const consent = await acceptAgreements(target, signal, initial);
    if (consent.accepted.length) log(`completed ${consent.accepted.length} automatic UI decisions`);
    const nodes = consent.nodes ?? initial;
    if (nodes.some((n) => n.bundle === bundle && (n.text || n.clickable))) return;
    await new Promise((r) => setTimeout(r, 800));
  }
}

/** The app window's size (fold states change it); falls back to the display size. */
async function windowSize(target: string, bundle: string, signal: AbortSignal) {
  const { listWindows } = await import("./ui.js");
  const w = (await listWindows(target, false, signal).catch(() => [])).find((x) => x.type === 1 && x.visible && x.bounds && x.name.length > 0);
  return w?.bounds ? { w: w.bounds[2]!, h: w.bounds[3]! } : undefined;
}
async function pixelRatio(target: string, signal: AbortSignal) {
  const { shell } = await import("./device.js");
  const out = (await shell(target, ["hidumper", "-s", "DisplayManagerService", "-a", "-a"], signal, 10000).catch(() => undefined))?.stdout ?? "";
  const v = Number(/VirtualPixelRatio:\s*([\d.]+)/.exec(out)?.[1]);
  return v > 0 ? v : undefined;
}

/** Run the check on every requested form, one emulator at a time (memory), reporting per form. */
export async function layoutCheck(input: LayoutInput, signal: AbortSignal, log: Log, owner = crypto.randomBytes(8).toString("hex")) {
  const { inspectProject, mainAbility, buildOutputs } = await import("./project.js");
  const project = inspectProject(input.project, input.product);
  invariant(project.bundleName, "PROJECT_INVALID", "bundleName missing");
  const forms = input.forms?.length ? input.forms : Object.keys(LAYOUT_FORMS);
  const unknown = forms.filter((f) => !LAYOUT_FORMS[f]);
  invariant(!unknown.length, "INVALID_INPUT", `Unknown forms: ${unknown.join(", ")}`, { forms: Object.keys(LAYOUT_FORMS) });
  const entry = project.modules.find((m) => m.type === "entry");
  invariant(entry, "PROJECT_INVALID", "No entry module");
  const main = mainAbility(project, entry.name);
  const haps = await buildOutputs(project, "assembleHap", [entry]);
  invariant(haps.length, "NOT_FOUND", "No built package", undefined, "Build first: project action=build (or run action=build_run)");
  const hsp = await buildOutputs(project, "assembleHsp", project.modules.filter((m) => m.type === "shared"));
  const packages = [...haps, ...hsp].map((p) => p.path);
  const supported = entry.deviceTypes.map((t) => t.toLowerCase());
  const reports: unknown[] = [];
  for (const form of forms) {
    // A foldable is a phone-class device: entry modules declaring only "phone" still install on it.
    const allowed = !supported.length || supported.includes("default") || supported.includes(form) || (supported.includes("phone") && form !== "triplefold") || (form === "triplefold" && supported.some((t) => ["phone", "tablet"].includes(t)));
    if (!allowed) { reports.push({ form, skipped: `entry deviceTypes ${supported.join("/")} exclude ${form}` }); continue; }
    try {
      reports.push(await checkForm(form, input, packages, { bundle: project.bundleName, ability: main.ability, module: main.module }, signal, log, owner));
    } catch (error) {
      signal.throwIfAborted();
      const e = error as { code?: string; message: string; hint?: string };
      reports.push({ form, error: { code: e.code, message: e.message.slice(0, 300), ...(e.hint ? { hint: e.hint } : {}) } });
    }
  }
  const rows = reports.flatMap((r) => ((r as { results?: { state: string; passed?: boolean; checked?: number }[] }).results ?? []).map((x) => ({ form: (r as { form: string }).form, ...x })));
  const failed = rows.filter((x) => x.passed === false).map((x) => `${x.form}/${x.state}`);
  const checked = rows.filter((x) => (x.checked ?? 0) > 0).length;
  // Passed only when something was actually checked and nothing failed.
  return { passed: checked > 0 && failed.length === 0 && reports.every((r) => !(r as { error?: unknown; skipped?: unknown }).error && !(r as { skipped?: unknown }).skipped), checked_states: checked, failed, forms: reports };
}
