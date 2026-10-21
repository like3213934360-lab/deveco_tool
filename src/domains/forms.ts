import { setTimeout as delay } from "node:timers/promises";
import { act, center, dumpTree, invalidate, select, subtree, type UiNode } from "./ui.js";
import { hilog, shell } from "./device.js";
import { entryGraph } from "./entries.js";
import { normalizeDeviceType } from "./project.js";
import { errorResult, invariant, ToolError } from "../core/errors.js";

export interface FormInput {
  target: string; project?: string; product?: string; bundle?: string;
  form_index?: number; max_pages?: number; then_flow?: string;
}
export interface FormInstance {
  bundle: string; instance_id: string; key: string; page: number | null;
  bounds: UiNode["rect"]; text: string[];
}

/** A host adapter based on observed system structure; unknown hosts are explicitly unsupported. */
export function desktopForms(nodes: UiNode[]): FormInstance[] {
  const result = new Map<string, FormInstance>();
  for (const node of nodes) {
    const match = /^(?:SwiperPage_)?FormItem_(.+)_(-?\d+)$/.exec(node.key ?? "");
    if (!match || !node.rect || node.visible === false) continue;
    let owner = node;
    while (owner.parent !== null && !/^SwiperPage_Grid_WorkSpace_\d+$/.test(owner.key ?? "")) owner = nodes[owner.parent]!;
    const page = /^SwiperPage_Grid_WorkSpace_(\d+)$/.exec(owner.key ?? "")?.[1];
    const item = { bundle: match[1]!, instance_id: match[2]!, key: node.key!, page: page === undefined ? null : Number(page), bounds: node.rect,
      text: [...new Set(subtree(nodes, node.i).map((n) => n.text).filter(Boolean))].slice(0, 20) };
    if (!result.has(`${item.bundle}:${item.instance_id}`)) result.set(`${item.bundle}:${item.instance_id}`, item);
  }
  return [...result.values()];
}

export function centerForms(nodes: UiNode[], bundle: string) {
  return nodes.flatMap((n) => {
    const prefix = `FormCenterFormItem_Stack_${bundle}_`;
    if (!n.key?.startsWith(prefix) || !/^\d+$/.test(n.key.slice(prefix.length))) return [];
    let owner = n;
    while (owner.parent !== null && !/^SwiperItemView_Column_/.test(owner.key ?? "")) owner = nodes[owner.parent]!;
    return [{ index: Number(n.key.slice(prefix.length)), key: n.key, bounds: n.rect,
      labels: [...new Set(subtree(nodes, owner.i).map((v) => v.text).filter(Boolean))].slice(0, 12) }];
  });
}

function selectedPreview(nodes: UiNode[], bundle: string) {
  const selected = centerForms(nodes, bundle).filter((v) => v.bounds)
    .sort((a, b) => (b.bounds!.x2 - b.bounds!.x1) - (a.bounds!.x2 - a.bounds!.x1))[0];
  invariant(selected, "CAPABILITY_UNAVAILABLE", "This card center exposes no recognized preview identity");
  return selected;
}

const desktopWorkspaces = (nodes: UiNode[]) => nodes.filter((n) => /^SwiperPage_Grid_WorkSpace_\d+$/.test(n.key ?? "") && n.rect && n.visible !== false);
const desktopWorkspace = (nodes: UiNode[]) => desktopWorkspaces(nodes)[0];
function desktopPage(nodes: UiNode[]) {
  const node = desktopWorkspace(nodes);
  invariant(node, "CAPABILITY_UNAVAILABLE", "The current UI is not a supported desktop page", undefined, "Unlock the selected device and return to its desktop; lock-screen and other hosts require separate adapters");
  return { index: Number(node.key!.match(/(\d+)$/)![1]), node: exact(nodes, "GridSwiper_Stack_Swiper"),
    indices: desktopWorkspaces(nodes).map((n) => Number(n.key!.match(/(\d+)$/)![1])) };
}
async function fresh(target: string, signal: AbortSignal) { invalidate(target); return dumpTree(target, signal); }
/** Home and page animations complete asynchronously; observe readiness without replaying actions. */
async function desktopNodes(target: string, signal: AbortSignal) {
  let nodes = await fresh(target, signal);
  for (let attempt = 0; !desktopWorkspace(nodes) && attempt < 20; attempt++) {
    await delay(250, undefined, { signal });
    nodes = await fresh(target, signal);
  }
  desktopPage(nodes); // Unknown/locked hosts still fail explicitly when the bounded wait expires.
  return nodes;
}
async function slide(target: string, node: UiNode, left: boolean, signal: AbortSignal) {
  const r = node.rect!;
  await act(target, { action: "swipe", x: Math.round(r.x1 + (r.x2 - r.x1) * (left ? .85 : .15)), y: Math.round(r.y1 + (r.y2 - r.y1) * .6),
    x2: Math.round(r.x1 + (r.x2 - r.x1) * (left ? .15 : .85)), y2: Math.round(r.y1 + (r.y2 - r.y1) * .6), speed: 1000 }, signal);
  await delay(250, undefined, { signal });
}
async function click(target: string, node: UiNode, signal: AbortSignal, long = false) {
  await act(target, { action: long ? "long_click" : "click", ...center(node) }, signal);
  await delay(250, undefined, { signal });
}
function exact(nodes: UiNode[], key: string) {
  const matches = select(nodes, { key });
  invariant(matches.length === 1, "CAPABILITY_UNAVAILABLE", `Expected one system control: ${key}`, { matches: matches.length }, "Inspect this host version with ui tree; no coordinate fallback was attempted");
  return matches[0]!;
}

