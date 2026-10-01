import type { Selector } from "./ui.js";

/*
 * Repeated-path detection. The opencode session walked "工具 -> 动态锁屏 -> 雨雾悬停" by hand after each
 * of five deploys (3-6 model round trips each). Per device we remember the selector taps made since
 * the app was last launched; when a run starts with the same 2+ taps as an earlier run, the act
 * result suggests saving the path once (save_flow) and passing run then_flow next time.
 * In memory only: it is a hint, never state anything depends on.
 */

interface History { runs: string[][]; current: string[]; suggested: Set<string> }
const histories = new Map<string, History>();
const MAX_RUNS = 5, MAX_TAPS = 30;

/** Every selector field, so the suggested steps select exactly what was tapped. */
const tapKey = (s: Selector) => JSON.stringify(Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))));
const fromKey = (k: string) => JSON.parse(k) as Selector;
function get(target: string) {
  let h = histories.get(target);
  if (!h) histories.set(target, (h = { runs: [], current: [], suggested: new Set() }));
  return h;
}

/** The app was (re)launched on this device: the taps so far become a finished run. */
export function noteLaunch(target: string) {
  const h = get(target);
  if (h.current.length) h.runs = [...h.runs, h.current].slice(-MAX_RUNS);
  h.current = [];
}

/**
 * Record selector taps (coordinate taps are not reusable and break the sequence). Returns the
 * repeated opening path when the current run so far equals the start of an earlier run, 2+ taps
 * long, and it was not suggested before.
 */
export function noteTaps(target: string, taps: (Selector | undefined)[]): Selector[] | undefined {
  const h = get(target);
  for (const s of taps) {
    if (!s) { h.current = []; continue; } // a coordinate tap: what follows is not a reusable path from launch
    if (h.current.length < MAX_TAPS) h.current.push(tapKey(s));
  }
  if (h.current.length < 2) return undefined;
  const now = h.current;
  const repeated = h.runs.some((run) => run.length >= now.length && now.every((k, i) => run[i] === k));
  const id = now.join("\u0000");
  if (!repeated || h.suggested.has(id)) return undefined;
  h.suggested.add(id);
  return now.map(fromKey);
}

export function repeatSuggestion(path: Selector[]) {
  return {
    note: `You walked this ${path.length}-tap path after an earlier launch too. Save it once (from the launch screen) and let every deploy land here: ui act steps=[...] assert=... save_flow={project,id}, then run build_run then_flow=<id>.`,
    steps: path.map((selector) => ({ op: "click", selector })),
  };
}

/** Tests only. */
export function resetRepeats() { histories.clear(); }
