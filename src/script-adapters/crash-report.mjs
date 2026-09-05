// Select one crash event before calling the vendored formatting/file-ranking helpers.
// Hilog contains ordinary messages about crash reporting as well as interleaved processes.
import { buildCrashReport as upstreamReport } from "../../skills/arkts-runtime-fix/scripts/shared/jscrash-parse.mjs";

const FIELD = /^(bundle\s*name|bundle|app|process\s*name|process|pid|timestamp)\s*[:：]\s*(.*)$/i;
const NAME = /^Error\s+name\s*[:：]\s*(\S.*)$/i;
const MESSAGE = /^Error\s+message\s*[:：]\s*(.*)$/i;
const EXCEPTION = /^(?:(?:Reason|Uncaught(?:\s+exception)?|Unhandled(?:\s+promise\s+rejection)?)\s*[:：]?\s+)?([\w.$]*Error)\s*[:：]\s*(.*)$/i;
const UNCAUGHT = /^(?:Uncaught\s+exception|Unhandled\s+promise\s+rejection|Fatal\s+exception)\s*[:：]\s*(\S.*)$/i;
const STACK = /^(?:at\s+.+|[^\s]+@.*\.(?:ets|ts|js):\d+(?::\d+)?)$/;

function logRecords(input) {
  const streams = new Map();
  let lastPid = "";
  String(input).split(/\r?\n/).forEach((raw, index) => {
    const hilog = /^\s*(?:\d{4}-)?\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+(\d+)\s+\d+\s+[VDIWEF]\s+[^:]*:\s?(.*)$/.exec(raw);
    if (hilog) lastPid = hilog[1];
    const pid = hilog?.[1] ?? lastPid;
    if (!streams.has(pid)) streams.set(pid, []);
    streams.get(pid).push({ text: (hilog?.[2] ?? raw).trim(), index });
  });
  return streams;
}

function eventsIn(records, pid) {
  const events = [];
  let event = { bundle: "", process: "", pid, lines: [], frames: [], index: -1 };
  let inStack = false;
  const flush = (inherit = false) => {
    if (event.type || (event.uncaught && event.frames.length)) events.push(event);
    event = { bundle: inherit ? event.bundle : "", process: inherit ? event.process : "", pid,
      lines: [], frames: [], index: -1 };
    inStack = false;
  };
  for (const { text, index } of records) {
    const field = FIELD.exec(text);
    const name = NAME.exec(text);
    const exception = EXCEPTION.exec(text);
    const uncaught = UNCAUGHT.exec(text);
    if (field && (event.type || event.uncaught)) flush();
    if ((name || exception) && event.type) flush(true);
    if (field) {
      const key = field[1].replace(/\s/g, "").toLowerCase();
      if (["bundle", "bundlename", "app"].includes(key)) event.bundle = field[2];
      if (["process", "processname"].includes(key)) event.process = field[2];
      if (key === "pid") event.pid = field[2];
    }
    if (name || exception || uncaught) {
      event.index = index;
      event.type = name?.[1] ?? exception?.[1];
      event.message = exception?.[2] ?? uncaught?.[1];
      event.uncaught = Boolean(uncaught);
      inStack = true;
    }
    if (event.type || event.uncaught) {
      const message = MESSAGE.exec(text);
      if (/^Stack(?:trace)?\s*[:：]?$/i.test(text)) inStack = true;
      if (message) event.message = message[1];
      if (inStack && STACK.test(text)) event.frames.push(text);
      else if (text && !name && !exception && !uncaught && !message && !/^Stack(?:trace)?\s*[:：]?$/i.test(text)) inStack = false;
    }
    event.lines.push(text);
  }
  flush();
  return events;
}

export function buildCrashReport(input, source, device, bundleName = "", processHint = "") {
  const events = [...logRecords(input)].flatMap(([pid, records]) => eventsIn(records, pid));
  const selected = events.filter((event) =>
    (!bundleName || !(event.bundle || event.process) || (event.bundle || event.process.split(":")[0]) === bundleName)
    && (!processHint || !(event.process || event.pid) || (event.process || event.pid).includes(processHint)))
    .sort((a, b) => b.index - a.index)[0];
  if (!selected) {
    return { status: "no_crash_signature", source, device, bundle: bundleName || "(not found)",
      process: processHint || "(not found)", errorType: "UnknownError", errorMessage: "(not found)",
      suspectedFile: "(not found)", topStack: [], keywords: [], excerpt: [] };
  }
  const errorType = selected.type ?? "UnknownError";
  const errorMessage = selected.message || "(not found)";
  const topStack = [...new Set(selected.frames)].slice(0, 8);
  const canonical = [`Error name: ${errorType}`, `Error message: ${errorMessage}`, "Stacktrace:", ...topStack].join("\n");
  const report = upstreamReport(canonical, source, device, selected.bundle || bundleName, selected.process || selected.pid || processHint);
  return { ...report, status: "detected", errorType, errorMessage, topStack,
    excerpt: selected.lines.filter(Boolean).slice(0, 24) };
}
