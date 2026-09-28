import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { artifactDir, commitArtifact, saveArtifact } from "../core/artifacts.js";
import { packageRoot } from "../core/config.js";
import { invariant, ToolError } from "../core/errors.js";
import { hdc, shell } from "./device.js";

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
export function compact(nodes: UiNode[], options: { interactive?: boolean; limit?: number; bundle?: string } = {}) {
  const limit = options.limit ?? 300;
  const lines: string[] = [];
  for (const n of nodes) {
    if (options.bundle && n.bundle !== options.bundle) continue;
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

/* ------------------------------- snapshots ------------------------------- */

const cache = new Map<string, { at: number; nodes: UiNode[] }>();
const nativeSizes = new Map<string, { w: number; h: number }>();

export async function dumpTree(target: string, signal?: AbortSignal, maxAgeMs = 0): Promise<UiNode[]> {
  const hit = cache.get(target);
  if (hit && Date.now() - hit.at <= maxAgeMs) return hit.nodes;
  const remote = `/data/local/tmp/deveco-layout-${crypto.randomBytes(4).toString("hex")}.json`;
  const local = path.join(artifactDir(), `layout-${crypto.randomBytes(4).toString("hex")}.json`);
  try {
    const dump = await shell(target, ["uitest", "dumpLayout", "-p", remote], signal, 30000);
    invariant(!/fail|error/i.test(dump.stdout) || /DumpLayout saved/i.test(dump.stdout), "UI_DUMP_FAILED", `uitest dumpLayout failed: ${dump.stdout.trim().slice(0, 300)}`,
      undefined, "Make sure the screen is on and unlocked");
    await hdc(["-t", target, "file", "recv", remote, local], signal, 30000, true);
    invariant(fs.existsSync(local), "UI_DUMP_FAILED", "Layout file transfer failed");
    const nodes = flatten(JSON.parse(fs.readFileSync(local, "utf8")));
    cache.set(target, { at: Date.now(), nodes });
    return nodes;
  } finally {
    fs.rmSync(local, { force: true });
    void shell(target, ["rm", "-f", remote]).catch(() => {});
  }
}
export function invalidate(target: string) {
  cache.delete(target);
}

export async function screenshot(target: string, options: { format?: "jpeg" | "png"; width?: number } = {}, signal?: AbortSignal) {
  const format = options.format ?? "jpeg";
  const remote = `/data/local/tmp/deveco-shot-${crypto.randomBytes(4).toString("hex")}.${format}`;
  const mime = format === "png" ? "image/png" : "image/jpeg";
  const id = `a_${crypto.randomBytes(8).toString("hex")}`;
  const local = path.join(artifactDir(), `${id}.${format === "png" ? "png" : "jpg"}`);
  try {
    const args = ["snapshot_display", "-f", remote, "-t", format];
    // Downscale on-device: bytes drive token cost; ~1080px wide keeps text legible.
    // The native size is cached per device so a single capture is usually enough.
    const width = options.width ?? 1080;
    const known = nativeSizes.get(target);
    if (known && known.w > width) args.push("-w", String(width), "-h", String(Math.round((known.h * width) / known.w)));
    const probe = await shell(target, args, signal, 30000);
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
    invariant(fs.existsSync(local) && fs.statSync(local).size > 0, "SCREENSHOT_FAILED", "Screenshot transfer failed");
    const artifact = await commitArtifact(id, local, mime);
    return { artifact_id: artifact.artifact_id, bytes: artifact.bytes, mime, data: fs.readFileSync(local).toString("base64") };
  } finally {
    void shell(target, ["rm", "-f", remote]).catch(() => {});
  }
}

/* -------------------------------- actions -------------------------------- */

export type Action =
  | { action: "click" | "double_click" | "long_click"; x: number; y: number }
  | { action: "swipe" | "drag" | "fling"; x: number; y: number; x2: number; y2: number; speed?: number }
  | { action: "scroll"; direction: "up" | "down" | "left" | "right"; speed?: number }
  | { action: "key"; key: string }
  | { action: "input"; x: number; y: number; text: string; append?: boolean }
  | { action: "type"; text: string };

const keyAliases: Record<string, string> = { back: "Back", home: "Home", power: "Power", enter: "2054", delete: "2055", backspace: "2055", tab: "2049", menu: "2067", volume_up: "16", volume_down: "17" };

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
    case "type": return ["text", a.text];
    case "input": return ["inputText", String(a.x), String(a.y), a.text];
  }
}

