import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import zlib from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";
import { artifactDir, commitArtifact, saveArtifact, trackExport } from "../core/artifacts.js";
import { config, packageRoot } from "../core/config.js";
import { errorResult, invariant, ToolError } from "../core/errors.js";
import { assertConnected, hdc, shell } from "./device.js";

import { automaticResult } from "./agreements.js";
export { automaticActions, automaticResult, type AutomaticAction, type AutomaticResult } from "./agreements.js";

/* --------------------------------- tree --------------------------------- */

export interface Rect { x1: number; y1: number; x2: number; y2: number }
export interface UiNode {
  i: number;
  parent: number | null;
  depth: number;
  id: string | null;
  type: string;
  key: string | null;
  text: string;
  rect: Rect | null;
  clickable: boolean | null;
  enabled: boolean | null;
  visible: boolean | null;
  checked: boolean | null;
  selected: boolean | null;
  focused: boolean | null;
  bundle: string | null;
  window: string | null;
  page: string | null;
}
export interface Selector {
  text?: string;
  exact?: boolean;
  key?: string;
  type?: string;
  id?: string;
  bundle?: string;
  clickable?: boolean;
  checked?: boolean;
  selected?: boolean;
  enabled?: boolean;
  index?: number;
}

function parseRect(value: unknown): Rect | null {
  if (typeof value !== "string") return null;
  const n = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!n || n.length < 4) return null;
  return { x1: Math.min(n[0]!, n[2]!), y1: Math.min(n[1]!, n[3]!), x2: Math.max(n[0]!, n[2]!), y2: Math.max(n[1]!, n[3]!) };
}
const flag = (v: unknown) => (v === true || v === "true" ? true : v === false || v === "false" ? false : null);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);

/** Flatten a uitest dumpLayout JSON tree iteratively (no recursion limits). */
export function flatten(raw: unknown): UiNode[] {
  const nodes: UiNode[] = [];
  const stack: { value: unknown; parent: number | null; depth: number; bundle: string | null; window: string | null }[] =
    [{ value: raw, parent: null, depth: 0, bundle: null, window: null }];
  while (stack.length) {
    const cur = stack.pop()!;
    if (Array.isArray(cur.value)) {
      for (let i = cur.value.length - 1; i >= 0; i--) stack.push({ ...cur, value: cur.value[i] });
      continue;
    }
    if (!cur.value || typeof cur.value !== "object") continue;
    const node = cur.value as Record<string, unknown>;
    const attrs = (node.attributes ?? node.$attrs ?? {}) as Record<string, unknown>;
    const type = String(node.$type ?? attrs.type ?? "");
    const bundle = str(attrs.bundleName) ?? cur.bundle;
    const window = str(attrs.windowId) ?? cur.window;
    const text = [attrs.text, attrs.content, attrs.label, attrs.accessibilityText, attrs.description]
      .find((v) => typeof v === "string" && v.trim()) as string | undefined;
    const index = nodes.length;
    nodes.push({
      i: index, parent: cur.parent, depth: cur.depth,
      id: str(attrs.id ?? node.$ID), type, key: str(attrs.key ?? attrs.id), text: text ?? "",
      rect: parseRect(node.$rect ?? attrs.bounds ?? attrs.rect),
      clickable: flag(attrs.clickable), enabled: flag(attrs.enabled), visible: flag(attrs.visible),
      checked: flag(attrs.checked ?? attrs.isChecked), selected: flag(attrs.selected ?? attrs.isSelected),
      focused: flag(attrs.focused), bundle, window, page: str(attrs.pagePath),
    });
    invariant(nodes.length <= 100000, "UI_TREE_TOO_LARGE", "UI tree exceeds 100000 nodes");
    const children = node.children ?? node.$children;
    if (Array.isArray(children))
      for (let i = children.length - 1; i >= 0; i--)
        stack.push({ value: children[i], parent: index, depth: cur.depth + 1, bundle, window });
  }
  return nodes;
}

export function select(nodes: UiNode[], s: Selector): UiNode[] {
  const text = s.text?.toLowerCase();
  const type = s.type?.toLowerCase();
  const hits = nodes.filter((n) =>
    (text === undefined || (s.exact ? n.text.toLowerCase() === text : n.text.toLowerCase().includes(text))) &&
    (s.key === undefined || n.key === s.key) &&
    (type === undefined || n.type.toLowerCase() === type) &&
    (s.id === undefined || n.id === s.id) &&
    (s.bundle === undefined || n.bundle === s.bundle) &&
    (s.clickable === undefined || n.clickable === s.clickable) &&
    (s.checked === undefined || n.checked === s.checked) &&
    (s.selected === undefined || n.selected === s.selected) &&
    (s.enabled === undefined || n.enabled === s.enabled) &&
    n.visible !== false && !!n.rect && n.rect.x2 > n.rect.x1 && n.rect.y2 > n.rect.y1,
  );
  return s.index !== undefined ? hits.slice(s.index, s.index + 1) : hits;
}

export function center(node: UiNode) {
  invariant(node.rect, "UI_NO_BOUNDS", "Node has no bounds");
  return { x: Math.round((node.rect.x1 + node.rect.x2) / 2), y: Math.round((node.rect.y1 + node.rect.y2) / 2) };
}

/** Compact line-per-node view: far fewer tokens than raw JSON. */
/** Nodes whose component id/key equals `id`, each with its whole subtree (upstream `layout --id`). */
export function subtree(nodes: UiNode[], id: string) {
  const roots = nodes.filter((n) => n.id === id || n.key === id);
  const keep = new Set<number>();
  for (const r of roots) {
    keep.add(r.i);
    for (const n of nodes) if (n.i > r.i && n.parent !== null && keep.has(n.parent)) keep.add(n.i);
  }
  return nodes.filter((n) => keep.has(n.i));
}

