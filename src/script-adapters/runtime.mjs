// Local execution adapter. Official parsing helpers and Skill sources stay intact.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hdcLog, requireHdc, resolveDevice, runHdc, targetArgs, hdcFailureMessage } from "../hdc-log.mjs";
import { buildNextActionText, formatCrashReportText } from "../../skills/arkts-runtime-fix/scripts/shared/jscrash-parse.mjs";
import { buildCrashReport } from "./crash-report.mjs";
import { faultlogMatchesBundle } from "../../skills/arkts-runtime-fix/scripts/shared/jscrash-faultlogger.mjs";

// Inherit the registry's process group so its deadline reaches HDC as well.
const processOptions = { detached: false };
const REMOTE_EXIT = "__DEVECO_REMOTE_EXIT__=";

function parseArgs(argv) {
  const values = new Map();
  const optional = new Set(["device-id", "bundle-name", "process-hint", "log-file", "log-text", "source", "device"]);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "include-text") { values.set(key, true); continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      if (optional.has(key)) { values.set(key, ""); continue; }
      throw new Error(`Missing value for --${key}`);
    }
    values.set(key, value);
    i += 1;
  }
  return values;
}

function required(args, key) {
  const value = args.get(key);
  if (!value) throw new Error(`Required: --${key}`);
  return value;
}

