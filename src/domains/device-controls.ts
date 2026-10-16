import { setTimeout as delay } from "node:timers/promises";
import { invariant, ToolError } from "../core/errors.js";
import { shell, deviceInfo, forceStop, uninstall, wantArgs } from "./device.js";
import { systemScenario } from "./scenario.js";
import { displayControl, dumpTree, listWindows, invalidate } from "./ui.js";

/** Reject fields for a different operation before any device side effects. */
export function validateControl(input: Record<string, unknown>) {
  const operations: Record<string, Record<string, string[]>> = {
    app: { list: ["offset", "limit"], info: ["bundle"], foreground: [], start: ["bundle", "ability", "module", "want"], stop: ["bundle"], uninstall: ["bundle", "allow_data_reset"], clear_cache: ["bundle"], clear_data: ["bundle", "allow_data_reset"], install: ["files", "shared", "replace", "user", "install_timeout", "wait", "request_key"] },
    file: { exists: ["remote"], delete: ["remote"] }, clipboard: { read: [], write: ["text"], clear: [] },
    screen: { size: [], status: [], wake: [], sleep: [], rotation: [], rotate: ["value"], rotation_lock: ["value"], sleeptime: ["value"], viewmode: ["value"] },
    system: { time: ["value"], timezone: ["value"], unlock: [], control_center: [], notification_center: [] },
  };
  const fields = operations[String(input.action)]?.[String(input.operation)];
  invariant(fields, "INVALID_INPUT", `Unknown ${input.action} operation`, { operations: Object.keys(operations[String(input.action)] ?? {}) });
  const unused = Object.keys(input).filter((k) => input[k] !== undefined && !["action", "operation", "target", ...fields].includes(k));
  invariant(!unused.length, "INVALID_INPUT", `Unused fields for ${input.action}.${input.operation}: ${unused.join(", ")}`);
  if (input.action === "file") invariant(typeof input.remote === "string", "INVALID_INPUT", "file requires remote path");
  if (input.action === "system") invariant(input.value === undefined || typeof input.value === "string", "INVALID_INPUT", "System value must be a string");
}

