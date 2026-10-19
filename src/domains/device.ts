import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { artifactDir, saveArtifact } from "../core/artifacts.js";
import { invariant, ToolError } from "../core/errors.js";
import { clip } from "../core/files.js";
import { run, type RunResult } from "../core/proc.js";
import { toolCommand } from "../core/toolchain.js";

/**
 * hdc's wording when the -t target is not connected (verified, exit code 0 nonetheless):
 * "[Fail]Not match target founded, check connect-key please".
 */
export const TARGET_GONE = /Not match target founded|check connect-key|device offline/i;

export async function hdc(args: string[], signal?: AbortSignal, timeoutMs = 30000, allowFailure = false): Promise<RunResult> {
  const result = await run(toolCommand("hdc", args), { signal, timeoutMs, allowFailure, keepBytes: 4 * 1024 * 1024 });
  // A device that disconnects mid-call makes later steps fail with misleading messages
  // (e.g. "layout file transfer failed"): report the real cause.
  if (args[0] === "-t" && TARGET_GONE.test(result.stdout + result.stderr)) throw gone(args[1]!);
  return result;
}

function gone(target: string) {
  return new ToolError("DEVICE_UNAVAILABLE", `Device ${target} is not connected (it disconnected or was switched off)`, { target },
    "Reconnect the device (USB/Wi-Fi debugging) or start the emulator, then call again; ask the user if it should be a different device");
}

/**
 * A device can vanish mid-command without hdc saying so (a file transfer just produces nothing).
 * Callers whose device step failed call this to report the real cause instead of their own symptom.
 */
export async function assertConnected(target: string, signal?: AbortSignal) {
  const connected = await listTargets(signal).catch(() => undefined);
  if (connected && !connected.includes(target)) throw gone(target);
}

export async function listTargets(signal?: AbortSignal): Promise<string[]> {
  const result = await hdc(["list", "targets"], signal, 10000);
  return result.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^\[Empty\]$/i.test(l));
}

/** Short identity of a connected device (for choosing one): name, model, emulator or real, device type. */
export async function deviceSummary(target: string, signal?: AbortSignal) {
  const keys = ["const.product.name", "const.product.model", "ohos.qemu.hvd.name", "const.product.devicetype", "const.ohos.apiversion"];
  const v = await Promise.all(keys.map((k) => shell(target, ["param", "get", k], signal, 8000).then((r) => r.stdout.trim()).catch(() => "")));
  const ok = (s: string) => (s && !/fail|error|not found|invalid/i.test(s) ? s : undefined);
  const emulatorName = ok(v[2]!);
  return {
    target, name: emulatorName ?? ok(v[0]!), model: ok(v[1]!), emulator: !!emulatorName || /^127\.0\.0\.1:|^localhost:/.test(target),
    device_type: ok(v[3]!), api_level: ok(v[4]!) ? Number(v[4]) : undefined,
  };
}

/**
 * Resolve the device: an explicit serial or device name (like devecocli --device), or the only
 * connected one. With several devices and no target, never pick one: the user decides, so the error
 * lists every device (and whether it matches the project's deviceTypes when a project is given).
 */
export async function resolveTarget(target: string | undefined, signal?: AbortSignal, projectDeviceTypes?: string[]): Promise<string> {
  const targets = await listTargets(signal);
  if (target) {
    if (targets.includes(target)) return target;
    const summaries = await Promise.all(targets.map((t) => deviceSummary(t, signal)));
    const want = target.trim().toLowerCase();
    const byName = summaries.filter((s) => [s.name, s.model].some((n) => n?.toLowerCase() === want));
    invariant(byName.length <= 1, "DEVICE_AMBIGUOUS", `Several connected devices are named ${target}; pass the serial`, { devices: byName });
    invariant(byName.length === 1, "DEVICE_UNAVAILABLE", `Device ${target} is not connected`, { connected: summaries },
      "Pass target as one of the connected serials or names");
    return byName[0]!.target;
  }
  invariant(targets.length > 0, "DEVICE_UNAVAILABLE", "No HarmonyOS device or emulator is connected", undefined,
    "Connect a device (USB debugging on) or start an emulator (emulator tool / DevEco Studio)");
  if (targets.length === 1) return targets[0]!;
  const summaries = await Promise.all(targets.map((t) => deviceSummary(t, signal)));
  const types = projectDeviceTypes?.map((t) => (t === "default" ? "phone" : t.toLowerCase()));
  const devices = summaries.map((s) => ({
    ...s,
    ...(types ? { matches_project: !!s.device_type && types.includes(s.device_type === "default" ? "phone" : s.device_type.toLowerCase()) } : {}),
  }));
  throw new ToolError("DEVICE_AMBIGUOUS", `${targets.length} devices are connected and no target was given`, { devices },
    "Do not choose on your own: ask the user which device to use (list name, real device or emulator), then call again with target=<serial>");
}