/** Bounded desktop traversal. Visitor true stops on the page containing the selected instance/icon. */
async function scan(input: FormInput, signal: AbortSignal, visitor?: (nodes: UiNode[]) => boolean) {
  const limit = input.max_pages ?? 12, seen = new Set<number>(), visited = new Set<number>(), instances = new Map<string, FormInstance>();
  await act(input.target, { action: "key", key: "Home" }, signal);
  let nodes = await desktopNodes(input.target, signal), page = desktopPage(nodes);
  for (let i = 0; page.index !== 0 && i < limit; i++) {
    const previous = page.index;
    await slide(input.target, page.node, false, signal);
    nodes = await desktopNodes(input.target, signal); page = desktopPage(nodes);
    if (page.index === previous) break;
  }
  const fromFirst = page.index === 0;
  const covered = () => fromFirst && seen.size === Math.max(...seen) + 1;
  for (let i = 0; i < limit; i++) {
    page = desktopPage(nodes);
    if (visited.has(page.index)) return { instances: [...instances.values()], pages: [...seen], complete: covered(), nodes, found: false };
    visited.add(page.index);
    page.indices.forEach((index) => seen.add(index));
    for (const item of desktopForms(nodes)) instances.set(`${item.bundle}:${item.instance_id}`, item);
    if (visitor?.(nodes)) return { instances: [...instances.values()], pages: [...seen], complete: false, nodes, found: true };
    await slide(input.target, page.node, true, signal);
    nodes = await desktopNodes(input.target, signal);
  }
  return { instances: [...instances.values()], pages: [...seen], complete: covered() && visited.has(desktopPage(nodes).index), nodes, found: false };
}

export async function inventoryForms(input: FormInput, signal: AbortSignal) {
  const { nodes: _, found: __, ...result } = await scan(input, signal);
  return { ...result, target: input.target, host: "desktop", scope: "observed-desktop-pages", runtime_rendering: "not-judged" };
}

export function formContext(input: FormInput) {
  const graph = input.project ? entryGraph(input.project, input.product) : undefined;
  const bundle = input.bundle ?? graph?.bundle;
  invariant(bundle && /^[\w.]+$/.test(bundle), "INVALID_INPUT", "A project with bundleName or an explicit bundle is required");
  invariant(!graph?.bundle || graph.bundle === bundle, "CONFLICT", "Project and bundle do not match");
  return { bundle, graph };
}

