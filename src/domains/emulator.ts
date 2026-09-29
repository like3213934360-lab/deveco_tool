import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invariant, ToolError } from "../core/errors.js";
import { clip } from "../core/files.js";
import { run, spawnIndependent } from "../core/proc.js";
import { toolCommand } from "../core/toolchain.js";
import { listTargets, shell } from "./device.js";

async function emulator(args: string[], signal?: AbortSignal, timeoutMs = 120000) {
  const result = await run(toolCommand("emulator", args), { signal, timeoutMs, allowFailure: true });
  return (result.stdout + result.stderr).trim();
}

/*
 * The Emulator CLI exits 0 even when an operation fails ("Device delete fail.", "No images are
 * available ..."), so success is decided from its output (same rule as deveco-cli runEmulatorChecked).
 */
const baseReject = /Invalid command|无效命令|please attach the correct parameter/i;
export function emulatorFailure(op: string, output: string): { code: string; hint?: string } | undefined {
  const notFound: Record<string, RegExp> = {
    delete: /does not exist|not exist/i, stop: /not exists?\b/i, remove_image: /No images are available/i,
  };
  const rejects: Record<string, RegExp> = {
    create: /Device create fail|already exists|Invalid OS version|cannot be empty|not (?:been )?downloaded|is not found|not exists/i,
    delete: /Device delete fail/i,
    stop: /\bfailed\b/i,
    install_image: /incorrect|not possible|download(?:ing)? fail|install(?:ation)? fail/i,
    remove_image: /fail/i,
  };
  if (notFound[op]?.test(output)) return { code: "NOT_FOUND", hint: op === "remove_image" ? "List downloaded images with emulator action=images" : "List emulators with emulator action=list" };
  if (baseReject.test(output) || rejects[op]?.test(output)) return { code: "EMULATOR_FAILED" };
  return undefined;
}
async function emulatorChecked(op: string, args: string[], signal?: AbortSignal, timeoutMs?: number) {
  const out = await emulator(args, signal, timeoutMs);
  const failure = emulatorFailure(op, out);
  if (failure) throw new ToolError(failure.code, `Emulator ${op} failed: ${clip(out.split("\n").filter((l) => l.trim()).join(" "), 400)}`, { args: args.filter((a) => a !== "-force") }, failure.hint);
  return out;
}

export async function listEmulators(signal?: AbortSignal, details = false, instancePath?: string) {
  const where = instancePath ? ["-instancePath", instancePath] : [];
  const text = await emulator(["-list", "-details", ...where], signal, 30000).catch(() => emulator(["-list", ...where], signal, 30000));
  if (details) { try { return JSON.parse(text) as Record<string, string>[]; } catch { /* plain list below */ } }
  const running = await runningNames(signal);
  const names = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^\[Empty\]$/.test(l));
  // `-list -details` returns JSON on current releases; plain names otherwise.
  try {
    const parsed = JSON.parse(text) as Record<string, string>[];
    return parsed.map((e) => ({
      name: e.name, device_type: e.deviceType, model: e.productModel, os: e["os.osVersion"], api: e["os.apiVersion"],
      screen: e["hw.lcd.single.width"] ? `${e["hw.lcd.single.width"]}x${e["hw.lcd.single.height"]}` : undefined,
      running: running.has(e.name!) || e.isRunning === "true",
    }));
  } catch {
    return names.map((name) => ({ name, running: running.has(name) }));
  }
}

async function runningNames(signal?: AbortSignal) {
  const names = new Set<string>();
  for (const target of await listTargets(signal).catch(() => [])) {
    const name = (await shell(target, ["param", "get", "ohos.qemu.hvd.name"], signal, 5000).catch(() => undefined))?.stdout.trim();
    if (name && !/fail|error/i.test(name)) names.add(name);
  }
  return names;
}

/*
 * License agreements: the Emulator refuses to start/create/download until the HarmonyOS software and
 * SDK agreements are accepted (state in ~/Library/Caches/Huawei/Emulator<ver>/.emu_config, or
 * %LOCALAPPDATA%\Huawei\Emulator<ver> on Windows). Like DevEco Studio's first-run dialog, operations
 * accept them automatically (auto_accept_license=false disables it) and report that they did.
 */
