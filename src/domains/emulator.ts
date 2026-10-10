import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { invariant, ToolError } from "../core/errors.js";
import { clip } from "../core/files.js";
import { run, spawnIndependent } from "../core/proc.js";
import { toolCommand } from "../core/toolchain.js";
import { listTargets, shell } from "./device.js";
import { snapshotBoot } from "./emulator-snapshot.js";

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

export interface StartInput {
  cold?: boolean; boot_mode?: "coldboot" | "snapshot" | "reset"; hdc_port?: number; window?: boolean;
  instance_path?: string; image_root?: string; auto_accept_license?: boolean;
}

/** One native invocation: never retry with a different mode, port or instance directory. */
export function startArgs(name: string, options: StartInput) {
  invariant(name.trim(), "INVALID_INPUT", "Emulator name must not be empty");
  invariant(options.boot_mode === undefined || ["coldboot", "snapshot", "reset"].includes(options.boot_mode), "INVALID_INPUT", "Invalid boot_mode");
  invariant(options.cold === undefined || options.boot_mode === undefined || options.cold === (options.boot_mode === "coldboot"),
    "INVALID_INPUT", "cold and boot_mode conflict; use boot_mode alone");
  invariant(options.hdc_port === undefined || Number.isInteger(options.hdc_port) && options.hdc_port >= 10000 && options.hdc_port <= 16555,
    "INVALID_INPUT", "hdc_port must be an integer from 10000 to 16555");
  const mode = options.boot_mode ?? (options.cold ? "coldboot" : undefined);
  return ["-hvd", name, ...(mode ? ["-bootMode", mode] : []),
    ...(options.hdc_port !== undefined ? ["-hdcPort", String(options.hdc_port)] : []), ...(options.window === false ? ["-noWindow"] : []),
    ...(options.instance_path ? ["-instancePath", options.instance_path] : []), ...(options.image_root ? ["-imageRoot", options.image_root] : [])];
}

async function freePort(port: number) {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => reject(new ToolError(error.code === "EADDRINUSE" ? "CONFLICT" : "PROCESS_FAILED",
      `Cannot use HDC port ${port}: ${error.message}`, { hdc_port: port })));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close((error) => error ? reject(error) : resolve()));
  });
}

/** Device disappearance during boot is transient; other HDC failures must remain visible. */
async function bootParam(target: string, key: string, signal: AbortSignal) {
  try {
    const result = await shell(target, ["param", "get", key], signal, 5000);
    invariant(result.code === 0, "PROCESS_FAILED", `Cannot read emulator parameter ${key}`, { target, exit_code: result.code, output: clip(result.stdout + result.stderr, 500) });
    return result.stdout.trim();
  }
  catch (error) {
    signal.throwIfAborted();
    if (error instanceof ToolError && error.code === "DEVICE_UNAVAILABLE") return undefined;
    throw error;
  }
}
async function matchingTargets(name: string, signal: AbortSignal) {
  const targets = await listTargets(signal);
  const matches = await Promise.all(targets.map(async (target) => await bootParam(target, "ohos.qemu.hvd.name", signal) === name ? target : undefined));
  const found = matches.filter((t): t is string => t !== undefined);
  invariant(found.length <= 1, "CONFLICT", `Several connected emulators are named ${name}`, { targets: found });
  return found[0];
}

/** Read a bounded tail: a long-lived VM can write a large launcher log. */
function startLog(file: string) {
  if (!fs.existsSync(file)) return "";
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size, bytes = Buffer.alloc(Math.min(size, 16384));
    const read = fs.readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length));
    return bytes.subarray(0, read).toString("utf8");
  } finally { fs.closeSync(fd); }
}

