import path from "node:path";
import { defineJob, type Step } from "./core/jobs.js";
import { invariant } from "./core/errors.js";
import type { BuildTask } from "./domains/project.js";

/** Project model honouring `modules: ["name@target"]`, and the plain module names. */
async function projectOf(input: { project: string; product?: string; modules?: string[] }) {
  const { projectFor } = await import("./domains/project.js");
  return projectFor(input);
}

/* All long-running workflows. Effect steps (install) are journaled; others are safe to re-run. */

interface BuildInput { project: string; product?: string; modules?: string[]; task?: BuildTask; mode?: string; clean?: boolean; preflight?: boolean }

defineJob<{ project: string; product?: string }>({
  kind: "sync",
  steps: [{
    id: "sync",
    async run(ctx) {
      const { inspectProject, syncProject } = await import("./domains/project.js");
      return syncProject(inspectProject(ctx.input.project, ctx.input.product), ctx.signal, true, ctx.job_id);
    },
  }],
  summarize: (o) => o.sync,
});

const preflightStep = {
  id: "preflight",
  when: (ctx: { input: BuildInput }) => ctx.input.preflight !== false,
  async run(ctx: { input: BuildInput; signal: AbortSignal; log(m: string): void }) {
    const { arktsCheck } = await import("./domains/code.js");
    const { changedSources, rememberSources } = await import("./domains/preflight.js");
    // Advisory only: the static checker is a fast approximation and can be wrong on real projects
    // (unknown HDS containers, unusual formatting). hvigor is the compiler of record, so findings are
    // reported alongside the build instead of blocking it.
    try {
      // Only the .ets/.ts files edited since the last preflight (LingDong: 0.4 s vs 4-22 s for all 1,659).
      const scope = await changedSources(ctx.input.project);
      if (scope.files && !scope.files.length) return { errors: 0, warnings: 0, scope: "unchanged", files: 0 };
      const result = await arktsCheck(ctx.input.project, scope.files, ctx.signal);
      // Issues are capped at 50: when errors were cut off, some failing files are unknown, so keep the old baseline.
      const failing = result.issues.filter((i) => i.severity === "error").map((i) => i.file);
      if (failing.length >= result.errors) await rememberSources(ctx.input.project, scope.snapshot, failing);
      if (result.errors) ctx.log(`preflight: ${result.errors} possible error(s); building anyway (hvigor decides)`);
      return {
        errors: result.errors, warnings: result.warnings, scope: scope.files ? "changed" : "project", files: scope.files?.length ?? result.files,
        ...(result.errors ? { issues: result.issues.slice(0, 10) } : {}),
      };
    } catch (error) {
      ctx.log(`preflight unavailable: ${(error as Error).message}`);
      return { skipped: true };
    }
  },
};

const buildStep = {
  id: "build",
  async run(ctx: { input: BuildInput; signal: AbortSignal; job_id: string }) {
    const { buildProject } = await import("./domains/project.js");
    const { buildFailureHints } = await import("./domains/diagnose.js");
    try {
      const { project, modules } = await projectOf(ctx.input);
      return await buildProject(project, { ...ctx.input, modules }, ctx.signal, ctx.job_id);
    } catch (error) {
      const details = (error as { details?: { diagnostics?: { code?: string; message: string }[] } }).details;
      if (details?.diagnostics) Object.assign(details, { hints: buildFailureHints(details.diagnostics) });
      throw error;
    }
  },
};

/**
 * The compiler has the last word. A successful build proves the preflight errors were false
 * positives: report that explicitly (and drop the error list) so no agent goes "fixing" code
 * that compiles. When the build fails, the job fails with hvigor's own diagnostics instead.
 */
function settlePreflight(preflight: any, buildSucceeded: boolean) {
  if (!preflight?.errors || !buildSucceeded) return preflight;
  return { errors: 0, warnings: preflight.warnings, overruled: preflight.errors,
    note: `The static preflight flagged ${preflight.errors} error(s), but the compiler accepted the code: they were false positives. Do not change code for them.` };
}

defineJob<BuildInput>({
  kind: "build",
  steps: [preflightStep, buildStep],
  summarize: (o) => ({ ...o.build, preflight: settlePreflight(o.preflight, true) }),
});