function numberArg(args, key, fallback, min, max, integer = true) {
  const value = Number(args.get(key) ?? fallback);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    throw new Error(`--${key} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
  }
  return value;
}

export function faultlogTimestamp(name, offsetMinutes = 0) {
  const raw = /-(\d{10,17})(?:\.log)?$/.exec(name)?.[1];
  if (!raw) return null;
  // Hiview lists YYYYMMDDHHmmss[SSS], often without .log; other SDKs
  // expose epoch seconds/milliseconds. Calendar values use the device zone.
  if (/^(?:19|20)\d{12}(?:\d{3})?$/.test(raw)) {
    const parts = [raw.slice(0, 4), raw.slice(4, 6), raw.slice(6, 8), raw.slice(8, 10), raw.slice(10, 12), raw.slice(12, 14)].map(Number);
    const [year, month, day, hour, minute, second] = parts;
    const stamp = Date.UTC(year, month - 1, day, hour, minute, second, Number(raw.slice(14) || 0));
    const date = new Date(stamp);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
    return stamp - offsetMinutes * 60000;
  }
  return Number(raw) * (raw.length <= 11 ? 1000 : 1);
}

export function selectFaultlogs(text, bundle, maxAgeMinutes, now = Date.now(), offsetMinutes = 0) {
  const names = [...new Set((text.match(/\bjscrash-[A-Za-z0-9._-]+-\d{10,17}(?:\.log)?\b/g) ?? [])
    .map((name) => name.endsWith(".log") ? name : `${name}.log`))];
  return names.filter((name) => {
    if (!faultlogMatchesBundle(name, bundle)) return false;
    if (maxAgeMinutes <= 0) return true;
    const timestamp = faultlogTimestamp(name, offsetMinutes);
    return timestamp !== null && timestamp <= now && now - timestamp <= maxAgeMinutes * 60000;
  }).sort((a, b) => (faultlogTimestamp(b, offsetMinutes) ?? 0) - (faultlogTimestamp(a, offsetMinutes) ?? 0));
}

async function deviceClock(hdc, device) {
  const out = await runHdc([hdc, ...targetArgs(device), "shell", "date '+%s %z'"], 30000, processOptions);
  const failure = hdcFailureMessage(out);
  if (failure) throw new Error(failure);
  const match = /^(\d+)\s+([+-])(\d{2})(\d{2})$/.exec(out.stdout.trim());
  if (!match) throw new Error(`Cannot read device clock: ${out.stdout || out.stderr}`);
  return { now: Number(match[1]) * 1000, offset: (Number(match[3]) * 60 + Number(match[4])) * (match[2] === "+" ? 1 : -1) };
}

async function collect(args, lines) {
  const result = await hdcLog({ action: "collect", device_id: args.get("device-id"),
    lines, log_prefix: "", timeoutMs: 110000 }, processOptions);
  // An incomplete buffer cannot support a definitive negative crash diagnosis.
  if (result.truncated) throw new Error("HILOG collection timed out before the snapshot completed");
  return result.logs.join("\n");
}

async function remoteListing(hdc, device, command) {
  // HDC itself exits zero even when the remote command fails. Read the remote
  // shell's status explicitly; command is one of the two fixed strings below.
  const out = await runHdc([hdc, ...targetArgs(device), "shell",
    `${command}; rc=$?; printf '\\n${REMOTE_EXIT}%s\\n' "$rc"`], 30000, processOptions);
  const failure = hdcFailureMessage(out);
  if (failure) throw new Error(failure);
  const marker = new RegExp(`\\r?\\n${REMOTE_EXIT}(\\d+)\\s*$`).exec(out.stdout);
  const text = marker ? out.stdout.slice(0, marker.index) : out.stdout;
  if (!marker || Number(marker[1]) !== 0 || /(?:permission denied|not found|unknown service|invalid service|no such file)/i.test(`${text}\n${out.stderr}`)) {
    throw new Error(`${command}: ${text.trim() || out.stderr.trim() || "remote exit status missing"}`);
  }
  return text;
}

export async function runRuntimeScript(id, argv) {
  const args = parseArgs(argv);
  if (id === "jscrash_report" || id === "parse_jscrash_log") {
    if (args.get("log-text") && args.get("log-file")) throw new Error("Provide at most one of --log-text or --log-file");
    if (id === "parse_jscrash_log" && !args.get("log-text") && !args.get("log-file")) {
      throw new Error("Provide exactly one of --log-text or --log-file");
    }
    const lines = numberArg(args, "lines", 4000, 200, 10000);
    const kind = args.get("log-text") ? "text" : args.get("log-file") ? "file" : "device_hilog";
    const source = args.get("source") || kind;
    const text = kind === "text" ? args.get("log-text") : kind === "file"
      ? await fs.readFile(args.get("log-file"), "utf8") : await collect(args, lines);
    const report = buildCrashReport(text, source, args.get("device-id") || args.get("device") || "default", args.get("bundle-name") || "", args.get("process-hint") || "");
    return { status: report.status === "detected" ? "detected" : "no_crash_signature", source,
      error_type: report.errorType, error_message: report.errorMessage, suspected_file: report.suspectedFile,
      top_stack: report.topStack.join("|"), keywords: report.keywords.join(","), next_action: buildNextActionText(report),
      ...(args.has("include-text") ? { text: formatCrashReportText(report) } : {}) };
  }
  if (id === "collect_hilog") {
    const dir = required(args, "output-dir");
    const text = await collect(args, numberArg(args, "lines", 4000, 1, 10000));
    await fs.mkdir(dir, { recursive: true });
    const logFile = path.join(dir, `hilog-${Date.now()}.txt`);
    await fs.writeFile(logFile, text, "utf8");
    return { status: "collected", source: "device_hilog", log_file: logFile, log_excerpt: text.slice(0, 800),
      next_action: `Parse the snapshot with parse_jscrash_log --log-file "${logFile}" --source hilog.` };
  }
  if (id === "probe_faultlogger") {
    const bundle = args.get("bundle-name") || "";
    const age = numberArg(args, "max-age-minutes", 30, 0, Number.MAX_SAFE_INTEGER, false);
    const limit = numberArg(args, "limit", 10, 1, Number.MAX_SAFE_INTEGER);
    const hdc = requireHdc();
    const device = await resolveDevice(hdc, args.get("device-id"), processOptions);
    const listings = await Promise.allSettled([
      remoteListing(hdc, device, "hidumper -s 1201 -a '-p Faultlogger %s -LogSuffixWithMs'"),
      remoteListing(hdc, device, "ls -1 /data/log/faultlog/faultlogger"),
    ]);
    const successes = listings.filter((item) => item.status === "fulfilled");
    const warnings = listings.filter((item) => item.status === "rejected").map((item) => item.reason.message);
    if (!successes.length) throw new Error(warnings.join("; "));
    const clock = await deviceClock(hdc, device);
    const names = selectFaultlogs(successes.map((item) => item.value).join("\n"), bundle, age, clock.now, clock.offset);
    return { status: names.length ? "found" : "not_found", bundle_name: bundle,
      latest_faultlog: names[0] || "", latest_timestamp: names.length ? String(faultlogTimestamp(names[0], clock.offset) ?? "") : "",
      matched_count: String(names.length), candidates: names.slice(0, limit).join("|"),
      next_action: names.length ? `Fetch ${names[0]} with fetch_faultlog.` : "No recent matching faultlog was found.",
      ...(warnings.length ? { warnings } : {}) };
  }
  if (id === "fetch_faultlog") {
    const name = path.basename(required(args, "faultlog-name").trim());
    const base = name.endsWith(".log") ? name : `${name}.log`;
    // HDC parses its remote path as a command; faultlogger names need no shell syntax.
    if (!/^[A-Za-z0-9._-]+\.log$/.test(base)) throw new Error("Invalid faultlog filename");
    const dir = path.resolve(required(args, "output-dir"));
    const hdc = requireHdc();
    const device = await resolveDevice(hdc, args.get("device-id"), processOptions);
    await fs.mkdir(dir, { recursive: true });
    const staging = await fs.mkdtemp(path.join(dir, ".faultlog-"));
    const local = path.join(dir, base);
    const remote = `/data/log/faultlog/faultlogger/${base}`;
    try {
      const temporary = path.join(staging, base);
      const out = await runHdc([hdc, ...targetArgs(device), "file", "recv", remote, temporary], 110000, processOptions);
      const failure = hdcFailureMessage(out);
      if (failure) throw new Error(failure);
      if (!(await fs.stat(temporary)).isFile()) throw new Error("Local file missing after recv");
      await fs.rename(temporary, local);
      return { status: "fetched", faultlog_name: base, remote_path: remote, local_path: local,
        next_action: `Parse with parse_jscrash_log --log-file "${local}".` };
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
  throw new Error(`Unknown runtime script: ${id}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const id = process.argv[2];
  try {
    process.stdout.write(`${JSON.stringify(await runRuntimeScript(id, process.argv.slice(3)))}\n`);
  } catch (error) {
    const status = { collect_hilog: "collect_failed", fetch_faultlog: "fetch_failed", probe_faultlogger: "probe_failed", jscrash_report: "parse_failed", parse_jscrash_log: "parse_failed" }[id];
    process.stdout.write(`${JSON.stringify({ status, code: error.code ?? "SCRIPT_ERROR", next_action: error.message })}\n`);
    process.exitCode = 1;
  }
}