export async function shell(target: string, command: string[], signal?: AbortSignal, timeoutMs = 30000) {
  return hdc(["-t", target, "shell", ...command], signal, timeoutMs, true);
}

export async function deviceInfo(target: string, signal?: AbortSignal) {
  const params = ["const.product.model", "const.product.name", "const.ohos.apiversion", "const.product.software.version", "const.ohos.fullname", "ohos.qemu.hvd.name", "const.product.cpu.abilist"];
  const values = await Promise.all(params.map((p) => shell(target, ["param", "get", p], signal, 10000).then((r) => r.stdout.trim()).catch(() => "")));
  const get = (i: number) => (values[i] && !/fail|error|not found/i.test(values[i]!) ? values[i] : undefined);
  const display = (await shell(target, ["hidumper", "-s", "DisplayManagerService", "-a", "-a"], signal, 10000).catch(() => undefined))?.stdout ?? "";
  const w = /^\s*Width:\s*(\d{3,5})/m.exec(display)?.[1];
  const h = /^\s*Height:\s*(\d{3,5})/m.exec(display)?.[1];
  const size = w && h ? [display, w, h] : /render resolution=(\d{3,5})x(\d{3,5})/.exec(display);
  return {
    target,
    model: get(0), name: get(1), api_level: get(2) ? Number(get(2)) : undefined, software: get(3), os: get(4),
    emulator: get(5) ? { name: get(5) } : undefined,
    abi: get(6),
    screen: size ? { width: Number(size[1]), height: Number(size[2]) } : undefined,
  };
}

/* ------------------------------ install / launch ------------------------------ */

export interface InstallOptions { shared?: string[]; user?: number; install_timeout?: number }
export function validatePackages(packages: string[], options: InstallOptions = {}) {
  invariant(packages.length + (options.shared?.length ?? 0) > 0, "INVALID_INPUT", "No packages to install");
  invariant(options.install_timeout === undefined || Number.isInteger(options.install_timeout) && options.install_timeout >= 180 && options.install_timeout <= 600, "INVALID_INPUT", "bm install wait must be 180..600 seconds");
  for (const pkg of [...packages, ...options.shared ?? []]) {
    invariant(path.isAbsolute(pkg) && /\.(hap|hsp)$/i.test(pkg), "INVALID_INPUT", "Use absolute HAP/HSP file paths", { file: pkg });
    invariant(fs.statSync(pkg, { throwIfNoEntry: false })?.isFile(), "NOT_FOUND", `Package not found: ${pkg}`);
  }
  invariant(!options.shared?.some((p) => !/\.hsp$/i.test(p)), "INVALID_INPUT", "shared accepts HSP files only");
  for (const group of [packages, options.shared ?? []]) invariant(new Set(group.map((p) => path.basename(p).toLowerCase())).size === group.length, "INVALID_INPUT", "Duplicate package basenames would overwrite each other on device");
}
export async function install(target: string, packages: string[], signal: AbortSignal, replace = true, options: InstallOptions = {}) {
  validatePackages(packages, options);
  if (packages.length === 1 && !options.shared?.length && options.user === undefined && options.install_timeout === undefined) {
    const result = await hdc(["-t", target, "install", ...(replace ? ["-r"] : []), packages[0]!], signal, 300000, true);
    const text = result.stdout + result.stderr;
    if (result.code !== 0 || !/install bundle successfully/i.test(text)) throw installError(text);
    return { installed: packages.map((p) => path.basename(p)), method: "hdc install" };
  }
  // Multi-HAP/HSP apps must be installed atomically in one bm call.
  const dir = `/data/local/tmp/deveco-${crypto.randomBytes(8).toString("hex")}`;
  const dirs = [{ files: packages, path: `${dir}/app`, flag: "-p" }, { files: options.shared ?? [], path: `${dir}/shared`, flag: "-s" }].filter((d) => d.files.length);
  const { checkedCommand } = await import("./device-controls.js");
  let failure: unknown;
  try {
    await checkedCommand(target, ["mkdir", "-p", ...dirs.map((d) => d.path)], signal);
    for (const group of dirs) for (const [index, pkg] of group.files.entries()) {
      const sent = await hdc(["-t", target, "file", "send", pkg, `${group.path}/${index}${path.extname(pkg)}`], signal, 300000, true);
      invariant(sent.code === 0 && /finish|success/i.test(sent.stdout), "PROCESS_FAILED", `Transfer failed for ${path.basename(pkg)}`, { output: clip(sent.stdout, 500) });
    }
    const result = await shell(target, ["bm", "install", ...dirs.flatMap((d) => [d.flag, d.path]), ...(replace ? ["-r"] : []),
      ...(options.user !== undefined ? ["-u", String(options.user)] : []), ...(options.install_timeout !== undefined ? ["-w", String(options.install_timeout)] : [])], signal, Math.max(300000, (options.install_timeout ?? 0) * 1000 + 10000));
    if (result.code !== 0 || !/install bundle successfully/i.test(result.stdout + result.stderr)) throw installError(result.stdout + result.stderr);
    return { installed: packages.map((p) => path.basename(p)), shared: options.shared?.map((p) => path.basename(p)), user: options.user, method: "bm install" };
  } catch (error) { failure = error; throw error;
  } finally {
    try { await checkedCommand(target, ["rm", "-rf", dir], AbortSignal.timeout(15000)); }
    catch (error) { throw new ToolError("DEVICE_CLEANUP_FAILED", "Owned package staging cleanup failed once; no automatic retry", { path: dir, cause: String(error), original: failure ? String(failure) : undefined }); }
  }
}