interface RunInput extends BuildInput {
  target?: string; module?: string; ability?: string; hot_reload?: boolean; skip_build?: boolean; uninstall_first?: boolean;
  assert?: { visible?: Record<string, unknown>; hidden?: Record<string, unknown>; timeout_ms?: number };
  /** ui_flow id replayed right after launch (lands on the page being worked on) */
  then_flow?: string; flow_variables?: Record<string, string>;
  /** auto (default): quick-fix the running app when provably equivalent; full: always build + install */
  run_mode?: "auto" | "full";
}

/* ---------------------------- auto hot reload ---------------------------- */

/** Iterating = a previous full deploy of this project to this device within this window. */
const ITERATING_MS = 2 * 3600 * 1000;
/** Test hosts and CI can disable the automatic quick-fix path entirely (DEVECO_AUTO_HOT=0). */
const autoHotEnabled = () => process.env.DEVECO_AUTO_HOT !== "0";
// Release/other build modes are never quick-fixed: only debug builds were baselined.
const autoMode = (input: RunInput) => autoHotEnabled() && input.run_mode !== "full" && !input.hot_reload && !input.uninstall_first && !input.skip_build && (!input.mode || input.mode === "debug");
const wentHot = (ctx: { outputs: Record<string, any> }) => ctx.outputs.hot?.path === "hot_reload";
const relaunchOnly = (ctx: { outputs: Record<string, any> }) => ctx.outputs.hot?.path === "relaunch";
/** Wrap a deploy step so it is skipped when the quick fix already updated the app (or nothing changed). */
function unlessHot(step: Step<RunInput>): Step<RunInput> {
  // An unchanged project still relaunches (the caller asked to run it), but neither builds nor installs.
  const skip = (ctx: { outputs: Record<string, any> }) => wentHot(ctx) || (relaunchOnly(ctx) && step.id !== "launch");
  return { ...step, when: (ctx) => !skip(ctx) && (step.when ? step.when(ctx) : true) };
}

async function hotContext(ctx: { input: RunInput; outputs: Record<string, any>; signal: AbortSignal }) {
  const { projectFor } = await import("./domains/project.js");
  const { stateDir } = await import("./core/config.js");
  const hp = await import("./domains/hotpath.js");
  const { project } = await projectFor(ctx.input);
  const target = ctx.outputs.target.target as string;
  const entryName = (ctx.outputs.select.modules as string[]).find((n) => project.modules.find((m) => m.name === n)?.type === "entry");
  const module = project.modules.find((m) => m.name === (ctx.input.module ?? entryName));
  const file = hp.stateFile(stateDir(), project.root, target);
  return { hp, project, target, module, file };
}

const hotStep = {
  id: "hot",
  when: (ctx: { input: RunInput }) => autoMode(ctx.input),
  async run(ctx: { input: RunInput; outputs: Record<string, any>; signal: AbortSignal; log(m: string): void }) {
    const { hp, project, target, module, file } = await hotContext(ctx);
    const state = hp.readState(file);
    if (!module || !project.bundleName) return { path: "full", fallback_reason: "no entry module to quick-fix" };
    const { installStamp, pidOf } = await import("./domains/device.js");
    const [install, pid] = await Promise.all([installStamp(target, project.bundleName, ctx.signal), pidOf(target, project.bundleName, ctx.signal)]);
    const sources = hp.currentSources(project.root, state?.sources);
    const decision = hp.decideHot(state, { target, install, running: !!pid, sources, inputs: hp.inputsSnapshot(project.root, state?.inputs && typeof state.inputs === "object" ? state.inputs : undefined), moduleRel: path.relative(project.root, module.root).replaceAll("\\", "/") });
    if (!decision.hot && decision.unchanged) {
      // Same code, same installed copy: skip build + install; the launch step restarts it (fresh state).
      return { path: "relaunch", note: "No changes since the last deploy: relaunched the installed app" };
    }
    if (!decision.hot) return { path: "full", fallback_reason: decision.reason };
    const started = Date.now();
    try {
      const { applyHotReload } = await import("./domains/hotreload.js");
      const { mainAbility } = await import("./domains/project.js");
      // restart: build_run means "a freshly launched app with the new code" — a page whose build() already
      // ran would otherwise keep showing the old UI (seen in the e2e gesture page test).
      const ability = ctx.input.ability ?? mainAbility(project, module.name).ability;
      const applied = await applyHotReload(project, module.name, ctx.signal, ctx.log, { files: decision.files.map((f) => path.join(project.root, f)), restart: true, ability });
      hp.writeState(file, { ...state!, sources });
      if (applied.launch && !applied.launch.started) {
        // The patched code crashes on startup: same diagnosis as a normal deploy.
        const { crashSummary } = await import("./domains/diagnose.js");
        const crash = applied.launch.crashed ? await crashSummary(target, project.bundleName, applied.launch.new_crash_logs, ctx.input.project, ctx.signal) : undefined;
        invariant(false, "LAUNCH_FAILED", applied.launch.crashed ? "App crashed on startup after the quick fix" : "App process is not running after the quick fix",
          { path: "hot_reload", files: applied.files, ...applied.launch, ...(crash ? { crash } : {}) },
          crash?.source?.length ? `Fix ${crash.source[0]!.file}:${crash.source[0]!.line} (see crash.source), then build_run again` : "Run diagnose action=crash to see the crash report");
      }
      return { path: "hot_reload", files: applied.files, elapsed_ms: Date.now() - started, ...(applied.launch ? { launch: applied.launch } : {}) };
    } catch (error) {
      // The new code itself crashes: a full deploy would crash the same way. Report it.
      if ((error as { code?: string }).code === "LAUNCH_FAILED") throw error;
      // Anything the quick fix cannot do (compile error, unsupported change, device refused) -> real deploy.
      ctx.log(`hot reload failed, deploying normally: ${(error as Error).message}`);
      hp.writeState(file, { ...state!, install: "" }); // the next deploy re-records a baseline
      return { path: "full", fallback_reason: `quick fix failed: ${(error as Error).message.slice(0, 200)}` };
    }
  },
};

