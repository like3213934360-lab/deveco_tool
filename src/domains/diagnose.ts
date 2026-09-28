import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "../core/config.js";
import { invariant } from "../core/errors.js";
import { saveArtifact } from "../core/artifacts.js";
import { faultlogNames, readFaultlog } from "./device.js";

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

/** Load the reviewed markdown tables (knowledge/runtime) once. */
function loadPatterns(): Pattern[] {
  if (patterns) return patterns;
  patterns = [];
  const dir = path.join(packageRoot, "knowledge/runtime");
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
      patterns.push({ kind, pattern: raw, literals, conclusion: cells[fault ? 3 : 1]!, fix: cells[fault ? 4 : 2]!, source: `knowledge/runtime/${file}` });
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

export async function diagnoseCrash(input: { target?: string; bundle?: string; log?: string; name?: string; latest?: number }, target: string | undefined, signal: AbortSignal) {
  const reports: { source?: string; text: string }[] = [];
  if (input.log) reports.push({ text: input.log });
  else {
    invariant(target, "DEVICE_UNAVAILABLE", "A device is required to read crash logs, or pass log text");
    let names = input.name ? [input.name] : await faultlogNames(target, signal);
    if (input.bundle) names = names.filter((n) => n.includes(input.bundle!));
    names.sort((a, b) => (timestamp(b) ?? 0) - (timestamp(a) ?? 0));
    invariant(names.length, "NOT_FOUND", "No crash/freeze reports found on the device", { bundle: input.bundle },
      "Reproduce the crash, then call again; or pass log text from hilog");
    for (const name of names.slice(0, Math.min(input.latest ?? 1, 5))) reports.push({ source: name, text: await readFaultlog(target, name, signal) });
  }
  const results = [];
  for (const report of reports) {
    const signature = parseCrash(report.text, report.source);
    const artifact = await saveArtifact(report.text);
    results.push({
      ...signature,
      candidates: signature.type === "jscrash" || signature.kind ? matchPatterns(signature) : [],
      report_artifact: artifact.artifact_id,
      guidance: guidance(signature),
    });
  }
  return { reports: results };
}

function timestamp(name: string) {
  const m = /-(\d{13})(?:\.log)?$/.exec(name) ?? /-(\d{14})/.exec(name);
  return m ? Number(m[1]) : undefined;
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
    if (/Cannot find module|not found.*module|resolve/i.test(m)) hints.set("module", "Missing dependency or wrong import path: run project action=sync, check oh-package.json5");
    if (/compatibleSdkVersion|since API|requires API/i.test(m)) hints.set("api", "API not available at compatibleSdkVersion: raise compatible_api or guard with canIUse");
    if (d.code) hints.set(`code:${d.code}`, `knowledge action=search query="${d.code}"`);
  }
  return [...hints.values()].slice(0, 8);
}
