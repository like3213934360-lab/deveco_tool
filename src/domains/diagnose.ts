import fs from "node:fs";
import path from "node:path";
import { assetRoot } from "../core/config.js";
import { invariant, ToolError } from "../core/errors.js";
import { saveArtifact } from "../core/artifacts.js";
import { faultlogNames, readFaultlog } from "./device.js";
import { locate, type ResolvedRef } from "./sourcemap.js";

/* ------------------------------ crash parsing ------------------------------ */

export interface CrashSignature {
  source?: string;
  type: "jscrash" | "cppcrash" | "appfreeze" | "unknown";
  bundle?: string;
  kind?: string; // Error name: TypeError, ReferenceError, BusinessError, SIGSEGV, THREAD_BLOCK_6S ...
  message?: string;
  code?: string;
  reason?: string;
  frames: string[];
  app_frames: string[];
  source_map_missing: boolean;
}

/** Parse HarmonyOS faultlogger reports (jscrash / cppcrash / appfreeze) and hilog crash output. */
export function parseCrash(text: string, source?: string): CrashSignature {
  const type: CrashSignature["type"] = source?.startsWith("jscrash") || /Error name:|Error message:/i.test(text)
    ? "jscrash"
    : source?.startsWith("cppcrash") || /Signal:SIG|Reason:Signal/i.test(text)
      ? "cppcrash"
      : source?.startsWith("appfreeze") || /THREAD_BLOCK|APP_INPUT_BLOCK|LIFECYCLE_TIMEOUT/i.test(text)
        ? "appfreeze"
        : "unknown";
  // Only the primary report section; faultlogger appends historical HiLog after it.
  const primary = text.split(/^HiLog:\s*$/m)[0] ?? text;
  const field = (name: string) => new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, "mi").exec(primary)?.[1]?.trim();
  const bundle = field("Module name") ?? field("Process name") ?? (source ? /-([A-Za-z][\w]*(?:\.[\w]+)+)-/.exec(source)?.[1] : undefined);
  let kind = field("Error name");
  let message = field("Error message");
  const code = field("Error code") ?? /code[:\s]+(\d{6,9})/i.exec(message ?? "")?.[1];
  const reason = field("Reason");
  if (type === "cppcrash") kind = /Signal:\s*(SIG\w+)/.exec(primary)?.[1] ?? kind;
  if (type === "appfreeze") kind = /(THREAD_BLOCK_\d+S|APP_INPUT_BLOCK|LIFECYCLE_TIMEOUT|BUSSINESS_THREAD_BLOCK_\d+S)/.exec(primary)?.[1] ?? kind;
  if (!kind) {
    const hilog = /\b(TypeError|ReferenceError|RangeError|SyntaxError|URIError|BusinessError|OutOfMemoryError|Error):\s*(.+)/.exec(primary);
    if (hilog) { kind = hilog[1]; message ??= hilog[2]; }
  }
  const stackStart = primary.search(/^\s*(Stacktrace|Stack|Fault thread info:|Tid:\d+)/m);
  // Only the crashing thread: from the stack start up to the next thread header. A stack that starts
  // with its own "Tid:" line (or "Fault thread info:" + "Tid:") must not swallow the next thread.
  const stackText = stackStart >= 0 ? primary.slice(stackStart) : primary;
  const head = /^\s*(?:Fault thread info:\s*\n\s*)?Tid:\d+[^\n]*\n?/.exec(stackText)?.[0] ?? "";
  const firstThread = stackText.slice(head.length).split(/\n\s*(?:Tid:\d+|Other thread info:|Thread name:)/)[0]!;
  const frames = firstThread
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^at\s|^#\d+\s/.test(l))
    .slice(0, 40);
  const appFrames = frames.filter((f) => /entry|feature|\.ets|src\/main/.test(f) && !/\/system\/|ohos\.|@ohos|libace|libark/.test(f)).slice(0, 8);
  return {
    source, type, bundle, kind, message, code, reason, frames: frames.slice(0, 15), app_frames: appFrames,
    source_map_missing: /Cannot get SourceMap|sourcemap.*(not|missing)/i.test(primary),
  };
}