/** After a full deploy in auto mode: record the quick-fix baseline once the user is iterating. */
const baselineStep = {
  id: "baseline",
  when: (ctx: { input: RunInput; outputs: Record<string, any> }) => autoMode(ctx.input) && !wentHot(ctx) && !relaunchOnly(ctx),
  async run(ctx: { input: RunInput; outputs: Record<string, any>; signal: AbortSignal; log(m: string): void }) {
    try {
      const { hp, project, target, module, file } = await hotContext(ctx);
      if (!module || !project.bundleName || !["entry", "feature"].includes(module.type)) return { recorded: false };
      const previous = hp.readState(file);
      const iterating = !!previous?.last_full && Date.now() - previous.last_full < ITERATING_MS;
      const base = { module: module.name, moduleRoot: module.root, target, last_full: Date.now() };
      if (!iterating) {
        // First deploy: remember it; the baseline compile is only paid when a second deploy follows.
        hp.writeState(file, { ...base, install: "", sources: {}, inputs: {} });
        return { recorded: false, note: "next build_run records the quick-fix baseline" };
      }
      const started = Date.now();
      const { recordBaseline } = await import("./domains/hotreload.js");
      // Snapshot before compiling: an edit made while the baseline compiles is then seen as a change.
      const sources = hp.currentSources(project.root), inputs = hp.inputsSnapshot(project.root);
      await recordBaseline(project, module.name, project.bundleName, target, ctx.signal);
      const { installStamp } = await import("./domains/device.js");
      const install = (await installStamp(target, project.bundleName, ctx.signal)) ?? "";
      hp.writeState(file, { ...base, install, sources, inputs });
      return { recorded: true, elapsed_ms: Date.now() - started, note: "later build_run calls quick-fix code changes of this module in seconds" };
    } catch (error) {
      ctx.log(`baseline not recorded: ${(error as Error).message}`);
      return { recorded: false, error: (error as Error).message.slice(0, 200) };
    }
  },
};

/** After launch: walk a saved flow to the target page (attach: the app was just started). */
const flowStep = {
  id: "flow",
  when: (ctx: { input: RunInput }) => !!ctx.input.then_flow,
  async run(ctx: { input: RunInput; outputs: Record<string, any>; signal: AbortSignal; log(m: string): void }) {
    const { replayFlow } = await import("./domains/flows.js");
    const { deviceInfo } = await import("./domains/device.js");
    const target = ctx.outputs.target.target as string;
    const screen = ctx.outputs.target.screen ?? (await deviceInfo(target, ctx.signal).catch(() => undefined))?.screen;
    try {
      return await replayFlow(ctx.input.project, ctx.input.then_flow!, target, ctx.input.flow_variables ?? {},
        { attach: true, screen: screen ? { w: screen.width, h: screen.height } : undefined }, ctx.signal, ctx.log);
    } catch (error) {
      // The app is installed and running: a flow that no longer matches the UI must not fail the deploy.
      const e = error as { code?: string; message: string; details?: unknown };
      return { flow: ctx.input.then_flow, passed: false, error: { code: e.code, message: e.message, details: e.details },
        hint: "The app is deployed; the flow did not reach its page. Inspect with ui observe, then update the flow (ui act steps + save_flow)" };
    }
  },
};

