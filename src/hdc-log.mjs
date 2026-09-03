import { spawn } from "node:child_process";
import fs from "node:fs";
import { resolveHdcPath } from "./config.mjs";
import { terminateProcessTree } from "./process-tree.mjs";

function targetArgs(deviceId) {
  return deviceId ? ["-t", String(deviceId)] : [];
}

const MAX_HDC_STREAM_BYTES = 8 * 1024 * 1024;

/**
 * Run hdc under a deadline.
 *
 * `resolveOnTimeout` exists because the two callers want opposite things from a deadline. A capture
 * in device-ui.mjs that ran out of time produced no artifact and has nothing to hand back, so it
 * wants the throw. A log collection has a growing buffer of real lines in hand, and discarding
 * those to report only "timed out" is how a slow device turned into two wasted minutes and zero
 * output. Default stays reject: no existing caller changes behaviour.
 *
 * @param {string[]} command Full argv.
 * @param {number} timeoutMs Deadline for the call.
 * @param {{resolveOnTimeout?: boolean}} [options] Deadline behaviour.
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number|null, signal: string|null, timedOut?: boolean}>} Result.
 */
function run(command, timeoutMs = 120000, { resolveOnTimeout = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      terminateProcessTree(child);
      if (settled) return;
      settled = true;
      if (resolveOnTimeout) {
        resolve({ stdout, stderr, exitCode: null, signal: "SIGTERM", timedOut: true });
        return;
      }
      const error = new Error(`HDC command timed out after ${timeoutMs}ms`);
      error.code = "HDC_TIMEOUT";
      reject(error);
    }, timeoutMs);
    const append = (stream, chunk) => {
      if (settled) return;
      const nextBytes = stream === "stdout" ? stdoutBytes + chunk.length : stderrBytes + chunk.length;
      if (stream === "stdout") stdoutBytes = nextBytes;
      else stderrBytes = nextBytes;
      if (nextBytes > MAX_HDC_STREAM_BYTES) {
        settled = true;
        clearTimeout(timer);
        terminateProcessTree(child);
        const error = new Error(`HDC ${stream} exceeded the ${MAX_HDC_STREAM_BYTES}-byte output limit`);
        error.code = "HDC_OUTPUT_LIMIT";
        reject(error);
        return;
      }
      if (stream === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
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

// Enumerating targets is a local round trip to the hdc server, not device work. Leaving it on the
// 120s default meant a wedged hdc daemon burned the caller's whole budget before the real command
// was even issued.
const LIST_TARGETS_TIMEOUT_MS = 30000;

async function listConnectedDevices(hdc) {
  const result = await run([hdc, "list", "targets"], LIST_TARGETS_TIMEOUT_MS);
  assertHdcSuccess(result, "hdc list targets");
  return cleanLines(result.stdout).filter((item) => !item.includes("[Empty]"));
}

/** Every hilog record opens with `MM-DD HH:MM:SS.mmm`; hilog's own diagnostics do not. */
const HILOG_RECORD = /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\b/;

/**
 * Decide whether a collect that came back "successful" actually failed on the device.
 *
 * This stands in for an exit code, because `hdc shell X` exits 0 whatever X did. Both streams have
 * to be read, and which one carries the complaint was measured rather than assumed: hilog writes
 * `hilog: unrecognized option: e` to stderr, while the device shell writes `/bin/sh: no closing
 * quote` to stdout. On a successful collect stderr was empty for both the piped and unpiped forms.
 *
 * Records outrank complaints: if real log lines came back, stderr noise is ignored, so a device
 * that chatters on stderr cannot turn a working collect into a hard failure. Only when stdout holds
 * no record at all does a complaint decide the outcome -- which is also what catches a hilog that
 * answered on the wrong stream, where the alternative is handing the complaint back as log content.
 *
 * @param {{stderr?: string}} result Completed hdc result.
 * @param {string[]} lines Cleaned stdout.
 * @returns {string} The diagnostic, or "" when the call is to be believed.
 */
function hilogDiagnostic(result, lines) {
  if (lines.some((line) => HILOG_RECORD.test(line))) return "";
  const complaint = lines.length > 0 ? lines : cleanLines(String(result?.stderr ?? ""));
  return complaint.slice(0, 4).join("; ");
}

// A prefix reaches the device inside single quotes, in a command sent as one argv element. Measured
// there: $, a backtick, a backslash and a double quote all arrive literally -- `a`id`b` did not run
// id -- and so do spaces, semicolons and CJK. Only two things cannot be sent. A single quote closes
// our own quoting (`/bin/sh: no closing quote`), and a control character would end the command line.
// Anything else is safe to hand to grep verbatim.
const UNQUOTABLE_IN_PREFIX = new RegExp("['\\u0000-\\u001f\\u007f]");

/**
 * Build the remote command that makes the device drop non-matching lines before they cross the wire.
 *
 * `grep -F` on the rendered line, rather than hilog's own `-e`, because `-e` matches only the
 * message body: a prefix that appears in the tag -- `LocationAbilityStage` for the prefix `Ability`
 * -- is invisible to it. Measured on a device, `-e` returned 7071 lines where the same buffer held
 * 8385 matching ones, and lines dropped on the device cannot be recovered by filtering here. `-F`
 * also takes the prefix literally, so the default `[VCODER_DEBUG]` needs no escaping; as a regex it
 * is a character class that matched 195715 of 212354 lines.
 *
 * @param {string} prefix Caller's literal prefix.
 * @returns {string|null} The remote command, or null when the prefix cannot be quoted safely.
 */
function deviceGrepCommand(prefix) {
  if (UNQUOTABLE_IN_PREFIX.test(prefix)) return null;
  return `hilog -x | grep -F -- '${prefix}'`;
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

const DEFAULT_COLLECT_TIMEOUT_MS = 120000;
const MIN_COLLECT_TIMEOUT_MS = 1000;
const MAX_COLLECT_TIMEOUT_MS = 600000;

export async function hdcLog({
  action,
  device_id: deviceId,
  log_prefix: prefix = "[VCODER_DEBUG]",
  lines = 2000,
  timeoutMs,
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
  const budget = Math.min(
    Math.max(Number(timeoutMs) || DEFAULT_COLLECT_TIMEOUT_MS, MIN_COLLECT_TIMEOUT_MS),
    MAX_COLLECT_TIMEOUT_MS,
  );
  const prefixText = prefix == null ? "" : String(prefix);

  // Both filters belong on the device. A bare `hilog -x` ships the whole buffer so that Node can
  // throw almost all of it away: measured against one TCP-attached device that was 30MB / 212354
  // lines / 231s for a prefix that matched nothing, against a 120s deadline it could never meet.
  // Piping through the device's own grep costs 8s for the same question, and `-z` bounds the tail
  // in 1.1s when there is no prefix to match at all. `-z` is not usable for the prefix path: it
  // cannot combine with `-x` (hilog answers `Mutlti commands can't be used in combination`) and it
  // tails before filtering, which answers "matches among the last N lines" rather than "the last N
  // matches" -- on this device that was 135 lines where the buffer held 7733.
  const remoteFilter = prefixText ? deviceGrepCommand(prefixText) : null;
  const filteredCommand = prefixText
    ? (remoteFilter ? [hdc, ...targetArgs(selectedDevice), "shell", remoteFilter] : null)
    : [hdc, ...targetArgs(selectedDevice), "shell", "hilog", "-z", String(limit)];
  const plainCommand = [hdc, ...targetArgs(selectedDevice), "shell", "hilog", "-x"];

  const startedAt = Date.now();
  let deviceFiltered = filteredCommand !== null;
  let result = await run(filteredCommand ?? plainCommand, budget, { resolveOnTimeout: true });
  let all = cleanLines(result.stdout);
  if (!result.timedOut) {
    assertHdcSuccess(result, "hdc hilog");
    const diagnostic = hilogDiagnostic(result, all);
    if (diagnostic) {
      // A device whose hilog or shell refuses this form -- an older build without `-z`, or one with
      // no grep on it -- would otherwise have its refusal reported as though it were the log. Retry
      // once, unfiltered, on whatever deadline is left, rather than failing a device that can still
      // answer the plain question.
      const remaining = budget - (Date.now() - startedAt);
      if (!deviceFiltered || remaining < MIN_COLLECT_TIMEOUT_MS) {
        fail(`hdc hilog failed: ${diagnostic}`, "HDC_HILOG_ERROR");
      }
      deviceFiltered = false;
      result = await run(plainCommand, remaining, { resolveOnTimeout: true });
      all = cleanLines(result.stdout);
      if (!result.timedOut) {
        assertHdcSuccess(result, "hdc hilog -x");
        const retryDiagnostic = hilogDiagnostic(result, all);
        if (retryDiagnostic) fail(`hdc hilog failed: ${retryDiagnostic}`, "HDC_HILOG_ERROR");
      }
    }
  }

  // grep -F on the rendered line is the same test as this one, so on the filtered path this is a
  // no-op kept for the fallback and timeout paths, where the lines arrive unfiltered.
  const filtered = prefixText ? all.filter((item) => item.includes(prefixText)) : all;
  const selected = filtered.slice(Math.max(0, filtered.length - limit));
  return {
    action,
    deviceId: selectedDevice,
    prefix: prefixText,
    requestedLines: limit,
    lineCount: selected.length,
    deviceFiltered,
    truncated: Boolean(result.timedOut),
    logs: selected,
    output: selected.length
      ? selected.join("\n")
      : result.timedOut
        ? `No matching logs in the ${all.length} lines read before the ${budget}ms deadline.`
        : "No matching logs found.",
  };
}

export function hdcStatus() {
  const hdc = resolveHdcPath();
  return { hdc, installed: hdc !== "hdc" && fs.existsSync(hdc) };
}

// This module owns hdc process spawning and device resolution. `src/device-ui.mjs` needs the same
// primitives, and duplicating a 35-line spawn helper into a second module would leave two copies of
// the timeout and settled-guard logic to keep in sync. Widening visibility is the smaller change:
// every body above is untouched.
//
// `assertHdcSuccess` is deliberately NOT exported. It is built on HDC_FAILURE_PATTERNS, which only
// recognises hdc's own transport failures, whereas `hdc shell X` exits 0 no matter what X did on the
// device -- so it cannot decide whether a remote `snapshot_display` or `uitest` actually worked.
// device-ui.mjs proves success with a positive marker plus a validated artifact instead, and raises
// its own UI_* codes. Do not "fix" that by adding /error:/ to HDC_FAILURE_PATTERNS: hdcLog's collect
// path (above) runs real device logs through assertHdcSuccess, and device logs contain the literal
// string "error:" constantly, so that pattern would make hdc_log throw on virtually every device.
export { run as runHdc, requireHdc, resolveDevice, targetArgs };