export function shellValue(value: string): string {
  invariant(!value.includes("\0"), "INVALID_INPUT", "Device arguments cannot contain NUL");
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function identifier(value: string | undefined, field: string): asserts value is string {
  invariant(value && /^[A-Za-z_][\w.]*$/.test(value), "INVALID_INPUT", `Invalid ${field}`);
}
export async function checkedCommand(target: string, args: string[], signal?: AbortSignal, content = false) {
  // One shell program: HDC auto-quotes separate arguments containing spaces, which otherwise
  // preserves our quotes literally and can expand $/backticks in the added double quotes.
  const result = await shell(target, [args.join(" ")], signal, 15000);
  invariant(!result.truncated, "DEVICE_OUTPUT_INVALID", "Device output exceeded the capture limit; cannot return incomplete evidence");
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const diagnostic = content ? result.stderr : output;
  const unsupported = /(?:testhelper|power-shell).*(?:not found|inaccessible)|unknown (?:command|option)|not supported|permission denied|Get parameter .*fail! errNum is:1002/i.test(diagnostic);
  invariant(!unsupported, "CAPABILITY_UNAVAILABLE", "Device does not support or permit this operation", { command: args.slice(0, 2), output: output.slice(0, 1500) });
  invariant(result.code === 0 && !/^(?:error\b|failed\b|failure\b|\[fail\])|\bfailed to\b|Get parameter .*fail!/im.test(diagnostic), "DEVICE_COMMAND_FAILED", "Device command failed", { command: args.slice(0, 2), output: output.slice(0, 1500) });
  return content ? result.stdout : result.stdout.trim();
}

export function parseBundleInfo(output: string) {
  const start = output.indexOf("{");
  invariant(start >= 0, "DEVICE_OUTPUT_INVALID", "Bundle manager returned no JSON object");
  let data: Record<string, unknown>;
  try { data = JSON.parse(output.slice(start)); }
  catch { throw new ToolError("DEVICE_OUTPUT_INVALID", "Bundle manager returned invalid JSON"); }
  invariant(data && typeof data === "object" && !Array.isArray(data), "DEVICE_OUTPUT_INVALID", "Expected bundle object");
  return data;
}
export function parseForeground(output: string) {
  invariant(/AbilityRecord|Mission|User ID|user ID|mission list|no ability/i.test(output), "DEVICE_OUTPUT_INVALID", "Unrecognized ability manager output", { output: output.slice(0, 1000) });
  return output.split(/(?=AbilityRecord ID #)/).filter((s) => /^\s*state #FOREGROUND\b/im.test(s)).map((s) => {
    const bundle = /app name \[([^\]]+)\]/.exec(s)?.[1], ability = /main name \[([^\]]+)\]/.exec(s)?.[1];
    invariant(bundle && ability, "DEVICE_OUTPUT_INVALID", "Foreground record lacks bundle or ability");
    return { bundle, ability };
  });
}
export interface AppInput {
  operation: string; bundle?: string; ability?: string; module?: string;
  want?: { uri?: string; action?: string; parameters?: Record<string, string | number | boolean> };
  allow_data_reset?: boolean; offset?: number; limit?: number;
}
export async function appControl(target: string, input: AppInput, signal: AbortSignal) {
  const { operation } = input;
  if (operation === "list") {
    const output = await checkedCommand(target, ["bm", "dump", "-a"], signal);
    invariant(/All bundle|bundleName|^ID:\s*\d+:|^\s*(?:[A-Za-z_]\w*\.)+[\w.]+\s*$/im.test(output), "DEVICE_OUTPUT_INVALID", "Unrecognized bundle listing", { output: output.slice(0, 1000) });
    const bundles = [...new Set(output.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[A-Za-z_]\w*(?:\.[\w]+)+$/.test(s)))];
    const offset = input.offset ?? 0, limit = input.limit ?? 50;
    return { target, total: bundles.length, bundles: bundles.slice(offset, offset + limit), next_offset: offset + limit < bundles.length ? offset + limit : null };
  }
  if (operation === "foreground") return { target, applications: parseForeground(await checkedCommand(target, ["aa", "dump", "-l"], signal)) };
  if (operation === "start") {
    if (input.bundle) identifier(input.bundle, "bundle");
    if (input.ability) invariant(/^[\w.$-]+$/.test(input.ability), "INVALID_INPUT", "Invalid ability");
    if (input.module) invariant(/^[\w.-]+$/.test(input.module), "INVALID_INPUT", "Invalid module");
    invariant((input.bundle && input.ability) || input.want?.uri || input.want?.action, "INVALID_INPUT", "start needs bundle+ability or want.uri/action");
    const args = ["aa", "start", ...(input.bundle ? ["-b", input.bundle] : []), ...(input.ability ? ["-a", shellValue(input.ability)] : []), ...(input.module ? ["-m", shellValue(input.module)] : []), ...wantArgs(input.want)];
    const output = await checkedCommand(target, args, signal);
    invariant(/start ability successfully/i.test(output), "LAUNCH_FAILED", "Ability manager did not confirm launch", { output });
    invalidate(target);
    return { target, command_confirmed: true, runtime_verified: false, output, next: { tool: "device", action: "app", operation: "foreground", target } };
  }
  identifier(input.bundle, "bundle");
  if (operation === "info") {
    const data = parseBundleInfo(await checkedCommand(target, ["bm", "dump", "-n", input.bundle], signal));
    return { target, bundle: data.name ?? input.bundle, version_name: data.versionName, version_code: data.versionCode, entry_module: data.entryModuleName,
      modules: Array.isArray(data.hapModuleInfos) ? data.hapModuleInfos.filter((m) => m && typeof m === "object").map((m: Record<string, unknown>) => ({ name: m.moduleName ?? m.name, main_ability: m.mainAbility, device_types: m.deviceTypes })) : [],
      next: { tool: "device", action: "shell", target, command: `bm dump -n ${input.bundle}` } };
  }
  if (operation === "stop") { await forceStop(target, input.bundle, signal); return { target, bundle: input.bundle, command_confirmed: true }; }
  if (operation === "uninstall") {
    invariant(input.allow_data_reset, "DATA_RESET_REQUIRED", "uninstall requires allow_data_reset=true");
    return { target, ...await uninstall(target, input.bundle, signal) };
  }
  if (operation === "clear_data") return systemScenario(target, { ...input, operation }, signal);
  invariant(operation === "clear_cache", "INVALID_INPUT", "Unknown app operation");
  const output = await checkedCommand(target, ["bm", "clean", "-c", "-n", input.bundle], signal);
  invariant(/success/i.test(output), "DEVICE_OUTPUT_INVALID", "Bundle manager did not confirm cache cleanup", { output });
  return { target, bundle: input.bundle, cache_cleared: true, output };
}