/* ------------------------------ pattern library ------------------------------ */

interface Pattern { kind: string; pattern: string; literals: string[][]; conclusion: string; fix: string; source: string }
let patterns: Pattern[] | undefined;
const typeFiles: Record<string, string> = {
  businesserror_patterns: "BusinessError", error_patterns: "Error", outofmemoryerror_patterns: "OutOfMemoryError",
  rangeerror_patterns: "RangeError", referenceerror_patterns: "ReferenceError", syntaxerror_patterns: "SyntaxError",
  typeerror_patterns: "TypeError", urierror_patterns: "URIError",
};

const RUNTIME_REFS = "knowledge/skills/hmos-runtime-fix-skill/references";

/** Load the reviewed markdown tables (hmos-runtime-fix-skill references) once. */
function loadPatterns(): Pattern[] {
  if (patterns) return patterns;
  patterns = [];
  const dir = path.join(assetRoot, RUNTIME_REFS);
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const name = file.replace(/\.md$/, "");
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const fault = name === "fault-mode-library";
    if (!fault && !typeFiles[name]) continue;
    const heading = fault ? "## 三级根因库" : "## Pattern Matrix";
    const section = text.split(heading)[1]?.split(/\n## /)[0] ?? "";
    for (const line of section.split("\n").slice(3)) {
      if (!line.trim().startsWith("|")) continue;
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (cells.length < (fault ? 5 : 3)) continue;
      const raw = cells[fault ? 2 : 0]!;
      const kind = fault ? /`(\w+)`/.exec(cells[1]!)?.[1] ?? "Error" : typeFiles[name]!;
      // "A + B / C" => [[A,B],[C]] ; placeholders like <name> split a template into literal parts.
      const literals = raw.split(/\s\/\s/).map((group) =>
        [...group.matchAll(/`([^`]+)`/g)].flatMap((m) => m[1]!.split(/<[a-z-]+>/).map((s) => s.trim()).filter(Boolean)),
      ).filter((g) => g.length);
      patterns.push({ kind, pattern: raw, literals, conclusion: cells[fault ? 3 : 1]!, fix: cells[fault ? 4 : 2]!, source: `${RUNTIME_REFS}/${file}` });
    }
  }
  return patterns;
}

export function matchPatterns(signature: Pick<CrashSignature, "kind" | "message" | "code">) {
  const message = (signature.message ?? "").toLowerCase();
  return loadPatterns()
    .filter((p) => p.kind === signature.kind || (p.kind === "Error" && !typeFiles[`${(signature.kind ?? "").toLowerCase()}_patterns`]))
    .filter((p) => p.literals.some((group) => group.every((lit) => {
      if (lit === "undefined/null") return /undefined|null/.test(message);
      if (/^\d+$/.test(lit)) return signature.code === lit || new RegExp(`(^|\\D)${lit}(\\D|$)`).test(message);
      return message.includes(lit.toLowerCase());
    })))
    .slice(0, 5)
    .map(({ literals: _l, ...p }) => p);
}

/* ------------------------------ entry points ------------------------------ */

async function readLocalFaultlog(file: string, signal: AbortSignal, fromDirectory = false) {
  invariant(path.isAbsolute(file), "INVALID_INPUT", "file must be an absolute path");
  const limit = 4_000_000;
  let handle: fs.promises.FileHandle;
  try { handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fromDirectory ? fs.constants.O_NOFOLLOW : 0)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ToolError("NOT_FOUND", "Fault log file not found", { file });
    throw new ToolError("INVALID_INPUT", `Cannot open fault log file: ${(error as Error).message}`, { file });
  }
  try {
    const stat = await handle.stat();
    invariant(stat.isFile(), "INVALID_INPUT", "file must be a regular file");
    invariant(stat.size <= limit, "INVALID_INPUT", "Fault log file exceeds 4 MB");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    invariant(length <= limit, "INVALID_INPUT", "Fault log file exceeds 4 MB");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)); }
    catch { throw new ToolError("INVALID_INPUT", "Fault log file must contain valid UTF-8"); }
    invariant(text.trim(), "INVALID_INPUT", "Fault log file is empty");
    return { source: path.basename(file), text };
  } finally { await handle.close(); }
}

async function localFaultlogs(directory: string, filters: { name?: string; latest?: number }, signal: AbortSignal) {
  invariant(path.isAbsolute(directory), "INVALID_INPUT", "directory must be an absolute path");
  const root = fs.statSync(directory, { throwIfNoEntry: false });
  invariant(root, "NOT_FOUND", "Fault log directory not found", { directory });
  invariant(root.isDirectory(), "INVALID_INPUT", "directory must refer to a directory");
  const names: string[] = [];
  let visited = 0;
  for await (const entry of await fs.promises.opendir(directory)) {
    signal.throwIfAborted();
    invariant(++visited <= 5000, "INVALID_INPUT", "Fault log directory exceeds 5000 entries", { directory }, "Pass file for an individual report");
    if (entry.isFile() && (filters.name !== undefined ? entry.name === filters.name : /^(?:jscrash|cppcrash|appfreeze|sysfreeze)-[\w.-]+$/.test(entry.name))) names.push(entry.name);
  }
  invariant(names.length, "NOT_FOUND", "No matching fault log files in the directory", { directory, name: filters.name });
  names.sort((a, b) => order(b) - order(a) || b.localeCompare(a));
  const reports = [];
  for (const name of names.slice(0, filters.latest ?? 1)) reports.push(await readLocalFaultlog(path.join(directory, name), signal, true));
  return reports;
}

export async function diagnoseStack(file: string, limit: number, signal: AbortSignal) {
  const { source, text } = await readLocalFaultlog(file, signal);
  const snapshots = new Map<string, { thread: string; timestamp: string; frames: string[] }>();
  const cpu: Record<string, number> = {};
  let thread: string | undefined;
  let snapshot: { frames: string[] } | undefined;
  for (const raw of text.split(/\r?\n/)) {
    signal.throwIfAborted();
    const line = raw.trim();
    const usage = /^cpu(\d+) Usage (\d+(?:\.\d+)?)%$/.exec(line);
    if (usage && Number(usage[2]) <= 100) cpu[usage[1]!] = Number(usage[2]);
    const section = /^#ThreadInfos\s+Tid:\s*(\d+)\b/.exec(line);
    if (section) { thread = section[1]; snapshot = undefined; continue; }
    if (line.startsWith("SubmitterStacktrace")) { thread = undefined; snapshot = undefined; continue; }
    if (!thread) continue;
    const stamp = /^(?:Timestamp|SnapshotTime):\s*(.+)$/.exec(line)?.[1];
    if (stamp !== undefined) {
      snapshot = undefined;
      if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(stamp)) continue;
      const value = { thread, timestamp: stamp, frames: [] };
      snapshots.set(`${thread}:${stamp}`, value);
      snapshot = value;
      continue;
    }
    if (!snapshot) continue;
    const native = /^#\d+\s+pc\s+[0-9a-f]+\s+(.+)$/i.exec(line)?.[1];
    const frame = native?.replace(/\([0-9a-f]{16,}\)\s*$/i, "").trim() ?? (/^at\s+.+:\d+:\d+\)?$/.test(line) ? line : undefined);
    if (frame && !/^\/(?:system|vendor|prod(?:uct)?)\//.test(frame) && !/\/foundation\/arkui|libarkweb_engine\.so|\[shmm\]|\banonymous\b/.test(frame)) snapshot.frames.push(frame);
  }
  invariant(snapshots.size, "INVALID_INPUT", "No timestamped thread snapshots found in the sample stack file");
  const groups = new Map<string, { parent: string; count: number; examples: { thread: string; timestamp: string; calls: string[] }[] }>();
  for (const { thread, timestamp, frames } of snapshots.values()) {
    const parent = frames.at(-1);
    if (!parent) continue;
    const group = groups.get(parent) ?? { parent, count: 0, examples: [] };
    group.count++;
    if (group.examples.length < 3) group.examples.push({ thread, timestamp, calls: frames.slice(-24).reverse() });
    groups.set(parent, group);
  }
  const metric = (name: string) => {
    const value = new RegExp(`^${name}:[ \\t]+(\\d+)[ \\t]+ms\\b`, "m").exec(text)?.[1];
    return value !== undefined ? Number(value) : null;
  };
  const artifact = await saveArtifact(text);
  return { source, snapshot_count: snapshots.size, duration_ms: metric("StaticsDuration"), cpu_time_ms: metric("CpuTime"), cpu_usage_percent: cpu,
    hotspot_count: groups.size, hotspots: [...groups.values()].sort((a, b) => b.count - a.count || a.parent.localeCompare(b.parent)).slice(0, limit),
    report_artifact: artifact.artifact_id };
}

export async function symbolize(file: string, buildId: string, addresses: string[], signal: AbortSignal) {
  invariant(path.isAbsolute(file), "INVALID_INPUT", "file must be the absolute ELF object path");
  invariant(/^(?:[0-9a-f]{2}){8,64}$/i.test(buildId), "INVALID_INPUT", "build_id must be the hexadecimal ELF Build ID from the fault report");
  invariant(addresses.every((pc) => /^(?:0x)?[0-9a-f]{1,16}$/i.test(pc)), "INVALID_INPUT", "pc must contain hexadecimal image-relative offsets");
  const offsets = addresses.map((pc) => BigInt("0x" + pc.replace(/^0x/i, "")).toString(16)).map((pc) => `0x${pc}`);
  const identity = fs.statSync(file, { throwIfNoEntry: false, bigint: true });
  invariant(identity, "NOT_FOUND", "Native ELF object not found", { file });
  invariant(identity.isFile(), "INVALID_INPUT", "file must be a regular ELF object");
  const { run } = await import("../core/proc.js");
  const { toolCommand } = await import("../core/toolchain.js");
  const notes = await run(toolCommand("llvmReadelf", ["--notes", file]), { signal, timeoutMs: 8000 });
  const ids = [...notes.stdout.matchAll(/^\s*Build ID:\s*([0-9a-f]+)\s*$/gim)].map((m) => m[1]!.toLowerCase());
  invariant(!notes.truncated && ids.length === 1, "EVIDENCE_MISSING", "ELF object did not report a unique Build ID");
  invariant(ids[0] === buildId.toLowerCase(), "CONFLICT", "The ELF object Build ID differs from the fault report", { expected: buildId, actual: ids[0] });
  const result = await run(toolCommand("llvmSymbolizer", ["--no-debuginfod", "--relative-address", "--output-style=JSON", `--obj=${file}`, ...offsets]), { signal, timeoutMs: 15000 });
  const after = fs.statSync(file, { throwIfNoEntry: false, bigint: true });
  invariant(after && after.dev === identity.dev && after.ino === identity.ino && after.size === identity.size && after.ctimeNs === identity.ctimeNs && after.mtimeNs === identity.mtimeNs,
    "CONFLICT", "ELF object changed during symbolication");
  invariant(!result.truncated, "EVIDENCE_MISSING", "Native symbolicator output was truncated");
  type Symbol = { FunctionName?: string; FileName?: string; Line?: number; Column?: number };
  let rows: { Address?: string; Symbol?: Symbol[] }[];
  try { rows = JSON.parse(result.stdout); } catch { throw new ToolError("DEVICE_OUTPUT_INVALID", "LLVM symbolicator returned invalid JSON"); }
  invariant(Array.isArray(rows) && rows.length === offsets.length && rows.every((row, i) => row?.Address?.toLowerCase() === offsets[i] && Array.isArray(row.Symbol)),
    "EVIDENCE_MISSING", "LLVM symbolicator did not report a result for every requested offset");
  const frames = rows.map((row, i) => {
    const symbols = row.Symbol!.map((s) => ({ function: s.FunctionName && s.FunctionName !== "??" ? s.FunctionName : null,
      file: s.FileName && s.FileName !== "??" ? s.FileName : null, line: s.Line || null, column: s.Column || null }))
      .filter((s) => s.function || s.line && s.file);
    return { pc: offsets[i], status: symbols.some((s) => s.line && s.file) ? "source" : symbols.length ? "symbol" : "unresolved", symbols };
  });
  return { file, build_id: ids[0], frames };
}

export async function diagnoseCrash(input: { target?: string; bundle?: string; log?: string; file?: string; directory?: string; hilog?: boolean; report?: boolean; name?: string; latest?: number; since_minutes?: number; project?: string; strict?: boolean }, target: string | undefined, signal: AbortSignal) {
  const project = input.project ? await projectModel(input.project) : undefined;
  const reports: { source?: string; text: string }[] = [];
  if (input.directory !== undefined) reports.push(...await localFaultlogs(input.directory, input, signal));
  else if (input.file !== undefined) reports.push(await readLocalFaultlog(input.file, signal));
  else if (input.log) reports.push({ text: input.log });
  else {
    invariant(target, "DEVICE_UNAVAILABLE", "A device is required to read crash logs, or pass log text");
    const inventory = input.strict ? await (await import("./device.js")).faultlogInventory(target, signal) : undefined;
    let names = input.name ? [input.name] : inventory?.names ?? await faultlogNames(target, signal);
    if (input.bundle) names = names.filter((n) => n.includes(input.bundle!));
    if (input.since_minutes && !input.name) {
      // Time window on the device clock (names carry epoch ms or local yyyymmddhhmmss).
      const { shell } = await import("./device.js");
      const [epoch, local] = (await shell(target, ["date +%s; date +%Y%m%d%H%M%S"], signal, 5000)).stdout.trim().split(/\s+/);
      invariant(!input.strict || /^\d+$/.test(epoch ?? "") && /^\d{14}$/.test(local ?? ""), "EVIDENCE_MISSING", "Device clock could not define the crash scan window");
      invariant(!input.strict || names.every((n) => faultTime(n)), "EVIDENCE_MISSING", "Crash inventory contains an unrecognized timestamp");
      const window = input.since_minutes * 60000;
      const nowLocal = localMs(local!), nowEpoch = Number(epoch) * 1000;
      names = names.filter((n) => {
        const t = faultTime(n);
        return !!t && (t.local ? nowLocal : nowEpoch) - t.ms <= window;
      });
    }
    names.sort((a, b) => order(b) - order(a));
    if (!names.length && inventory) return { reports: [], scan: { source: inventory.source, scan_artifact: inventory.scan_artifact, since_minutes: input.since_minutes, bundle: input.bundle } };
    invariant(names.length, "NOT_FOUND", input.since_minutes ? `No crash/freeze reports in the last ${input.since_minutes} minutes` : "No crash/freeze reports found on the device",
      { bundle: input.bundle }, "Reproduce the crash, then call again; or pass log text from hilog");
    for (const name of names.slice(0, Math.min(input.latest ?? 1, 5))) reports.push({ source: name, text: await readFaultlog(target, name, signal) });
  }
  const results = [];
  for (const report of reports) {
    const signature = parseCrash(report.text, report.source);
    const artifact = await saveArtifact(report.text);
    const section = input.hilog ? /^HiLog:[ \t]*\r?$\n([\s\S]*)/m.exec(report.text)?.[1]?.trim() : undefined;
    const hilog = section ? await saveArtifact(section) : undefined;
    // The project's own frames with the code around them: the first place to look.
    const source = project ? locate(signature.frames.join("\n") || report.text.split(/^HiLog:\s*$/m)[0]!, project) : [];
    results.push({
      ...signature,
      ...(source.length ? { source } : {}),
      candidates: signature.type === "jscrash" || signature.kind ? matchPatterns(signature) : [],
      report_artifact: artifact.artifact_id,
      ...(input.hilog ? { hilog: hilog ? { status: "extracted", hilog_artifact: hilog.artifact_id } : { status: "absent" } } : {}),
      guidance: guidance(signature),
    });
  }
  if (!input.report) return { reports: results };
  const asText = (value: unknown) => JSON.stringify(value, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const sections = results.map(({ candidates, guidance, ...facts }, i) => `<section><h2>Fault log ${i + 1}</h2>
<h3>Observed and extracted evidence</h3><pre>${asText(facts)}</pre>
<h3>Candidate causes from the pattern library</h3><pre>${asText(candidates)}</pre>
<h3>Suggested checks</h3><pre>${asText(guidance)}</pre></section>`);
  const html = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>HarmonyOS fault analysis</title><h1>HarmonyOS fault analysis</h1>" + sections.join("\n") + "</html>";
  const artifact = await saveArtifact(html, "text/html");
  return { reports: results, dfx_artifact: artifact.artifact_id };
}

/** Project modules for source lookup; undefined when the path is not a readable project (never throws). */
export async function projectModel(root: string) {
  try {
    const { inspectProject } = await import("./project.js");
    const p = inspectProject(root);
    return { root: p.root, product: p.product, modules: p.modules.map((m) => ({ name: m.name, root: m.root, target: m.target })) };
  } catch {
    return undefined;
  }
}

/** Compact crash summary for run/launch failures: what crashed, where in the project, likely causes. */
export async function crashSummary(target: string, bundle: string, names: string[], project: string | undefined, signal: AbortSignal) {
  try {
    const result = await diagnoseCrash({ bundle, name: names.sort((a, b) => order(b) - order(a))[0], project }, target, signal);
    const r = result.reports[0];
    if (!r) return undefined;
    const source = (r as { source?: ResolvedRef[] }).source;
    return {
      type: r.type, kind: r.kind, message: r.message, code: r.code, app_frames: r.app_frames.slice(0, 5),
      ...(source ? { source } : {}),
      candidates: r.candidates.slice(0, 3).map((c) => ({ conclusion: c.conclusion, fix: c.fix })),
      report_artifact: r.report_artifact,
    };
  } catch {
    return undefined; // best-effort: the launch result already says it crashed
  }
}

/**
 * Report time from the faultlog name: either epoch ms (13 digits) or device-local
 * yyyymmddhhmmss[mmm] (14/17 digits). Local stamps are returned as pseudo-UTC ms of the
 * device's wall clock, so compare them only with the device's local "now".
 */
export function faultTime(name: string): { ms: number; local: boolean } | undefined {
  const m = /-(\d{13,17})(?:\.log)?$/.exec(name);
  if (!m) return undefined;
  const digits = m[1]!;
  if (digits.length === 13) return { ms: Number(digits), local: false };
  if (digits.length !== 14 && digits.length !== 17) return undefined;
  return { ms: localMs(digits), local: true };
}
function localMs(stamp: string) {
  const n = (i: number, len: number) => Number(stamp.slice(i, i + len));
  return Date.UTC(n(0, 4), n(4, 2) - 1, n(6, 2), n(8, 2), n(10, 2), n(12, 2), stamp.length >= 17 ? n(14, 3) : 0);
}
function order(name: string) {
  return faultTime(name)?.ms ?? 0;
}

function guidance(s: CrashSignature): string[] {
  const out: string[] = [];
  if (s.app_frames.length) out.push(`Open the top app frame first: ${s.app_frames[0]}`);
  if (s.source_map_missing) out.push("SourceMap unavailable: build a debug package to get .ets line numbers");
  if (s.type === "appfreeze") out.push("Main thread was blocked: look for sync I/O, heavy loops or deadlocks in lifecycle/UI callbacks");
  if (s.type === "cppcrash") out.push("Native crash: check N-API handle scopes, null pointers and thread safety in the listed frames");
  if (s.code) out.push(`Search the error code: knowledge action=search query="${s.code}"`);
  return out;
}

/** Build failures: map common ArkTS error codes/messages to knowledge hints. */
export function buildFailureHints(diagnostics: { code?: string; message: string }[]) {
  const hints = new Map<string, string>();
  for (const d of diagnostics) {
    const m = d.message;
    if (/arkts-no-any-unknown|any.*unknown/i.test(m)) hints.set("any", "ArkTS forbids any/unknown: declare explicit types (knowledge: errors/any_type_errors)");
    if (/object literal|arkts-no-untyped-obj-literals/i.test(m)) hints.set("literal", "Object literals need a declared class/interface type (knowledge: errors/object_literal_type_errors)");
    if (/spread|arkts-no-spread/i.test(m)) hints.set("spread", "Object spread is restricted in ArkTS (knowledge: errors/object_spread_errors)");
    if (/possibly (null|undefined)|strictNullChecks/i.test(m)) hints.set("null", "Handle null/undefined explicitly (knowledge: errors/possibly_null_errors)");
    // Device capability (LSP 28005 / 2307 with this text, 28057): the module exists; the target devices lack it.
    if (/system capabilities of devices .* do not include SystemCapability\.\w/i.test(m)) {
      const cap = /(SystemCapability(?:\.\w+)+)/.exec(m)![1];
      hints.set(`syscap:${cap}`, `Not a missing dependency: ${cap} is not available on this module's deviceTypes (module.json5). Use it only from a module whose deviceTypes support it, or add the capability in syscap.json and guard calls with canIUse('${cap}')`);
    } else if (/not supported on all devices|Use the canIUse condition/i.test(m)) {
      hints.set("canIUse", "API not available on every device in deviceTypes: wrap each call in if (canIUse('SystemCapability.…')) { … }, otherwise it crashes on devices without it. The capability is the @syscap of the API: code action=lsp op=hover on it");
    } else if (/Cannot find module|not found.*module|resolve/i.test(m)) hints.set("module", "Missing dependency or wrong import path: run project action=sync, check oh-package.json5");
    if (/compatibleSdkVersion|since API|requires API/i.test(m)) hints.set("api", "API not available at compatibleSdkVersion: raise compatible_api or guard with canIUse");
    if (/Invalid project path|00306003/i.test(m) && /path/i.test(m))
      hints.set("path", "hvigor rejects this project path (typically non-ASCII characters or spaces in a parent directory). Move or copy the project to an ASCII-only path and build there");
    if (/certificate has expired|11013002/i.test(m))
      hints.set("cert-expired", "The signing certificate in build-profile.json5 has expired (debug certificates are short-lived): renew it with sign action=auto force=true (needs auth provider=developer), or in DevEco Studio > Project Structure > Signing Configs");
    else if (/signingConfig|00303107|SignHap/i.test(m)) hints.set("sign", "Packaging needs signing: sign action=auto (debug, real devices) or configure signingConfigs; emulators accept unsigned builds only for entry HAPs built without signing steps");
    if (/Unknown resource name/i.test(m)) hints.set("res", "The $r('app.<type>.<name>') resource is not defined in any module's resources/base/element or media: add it or fix the name");
    if (/Cannot find module '([^']+)'/i.test(m) && !/SystemCapability/.test(m) && /oh-package|dependenc|@ohos\/|^[a-z]/i.test(/Cannot find module '([^']+)'/i.exec(m)![1]!))
      hints.set("module", "Missing dependency or wrong import path: add it to the module's oh-package.json5 and run project action=sync (builds also sync automatically when oh-package.json5 changed)");
    // Only codes the knowledge pack can match: 8-digit build codes and named rules (arkts-no-any-unknown).
    // LSP server codes (2307, 28005...) and upstream check rule ids are not indexed; search the message instead.
    if (d.code && (/^\d{8}$/.test(d.code) || /^arkts-[a-z-]+$/.test(d.code))) hints.set(`code:${d.code}`, `knowledge action=search query="${d.code}"`);
  }
  return [...hints.values()].slice(0, 8);
}