export function compact(nodes: UiNode[], options: { interactive?: boolean; limit?: number; bundle?: string; depth?: number } = {}) {
  const limit = options.limit ?? 300;
  const lines: string[] = [];
  for (const n of nodes) {
    if (options.bundle && n.bundle !== options.bundle) continue;
    // devecocli semantics: 0 = unlimited, 1 = root only, 2 = root + children (node depth is 0-based).
    if (options.depth && n.depth >= options.depth) continue;
    if (!n.rect || n.visible === false) continue;
    const interesting = n.text || n.key || n.clickable || /Button|Input|TextArea|Toggle|Checkbox|Radio|Slider|Search|Select|Tab/i.test(n.type);
    if (options.interactive && !interesting) continue;
    if (!interesting && !options.interactive && n.depth > 3 && !n.text) continue;
    const r = n.rect;
    const attrs = [
      n.key ? `key=${n.key}` : "",
      n.text ? `"${n.text.slice(0, 60)}"` : "",
      n.clickable ? "clickable" : "",
      n.checked ? "checked" : "",
      n.selected ? "selected" : "",
      n.enabled === false ? "disabled" : "",
      n.focused ? "focused" : "",
    ].filter(Boolean).join(" ");
    lines.push(`${"  ".repeat(Math.min(n.depth, 12))}#${n.i} ${n.type} [${r.x1},${r.y1},${r.x2},${r.y2}] ${attrs}`.trimEnd());
    if (lines.length >= limit) { lines.push(`… truncated at ${limit} nodes; filter with ui find`); break; }
  }
  return lines.join("\n");
}

/* ------------------------------ blank screen ------------------------------ */

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) -> grayscale. Enough for tiny on-device snapshots. */
export function pngGray(buf: Buffer): { width: number; height: number; gray: Uint8Array } | undefined {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return undefined;
  let offset = 8, width = 0, height = 0, colorType = 0, depth = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]!; colorType = data[9]!; if (data[12]) return undefined; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!channels || depth !== 8 || !width || !height || width * height > 4_000_000) return undefined;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : undefined;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels]! : 0, b = prev ? prev[i]! : 0, c = prev && i >= channels ? prev[i - channels]! : 0;
      const x = line[i]!;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[i] = (x + predictor) & 0xff;
    }
  }
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) gray[i] = (pixels[i * channels]! * 299 + pixels[i * channels + 1]! * 587 + pixels[i * channels + 2]! * 114) / 1000;
  return { width, height, gray };
}

/** A screen is blank when, ignoring status/navigation bars, ≥99.8% of pixels match the dominant shade. */
export function blankScore(image: { width: number; height: number; gray: Uint8Array }) {
  const top = Math.floor(image.height * 0.06), bottom = Math.floor(image.height * 0.96);
  const hist = new Uint32Array(256);
  for (let y = top; y < bottom; y++) for (let x = 0; x < image.width; x++) hist[image.gray[y * image.width + x]!]!++;
  const total = (bottom - top) * image.width;
  let peak = 0;
  for (let v = 0; v < 256; v++) if (hist[v]! > hist[peak]!) peak = v;
  let near = 0;
  for (let v = Math.max(0, peak - 6); v <= Math.min(255, peak + 6); v++) near += hist[v]!;
  const uniform = near / total;
  return { uniform: Math.round(uniform * 10000) / 10000, blank: uniform >= 0.998 };
}

/** Upstream `run` smoke parity (FAIL_BLANK): one tiny PNG snapshot, decoded in-process. */
export async function blankScreen(target: string, signal?: AbortSignal) {
  const remote = `/data/local/tmp/deveco-blank-${crypto.randomBytes(4).toString("hex")}.png`;
  const local = path.join(artifactDir(), `blank-${crypto.randomBytes(4).toString("hex")}.png`);
  try {
    const known = nativeSizes.get(target);
    const h = known ? Math.round((known.h * 128) / known.w) : 256;
    const shot = await shell(target, ["snapshot_display", "-f", remote, "-t", "png", "-w", "128", "-h", String(h)], signal, 20000);
    if (!/success/i.test(shot.stdout)) return undefined;
    await hdc(["-t", target, "file", "recv", remote, local], signal, 20000, true);
    const image = pngGray(fs.readFileSync(local));
    return image ? blankScore(image) : undefined;
  } catch {
    return undefined; // the smoke check is best-effort; never fail a launch because of it
  } finally {
    fs.rmSync(local, { force: true });
    await shell(target, ["rm", "-f", remote], undefined, 5000).catch(() => {}); // awaited: the host may exit right after this call
  }
}

/** Copy a produced file to a user-chosen absolute path (file, or directory => keep the name). */
export function saveCopy(file: string, target: string) {
  invariant(path.isAbsolute(target), "INVALID_INPUT", "save_path must be an absolute path");
  const dest = fs.existsSync(target) && fs.statSync(target).isDirectory() ? path.join(target, path.basename(file)) : target;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  return dest;
}

/* -------------------------------- windows -------------------------------- */

export interface WindowInfo { id: number; name: string; pid: number; display: number; type: number; focused: boolean; bounds?: number[]; visible: boolean }