export async function deviceFile(target: string, operation: string, remote: string, signal: AbortSignal) {
  invariant(remote.startsWith("/") && remote !== "/" && !remote.split("/").includes(".."), "INVALID_INPUT", "Use an absolute device file path without parent traversal");
  const file = shellValue(remote);
  const inspect = async () => {
    const out = await checkedCommand(target, [`if [ -f ${file} ] || [ -L ${file} ]; then echo file; elif [ -d ${file} ]; then echo directory; elif ls -ld ${file} >/dev/null 2>&1; then echo other; else ls -ld ${file} 2>&1; fi`], signal);
    if (["file", "directory", "other"].includes(out)) return out;
    if (/No such file or directory/i.test(out)) return "missing";
    throw new ToolError("DEVICE_OUTPUT_INVALID", "Cannot determine file existence", { output: out.slice(0, 1000) });
  };
  // ls reports ENOENT with a nonzero code; preserve permission/transport errors separately.
  const inspectPath = async () => {
    try { return await inspect(); }
    catch (error) {
      if (error instanceof ToolError && error.code === "DEVICE_COMMAND_FAILED" && /No such file or directory/i.test(String(error.details?.output))) return "missing";
      throw error;
    }
  };
  const before = await inspectPath();
  if (operation === "exists") return { target, path: remote, exists: before !== "missing", kind: before };
  invariant(operation === "delete", "INVALID_INPUT", "file operation must be exists|delete");
  invariant(before !== "directory" && before !== "other", "INVALID_INPUT", "File deletion does not recursively remove directories or special files");
  if (before === "missing") return { target, path: remote, deleted: false, reason: "not_found" };
  await checkedCommand(target, ["rm", "-f", "--", file], signal);
  invariant(await inspectPath() === "missing", "DELETE_NOT_CONFIRMED", "File still exists after deletion", { path: remote });
  return { target, path: remote, deleted: true };
}

export async function clipboard(target: string, operation: string, text: string | undefined, signal: AbortSignal) {
  invariant(["read", "write", "clear"].includes(operation), "INVALID_INPUT", "clipboard operation must be read|write|clear");
  if (operation === "write") invariant(text !== undefined, "INVALID_INPUT", "clipboard write requires text");
  const read = async () => {
    const output = await checkedCommand(target, ["testhelper", "get-pastedata"], signal, true);
    // testhelper prints a fixed label and exactly one terminal newline, not clipboard content.
    invariant(output.startsWith("Pasteboard text: ") && output.endsWith("\n"), "DEVICE_OUTPUT_INVALID", "Unrecognized clipboard response");
    return output.slice("Pasteboard text: ".length, -1);
  };
  if (operation === "read") return { target, text: await read() };
  await checkedCommand(target, ["testhelper", operation === "write" ? "set-pastedata" : "clear-pastedata", ...(operation === "write" ? [shellValue(text!)] : [])], signal);
  invariant(await read() === (operation === "write" ? text : ""), "DEVICE_OUTPUT_INVALID", "Clipboard readback differs from requested content; not retried");
  return { target, command_confirmed: true, content_verified: true };
}