export async function catalogForms(input: FormInput, signal: AbortSignal) {
  const { bundle } = formContext(input);
  // Observed desktop versions use either container; their nested AppIcon_Image is the same entry.
  const prefixes = [`Container_AppIcon_Image_${bundle}`, `AppIconCommonView_${bundle}.`];
  const iconsOn = (nodes: UiNode[]) => nodes.filter((n) => n.rect && n.visible !== false && prefixes.some((prefix) => n.key?.startsWith(prefix)));
  const located = await scan(input, signal, (nodes) => iconsOn(nodes).length > 0);
  invariant(located.found, "NOT_FOUND", "Application icon not found in scanned desktop pages", { bundle, pages: located.pages });
  const icons = iconsOn(located.nodes);
  invariant(icons.length === 1, "UI_AMBIGUOUS", "Multiple app entry icons; open the intended card center explicitly", { keys: icons.map((n) => n.key) });
  await click(input.target, icons[0]!, signal, true);
  let nodes = await fresh(input.target, signal);
  const menus = nodes.filter((n) => /^AppMenu_HorizontalMenuItem_fixedMenu/.test(n.key ?? "") && subtree(nodes, n.i).some((v) => /^(卡片|服务卡片|Widgets?|Cards?)$/i.test(v.text)));
  invariant(menus.length === 1, "CAPABILITY_UNAVAILABLE", "No unique system card menu was found", { bundle });
  await click(input.target, menus[0]!, signal);
  nodes = await fresh(input.target, signal);
  const centers = nodes.filter((n) => ["FormManagerView_Stack", "FormCenterSplitView_Navigation"].includes(n.key ?? "") && n.rect && n.visible !== false);
  invariant(centers.length === 1, "CAPABILITY_UNAVAILABLE", "No unique supported system card center was found", { matches: centers.length }, "Inspect this host version with ui tree; phone and observed split layouts are supported");
  // Hosts can open on the default card in the middle of the catalog.
  // Confirm the leading boundary before claiming an enumeration is complete.
  let fromFirst = false;
  for (let i = 0; i < (input.max_pages ?? 12); i++) {
    const previous = selectedPreview(nodes, bundle).index;
    if (previous === 0) { fromFirst = true; break; }
    await slide(input.target, exact(nodes, "FormCenterSwiper"), false, signal);
    nodes = await fresh(input.target, signal);
    if (selectedPreview(nodes, bundle).index === previous) { fromFirst = true; break; }
  }
  const previews = new Map<number, ReturnType<typeof centerForms>[number]>(), visited = new Set<number>();
  for (let i = 0; i < (input.max_pages ?? 12); i++) {
    const candidates = centerForms(nodes, bundle);
    for (const item of candidates) previews.set(item.index, item);
    const selected = selectedPreview(nodes, bundle);
    if (visited.has(selected.index)) return { bundle, previews: [...previews.values()].sort((a, b) => a.index - b.index), complete: fromFirst, selected_index: selected.index };
    visited.add(selected.index);
    await slide(input.target, exact(nodes, "FormCenterSwiper"), true, signal);
    nodes = await fresh(input.target, signal);
  }
  return { bundle, previews: [...previews.values()].sort((a, b) => a.index - b.index), complete: false };
}

export type FormBaseline = Awaited<ReturnType<typeof inventoryForms>>;
export interface Attachment { target: string; bundle: string; instance: FormInstance; started_at: number; selected_index: number; baseline: FormBaseline }

export function addedForms(before: FormInstance[], after: FormInstance[], bundle: string) {
  const previous = new Set(before.map((v) => `${v.bundle}:${v.instance_id}`));
  return after.filter((v) => v.bundle === bundle && !previous.has(`${v.bundle}:${v.instance_id}`));
}

