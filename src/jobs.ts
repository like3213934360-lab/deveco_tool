import { defineJob } from "./core/jobs.js";
import { invariant } from "./core/errors.js";
import type { BuildTask } from "./domains/project.js";

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
    try {
      const result = await arktsCheck(ctx.input.project, undefined, ctx.signal);
      invariant(result.errors === 0, "CHECK_FAILED", `ArkTS preflight found ${result.errors} error(s); build skipped`,
        { issues: result.issues, hints: result.hints }, "Fix these errors (or pass preflight=false to let hvigor report them)");
      return { errors: 0, warnings: result.warnings };
    } catch (error) {
      if ((error as { code?: string }).code === "CHECK_FAILED" && (error as { details?: unknown }).details) throw error;
      ctx.log(`preflight unavailable: ${(error as Error).message}`);
      return { skipped: true };
    }
  },
};

const buildStep = {
  id: "build",
  async run(ctx: { input: BuildInput; signal: AbortSignal; job_id: string }) {
    const { inspectProject, buildProject } = await import("./domains/project.js");
    const { buildFailureHints } = await import("./domains/diagnose.js");
    try {
      return await buildProject(inspectProject(ctx.input.project, ctx.input.product), ctx.input, ctx.signal, ctx.job_id);
    } catch (error) {
      const details = (error as { details?: { diagnostics?: { code?: string; message: string }[] } }).details;
      if (details?.diagnostics) Object.assign(details, { hints: buildFailureHints(details.diagnostics) });
      throw error;
    }
  },
};

defineJob<BuildInput>({
  kind: "build",
  steps: [preflightStep, buildStep],
  summarize: (o) => ({ ...o.build, preflight: o.preflight }),
});

interface RunInput extends BuildInput {
  target?: string; module?: string; ability?: string; hot_reload?: boolean;
  assert?: { visible?: Record<string, unknown>; hidden?: Record<string, unknown>; timeout_ms?: number };
}

const runSteps = (build: boolean) => [
  ...(build ? [preflightStep, {
    ...buildStep,
    async run(ctx: { input: RunInput; signal: AbortSignal; job_id: string }) {
      const { inspectProject, buildProject } = await import("./domains/project.js");
      const project = inspectProject(ctx.input.project, ctx.input.product);
      if (!ctx.input.hot_reload) return buildStep.run(ctx);
      // Hot-reload baseline: a normal debug build already emits the symbol map that patch compiles diff against.
      const { hotBuildProps } = await import("./domains/hotreload.js");
      return buildProject(project, { ...ctx.input, props: hotBuildProps() }, ctx.signal, ctx.job_id);
    },
  }] : []),
  {
    id: "target",
    async run(ctx: { input: RunInput; signal: AbortSignal }) {
      const { resolveTarget, deviceInfo } = await import("./domains/device.js");
      const target = await resolveTarget(ctx.input.target, ctx.signal);
      const info = await deviceInfo(target, ctx.signal).catch(() => ({ target }));
      return { ...info, target };
    },
  },
  {
    id: "install",
    effect: true,
    async run(ctx: { input: RunInput; outputs: Record<string, any>; signal: AbortSignal }) {
      const { inspectProject, buildOutputs } = await import("./domains/project.js");
      const { install } = await import("./domains/device.js");
      const project = inspectProject(ctx.input.project, ctx.input.product);
      const packages = ctx.outputs.build?.artifacts?.length
        ? ctx.outputs.build.artifacts
        : [...await buildOutputs(project, "assembleHap"), ...await buildOutputs(project, "assembleHsp").catch(() => [])];
      invariant(packages.length, "NOT_FOUND", "No built packages found", undefined, "Use run action=build_run, or project action=build first");
      const hsp = await buildOutputs(project, "assembleHsp").catch(() => []);
      const paths = [...new Set([...packages.map((p: { path: string }) => p.path), ...hsp.map((p) => p.path)])];
      return { ...(await install(ctx.outputs.target.target, paths, ctx.signal)), packages: paths.length };
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
      const main = mainAbility(project, ctx.input.module);
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
  device: o.target?.target, build: o.build ? { artifacts: o.build.artifacts?.map((a: { path: string }) => a.path), elapsed_ms: o.build.elapsed_ms, warnings: o.build.warnings } : undefined,
  installed: o.install, launch: o.launch, assert: o.assert ?? undefined,
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

defineJob<{ project: string; product?: string; team?: string; acl?: string[] }>({
  kind: "auto_sign",
  steps: [{
    id: "sign",
    effect: true,
    async run(ctx) {
      const { inspectProject } = await import("./domains/project.js");
      const { autoSign } = await import("./domains/sign.js");
      const project = inspectProject(ctx.input.project, ctx.input.product);
      invariant(project.bundleName, "PROJECT_INVALID", "bundleName missing");
      return autoSign(ctx.input.project, { product: project.product, team: ctx.input.team, bundle: project.bundleName, acl: ctx.input.acl }, ctx.signal, ctx.log);
    },
  }],
  summarize: (o) => o.sign,
});
