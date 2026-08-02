import { spawn } from "node:child_process";
import fs from "node:fs";
import { resolveHdcPath } from "./config.mjs";

function targetArgs(deviceId) {
  return deviceId ? ["-t", String(deviceId)] : [];
}

function run(command, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (!settled) {
        settled = true;
        const error = new Error(`HDC command timed out after ${timeoutMs}ms`);
        error.code = "HDC_TIMEOUT";
        reject(error);
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, exitCode, signal });
    });
  });
}

function requireHdc() {
  const hdc = resolveHdcPath();
  if (hdc !== "hdc" && !fs.existsSync(hdc)) {
    const error = new Error(`hdc not found: ${hdc}`);
    error.code = "HDC_NOT_FOUND";
    throw error;
  }
  return hdc;
}

function cleanLines(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function fail(message, code = "HDC_ERROR") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const HDC_FAILURE_PATTERNS = [
  /^\s*\[Fail\]/im,
  /Not match target(?: founded)?/i,
  /check connect-key/i,
  /(?:target|device)\s+(?:not found|not connected|offline)/i,
  /no\s+(?:matching|connected|available)\s+(?:target|device)/i,
];

export function hdcFailureMessage(result) {
  const stdout = String(result?.stdout ?? "");
  const stderr = String(result?.stderr ?? "");
  const combined = [stderr, stdout].filter(Boolean).join("\n").trim();
  if (result?.exitCode !== 0) {
    return combined || `hdc exited with code ${result?.exitCode ?? "unknown"}`;
  }
  return HDC_FAILURE_PATTERNS.some((pattern) => pattern.test(combined)) ? combined : "";
}

function assertHdcSuccess(result, operation) {
  const message = hdcFailureMessage(result);
  if (message) fail(`${operation} failed: ${message}`, "HDC_COMMAND_FAILED");
}

async function listConnectedDevices(hdc) {
  const result = await run([hdc, "list", "targets"]);
  assertHdcSuccess(result, "hdc list targets");
  return cleanLines(result.stdout).filter((item) => !item.includes("[Empty]"));
}

async function resolveDevice(hdc, deviceId) {
  const devices = await listConnectedDevices(hdc);
  if (devices.length === 0) {
    fail("No connected HarmonyOS devices detected.", "HDC_NO_DEVICE");
  }
  if (deviceId) {
    const requested = String(deviceId);
    if (!devices.includes(requested)) {
      fail(`HarmonyOS device is not connected: ${requested}`, "HDC_DEVICE_NOT_FOUND");
    }
    return requested;
  }
  if (devices.length > 1) {
    fail(`Multiple HarmonyOS devices are connected (${devices.join(", ")}); pass device_id.`, "HDC_DEVICE_REQUIRED");
  }
  return devices[0];
}

export async function hdcLog({
  action,
  device_id: deviceId,
  log_prefix: prefix = "[VCODER_DEBUG]",
  lines = 2000,
} = {}) {
  if (!["collect", "clear", "list_devices"].includes(action)) {
    fail("action must be collect, clear, or list_devices", "HDC_ACTION_INVALID");
  }
  const hdc = requireHdc();
  if (action === "list_devices") {
    const devices = await listConnectedDevices(hdc);
    return {
      action,
      deviceCount: devices.length,
      devices,
      output: devices.length ? devices.join("\n") : "No connected devices detected.",
    };
  }

  const selectedDevice = await resolveDevice(hdc, deviceId);

  if (action === "clear") {
    const result = await run([hdc, ...targetArgs(selectedDevice), "shell", "hilog", "-r"]);
    assertHdcSuccess(result, "hdc hilog -r");
    return { action, deviceId: selectedDevice, cleared: true, output: "Device log buffer cleared." };
  }

  const limit = Math.min(Math.max(Number(lines) || 2000, 1), 5000);
  const result = await run([hdc, ...targetArgs(selectedDevice), "shell", "hilog", "-x"]);
  assertHdcSuccess(result, "hdc hilog -x");
  const all = cleanLines(result.stdout);
  const filtered = prefix ? all.filter((item) => item.includes(String(prefix))) : all;
  const selected = filtered.slice(Math.max(0, filtered.length - limit));
  return {
    action,
    deviceId: selectedDevice,
    prefix: String(prefix),
    requestedLines: limit,
    lineCount: selected.length,
    logs: selected,
    output: selected.length ? selected.join("\n") : "No matching logs found.",
  };
}

export function hdcStatus() {
  const hdc = resolveHdcPath();
  return { hdc, installed: hdc !== "hdc" && fs.existsSync(hdc) };
}
