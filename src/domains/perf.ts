import { act, type Action } from "./ui.js";
import { shell } from "./device.js";

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
 * Frame statistics over the time the screen was actually animating: gaps longer than `idleMs`
 * (screen idle between gestures, nothing to compose) are not frames the user waited for.
 * A dropped/janky frame is a gap longer than 1.5 refresh intervals. Pure.
 */
export function frameStats(timestampsNs: number[], reportedHz?: number, idleMs = 200) {
  const ts = [...timestampsNs].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const ms = (ts[i]! - ts[i - 1]!) / 1e6;
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

// One command string: hdc only keeps the quoted "composer fps" argument together that way (verified).
async function composer(target: string, signal?: AbortSignal) {
  return parseComposerFps((await shell(target, ["hidumper -s RenderService -a 'composer fps'"], signal, 15000)).stdout);
}
async function refreshRate(target: string, signal?: AbortSignal) {
  const out = (await shell(target, ["SP_daemon", "-N", "1", "-f"], signal, 15000).catch(() => undefined))?.stdout ?? "";
  const hz = Number(/refreshrate=(\d+)/.exec(out)?.[1]);
  return hz > 0 ? hz : undefined;
}
async function pss(target: string, bundle: string | undefined, signal?: AbortSignal) {
  if (!bundle || !/^[\w.]+$/.test(bundle)) return undefined;
  return parsePss((await shell(target, ["SP_daemon", "-N", "1", "-PKG", bundle, "-r"], signal, 20000).catch(() => undefined))?.stdout ?? "");
}

export interface PerfOptions {
  /** gestures to perform (default: 3 x up+down flings in the screen centre) */
  gestures?: Action[];
  repeat?: number;
  bundle?: string;
  screen?: { w: number; h: number };
}

/** Clear, run the gestures while polling frame times, then summarise. */
export async function measureScroll(target: string, options: PerfOptions, signal: AbortSignal) {
  const w = options.screen?.w ?? 1080, h = options.screen?.h ?? 2400;
  const x = Math.round(w / 2), top = Math.round(h * 0.3), bottom = Math.round(h * 0.75);
  const gestures = options.gestures ?? Array.from({ length: options.repeat ?? 3 }, () => [
    { action: "swipe", x, y: bottom, x2: x, y2: top, speed: 3000 } as Action,
    { action: "swipe", x, y: top, x2: x, y2: bottom, speed: 3000 } as Action,
  ]).flat();
  const memBefore = await pss(target, options.bundle, signal);
  const hz = await refreshRate(target, signal);
  await shell(target, ["hidumper -s RenderService -a 'composer fpsClear'"], signal, 10000).catch(() => undefined);
  const series: number[][] = [];
  const started = Date.now();
  let lastPoll = Date.now();
  for (const g of gestures) {
    signal.throwIfAborted();
    await act(target, g, signal);
    // The composer keeps a bounded window: poll often enough not to lose frames between reads.
    if (Date.now() - lastPoll > 1500) { series.push(await composer(target, signal)); lastPoll = Date.now(); }
  }
  await new Promise((r) => setTimeout(r, 600)); // let the last fling settle
  series.push(await composer(target, signal));
  const stats = frameStats(mergeFrames(...series), hz);
  const memAfter = await pss(target, options.bundle, signal);
  const memory = memBefore !== undefined && memAfter !== undefined ? { pss_kb_before: memBefore, pss_kb_after: memAfter, delta_kb: memAfter - memBefore } : undefined;
  if (stats) return { source: "composer", gestures: gestures.length, elapsed_ms: Date.now() - started, verdict: perfVerdict(stats), ...stats, ...(memory ? { memory } : {}) };
  // Fallback: per-second fps while repeating the gestures once more.
  const sampler = shell(target, ["SP_daemon", "-profilerfps", String(Math.max(3, gestures.length))], signal, 60000);
  for (const g of gestures) await act(target, g, signal);
  const samples = parseSpFps((await sampler).stdout).filter((s) => s.fps > 0);
  return {
    source: "profilerfps", gestures: gestures.length, elapsed_ms: Date.now() - started,
    ...(samples.length ? { avg_fps: +(samples.reduce((s, x) => s + x.fps, 0) / samples.length).toFixed(1), min_fps: Math.min(...samples.map((s) => s.fps)), samples: samples.length } : { note: "No frame data: the screen did not animate (nothing scrollable at the centre?)" }),
    ...(memory ? { memory } : {}),
  };
}