/** Parse the `hidumper -s WindowManagerService -a -a` window table. */
export function parseWindows(raw: string): WindowInfo[] {
  const lines = raw.split("\n");
  const header = lines.findIndex((l) => l.trimStart().startsWith("WindowName"));
  if (header < 0) return [];
  const focus = Number(/Focus window:\s*(\d+)/.exec(raw)?.[1]);
  const out: WindowInfo[] = [];
  let visible = true;
  for (const line of lines.slice(header + 1)) {
    const t = line.trim();
    if (/^-{5,}$/.test(t)) { visible = false; continue; } // below the separator: hidden windows
    if (!t || /^(Focus window|All Focus|Total window)/.test(t)) break;
    const tok = t.split(/\s+/);
    if (tok.length < 5) continue;
    const [name, display, pid, id, type] = [tok[0]!, Number(tok[1]), Number(tok[2]), Number(tok[3]), Number(tok[4])];
    if (![display, pid, id, type].every(Number.isFinite)) continue;
    const rect = /\[\s*(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(t);
    out.push({ id, name, pid, display, type, focused: id === focus, visible, ...(rect ? { bounds: rect.slice(1, 5).map(Number) } : {}) });
  }
  return out;
}

export async function listWindows(target: string, all = false, signal?: AbortSignal) {
  const dump = await shell(target, ["hidumper", "-s", "WindowManagerService", "-a", "-a"], signal, 15000);
  const windows = parseWindows(dump.stdout);
  // Type 1 = application main window (upstream convention); system windows are 2000+.
  return all ? windows : windows.filter((w) => w.type < 2000 || w.focused);
}

/* ------------------------------- snapshots ------------------------------- */

const cache = new Map<string, { at: number; nodes: UiNode[] }>();
const nativeSizes = new Map<string, { w: number; h: number }>();

export async function dumpTree(target: string, signal?: AbortSignal, maxAgeMs = 0, scope: { window?: number; bundle?: string; all_windows?: boolean } = {}): Promise<UiNode[]> {
  if (scope.all_windows) {
    // Every window on every display (upstream --all-windows): one unmerged dump per display.
    invariant(scope.window === undefined, "INVALID_INPUT", "all_windows and window are mutually exclusive");
    const displays = [...new Set((await listWindows(target, true, signal)).map((w) => w.display))];
    const all: UiNode[] = [];
    for (const d of displays.length ? displays : [0]) {
      const part = await dumpRaw(target, ["-i", "-d", String(d)], signal);
      all.push(...part.map((n) => ({ ...n, i: n.i + all.length, parent: n.parent === null ? null : n.parent + all.length })));
    }
    return all;
  }
  const scoped = scope.window !== undefined || scope.bundle !== undefined;
  const hit = cache.get(target);
  if (!scoped && hit && Date.now() - hit.at <= maxAgeMs) return hit.nodes;
  const extra: string[] = [];
  if (scope.window !== undefined) extra.push("-w", String(scope.window));
  else if (scope.bundle && /^[\w.]+$/.test(scope.bundle)) extra.push("-b", scope.bundle);
  const nodes = await dumpRaw(target, extra, signal);
  if (!scoped) cache.set(target, { at: Date.now(), nodes });
  return nodes;
}

async function dumpRaw(target: string, extra: string[], signal?: AbortSignal): Promise<UiNode[]> {
  const remote = `/data/local/tmp/deveco-layout-${crypto.randomBytes(4).toString("hex")}.json`;
  const local = path.join(artifactDir(), `layout-${crypto.randomBytes(4).toString("hex")}.json`);
  try {
    const args = ["uitest", "dumpLayout", "-p", remote, ...extra];
    const dump = await shell(target, args, signal, 30000);
    if (/fail|error/i.test(dump.stdout) && !/DumpLayout saved/i.test(dump.stdout)) {
      await assertConnected(target, signal);
      throw new ToolError("UI_DUMP_FAILED", `uitest dumpLayout failed: ${dump.stdout.trim().slice(0, 300)}`, undefined, "Make sure the screen is on and unlocked");
    }
    await hdc(["-t", target, "file", "recv", remote, local], signal, 30000, true);
    if (!fs.existsSync(local)) { await assertConnected(target, signal); throw new ToolError("UI_DUMP_FAILED", "Layout file transfer failed"); }
    return flatten(JSON.parse(fs.readFileSync(local, "utf8")));
  } finally {
    fs.rmSync(local, { force: true });
    await shell(target, ["rm", "-f", remote], undefined, 5000).catch(() => {}); // awaited: the host may exit right after this call
  }
}
export function invalidate(target: string) {
  cache.delete(target);
}

export async function screenshot(target: string, options: { format?: "jpeg" | "png"; width?: number; display?: number; save_path?: string } = {}, signal?: AbortSignal) {
  const format = options.format ?? "jpeg";
  const remote = `/data/local/tmp/deveco-shot-${crypto.randomBytes(4).toString("hex")}.${format}`;
  const mime = format === "png" ? "image/png" : "image/jpeg";
  const id = `a_${crypto.randomBytes(8).toString("hex")}`;
  const local = path.join(artifactDir(), `${id}.${format === "png" ? "png" : "jpg"}`);
  try {
    const args = ["snapshot_display", "-f", remote, "-t", format, ...(options.display !== undefined ? ["-i", String(options.display)] : [])];
    // Downscale on-device: bytes drive token cost; ~1080px wide keeps text legible.
    // The native size is cached per device so a single capture is usually enough.
    const width = options.width ?? 1080;
    const known = nativeSizes.get(target);
    if (known && known.w > width) args.push("-w", String(width), "-h", String(Math.round((known.h * width) / known.w)));
    const probe = await shell(target, args, signal, 30000);
    if (!/success/i.test(probe.stdout)) await assertConnected(target, signal);
    invariant(/success/i.test(probe.stdout), "SCREENSHOT_FAILED", `snapshot_display failed: ${probe.stdout.trim().slice(0, 300)}`,
      undefined, "Screen may be off or locked; wake/unlock the device");
    const native = /process:[^\n]*?width:\s*(\d+)[^\n]*?height:\s*(\d+)/i.exec(probe.stdout) ?? /width:\s*(\d+)[^\n]*?height:\s*(\d+)/i.exec(probe.stdout);
    if (native) {
      const size = { w: Number(native[1]), h: Number(native[2]) };
      nativeSizes.set(target, size);
      if (!known && size.w > width)
        await shell(target, [...args, "-w", String(width), "-h", String(Math.round((size.h * width) / size.w))], signal, 30000);
    }
    await hdc(["-t", target, "file", "recv", remote, local], signal, 30000, true);
    if (!(fs.existsSync(local) && fs.statSync(local).size > 0)) await assertConnected(target, signal);
    invariant(fs.existsSync(local) && fs.statSync(local).size > 0, "SCREENSHOT_FAILED", "Screenshot transfer failed");
    const data = fs.readFileSync(local);
    const saved = options.save_path ? saveCopy(local, options.save_path) : undefined;
    if (saved) await trackExport(saved);
    const artifact = await commitArtifact(id, local, mime);
    return { artifact_id: artifact.artifact_id, bytes: artifact.bytes, mime, data: data.toString("base64"), ...(saved ? { saved } : {}) };
  } finally {
    await shell(target, ["rm", "-f", remote], undefined, 5000).catch(() => {}); // awaited: the host may exit right after this call
  }
}

/* -------------------------------- actions -------------------------------- */

export type Action =
  | { action: "click" | "double_click" | "long_click"; x: number; y: number }
  | { action: "swipe" | "drag" | "fling"; x: number; y: number; x2: number; y2: number; speed?: number }
  | { action: "scroll"; direction: "up" | "down" | "left" | "right"; speed?: number }
  | { action: "key"; key: string }
  | { action: "input"; x: number; y: number; text: string; append?: boolean }
  | { action: "type"; text: string }
  | { action: "keys"; keys: string[] }
  | { action: "mouse_click" | "mouse_double_click" | "mouse_long_click"; x: number; y: number; button?: "left" | "right" | "middle"; keys?: string[] }
  | { action: "mouse_move"; x: number; y: number }
  | { action: "mouse_scroll"; x: number; y: number; direction: "up" | "down"; ticks?: number; keys?: string[] }
  | { action: "mouse_drag"; x: number; y: number; x2: number; y2: number; speed?: number };

const keyAliases: Record<string, string> = { back: "Back", home: "Home", power: "Power", enter: "2054", delete: "2055", backspace: "2055", tab: "2049", menu: "2067", volume_up: "16", volume_down: "17" };
/** Keys usable in chords (OpenHarmony KeyCode values). */
const chordKeys: Record<string, number> = {
  ctrl: 2072, ctrl_left: 2072, ctrl_right: 2073, shift: 2047, shift_left: 2047, shift_right: 2048, alt: 2045, alt_left: 2045, alt_right: 2046,
  meta: 2076, win: 2076, enter: 2054, tab: 2049, space: 2050, esc: 2070, escape: 2070, delete: 2055, backspace: 2055, forward_delete: 2071,
  up: 2012, down: 2013, left: 2014, right: 2015, home: 2081, end: 2082, page_up: 2068, page_down: 2069,
  ...Object.fromEntries("abcdefghijklmnopqrstuvwxyz".split("").map((c, i) => [c, 2017 + i])),
  ...Object.fromEntries("0123456789".split("").map((c, i) => [c, 2000 + i])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, 2090 + i])),
};
export function chordCodes(keys: string[]): number[] {
  invariant(keys.length >= 1 && keys.length <= 3, "INVALID_INPUT", "keys: 1 to 3 keys, e.g. [\"ctrl\", \"c\"]");
  return keys.map((k) => {
    const code = /^\d{1,5}$/.test(k) ? Number(k) : chordKeys[k.toLowerCase()];
    invariant(code !== undefined, "INVALID_INPUT", `Unknown key ${k}`, { keys: Object.keys(chordKeys).slice(0, 40) });
    return code;
  });
}