export async function screenControl(target: string, operation: string, value: number | boolean | string | undefined, signal: AbortSignal) {
  if (operation === "size") return { target, screen: (await deviceInfo(target, signal)).screen };
  if (["rotation", "rotate", "rotation_lock"].includes(operation)) return displayControl(target, operation, value, signal);
  if (operation === "viewmode") {
    invariant(value === undefined || value === "dark" || value === "light", "INVALID_INPUT", "viewmode value must be dark|light; omit to query");
    const read = () => checkedCommand(target, ["param", "get", "persist.ace.darkmode"], signal);
    const before = await read();
    invariant(["dark", "light"].includes(before), "CAPABILITY_UNAVAILABLE", "Device does not expose a recognized viewmode", { output: before });
    if (value !== undefined && before !== value) await checkedCommand(target, ["testhelper", "set-viewmode", value], signal);
    const after = value === undefined ? before : await read();
    return { target, value: after, previous: before, verified: value === undefined ? undefined : after === value };
  }
  if (operation === "sleeptime") {
    invariant(value === "restore" || typeof value === "number" && (value === -1 || Number.isInteger(value) && value >= 5000 && value <= 3600000), "INVALID_INPUT", "sleeptime value: -1, 5000..3600000 ms, or restore");
    await checkedCommand(target, ["hidumper", "-s", "PowerManagerService", "-a", "-f"], signal);
    await checkedCommand(target, ["power-shell", "timeout", "-r"], signal);
    if (value !== "restore") await checkedCommand(target, value === -1 ? ["hidumper", "-s", "PowerManagerService", "-a", "-t"] : ["power-shell", "timeout", "-o", String(value)], signal);
    return { target, value, command_confirmed: true, state_verified: false, restore: { tool: "device", action: "screen", operation, value: "restore", target } };
  }
  invariant(["wake", "sleep", "status"].includes(operation), "INVALID_INPUT", "Unknown screen operation");
  if (operation !== "status") await checkedCommand(target, ["power-shell", operation === "wake" ? "wakeup" : "suspend"], signal);
  const output = await checkedCommand(target, ["hidumper", "-s", "PowerManagerService", "-a", "-s"], signal);
  const state = /Current State:\s*(\w+)/.exec(output)?.[1];
  invariant(state, "DEVICE_OUTPUT_INVALID", "Power manager did not expose screen state", { output: output.slice(0, 1000) });
  return { target, state, ...(operation !== "status" ? { verified: operation === "wake" ? state === "AWAKE" : ["SLEEP", "INACTIVE"].includes(state) } : {}) };
}

export async function systemControl(target: string, operation: string, value: string | undefined, signal: AbortSignal) {
  if (operation === "time" || operation === "timezone") {
    if (value !== undefined) {
      invariant(operation === "time" ? /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) && Number.isFinite(Date.parse(value.replace(" ", "T") + "Z")) && new Date(value.replace(" ", "T") + "Z").toISOString().slice(0, 19).replace("T", " ") === value
        : /^[A-Za-z0-9_+\-/]{1,100}$/.test(value), "INVALID_INPUT", "Invalid time/timezone value");
    }
    const read = async () => {
      const output = await checkedCommand(target, ["testhelper", `get-${operation}`], signal);
      const match = (operation === "time" ? /^Current system time: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/ : /^Current timezone: ([A-Za-z0-9_+\-/]+)$/).exec(output);
      invariant(match, "DEVICE_OUTPUT_INVALID", "Unrecognized time/timezone response", { output });
      return match[1]!;
    };
    const before = await read();
    if (value !== undefined) await checkedCommand(target, ["testhelper", `set-${operation}`, shellValue(value)], signal);
    const after = value === undefined ? before : await read();
    return { target, value: after, previous: before, ...(value !== undefined ? { command_confirmed: true, state_verified: operation === "timezone" && after === value } : {}) };
  }
  invariant(["unlock", "control_center", "notification_center"].includes(operation), "INVALID_INPUT", "Unknown system operation");
  const type = await checkedCommand(target, ["param", "get", "const.product.devicetype"], signal);
  invariant(["phone", "tablet"].includes(type), "CAPABILITY_UNAVAILABLE", "System gestures are supported only on phone/tablet", { device_type: type });
  if (operation === "unlock") await screenControl(target, "wake", undefined, signal);
  const screen = (await deviceInfo(target, signal)).screen;
  invariant(screen, "CAPABILITY_UNAVAILABLE", "Cannot determine display bounds");
  const before = await listWindows(target, true, signal);
  const x = Math.round(screen.width * (operation === "unlock" ? .5 : operation === "control_center" ? .8 : .2));
  await checkedCommand(target, ["uitest", "uiInput", "swipe", String(x), String(Math.round(screen.height * (operation === "unlock" ? .98 : .02))), String(x), String(Math.round(screen.height * (operation === "unlock" ? .48 : .35))), "6000"], signal);
  invalidate(target); await delay(300, undefined, { signal });
  const windows = await listWindows(target, true, signal);
  const nodes = await dumpTree(target, signal);
  return { target, operation, command_confirmed: true, state_verified: false, window_changed: JSON.stringify(before) !== JSON.stringify(windows), windows,
    controls: nodes.filter((n) => n.text).slice(0, 25).map((n) => ({ text: n.text, key: n.key })),
    hint: operation === "unlock" ? "A swipe is not proof of unlock; credential-protected locks require the user. Inspect the returned window/controls." : "Inspect the returned system controls or assert the intended panel; a successful swipe alone does not prove the panel opened." };
}
