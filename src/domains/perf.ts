import { act, dumpTree, treeSignature, type Action } from "./ui.js";
import { shell } from "./device.js";
import { setTimeout as delay } from "node:timers/promises";
import { saveArtifact } from "../core/artifacts.js";
import { errorResult } from "../core/errors.js";

/*
 * Scroll performance check. Data sources verified on a Pura 80 Pro (API 26):
 *   - `hidumper -s RenderService -a "composer fps"`: the screen's recent vsync-composed frame times in
 *     ns, one per line, newest first (384 frames after a 3 s scroll, 119.3 fps). Exact per-frame gaps.
 *   - `SP_daemon -profilerfps N`: fps per second ("fps:118|<ms>"); fallback when the composer dump is empty.
 *   - `SP_daemon -N 1 -PKG <bundle> -r`: memory; "pss=<KB>".
 *   - NOT usable: `SP_daemon -f` reported fps=0 while the screen was scrolling at 120 Hz.
 */

/** Frame timestamps (ns) from a composer fps dump. Pure. */
export function parseComposerFps(text: string): number[] {
  return [...text.matchAll(/^\s*(\d{10,})\s*$/gm)].map((m) => Number(m[1])).filter((n) => n > 0);
}

/** Merge polled dumps (overlapping windows) into one ascending, de-duplicated series. Pure. */
export function mergeFrames(...series: number[][]) {
  return [...new Set(series.flat())].sort((a, b) => a - b);
}

/**
 * Descriptive statistics for observed short intervals. Longer gaps remain explicit:
 * they may be idle, a stall or missing samples, and prevent a quality verdict.
 * A dropped/janky frame is a gap longer than 1.5 refresh intervals. Pure.
 */
export function frameStats(timestampsNs: number[], reportedHz?: number, idleMs = 200) {
  const ts = [...timestampsNs].sort((a, b) => a - b);
  const gaps: number[] = [];
  const intervals: { start_ns: number; end_ns: number; duration_ms: number; excluded: boolean }[] = [];
  for (let i = 1; i < ts.length; i++) {
    const ms = (ts[i]! - ts[i - 1]!) / 1e6;
    if (ms > 0) intervals.push({ start_ns: ts[i - 1]!, end_ns: ts[i]!, duration_ms: ms, excluded: ms > idleMs });
    if (ms > 0 && ms <= idleMs) gaps.push(ms);
  }
  if (gaps.length < 10) return undefined;
  const sorted = [...gaps].sort((a, b) => a - b);
  // LTPO panels idle at 60 Hz and switch to 120 Hz while animating, so a reading taken before or after
  // the gesture is wrong. The steady frame interval (10th percentile) gives the rate actually used.
  const inferred = [30, 60, 90, 120, 144].reduce((best, hz) => (Math.abs(1000 / hz - sorted[Math.floor(sorted.length * 0.1)]!) < Math.abs(1000 / best - sorted[Math.floor(sorted.length * 0.1)]!) ? hz : best), 60);
  const refreshHz = Math.max(inferred, reportedHz ?? 0);
  const budget = 1000 / refreshHz;
  const pct = (p: number) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!.toFixed(2);
  const active = gaps.reduce((s, g) => s + g, 0);
  const janky = gaps.filter((g) => g > budget * 1.5);
  // Frames the display could have shown but did not, e.g. a 25 ms gap at 120 Hz = 2 missed frames.
  const missed = janky.reduce((s, g) => s + Math.round(g / budget) - 1, 0);
  return {
    excluded_intervals: intervals.filter((i) => i.excluded),
    janky_intervals: intervals.filter((i) => !i.excluded && i.duration_ms > budget * 1.5),
    attribution: "composer timestamps; excluded gaps may be idle or stalls, not proof of either",
    frames: gaps.length + 1,
    refresh_hz: refreshHz,
    avg_fps: +((gaps.length / active) * 1000).toFixed(1),
    frame_ms: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: +sorted.at(-1)!.toFixed(1) },
    janky_frames: janky.length,
    jank_rate: +(janky.length / gaps.length).toFixed(4),
    missed_frames: missed,
    active_ms: Math.round(active),
  };
}

/** Plain-language verdict for the host. Pure. */
export function perfVerdict(stats: NonNullable<ReturnType<typeof frameStats>>) {
  const smooth = stats.avg_fps >= stats.refresh_hz * 0.9 && stats.jank_rate <= 0.05;
  const poor = stats.avg_fps < stats.refresh_hz * 0.7 || stats.jank_rate > 0.15;
  return smooth ? "smooth" : poor ? "janky" : "minor_jank";
}

export const parseSpFps = (text: string) => [...text.matchAll(/fps:(\d+)\|(\d+)/g)].map((m) => ({ fps: Number(m[1]), at: Number(m[2]) }));
export const parsePss = (text: string) => { const v = /^order:\d+\s+pss=(\d+)/m.exec(text)?.[1]; return v ? Number(v) : undefined; };

interface Capture {
  command: string[];
  code?: number | null;
  stdout?: string;
  stderr?: string;
  truncated?: boolean;
  elapsed_ms?: number;
  started_ms?: number;
  finished_ms?: number;
  error?: ReturnType<typeof errorResult>;
}