const installHints: [RegExp, string][] = [
  [/9568265|install param error/i, "Use files for HAPs and intra-app HSPs together. shared maps to bm -s for inter-app HSPs only; these require system distribution privileges and are not third-party shared modules."],
  [/9568322|signature.*(verif|invalid)|no signature/i, "Package is unsigned or the signature does not match this device. Configure signing (sign action=auto) or use an emulator."],
  [/sign info inconsistent/i, "The installed copy of this app was signed with a different certificate (e.g. before the debug certificate was renewed). Reinstall with run uninstall_first=true — this deletes the app's data on the device, so confirm with the user first."],
  [/9568332|version.*(downgrade|lower)/i, "Installed version is newer. Reinstall with run uninstall_first=true, or increase versionCode."],
  [/9568289|9568297|incompatible|apiVersion|compatible|older sdk version/i, "Device API level is lower than the app's compatibleSdkVersion. Lower compatibleSdkVersion (project create compatible_api) or use a newer device image (doctor shows the compatibility check)."],
  [/9568305|dependent module does not exist|HSP/i, "A shared module (HSP) the app depends on is missing. Build and install it together (run action=deploy installs all packages)."],
  [/9568278|bundleName.*(different|inconsistent)/i, "Packages have different bundle names; install packages from one app together."],
];
function installError(text: string) {
  const code = /code:?\s*(\d{7,8})/i.exec(text)?.[1] ?? /error:?\s*(\d{7,8})/i.exec(text)?.[1];
  const hint = installHints.find(([pattern]) => pattern.test(text))?.[1];
  return new ToolError("INSTALL_FAILED", `Install failed${code ? ` (${code})` : ""}`, { output: clip(text.trim(), 1500) }, hint);
}

/** Like devecocli: success, "not installed" (not an error), or a real failure (error). */
export async function uninstall(target: string, bundle: string, signal?: AbortSignal) {
  const result = await hdc(["-t", target, "uninstall", bundle], signal, 60000, true);
  const text = `${result.stdout}\n${result.stderr}`;
  if (/uninstall bundle successfully|successfully/i.test(text)) return { bundle, uninstalled: true };
  if (/uninstall missing installed bundle|9568386|not installed|does not exist/i.test(text)) return { bundle, uninstalled: false, reason: "not_installed" };
  throw new ToolError("UNINSTALL_FAILED", `Uninstall of ${bundle} failed`, { output: clip(text.trim(), 500) },
    "The app may be protected or in use; check the output, stop it with run action=stop and retry");
}

export async function forceStop(target: string, bundle: string, signal?: AbortSignal) {
  const result = await shell(target, ["aa", "force-stop", bundle], signal);
  invariant(result.code === 0 && !/error|fail|permission denied/i.test(result.stdout + result.stderr), "DEVICE_COMMAND_FAILED", "Ability manager could not stop the app", { output: clip(result.stdout + result.stderr, 1500) });
}

export function wantArgs(want?: { uri?: string; action?: string; parameters?: Record<string, string | number | boolean> }) {
  const quote = (v: string) => "'" + v.replaceAll("'", "'\\''") + "'";
  const args: string[] = [];
  for (const [flag, value] of [["-U", want?.uri], ["-A", want?.action]]) if (value) { invariant(!/[\0\r\n]/.test(value), "INVALID_INPUT", "Invalid Want value"); args.push(flag!, quote(value)); }
  for (const [key, value] of Object.entries(want?.parameters ?? {})) {
    invariant(/^[\w.:-]{1,128}$/.test(key), "INVALID_INPUT", "Invalid Want parameter key");
    invariant(typeof value !== "number" || (Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647), "INVALID_INPUT", "Want integers must fit int32");
    invariant(!/[\0\r\n]/.test(String(value)), "INVALID_INPUT", "Invalid Want parameter value");
    args.push(typeof value === "boolean" ? "--pb" : typeof value === "number" ? "--pi" : "--ps", quote(key), quote(String(value)));
  }
  return args;
}
export async function launch(target: string, bundle: string, ability: string, module: string | undefined, signal?: AbortSignal, want?: { uri?: string; action?: string; parameters?: Record<string, string | number | boolean> }) {
  const extra = wantArgs(want);
  const result = await shell(target, ["aa", "start", "-b", bundle, "-a", ability, ...(module ? ["-m", module] : []), ...extra], signal);
  const text = result.stdout + result.stderr;
  invariant(/start ability successfully/i.test(text), "LAUNCH_FAILED", `Launch failed: ${clip(text.trim(), 400)}`, undefined,
    /10106102|screen is locked/i.test(text) ? "The device screen is locked (a passcode cannot be entered remotely): ask the user to unlock the device, then launch again"
      : /10104001|not exist|does not exist/i.test(text) ? "Ability or bundle not installed — deploy first" : undefined);
  return { launched: true, bundle, ability };
}