export async function attachForm(input: FormInput, baseline: FormBaseline, signal: AbortSignal): Promise<Attachment> {
  invariant(baseline.complete, "EVIDENCE_MISSING", "A complete bounded desktop inventory is required before adding a test form");
  const started = Date.now(), catalog = await catalogForms(input, signal);
  invariant(catalog.complete, "EVIDENCE_MISSING", "Card center enumeration reached its bound", catalog);
  const index = input.form_index ?? (catalog.previews.length === 1 ? catalog.previews[0]!.index : undefined);
  invariant(index !== undefined && catalog.previews.some((v) => v.index === index), "INVALID_INPUT", "Select form_index from ui form catalog; indices do not prove declaration identity", { previews: catalog.previews });
  let nodes = await fresh(input.target, signal);
  for (let i = 0; i <= catalog.previews.length; i++) {
    const selected = selectedPreview(nodes, catalog.bundle);
    if (selected.index === index) break;
    invariant(i < catalog.previews.length, "CAPABILITY_UNAVAILABLE", "Could not select requested card preview");
    await slide(input.target, exact(nodes, "FormCenterSwiper"), selected.index < index, signal);
    nodes = await fresh(input.target, signal);
  }
  let attempted = false;
  try {
    const add = exact(nodes, "SwiperLayout_AddToDesktopButton");
    attempted = true;
    await click(input.target, add, signal);
    const after = await inventoryForms(input, signal), added = addedForms(baseline.instances, after.instances, catalog.bundle);
    invariant(after.complete && added.length === 1, "EVIDENCE_MISSING", "Cannot uniquely identify the form created by this operation", { added, complete: after.complete });
    return { target: input.target, bundle: catalog.bundle, instance: added[0]!, started_at: started, selected_index: index, baseline };
  } catch (error) {
    if (!attempted) throw error;
    const cleanupSignal = AbortSignal.timeout(90000);
    try {
      const after = await inventoryForms(input, cleanupSignal), added = addedForms(baseline.instances, after.instances, catalog.bundle);
      invariant(after.complete && added.length <= 1, "EVIDENCE_MISSING", "Addition outcome is uncertain; no instance was deleted", { candidates: added });
      if (added.length) await removeForm(input, { target: input.target, bundle: catalog.bundle, instance: added[0]!, started_at: started, selected_index: index, baseline }, cleanupSignal);
    } catch (cleanup) { throw new ToolError("FORM_CLEANUP_FAILED", "Attachment failed and owned cleanup could not be confirmed", { original: errorResult(error), cleanup: errorResult(cleanup) }, "Inspect the selected desktop; automatic cleanup is not retried"); }
    throw error;
  }
}

export async function removeForm(input: FormInput, attachment: Attachment, signal: AbortSignal) {
  invariant(attachment.target === input.target && !attachment.baseline.instances.some((v) => v.bundle === attachment.bundle && v.instance_id === attachment.instance.instance_id), "CONFLICT", "Cleanup requires this operation's new instance on the same target");
  const located = await scan(input, signal, (nodes) => desktopForms(nodes).some((v) => v.bundle === attachment.bundle && v.instance_id === attachment.instance.instance_id));
  if (!located.found) {
    invariant(located.complete, "EVIDENCE_MISSING", "Cannot prove the instance was already removed");
    invariant(attachment.baseline.instances.every((v) => located.instances.some((a) => a.bundle === v.bundle && a.instance_id === v.instance_id)), "FORM_CLEANUP_FAILED", "A pre-existing form is missing", { before: attachment.baseline.instances, after: located.instances });
    return { removed: true, already_absent: true, instance_id: attachment.instance.instance_id, preexisting_preserved: true };
  }
  const item = desktopForms(located.nodes).find((v) => v.bundle === attachment.bundle && v.instance_id === attachment.instance.instance_id)!;
  await click(input.target, exact(located.nodes, item.key), signal, true);
  let nodes = await fresh(input.target, signal);
  const menus = nodes.filter((n) => /^FormMenu_HorizontalMenuItem_/.test(n.key ?? "") && subtree(nodes, n.i).some((v) => /^(移除|Remove)$/i.test(v.text)));
  invariant(menus.length === 1, "CAPABILITY_UNAVAILABLE", "No unique system form removal menu");
  await click(input.target, menus[0]!, signal);
  nodes = await fresh(input.target, signal);
  const confirm = nodes.filter((n) => /^advanced_dialog_button_/.test(n.key ?? "") && subtree(nodes, n.i).some((v) => /^(移除|Remove)$/i.test(v.text)));
  invariant(confirm.length <= 1, "UI_AMBIGUOUS", "Ambiguous removal confirmation");
  if (confirm.length) await click(input.target, confirm[0]!, signal);
  const after = await inventoryForms(input, signal);
  invariant(after.complete && !after.instances.some((v) => v.bundle === attachment.bundle && v.instance_id === attachment.instance.instance_id), "FORM_CLEANUP_FAILED", "Form removal could not be confirmed", { after });
  invariant(attachment.baseline.instances.every((v) => after.instances.some((a) => a.bundle === v.bundle && a.instance_id === v.instance_id)), "FORM_CLEANUP_FAILED", "A pre-existing form is missing after cleanup", { before: attachment.baseline.instances, after: after.instances });
  return { removed: true, instance_id: attachment.instance.instance_id, preexisting_preserved: true };
}