let emulatorVersion: string | undefined;
/** `.emu_config` of the installed Emulator (<major>.<minor> data dir, same rule as deveco-cli). */
async function licenseConfig(signal?: AbortSignal) {
  emulatorVersion ??= /(\d+\.\d+)\.\d+/.exec(await emulator(["-version"], signal, 15000))?.[1];
  invariant(emulatorVersion, "EMULATOR_FAILED", "Cannot read the Emulator version");
  const base = process.env.DEVECO_EMULATOR_CONFIG_DIR
    ?? (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? "", "Huawei")
      : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Caches", "Huawei")
      : path.join(process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache"), "Huawei"));
  return path.join(base, `Emulator${emulatorVersion}`, ".emu_config");
}
/** Pure check of a `.emu_config` text: both agreements must read `agree`. */
export function agreementsAccepted(text: string) {
  return ["HarmonyOS_Software_Service_Agreement", "HarmonyOS_SDK_Agreement"].every((k) => new RegExp(`^${k}:\\s*agree\\s*$`, "m").test(text));
}
export async function licenseAccepted(signal?: AbortSignal) {
  const file = await licenseConfig(signal);
  // No config yet: the Emulator creates it on first use (and would ask) — treat as not accepted.
  return fs.existsSync(file) && agreementsAccepted(fs.readFileSync(file, "utf8"));
}
/** Accept when needed; returns true when this call accepted the agreements. */
export async function ensureLicense(auto: boolean, signal?: AbortSignal) {
  if (await licenseAccepted(signal)) return false;
  if (!auto) throw new ToolError("LICENSE_REQUIRED", "Emulator license agreements are not accepted", undefined,
    "Review with emulator action=license_view, then emulator action=license (or pass auto_accept_license=true)");
  await acceptLicense(signal);
  return true;
}

/** Start detached; wait until a matching hdc target appears (boot can take ~1 min). */
export async function startEmulator(name: string, options: { cold?: boolean; window?: boolean; instance_path?: string; image_root?: string; auto_accept_license?: boolean }, signal: AbortSignal) {
  const licenseAcceptedNow = await ensureLicense(options.auto_accept_license ?? true, signal);
  // Already running: return its target instead of waiting for a "new" device that never appears.
  for (const target of await listTargets(signal)) {
    const hvd = (await shell(target, ["param", "get", "ohos.qemu.hvd.name"], signal, 5000).catch(() => undefined))?.stdout.trim();
    if (hvd === name) return { started: name, target, already_running: true };
  }
  const before = new Set(await listTargets(signal));
  const cmd = toolCommand("emulator", ["-hvd", name, ...(options.cold ? ["-bootMode", "coldboot"] : []), ...(options.window === false ? ["-noWindow"] : []),
    ...(options.instance_path ? ["-instancePath", options.instance_path] : []), ...(options.image_root ? ["-imageRoot", options.image_root] : [])]);
  // The emulator must outlive this server (hosts restart MCP servers freely); its output goes to a log file
  // so an early refusal (license, missing image, bad config) is reported immediately instead of timing out.
  const logFile = path.join(os.tmpdir(), `deveco-emulator-${name.replace(/[^\w.-]/g, "_")}.log`);
  const child = spawnIndependent(cmd, logFile);
  let exited: number | null | undefined;
  child.once("exit", (code) => { exited = code; });
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    await new Promise((r) => setTimeout(r, 2000));
    if (exited !== undefined) {
      const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
      // The launcher may exit after handing off to the VM process; only fail when it reported a refusal.
      if (/agree to the agreement|Unable to start|Failed to start|not exist|error/i.test(log.slice(-2000))) {
        const license = /agreement/i.test(log);
        throw new ToolError(license ? "LICENSE_REQUIRED" : "EMULATOR_FAILED", `Emulator ${name} refused to start: ${clip(log.split("\n").filter((l) => l.trim()).slice(-2).join(" "), 300)}`,
          { log: logFile }, license ? "The image's license agreement is not accepted yet: review it with emulator action=license_view, then accept with emulator action=license (user decision)" : "Check the emulator instance and image (emulator action=list / images)");
      }
    }
    for (const target of await listTargets(signal)) {
      if (before.has(target)) continue;
      const hvd = (await shell(target, ["param", "get", "ohos.qemu.hvd.name"], signal, 5000).catch(() => undefined))?.stdout.trim();
      if (hvd === name) {
        // Wait for the launcher so app installs don't race boot.
        for (let i = 0; i < 30; i++) {
          const boot = (await shell(target, ["param", "get", "bootevent.boot.completed"], signal, 5000)).stdout.trim();
          if (boot === "true") break;
          await new Promise((r) => setTimeout(r, 2000));
        }
        return { started: name, target, ...(licenseAcceptedNow ? { license: "accepted automatically (HarmonyOS software + SDK agreements; review with emulator action=license_view)" } : {}) };
      }
    }
  }
  invariant(false, "TIMEOUT", `Emulator ${name} did not come online within 3 minutes`, undefined, "Check DevEco Studio Device Manager; accept the license with emulator action=license");
}