/** Identity of the installed copy (changes on every install/update); undefined when not installed. */
export async function installStamp(target: string, bundle: string, signal?: AbortSignal) {
  const dump = (await shell(target, ["bm", "dump", "-n", bundle], signal, 15000).catch(() => undefined))?.stdout ?? "";
  const install = /"installTime":\s*(\d+)/.exec(dump)?.[1], update = /"updateTime":\s*(\d+)/.exec(dump)?.[1];
  return install ? `${install}:${update ?? ""}` : undefined;
}

export async function pidOf(target: string, bundle: string, signal?: AbortSignal): Promise<number | undefined> {
  const out = (await shell(target, ["pidof", bundle], signal, 10000)).stdout.trim();
  const pid = Number(out.split(/\s+/)[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** Launch and watch for a few seconds: process alive and no new crash log means "started". */
export async function launchAndCheck(target: string, bundle: string, ability: string, module: string | undefined, signal: AbortSignal, observeMs = 3000, want?: Parameters<typeof launch>[5]) {
  const before = new Set(await faultlogNames(target, signal));
  await forceStop(target, bundle, signal).catch(() => {});
  await launch(target, bundle, ability, module, signal, want);
  (await import("./repeat.js")).noteLaunch(target);
  const deadline = Date.now() + observeMs;
  let pid: number | undefined;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    pid = await pidOf(target, bundle, signal);
    if (pid) break;
  }
  await new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now())));
  const after = await pidOf(target, bundle, signal);
  const crashes = (await faultlogNames(target, signal)).filter((name) => !before.has(name) && name.includes(bundle));
  const ok = !!after && crashes.length === 0;
  // A missing process without a new crash log is not evidence of a crash.
  const blank = ok ? await (await import("./ui.js")).blankScreen(target, signal) : undefined;
  const smoke = crashes.length ? "FAIL_CRASH" : !after ? "FAIL_NO_PROCESS" : blank?.blank ? "FAIL_BLANK" : "PASS";
  return {
    started: ok, pid: after, crashed: crashes.length > 0, new_crash_logs: crashes, smoke,
    ...(blank ? { screen_uniformity: blank.uniform } : {}),
    ...(smoke === "FAIL_CRASH" ? { next: { tool: "diagnose", action: "crash", target, bundle } } : {}),
    ...(smoke === "FAIL_NO_PROCESS" ? {
      next: { tool: "device", action: "log", target, grep: bundle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), from: "1m" },
      hint: "No app process was observed after launch, and no new crash log was found. Check the installed module/ability, any custom process name, and recent device logs (device action=log without bundle; bundle filtering requires a running PID)",
    } : {}),
    ...(smoke === "FAIL_BLANK" ? { hint: "The app runs but shows a blank screen: check the entry page (loadContent path), build() content and startup errors in device log" } : {}),
  };
}

/* ----------------------------------- logs ----------------------------------- */

/** "30s" / "5m" / "2.5m" / "1h" / "120" (seconds) -> milliseconds. */
export function parseDuration(value: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(value.trim());
  invariant(m, "INVALID_INPUT", `Invalid duration ${value}`, undefined, "Use e.g. 30s, 5m, 1.5h or plain seconds");
  const n = Number(m[1]);
  return Math.round(n * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2] ?? "s"] ?? 1000));
}

/** hilog line timestamp prefix "MM-DD HH:MM:SS.mmm" (lexically sortable within a year). */
const stampOf = (line: string) => /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/.exec(line)?.[1];
function formatStamp(ms: number) {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}
/** Device wall clock as pseudo-UTC ms (same convention as faultlog names). */
async function deviceNow(target: string, signal?: AbortSignal) {
  const s = (await shell(target, ["date +%Y%m%d%H%M%S"], signal, 5000)).stdout.trim();
  const n = (i: number, l: number) => Number(s.slice(i, i + l));
  invariant(/^\d{14}$/.test(s), "DEVICE_UNAVAILABLE", `Unexpected device clock: ${s.slice(0, 40)}`);
  return Date.UTC(n(0, 4), n(4, 2) - 1, n(6, 2), n(8, 2), n(10, 2), n(12, 2));
}