/**
 * Device first, then the modules that belong on it (phone vs watch entry), then build/install only those.
 * In auto mode a provable code-only change is quick-fixed instead (hot step) and the deploy steps are skipped.
 */
const runSteps = (build: boolean): Step<RunInput>[] => {
  const steps = baseRunSteps(build).map((s) => (["uninstall", "install", "launch"].includes(s.id) ? unlessHot(s) : s));
  const at = steps.findIndex((s) => s.id === "launch");
  return [...steps.slice(0, at + 1), ...(build ? [baselineStep as Step<RunInput>] : []), ...steps.slice(at + 1)];
};
const baseRunSteps = (build: boolean): Step<RunInput>[] => [
  {
    id: "target",
    async run(ctx: { input: RunInput; signal: AbortSignal }) {
      const { resolveTarget, deviceInfo, shell } = await import("./domains/device.js");
      const { inspectProject, runnableDeviceTypes } = await import("./domains/project.js");
      const types = (() => { try { return runnableDeviceTypes(inspectProject(ctx.input.project, ctx.input.product)); } catch { return undefined; } })();
      const target = await resolveTarget(ctx.input.target, ctx.signal, types);
      const info = await deviceInfo(target, ctx.signal).catch(() => ({ target }));
      const deviceType = (await shell(target, ["param", "get", "const.product.devicetype"], ctx.signal, 10000).catch(() => undefined))?.stdout.trim();
      return { ...info, target, device_type: deviceType && !/fail|error/i.test(deviceType) ? deviceType : undefined };
    },
  },
  {
    id: "select",
    async run(ctx: { input: RunInput; outputs: Record<string, any> }) {
      const { selectRunModules } = await import("./domains/project.js");
      const { project, modules: names } = await projectOf(ctx.input);
      const explicit = names?.length ? names : ctx.input.module ? [ctx.input.module] : undefined;
      const { modules, reason } = selectRunModules(project, { modules: explicit, deviceType: ctx.outputs.target.device_type });
      return { modules: modules.map((m) => m.name), reason, device_type: ctx.outputs.target.device_type ?? null };
    },
  },
  ...(build ? [hotStep as Step<RunInput>, unlessHot(preflightStep as Step<RunInput>), unlessHot({
    ...buildStep,
    async run(ctx: { input: RunInput; outputs: Record<string, any>; signal: AbortSignal; job_id: string }) {
      const { buildProject } = await import("./domains/project.js");
      const { project } = await projectOf(ctx.input);
      // Build only the selected modules (hvigor pulls in their HAR/HSP dependencies itself).
      const input = { ...ctx.input, modules: ctx.outputs.select.modules };
      if (!ctx.input.hot_reload) return buildProject(project, input, ctx.signal, ctx.job_id).catch(async (error) => {
        const { buildFailureHints } = await import("./domains/diagnose.js");
        const details = (error as { details?: { diagnostics?: { code?: string; message: string }[] } }).details;
        if (details?.diagnostics) Object.assign(details, { hints: buildFailureHints(details.diagnostics) });
        throw error;
      });
      const { hotBuildProps } = await import("./domains/hotreload.js");
      return buildProject(project, { ...input, props: hotBuildProps() }, ctx.signal, ctx.job_id);
    },
  })] : []),
  {
    // `devecocli run --uninstall`: remove the installed app first (clean data / signature change).
    id: "uninstall",
    effect: true,
    when: (ctx: { input: RunInput }) => !!ctx.input.uninstall_first,
    async run(ctx: { input: RunInput; outputs: Record<string, any>; signal: AbortSignal }) {
      const { inspectProject } = await import("./domains/project.js");
      const { uninstall } = await import("./domains/device.js");
      const project = inspectProject(ctx.input.project, ctx.input.product);
      invariant(project.bundleName, "PROJECT_INVALID", "bundleName missing");
      return uninstall(ctx.outputs.target.target, project.bundleName, ctx.signal).catch((e: Error) => ({ uninstalled: false, note: e.message }));
    },
  },
  {
    id: "install",
    effect: true,
    async run(ctx: { input: RunInput; outputs: Record<string, any>; signal: AbortSignal }) {
      const { buildOutputs } = await import("./domains/project.js");
      const { install } = await import("./domains/device.js");
      const { project } = await projectOf(ctx.input);
      // Only packages of the selected modules: never ship the watch HAP to a phone (or vice versa).
      const selected = project.modules.filter((m) => (ctx.outputs.select.modules as string[]).includes(m.name));
      const haps = ctx.outputs.build?.artifacts?.length
        ? (ctx.outputs.build.artifacts as { path: string; module?: string }[]).filter((a) => !a.module || selected.some((m) => m.name === a.module))
        : await buildOutputs(project, "assembleHap", selected.filter((m) => m.type !== "shared"));
      invariant(haps.length, "NOT_FOUND", `No built package for ${selected.map((m) => m.name).join(", ")}`, undefined,
        "Use run action=build_run, or project action=build modules=[...] first");
      // HSPs are only needed when this app actually has shared modules; ship the ones built for this product.
      const hsp = await buildOutputs(project, "assembleHsp", project.modules.filter((m) => m.type === "shared")).catch(() => []);
      const paths = [...new Set([...haps.map((p: { path: string }) => p.path), ...hsp.map((p) => p.path)])];
      const unsigned = paths.filter((p) => /-unsigned\.h[as]p$/.test(p));
      return { ...(await install(ctx.outputs.target.target, paths, ctx.signal)), packages: paths.map((p) => p.split(/[\\/]/).pop()), ...(unsigned.length ? { unsigned: unsigned.length } : {}) };
    },
    // After a crash mid-install, the app being present with the expected bundle is good enough to continue.
    async reconcile(ctx: { input: RunInput; outputs: Record<string, any>; signal: AbortSignal }) {
      const { inspectProject } = await import("./domains/project.js");
      const { shell } = await import("./domains/device.js");
      const project = inspectProject(ctx.input.project, ctx.input.product);
      const dump = await shell(ctx.outputs.target.target, ["bm", "dump", "-n", project.bundleName ?? ""], ctx.signal);
      return /"bundleName"/.test(dump.stdout) ? { installed: "reconciled" } : undefined;
    },
  },
  {
    id: "launch",
    async run(ctx: { input: RunInput; outputs: Record<string, any>; signal: AbortSignal }) {
      const { inspectProject, mainAbility } = await import("./domains/project.js");
      const { launchAndCheck } = await import("./domains/device.js");
      const project = inspectProject(ctx.input.project, ctx.input.product);
      invariant(project.bundleName, "PROJECT_INVALID", "bundleName missing");
      const entry = (ctx.outputs.select?.modules as string[] | undefined)?.find((n) => project.modules.find((m) => m.name === n)?.type === "entry");
      const main = mainAbility(project, ctx.input.module ?? entry);
      const result = await launchAndCheck(ctx.outputs.target.target, project.bundleName, ctx.input.ability ?? main.ability, main.module, ctx.signal);
      if (ctx.input.hot_reload) {
        const { recordBaseline } = await import("./domains/hotreload.js");
        await recordBaseline(project, main.module, project.bundleName, ctx.outputs.target.target, ctx.signal);
      }
      if (!result.started) {
        // Diagnose right here: crash kind, message, the project's own frames with code, likely causes.
        const { crashSummary } = await import("./domains/diagnose.js");
        const crash = result.crashed ? await crashSummary(ctx.outputs.target.target, project.bundleName, result.new_crash_logs, ctx.input.project, ctx.signal) : undefined;
        invariant(false, "LAUNCH_FAILED", result.crashed ? "App crashed on startup" : "App process is not running after launch", { ...result, ...(crash ? { crash } : {}) },
          crash?.source?.length ? `Fix ${crash.source[0]!.file}:${crash.source[0]!.line} (see crash.source), then build_run again` : "Run diagnose action=crash to see the crash report");
      }
      return result;
    },
  },
  flowStep,
  {
    id: "assert",
    when: (ctx: { input: RunInput }) => !!ctx.input.assert,
    async run(ctx: { input: RunInput; outputs: Record<string, any>; signal: AbortSignal }) {
      const { waitFor } = await import("./domains/ui.js");
      const a = ctx.input.assert!;
      const selector = (a.visible ?? a.hidden) as import("./domains/ui.js").Selector;
      const verdict = await waitFor(ctx.outputs.target.target, selector, a.visible ? "visible" : "hidden", a.timeout_ms ?? 8000, ctx.signal);
      invariant(verdict.passed, "ASSERTION_FAILED", "UI assertion failed after launch", verdict, "Inspect with ui observe");
      return verdict;
    },
  },
];