export async function stopEmulator(name: string, signal?: AbortSignal, instancePath?: string) {
  // Like deveco-cli: stopping an emulator that is not running is a no-op, not an error.
  const known = await listEmulators(signal, false, instancePath).catch(() => undefined);
  const entry = known?.find((e) => e.name === name);
  if (known && !entry) throw new ToolError("NOT_FOUND", `Emulator ${name} not found`, { emulators: known.map((e) => e.name) });
  if (entry && !entry.running) return { stopped: name, already_stopped: true };
  return { stopped: name, output: clip(await emulatorChecked("stop", ["-stop", name], signal, 60000), 500) };
}

export interface CreateInput {
  name: string; device_type: string; os_version: string; memory?: number; storage?: number;
  instance_path?: string; image_root?: string; screen_profile?: string; screen?: string[]; hot_boot?: boolean; force?: boolean;
}
export function createArgs(input: CreateInput) {
  const args = ["-create", input.name, "-deviceType", input.device_type, "-osVersion", input.os_version];
  if (input.memory) args.push("-memory", String(input.memory));
  if (input.storage) args.push("-storage", String(input.storage));
  if (input.instance_path) args.push("-instancePath", input.instance_path);
  if (input.image_root) args.push("-imageRoot", input.image_root);
  if (input.screen_profile) args.push("-screenProfile", input.screen_profile);
  if (input.screen?.length) {
    invariant(input.screen.length <= 2 && input.screen.every((s) => /^\d+ \d+ \d+ \d+(\.\d{1,2})?$/.test(s.trim())), "INVALID_INPUT",
      'screen: one "width height dpi inches" string (two for foldables: unfolded, folded)', { example: ["1080 2340 480 6.5"] });
    args.push("-screen", ...input.screen.map((s) => s.trim()));
  }
  if (input.hot_boot !== undefined) args.push("-hotBoot", String(input.hot_boot));
  if (input.force) args.push("-force");
  return args;
}
export async function createEmulator(input: CreateInput & { auto_accept_license?: boolean }, signal?: AbortSignal) {
  await ensureLicense(input.auto_accept_license ?? true, signal);
  const args = createArgs(input);
  return { created: input.name, output: clip(await emulatorChecked("create", args, signal, 600000), 1000) };
}
export async function deleteEmulator(name: string, signal?: AbortSignal, instancePath?: string) {
  // Deleting a running instance corrupts it; refuse like deveco-cli.
  if ((await runningNames(signal)).has(name)) throw new ToolError("CONFLICT", `Emulator ${name} is running`, undefined, "Stop it first with emulator action=stop");
  return { deleted: name, output: clip(await emulatorChecked("delete", ["-delete", name, ...(instancePath ? ["-instancePath", instancePath] : []), "-force"], signal), 500) };
}
/** Downloaded images by default (upstream `image list`); all=true lists every downloadable image. */
export async function images(deviceType?: string, signal?: AbortSignal, all = false) {
  return { output: clip(await emulator(["-imageList", ...(deviceType ? ["-deviceType", deviceType] : []), ...(all ? [] : ["-downloaded", "true"])], signal, 60000), 8000) };
}
export async function installImage(deviceType: string, osVersion: string, signal: AbortSignal, force = false, autoAcceptLicense = true) {
  await ensureLicense(autoAcceptLicense, signal);
  // -force skips interactive prompts; re-download of an existing image additionally needs the image removed first.
  if (force) await removeImage(deviceType, osVersion, signal).catch(() => undefined);
  return { installed: `${deviceType} ${osVersion}`, output: clip(await emulatorChecked("install_image", ["-install", "-deviceType", deviceType, "-osVersion", osVersion, "-force"], signal, 60 * 60000), 2000) };
}
export async function removeImage(deviceType: string, osVersion: string, signal?: AbortSignal) {
  return { removed: `${deviceType} ${osVersion}`, output: clip(await emulatorChecked("remove_image", ["-uninstall", "-deviceType", deviceType, "-osVersion", osVersion, "-force"], signal, 300000), 1000) };
}
export async function acceptLicense(signal?: AbortSignal) {
  const out = await emulator(["-license", "accept"], signal);
  return { accepted: /accepted/i.test(out) || await licenseAccepted(signal), output: clip(out.split("\n").filter((l) => l.trim()).slice(-1).join(""), 300) };
}
/** Full license text (bounded; long agreements are saved as an artifact). */
export async function viewLicense(_signal?: AbortSignal) {
  // Read-only: the agreement texts ship next to the Emulator binary (tools/emulator/agreement/*.txt).
  // Never drives the interactive `-license` prompt, so viewing can never record an answer.
  const dir = path.join(path.dirname(toolCommand("emulator", []).file), "agreement");
  invariant(fs.existsSync(dir), "NOT_FOUND", "Emulator agreement texts not found", { dir });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
  const text = files.map((f) => `===== ${f.replace(/\.txt$/, "").replace(/_/g, " ")} =====\n${fs.readFileSync(path.join(dir, f), "utf8").trim()}`).join("\n\n");
  if (text.length <= 8000) return { license: text };
  const { saveArtifact } = await import("../core/artifacts.js");
  const artifact = await saveArtifact(text);
  return { license: text.slice(0, 4000), truncated: true, artifact_id: artifact.artifact_id, hint: "Read the rest with job action=read artifact_id=..." };
}