export interface LogOptions {
  lines?: number; bundle?: string; grep?: string; level?: string;
  /** relative window, e.g. from=5m to=1m => logs between 5 and 1 minutes ago (device clock) */
  from?: string; to?: string;
  /** follow: return lines newer than cursor (from a previous call), waiting up to wait_ms for new ones */
  follow?: boolean; cursor?: string; wait_ms?: number;
}

export async function hilog(target: string, options: LogOptions, signal?: AbortSignal) {
  // `-x` (dump buffer) cannot be combined with -z; take the tail via the device shell instead.
  const lines = Math.min(options.lines ?? 300, 20000);
  const filters: string[] = [];
  const levels = ["D", "I", "W", "E", "F"];
  if (options.level) filters.push("-L", levels.slice(levels.indexOf(options.level)).join(","));
  if (options.bundle) {
    const pid = await pidOf(target, options.bundle, signal);
    invariant(pid, "NOT_FOUND", `${options.bundle} is not running`, undefined, "Launch the app, or omit bundle to read all logs");
    filters.push("-P", String(pid));
  }
  // Drop hilog's own permission noise (the query process logs its own PARAM reads).
  const scanLimit = options.grep || options.from || options.to || options.follow ? 50000 : lines;
  let transportTruncated = false;
  const read = async (tail: number) => {
    const result = await shell(target, [`hilog -x ${filters.join(" ")} | grep -v 'C02C02/PARAM' | tail -n ${tail}`], signal, 30000);
    transportTruncated ||= result.truncated === true;
    return result.stdout;
  };

  // Time window: filter by line timestamps; scan a deeper tail so the window is covered.
  let lower: string | undefined, upper: string | undefined;
  if (options.from || options.to) {
    const now = await deviceNow(target, signal);
    if (options.from) lower = formatStamp(now - parseDuration(options.from));
    if (options.to) upper = formatStamp(now - parseDuration(options.to));
    invariant(!lower || !upper || lower <= upper, "INVALID_INPUT", "from must be further in the past than to (e.g. from=5m to=1m)");
  }
  if (options.follow) {
    // Stateless follow: the cursor is the last seen timestamp; poll the ring buffer tail briefly.
    const since = options.cursor ?? formatStamp((await deviceNow(target, signal)) - 1000);
    invariant(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}(?:#\d+)?$/.test(since), "INVALID_INPUT", "cursor must come from a previous follow response");
    const deadline = Date.now() + Math.min(options.wait_ms ?? 5000, 30000);
    let raw = "", selection: ReturnType<typeof selectLogLines>;
    do {
      raw = await read(scanLimit + 1);
      selection = selectLogLines(raw, { limit: lines, grep: options.grep, lower, upper, cursor: since });
      if (selection.scanned_new || Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 700));
      signal?.throwIfAborted();
    } while (true);
    return { ...(await summarizeLog(selection.text)), cursor: selection.cursor ?? since,
      scan: { limit: scanLimit, possibly_truncated: transportTruncated || raw.split(/\r?\n/).filter(Boolean).length > scanLimit, has_more: selection.has_more },
      next: "Call again with follow=true and this cursor; the cursor tracks consumed lines, including non-matches" };
  }
  let raw: string;
  if (lower) {
    // Busy devices log >100k lines/hour, so a fixed tail misses older windows. Pre-filter on the
    // device by minute prefixes ("MM-DD HH:MM", fixed-string grep; no awk on devices), then trim
    // the exact bounds locally. Windows longer than 3h fall back to the newest 50k lines.
    const start = Date.UTC(2000, Number(lower.slice(0, 2)) - 1, Number(lower.slice(3, 5)), Number(lower.slice(6, 8)), Number(lower.slice(9, 11)));
    const endStamp = upper ?? formatStamp(await deviceNow(target, signal));
    const end = Date.UTC(2000, Number(endStamp.slice(0, 2)) - 1, Number(endStamp.slice(3, 5)), Number(endStamp.slice(6, 8)), Number(endStamp.slice(9, 11)));
    const minutes = Math.floor((end - start) / 60000) + 1;
    if (minutes <= 180) {
      const prefixes = Array.from({ length: minutes }, (_, i) => formatStamp(start + i * 60000).slice(0, 11));
      const pattern = prefixes.map((p) => `-e '${p}'`).join(" ");
      const result = await shell(target, [`hilog -x ${filters.join(" ")} | grep -F ${pattern} | grep -v 'C02C02/PARAM' | tail -n ${scanLimit + 1}`], signal, 60000);
      raw = result.stdout;
      transportTruncated ||= result.truncated === true;
    } else raw = await read(scanLimit + 1);
  } else raw = await read(scanLimit + 1);
  const selection = selectLogLines(raw, { limit: lines, grep: options.grep, lower, upper });
  return { ...(await summarizeLog(selection.text)),
    scan: { limit: scanLimit, possibly_truncated: transportTruncated || raw.split(/\r?\n/).filter(Boolean).length > scanLimit, has_more: selection.has_more },
    ...(lower || upper ? { window: { from: lower ?? null, to: upper ?? null } } : {}) };
}