/** No overlap means the bounded device history cannot prove the intervening frames were captured. */
export function composerCoverage(series: number[][]) {
  const windows: { poll: number; frames: number; first_ns: number; last_ns: number }[] = [];
  const gaps: { after_poll: number; before_poll: number; reason: string }[] = [];
  let previous: Set<number> | undefined, previousPoll = 0;
  for (const [poll, values] of series.entries()) {
    const frames = [...new Set(values)].sort((a, b) => a - b);
    if (!frames.length) {
      if (previous) gaps.push({ after_poll: previousPoll, before_poll: poll, reason: "empty_window_after_frames" });
      continue;
    }
    windows.push({ poll, frames: frames.length, first_ns: frames[0]!, last_ns: frames.at(-1)! });
    if (previous && !frames.some((frame) => previous!.has(frame))) gaps.push({ after_poll: previousPoll, before_poll: poll, reason: "non_overlapping_windows" });
    previous = new Set(frames); previousPoll = poll;
  }
  return { status: gaps.length ? "gaps" : windows.length < 2 ? "insufficient" : "overlapping", windows, gaps };
}

/** Classify command evidence, without guessing why the screen did or did not animate. */
export function perfCommandFailure(result: Capture) {
  if (result.error) return result.error.code === "TIMEOUT" ? "timeout" : "command_error";
  if (result.truncated) return "output_truncated";
  const text = (result.stdout ?? "") + (result.stderr ?? "");
  if (/permission denied|not permitted|access denied/i.test(text)) return "permission_denied";
  if (/command not found|not found.*(?:SP_daemon|hidumper)|unknown (?:command|option)|unsupported|not supported/i.test(text)) return "unsupported_command";
  if (result.code !== 0 || /\[fail\]|\berror\b/i.test(text)) return "command_failed";
  if (!text.trim()) return "empty_output";
  return undefined;
}

export interface PerfOptions {
  /** gestures to perform (default: 3 x up+down flings in the screen centre) */
  gestures?: Action[];
  repeat?: number;
  bundle?: string;
  screen?: { w: number; h: number };
}