const starting = new Set<string>();
/** Start detached; only a matching HDC identity with boot.completed=true is a successful start. */
export async function startEmulator(name: string, options: StartInput, signal: AbortSignal) {
  const args = startArgs(name, options);
  // Refuse overlapping requests, including the gap before the SDK publishes a running instance.
  const keys = [`name:${name}`, ...(options.hdc_port === undefined ? [] : [`port:${options.hdc_port}`])];
  invariant(keys.every((key) => !starting.has(key)), "CONFLICT", `Emulator ${name} or its port is already starting`);
  keys.forEach((key) => starting.add(key));
  const timeout = AbortSignal.timeout(180000), pending = AbortSignal.any([signal, timeout]);
  let logFile: string | undefined;
  let launched = false;
  try {
    pending.throwIfAborted();
    // Startup needs authoritative metadata. A plain-name list cannot verify Quick Boot or running state.
    const raw = await emulatorChecked("start", ["-list", "-details", ...(options.instance_path ? ["-instancePath", options.instance_path] : [])], pending, 30000);
    let rows: Record<string, string>[];
    try { rows = JSON.parse(raw); } catch { throw new ToolError("CAPABILITY_UNAVAILABLE", "Emulator cannot provide instance details", { output: clip(raw, 500) }); }
    invariant(Array.isArray(rows) && rows.every((row) => row && typeof row.name === "string"),
      "CAPABILITY_UNAVAILABLE", "Emulator returned invalid instance details");
    const instances = rows.filter((e) => e.name === name);
    invariant(instances.length === 1, instances.length ? "CONFLICT" : "NOT_FOUND", `Expected one emulator named ${name}`, { matches: instances.length });
    const instance = instances[0]!;
    const mode = options.boot_mode ?? (options.cold ? "coldboot" : undefined);
    const targetBefore = await matchingTargets(name, pending);
    const alreadyRunning = instance.isRunning === "true" || !!targetBefore;
    const explicit = mode !== undefined || options.hdc_port !== undefined || options.window !== undefined || options.instance_path !== undefined || options.image_root !== undefined;
    invariant(!alreadyRunning || !explicit, "CONFLICT", `Emulator ${name} is already running; startup options cannot be applied`, { target: targetBefore },
      "Stop this instance explicitly before starting it with new options");
    let licenseAcceptedNow = false;
    let restoredSnapshot: (() => boolean) | undefined;
    if (!alreadyRunning) {
      const required = [mode ? "-bootMode" : undefined, options.hdc_port !== undefined ? "-hdcPort" : undefined, options.window === false ? "-noWindow" : undefined].filter((f): f is string => !!f);
      if (required.length) {
        const help = await emulator(["-help"], pending, 15000);
        invariant(required.every((f) => help.toLowerCase().includes(f.toLowerCase())) && (!mode || help.includes(mode)),
          "CAPABILITY_UNAVAILABLE", "Installed Emulator does not declare the requested startup options", { required, boot_mode: mode });
      }
      if (mode === "snapshot") {
        invariant(instance.isHotBoot === "true" && instance.instancePath, "CAPABILITY_UNAVAILABLE", `Emulator ${name} needs Quick Boot and a known instance directory`, undefined,
          "Use an instance created with hot_boot=true and an existing saved snapshot");
        restoredSnapshot = snapshotBoot(instance.instancePath);
      }
      if (options.hdc_port !== undefined) await freePort(options.hdc_port);
      licenseAcceptedNow = await ensureLicense(options.auto_accept_license ?? true, pending);
      logFile = path.join(os.tmpdir(), `deveco-emulator-${randomUUID()}.log`);
      await (await import("../core/artifacts.js")).trackExport(logFile);
    }
    let exited: number | null | undefined, spawnError: Error | undefined;
    if (logFile) {
      pending.throwIfAborted();
      const child = spawnIndependent(toolCommand("emulator", args), logFile);
      launched = true;
      child.once("error", (error) => { spawnError = error; });
      child.once("exit", (code) => { exited = code; });
    }
    let target = targetBefore;
    for (;;) {
      pending.throwIfAborted();
      restoredSnapshot?.(); // Detect SDK coldboot substitution even before a target appears.
      if (spawnError) throw new ToolError("PROCESS_FAILED", `Cannot start emulator ${name}: ${spawnError.message}`, { log: logFile });
      const log = logFile ? startLog(logFile) : "";
      const refused = /agree to the agreement|Unable to start|Failed to start|Invalid command|please attach the correct parameter|(?:snapshot|boot) .{0,60}failed|could not use snapshot|default snapshot is not exist/i.test(log);
      if (refused || exited !== undefined && exited !== 0) throw new ToolError(/agreement/i.test(log) ? "LICENSE_REQUIRED" : "EMULATOR_FAILED",
        `Emulator ${name} refused to start`, { log: logFile, exit_code: exited, tail: clip(log, 2000) }, "Inspect the launcher log and emulator instance; no startup options were retried");
      target ??= await matchingTargets(name, pending);
      if (target) {
        const port = /:(\d+)$/.exec(target)?.[1];
        invariant(options.hdc_port === undefined || Number(port) === options.hdc_port, "CONFLICT", "Emulator came online on a different HDC port",
          { target, hdc_port: options.hdc_port, log: logFile });
        const boot = await bootParam(target, "bootevent.boot.completed", pending);
        // Recheck identity on completion: a disconnected serial can be reused by another instance.
        if (boot === "true" && await bootParam(target, "ohos.qemu.hvd.name", pending) === name) {
          pending.throwIfAborted();
          invariant(!restoredSnapshot || restoredSnapshot(), "EFFECT_UNCERTAIN", "Emulator booted without evidence of the requested snapshot restore",
            { name, target, log: logFile, snapshot_log: instance.instancePath ? path.join(instance.instancePath, "Log/qemu.log") : undefined });
          if (logFile) fs.rmSync(logFile, { force: true });
          return { started: name, target, boot_completed: true,
            ...(alreadyRunning ? { already_running: true } : {}), ...(mode ? { boot_mode: mode } : {}),
            ...(options.hdc_port !== undefined ? { hdc_port: options.hdc_port } : {}),
            ...(licenseAcceptedNow ? { license: "accepted automatically (HarmonyOS software + SDK agreements; review with emulator action=license_view)" } : {}) };
        }
        if (boot === undefined || boot === "true") target = undefined;
      }
      await delay(1000, undefined, { signal: pending });
    }
  } catch (error) {
    if (pending.aborted) throw new ToolError(signal.aborted ? "CANCELLED" : "TIMEOUT",
      signal.aborted ? `Stopped waiting for emulator ${name}` : `Emulator ${name} did not complete boot within 3 minutes`,
      { name, launched, ...(logFile ? { log: logFile, tail: clip(startLog(logFile), 2000) } : {}) },
      "The emulator may still be running; inspect it before retrying or stopping it");
    throw error;
  } finally { keys.forEach((key) => starting.delete(key)); }
}