/**
 * hdc joins shell arguments with spaces, so text is shipped base64-encoded and decoded on the device
 * (same approach as deveco-cli): spaces, quotes, `$` and newlines arrive intact.
 */
export function deviceText(text: string) {
  return `"$(printf '%s' '${Buffer.from(text, "utf8").toString("base64")}' | base64 -d)"`;
}

function uiInput(a: Action): string[] {
  switch (a.action) {
    case "click": return ["click", String(a.x), String(a.y)];
    case "double_click": return ["doubleClick", String(a.x), String(a.y)];
    case "long_click": return ["longClick", String(a.x), String(a.y)];
    case "swipe": return ["swipe", String(a.x), String(a.y), String(a.x2), String(a.y2), String(a.speed ?? 600)];
    case "drag": return ["drag", String(a.x), String(a.y), String(a.x2), String(a.y2), String(a.speed ?? 600)];
    case "fling": return ["fling", String(a.x), String(a.y), String(a.x2), String(a.y2), String(a.speed ?? 600)];
    case "scroll": return ["dircFling", String({ left: 0, right: 1, up: 2, down: 3 }[a.direction]), String(a.speed ?? 600)];
    case "key": {
      const key = keyAliases[a.key.toLowerCase()] ?? a.key;
      invariant(/^(Back|Home|Power|\d{1,5})$/.test(key), "INVALID_INPUT", `Unknown key ${a.key}`, { aliases: Object.keys(keyAliases) });
      return ["keyEvent", key];
    }
    case "type": return ["text", deviceText(a.text)];
    case "input": return ["inputText", String(a.x), String(a.y), deviceText(a.text)];
    case "keys": return ["keyEvent", ...chordCodes(a.keys).map(String)];
    default: throw new ToolError("INVALID_INPUT", `${a.action} is not a uiInput action`);
  }
}

/** Mouse actions go through the uitest agent (Driver.mouse*), as uiInput has no mouse commands. */
function mouseRequest(a: Extract<Action, { action: `mouse_${string}` }>): { api: string; args: unknown[] } {
  const point = (x: number, y: number) => ({ x, y });
  const mods = (a as { keys?: string[] }).keys ? chordCodes((a as { keys: string[] }).keys) : [];
  invariant(mods.length <= 2, "INVALID_INPUT", "Mouse actions take at most 2 modifier keys");
  switch (a.action) {
    case "mouse_click": case "mouse_double_click": case "mouse_long_click": {
      const api = { mouse_click: "Driver.mouseClick", mouse_double_click: "Driver.mouseDoubleClick", mouse_long_click: "Driver.mouseLongClick" }[a.action];
      return { api, args: [point(a.x, a.y), { left: 0, right: 1, middle: 2 }[a.button ?? "left"], ...mods] };
    }
    case "mouse_move": return { api: "Driver.mouseMoveTo", args: [point(a.x, a.y)] };
    case "mouse_scroll": return { api: "Driver.mouseScroll", args: [point(a.x, a.y), a.direction === "down", a.ticks ?? 3, mods[0] ?? 0, mods[1] ?? 0, 20] };
    case "mouse_drag": return { api: "Driver.mouseDrag", args: [point(a.x, a.y), point(a.x2, a.y2), a.speed ?? 600] };
  }
}

const uiInputOk = (out: string, code: number | null) => code === 0 && (!out || /No Error|success/i.test(out));

