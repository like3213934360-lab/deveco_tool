import { invariant } from "../core/errors.js";
import { clip } from "../core/files.js";
import { run, spawnManaged } from "../core/proc.js";
import { toolCommand } from "../core/toolchain.js";
import { listTargets, shell } from "./device.js";

async function emulator(args: string[], signal?: AbortSignal, timeoutMs = 120000) {
  const result = await run(toolCommand("emulator", args), { signal, timeoutMs, allowFailure: true });
  return (result.stdout + result.stderr).trim();
}

export async function listEmulators(signal?: AbortSignal) {
  const text = await emulator(["-list", "-details"], signal, 30000).catch(() => emulator(["-list"], signal, 30000));
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

/** Start detached; wait until a matching hdc target appears (boot can take ~1 min). */
export async function startEmulator(name: string, options: { cold?: boolean; window?: boolean }, signal: AbortSignal) {
  const before = new Set(await listTargets(signal));
  const cmd = toolCommand("emulator", ["-hvd", name, ...(options.cold ? ["-bootMode", "coldboot"] : []), ...(options.window === false ? ["-noWindow"] : [])]);
  const child = spawnManaged(cmd, "ignore");
  child.unref();
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    await new Promise((r) => setTimeout(r, 2000));
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
        return { started: name, target };
      }
    }
  }
  invariant(false, "TIMEOUT", `Emulator ${name} did not come online within 3 minutes`, undefined, "Check DevEco Studio Device Manager; accept the license with emulator action=license");
}

export async function stopEmulator(name: string, signal?: AbortSignal) {
  return { stopped: name, output: clip(await emulator(["-stop", name], signal, 60000), 500) };
}

export async function createEmulator(input: { name: string; device_type: string; os_version: string; memory?: number; storage?: number }, signal?: AbortSignal) {
  const args = ["-create", input.name, "-deviceType", input.device_type, "-osVersion", input.os_version];
  if (input.memory) args.push("-memory", String(input.memory));
  if (input.storage) args.push("-storage", String(input.storage));
  return { created: input.name, output: clip(await emulator(args, signal, 600000), 1000) };
}
export async function deleteEmulator(name: string, signal?: AbortSignal) {
  return { deleted: name, output: clip(await emulator(["-delete", name, "-force"], signal), 500) };
}
export async function images(deviceType?: string, signal?: AbortSignal) {
  return { output: clip(await emulator(["-imageList", ...(deviceType ? ["-deviceType", deviceType] : [])], signal, 60000), 8000) };
}
export async function installImage(deviceType: string, osVersion: string, signal: AbortSignal) {
  return { output: clip(await emulator(["-install", "-deviceType", deviceType, "-osVersion", osVersion, "-force"], signal, 60 * 60000), 2000) };
}
export async function acceptLicense(signal?: AbortSignal) {
  return { output: clip(await emulator(["-license", "accept"], signal), 500) };
}

export type Scenario =
  | { action: "shake" | "power" | "outdoor_running" | "outdoor_cycling" | "driving_navigation" }
  | { action: "rotate"; direction: "left" | "right" }
  | { action: "volume"; direction: "up" | "down" }
  | { action: "fold"; state: string }
  | { action: "battery"; level: number; charging?: boolean }
  | { action: "gps"; latitude?: number; longitude?: number; altitude?: number; bearing?: number; city?: string }
  | { action: "sensor"; light?: number; steps?: number; heartrate?: number };

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
      calls.push([...base, "-battery", String(s.level)]);
      if (s.charging !== undefined) calls.push([...base, "-batteryStatus", s.charging ? "1" : "0"]);
      break;
    case "gps":
      for (const key of ["latitude", "longitude", "altitude", "bearing", "city"] as const)
        if (s[key] !== undefined) calls.push([...base, "-gps", `-${key}`, String(s[key])]);
      break;
    case "sensor":
      for (const key of ["light", "steps", "heartrate"] as const)
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
