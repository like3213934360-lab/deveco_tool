import fs from "node:fs";
import path from "node:path";
import { toolchain } from "../core/toolchain.js";
import type { DeviceApiWarning, Project } from "./project.js";

/*
 * Verification of hvigor's "The system capacity of this api 'X' is not supported on all devices".
 *
 * hvigor (ets-loader api_check_utils.configureSyscapInfo / checkSyscapAbility) warns when the API's
 * @syscap tag is not in the intersection of the module's deviceTypes capability sets. Measured on a
 * real multi-device app (LingDong, 192 warnings in its own code) that check has two defects:
 *  1. Tags with a version suffix (`@syscap SystemCapability.Multimedia.Audio.Core [since 12]`) are
 *     compared as the whole string, which is never a capability name: 85 warnings, all false.
 *  2. The HMS capability files are selected by `file.startsWith(deviceType)`; for "default" (the usual
 *     phone alias) no HMS file starts with "default", so phone's HMS capabilities are lost: 21 false.
 * This module re-runs the same decision with both fixed, using the API's tag (read from the SDK via
 * the language server's hover, i.e. the exact declaration the compiler checked) and the SDK's own
 * device-define files. Nothing is guessed: a location whose tag cannot be read stays "unverified".
 */

type Caps = Set<string>;
const capsCache = new Map<string, Caps>();

function readCaps(file: string): string[] {
  try { return (JSON.parse(fs.readFileSync(file, "utf8")) as { SysCaps?: string[] }).SysCaps ?? []; } catch { return []; }
}

/** Capabilities of one device type: OpenHarmony device-define + HMS device-define (HarmonyOS). */
export function deviceCaps(deviceType: string, sdk = toolchain().sdk): Caps {
  const key = `${sdk}|${deviceType}`;
  const hit = capsCache.get(key);
  if (hit) return hit;
  const phone = deviceType === "phone" || deviceType === "default";
  const oh = path.join(sdk, "default/openharmony/ets/api/device-define", `${phone ? "default" : deviceType}.json`);
  const hmsDir = path.join(sdk, "default/hms/ets/api/device-define");
  const prefix = phone ? "phone" : deviceType;
  let hms: string[] = [];
  try {
    // Exact device files only ("phone.json", "phone-hmos.json"), not e.g. "liteWearable" for "wearable".
    hms = fs.readdirSync(hmsDir).filter((f) => f === `${prefix}.json` || f === `${prefix}-hmos.json`).flatMap((f) => readCaps(path.join(hmsDir, f)));
  } catch { /* OpenHarmony-only SDK */ }
  const caps = new Set([...readCaps(oh), ...hms]);
  capsCache.set(key, caps);
  return caps;
}

/**
 * The @syscap that applies at the compile API level. A declaration can carry several tags with
 * version ranges (`X [since 9 - 11]`, `X.Cipher [since 12]`); plain tags apply always.
 */
export function applicableSyscap(hover: string, compileApi: number): string | undefined {
  const tags = [...hover.matchAll(/@syscap\s+(SystemCapability(?:\.\w+)+)(?:\s*\[since\s+(\d+)(?:\s*-\s*(\d+))?\])?/g)];
  for (const t of tags) {
    const from = t[2] ? Number(t[2]) : undefined, to = t[3] ? Number(t[3]) : undefined;
    if ((from === undefined || compileApi >= from) && (to === undefined || compileApi <= to)) return t[1];
  }
  return tags.length ? tags[tags.length - 1]![1] : undefined;
}

function moduleOf(project: Project, file: string) {
  const abs = path.resolve(project.root, file);
  return [...project.modules].sort((a, b) => b.root.length - a.root.length).find((m) => abs.startsWith(m.root + path.sep));
}

export interface VerifiedDeviceApi extends DeviceApiWarning { syscap?: string; missing_on?: string[] }