/** Shared by actions, batches and flows; observation alone stays read-only. */
export async function acceptAgreements(target: string, signal?: AbortSignal, initial?: UiNode[], settleMs = 0) {
  const { auto_accept_ui_agreements: agreements, auto_complete_ui_onboarding: onboarding } = config();
  if (!agreements && !onboarding) return { nodes: initial, accepted: [] as { text: string; kind: string }[] };
  const { resolveAgreements } = await import("./agreements.js");
  return resolveAgreements(initial ?? await dumpTree(target, signal, 1500), {
    settleMs, agreements, onboarding,
    read: async () => { await new Promise((r) => setTimeout(r, 500)); invalidate(target); return dumpTree(target, signal); },
    click: async (node) => {
      const point = center(node);
      const r = await shell(target, ["uitest", "uiInput", "click", String(point.x), String(point.y)], signal, 15000);
      invariant(uiInputOk((r.stdout + r.stderr).trim(), r.code), "UI_ACTION_FAILED", "Automatic UI click failed");
      invalidate(target);
    },
  }, signal);
}

export async function act(target: string, a: Action, signal?: AbortSignal) {
  const consent = await acceptAgreements(target, signal);
  const completed = async (result: { performed: string; method?: string }) => {
    consent.accepted.push(...(await acceptAgreements(target, signal, undefined, 1000)).accepted);
    return { ...result, ...automaticResult(consent.accepted) };
  };
  invalidate(target);
  if (a.action === "input" && !a.append) {
    // Replace semantics (what hosts expect): focus, select all (Ctrl+A), delete.
    for (const args of [["click", String(a.x), String(a.y)], ["keyEvent", "2072", "2017"], ["keyEvent", "2055"]]) {
      const r = await shell(target, ["uitest", "uiInput", ...args], signal, 15000);
      invariant(uiInputOk((r.stdout + r.stderr).trim(), r.code), "UI_ACTION_FAILED", `Clearing the field failed: ${r.stdout.trim()}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (args[0] === "click") consent.accepted.push(...(await acceptAgreements(target, signal, undefined, 1000)).accepted);
    }
  }
  if (a.action === "input" && /[^\x20-\x7e]|['"`]/.test(a.text)) {
    // uitest inputText drops non-ASCII (Chinese) text, and typed quotes go through the IME's smart
    // punctuation (' -> ‘’); the hypium agent pastes the exact text instead.
    const text = a.text, point = { x: a.x, y: a.y };
    await withAgent(target, signal, async (call, driver) => { await call("Driver.inputText", driver, [point, text, { paste: true }]); });
    return completed({ performed: a.action, method: "uitest-agent-paste" });
  }
  if (a.action.startsWith("mouse_")) {
    const request = mouseRequest(a as Extract<Action, { action: `mouse_${string}` }>);
    await withAgent(target, signal, async (call, driver) => { await call(request.api, driver, request.args); });
    return completed({ performed: a.action, method: "uitest-agent" });
  }
  // One command string: hdc passes it to the device shell as-is, so deviceText()'s $(...) expands there.
  const result = await shell(target, [["uitest", "uiInput", ...uiInput(a)].join(" ")], signal, 30000);
  const out = (result.stdout + result.stderr).trim();
  invariant(uiInputOk(out, result.code), "UI_ACTION_FAILED", `uiInput ${a.action} failed: ${out.slice(0, 300)}`);
  return completed({ performed: a.action });
}

/** Stable signature of what is on screen (type, text, bounds of labelled/interactive nodes). */
export function treeSignature(nodes: UiNode[]) {
  const parts = nodes.filter((n) => n.text || n.clickable || n.key).map((n) => `${n.type}|${n.text}|${n.rect ? Object.values(n.rect).join(",") : ""}|${n.checked ?? ""}|${n.selected ?? ""}`);
  return crypto.createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 16);
}

/* ------------------------- non-ASCII text via uitest agent ------------------------- */

type AgentCall = (api: string, self: string, args: unknown[]) => Promise<unknown>;
/** Connect to the uitest hypium agent (starting it if needed), create a Driver, run fn, clean up. */
async function withAgent(target: string, signal: AbortSignal | undefined, fn: (call: AgentCall, driver: string) => Promise<void>) {
  const machine = (await shell(target, ["uname", "-m"], signal)).stdout.trim();
  const unix = machine !== "x86_64";
  const asset = unix ? "uitest_agent_v1.2.2.so" : "uitest_agent_v1.1.9.x86_64.so";
  const endpoint = unix ? "localabstract:uitest_socket" : "tcp:8012";
  const ready = async () => unix
    ? /@uitest_socket\s*$/m.test((await shell(target, ["cat", "/proc/net/unix"], signal)).stdout)
    : /[:.]8012\s+.*LISTEN/.test((await shell(target, ["netstat", "-an"], signal)).stdout);
  let remote: string | undefined;
  let forward: string | undefined;
  let socket: net.Socket | undefined;
  try {
    if (!(await ready())) {
      const name = `deveco-agent-${crypto.randomBytes(4).toString("hex")}.so`;
      remote = `/data/local/tmp/${name}`;
      await hdc(["-t", target, "file", "send", path.join(packageRoot, "resources/native/hypium", asset), remote], signal, 30000);
      await shell(target, ["uitest", "start-daemon", "singleness", "--extension-name", name], signal);
      const deadline = Date.now() + 5000;
      while (!(await ready())) {
        invariant(Date.now() < deadline, "UI_AGENT_START", "UiTest agent did not become ready");
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer().listen(0, "127.0.0.1", () => {
        const address = server.address();
        server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
      });
      server.once("error", reject);
    });
    forward = `tcp:${port}`;
    await hdc(["-t", target, "fport", forward, endpoint], signal, 10000);
    socket = net.createConnection({ host: "127.0.0.1", port, ...(signal ? { signal } : {}) });
    // Keep resets between sequential calls from becoming unhandled process errors.
    socket.on("error", () => {});
    await new Promise<void>((resolve, reject) => {
      const connected = () => { socket!.off("error", failed); resolve(); };
      const failed = (error: Error) => { socket!.off("connect", connected); socket!.off("error", failed); reject(error); };
      socket!.once("connect", connected); socket!.once("error", failed);
    });
    const active = socket;
    const driver = await agentRpc(active, "Driver.create", "", [], signal);
    invariant(typeof driver === "string", "UI_AGENT_FAILED", "Invalid driver reference");
    await fn((api, self, args) => agentRpc(active, api, self, args, signal), driver);
  } finally {
    socket?.destroy();
    if (forward) await hdc(["-t", target, "fport", "rm", forward, endpoint], undefined, 5000, true).catch(() => {});
    if (remote) await shell(target, ["rm", "-f", remote], undefined, 5000).catch(() => {}); // awaited: the host may exit right after this call
  }
}