export async function inspectForm(input: FormInput, attachment: Attachment, signal: AbortSignal) {
  const located = await scan(input, signal, (nodes) => desktopForms(nodes).some((v) => v.bundle === attachment.bundle && v.instance_id === attachment.instance.instance_id));
  invariant(located.found, "EVIDENCE_MISSING", "Added form is no longer observable");
  const instance = desktopForms(located.nodes).find((v) => v.bundle === attachment.bundle && v.instance_id === attachment.instance.instance_id)!;
  const seconds = Math.min(10800, Math.max(1, Math.ceil((Date.now() - attachment.started_at) / 1000)));
  const id = attachment.instance.instance_id;
  const logs = await hilog(input.target, { from: `${seconds}s`, grep: `(?:formId|form_id|formID)[=:\\s"']+${id}(?!\\d)`, lines: 200 }, signal);
  const { graph } = formContext(input), declarations = graph?.entries.filter((v) => v.kind === "form") ?? [];
  const correlation = correlateForm(instance, declarations, logs.tail);
  return { instance, declarations,
    correlation: { ...correlation, log_scope: "returned tail of bounded system log query; related processes may not emit identifying fields; read its artifact for all captured matches", logs },
    selection: { center_index: attachment.selected_index, reported_sizes: correlation.reported_sizes },
    attachment_verified: true, business_correctness: "not-judged", rendering: "observable-content-only" };
}

/** Join only explicit identifying fields; application messages remain uninterpreted evidence. */
export function correlateForm(instance: FormInstance, declarations: Record<string, unknown>[], text: string) {
  const id = new RegExp(`(?:formId|form_id|formID)[=:\\s"']+${instance.instance_id}(?!\\d)`);
  const lines = text.split(/\r?\n/).filter((line) => id.test(line));
  const values = (field: string) => [...new Set(lines.flatMap((line) => [...line.matchAll(new RegExp(`\\b${field}[=:\\s"']+([\\w.*-]+)`, "g"))].map((m) => m[1]!)))];
  const names = values("formName"), modules = values("moduleName"), abilities = values("abilityName"), bundles = values("bundleName");
  const candidates = !bundles.length || bundles.every((b) => b === instance.bundle) ? declarations.filter((d) =>
    names.includes(String(d.name)) && (!modules.length || modules.includes(String(d.module_name))) &&
    (!abilities.length || (d.referenced_by as { owner: string }[] | undefined)?.some((r) => abilities.includes(r.owner)))) : [];
  const identified = bundles.length === 1 && names.length === 1 && modules.length === 1 && abilities.length === 1;
  return { instance_id: instance.instance_id, basis: lines.length ? "explicit-instance-id-in-log" : "no-matching-log", matched_lines: lines.length,
    fields: { bundle_names: bundles, form_names: names, module_names: modules, ability_names: abilities },
    declaration_match: identified && candidates.length ? "identity-fields-match; resource-variant-unresolved" : candidates.length ? "candidates" : "unresolved",
    candidates, reported_sizes: values("(?:sizeKey|formSize)").map((v) => v.replace(/[xX]/g, "*")).filter((v) => /^[1-6]\*[1-6]$/.test(v)) };
}

/** Device/install facts are independent of a subsequent card attachment. */
export async function formReachability(input: FormInput, signal: AbortSignal) {
  const { bundle, graph } = formContext(input);
  const type = (await shell(input.target, ["param", "get", "const.product.devicetype"], signal)).stdout.trim();
  const result = await shell(input.target, ["bm", "dump", "-n", bundle], signal);
  const start = result.stdout.indexOf("{");
  let installed: unknown;
  try { installed = start < 0 ? undefined : JSON.parse(result.stdout.slice(start)); } catch { /* Unrecognized dump is unknown, never inferred to be absent. */ }
  const rawModules = (installed as { hapModuleInfos?: unknown } | undefined)?.hapModuleInfos;
  const modules = Array.isArray(rawModules) && rawModules.every((m) => m && typeof m.moduleName === "string") ? rawModules as { moduleName: string }[] : undefined;
  return { device_type: type, installation_scope: modules ? "bm.hapModuleInfos" : "unresolved", installation_output: result.stdout.slice(0, 1000),
    declarations: (graph?.entries.filter((e) => e.kind === "form") ?? []).map((e) => ({ name: e.name, module: e.module, module_name: e.module_name,
      compatible: type && Array.isArray(e.device_types) ? e.device_types.map(normalizeDeviceType).includes(normalizeDeviceType(type)) : null,
      module_installed: modules ? modules.some((m) => m.moduleName === e.module_name) : null, source: e.source })),
    host_support: "requires-runtime-probe" };
}
