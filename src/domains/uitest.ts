import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { saveArtifact } from "../core/artifacts.js";
import { database } from "../core/db.js";
import { invariant, ToolError } from "../core/errors.js";
import { forceStop, launch, pidOf, shell } from "./device.js";
import { act, compact, dumpTree, screenshot, waitFor, type Action, type Selector } from "./ui.js";

/*
 * Host-driven UI test sessions (parity with deveco-code verify_ui / get_ui_verification_log /
 * save_ui_screenshot, without an embedded model): the host executes the natural-language plan
 * step by step; this module captures evidence per step (before/after screenshots, element
 * summary, app log window) and records control assertions and host visual reviews.
 * A failed control assertion can never be overridden by a visual review.
 */

export interface StepRecord {
  n: number;
  kind: "act" | "assert" | "observe" | "review";
  description?: string;
  action?: Action;
  selector?: Selector;
  passed?: boolean;
  detail?: unknown;
  before?: string; // screenshot artifact ids
  after?: string;
  elements?: string;
  log?: string;
  at: number;
}
export interface Review { step: number; screenshot: string; requirement: string; outcome?: "passed" | "failed" | "insufficient"; reason?: string }
export interface TestSession {
  id: string;
  target: string;
  bundle?: string;
  plan: string;
  checklist: string[];
  status: "running" | "passed" | "failed" | "inconclusive";
  started: number;
  finished?: number;
  steps: StepRecord[];
  reviews: Review[];
  logs: string[]; // artifact ids of per-step log windows
  report?: string;
}

async function ensureTable() {
  const db = await database();
  db.exec("CREATE TABLE IF NOT EXISTS ui_tests (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)");
  return db;
}
async function load(id: string): Promise<TestSession> {
  const row = (await ensureTable()).prepare("SELECT data FROM ui_tests WHERE id=?").get(id) as { data: string } | undefined;
  invariant(row, "NOT_FOUND", `UI test ${id} not found`);
  return JSON.parse(row.data) as TestSession;
}
async function save(s: TestSession) {
  (await ensureTable()).prepare("INSERT OR REPLACE INTO ui_tests(id,data,updated) VALUES(?,?,?)").run(s.id, JSON.stringify(s), Date.now());
}

/** Split a natural-language plan into a checklist (numbered/bulleted lines, else sentences). */
export function checklist(plan: string): string[] {
  const lines = plan.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = lines.filter((l) => /^(\d+[.)、]|[-*•])\s*/.test(l)).map((l) => l.replace(/^(\d+[.)、]|[-*•])\s*/, ""));
  if (items.length) return items.slice(0, 50);
  return plan.split(/(?<=[。.;；!?！？])\s*/).map((s) => s.trim()).filter((s) => s.length > 1).slice(0, 50);
}

async function shot(target: string, signal?: AbortSignal) {
  return (await screenshot(target, { width: 720 }, signal)).artifact_id;
}