/** Filter before limiting. Follow pages consume matching lines chronologically, including timestamp ties. */
export function selectLogLines(raw: string, options: { limit: number; grep?: string; lower?: string; upper?: string; cursor?: string }) {
  let pattern: RegExp | undefined;
  if (options.grep) {
    try { pattern = new RegExp(options.grep, "i"); }
    catch { pattern = new RegExp(options.grep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
  }
  const [since, consumed] = (options.cursor ?? "").split("#"), counts = new Map<string, number>();
  const records = raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const stamp = stampOf(line), n = (counts.get(stamp ?? "") ?? 0) + 1;
    if (stamp) counts.set(stamp, n);
    return { line, stamp, n, cursor: stamp ? `${stamp}#${n}` : undefined };
  }).filter((r) => !options.cursor || r.stamp && (r.stamp > since! || r.stamp === since && consumed !== undefined && r.n > Number(consumed)));
  const matched = records.filter((r) => (!options.lower || r.stamp && r.stamp >= options.lower) && (!options.upper || r.stamp && r.stamp <= options.upper) && (!pattern || pattern.test(r.line)));
  const picked = options.cursor ? matched.slice(0, options.limit) : matched.slice(-options.limit);
  const hasMore = matched.length > picked.length;
  return { text: picked.map((r) => r.line).join("\n"), has_more: hasMore, scanned_new: records.length,
    cursor: (hasMore ? picked.at(-1) : records.at(-1))?.cursor ?? options.cursor };
}