const runSummary = (o: Record<string, any>) => ({
  device: o.target?.target, modules: o.select?.modules, module_selection: o.select?.reason,
  ...(o.hot ? { path: o.hot.path, ...(o.hot.fallback_reason ? { fallback_reason: o.hot.fallback_reason } : {}), ...(o.hot.note ? { note: o.hot.note } : {}), ...(o.hot.path === "hot_reload" ? { hot_reload: { files: o.hot.files, elapsed_ms: o.hot.elapsed_ms, note: "Quick-fixed the installed app (no rebuild/reinstall) and relaunched it with the new code" } } : {}) } : {}),
  ...(o.baseline?.recorded ? { baseline: o.baseline } : {}), build: o.build ? { artifacts: o.build.artifacts?.map((a: { path: string }) => a.path), elapsed_ms: o.build.elapsed_ms, warnings: o.build.warnings, ...(o.build.device_compat ? { device_compat: o.build.device_compat } : {}) } : undefined,
  installed: o.install, launch: o.launch, ...(o.flow ? { flow: o.flow } : {}), assert: o.assert ?? undefined,
  ...(o.preflight ? { preflight: settlePreflight(o.preflight, !!o.build) } : {}),
});
defineJob<RunInput>({ kind: "build_run", steps: runSteps(true), summarize: runSummary });
defineJob<RunInput>({ kind: "deploy", steps: runSteps(false), summarize: runSummary });

