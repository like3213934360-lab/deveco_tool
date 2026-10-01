import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "../core/config.js";
import { invariant } from "../core/errors.js";
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
  const stackStart = primary.search(/^\s*(Stacktrace|Stack|Tid:\d+)/m);
  // Only the crashing thread: stop at the next "Tid:" / "Other thread" block.
  const stackText = stackStart >= 0 ? primary.slice(stackStart) : primary;
  const firstThread = stackText.split(/\n\s*(?:Tid:\d+|Other thread info:|Thread name:)/).slice(0, stackText.trimStart().startsWith("Tid:") ? 2 : 1).join("\n");
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
  const dir = path.join(packageRoot, RUNTIME_REFS);
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

export async function diagnoseCrash(input: { target?: string; bundle?: string; log?: string; name?: string; latest?: number; since_minutes?: number; project?: string }, target: string | undefined, signal: AbortSignal) {
  const project = input.project ? await projectModel(input.project) : undefined;
  const reports: { source?: string; text: string }[] = [];
  if (input.log) reports.push({ text: input.log });
  else {
    invariant(target, "DEVICE_UNAVAILABLE", "A device is required to read crash logs, or pass log text");
    let names = input.name ? [input.name] : await faultlogNames(target, signal);
    if (input.bundle) names = names.filter((n) => n.includes(input.bundle!));
    if (input.since_minutes && !input.name) {
      // Time window on the device clock (names carry epoch ms or local yyyymmddhhmmss).
      const { shell } = await import("./device.js");
      const [epoch, local] = (await shell(target, ["date +%s; date +%Y%m%d%H%M%S"], signal, 5000)).stdout.trim().split(/\s+/);
      const window = input.since_minutes * 60000;
      const nowLocal = localMs(local!), nowEpoch = Number(epoch) * 1000;
      names = names.filter((n) => {
        const t = faultTime(n);
        return !!t && (t.local ? nowLocal : nowEpoch) - t.ms <= window;
      });
    }
    names.sort((a, b) => order(b) - order(a));
    invariant(names.length, "NOT_FOUND", input.since_minutes ? `No crash/freeze reports in the last ${input.since_minutes} minutes` : "No crash/freeze reports found on the device",
      { bundle: input.bundle }, "Reproduce the crash, then call again; or pass log text from hilog");
    for (const name of names.slice(0, Math.min(input.latest ?? 1, 5))) reports.push({ source: name, text: await readFaultlog(target, name, signal) });
  }
  const results = [];
  for (const report of reports) {
    const signature = parseCrash(report.text, report.source);
    const artifact = await saveArtifact(report.text);
    // The project's own frames with the code around them: the first place to look.
    const source = project ? locate(signature.frames.join("\n") || report.text.split(/^HiLog:\s*$/m)[0]!, project) : [];
    results.push({
      ...signature,
      ...(source.length ? { source } : {}),
      candidates: signature.type === "jscrash" || signature.kind ? matchPatterns(signature) : [],
      report_artifact: artifact.artifact_id,
      guidance: guidance(signature),
    });
  }
  return { reports: results };
}

/** Project modules for source lookup; undefined when the path is not a readable project (never throws). */
export async function projectModel(root: string) {
  try {
    const { inspectProject } = await import("./project.js");
    const p = inspectProject(root);
    return { root: p.root, modules: p.modules.map((m) => ({ name: m.name, root: m.root })) };
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