/** App log for [since, now]: hilog lines of the app process within the step window. */
async function logWindow(target: string, bundle: string | undefined, since: number, signal?: AbortSignal) {
  const pid = bundle ? await pidOf(target, bundle, signal) : undefined;
  const filter = pid ? `-P ${pid}` : "";
  const out = (await shell(target, [`hilog -x ${filter} | grep -v 'C02C02/PARAM' | tail -n 400`], signal, 20000)).stdout;
  const clock = (await shell(target, ["date", "+%s"], signal, 5000)).stdout.trim();
  const deviceNow = Number(clock) * 1000 || Date.now();
  const skew = deviceNow - Date.now();
  const year = new Date(deviceNow).getFullYear();
  const lines = out.split(/\r?\n/).filter((l) => {
    const m = /^(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(l);
    if (!m) return false;
    const t = new Date(year, +m[1]! - 1, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!).getTime() - skew;
    return t >= since - 500;
  });
  return lines.join("\n");
}

export async function startTest(target: string, input: { plan: string; bundle?: string; ability?: string; module?: string; fresh_start?: boolean }, signal: AbortSignal) {
  if (input.fresh_start && input.bundle) {
    invariant(input.ability, "INVALID_INPUT", "fresh_start needs the app ability (pass project or ability)");
    await forceStop(target, input.bundle, signal).catch(() => {});
    await launch(target, input.bundle, input.ability, input.module, signal);
    await waitFor(target, { bundle: input.bundle }, "visible", 10000, signal);
  }
  const s: TestSession = {
    id: `t_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
    target, bundle: input.bundle, plan: input.plan, checklist: checklist(input.plan),
    status: "running", started: Date.now(), steps: [], reviews: [], logs: [],
  };
  const baseline = await shot(target, signal);
  const nodes = await dumpTree(target, signal);
  s.steps.push({ n: 0, kind: "observe", description: "baseline", after: baseline, elements: compact(nodes, { interactive: true, limit: 120, bundle: input.bundle }), at: Date.now() });
  await save(s);
  return {
    test_id: s.id, checklist: s.checklist, baseline_screenshot: baseline, elements: s.steps[0]!.elements,
    next: "Execute each checklist item with ui action=test_step (op/selector or assert), use action=review for visual checks, then action=test_finish",
  };
}

export async function testStep(testId: string, step: { description?: string; action?: Action; selector?: Selector; assert?: { visible?: Selector; hidden?: Selector; timeout_ms?: number } }, signal: AbortSignal) {
  const s = await load(testId);
  invariant(s.status === "running", "CONFLICT", `Test ${testId} is ${s.status}`);
  invariant(step.action || step.assert, "INVALID_INPUT", "Pass op (+selector/coordinates) or assert");
  const started = Date.now();
  const record: StepRecord = { n: s.steps.length, kind: step.action ? "act" : "assert", description: step.description, action: step.action, selector: step.selector, at: started };
  try {
    if (step.action) {
      record.before = await shot(s.target, signal);
      await act(s.target, step.action, signal);
      await new Promise((r) => setTimeout(r, 600));
      record.passed = true;
    }
    if (step.assert) {
      const selector = (step.assert.visible ?? step.assert.hidden)!;
      const verdict = await waitFor(s.target, selector, step.assert.visible ? "visible" : "hidden", step.assert.timeout_ms ?? 5000, signal);
      record.passed = verdict.passed;
      record.detail = verdict;
    }
  } catch (error) {
    record.passed = false;
    record.detail = { error: (error as Error).message };
  }
  record.after = await shot(s.target, signal).catch(() => undefined);
  const nodes = await dumpTree(s.target, signal).catch(() => []);
  record.elements = compact(nodes, { interactive: true, limit: 80, bundle: s.bundle });
  const log = await logWindow(s.target, s.bundle, started, signal).catch(() => "");
  if (log) {
    const artifact = await saveArtifact(log);
    record.log = artifact.artifact_id;
    s.logs.push(artifact.artifact_id);
  }
  s.steps.push(record);
  await save(s);
  const errors = log.split("\n").filter((l) => /\s[EF]\s/.test(l)).slice(-5);
  return {
    step: record.n, passed: record.passed, detail: record.detail, after_screenshot: record.after, elements: record.elements,
    ...(errors.length ? { app_errors: errors } : {}),
  };
}

/** Start a visual review: returns the screenshot for the host to judge; submit with outcome. */
export async function review(testId: string, input: { requirement?: string; outcome?: "passed" | "failed" | "insufficient"; reason?: string; review_id?: number }, signal: AbortSignal) {
  const s = await load(testId);
  if (input.outcome !== undefined) {
    const index = input.review_id ?? s.reviews.findIndex((r) => r.outcome === undefined);
    const pending = s.reviews[index];
    invariant(pending && pending.outcome === undefined, "NOT_FOUND", "No pending review to complete");
    pending.outcome = input.outcome;
    pending.reason = input.reason?.slice(0, 2000);
    s.steps.push({ n: s.steps.length, kind: "review", description: pending.requirement, passed: input.outcome === "passed", detail: { outcome: input.outcome, reason: pending.reason }, after: pending.screenshot, at: Date.now() });
    await save(s);
    return { review_id: index, recorded: input.outcome };
  }
  invariant(input.requirement, "INVALID_INPUT", "requirement is required to start a review (what the screen must look like)");
  const shotResult = await screenshot(s.target, { width: 1080 }, signal);
  s.reviews.push({ step: s.steps.length, screenshot: shotResult.artifact_id, requirement: input.requirement });
  await save(s);
  return {
    review_id: s.reviews.length - 1, requirement: input.requirement,
    instruction: "Judge the attached screenshot against the requirement, then call ui action=review with outcome=passed|failed|insufficient and reason",
    _image: { data: shotResult.data, mime: shotResult.mime },
  };
}

export async function finishTest(testId: string) {
  const s = await load(testId);
  const failedControl = s.steps.filter((st) => (st.kind === "act" || st.kind === "assert") && st.passed === false);
  const failedReview = s.reviews.filter((r) => r.outcome === "failed");
  const unresolved = s.reviews.filter((r) => r.outcome === undefined || r.outcome === "insufficient");
  const assertions = s.steps.filter((st) => st.kind === "assert").length;
  s.status = failedControl.length || failedReview.length ? "failed" : unresolved.length || (assertions === 0 && s.reviews.length === 0) ? "inconclusive" : "passed";
  s.finished = Date.now();
  const md = [
    `# UI test ${s.id}: ${s.status.toUpperCase()}`, "", `Device: ${s.target}${s.bundle ? `  App: ${s.bundle}` : ""}`, `Duration: ${Math.round((s.finished - s.started) / 1000)}s`, "",
    "## Plan", s.plan, "", "## Steps",
    ...s.steps.map((st) => `- #${st.n} [${st.kind}] ${st.passed === undefined ? "" : st.passed ? "PASS" : "FAIL"} ${st.description ?? ""} ${st.action ? JSON.stringify(st.action) : ""} ${st.detail ? JSON.stringify(st.detail).slice(0, 300) : ""}`.trim()),
    "", "## Visual reviews",
    ...s.reviews.map((r, i) => `- R${i} ${r.outcome ?? "PENDING"}: ${r.requirement}${r.reason ? ` — ${r.reason}` : ""}`),
  ].join("\n");
  const artifact = await saveArtifact(md, "text/markdown");
  s.report = artifact.artifact_id;
  await save(s);
  return {
    test_id: s.id, status: s.status, steps: s.steps.length, failed_steps: failedControl.map((st) => st.n), failed_reviews: failedReview.length,
    unresolved_reviews: unresolved.length, report_artifact: artifact.artifact_id,
    ...(s.status === "inconclusive" ? { hint: assertions === 0 && !s.reviews.length ? "No assertion or review was recorded: a test needs evidence" : "Complete pending/insufficient reviews" } : {}),
  };
}

export async function testLog(testId: string, options: { grep?: string; max_chars?: number }) {
  const s = await load(testId);
  const { readArtifact } = await import("../core/artifacts.js");
  const parts: string[] = [];
  for (const id of s.logs) {
    const page = await readArtifact(id, { grep: options.grep, limit: 2000 }).catch(() => undefined);
    if (page && "content" in page) parts.push(String(page.content));
  }
  const text = parts.join("\n");
  const max = options.max_chars === -1 ? Infinity : options.max_chars ?? 5000;
  return { test_id: s.id, chars: text.length, truncated: text.length > max, log: text.length > max ? text.slice(-max) : text };
}

/** Export step screenshots + report into a directory (absolute path). */
export async function exportTest(testId: string, directory: string) {
  invariant(path.isAbsolute(directory), "INVALID_INPUT", "directory must be an absolute path");
  const s = await load(testId);
  const db = await database();
  fs.mkdirSync(directory, { recursive: true });
  const files: string[] = [];
  const copy = (id: string | undefined, name: string) => {
    if (!id) return;
    const row = db.prepare("SELECT file FROM artifacts WHERE id=?").get(id) as { file: string } | undefined;
    if (!row || !fs.existsSync(row.file)) return;
    const out = path.join(directory, `${name}${path.extname(row.file)}`);
    fs.copyFileSync(row.file, out);
    files.push(out);
  };
  for (const st of s.steps) { copy(st.before, `step${String(st.n).padStart(2, "0")}-before`); copy(st.after, `step${String(st.n).padStart(2, "0")}-after`); }
  s.reviews.forEach((r, i) => copy(r.screenshot, `review${i}`));
  if (!s.report) throw new ToolError("CONFLICT", "Finish the test first (ui action=test_finish)");
  copy(s.report, "report");
  fs.writeFileSync(path.join(directory, "test.json"), JSON.stringify(s, null, 2));
  files.push(path.join(directory, "test.json"));
  // Track the files we wrote (not the directory, which may hold the user's own files).
  const { trackExport } = await import("../core/artifacts.js");
  for (const f of files) await trackExport(f);
  return { exported: files.length, directory, files: files.map((f) => path.basename(f)) };
}