defineJob<{ project: string; target?: string; id: string; variables: Record<string, string>; repair: boolean; snapshot?: boolean }>({
  kind: "flow_replay",
  steps: [{
    id: "replay",
    async run(ctx) {
      const { resolveTarget, deviceInfo } = await import("./domains/device.js");
      const { replayFlow } = await import("./domains/flows.js");
      const target = await resolveTarget(ctx.input.target, ctx.signal);
      const info = await deviceInfo(target, ctx.signal);
      const screen = info.screen ? { w: info.screen.width, h: info.screen.height } : undefined;
      const result = await replayFlow(ctx.input.project, ctx.input.id, target, ctx.input.variables, { repair: ctx.input.repair, screen }, ctx.signal, ctx.log);
      if (!ctx.input.snapshot) return result;
      // The page the flow proved it reached, compared with how it looked last time.
      const { visualCheck } = await import("./domains/visual.js");
      const visual = await visualCheck(target, { project: ctx.input.project, name: `flow-${ctx.input.id}` }, { model: info.model ?? info.name ?? target, size: screen }, ctx.signal)
        .catch((e: Error) => ({ error: e.message }));
      return { ...result, visual };
    },
  }],
  summarize: (o) => o.replay,
});

defineJob<import("./domains/layout.js").LayoutInput>({
  kind: "layout_check",
  steps: [{
    id: "check",
    async run(ctx) {
      const { layoutCheck } = await import("./domains/layout.js");
      return layoutCheck(ctx.input, ctx.signal, ctx.log);
    },
  }],
  summarize: (o) => o.check,
});

defineJob<{ version?: string; source?: string; force?: boolean }>({
  kind: "kb_update",
  steps: [{
    id: "update",
    async run(ctx) {
      const { update } = await import("./domains/knowledge.js");
      return update(ctx.input, ctx.signal);
    },
  }],
  summarize: (o) => o.update,
});

defineJob<{ project: string; product?: string; team?: string; acl?: string[]; force?: boolean }>({
  kind: "auto_sign",
  steps: [{
    id: "sign",
    effect: true,
    async run(ctx) {
      const { inspectProject } = await import("./domains/project.js");
      const { autoSign } = await import("./domains/sign.js");
      const project = inspectProject(ctx.input.project, ctx.input.product);
      invariant(project.bundleName, "PROJECT_INVALID", "bundleName missing");
      return autoSign(ctx.input.project, { product: project.product, team: ctx.input.team, bundle: project.bundleName, acl: ctx.input.acl, force: ctx.input.force }, ctx.signal, ctx.log);
    },
  }],
  summarize: (o) => o.sign,
});