export function agentRpc(socket: net.Socket, api: string, self: string, args: unknown[], signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  if (socket.destroyed) return Promise.reject(new ToolError("UI_AGENT_CLOSED", "UiTest agent connection is closed; action was not sent"));
  return new Promise((resolve, reject) => {
    let raw = "";
    let settled = false;
    const decoder = new StringDecoder("utf8");
    const timer = setTimeout(() => done(new ToolError("UI_AGENT_TIMEOUT", "UiTest agent timed out")), 15000);
    const done = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", failed);
      socket.off("close", closed);
      signal?.removeEventListener("abort", aborted);
      error ? reject(error) : resolve(value);
    };
    const failed = (error: Error) => done(new ToolError("UI_AGENT_CONNECTION", `UiTest agent ${api} disconnected; outcome is unknown`, { cause: error.message }, "Inspect the UI before another action; sent actions are never replayed automatically"));
    const closed = () => failed(new Error("socket closed"));
    const aborted = () => { done(new ToolError("CANCELLED", "UiTest agent call cancelled; sent action outcome may be unknown")); socket.destroy(); };
    const onData = (chunk: Buffer) => {
      raw += decoder.write(chunk);
      try {
        const reply = JSON.parse(raw) as { result?: unknown; exception?: unknown };
        if (reply.exception) done(new ToolError("UI_AGENT_FAILED", `${api} failed: ${JSON.stringify(reply.exception).slice(0, 300)}`));
        else done(undefined, reply.result);
      } catch { /* wait for more */ }
    };
    socket.on("data", onData);
    socket.once("error", failed);
    socket.once("close", closed);
    signal?.addEventListener("abort", aborted, { once: true });
    socket.write(JSON.stringify({ module: "com.ohos.devicetest.hypiumApiHelper", method: "callHypiumApi", params: { api, this: self, args, message_type: "hypium" }, request_id: crypto.randomUUID() }), (error) => { if (error) failed(error); });
  });
}

/* ------------------------------ assertions ------------------------------ */

export async function waitFor(target: string, selector: Selector, state: "visible" | "hidden", timeoutMs: number, signal?: AbortSignal, autoAccept = false) {
  const deadline = Date.now() + timeoutMs;
  let last: UiNode[] = [];
  const accepted: { text: string; kind: string }[] = [];
  for (;;) {
    signal?.throwIfAborted();
    let nodes = await dumpTree(target, signal);
    if (autoAccept) {
      const consent = await acceptAgreements(target, signal, nodes);
      nodes = consent.nodes ?? nodes;
      accepted.push(...consent.accepted);
    }
    last = select(nodes, selector);
    const ok = state === "visible" ? last.length > 0 : last.length === 0;
    const result = { passed: ok, state, matches: last.slice(0, 3).map(describe), ...automaticResult(accepted) };
    if (ok || Date.now() >= deadline) return result;
    await new Promise((r) => setTimeout(r, 400));
  }
}

export function describe(n: UiNode) {
  return { node: n.i, type: n.type, text: n.text || undefined, key: n.key ?? undefined, bounds: n.rect ? [n.rect.x1, n.rect.y1, n.rect.x2, n.rect.y2] : undefined, clickable: n.clickable ?? undefined };
}

/**
 * One node for a selector, the same rule for ui act and act steps: a single match, the single
 * clickable one, an explicit index, or - when every match carries the same label (a section title
 * repeated on a card, a tab label and its column) - the top-most. Undefined when still ambiguous. Pure.
 */
export function pickMatch(matches: UiNode[], selector: Selector) {
  if (matches.length === 1 || selector.index !== undefined) return matches[0];
  const clickable = matches.filter((m) => m.clickable);
  if (clickable.length === 1) return clickable[0];
  if (matches.length > 1 && matches.every((m) => m.text === matches[0]!.text))
    return [...matches].sort((a, b) => a.rect!.y1 - b.rect!.y1 || a.rect!.x1 - b.rect!.x1)[0];
  return undefined;
}

/** Resolve a selector to exactly one node (or explain ambiguity). */
export async function resolveOne(target: string, selector: Selector, signal?: AbortSignal) {
  let matches = select(await dumpTree(target, signal, 1500), selector);
  // A cached tree can predate a transition: never fail on it without one fresh look.
  if (!matches.length && cache.has(target)) { invalidate(target); matches = select(await dumpTree(target, signal), selector); }
  invariant(matches.length > 0, "UI_NOT_FOUND", "No element matches the selector", { selector },
    "Call ui observe to see current elements; the page may still be loading");
  const hit = pickMatch(matches, selector);
  if (!hit) throw new ToolError("UI_AMBIGUOUS", `${matches.length} elements match; refine selector or pass index`, { candidates: matches.slice(0, 8).map(describe) });
  return hit;
}

export async function saveTree(nodes: UiNode[]) {
  return saveArtifact(JSON.stringify(nodes), "application/json");
}

/* ------------------------------ screen recording ------------------------------ */
// The system screen recorder is toggled via its service ability (same protocol as deveco-cli):
// start with a CustomizedFileName, stop by toggling again, then export via mediatool.
const RECORDER_BUNDLE = "com.huawei.hmos.screenrecorder";
const RECORDER = ["-b", RECORDER_BUNDLE, "-a", `${RECORDER_BUNDLE}.ServiceExtAbility`];
interface Recording { name: string; started: number; recorder?: string; stopping?: boolean }

