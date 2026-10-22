import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { artifactPath, commitArtifact, saveArtifact } from "../core/artifacts.js";
import { errorResult, invariant, ToolError } from "../core/errors.js";
import { run } from "../core/proc.js";
import { sha256 } from "../core/files.js";
import { sdkInfo } from "../core/toolchain.js";
import { buildInfo } from "../core/config.js";
import { aggregate, exportEvidence, sourceIdentity, type CheckResult, type Verdict } from "./evidence.js";
import { qualityBaseline, diagnosticKeys, type Measurement } from "./quality.js";
import { inspectProject } from "./project.js";

const commandSchema = z.object({ file: z.string().min(1), args: z.array(z.string()).default([]), cwd: z.string().default("."), timeout_ms: z.number().int().min(100).max(600000).default(30000) }).strict();
export const planSchema = z.object({
  schema: z.literal(1),
  prepare: commandSchema.optional(), cleanup: commandSchema.optional(),
  checks: z.array(z.object({
    id: z.string().regex(/^[\w.-]{1,80}$/),
    type: z.enum(["build", "deploy", "test", "flow", "assert", "visual", "perf", "layout", "crash", "diagnostics", "launch", "command", "entries", "form"]),
    required: z.boolean().default(true), options: z.record(z.string(), z.unknown()).default({}),
    affects: z.array(z.string().min(1)).default([]),
    baseline: z.string().regex(/^[\w.-]{1,80}$/).optional(),
    tolerance_percent: z.number().min(0).max(100).default(0),
    max: z.record(z.string(), z.number().finite()).default({}),
    repeats: z.number().int().min(1).max(10).default(1),
    command: commandSchema.optional(),
  }).strict()).min(1).max(100),
}).strict().superRefine((p, ctx) => {
  if (!p.checks.some((c) => c.required)) ctx.addIssue({ code: "custom", message: "At least one required acceptance check is needed" });
  const ids = p.checks.map((c) => c.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Check ids must be unique" });
  if (ids.some((id) => ["prepare", "cleanup", "change-coverage", "source-integrity"].includes(id))) ctx.addIssue({ code: "custom", message: "Check ids cannot use reserved report identities" });
  for (const c of p.checks) if ((c.type === "command") !== !!c.command) ctx.addIssue({ code: "custom", message: `Only command checks require command: ${c.id}` });
  if (p.prepare && !p.cleanup) ctx.addIssue({ code: "custom", message: "prepare requires a cleanup command, also run after prepare fails" });
});
type Plan = z.infer<typeof planSchema>;
type Check = Plan["checks"][number];
export interface VerifyInput { project: string; product?: string; plan: string; output: string; target?: string; changed_only?: boolean; base?: string; baseline_mode?: "compare" | "record"; allow_commands?: boolean }
const destinations: Record<string, [string, string]> = { build: ["project", "build"], deploy: ["run", "deploy"], test: ["project", "test"], flow: ["ui_flow", "replay"], assert: ["ui", "assert"], visual: ["ui", "visual"], perf: ["ui", "perf"], layout: ["ui", "layout"], crash: ["diagnose", "crash"], diagnostics: ["code", "check"], launch: ["run", "launch"], entries: ["project", "entries"], form: ["ui", "form"] };
const deviceTypes = new Set(["deploy", "flow", "assert", "visual", "perf", "layout", "crash", "launch", "form"]);
export function readPlan(input: VerifyInput) {
  const file = path.resolve(input.project, input.plan);
  const raw = fs.readFileSync(file, "utf8");
  return { plan: planSchema.parse(JSON.parse(raw)), file, sha256: sha256(raw) };
}
export function planNeedsDevice(plan: Plan) { return plan.checks.some((c) => deviceTypes.has(c.type) || (c.type === "test" && c.options.kind === "instrument")); }
export function selectChanged(checks: Check[], files: string[]) {
  const matches = (c: Check, file: string) => c.affects.some((prefix) => prefix === "*" || file === prefix || file.startsWith(prefix.replace(/\/$/, "") + "/"));
  return { selected: checks.filter((c) => files.some((f) => matches(c, f))), uncovered: files.filter((f) => !checks.some((c) => c.required && matches(c, f))) };
}
async function changedFiles(input: VerifyInput, signal: AbortSignal) {
  invariant(input.base && !input.base.startsWith("-"), "INVALID_INPUT", "changed_only requires an explicit Git base ref");
  const diff = await run({ file: "git", args: ["diff", "--name-only", "--relative", "--no-renames", "-z", input.base, "--", "."], cwd: input.project }, { signal });
  const untracked = await run({ file: "git", args: ["ls-files", "--others", "--exclude-standard", "-z"], cwd: input.project }, { signal });
  invariant(!diff.truncated && !untracked.truncated, "EVIDENCE_MISSING", "Changed-file listing was truncated");
  return [...new Set((diff.stdout + untracked.stdout).split("\0").filter(Boolean))].sort();
}
function callInput(check: Check, input: VerifyInput, bundle: string | undefined) {
  const [tool, action] = destinations[check.type]!;
  invariant(!["project", "target", "product", "action", "request_key", "wait"].some((k) => k in check.options), "INVALID_INPUT", "Plan options cannot override execution identity", { check: check.id });
  const args: Record<string, unknown> = { ...check.options, action };
  if (["project", "run", "code", "ui_flow", "diagnose"].includes(tool) || ["visual", "layout", "form"].includes(check.type)) args.project = input.project;
  if ((["project", "run"].includes(tool) || check.type === "form") && input.product) args.product = input.product;
  if (deviceTypes.has(check.type) || (check.type === "test" && check.options.kind === "instrument")) args.target = input.target;
  if (["perf", "layout", "crash"].includes(check.type)) args.bundle ??= bundle;
  if (check.type === "visual") { args.require_baseline = input.baseline_mode !== "record"; args.update = input.baseline_mode === "record"; }
  if (check.type === "diagnostics") invariant(!args.fix, "INVALID_INPUT", "Verification diagnostics cannot fix sources");
  if (check.type === "crash") args.strict = true;
  if (check.type === "crash") invariant(args.since_minutes && !args.log && !args.name, "INVALID_INPUT", "Crash checks need a since_minutes window, not pasted logs or a selected report");
  if (check.type === "layout") { args.strict_targets ??= true; args.min_target_vp ??= 48; }
  if (check.type === "layout") invariant(!args.forms, "INVALID_INPUT", "Use separate plans for emulator form-factor jobs; verify owns one explicitly resolved target");
  if (check.type === "form") {
    invariant((!args.form_action || args.form_action === "exercise") && !args.form_cases, "INVALID_INPUT", "Form checks exercise one preview on the plan's selected device");
    args.form_action = "exercise";
  }
  return { tool, args };
}
async function dispatch(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<any> {
  const { invokeTool } = await import("../server.js");
  let result: any = await invokeTool(tool, args, signal);
  if (!result?.job_id) return result;
  const { waitJob, cancelJob } = await import("../core/jobs.js");
  let cancelled: ReturnType<typeof cancelJob> | undefined;
  const cancel = () => { cancelled = cancelJob(result.job_id); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (["running", "queued"].includes(result.status)) { signal.throwIfAborted(); result = await waitJob(result.job_id, 1000); }
    invariant(result.status === "succeeded", result.error?.code ?? "CHECK_FAILED", "Verification sub-job did not complete", { job: result });
    let value = result.result;
    if (value?.result_artifact) {
      const { database } = await import("../core/db.js");
      const row = (await database()).prepare("SELECT file FROM artifacts WHERE id=?").get(value.result_artifact) as { file: string } | undefined;
      invariant(row, "EVIDENCE_MISSING", "Sub-job result artifact missing");
      value = JSON.parse(fs.readFileSync(row.file, "utf8"));
    }
    return { ...value, job_id: result.job_id };
  } finally { signal.removeEventListener("abort", cancel); if (signal.aborted) await (cancelled ?? cancelJob(result.job_id)); }
}
async function command(cmd: z.infer<typeof commandSchema>, root: string, signal: AbortSignal) {
  const cwd = fs.realpathSync(path.resolve(root, cmd.cwd)), relative = path.relative(fs.realpathSync(root), cwd);
  invariant(relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)), "INVALID_INPUT", "Command cwd must remain within the project");
  const log = artifactPath();
  try {
    const result = await run({ file: cmd.file, args: cmd.args, cwd }, { signal, timeoutMs: cmd.timeout_ms, allowFailure: true, logFile: log.file });
    const receipt = { exit_code: result.code, log_artifact: (await commitArtifact(log.id, log.file, "text/plain")).artifact_id, command_sha256: sha256(JSON.stringify(cmd)) };
    if (result.code !== 0) return { ...receipt, verdict: "failed" as const };
    invariant(!result.truncated, "EVIDENCE_MISSING", "Command output was truncated", receipt);
    const output = JSON.parse(result.stdout);
    invariant(["passed", "failed", "blocked", "inconclusive"].includes(output.verdict), "EVIDENCE_MISSING", "Command must output a JSON object with verdict; exit zero is not sufficient", receipt);
    return { ...output, ...receipt };
  } catch (error) {
    const artifact = fs.existsSync(log.file) ? await commitArtifact(log.id, log.file, "text/plain") : undefined;
    throw new ToolError("COMMAND_FAILED", "Project command did not produce usable evidence", { error: errorResult(error), log_artifact: artifact?.artifact_id });
  }
}
export function judge(type: string, result: any): Verdict {
  if (type === "test" || type === "command") return result.verdict;
  if (type === "build") return result.success === true ? "passed" : "failed";
  if (type === "deploy") return result.flow?.passed === false || result.crashed || result.launch?.crashed || result.launch?.started === false || result.launch?.smoke === "FAIL_BLANK" ? "failed" : "passed";
  if (type === "launch") return result.started === true && result.smoke === "PASS" ? "passed" : "failed";
  if (type === "entries") return result.issues?.length ? "failed" : result.entries?.length ? "passed" : "inconclusive";
  if (type === "form") return result.attachment_verified !== true || result.cleanup?.removed !== true || result.cleanup?.preexisting_preserved !== true || result.project_assertions?.passed === false ? "failed"
    : result.project_assertions?.passed === true ? "passed" : "inconclusive";
  if (type === "diagnostics") return result.errors ? "failed" : "passed";
  if (type === "visual") return ["created", "updated"].includes(result.baseline) ? "recorded" : result.same === true && !result.global_shift ? "passed" : "failed";
  if (type === "perf") return result.source !== "composer" || result.verdict === "inconclusive" || result.sampling?.status !== "overlapping" || result.excluded_intervals?.length || result.activity_verified !== true ? "inconclusive" : "passed";
  if (type === "crash") return result.reports?.length ? "failed" : "passed";
  if (type === "layout" && result.density_source === "assumed") return "inconclusive";
  return result.passed === true ? "passed" : "failed";
}
function measurements(type: string, result: any, elapsed: number): Measurement {
  const lower = (value: number) => ({ value, direction: "lower" as const });
  if (type === "build") return { metrics: { build_ms: lower(result.elapsed_ms), warnings: lower(result.warnings ?? 0), package_bytes: lower((result.artifacts ?? []).reduce((n: number, a: any) => n + a.bytes, 0)) } };
  if (type === "launch") return { metrics: { launch_check_ms: lower(elapsed) } };
  if (type === "perf" && result.frame_ms) return { metrics: { p95_ms: lower(result.frame_ms.p95), jank_rate: lower(result.jank_rate), fps: { value: result.avg_fps, direction: "higher" } } };
  if (type === "diagnostics") return { metrics: { warnings: lower(result.warnings), errors: lower(result.errors) }, diagnostics: diagnosticKeys(result.issues ?? []) };
  if (type === "command" && result.metrics) return { metrics: Object.fromEntries(Object.entries(result.metrics).map(([k, v]) => { invariant(typeof v === "number" && Number.isFinite(v), "EVIDENCE_MISSING", "Command metrics must be finite numbers"); return [k, lower(v)]; })) };
  return { metrics: {} };
}

