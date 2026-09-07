import { invariant } from "../core/errors.js";
import { faultlogBundle } from "./faultlog-format.js";

interface CrashEvent {
  source: string | null;
  pid: string | null;
  bundle: string | null;
  process: string | null;
  kind: string | null;
  message: string | null;
  frames: string[];
  excerpt: string[];
  index: number;
  uncaught: boolean;
  stack: boolean;
}
export interface CrashOptions {
  bundle_name?: string;
  process_hint?: string;
  truncated?: boolean;
  selection_complete?: boolean;
  faultlog_name?: string;
}
/** Select an attributed crash event before matching knowledge. Ordinary mentions are not crash signatures. */
export function parseCrash(log: string, options: CrashOptions = {}) {
  invariant(
    log.trim().length > 0,
    "CRASH_EVIDENCE_MISSING",
    "Crash log is empty",
  );
  invariant(
    Buffer.byteLength(log) <= 8 * 1024 * 1024,
    "LOG_TOO_LARGE",
    "Crash evidence limit is 8 MiB",
  );
  const events: CrashEvent[] = [],
    streams = new Map<string, CrashEvent>();
  let source: string | null = options.faultlog_name ?? null,
    lastPid: string | null = null,
    bounded = false;
  const empty = (pid: string | null, previous?: CrashEvent): CrashEvent => ({
    source,
    pid,
    bundle: previous?.bundle ?? (source ? faultlogBundle(source) : null),
    process: previous?.process ?? null,
    kind: null,
    message: null,
    frames: [],
    excerpt: [],
    index: -1,
    uncaught: false,
    stack: false,
  });
  const flush = (event: CrashEvent) => {
    if (!event.kind && !(event.uncaught && event.frames.length)) return;
    events.push(event);
    if (events.length > 1000) {
      events.shift();
      bounded = true;
    }
  };
  for (const [index, raw] of log.split(/\r?\n/).entries()) {
    const section =
      /^Source:\s*((?:jscrash|cppcrash|appfreeze)-[A-Za-z0-9_.-]+)$/.exec(raw);
    if (section) {
      for (const event of streams.values()) flush(event);
      streams.clear();
      source = section[1]!;
      lastPid = null;
      continue;
    }
    const hilog =
      /^\s*(?:\d{4}-)?\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+(\d+)\s+\d+\s+[VDIWEF]\s+[^:]*:\s?(.*)$/.exec(
        raw,
      );
    if (hilog) lastPid = hilog[1]!;
    const pid = hilog?.[1] ?? lastPid,
      key = pid ?? "file",
      text = (hilog?.[2] ?? raw).trim();
    if (!streams.has(key)) {
      if (streams.size >= 512) {
        bounded = true;
        continue;
      }
      streams.set(key, empty(pid));
    }
    let event = streams.get(key)!;
    const field =
        /^(bundle\s*name|bundle|app|process\s*name|process|pid|timestamp)\s*[:：]\s*(.*)$/i.exec(
          text,
        ),
      name = /^Error\s+name\s*[:：]\s*([\w.$]*Error)\s*$/i.exec(text),
      exception =
        /^(?:(?:Reason|Uncaught(?:\s+exception)?|Unhandled(?:\s+promise\s+rejection)?)\s*[:：]?\s+)?([\w.$]*Error)\s*[:：]\s*(.*)$/i.exec(
          text,
        ),
      uncaught =
        /^(?:Uncaught\s+exception|Unhandled\s+promise\s+rejection|Fatal\s+exception)\s*[:：]\s*(\S.*)$/i.exec(
          text,
        ),
      native =
        /^(?:Reason\s*[:：]\s*)?(?:Signal\s*[:：]\s*)?(?:SIG(?:SEGV|ABRT|BUS|ILL|FPE)\b|Fatal signal\s+\d+\b)/i.test(
          text,
        ),
      freeze =
        source?.startsWith("appfreeze-") && /^Reason\s*[:：]\s*\S/.test(text);
    if (field && (event.kind || event.uncaught)) {
      flush(event);
      event = empty(pid);
      streams.set(key, event);
    }
    if ((name || exception || native || freeze) && event.kind) {
      flush(event);
      event = empty(pid, event);
      streams.set(key, event);
    }
    if (field) {
      const label = field[1]!.replace(/\s/g, "").toLowerCase(),
        value = field[2]!.slice(0, 256);
      if (["bundle", "bundlename", "app"].includes(label)) event.bundle = value;
      if (["process", "processname"].includes(label)) event.process = value;
      if (label === "pid") event.pid = value;
    }
    if (name || exception || uncaught || native || freeze) {
      event.kind =
        name?.[1] ??
        exception?.[1] ??
        (native ? "NativeCrash" : freeze ? "AppFreeze" : null);
      event.message =
        (
          exception?.[2] ??
          uncaught?.[1] ??
          (native || freeze ? text : "")
        ).slice(0, 2048) || null;
      event.uncaught = Boolean(uncaught);
      event.stack = true;
      event.index = index;
    }
    if (event.kind || event.uncaught) {
      const message = /^Error\s+message\s*[:：]\s*(.*)$/i.exec(text);
      if (message) event.message = message[1]!.slice(0, 2048);
      const stackHeader =
        /^(?:Stack(?:trace)?|Fault thread info)\s*[:：]?$/i.test(text);
      if (stackHeader) event.stack = true;
      if (
        event.stack &&
        /^(?:at\s+.+|#\d+\s+.+|[^\s]+@.*\.(?:ets|ts|js):\d+(?::\d+)?)$/.test(
          text,
        )
      ) {
        if (event.frames.length < 100) event.frames.push(text.slice(0, 2048));
        else bounded = true;
      } else if (
        text &&
        !name &&
        !exception &&
        !uncaught &&
        !native &&
        !freeze &&
        !message &&
        !stackHeader
      )
        event.stack = false;
    }
    if (text && event.excerpt.length < 32)
      event.excerpt.push(text.slice(0, 2048));
  }
  for (const event of streams.values()) flush(event);
  const bundleOf = (event: CrashEvent) =>
    event.bundle ?? event.process?.split(":")[0] ?? null;
  const matching = events
    .filter(
      (event) =>
        (!options.bundle_name || bundleOf(event) === options.bundle_name) &&
        (!options.process_hint ||
          [event.process, event.pid].some((value) =>
            value?.includes(options.process_hint!),
          )),
    )
    .sort((a, b) => b.index - a.index);
  const selected = matching[0],
    incomplete = Boolean(
      options.truncated || options.selection_complete === false || bounded,
    ),
    unattributed = events.some(
      (event) =>
        (options.bundle_name && !bundleOf(event)) ||
        (options.process_hint && !event.process && !event.pid),
    );
  return {
    evidencePresent: true,
    status: selected
      ? "detected"
      : incomplete || unattributed
        ? "insufficient_evidence"
        : "no_crash_signature",
    kind: selected?.kind ?? "Unknown",
    error_message: selected?.message ?? null,
    source: selected?.source ?? null,
    bundle: selected ? bundleOf(selected) : null,
    process: selected?.process ?? null,
    pid: selected?.pid ?? null,
    frames: selected?.frames ?? [],
    excerpt: selected?.excerpt ?? [],
    event_count: events.length,
    matching_event_count: matching.length,
    evidence_truncated: Boolean(options.truncated),
    selection_complete: !incomplete,
    unattributed_events: Boolean(unattributed),
    // Classification is evidence for investigation, never proof of a root cause or absence of other crashes.
    diagnosisComplete: false,
    compilationVerified: false,
  };
}