// Session state lives in SQLite so a restarted server can still stop/retrieve a recording.
async function session(target: string): Promise<Recording | undefined> {
  const { kvGet } = await import("../core/db.js");
  const raw = await kvGet(`screenrecord:${target}`);
  return raw ? (JSON.parse(raw) as Recording) : undefined;
}
async function setSession(target: string, value: Recording | undefined, expectedName?: string) {
  const { kvSet, database } = await import("../core/db.js");
  if (value) await kvSet(`screenrecord:${target}`, JSON.stringify(value));
  else (await database()).prepare("DELETE FROM kv WHERE key=? AND json_extract(value,'$.name')=?").run(`screenrecord:${target}`, expectedName!);
}

/** Parse an identified service instance; an empty/error/truncated dump is never idle evidence. */
export function recorderInstance(output: string, activeOnly = false) {
  invariant(/ExtensionRecords|AbilityRecord ID/.test(output) && !/\[(?:Fail|E\d+)\]|\berror\b/i.test(output), "UI_RECORD_FAILED", "Cannot read recorder state", { output: output.slice(0, 500) });
  const blocks: string[][] = [];
  for (const line of output.split(/\r?\n/)) {
    if (/^\s*uri \[/.test(line)) {
      invariant(/^\s*uri \[[^\]]+\]\s*$/.test(line), "UI_RECORD_FAILED", "Truncated recorder state");
      blocks.push([line]);
    } else blocks.at(-1)?.push(line);
  }
  invariant(blocks.length > 0 || !/AbilityRecord ID/.test(output), "UI_RECORD_FAILED", "Recorder dump is missing its URI blocks");
  const instances = [];
  for (const lines of blocks) {
    const block = lines.join("\n");
    const uri = /uri \[([^\]]+)\]/.exec(block)![1]!.split("/").filter(Boolean);
    const id = /AbilityRecord ID\s*[#:]\s*(\d+)/.exec(block)?.[1];
    const started = /start time \[(\d+)\]/.exec(block)?.[1];
    invariant(id && started && /state #\w+/.test(block), "UI_RECORD_FAILED", "Incomplete recorder instance identity");
    if (uri[0] !== RECORDER_BUNDLE || !["ServiceExtAbility", `${RECORDER_BUNDLE}.ServiceExtAbility`].includes(uri.at(-1)!)) continue;
    instances.push({ id: `${id}:${started}`, active: /state #ACTIVE\b/.test(block) });
  }
  invariant(instances.length <= 1, "CONFLICT", "Multiple screen recorder instances; state is ambiguous");
  return instances[0] && (!activeOnly || instances[0].active) ? instances[0].id : undefined;
}
async function recorderActive(target: string, signal?: AbortSignal, activeOnly = false) {
  const dump = await shell(target, ["aa", "dump", "-e"], signal, 15000);
  invariant(dump.code === 0, "UI_RECORD_FAILED", "Cannot query recorder state", { output: dump.stdout + dump.stderr });
  return recorderInstance(dump.stdout + dump.stderr, activeOnly);
}
/** Service disappearance allows export; only the exported MP4 proves finalization. */
async function waitRecorderIdle(target: string, timeoutMs: number, signal?: AbortSignal, expected?: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = await recorderActive(target, signal);
    if (!active) return true;
    invariant(!expected || active === expected, "CONFLICT", "A different recorder instance is running; it was not stopped");
    await delay(500, undefined, { signal });
  }
  return false;
}

export async function recordingStatus(target: string, signal?: AbortSignal) {
  const [active, current] = await Promise.all([recorderActive(target, signal), session(target)]);
  const status = active ? (current?.recorder === active ? "recording" : "busy") : "idle";
  return {
    status,
    ...(current ? { file: current.name, seconds: Math.round((Date.now() - current.started) / 1000) } : {}),
    note: status === "busy" ? "Recorder ownership is unknown or external; this server will not toggle it"
      : status === "idle" && current ? "Recording ended outside this server; record_stop retrieves the file" : undefined,
  };
}

export async function startRecording(target: string, signal?: AbortSignal) {
  invariant(!(await session(target)), "CONFLICT", "This server already owns a recording or pending export", undefined, "Use record_stop to retrieve it, or discard=true before starting another recording");
  invariant(await waitRecorderIdle(target, 6000, signal), "CONFLICT", "Screen recorder is busy", undefined, "Stop an external recording explicitly with record_stop external=true");
  const name = `devecomcp-${Date.now()}-${crypto.randomBytes(2).toString("hex")}.mp4`;
  const current: Recording = { name, started: Date.now() };
  // Persist intent before the toggle, so interruption cannot lose the pending recording.
  const { database } = await import("../core/db.js");
  const claimed = (await database()).prepare("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING").run(`screenrecord:${target}`, JSON.stringify(current));
  invariant(claimed.changes === 1, "CONFLICT", "Another recording session already owns this target");
  const result = await shell(target, ["aa", "start", ...RECORDER, "--ps", "CustomizedFileName", name], signal, 15000);
  invariant(result.code === 0 && /success/i.test(result.stdout) && !/fail|error/i.test(result.stdout + result.stderr), "UI_RECORD_FAILED", `Screen recorder start was not confirmed: ${(result.stdout + result.stderr).trim().slice(0, 200)}`,
    undefined, /10106102|screen is locked/i.test(result.stdout)
      ? "The device screen is locked (with a passcode it cannot be unlocked remotely): ask the user to unlock the device, then retry"
      : "Screen recording needs a real device with the system recorder (not available on some emulators)");
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const recorder = await recorderActive(target, signal, true);
    if (recorder) {
      await setSession(target, { ...current, recorder });
      return { recording: true, file: name, note: "Recorder service confirmed; record_stop must retrieve and validate the MP4" };
    }
    await delay(250, undefined, { signal });
  }
  throw new ToolError("UI_RECORD_FAILED", "Start command was accepted but no recorder service appeared; session retained", { file: name },
    "Inspect device recorder logs and consent/setup UI. No video is verified; do not blindly repeat record_start");
}

export async function stopRecording(target: string, options: { discard?: boolean; external?: boolean; save_path?: string } = {}, signal?: AbortSignal) {
  const current = await session(target);
  const active = await recorderActive(target, signal);
  if (!current) {
    invariant(options.external, "NOT_FOUND", "No recording started by this server on this device", undefined,
      active ? "A foreign recording is running: pass external=true to stop it (its file is not downloaded)" : undefined);
    if (active) await shell(target, ["aa", "start", ...RECORDER], signal, 15000);
    invariant(!active || await waitRecorderIdle(target, 10000, signal, active), "UI_RECORD_FAILED", "External recorder did not stop");
    return { stopped: !!active, downloaded: false, idle: true };
  }
  invariant(!active || active === current.recorder, "CONFLICT", "Active recorder does not match the saved session; it was not stopped", { file: current.name });
  if (active && !current.stopping) {
    const { database } = await import("../core/db.js");
    const updated = (await database()).prepare("UPDATE kv SET value=? WHERE key=? AND value=?")
      .run(JSON.stringify({ ...current, stopping: true }), `screenrecord:${target}`, JSON.stringify(current));
    invariant(updated.changes === 1, "CONFLICT", "Recording session changed during stop");
    await shell(target, ["aa", "start", ...RECORDER], signal, 15000);
  }
  invariant(await waitRecorderIdle(target, 10000, signal, current.recorder), "UI_RECORD_FAILED", "Recorder has not stopped; session retained, stop toggle will not be repeated");
  if (options.discard) { await setSession(target, undefined, current.name); return { stopped: true, discarded: current.name, note: "Any media file remains in the device gallery" }; }
  // The file appears in the media library after the recorder finalizes it.
  let uri: string | undefined;
  for (let i = 0; i < 20 && !uri; i++) {
    await delay(500, undefined, { signal });
    const query = await shell(target, ["mediatool", "query", current.name, "-u"], signal, 10000);
    invariant(query.code === 0, "UI_RECORD_FAILED", "Media query failed", { output: query.stdout + query.stderr });
    uri = recordingUri(query.stdout + query.stderr);
  }
  invariant(uri, "UI_RECORD_FAILED", "Recording was not found in the media library");
  const id = `a_${crypto.randomBytes(8).toString("hex")}`;
  const staging = `/data/local/tmp/${id}-${current.name}`;
  const local = path.join(artifactDir(), `${id}.mp4`);
  let failure: unknown;
  try {
    const exported = await shell(target, ["mediatool", "recv", uri, staging], signal, 120000);
    invariant(exported.code === 0 && exported.stdout.includes(staging) && !/\[FAIL\]|\berror\b/i.test(exported.stdout + exported.stderr), "UI_RECORD_FAILED", `Export failed: ${(exported.stdout + exported.stderr).trim().slice(0, 400)}`,
      { file: current.name, uri }, "Session retained; no video recovered. An unreadable or empty source is not proof that media export is unsupported. Inspect recorder/media logs before retrying; discard=true explicitly releases the receipt");
    await hdc(["-t", target, "file", "recv", staging, local], signal, 120000);
    invariant(mp4Video(fs.readFileSync(local)), "UI_RECORD_FAILED", "Export is not a finalized MP4 video; recording session retained");
  } catch (error) {
    failure = error;
  }
  try {
    const cleaned = await shell(target, ["rm", "-f", staging], undefined, 5000); // cleanup must survive caller cancellation
    invariant(cleaned.code === 0 && !/fail|error|denied/i.test(cleaned.stdout + cleaned.stderr), "UI_RECORD_FAILED", "Cannot remove recording staging file", { staging, output: cleaned.stdout + cleaned.stderr });
  } catch (error) {
    failure = failure ? new ToolError("UI_RECORD_FAILED", "Recording export and staging cleanup both failed; session retained", { export: errorResult(failure), cleanup: errorResult(error), staging }) : error;
  }
  if (failure) { fs.rmSync(local, { force: true }); throw failure; }
  const copy = options.save_path ? saveCopy(local, options.save_path) : undefined;
  if (copy) await trackExport(copy);
  const artifact = await commitArtifact(id, local, "video/mp4");
  await setSession(target, undefined, current.name);
  return { saved: copy ?? local, bytes: artifact.bytes, seconds: Math.round((Date.now() - current.started) / 1000), artifact_id: artifact.artifact_id };
}

/** A filename must resolve to exactly one media entry; never select the first ambiguous URI. */
export function recordingUri(output: string) {
  const count = /find\s+(\d+)\s+result/i.exec(output)?.[1];
  invariant(count !== undefined && !/\[FAIL\]|\berror\b/i.test(output), "UI_RECORD_FAILED", "Cannot parse media lookup", { output: output.slice(0, 500) });
  const uris = [...output.matchAll(/"(file:\/\/[^"]+)"/g)].map((m) => m[1]!);
  invariant(Number(count) <= 1 && uris.length <= 1, "CONFLICT", "Recording filename matches multiple media entries");
  invariant(Number(count) === uris.length, "UI_RECORD_FAILED", "Incomplete media lookup");
  return uris[0];
}

/** Container sanity check; codec playback is verified separately on the target environment. */
export function mp4Video(bytes: Buffer) {
  const boxes: { type: string; body: Buffer }[] = [];
  for (let offset = 0; offset < bytes.length;) {
    if (bytes.length - offset < 8) return false;
    let size = bytes.readUInt32BE(offset), header = 8;
    if (size === 1) { if (bytes.length - offset < 16) return false; const big = bytes.readBigUInt64BE(offset + 8); if (big > BigInt(Number.MAX_SAFE_INTEGER)) return false; size = Number(big); header = 16; }
    if (size === 0) size = bytes.length - offset;
    if (size < header || offset + size > bytes.length) return false;
    boxes.push({ type: bytes.toString("ascii", offset + 4, offset + 8), body: bytes.subarray(offset + header, offset + size) }); offset += size;
  }
  return boxes.some((b) => b.type === "ftyp") && boxes.some((b) => b.type === "mdat" && b.body.length > 0)
    && boxes.some((b) => b.type === "moov" && b.body.includes(Buffer.from("vide")));
}
