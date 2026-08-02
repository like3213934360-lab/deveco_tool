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
    const result = await run([hdc, "list", "targets"]);
    if (result.exitCode !== 0) {
      fail(`hdc list targets failed (code=${result.exitCode}): ${result.stderr || result.stdout}`);
    }
    const devices = cleanLines(result.stdout).filter((item) => !item.includes("[Empty]"));
    return {
      action,
      deviceCount: devices.length,
      devices,
      output: devices.length ? devices.join("\n") : "No connected devices detected.",
    };
  }

  if (action === "clear") {
    const result = await run([hdc, ...targetArgs(deviceId), "shell", "hilog", "-r"]);
    if (result.exitCode !== 0) {
      fail(`hdc hilog -r failed (code=${result.exitCode}): ${result.stderr || result.stdout}`);
    }
    return { action, deviceId: deviceId || null, cleared: true, output: "Device log buffer cleared." };
  }

  const limit = Math.min(Math.max(Number(lines) || 2000, 1), 5000);
  const result = await run([hdc, ...targetArgs(deviceId), "shell", "hilog", "-x"]);
  if (result.exitCode !== 0) {
    fail(`hdc hilog -x failed (code=${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  const all = cleanLines(result.stdout);
  const filtered = prefix ? all.filter((item) => item.includes(String(prefix))) : all;
  const selected = filtered.slice(Math.max(0, filtered.length - limit));
  return {
    action,
    deviceId: deviceId || null,
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