/** Sample composer and profiler concurrently over one gesture run; retain raw command evidence. */
export async function measureScroll(target: string, options: PerfOptions, signal: AbortSignal) {
  const started = Date.now();
  const w = options.screen?.w ?? 1080, h = options.screen?.h ?? 2400;
  const x = Math.round(w / 2), top = Math.round(h * 0.3), bottom = Math.round(h * 0.75);
  const gestures = options.gestures ?? Array.from({ length: options.repeat ?? 3 }, () => [
    { action: "swipe", x, y: bottom, x2: x, y2: top, speed: 3000 } as Action,
    { action: "swipe", x, y: top, x2: x, y2: bottom, speed: 3000 } as Action,
  ]).flat();
  const captures: Capture[] = [];
  const capture = async (command: string[], timeoutMs: number, commandSignal = signal) => {
    const at = Date.now();
    let result: Capture;
    try {
      const output = await shell(target, command, commandSignal, timeoutMs);
      result = { command, code: output.code, stdout: output.stdout, stderr: output.stderr, truncated: output.truncated, elapsed_ms: output.elapsedMs };
    } catch (error) {
      signal.throwIfAborted();
      result = { command, error: errorResult(error) };
    }
    result.started_ms = at - started;
    result.finished_ms = Date.now() - started;
    captures.push(result);
    return result;
  };
  const readPss = async () => {
    if (!options.bundle || !/^[\w.]+$/.test(options.bundle)) return undefined;
    const result = await capture(["SP_daemon", "-N", "1", "-PKG", options.bundle, "-r"], 20000);
    return perfCommandFailure(result) ? undefined : parsePss(result.stdout ?? "");
  };
  const memBefore = await readPss();
  const refresh = await capture(["SP_daemon", "-N", "1", "-f"], 15000);
  const reportedHz = Number(/refreshrate=(\d+)/.exec(refresh.stdout ?? "")?.[1]);
  const hz = !perfCommandFailure(refresh) && reportedHz > 0 ? reportedHz : undefined;
  const cleared = await capture(["hidumper -s RenderService -a 'composer fpsClear'"], 10000);
  const clearFailed = !!cleared.error || cleared.code !== 0 || /\[fail\]|\berror\b|not supported|permission denied/i.test((cleared.stdout ?? "") + (cleared.stderr ?? ""));
  const series: number[][] = [], dumps: Capture[] = [];
  let composerFailure: string | undefined;
  const sampleComposer = async (commandSignal = signal) => {
    const result = await capture(["hidumper -s RenderService -a 'composer fps'"], 15000, commandSignal);
    dumps.push(result);
    composerFailure ??= perfCommandFailure(result);
    if (!clearFailed && !composerFailure) series.push(parseComposerFps(result.stdout ?? ""));
  };
  // Read before any gesture, then independently at 1 Hz. Sampling after act() loses
  // frames whenever a gesture/tree wait outlives RenderService's recent-frame buffer.
  if (!clearFailed) await sampleComposer();
  const controller = new AbortController();
  const samplerSignal = AbortSignal.any([signal, controller.signal]);
  // Attach rejection handling immediately: gesture failures must not leave a sampler running.
  let collecting = true;
  const composerSampler = (async () => {
    while (collecting && !clearFailed && !composerFailure) {
      await delay(1000, undefined, { signal: samplerSignal });
      if (collecting) await sampleComposer(samplerSignal);
    }
  })();
  void composerSampler.catch(() => undefined);
  const sampler = (async () => {
    const results: Capture[] = [];
    do {
      const since = Date.now();
      const result = await capture(["SP_daemon", "-profilerfps", "1"], 15000, samplerSignal);
      results.push(result);
      if (perfCommandFailure(result) || !collecting) break; // never retry a failed/unsupported command
      // Bound polling even if a device returns immediately; avoid a busy loop.
      if (Date.now() - since < 900) await delay(900 - (Date.now() - since), undefined, { signal: samplerSignal });
    } while (collecting);
    return results;
  })();
  void sampler.catch(() => undefined); // handled even if caller cancellation arrives during an action
  let profiler: Capture[];
  const activity: { index: number; started_ms: number; finished_ms: number; status: string; scope: string }[] = [];
  try {
    for (const g of gestures) {
      signal.throwIfAborted();
      const scoped = g.action === "scroll" && g.selector;
      const before = scoped ? undefined : treeSignature(await dumpTree(target, signal));
      const at = Date.now(), result = await act(target, g, signal);
      const finished = Date.now();
      activity.push({ index: activity.length, started_ms: at - started, finished_ms: finished - started,
        status: scoped ? result.motion?.status ?? "unobserved" : treeSignature(await dumpTree(target, signal)) !== before ? "changed" : "unchanged",
        scope: scoped ? "selected-subtree" : "screen" });
    }
    await delay(600, undefined, { signal });
    collecting = false;
    [profiler] = await Promise.all([sampler, composerSampler]);
    // Join first: never overlap two composer commands, including the final read.
    if (!clearFailed && !composerFailure) await sampleComposer();
  } finally {
    collecting = false;
    controller.abort();
    await Promise.allSettled([sampler, composerSampler]);
  }
  signal.throwIfAborted();
  const frames = mergeFrames(...series);
  const stats = frameStats(frames, hz);
  const sampling = { interval_ms: 1000, ...composerCoverage(series) };
  const memAfter = await readPss();
  const memory = memBefore !== undefined && memAfter !== undefined ? { pss_kb_before: memBefore, pss_kb_after: memAfter, delta_kb: memAfter - memBefore } : undefined;
  const allSamples = profiler.flatMap((result) => parseSpFps(result.stdout ?? ""));
  const samples = profiler.filter((result) => !perfCommandFailure(result)).flatMap((result) => parseSpFps(result.stdout ?? "")).filter((s) => s.fps > 0);
  const profilerFailure = profiler.map(perfCommandFailure).find(Boolean);
  const zeroRecords = dumps.reduce((sum, dump) => sum + [...(dump.stdout ?? "").matchAll(/^\s*0\s*$/gm)].length, 0);
  const diagnostics = {
    composer: { polls: dumps.length, timestamps: frames.length, zero_records: zeroRecords, reason: clearFailed ? "clear_failed" : composerFailure ?? (stats ? undefined : frames.length ? "insufficient_frame_intervals" : zeroRecords ? "all_zero_timestamps" : "no_frame_timestamps") },
    profilerfps: { polls: profiler.length, valid_samples: samples.length, zero_samples: allSamples.filter((s) => s.fps === 0).length, total_samples: allSamples.length,
      reason: samples.length ? undefined : profilerFailure ?? (allSamples.length ? "all_zero_samples" : "unrecognized_output") },
  };
  const activityVerified = activity.length > 0 && activity.every((a) => a.status === "changed");
  const artifact = await saveArtifact(JSON.stringify({ target, started_at: new Date(started).toISOString(), gestures, activity, captures, diagnostics, sampling }, null, 2), "application/json");
  const common = { gestures: gestures.length, elapsed_ms: Date.now() - started, activity, activity_verified: activityVerified, diagnostics, sampling, diagnostic_artifact: artifact.artifact_id, ...(memory ? { memory } : {}) };
  if (stats) return { source: "composer", verdict: activityVerified && !composerFailure && sampling.status === "overlapping" && !stats.excluded_intervals.length ? perfVerdict(stats) : "inconclusive", ...stats, ...common };
  if (samples.length) return {
    source: "profilerfps", verdict: "fps_only", avg_fps: +(samples.reduce((s, x) => s + x.fps, 0) / samples.length).toFixed(1),
    min_fps: Math.min(...samples.map((s) => s.fps)), samples: samples.length, ...common,
    note: "Per-second positive FPS samples only (zero samples reported separately); no per-frame jank verdict is available",
  };
  return { source: "none", verdict: "inconclusive", ...common,
    note: "No valid frame data. This does not prove the screen was idle or the emulator is unsupported. Read diagnostic_artifact for stdout/stderr/exit codes and inspect the gesture target and device profiling capabilities" };
}