export type Scenario =
  | { action: "shake" | "power" | "outdoor_running" | "outdoor_cycling" | "driving_navigation" }
  | { action: "rotate"; direction: "left" | "right" }
  | { action: "volume"; direction: "up" | "down" }
  | { action: "fold"; state: string }
  | { action: "battery"; level?: number; charging?: boolean }
  | { action: "gps"; latitude?: number; longitude?: number; altitude?: number; bearing?: number; city?: string }
  | { action: "sensor"; light?: number; steps?: number; heartrate?: number; humidity?: number; temperature?: number };

export async function scenario(name: string, s: Scenario, signal?: AbortSignal) {
  const base = ["-instance", name];
  const calls: string[][] = [];
  switch (s.action) {
    case "shake": calls.push([...base, "-shake"]); break;
    case "power": calls.push([...base, "-power"]); break;
    case "outdoor_running": calls.push([...base, "-outdoorRunning"]); break;
    case "outdoor_cycling": calls.push([...base, "-outdoorCycling"]); break;
    case "driving_navigation": calls.push([...base, "-drivingNavigation"]); break;
    case "rotate": calls.push([...base, "-rotation", s.direction]); break;
    case "volume": calls.push([...base, "-volume", s.direction]); break;
    case "fold": calls.push([...base, "-foldedState", s.state]); break;
    case "battery":
      // Status first so level 0 is accepted while charging (upstream ordering).
      invariant(!(s.level === 0 && s.charging === false), "INVALID_INPUT", "Battery level 0 is only allowed while charging");
      if (s.charging !== undefined) calls.push([...base, "-batteryStatus", s.charging ? "1" : "0"]);
      if (s.level !== undefined) calls.push([...base, "-battery", String(s.level)]);
      break;
    case "gps":
      for (const key of ["latitude", "longitude", "altitude", "bearing", "city"] as const)
        if (s[key] !== undefined) calls.push([...base, "-gps", `-${key}`, String(s[key])]);
      break;
    case "sensor":
      for (const key of ["light", "steps", "heartrate", "humidity", "temperature"] as const)
        if (s[key] !== undefined) calls.push([...base, "-sensor", `-${key}`, String(s[key])]);
      break;
  }
  invariant(calls.length, "INVALID_INPUT", "Scenario needs at least one value");
  const outputs: string[] = [];
  for (const args of calls) {
    const out = await emulator(args, signal, 30000);
    invariant(!/error|fail|not support|unknown/i.test(out) || /success/i.test(out), "EMULATOR_FAILED", `Emulator rejected ${args.slice(2).join(" ")}: ${clip(out, 300)}`);
    outputs.push(out);
  }
  return { applied: s.action, accepted: true, note: "Verify the app reaction with ui assert", output: clip(outputs.join("\n"), 500) };
}