/**
 * Split compiler warnings (project code only) into real ones (capability missing on at least one
 * declared device, with which ones), compiler false positives (available on every declared device),
 * and unverified ones (tag unreadable / time budget exhausted).
 */
export async function verifyDeviceApis(project: Project, items: DeviceApiWarning[], signal: AbortSignal, budgetMs = 90000) {
  const { lsp } = await import("./code.js");
  const compileApi = Number(/\((\d+)\)/.exec(project.compileSdk ?? "")?.[1] ?? /^(\d+)/.exec(project.compileSdk ?? "")?.[1] ?? 0) || 99;
  const real: VerifiedDeviceApi[] = [], unverified: DeviceApiWarning[] = [];
  let falsePositives = 0;
  const deadline = Date.now() + budgetMs;
  const tagCache = new Map<string, string | undefined>();
  for (const w of items) {
    const mod = moduleOf(project, w.file);
    if (!mod || !mod.deviceTypes.length || Date.now() > deadline || signal.aborted) { unverified.push(w); continue; }
    const key = `${w.file}:${w.line}:${w.column}`;
    let cap = tagCache.get(key);
    if (!tagCache.has(key)) {
      // hvigor columns are the identifier start; try it and the next character (0/1-based differences).
      for (const column of [w.column + 1, w.column]) {
        const h = await lsp({ project: project.root, action: "hover", file: w.file, line: w.line, column }, signal).catch(() => undefined) as { hover?: string | null } | undefined;
        cap = h?.hover ? applicableSyscap(h.hover, compileApi) : undefined;
        if (cap) break;
      }
      tagCache.set(key, cap);
    }
    if (!cap) { unverified.push(w); continue; }
    const missing = mod.deviceTypes.filter((t) => !deviceCaps(t).has(cap!)).map((t) => (t === "default" ? "phone" : t));
    if (missing.length) real.push({ ...w, syscap: cap, missing_on: missing });
    else falsePositives++;
  }
  return { real, unverified, falsePositives };
}

/** Agent-facing summary: real issues grouped by capability, bounded. */
export function summarizeVerified(v: Awaited<ReturnType<typeof verifyDeviceApis>>, dependencyWarnings: number, maxGroups = 30, maxLocations = 8) {
  const groups = new Map<string, VerifiedDeviceApi[]>();
  for (const w of v.real) {
    const k = `${w.syscap}|${w.missing_on!.join("+")}`;
    const list = groups.get(k); if (list) list.push(w); else groups.set(k, [w]);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  return {
    unguarded_calls: v.real.length,
    compiler_false_positives: v.falsePositives,
    ...(v.unverified.length ? { unverified: v.unverified.length, unverified_at: v.unverified.slice(0, maxLocations).map((w) => `${w.file}:${w.line}:${w.column} (${w.api})`) } : {}),
    dependency_warnings: dependencyWarnings,
    capabilities: sorted.slice(0, maxGroups).map(([, list]) => ({
      syscap: list[0]!.syscap, missing_on: list[0]!.missing_on, count: list.length,
      apis: [...new Set(list.map((w) => w.api))].slice(0, 10),
      at: list.slice(0, maxLocations).map((w) => `${w.file}:${w.line}:${w.column}`),
    })),
    ...(sorted.length > maxGroups ? { more_capabilities: sorted.length - maxGroups } : {}),
    note: "unguarded_calls: the capability is missing on the listed devices of the module's deviceTypes and the call is not inside an enclosing if (canIUse('<syscap>')); on those devices it crashes at runtime. The compiler only recognises an if around the call itself: a guard in the caller or an early `if (!canIUse(...)) return` also protects it, so check the call path before changing code. Fix: wrap the call in if (canIUse('<syscap>')) { ... }, or move it to a module whose deviceTypes all have the capability. compiler_false_positives: hvigor warned, but the capability exists on every declared device (hvigor misreads '@syscap X [since N]' tags and the 'default' device alias); nothing to change. Only files compiled in this build are covered.",
  };
}