const uiInputOk = (out: string, code: number | null) => code === 0 && (!out || /No Error|success/i.test(out));

export async function act(target: string, a: Action, signal?: AbortSignal) {
  invalidate(target);
  if (a.action === "input" && !a.append) {
    // Replace semantics (what hosts expect): focus, select all (Ctrl+A), delete.
    for (const args of [["click", String(a.x), String(a.y)], ["keyEvent", "2072", "2017"], ["keyEvent", "2055"]]) {
      const r = await shell(target, ["uitest", "uiInput", ...args], signal, 15000);
      invariant(uiInputOk((r.stdout + r.stderr).trim(), r.code), "UI_ACTION_FAILED", `Clearing the field failed: ${r.stdout.trim()}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (a.action === "input" && /[^\x20-\x7e]/.test(a.text)) {
    // uitest inputText drops non-ASCII (Chinese) text; the hypium agent pastes it reliably.
    await nativeInputText(target, { x: a.x, y: a.y }, a.text, signal);
    return { performed: a.action, method: "uitest-agent-paste" };
  }
  const result = await shell(target, ["uitest", "uiInput", ...uiInput(a)], signal, 30000);
  const out = (result.stdout + result.stderr).trim();
  invariant(uiInputOk(out, result.code), "UI_ACTION_FAILED", `uiInput ${a.action} failed: ${out.slice(0, 300)}`);
  return { performed: a.action };
}

/* ------------------------- non-ASCII text via uitest agent ------------------------- */

async function nativeInputText(target: string, point: { x: number; y: number }, text: string, signal?: AbortSignal) {
  const machine = (await shell(target, ["uname", "-m"], signal)).stdout.trim();
  const unix = machine !== "x86_64";
  const asset = unix ? "uitest_agent_v1.2.2.so" : "uitest_agent_v1.1.9.x86_64.so";
  const endpoint = unix ? "localabstract:uitest_socket" : "tcp:8012";
  const ready = async () => unix
    ? /@uitest_socket\s*$/m.test((await shell(target, ["cat", "/proc/net/unix"], signal)).stdout)
    : /[:.]8012\s+.*LISTEN/.test((await shell(target, ["netstat", "-an"], signal)).stdout);
  let remote: string | undefined;
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
  });
  const forward = `tcp:${port}`;
  await hdc(["-t", target, "fport", forward, endpoint], signal, 10000);
  const socket = net.createConnection({ host: "127.0.0.1", port });
  try {
    const driver = await rpc(socket, "Driver.create", "", []);
    invariant(typeof driver === "string", "UI_AGENT_FAILED", "Invalid driver reference");
    await rpc(socket, "Driver.inputText", driver, [point, text, { paste: true }]);
  } finally {
    socket.destroy();
    await hdc(["-t", target, "fport", "rm", forward, endpoint], undefined, 5000, true).catch(() => {});
    if (remote) void shell(target, ["rm", "-f", remote]).catch(() => {});
  }
}

function rpc(socket: net.Socket, api: string, self: string, args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    const timer = setTimeout(() => done(new ToolError("UI_AGENT_TIMEOUT", "UiTest agent timed out")), 15000);
    const done = (error?: Error, value?: unknown) => {
      clearTimeout(timer);
      socket.off("data", onData);
      error ? reject(error) : resolve(value);
    };
    const onData = (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      try {
        const reply = JSON.parse(raw) as { result?: unknown; exception?: unknown };
        if (reply.exception) done(new ToolError("UI_AGENT_FAILED", `${api} failed: ${JSON.stringify(reply.exception).slice(0, 300)}`));
        else done(undefined, reply.result);
      } catch { /* wait for more */ }
    };
    socket.on("data", onData);
    socket.once("error", (e) => done(e));
    socket.write(JSON.stringify({ module: "com.ohos.devicetest.hypiumApiHelper", method: "callHypiumApi", params: { api, this: self, args, message_type: "hypium" }, request_id: crypto.randomUUID() }));
  });
}

/* ------------------------------ assertions ------------------------------ */

export async function waitFor(target: string, selector: Selector, state: "visible" | "hidden", timeoutMs: number, signal?: AbortSignal) {
  const deadline = Date.now() + timeoutMs;
  let last: UiNode[] = [];
  for (;;) {
    signal?.throwIfAborted();
    last = select(await dumpTree(target, signal), selector);
    const ok = state === "visible" ? last.length > 0 : last.length === 0;
    if (ok) return { passed: true, state, matches: last.slice(0, 3).map(describe) };
    if (Date.now() >= deadline) return { passed: false, state, matches: last.slice(0, 3).map(describe) };
    await new Promise((r) => setTimeout(r, 400));
  }
}

export function describe(n: UiNode) {
  return { node: n.i, type: n.type, text: n.text || undefined, key: n.key ?? undefined, bounds: n.rect ? [n.rect.x1, n.rect.y1, n.rect.x2, n.rect.y2] : undefined, clickable: n.clickable ?? undefined };
}

/** Resolve a selector to exactly one node (or explain ambiguity). */
export async function resolveOne(target: string, selector: Selector, signal?: AbortSignal) {
  const matches = select(await dumpTree(target, signal, 1500), selector);
  invariant(matches.length > 0, "UI_NOT_FOUND", "No element matches the selector", { selector },
    "Call ui observe to see current elements; the page may still be loading");
  if (matches.length > 1 && selector.index === undefined) {
    // Prefer clickable matches when ambiguous.
    const clickable = matches.filter((m) => m.clickable);
    if (clickable.length === 1) return clickable[0]!;
    throw new ToolError("UI_AMBIGUOUS", `${matches.length} elements match; refine selector or pass index`, { candidates: matches.slice(0, 8).map(describe) });
  }
  return matches[0]!;
}

export async function saveTree(nodes: UiNode[]) {
  return saveArtifact(JSON.stringify(nodes), "application/json");
}

/* ------------------------------ screen recording ------------------------------ */
// The system screen recorder is toggled via its service ability (same protocol as deveco-cli):
// start with a CustomizedFileName, stop by toggling again, then export via mediatool.
const RECORDER = ["-b", "com.huawei.hmos.screenrecorder", "-a", "com.huawei.hmos.screenrecorder.ServiceExtAbility"];
const recordings = new Map<string, { name: string; started: number }>();

export async function startRecording(target: string, signal?: AbortSignal) {
  invariant(!recordings.has(target), "CONFLICT", "A recording is already running on this device", undefined, "Stop it with ui action=record_stop");
  const name = `devecomcp-${Date.now()}-${crypto.randomBytes(2).toString("hex")}.mp4`;
  const result = await shell(target, ["aa", "start", ...RECORDER, "--ps", "CustomizedFileName", name], signal, 15000);
  invariant(/success/i.test(result.stdout), "UI_RECORD_FAILED", `Screen recorder did not start: ${result.stdout.trim().slice(0, 200)}`,
    undefined, "Screen recording needs a real device with the system recorder (not available on some emulators)");
  recordings.set(target, { name, started: Date.now() });
  return { recording: true, file: name, note: "Stop with ui action=record_stop" };
}

export async function stopRecording(target: string, signal?: AbortSignal) {
  const current = recordings.get(target);
  invariant(current, "NOT_FOUND", "No recording started by this server on this device");
  await shell(target, ["aa", "start", ...RECORDER], signal, 15000);
  recordings.delete(target);
  // The file appears in the media library after the recorder finalizes it.
  let uri: string | undefined;
  for (let i = 0; i < 20 && !uri; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const query = await shell(target, ["mediatool", "query", current.name, "-u"], signal, 10000);
    uri = /"(file:\/\/[^"]+)"/.exec(query.stdout)?.[1];
  }
  invariant(uri, "UI_RECORD_FAILED", "Recording was not found in the media library");
  const staging = `/data/local/tmp/${current.name}`;
  const exported = await shell(target, ["mediatool", "recv", uri, staging], signal, 120000);
  invariant(exported.stdout.includes(staging), "UI_RECORD_FAILED", `Export failed: ${exported.stdout.trim().slice(0, 200)}`,
    undefined, "Emulators often cannot export recordings; use a real device, or take screenshots with ui action=screenshot");
  const id = `a_${crypto.randomBytes(8).toString("hex")}`;
  const local = path.join(artifactDir(), `${id}.mp4`);
  try {
    await hdc(["-t", target, "file", "recv", staging, local], signal, 120000);
  } finally {
    void shell(target, ["rm", "-f", staging]).catch(() => {});
  }
  const artifact = await commitArtifact(id, local, "video/mp4");
  return { saved: local, bytes: artifact.bytes, seconds: Math.round((Date.now() - current.started) / 1000), artifact_id: artifact.artifact_id };
}