async function summarizeLog(stdout: string, grep?: string) {
  let lines = stdout.split(/\r?\n/).filter(Boolean);
  if (grep) {
    let pattern: RegExp;
    try { pattern = new RegExp(grep, "i"); } catch { pattern = new RegExp(grep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
    lines = lines.filter((l) => pattern.test(l));
  }
  const text = lines.join("\n");
  const artifact = text.length > 8000 ? await saveArtifact(text) : undefined;
  if (!artifact) return { lines: lines.length, errors: lines.filter((l) => /\s[EF]\s/.test(l)).slice(-20), tail: text };
  // Long logs: the full text is in the artifact; inline stays under ~7 KB whatever the line lengths
  // (errors up to 3 KB, the tail fills the rest; single lines clipped to 300 chars).
  const clip = (l: string) => (l.length > 300 ? `${l.slice(0, 300)}…` : l);
  const fit = (items: string[], budget: number) => {
    const out: string[] = [];
    for (let i = items.length - 1, used = 0; i >= 0; i--) { const l = clip(items[i]!); if (used + l.length + 1 > budget) break; out.unshift(l); used += l.length + 1; }
    return out;
  };
  const errors = fit(lines.filter((l) => /\s[EF]\s/.test(l)).slice(-20), 3000);
  const tail = fit(lines.slice(-40), 7000 - errors.join("\n").length);
  return { lines: lines.length, errors, tail: tail.join("\n"), artifact_id: artifact.artifact_id, ...(tail.length < Math.min(40, lines.length) ? { tail_lines: tail.length } : {}) };
}

export async function clearLog(target: string, signal?: AbortSignal) {
  await shell(target, ["hilog", "-r"], signal);
  return { cleared: true };
}

const faultDir = "/data/log/faultlog/faultlogger";
/** Strict scan distinguishes an empty service inventory from an unreadable inventory. */
export async function faultlogInventory(target: string, signal?: AbortSignal) {
  const listing = await shell(target, ["ls", faultDir], signal, 10000);
  const direct = listing.code === 0 && !/denied|not found|No such file|error|failed/i.test(listing.stdout + listing.stderr);
  const dump = direct ? undefined : await shell(target, ["hidumper", "-s", "1201", "-a", "-p Faultlogger"], signal, 15000);
  const raw = direct ? listing.stdout : dump?.stdout ?? "";
  const artifact = await saveArtifact(JSON.stringify({ listing, service: dump }), "application/json");
  invariant(direct || dump?.code === 0 && /Fault log list:/.test(raw), "EVIDENCE_MISSING", "Neither directory nor Faultlogger returned a readable crash inventory", { scan_artifact: artifact.artifact_id });
  const names = [...new Set([...raw.matchAll(/(?:jscrash|cppcrash|appfreeze|sysfreeze)-[A-Za-z0-9_.-]+/g)].map((m) => m[0]))];
  return { names, source: direct ? "directory" : "Faultlogger", scan_artifact: artifact.artifact_id };
}

export async function faultlogNames(target: string, signal?: AbortSignal): Promise<string[]> {
  const listing = await shell(target, ["ls", faultDir], signal, 10000).catch(() => undefined);
  const names = new Set<string>();
  for (const match of (listing?.stdout ?? "").matchAll(/(?:jscrash|cppcrash|appfreeze|sysfreeze)-[A-Za-z0-9_.-]+/g)) names.add(match[0]);
  if (!names.size) {
    const dump = await shell(target, ["hidumper", "-s", "1201", "-a", "-p Faultlogger"], signal, 15000).catch(() => undefined);
    for (const match of (dump?.stdout ?? "").matchAll(/(?:jscrash|cppcrash|appfreeze|sysfreeze)-[A-Za-z0-9_.-]+/g)) names.add(match[0]);
  }
  return [...names];
}

/** Read a fault log via shell, falling back to file recv on production devices. */
export async function readFaultlog(target: string, name: string, signal?: AbortSignal): Promise<string> {
  invariant(/^[A-Za-z0-9_.-]+$/.test(name), "INVALID_INPUT", "Invalid fault log name");
  const cat = await shell(target, ["cat", `${faultDir}/${name}`], signal, 15000);
  if (cat.stdout.trim() && !/Permission denied|No such file/i.test(cat.stdout)) return cat.stdout;
  // Production devices: the Faultlogger service returns the report even when the directory is closed.
  const dumped = await shell(target, ["hidumper", "-s", "1201", "-a", `-p Faultlogger -f ${name.replace(/\.log$/, "")}`], signal, 20000).catch(() => undefined);
  const body = dumped?.stdout.split(/-{10,}HiviewService-{10,}/)[1]?.trim();
  if (body && /Generated by|Timestamp:|Module name:/.test(body)) return body;
  const local = path.join(artifactDir(), `fault-${crypto.randomBytes(4).toString("hex")}.log`);
  const recv = await hdc(["-t", target, "file", "recv", `${faultDir}/${name}`, local], signal, 30000, true);
  invariant(fs.existsSync(local), "NOT_FOUND", `Cannot read ${name}`, { output: clip(recv.stdout, 300) });
  const text = fs.readFileSync(local, "utf8");
  fs.rmSync(local, { force: true });
  return text;
}

/* ----------------------------------- files ----------------------------------- */

export async function sendFile(target: string, local: string, remote: string, signal?: AbortSignal) {
  invariant(fs.existsSync(local), "NOT_FOUND", `${local} does not exist`);
  const result = await hdc(["-t", target, "file", "send", local, remote], signal, 300000, true);
  invariant(/finish|success/i.test(result.stdout), "PROCESS_FAILED", `Send failed: ${clip(result.stdout, 300)}`);
  return { sent: local, remote };
}
export async function recvFile(target: string, remote: string, local: string, signal?: AbortSignal) {
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const result = await hdc(["-t", target, "file", "recv", remote, local], signal, 300000, true);
  invariant(fs.existsSync(local), "PROCESS_FAILED", `Receive failed: ${clip(result.stdout, 300)}`);
  return { received: remote, local, bytes: fs.statSync(local).size };
}

/* ---------------------------------- sqlite ---------------------------------- */

const readonlySql = /^\s*(select|pragma|with|explain|\.tables|\.schema|\.indexes|\.dbinfo)\b/i;
export function readonlySqlAllowed(sql: string) {
  return sql.split(/;\s*(?=\S)/).map((s) => s.trim()).filter(Boolean).every((s) => readonlySql.test(s));
}

/** Query an on-device SQLite database (app rdb stores, preferences, ...). Read-only unless write=true. */
/** App RDB stores of debuggable apps: /data/app/el2/<user>/database/<bundle>/<module>/rdb/<name>. */
export function appDatabasePath(bundle: string, name: string, module?: string) {
  invariant(module, "INVALID_INPUT", "A relative db name needs the owning module; no default is assumed", undefined, "Pass module from module.json5 (e.g. entry or default), or use an absolute db path");
  invariant(/^[\w.]+$/.test(bundle) && /^[\w.-]+$/.test(name) && /^[\w-]+$/.test(module), "INVALID_INPUT", "Invalid bundle, module or database name");
  return `/data/app/el2/100/database/${bundle}/${module}/rdb/${name}`;
}

export async function sqlite(target: string, db: string, sql: string, options: { write?: boolean; limit?: number } = {}, signal?: AbortSignal) {
  invariant((db === ":memory:" || db.startsWith("/")) && !/['"`$;|&<>\n]/.test(db), "INVALID_INPUT", "db must be an absolute device path (or :memory:) without shell characters");
  invariant(sql.trim(), "INVALID_INPUT", "sql is required");
  if (!options.write)
    invariant(readonlySqlAllowed(sql), "INVALID_INPUT", "Only SELECT/PRAGMA/WITH/EXPLAIN and .tables/.schema are allowed", undefined, "Pass write=true to modify the database (be careful: the app may hold it open)");
  // Pass SQL through stdin-free argv; single-quote escape for the device shell.
  const quoted = `'${sql.replace(/'/g, `'\\''`)}'`;
  const dot = /^\s*\./.test(sql);
  const result = await shell(target, [`sqlite3 ${dot ? "" : "-json "}${options.write ? "" : "-readonly "}'${db}' ${quoted}`], signal, 30000);
  const text = (result.stdout + result.stderr).trim();
  invariant(!/^(Error|Parse error|Runtime error)/m.test(text), "SQLITE_FAILED", text.slice(0, 500),
    { db }, /unable to open/i.test(text) ? "Verify the exact bundle, owning module and db name, and that the debuggable app has created the database. App databases live under /data/app/el2/100/database/<bundle>/<module>/rdb/<name>" : undefined);
  if (dot || !text) return { output: text.slice(0, 20000) };
  let rows: unknown[];
  try { rows = JSON.parse(text) as unknown[]; } catch { return { output: text.slice(0, 20000) }; }
  const limit = options.limit ?? 200;
  const artifact = rows.length > limit ? await saveArtifact(JSON.stringify(rows), "application/json") : undefined;
  return { rows: rows.slice(0, limit), total: rows.length, ...(artifact ? { artifact_id: artifact.artifact_id } : {}) };
}

/** Query-only executables can accept arguments; mixed read/write commands need explicit query forms. */
const readonlyCommands = new Set(["ls", "cat", "ps", "top", "df", "du", "pidof", "uname", "free", "uptime", "id", "whoami", "netstat"]);
const queryCommands = ["param", "hidumper", "bm", "aa", "date", "getprop", "wm", "hilog", "mount", "ifconfig", "power-shell"];
export function readonlyShellArgs(command: string): string[] {
  invariant(!/[;&|`$<>\r\n\0'"\\]/.test(command), "INVALID_INPUT", "Shell operators, quotes and escapes are not allowed in read-only shell");
  const parts = command.trim().split(/\s+/);
  const [head = "", ...args] = parts;
  let allowed = readonlyCommands.has(head);
  switch (head) {
    case "mount": allowed = args.length === 0; break;
    case "ifconfig": allowed = args.length === 0 || (args.length === 1 && /^(?:-a|[A-Za-z][A-Za-z0-9_.:-]*)$/.test(args[0]!)); break;
    case "date": allowed = /^(?:-u(?: \+[^ ]+)?|\+[^ ]+|--help)?$/.test(args.join(" ")); break;
    case "getprop": allowed = args.length <= 1 && (!args.length || /^[\w.]+$/.test(args[0]!)); break;
    case "param": allowed = args[0] === "get" && args.length <= 2 && (args.length === 1 || /^[\w.]+$/.test(args[1]!)); break;
    case "aa": allowed = args[0] === "dump"; break;
    case "bm": allowed = args[0] === "dump" || (args.length === 4 && args[0] === "quickfix" && args[1] === "-q" && args[2] === "-b" && /^[A-Za-z][A-Za-z0-9_.]*$/.test(args[3]!)); break;
    case "hidumper": allowed = args.length === 0 || (args.length === 1 && ["-h", "-l"].includes(args[0]!)) || (args.length === 2 && args[0] === "-s" && /^[\w.]+$/.test(args[1]!)); break;
    case "wm": allowed = args.length === 1 && ["help", "size", "density"].includes(args[0]!); break;
    case "hilog": allowed = args.length === 1 && ["-h", "--help", "-x"].includes(args[0]!); break;
    case "power-shell": allowed = args.length === 1 && args[0] === "dump"; break;
  }
  invariant(allowed, "INVALID_INPUT", `Unsupported read-only command form: ${head}`, { commands: [...readonlyCommands, ...queryCommands] },
    "Use query-only arguments; use device action=log for filtered logs or explicit clear, and ui screenshot for screen capture");
  return parts;
}
export async function readonlyShell(target: string, command: string, signal?: AbortSignal) {
  const parts = readonlyShellArgs(command);
  const result = await shell(target, parts, signal, 30000);
  const text = result.stdout + (result.stderr ? `\n${result.stderr}` : "");
  const artifact = text.length > 12000 ? await saveArtifact(text) : undefined;
  return { exit_code: result.code, output: clip(text, 12000), ...(artifact ? { artifact_id: artifact.artifact_id } : {}) };
}