/** A finite composition of existing capabilities. Every required check keeps its independent verdict. */
export async function runVerification(input: VerifyInput, signal: AbortSignal, jobId?: string) {
  const project = inspectProject(input.project, input.product), loaded = readPlan(input), { plan } = loaded;
  const { validateTool } = await import("../server.js");
  invariant(path.isAbsolute(input.output) && !fs.existsSync(input.output), "INVALID_INPUT", "output must be a new absolute evidence directory");
  invariant(input.allow_commands || (!plan.prepare && !plan.cleanup && !plan.checks.some((c) => c.command)), "INVALID_INPUT", "Project commands require allow_commands=true; review the plan first");
  for (const c of plan.checks) if (c.type !== "command") { const call = callInput(c, input, project.bundleName); validateTool(call.tool, call.args); }
  const identity = await sourceIdentity(project.root), sdk = sdkInfo();
  const outputRelative = path.relative(project.root, input.output);
  invariant(outputRelative.startsWith("..") || path.isAbsolute(outputRelative) || outputRelative.startsWith(`.arkpilot${path.sep}`), "INVALID_INPUT", "Evidence must be outside source files or under .arkpilot");
  const device = input.target ? await (await import("./device.js")).deviceInfo(input.target, signal) : undefined;
  const results: CheckResult[] = [];
  let checks = plan.checks, changed: string[] | undefined;
  if (input.changed_only) {
    changed = await changedFiles(input, signal);
    const selection = selectChanged(checks, changed); checks = selection.selected;
    if (selection.uncovered.length || !checks.length) results.push({ id: "change-coverage", type: "selection", required: true, verdict: "blocked", elapsed_ms: 0, detail: { uncovered: selection.uncovered, changed, reason: checks.length ? "Changed paths need explicit required-check mappings" : "No checks selected; this is not a full acceptance pass" } });
  }
  const appendCommand = async (id: string, cmd: z.infer<typeof commandSchema>, sig: AbortSignal) => {
    const start = Date.now();
    try { const detail = await command(cmd, project.root, sig); results.push({ id, type: "command", required: true, verdict: detail.verdict, elapsed_ms: Date.now() - start, detail }); }
    catch (e) { results.push({ id, type: "command", required: true, verdict: "failed", elapsed_ms: Date.now() - start, detail: errorResult(e) }); }
  };
  let attempted = false;
  try {
    attempted = !results.length;
    if (!results.length && plan.prepare) await appendCommand("prepare", plan.prepare, signal);
    if (results.some((r) => r.verdict !== "passed")) checks = [];
    for (const c of checks) {
      const started = Date.now();
      if (signal.aborted) { results.push({ id: c.id, type: c.type, required: c.required, verdict: "not_run", elapsed_ms: 0, detail: "Cancelled" }); continue; }
      try {
        const samples: any[] = [], metrics: Measurement[] = [], verdicts: Verdict[] = [];
        for (let i = 0; i < c.repeats; i++) {
          const at = Date.now();
          if (c.type === "launch") await dispatch("run", { action: "stop", project: input.project, target: input.target }, signal);
          let result;
          if (c.command) result = await command(c.command, project.root, signal);
          else {
            const call = callInput(c, input, project.bundleName);
            result = await dispatch(call.tool, call.args, signal);
          }
          // Static check summaries truncate issues; baselines must consume the full report.
          if (c.type === "diagnostics" && result.report_artifact) {
            const { database } = await import("../core/db.js");
            const row = (await database()).prepare("SELECT file FROM artifacts WHERE id=?").get(result.report_artifact) as { file: string } | undefined;
            invariant(row, "EVIDENCE_MISSING", "Full diagnostic report missing");
            const full = JSON.parse(fs.readFileSync(row.file, "utf8")); result.issues = full.issues ?? full;
          }
          samples.push(result); verdicts.push(judge(c.type, result)); metrics.push(measurements(c.type, result, Date.now() - at));
        }
        const measured = metrics[0]!;
        for (const key of Object.keys(measured.metrics)) measured.metrics[key]!.value = metrics.map((m) => m.metrics[key]!.value).sort((a, b) => a - b)[Math.floor(metrics.length / 2)]!;
        const missing = Object.keys(c.max).filter((k) => !measured.metrics[k]);
        const exceeded = Object.entries(c.max).filter(([k, max]) => measured.metrics[k] && measured.metrics[k]!.value > max);
        if (missing.length) verdicts.push("inconclusive");
        if (exceeded.length) verdicts.push("failed");
        if (["perf", "launch"].includes(c.type) && !c.baseline && !Object.keys(c.max).length) verdicts.push("inconclusive");
        let baseline;
        if (c.baseline && !verdicts.some((v) => v === "failed" || v === "inconclusive")) {
          baseline = qualityBaseline(project.root, c.baseline, { sdk, device, type: c.type, options: c.options, command_sha256: c.command ? sha256(JSON.stringify(c.command)) : undefined, repeats: c.repeats, product: project.product, measurement: "median-v1" }, measured, input.baseline_mode ?? "compare", c.tolerance_percent);
          verdicts.push(baseline.verdict);
        }
        results.push({ id: c.id, type: c.type, required: c.required, verdict: aggregate(verdicts.map((verdict) => ({ required: true, verdict }))), elapsed_ms: Date.now() - started, detail: { samples, measurement: measured, baseline, exceeded, missing_metrics: missing } });
      } catch (e) {
        const error = errorResult(e), blocked = ["environment", "input"].includes(error.category) || /BASELINE_|RESOURCE_BUSY|EVIDENCE_|TEST_REPORT_/.test(error.code);
        results.push({ id: c.id, type: c.type, required: c.required, verdict: blocked ? "blocked" : "failed", elapsed_ms: Date.now() - started, detail: error });
      }
    }
  } finally {
    // Independent bounded signal: cancellation must not cancel cleanup as well.
    if (attempted && plan.cleanup) await appendCommand("cleanup", plan.cleanup, AbortSignal.timeout(plan.cleanup.timeout_ms + 5000));
  }
  for (const c of plan.checks) if (!results.some((r) => r.id === c.id)) results.push({ id: c.id, type: c.type, required: !input.changed_only && c.required, verdict: "not_run", elapsed_ms: 0, detail: "Not selected or preparation blocked" });
  const after = await sourceIdentity(project.root);
  results.push({ id: "source-integrity", type: "integrity", required: true, verdict: identity.sha256 === after.sha256 ? "passed" : "failed", elapsed_ms: 0, detail: { before: identity.sha256, after: after.sha256, changed_files: [...new Set([...identity.files.map((f) => f.file), ...after.files.map((f) => f.file)])].filter((file) => identity.files.find((f) => f.file === file)?.sha256 !== after.files.find((f) => f.file === file)?.sha256) } });
  const report = { schema: 1, verdict: aggregate(results), scope: input.changed_only ? "changed-only" : "full-plan", changed, base: input.base, project: project.root, bundle: project.bundleName, sdk, device, build: buildInfo, plan: { file: loaded.file, sha256: loaded.sha256, definition: plan }, source: identity, audit: await (await import("../core/operations.js")).currentAudit(), results, created_at: new Date().toISOString() };
  const exported = await exportEvidence(input.output, report);
  return { verdict: report.verdict, scope: report.scope, checks: results.map(({ detail: _d, ...r }) => r), evidence: exported, report_artifact: (await saveArtifact(JSON.stringify(report), "application/json", jobId)).artifact_id };
}
