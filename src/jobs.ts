import { defineJob } from "./core/jobs.js";
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
    // Advisory only: the static checker is a fast approximation and can be wrong on real projects
    // (unknown HDS containers, unusual formatting). hvigor is the compiler of record, so findings are
    // reported alongside the build instead of blocking it.
    try {
      const result = await arktsCheck(ctx.input.project, undefined, ctx.signal);
      if (result.errors) ctx.log(`preflight: ${result.errors} possible error(s); building anyway (hvigor decides)`);
      return { errors: result.errors, warnings: result.warnings, ...(result.errors ? { issues: result.issues.slice(0, 10) } : {}) };
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
}

/** Device first, then the modules that belong on it (phone vs watch entry), then build/install only those. */
const runSteps = (build: boolean) => [
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
  ...(build ? [preflightStep, {
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
  }] : []),
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
      invariant(result.started, "LAUNCH_FAILED", result.crashed ? "App crashed on startup" : "App process is not running after launch", result,
        "Run diagnose action=crash to see the crash report");
      return result;
    },
  },
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
  device: o.target?.target, modules: o.select?.modules, module_selection: o.select?.reason, build: o.build ? { artifacts: o.build.artifacts?.map((a: { path: string }) => a.path), elapsed_ms: o.build.elapsed_ms, warnings: o.build.warnings, ...(o.build.device_compat ? { device_compat: o.build.device_compat } : {}) } : undefined,
  installed: o.install, launch: o.launch, assert: o.assert ?? undefined,
  ...(o.preflight ? { preflight: settlePreflight(o.preflight, !!o.build) } : {}),
});
defineJob<RunInput>({ kind: "build_run", steps: runSteps(true), summarize: runSummary });
defineJob<RunInput>({ kind: "deploy", steps: runSteps(false), summarize: runSummary });

defineJob<{ project: string; target?: string; id: string; variables: Record<string, string>; repair: boolean }>({
  kind: "flow_replay",
  steps: [{
    id: "replay",
    async run(ctx) {
      const { resolveTarget, deviceInfo } = await import("./domains/device.js");
      const { replayFlow } = await import("./domains/flows.js");
      const target = await resolveTarget(ctx.input.target, ctx.signal);
      const info = await deviceInfo(target, ctx.signal);
      return replayFlow(ctx.input.project, ctx.input.id, target, ctx.input.variables, { repair: ctx.input.repair, screen: info.screen ? { w: info.screen.width, h: info.screen.height } : undefined }, ctx.signal, ctx.log);
    },
  }],
  summarize: (o) => o.replay,
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