export async function stopEmulator(name: string, signal?: AbortSignal, instancePath?: string) {
  // Like deveco-cli: stopping an emulator that is not running is a no-op, not an error.
  const known = await listEmulators(signal, false, instancePath).catch(() => undefined);
  const entry = known?.find((e) => e.name === name);
  if (known && !entry) throw new ToolError("NOT_FOUND", `Emulator ${name} not found`, { emulators: known.map((e) => e.name) });
  if (entry && !entry.running) return { stopped: name, already_stopped: true };
  const output = await emulatorChecked("stop", ["-stop", name], signal, 60000);
  const deadline = Date.now() + 15000;
  let stopped = 0;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const live = (await listEmulators(signal, false, instancePath)).find((e) => e.name === name)?.running;
    stopped = live ? 0 : stopped + 1;
    if (stopped >= 2) return { stopped: name, output: clip(output, 500) };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new ToolError("TIMEOUT", `Emulator ${name} still reports running after stop; do not delete it`);
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
  // This SDK's -create has no overwrite option. -force belongs to interactive
  // delete/install commands and does not replace an existing instance.
  return args;
}
export async function createEmulator(input: CreateInput & { auto_accept_license?: boolean }, signal?: AbortSignal) {
  const args = createArgs(input);
  const existing = (await listEmulators(signal, false, input.instance_path)).find((e) => e.name === input.name);
  if (existing) throw new ToolError(input.force ? "CAPABILITY_UNAVAILABLE" : "CONFLICT",
    input.force ? "The installed Emulator cannot safely overwrite an existing instance; nothing changed" : `Emulator ${input.name} already exists`,
    { name: input.name }, "Create a distinct name, or explicitly stop/delete that instance before recreating it");
  await ensureLicense(input.auto_accept_license ?? true, signal);
  return { created: input.name, output: clip(await emulatorChecked("create", args, signal, 600000), 1000) };
}
export async function deleteEmulator(name: string, signal?: AbortSignal, instancePath?: string) {
  // Deleting a running instance corrupts it; refuse like deveco-cli.
  if ((await listEmulators(signal, false, instancePath)).some((e) => e.name === name && e.running)) throw new ToolError("CONFLICT", `Emulator ${name} is running`, undefined, "Stop it first with emulator action=stop");
  return { deleted: name, output: clip(await emulatorChecked("delete", ["-delete", name, ...(instancePath ? ["-instancePath", instancePath] : []), "-force"], signal), 500) };
}
/** Downloaded images by default (upstream `image list`); all=true lists every downloadable image. */
export async function images(deviceType?: string, signal?: AbortSignal, all = false) {
  const out = await emulator(["-imageList", ...(deviceType ? ["-deviceType", deviceType] : []), ...(all ? [] : ["-downloaded", "true"])], signal, 60000);
  // The Emulator prints JSON rows, or a sentence when nothing matches ("No images matching the criteria were found.").
  const start = out.indexOf("[");
  try {
    const rows = JSON.parse(start >= 0 ? out.slice(start) : out) as Record<string, string>[];
    return { images: rows.map((r) => ({ device_type: r.deviceType, os_version: r.osVersion, software_version: r.SoftWareVersion ?? r.softwareVersion, downloaded: String(r.downloaded) === "true", upgradable: String(r.upgradable) === "true", release: r.releaseType })) };
  } catch {
    if (/No images/i.test(out)) return { images: [] };
    return { images: [], output: clip(out, 2000) };
  }
}
export async function installImage(deviceType: string, osVersion: string, signal: AbortSignal, force = false, autoAcceptLicense = true) {
  await ensureLicense(autoAcceptLicense, signal);
  // -force skips interactive prompts; re-download of an existing image additionally needs the image removed first.
  if (force) await removeImage(deviceType, osVersion, signal).catch(() => undefined);
  const started = Date.now();
  const out = await emulatorChecked("install_image", ["-install", "-deviceType", deviceType, "-osVersion", osVersion, "-force"], signal, 60 * 60000);
  // Summary instead of the progress stream ("\r12.3% (x/y bytes)" thousands of times).
  const bytes = [...out.matchAll(/\((\d+)\/(\d+) bytes\)/g)].at(-1)?.[2];
  const lines = out.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l && !/^\d+(\.\d+)?% \(/.test(l));
  return {
    installed: `${deviceType} ${osVersion}`,
    ...(/downloaded to (\S+)/i.exec(out)?.[1] ? { path: /downloaded to (\S+)/i.exec(out)![1] } : /download to (\S+)/i.exec(out)?.[1] ? { path: /download to (\S+)/i.exec(out)![1] } : {}),
    ...(bytes ? { bytes: Number(bytes) } : {}), seconds: Math.round((Date.now() - started) / 1000),
    output: clip(lines.join("\n"), 600),
  };
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
