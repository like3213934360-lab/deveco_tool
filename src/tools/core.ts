import { z } from "zod";
import { selectorSchema } from "../domains/selectors.js";
export { selectorSchema } from "../domains/selectors.js";
import { invariant } from "../core/errors.js";
import * as repeatModule from "../domains/repeat.js";
import { fields, MAX_WAIT_MS, SYNC_WAIT_MS, tool } from "../registry.js";

/* Job definitions are registered lazily the first time a job-producing tool runs. */
let jobsReady: Promise<void> | undefined;
export function ensureJobs() {
  return (jobsReady ??= import("../jobs.js").then(() => undefined));
}
async function startAndWait(kind: string, input: unknown, key: string | undefined, wait: number | undefined) {
  await ensureJobs();
  const { startJob, waitJob } = await import("../core/jobs.js");
  const { job_id, deduplicated } = await startJob(kind, input, key);
  const status = await waitJob(job_id, wait ?? 1500);
  return deduplicated ? { ...status, deduplicated } : status;
}

export const doctorTool = tool({
  name: "doctor",
  title: "Environment check",
  readOnly: true,
  description: "Check SDK, tools, devices, project, knowledge and logins.",
  schema: z.object({
    project: fields.project.optional(),
    target: fields.target,
    remote: z.boolean().optional().describe("Check online KB version"),
  }),
  async handler(input, ctx) {
    const { doctor } = await import("../domains/doctor.js");
    return doctor(input, ctx.signal);
  },
});

export const projectTool = tool({
  name: "project",
  title: "Project create/sync/build",
  description: [
    "info/templates/clean/sync/create(app_name,bundle_name). build restores signing_config. Build already checks edited files: no code check first.",
    "test: instrument erases data, requires allow_data_reset. testing: vendor operation. verify: JSON plan. entries: static graph.",
    "export_page feeds import_page; apply review_sha256. request_key/wait: sync/build/clean/test/verify/export_page/testing start/install/update only.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["info", "templates", "create", "sync", "build", "clean", "test", "testing", "verify", "entries", "export_page", "import_page"]),
    operation: z.enum(["services", "install", "update", "start", "status", "stop", "report"]).optional(),
    service: z.string().optional(),
    task_id: z.string().optional(),
    update_service: z.boolean().optional(),
    project: fields.project.optional(),
    product: fields.product,
    modules: fields.modules,
    execution_mode: z.enum(["module", "project"]).optional(),
    kind: z.enum(["local", "instrument"]).optional(),
    scope: z.array(z.string()).min(1).max(100).optional().describe("test: suite[#method]; does not isolate entry imports"),
    coverage: z.boolean().optional(),
    target: fields.target,
    timeout_ms: z.number().int().min(1000).max(1800000).optional().describe("Default 600000"),
    allow_data_reset: z.boolean().optional().describe("instrument: required; SDK uninstalls app and erases its data"),
    expected_tests: z.number().int().min(1).optional(),
    plan: z.string().optional().describe("Plan path"),
    review_sha256: z.string().optional(),
    output: z.string().optional().describe("export_page: omit to inspect"),
    changed_only: z.boolean().optional(),
    base: z.string().optional().describe("changed_only Git base ref"),
    baseline_mode: z.enum(["compare", "record"]).optional(),
    allow_commands: z.boolean().optional().describe("Permit reviewed commands"),
    task: z.enum(["assembleHap", "assembleHar", "assembleHsp", "assembleApp", "compileNative"]).optional().describe("build: assembleHap default; compileNative: clangd inputs"),
    mode: z.string().optional().describe("Default debug"),
    signing_config: z.string().min(1).max(128).optional().describe("build: temporary signingConfig selection"),
    debug_line: z.boolean().optional().describe("Hvigor debugLine"),
    clean: z.boolean().optional(),
    preflight: z.boolean().optional().describe("Advisory ArkTS check, default true"),
    app_name: z.string().optional(),
    template: z.enum(["empty-ability", "native-cpp"]).optional().describe("Default: empty-ability"),
    bundle_name: z.string().optional(),
    sdk_version: z.string().optional().describe("Default: installed SDK"),
    target_api: z.number().int().optional(),
    compatible_api: z.number().int().optional(),
    device_types: z.array(z.enum(["phone", "tablet", "2in1", "car", "wearable", "tv"])).min(1).optional().describe("Default phone"),
    merge: z.boolean().optional().describe("Keep existing files at create"),
    request_key: fields.requestKey,
    wait: fields.wait,
  }),
  params: {
    testing: ["operation", "service", "plan", "target", "task_id", "update_service", "request_key", "wait"],
    templates: [],
    info: ["project", "product"], entries: ["project", "product"],
    export_page: ["project", "product", "plan", "output", "request_key", "wait"],
    import_page: ["project", "product", "plan", "review_sha256"],
    test: ["project", "product", "kind", "modules", "scope", "coverage", "target", "timeout_ms", "allow_data_reset", "expected_tests", "request_key", "wait"],
    verify: ["project", "product", "plan", "output", "target", "changed_only", "base", "baseline_mode", "allow_commands", "request_key", "wait"],
    create: ["project", "app_name", "bundle_name", "template", "sdk_version", "target_api", "compatible_api", "device_types", "merge"],
    sync: ["project", "product", "request_key", "wait"],
    build: ["project", "product", "modules", "task", "mode", "signing_config", "debug_line", "clean", "preflight", "request_key", "wait"],
    clean: ["project", "product", "modules", "execution_mode", "wait", "request_key"],
  },
  async handler(input, ctx) {
    if (input.action === "testing") {
      const testing = await import("../domains/testing-console.js");
      const { operation, service, task_id, plan, target, update_service, request_key, wait } = input;
      if (operation === "install" || operation === "update") {
        invariant(service && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(service) && !plan && !target && !task_id && update_service === undefined,
          "INVALID_INPUT", "Testing service maintenance requires one service key");
        return startAndWait("testing_service", { operation, service }, request_key, wait);
      }
      invariant(service === undefined, "INVALID_INPUT", "service is only used for install or update");
      if (operation === "start") {
        invariant(plan && target && !task_id, "INVALID_INPUT", "Testing start requires a vendor JSON plan and one exact target");
        const selected = await (await import("../domains/device.js")).resolveTarget(target, ctx.signal);
        const params = testing.testingPlan(plan, selected);
        return startAndWait("testing_run", { target: selected, params, update_service }, request_key, wait);
      }
      invariant(!plan && !target && update_service === undefined && !request_key && wait === undefined, "INVALID_INPUT", "These options apply only to Testing start");
      if (operation === "services" && !task_id) return testing.testingServices(ctx.signal);
      invariant(task_id && (operation === "status" || operation === "stop" || operation === "report"), "INVALID_INPUT", "Choose services, start, or status/stop/report with task_id");
      return testing.testingTask(operation, task_id, ctx.signal);
    }
    const project = await import("../domains/project.js");
    if (input.action === "templates") return { templates: project.projectTemplates, default: project.projectTemplates[0] };
    invariant(input.project, "INVALID_INPUT", "project is required");
    switch (input.action) {
      case "entries": return (await import("../domains/entries.js")).entryGraph(input.project, input.product);
      case "export_page": {
        invariant(input.plan && input.output !== "", "INVALID_INPUT", "export_page requires a design plan");
        const { project, product, plan, output, request_key, wait } = input;
        return startAndWait("export_page", { project, product, plan, output }, request_key, wait);
      }
      case "import_page": {
        invariant(input.plan && (input.review_sha256 === undefined || /^[a-f0-9]{64}$/.test(input.review_sha256)), "INVALID_INPUT", "import_page requires a plan path and optional preview review_sha256");
        const { importPage } = await import("../domains/page-import.js");
        return importPage(project.inspectProject(input.project, input.product), input.plan, input.review_sha256, ctx.signal);
      }
      case "test":
        invariant(input.kind, "INVALID_INPUT", "test requires kind=local|instrument");
        return startAndWait("project_test", input, input.request_key, input.wait);
      case "verify": {
        invariant(input.plan && input.output, "INVALID_INPUT", "verify requires plan and output");
        const verify = await import("../domains/verify.js");
        const jobInput = { ...input, project: input.project, plan: input.plan, output: input.output };
        if (verify.planNeedsDevice(verify.readPlan(jobInput).plan)) jobInput.target = await (await import("../domains/device.js")).resolveTarget(input.target, ctx.signal);
        return startAndWait("verify", jobInput, input.request_key, input.wait);
      }
      case "info":
        return project.projectInfo(project.inspectProject(input.project, input.product));
      case "create": {
        invariant(input.app_name && input.bundle_name, "INVALID_INPUT", "create needs app_name and bundle_name");
        return project.createProject({ ...input, project: input.project, app_name: input.app_name, bundle_name: input.bundle_name });
      }
      case "clean":
        return startAndWait("project_clean", input, input.request_key, input.wait);
      case "sync":
        return startAndWait("sync", { project: input.project, product: input.product }, input.request_key, input.wait);
      case "build":
        return startAndWait("build", { project: input.project, product: input.product, modules: input.modules, task: input.task, mode: input.mode, signing_config: input.signing_config, debug_line: input.debug_line, clean: input.clean, preflight: input.preflight ?? true }, input.request_key, input.wait);
    }
  },
});

const assertSchema = z.object({
  visible: z.lazy(() => selectorSchema).optional(),
  hidden: z.lazy(() => selectorSchema).optional(),
  timeout_ms: z.number().int().min(100).max(120000).optional(),
}).strict().refine((input) => !!input.visible !== !!input.hidden, "Pass exactly one visible or hidden selector");

const uiOpSchema = z.enum(["click", "double_click", "long_click", "input", "clear_text", "type", "swipe", "drag", "fling", "scroll", "scroll_start", "scroll_end", "scroll_find", "key",
  "mouse_click", "mouse_double_click", "mouse_long_click", "mouse_move", "mouse_scroll", "mouse_drag", "pinch", "rotate"]);
const touchSchema = z.object({ scale: z.number().optional(), degrees: z.number().optional(), radius: z.number().optional() }).strict().meta({ id: "Touch" });
const batchStepSchema = z.object({
  op: z.enum([...uiOpSchema.options, "wait"]),
  selector: selectorSchema.optional(),
  to: selectorSchema.optional(),
  touch: touchSchema.optional(),
  scroll_offset: z.number().int().min(0).optional(),
  duration_ms: z.number().int().min(500).max(60000).optional(),
  x: z.number().int().optional(), y: z.number().int().optional(), x2: z.number().int().optional(), y2: z.number().int().optional(),
  text: z.string().optional(), append: z.boolean().optional(), key: z.string().optional(), keys: z.array(z.string()).min(1).max(3).optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(), speed: z.number().int().min(200).max(40000).optional(),
  button: z.enum(["left", "right", "middle"]).optional(), ticks: z.number().int().min(1).max(50).optional(),
  ms: z.number().int().min(0).max(10000).optional().describe("wait without selector: pause in ms"),
  timeout_ms: z.number().int().min(1).optional().describe("selector wait or scroll deadline"),
}).strict();

export const runTool = tool({
  name: "run",
  title: "Deploy and launch",
  description: [
    "build_run: check edited files, build/install/launch/crash; no code check first. signing_config is restored.",
    "run_mode=auto: first build_run on the same device deploys; later code quick-fix. full deploys.",
    "then_flow=<id>: replay after launch; assert then verifies the final screen. deploy uses latest packages.",
    "launch: project/product/target/module/ability/want only; stop/uninstall use project/product/target. wait/request_key: build_run/deploy only. hot_reload=true saves baseline after successful launch.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["build_run", "deploy", "launch", "stop", "uninstall"]),
    project: fields.project,
    product: fields.product,
    modules: fields.modules,
    target: fields.target,
    mode: z.string().optional(),
    signing_config: z.string().min(1).max(128).optional().describe("Temporary signingConfig; full build"),
    debug_line: z.boolean().optional().describe("Hvigor debugLine; inherited by patches"),
    module: z.string().optional().describe("Launch module (default entry)"),
    ability: z.string().optional().describe("Launch ability (default module mainElement)"),
    want: z.object({ uri: z.string().max(4096).optional(), action: z.string().max(256).optional(), parameters: z.record(z.string(), z.union([z.string().max(4096), z.number().int(), z.boolean()])).optional() }).strict().optional().describe("launch: URI/action and typed Want parameters"),
    assert: assertSchema.optional(),
    hot_reload: z.boolean().optional(),
    hot_reload_module: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(16)]).optional(),
    skip_build: z.boolean().optional().describe("build_run: latest packages without building (=deploy)"),
    uninstall_first: z.boolean().optional().describe("build_run/deploy: uninstall first (erases app data)"),
    run_mode: z.enum(["auto", "full"]).optional().describe("build_run only"),
    then_flow: z.string().optional().describe("build_run/deploy: flow failure does not fail deploy; inspect flow.passed"),
    flow_variables: z.record(z.string(), z.string()).optional().describe("then_flow: fill required variables from ui_flow show"),
    request_key: fields.requestKey,
    wait: fields.wait,
  }),
  params: {
    build_run: ["project", "product", "modules", "target", "mode", "signing_config", "debug_line", "run_mode", "module", "ability", "assert", "hot_reload", "hot_reload_module", "skip_build", "uninstall_first", "then_flow", "flow_variables", "request_key", "wait"],
    deploy: ["project", "product", "modules", "target", "module", "ability", "assert", "hot_reload", "hot_reload_module", "uninstall_first", "then_flow", "flow_variables", "request_key", "wait"],
    launch: ["project", "product", "target", "module", "ability", "want"],
    stop: ["project", "product", "target"],
    uninstall: ["project", "product", "target"],
  },
  async handler(input, ctx) {
    if (input.action === "build_run" || input.action === "deploy") {
      invariant(!input.hot_reload_module || input.hot_reload, "INVALID_INPUT", "hot_reload_module requires hot_reload=true");
      if (Array.isArray(input.hot_reload_module)) invariant(new Set(input.hot_reload_module).size === input.hot_reload_module.length,
        "INVALID_INPUT", "hot_reload_module must contain distinct names");
      invariant(!input.signing_config || !input.skip_build, "INVALID_INPUT", "signing_config cannot be used with skip_build");
      invariant(!input.debug_line || !input.skip_build, "INVALID_INPUT", "debug_line requires a build and cannot be used with skip_build");
      if (input.then_flow) {
        // Fail before a long build when the flow does not exist or needs variables that were not given.
        const { readFlow } = await import("../domains/flows.js");
        const flow = readFlow(input.project, input.then_flow);
        const missing = Object.entries(flow.variables).filter(([k, v]) => v.required && input.flow_variables?.[k] === undefined).map(([k]) => k);
        invariant(!missing.length, "INVALID_INPUT", `then_flow ${input.then_flow} needs flow_variables: ${missing.join(", ")}`);
      }
      return startAndWait(input.action === "build_run" && input.skip_build ? "deploy" : input.action, input, input.request_key, input.wait ?? 3000);
    }
    const { inspectProject, mainAbility, runnableDeviceTypes } = await import("../domains/project.js");
    const device = await import("../domains/device.js");
    const project = inspectProject(input.project, input.product);
    const target = await device.resolveTarget(input.target, ctx.signal, runnableDeviceTypes(project));
    invariant(project.bundleName, "PROJECT_INVALID", "bundleName missing in AppScope/app.json5");
    if (input.action === "stop") { await device.forceStop(target, project.bundleName, ctx.signal); return { stopped: project.bundleName }; }
    if (input.action === "uninstall") return device.uninstall(target, project.bundleName, ctx.signal);
    const { selectRunModules } = await import("../domains/project.js");
    const deviceType = input.module ? undefined : (await device.shell(target, ["param", "get", "const.product.devicetype"], ctx.signal, 10000).catch(() => undefined))?.stdout.trim();
    const entry = input.module ?? selectRunModules(project, { deviceType }).modules.find((m) => m.type === "entry")?.name;
    const main = mainAbility(project, entry);
    const launched = await device.launchAndCheck(target, project.bundleName, input.ability ?? main.ability, main.module, ctx.signal, 3000, input.want);
    if (!launched.crashed) return launched;
    const { crashSummary } = await import("../domains/diagnose.js");
    const crash = await crashSummary(target, project.bundleName, launched.new_crash_logs, input.project, ctx.signal);
    return { ...launched, ...(crash ? { crash } : {}) };
  },
});

export const jobTool = tool({
  name: "job",
  title: "Jobs",
  description: `resources: inspect same-host reservations; release_resource: exact resource+owner_pid, dead owners only after effect reconciliation. Jobs: wait (default 20000, max ${MAX_WAIT_MS} ms; repeat while running, never restart), status, list, cancel; resume failed/interrupted/needs_input jobs only after inspection (force=true repeats an uncertain step). read: full artifacts (logs/reports/images) by artifact_id; line/limit page, grep filters.`,
  schema: z.object({
    action: z.enum(["wait", "status", "list", "cancel", "resume", "read", "resources", "release_resource"]),
    resource: z.string().optional(),
    owner_pid: z.number().int().positive().optional(),
    job_id: z.string().optional(),
    wait: z.number().int().min(0).max(MAX_WAIT_MS).optional(),
    detail: z.boolean().optional(),
    force: z.boolean().optional(),
    status: z.string().optional().describe("list: filter by status"),
    limit: z.number().int().min(1).max(2000).optional(),
    artifact_id: z.string().optional().describe("read: artifact to read"),
    line: z.number().int().min(0).optional().describe("read: next_line (0-based)"),
    offset: z.number().int().min(0).optional().describe("read: next_offset within line"),
    grep: z.string().optional().describe("read: regex filter, e.g. 'error|ERROR'"),
  }),
  params: {
    resources: [], release_resource: ["resource", "owner_pid"],
    wait: ["job_id", "wait"], status: ["job_id", "detail"], list: ["limit", "status"], cancel: ["job_id"],
    resume: ["job_id", "force"], read: ["artifact_id", "line", "offset", "limit", "grep"],
  },
  async handler(input, { signal }) {
    if (input.action === "resources") return (await import("../core/operations.js")).resourceStatus();
    if (input.action === "release_resource") {
      invariant(input.resource && input.owner_pid, "INVALID_INPUT", "Exact resource and owner_pid required after reconciling side effects");
      return (await import("../core/operations.js")).releaseResource(input.resource, input.owner_pid);
    }
    await ensureJobs();
    const jobs = await import("../core/jobs.js");
    if (input.action === "list") return { jobs: await jobs.listJobs(input.limit ?? 20, input.status) };
    if (input.action === "read") {
      invariant(input.artifact_id, "INVALID_INPUT", "artifact_id is required");
      const { readArtifact } = await import("../core/artifacts.js");
      const result = await readArtifact(input.artifact_id, { line: input.line, offset: input.offset, limit: input.limit, grep: input.grep }, signal);
      if ("image" in result && result.image) {
        const { image, ...rest } = result;
        return { ...rest, _image: { data: image, mime: result.mime } };
      }
      return result;
    }
    invariant(input.job_id, "INVALID_INPUT", "job_id is required");
    switch (input.action) {
      case "wait": return jobs.waitJob(input.job_id, input.wait ?? 20000, signal);
      case "status": return jobs.jobStatus(input.job_id, input.detail);
      case "cancel": return jobs.cancelJob(input.job_id);
      case "resume": return jobs.resumeJob(input.job_id, input.force);
    }
  },
});

const lspOperations = ["hover", "definition", "declaration", "implementation", "references", "symbols", "workspace_symbols", "diagnostics", "completion", "signature", "call_hierarchy"] as const;

export const codeTool = tool({
  name: "code",
  title: "Code checks & LSP",
  readOnly: false,
  openWorld: false,
  description: [
    "origin: source candidates/Git blame. check, lint, api_scan, api_versions: compiler is the final judge. action=lsp requires op: see enum. lsp_restart resync=true.",
    "debug: start(project, module/ability); attach(project or bundle, pid). output_path: NDJSON. break_add: file/line.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["check", "lint", "api_scan", "api_versions", "lsp", "lsp_restart", "origin", "debug"]),
    project: fields.project.optional(),
    files: z.array(z.string()).max(200).optional().describe("check/api_scan/lsp diagnostics: check uses files, not file. Max 20 native files."),
    fix: z.boolean().optional(),
    product: fields.product,
    op: z.enum([...lspOperations,
      "start", "attach", "status", "stop", "threads", "pause", "resume", "step_into", "step_over", "step_out", "stack", "vars", "eval", "set", "break_add", "break_remove", "break_list", "break_enable", "break_disable", "events"]).optional(),
    direction: z.enum(["incoming", "outgoing"]).optional(),
    file: z.string().optional().describe("lint/lsp: one file (except workspace_symbols)"),
    symbol: z.string().optional(),
    line: z.number().int().min(1).optional().describe("1-based line (hint when symbol is given)"),
    column: z.number().int().min(1).optional().describe("1-based column (only without symbol)"),
    key: z.string().optional(),
    text: z.string().optional(),
    query: z.string().optional(),
    language: z.enum(["arkts", "cpp", "all"]).optional().describe("lsp: default by extension; lsp_restart: default all servers"),
    resync: z.boolean().optional(),
    wait: z.number().int().min(0).max(MAX_WAIT_MS).optional(),
    modules: fields.modules,
    output_path: z.string().optional(),
    config_path: z.string().optional().describe("lint rules, default code-linter.json5"),
    incremental: z.boolean().optional().describe("lint: only uncommitted files"),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    target: fields.target,
    bundle: z.string().optional(),
    pid: z.number().int().min(1).max(2147483647).optional(),
    module: z.string().optional(),
    ability: z.string().optional(),
    session_id: z.string().optional(),
    frame: z.number().int().min(0).max(1000).optional(),
    thread: z.number().int().min(0).max(2147483647).optional(),
    skip_build: z.boolean().optional(),
    stop_at_entry: z.boolean().optional(),
    hit_count: z.string().min(1).max(9).optional(),
    disabled: z.boolean().optional(),
    all: z.boolean().optional(),
    break_kind: z.enum(["breakpoint", "logpoint", "all"]).optional(),
    log_level: z.enum(["debug", "info", "warn", "error"]).optional(),
    log_expression: z.string().optional(),
  }),
  params: {
    origin: ["project", "key", "text", "file", "line"],
    check: ["project", "files", "fix"],
    lint: ["project", "file", "fix", "product", "config_path", "incremental", "output_path"],
    api_scan: ["project", "from", "to", "files", "modules", "output_path"],
    api_versions: ["project"],
    lsp: ["project", "op", "file", "files", "symbol", "line", "column", "query", "language", "limit", "direction", "product"],
    lsp_restart: ["project", "language", "resync", "product", "wait"],
    debug: ["op", "project", "product", "target", "bundle", "pid", "module", "ability", "output_path", "session_id", "file", "line", "column", "query", "symbol", "text", "frame", "thread", "limit", "modules", "wait", "skip_build", "stop_at_entry", "hit_count", "disabled", "all", "break_kind", "log_level", "log_expression"],
  },
  async handler(input, ctx) {
    if (input.action === "origin") { invariant(input.project, "INVALID_INPUT", "origin requires project"); return (await import("../domains/origin.js")).sourceOrigin(input.project, input, ctx.signal); }
    if (input.action === "debug") {
      invariant(input.all === undefined || ["break_enable", "break_disable", "break_remove"].includes(input.op ?? ""), "INVALID_INPUT", "all requires a breakpoint change");
      invariant(input.break_kind === undefined || input.op === "break_list" || input.op === "break_remove" && input.all === true,
        "INVALID_INPUT", "break_kind requires break_list or break_remove with all=true");
      invariant(input.op === "break_add" || input.log_level === undefined && input.log_expression === undefined, "INVALID_INPUT", "log_level and log_expression apply to logpoints");
      invariant((input.pid === undefined || input.op === "attach") && (input.ability === undefined || input.op === "start") &&
        ((input.bundle === undefined && input.module === undefined && input.output_path === undefined) || input.op === "start" || input.op === "attach"),
      "INVALID_INPUT", "Bundle, module and output_path apply to start/attach; pid to attach; ability to start");
      if (input.op === "start") {
        invariant(input.project && !input.session_id && input.thread === undefined, "INVALID_INPUT", "Debug start requires project; omit session_id and thread");
        const { project, product, target, module, modules, ability, bundle, output_path, skip_build, stop_at_entry } = input;
        return startAndWait("ark_debug_start", { project, product, target, module, modules, ability, bundle, output_path, skip_build, stop_at_entry }, undefined, input.wait);
      }
      invariant((input.wait === undefined || input.op === "events") && input.modules === undefined && input.skip_build === undefined && input.stop_at_entry === undefined,
        "INVALID_INPUT", "Debug wait requires start/events. Modules and launch flags require start");
      invariant(input.op === "break_add" || input.hit_count === undefined && input.disabled === undefined, "INVALID_INPUT", "hit_count and disabled require break_add");
      const { arkDebug, debugOps } = await import("../domains/ark-debug.js");
      const op = debugOps.find((action) => action === input.op);
      invariant(op, "INVALID_INPUT", "Pass an ArkTS debug operation");
      let project;
      if (op === "attach") {
        invariant((input.project || input.bundle) && !input.session_id && (input.project || input.product === undefined),
          "INVALID_INPUT", "Attach requires project or bundle; product requires project and session_id must be omitted");
        if (input.project) project = (await import("../domains/project.js")).inspectProject(input.project, input.product);
      }
      return arkDebug({ ...input, op }, input.target, project, ctx.signal);
    }
    const code = await import("../domains/code.js");
    if (input.action === "api_versions") return { versions: code.apiVersions() };
    invariant(input.project, "INVALID_INPUT", "project is required");
    const project = input.project;
    switch (input.action) {
      case "check": {
        const cpp = input.files?.filter((f) => /\.(?:c|cc|cpp|cxx|c\+\+|h|hh|hpp|hxx|h\+\+|ixx|inl|inc|tpp)$/i.test(f)) ?? [];
        if (cpp.length) {
          invariant(!input.fix, "INVALID_INPUT", "fix=true is only supported for ArkTS/TypeScript checks");
          invariant(cpp.length <= 20, "INVALID_INPUT", "Check accepts at most 20 native files per call");
          if (cpp.length === input.files!.length) return code.cppCheck(project, cpp, ctx.signal);
          const native = new Set(cpp);
          const arkts = await code.arktsCheck(project, input.files!.filter((file) => !native.has(file)), ctx.signal);
          const c_cpp = await code.cppCheck(project, cpp, ctx.signal);
          return { errors: arkts.errors + c_cpp.errors, warnings: arkts.warnings + c_cpp.warnings, arkts, c_cpp };
        }
        return code.arktsCheck(project, input.files, ctx.signal, input.fix ?? false);
      }
      case "lint":
        return code.codeLinter(project, { path: input.file, fix: input.fix, product: input.product, config_path: input.config_path, incremental: input.incremental, output_path: input.output_path }, ctx.signal);
      case "api_scan":
        invariant(!(input.files?.length && input.modules?.length), "INVALID_INPUT", "Pass files or modules, not both");
        return code.apiScan(project, { from: input.from, to: input.to, files: input.files, modules: input.modules, output_path: input.output_path }, ctx.signal);
      case "lsp_restart":
        if (input.resync) {
          invariant(!input.product || input.language === "arkts", "INVALID_INPUT", "product is supported only for ArkTS resync");
          return startAndWait("lsp_resync", { project, language: input.language ?? "all", product: input.product }, undefined, input.wait);
        }
        invariant(input.wait === undefined && input.product === undefined, "INVALID_INPUT", "wait and product require resync=true");
        return code.restartLsp(project, input.language ?? "all");
      case "lsp":
        {
          const op = lspOperations.find((operation) => operation === input.op);
          invariant(op, "INVALID_INPUT", "Pass an LSP operation");
          return code.lsp({ project, product: input.product, action: op, file: input.file, files: input.files, symbol: input.symbol, line: input.line, column: input.column, query: input.query, language: input.language === "all" ? undefined : input.language, limit: input.limit, direction: input.direction }, ctx.signal);
        }
    }
  },
});

export const deviceTool = tool({
  name: "device",
  title: "Devices/logs/files",
  description: "list/info: devices. action=log: HiLog; shell: read-only. action=sqlite: write=true to mutate; databases: RDBs; fixture: owned table. scenario: testing; trace: hitrace. app/file/font/clipboard/screen/system: operation. send/recv: files. location: coordinates/GPX. network_sim: preset or limits; stop restores owned state. playback: session_id/bundle; seek in seconds.",
  schema: z.object({
    action: z.enum(["list", "info", "log", "shell", "sqlite", "send", "recv", "databases", "scenario", "fixture", "trace", "app", "file", "clipboard", "screen", "system", "font", "location", "network_sim", "playback"]),
    operation: z.enum(["background", "clear_data", "grant", "revoke", "prepare", "inspect", "cleanup", "list", "info", "foreground", "start", "stop", "uninstall", "install", "clear_cache", "exists", "delete", "read", "write", "clear", "size", "rotation", "rotate", "rotation_lock", "sleeptime", "viewmode", "wake", "sleep", "status", "time", "timezone", "unlock", "control_center", "notification_center", "set", "enable", "disable", "play", "pause", "next", "previous", "forward", "rewind", "seek"]).optional(),
    ability: z.string().optional(),
    want: z.object({ uri: z.string().max(4096).optional(), action: z.string().max(256).optional(), parameters: z.record(z.string(), z.union([z.string().max(4096), z.number().int(), z.boolean()])).optional() }).strict().optional(),
    files: z.array(z.string()).min(1).max(64).optional().describe("Install: absolute HAP/HSP paths"),
    replace: z.boolean().optional().describe("app install: default true"),
    user: z.number().int().min(0).optional().describe("app install: OS user ID"),
    install_timeout: z.number().int().min(180).max(600).optional().describe("bm wait seconds"),
    text: z.string().max(16384).optional().describe("clipboard write"),
    latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
    altitude: z.number().min(-10000).max(10000).optional(), speed: z.number().min(0).optional(), bearing: z.number().min(0).max(360).optional(),
    interval: z.number().int().min(1).max(3600).optional().describe("location update interval in seconds"),
    scenario_id: z.number().int().min(1).max(8).optional().describe("network_sim: preset ID"),
    up_bandwidth: z.number().positive().optional(), down_bandwidth: z.number().positive().optional(),
    up_latency: z.number().int().min(0).optional(), down_latency: z.number().int().min(0).optional(),
    up_drop: z.number().min(0).max(1).optional(), down_drop: z.number().min(0).max(1).optional(),
    session_id: z.string().min(1).max(256).optional(), position_seconds: z.number().min(0).max(Number.MAX_SAFE_INTEGER / 1000).optional(),
    value: z.union([z.string().max(256), z.number().int(), z.boolean()]).optional().describe("Value to set; omit to query"),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    wait: fields.wait,
    request_key: fields.requestKey,
    permission: z.string().optional(),
    allow_data_reset: z.boolean().optional(),
    fixture_id: z.string().optional(),
    rows: z.array(z.record(z.string(), z.string())).min(1).max(500).optional(),
    seconds: z.number().int().min(1).max(30).optional(),
    categories: z.array(z.string()).min(1).max(10).optional(),
    db: z.string().optional().describe("sqlite: absolute device path or RDB name (app.db) + debuggable bundle"),
    module: z.string().optional().describe("sqlite db name: required owning module from module.json5 (entry/default)"),
    sql: z.string().max(20000).optional().describe("sqlite: SQL or .tables/.schema"),
    write: z.boolean().optional().describe("sqlite: allow modifying statements"),
    target: fields.target,
    bundle: z.string().optional().describe("log: app process; sqlite: debuggable app owning db"),
    grep: z.string().optional().describe("log: regex filter"),
    level: z.enum(["D", "I", "W", "E", "F"]).optional().describe("log: minimum level"),
    lines: z.number().int().min(1).max(20000).optional(),
    clear: z.boolean().optional(),
    from: z.string().optional().describe("log: start age, e.g. 5m/30s/1h; no 'ago'"),
    to: z.string().optional().describe("log: end age, e.g. 1m; omit for now"),
    follow: z.boolean().optional().describe("log: newer than cursor; await wait_ms; returns next cursor"),
    cursor: z.string().optional().describe("log follow: previous cursor (omit initially)"),
    wait_ms: z.number().int().min(0).max(30000).optional().describe("log follow: max wait for new lines (default 5000)"),
    command: z.string().optional().describe("shell: read-only command line"),
    name: z.string().max(256).optional().describe("font uninstall: installed font name"),
    local: z.string().optional(),
    remote: z.string().optional(),
    project: z.string().optional().describe("log: project root for error source files/lines/code"),
  }),
  params: {
    list: [], info: ["target"],
    app: ["target", "operation", "bundle", "ability", "module", "want", "allow_data_reset", "files", "replace", "user", "install_timeout", "offset", "limit", "wait", "request_key"],
    font: ["target", "operation", "local", "name"],
    location: ["target", "operation", "local", "latitude", "longitude", "altitude", "speed", "bearing", "interval"],
    network_sim: ["target", "operation", "scenario_id", "name", "up_bandwidth", "down_bandwidth", "up_latency", "down_latency", "up_drop", "down_drop"],
    playback: ["target", "operation", "session_id", "bundle", "position_seconds"],
    file: ["target", "operation", "remote"], clipboard: ["target", "operation", "text"],
    screen: ["target", "operation", "value"], system: ["target", "operation", "value"],
    databases: ["target", "bundle", "module"], scenario: ["target", "operation", "bundle", "permission", "allow_data_reset"],
    fixture: ["target", "operation", "db", "bundle", "module", "fixture_id", "rows"], trace: ["target", "seconds", "categories"],
    log: ["target", "bundle", "grep", "level", "lines", "clear", "from", "to", "follow", "cursor", "wait_ms", "project"],
    shell: ["target", "command"], sqlite: ["target", "db", "module", "sql", "write", "bundle", "lines"],
    send: ["target", "local", "remote"], recv: ["target", "local", "remote"],
  },
  async handler(input, ctx) {
    const device = await import("../domains/device.js");
    if (["app", "file", "clipboard", "screen", "system", "font", "location", "network_sim", "playback"].includes(input.action)) {
      const controls = await import("../domains/device-controls.js");
      controls.validateControl(input);
      if (input.action === "app" && input.operation === "install") {
        device.validatePackages(input.files ?? [], { install_timeout: input.install_timeout });
        return startAndWait("device_install", input, input.request_key, input.wait);
      }
      const target = await device.resolveTarget(input.target, ctx.signal);
      switch (input.action) {
        case "app": return controls.appControl(target, { ...input, operation: input.operation! }, ctx.signal);
        case "font": return controls.fontControl(target, { operation: input.operation!, local: input.local, name: input.name }, ctx.signal);
        case "location": return (await import("../domains/device-media-location.js")).locationMock(target, input, ctx.signal);
        case "playback": return (await import("../domains/device-media-location.js")).playback(target, input, ctx.signal);
        case "network_sim": return (await import("../domains/network-simulation.js")).networkSimulation(target, input, ctx.signal);
        case "file": return controls.deviceFile(target, input.operation!, input.remote!, ctx.signal);
        case "clipboard": return controls.clipboard(target, input.operation!, input.text, ctx.signal);
        case "screen": return controls.screenControl(target, input.operation!, input.value, ctx.signal);
        case "system": return controls.systemControl(target, input.operation!, input.value as string | undefined, ctx.signal);
      }
    }
    if (input.action === "list") {
      const targets = await device.listTargets(ctx.signal);
      return { devices: await Promise.all(targets.map((t) => device.deviceInfo(t, ctx.signal).catch(() => ({ target: t })))) };
    }
    if (input.action === "shell") {
      invariant(input.command, "INVALID_INPUT", "command is required");
      device.readonlyShellArgs(input.command);
    }
    if (input.action === "sqlite") {
      invariant(input.db && input.sql, "INVALID_INPUT", "db and sql are required");
      if (!input.db.startsWith("/") && input.db !== ":memory:") {
        invariant(input.bundle, "INVALID_INPUT", "A relative db name needs bundle");
        device.appDatabasePath(input.bundle, input.db, input.module);
      }
    }
    const target = await device.resolveTarget(input.target, ctx.signal);
    switch (input.action) {
      case "info": return device.deviceInfo(target, ctx.signal);
      case "log": {
        if (input.clear) return device.clearLog(target, ctx.signal);
        const log = await device.hilog(target, { lines: input.lines, bundle: input.bundle, grep: input.grep, level: input.level, from: input.from, to: input.to, follow: input.follow, cursor: input.cursor, wait_ms: input.wait_ms }, ctx.signal);
        if (!input.project || !log.errors.length) return log;
        const { projectModel } = await import("../domains/diagnose.js");
        const { locate } = await import("../domains/sourcemap.js");
        const source = locate(log.errors.join("\n"), await projectModel(input.project));
        return source.length ? { ...log, source } : log;
      }
      case "shell": invariant(input.command, "INVALID_INPUT", "command is required"); return device.readonlyShell(target, input.command, ctx.signal);
      case "databases": { invariant(input.bundle, "INVALID_INPUT", "bundle required"); return (await import("../domains/scenario.js")).databases(target, input.bundle, input.module, ctx.signal); }
      case "scenario": {
        invariant(input.operation && ["background", "clear_data", "grant", "revoke"].includes(input.operation), "INVALID_INPUT", "scenario operation must be background|clear_data|grant|revoke");
        return (await import("../domains/scenario.js")).systemScenario(target, { ...input, operation: input.operation as "background" | "clear_data" | "grant" | "revoke" }, ctx.signal);
      }
      case "fixture": {
        invariant(input.operation && ["prepare", "inspect", "cleanup"].includes(input.operation), "INVALID_INPUT", "fixture operation must be prepare|inspect|cleanup");
        return (await import("../domains/scenario.js")).fixture(target, { ...input, operation: input.operation as "prepare" | "inspect" | "cleanup" }, ctx.signal);
      }
      case "trace": return (await import("../domains/scenario.js")).captureTrace(target, input.seconds ?? 5, input.categories ?? ["ace", "app", "sched"], ctx.signal);
      case "sqlite": {
        invariant(input.db && input.sql, "INVALID_INPUT", "db and sql are required");
        const db = input.db.startsWith("/") || input.db === ":memory:" ? input.db
          : (invariant(input.bundle, "INVALID_INPUT", "A relative db name needs bundle"), device.appDatabasePath(input.bundle!, input.db, input.module));
        return { db, ...(await device.sqlite(target, db, input.sql, { write: input.write, limit: input.lines }, ctx.signal)) };
      }
      case "send": invariant(input.local && input.remote, "INVALID_INPUT", "local and remote are required"); return device.sendFile(target, input.local, input.remote, ctx.signal);
      case "recv": invariant(input.local && input.remote, "INVALID_INPUT", "local and remote are required"); return device.recvFile(target, input.remote, input.local, ctx.signal);
    }
  },
});

export const uiTool = tool({
  name: "ui",
  title: "Device UI",
  description: [
    "observe: screenshot+elements; tree/find/windows; displays: screenshot IDs.",
    "selector/visible/hidden: objects, e.g. {\"text\":\"Hi\"}. XPath/regex intersect filters.",
    "act: swipe/drag to=end; scroll_find to=selector; pinch touch.scale; rotate touch.degrees; keys=chord; long_click duration_ms.",
    "act after={changed,kind,added,removed}: app's on-screen elements; no extra observe.",
    "act steps=[...]: waits for each element, stops at first failure. Resume at stopped_at.",
    "assert: visible OR hidden, not screenshots alone.",
    "Accept consent (agreements_accepted) and setup preserving defaults (onboarding_completed) by window text/control state, never app names/fixed IDs. If still blocked, observe; never blindly repeat.",
    "visual: reference_image vs candidate_image offline. wait/request_key: layout forms and form. perf: scroll smoothness/jank.",
    "MP4: record_start/record_stop/record_status. record_receipts/record_archive/record_restore offline.",
    "test_start(plan) -> test_step(test_id, op/selector or visible/hidden) -> review(test_id+requirement) captures an image; inspect it before review(test_id+review_id+outcome+reason) -> test_finish -> test_log/test_export. Omit outcome/review_id on capture. checklist_item links coverage; missing coverage=inconclusive.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["observe", "screenshot", "tree", "find", "act", "assert", "windows", "displays", "perf", "visual", "layout", "record_start", "record_stop", "record_status", "record_receipts", "record_archive", "record_restore",
      "test_start", "test_step", "review", "test_finish", "test_log", "test_export", "form"]),
    form_action: z.enum(["inventory", "catalog", "exercise", "matrix"]).optional().describe("exercise: owned instance; matrix: form_cases"),
    form_index: z.number().int().min(0).max(99).optional(),
    max_pages: z.number().int().min(1).max(30).optional(),
    form_cases: z.array(z.object({ target: z.string().min(1).optional(),
      emulator: z.object({ device_type: z.string().min(1), os_version: z.string().min(1) }).strict().optional(),
      form_index: z.number().int().min(0).max(99),
    }).strict().refine((v) => !!v.target !== !!v.emulator, "Each case requires exactly one target or emulator")).min(1).max(20).optional(),
    target: fields.target,
    product: fields.product,
    window: z.number().int().optional().describe("Window ID; act: click/clear_text/swipe/drag"),
    all_windows: z.boolean().optional().describe("All displays; excludes window"),
    node: z.string().optional().describe("Tree subtree id/key"),
    display: z.number().int().optional().describe("UI display ID"),
    save_path: z.string().optional().describe("screenshot/record_stop: absolute copy; automatically deleted after 24h"),
    depth: z.number().int().min(0).max(100).optional().describe("0 all, 1 root"),
    all: z.boolean().optional().describe("windows: system windows; displays: screen id, Hz, VPR, rotation"),
    discard: z.boolean().optional().describe("record_stop: skip download"),
    external: z.boolean().optional().describe("record_stop: foreign recording"),
    receipt_id: z.string().optional(),
    test_id: z.string().optional().describe("test_step/review: stored session target; conflicting target rejected; test_finish/test_log/test_export need no device"),
    plan: z.string().max(20000).optional().describe("test_start: steps + expected results"),
    project: z.string().optional(),
    fresh_start: z.boolean().optional().describe("test_start: restart app; requires project"),
    checklist_item: z.number().int().min(1).max(50).optional().describe("Required for multi-item plans"),
    description: z.string().max(500).optional(),
    requirement: z.string().max(2000).optional(),
    outcome: z.enum(["passed", "failed", "insufficient"]).optional().describe("review: judge only after seeing the image; omit on capture"),
    reason: z.string().max(2000).optional(),
    review_id: z.number().int().optional().describe("returned image id; never invent"),
    directory: z.string().optional().describe("test_export: absolute path"),
    max_chars: z.number().int().min(-1).optional().describe("-1 unlimited, default 5000"),
    grep: z.string().optional().describe("Log regex"),
    offset: z.number().int().min(0).optional(),
    selector: selectorSchema.optional(),
    to: selectorSchema.optional(),
    touch: touchSchema.optional(),
    scroll_offset: z.number().int().min(0).optional().describe("scroll_find: edge offset px"),
    duration_ms: z.number().int().min(500).max(60000).optional(),
    op: uiOpSchema.optional(),
    keys: z.array(z.string()).min(1).max(3).optional().describe("Chord or mouse modifiers"),
    button: z.enum(["left", "right", "middle"]).optional(),
    ticks: z.number().int().min(1).max(50).optional(),
    verify_change: z.boolean().optional(),
    diff: z.boolean().optional(),
    steps: z.array(batchStepSchema).min(1).max(30).optional().describe("act: path instead of op; perf: swipe/fling/drag/scroll only"),
    assert: assertSchema.optional().describe("act steps: final check; test_step uses top-level visible/hidden, never assert"),
    save_flow: z.object({ project: z.string(), id: z.string(), name: z.string().optional() }).optional()
      .describe("act steps + assert: save ui_flow; start at launch screen"),
    x: z.number().int().optional(), y: z.number().int().optional(), x2: z.number().int().optional(), y2: z.number().int().optional(),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    text: z.string().optional(),
    uri: z.string().min(1).max(4096).optional().describe("test_step: registered custom URI"),
    append: z.boolean().optional().describe("Input: keep existing text"),
    key: z.string().optional().describe("Key name/code"),
    speed: z.number().int().min(200).max(40000).optional(),
    visible: selectorSchema.optional(),
    hidden: selectorSchema.optional(),
    timeout_ms: z.number().int().min(1).max(3600000).optional(),
    interactive: z.boolean().optional().describe("Default: labelled/interactive"),
    bundle: z.string().optional(),
    format: z.enum(["jpeg", "png"]).optional(),
    width: z.number().int().min(240).max(2560).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
    repeat: z.number().int().min(1).max(20).optional().describe("Perf: fling pairs (3)"),
    name: z.string().optional().describe("Baseline or recording"),
    reference_image: z.string().min(1).optional(),
    candidate_image: z.string().min(1).optional(),
    score_script: z.string().min(1).optional().describe("Offline color/structure score: pinned ui_score.py, Python + Pillow"),
    update: z.boolean().optional().describe("Replace baseline"),
    context: z.string().max(256).optional().describe("Scene/theme/locale"),
    require_baseline: z.boolean().optional(),
    min_target_vp: z.number().min(1).max(100).optional(),
    strict_targets: z.boolean().optional().describe("Fail tiny targets"),
    threshold: z.number().int().min(1).max(64).optional(),
    forms: z.array(z.enum(["foldable", "widefold", "triplefold"])).min(1).max(3).optional(),
    then_flow: z.string().optional().describe("Flow without required variables; form needs attach"),
    keep_running: z.boolean().optional().describe("Keep form emulators"),
    request_key: fields.requestKey,
    wait: fields.wait,
  }).superRefine((input, ctx) => {
    if (input.visible && input.hidden) ctx.addIssue({ code: "custom", message: "Pass exactly one visible or hidden selector" });
    if (input.action === "act" && !input.steps && (input.assert || input.save_flow)) ctx.addIssue({ code: "custom", message: "assert/save_flow require steps; use a one-step array for one action plus assertion" });
    if (input.action !== "act" && input.timeout_ms !== undefined && (input.timeout_ms < 100 || input.timeout_ms > 120000))
      ctx.addIssue({ code: "custom", path: ["timeout_ms"], message: "UI selector timeout_ms must be in 100–120000" });
  }),
  params: (() => {
    const act = ["target", "op", "selector", "to", "touch", "scroll_offset", "duration_ms", "window", "display", "keys", "button", "ticks", "verify_change", "x", "y", "x2", "y2", "direction", "text", "append", "key", "speed"];
    return {
      act: [...act, "diff", "steps", "assert", "save_flow", "timeout_ms", "wait", "request_key"],
      observe: ["target", "window", "display", "depth", "interactive", "limit", "bundle", "format", "width"],
      form: ["target", "project", "product", "bundle", "form_action", "form_index", "max_pages", "form_cases", "then_flow", "wait", "request_key"],
      screenshot: ["target", "display", "save_path", "format", "width"],
      tree: ["target", "window", "display", "all_windows", "node", "depth", "interactive", "limit", "bundle"],
      find: ["target", "selector", "limit", "offset", "timeout_ms", "window", "display", "bundle"],
      assert: ["target", "visible", "hidden", "timeout_ms", "window", "display", "bundle"],
      windows: ["target", "all"],
      displays: ["target", "all"],
      perf: ["target", "steps", "repeat", "bundle"],
      visual: ["target", "project", "name", "update", "threshold", "require_baseline", "context", "reference_image", "candidate_image", "score_script"],
      layout: ["target", "project", "bundle", "forms", "then_flow", "keep_running", "min_target_vp", "strict_targets", "request_key", "wait"],
      record_start: ["target"], record_status: ["target"], record_stop: ["target", "discard", "external", "save_path"],
      record_receipts: ["target"], record_archive: ["target", "name", "reason"], record_restore: ["receipt_id"],
      test_start: ["target", "plan", "project", "bundle", "fresh_start"],
      test_step: [...act, "test_id", "checklist_item", "description", "uri", "visible", "hidden", "timeout_ms"],
      review: ["target", "test_id", "checklist_item", "requirement", "outcome", "reason", "review_id"],
      test_finish: ["target", "test_id"], test_log: ["target", "test_id", "grep", "max_chars"], test_export: ["target", "test_id", "directory"],
    };
  })(),
  async handler(input, ctx) {
    // Validate queries before automatic UI interactions or any explicit action.
    const { validateSelector } = await import("../domains/ui-query.js");
    for (const selector of [input.selector, input.to, input.visible, input.hidden, input.assert?.visible, input.assert?.hidden, ...(input.steps?.flatMap((step) => [step.selector, step.to]) ?? [])])
      if (selector) validateSelector(selector);
    // Domain callers also use this handler without the MCP schema boundary.
    invariant(!(input.visible && input.hidden), "INVALID_INPUT", "Pass exactly one visible or hidden selector");
    invariant(input.scroll_offset === undefined || input.op === "scroll_find", "INVALID_INPUT", "Use scroll_offset on a scroll_find operation");
    invariant(input.duration_ms === undefined || input.op === "long_click", "INVALID_INPUT", "Use duration_ms on a long_click operation");
    if (input.timeout_ms !== undefined && input.action === "act") invariant(!input.steps && ["scroll_start", "scroll_end", "scroll_find"].includes(input.op ?? ""),
      "INVALID_INPUT", "Use a top-level act timeout_ms with scroll_start, scroll_end or scroll_find");
    if (input.window !== undefined && (input.action === "act" || input.action === "test_step"))
      invariant(input.op && !input.steps && ["click", "clear_text", "swipe", "drag"].includes(input.op), "INVALID_INPUT", "A window-scoped action needs a single click, clear_text, swipe or drag operation");
    if (input.display !== undefined && (input.action === "act" || input.action === "test_step"))
      invariant(input.window !== undefined, "INVALID_INPUT", "Input on a named display requires a window on that display");
    if (input.action === "act" && !input.steps) invariant(!input.assert && !input.save_flow, "INVALID_INPUT", "assert/save_flow require steps; use a one-step array for one action plus assertion");
    if (input.action === "form") {
      invariant(input.form_action, "INVALID_INPUT", "form_action is required");
      if (input.form_action === "matrix") {
        invariant(input.form_cases && !input.target && input.form_index === undefined, "INVALID_INPUT", "matrix requires form_cases; place target/form_index inside each case");
        invariant(input.project || input.form_cases.every((c) => !c.emulator), "INVALID_INPUT", "Disposable emulator cases require a project to build and deploy");
      } else {
        invariant(!input.form_cases, "INVALID_INPUT", "form_cases is used only by matrix");
        invariant(input.form_action === "exercise" || input.form_index === undefined, "INVALID_INPUT", "form_index is used only by exercise");
      }
      if (input.form_action !== "inventory") (await import("../domains/forms.js")).formContext({ ...input, target: input.target ?? "" });
      if (input.then_flow) {
        invariant(input.project && ["exercise", "matrix"].includes(input.form_action), "INVALID_INPUT", "then_flow requires a project and exercise/matrix");
        const flow = (await import("../domains/flows.js")).readFlow(input.project, input.then_flow);
        invariant(flow.start.mode === "attach" && !Object.values(flow.variables).some((v) => v.required), "INVALID_INPUT", "Card flows must attach to the current host and require no variables");
        invariant(flow.assert?.visible || flow.assert?.hidden || flow.steps.some((step) => ["assertVisible", "assertHidden"].includes(step.action) && step.selector),
          "INVALID_INPUT", "Card flows require an explicit visible/hidden assertion; actions alone cannot verify content");
      }
      const kind = input.form_action === "exercise" ? "form_check" : input.form_action === "matrix" ? "form_matrix" : "form_inventory";
      const { wait, request_key, ...jobInput } = input;
      return startAndWait(kind, jobInput, request_key, wait ?? 1500);
    }
    if (input.action === "visual" && input.score_script !== undefined) invariant(input.candidate_image && input.reference_image, "INVALID_INPUT", "score_script needs two local PNGs");
    if (input.action === "visual" && input.candidate_image !== undefined) {
      invariant(input.reference_image && input.target === undefined && input.name === undefined && input.update === undefined && input.require_baseline === undefined,
        "INVALID_INPUT", "Offline visual comparison requires reference_image and candidate_image with no device or baseline fields");
      return (await import("../domains/visual.js")).visualFiles(input.reference_image, input.candidate_image, input, ctx.signal);
    }
    const { resolveTarget } = await import("../domains/device.js");
    const ui = await import("../domains/ui.js");
    const uitest = () => import("../domains/uitest.js");
    if (input.action === "record_receipts") return ui.recordingReceipts(input.target);
    if (input.action === "record_archive") {
      invariant(input.target && input.name, "INVALID_INPUT", "record_archive needs literal target and exact pending filename in name");
      return ui.archiveRecording(input.target, input.name, input.reason);
    }
    if (input.action === "record_restore") {
      invariant(input.receipt_id, "INVALID_INPUT", "record_restore needs receipt_id");
      return ui.restoreRecording(input.receipt_id);
    }
    // Test log/finish/export work from stored state and must not require a connected device.
    if (input.action === "test_log" || input.action === "test_finish" || input.action === "test_export") {
      invariant(input.test_id, "INVALID_INPUT", "test_id is required");
      const t = await uitest();
      if (input.action === "test_finish") return t.finishTest(input.test_id);
      if (input.action === "test_log") return t.testLog(input.test_id, { grep: input.grep, max_chars: input.max_chars }, ctx.signal);
      invariant(input.directory, "INVALID_INPUT", "directory is required");
      return t.exportTest(input.test_id, input.directory);
    }
    if (input.action === "layout" && input.forms) {
      invariant(input.project, "INVALID_INPUT", "layout forms needs project");
      invariant(input.target === undefined && input.bundle === undefined, "INVALID_INPUT", "layout forms selects its own emulators and project bundle; target/bundle are not applicable");
      return startAndWait("layout_check", { project: input.project, forms: input.forms, then_flow: input.then_flow, keep_running: input.keep_running, min_target_vp: input.min_target_vp, strict_targets: input.strict_targets }, input.request_key, input.wait ?? 3000);
    }
    let projectTypes: string[] | undefined;
    if (input.action === "test_start" && input.project && !input.target) {
      const { inspectProject, runnableDeviceTypes } = await import("../domains/project.js");
      try { projectTypes = runnableDeviceTypes(inspectProject(input.project)); } catch { /* reported by test_start below */ }
    }
    const target = await resolveTarget(input.target, ctx.signal, projectTypes);
    const scope = { window: input.window, bundle: input.bundle, display: input.display };
    const inputDisplay = async () => {
      if (input.window === undefined) return undefined;
      const { display } = await ui.requireActionWindow(target, input.window, ctx.signal, { allowUnfocused: true, display: input.display });
      return display;
    };
    switch (input.action) {
      case "windows": return { windows: await ui.listWindows(target, input.all, ctx.signal) };
      case "displays": return (await import("../domains/displays.js")).listDisplays(target, input.all ?? false, ctx.signal);
      case "layout": {
        const { checkLayout } = await import("../domains/layout.js");
        const { deviceInfo, shell } = await import("../domains/device.js");
        const [nodes, info, dms] = await Promise.all([ui.dumpTree(target, ctx.signal), deviceInfo(target, ctx.signal),
          shell(target, ["hidumper", "-s", "DisplayManagerService", "-a", "-a"], ctx.signal, 10000).catch(() => undefined)]);
        const density = Number(/VirtualPixelRatio:\s*([\d.]+)/.exec(dms?.stdout ?? "")?.[1]) || undefined;
        const win = (await ui.listWindows(target, false, ctx.signal).catch(() => [])).find((w) => w.focused && w.bounds);
        const size = win?.bounds ? { w: win.bounds[2]!, h: win.bounds[3]! } : info.screen ? { w: info.screen.width, h: info.screen.height } : { w: 1080, h: 2400 };
        const bundle = input.bundle ?? nodes.find((n) => n.bundle && !/systemui|sceneboard|launcher/.test(n.bundle) && n.text)?.bundle ?? undefined;
        return { window: `${size.w}x${size.h}`, ...(bundle ? { bundle } : {}), ...checkLayout(nodes, size, { bundle, density, min_target_vp: input.min_target_vp, strict_targets: input.strict_targets }) };
      }
      case "visual": {
        invariant(input.reference_image ? input.name === undefined && input.update === undefined && input.require_baseline === undefined : input.project && input.name,
          "INVALID_INPUT", "Visual needs reference_image or project and baseline name");
        const { visualCheck, visualReference } = await import("../domains/visual.js");
        const { deviceInfo } = await import("../domains/device.js");
        const info = await deviceInfo(target, ctx.signal);
        const size = info.screen ? { w: info.screen.width, h: info.screen.height } : undefined;
        if (input.reference_image) return visualReference(target, input.reference_image, size, input, ctx.signal);
        return visualCheck(target, { project: input.project!, name: input.name!, update: input.update, threshold: input.threshold, require_baseline: input.require_baseline, context: input.context },
          { model: info.model ?? info.name ?? target, os: info.os, api: info.api_level, size }, ctx.signal);
      }
      case "perf": {
        const { measureScroll } = await import("../domains/perf.js");
        const { stepAction } = await import("../domains/uibatch.js");
        const { deviceInfo } = await import("../domains/device.js");
        const gestures = input.steps?.map((s) => {
          invariant(["swipe", "fling", "drag", "scroll"].includes(s.op), "INVALID_INPUT", `perf steps take gestures (swipe/fling/drag/scroll), not ${s.op}`);
          invariant(!s.to && (!s.selector || s.op === "scroll"), "INVALID_INPUT", "perf swipe/fling/drag require coordinates; scroll accepts selector");
          return stepAction(s);
        });
        const screen = await screenSize(target, deviceInfo, ctx.signal).catch(() => undefined);
        return measureScroll(target, { gestures, repeat: input.repeat, bundle: input.bundle, screen }, ctx.signal);
      }
      case "record_start": return ui.startRecording(target, ctx.signal);
      case "record_stop": return ui.stopRecording(target, { discard: input.discard, external: input.external, save_path: input.save_path }, ctx.signal);
      case "record_status": return ui.recordingStatus(target, ctx.signal);
      case "test_start": {
        invariant(input.plan, "INVALID_INPUT", "plan is required");
        let bundle = input.bundle, ability: string | undefined, module: string | undefined;
        if (input.project) {
          const { inspectProject, mainAbility } = await import("../domains/project.js");
          const project = inspectProject(input.project);
          bundle ??= project.bundleName;
          ({ ability, module } = mainAbility(project));
        }
        return (await uitest()).startTest(target, { plan: input.plan, bundle, ability, module, fresh_start: input.fresh_start }, ctx.signal);
      }
      case "test_step": {
        invariant(input.test_id, "INVALID_INPUT", "test_id is required");
        invariant(!input.uri || !input.op, "INVALID_INPUT", "Pass URI or op");
        if (input.duration_ms !== undefined) invariant(input.duration_ms <= (await import("../domains/uibatch.js")).SYNC_HOLD_MS,
          "INVALID_INPUT", "Use a single ui act for a long press exceeding 30000 ms");
        if (input.op) (await import("../domains/uibatch.js")).validateBatchSteps([{ ...input, op: input.op }]);
        const display = await inputDisplay();
        const consent = input.op ? await ui.acceptAgreements(target, ctx.signal, undefined, 0, display) : undefined;
        const action = input.op ? await buildAction({ ...input, display, timeout_ms: undefined }, target, ui, ctx.signal) : undefined;
        const assert = input.visible || input.hidden ? { visible: input.visible, hidden: input.hidden, timeout_ms: input.timeout_ms } : undefined;
        return (await uitest()).testStep(input.test_id, { checklist_item: input.checklist_item, description: input.description, uri: input.uri, action: action?.action, selector: input.selector, automatic: consent?.accepted, assert, scope: { window: input.window, display } }, ctx.signal);
      }
      case "review": {
        invariant(input.test_id, "INVALID_INPUT", "test_id is required");
        return (await uitest()).review(input.test_id, { checklist_item: input.checklist_item, requirement: input.requirement, outcome: input.outcome, reason: input.reason, review_id: input.review_id }, ctx.signal);
      }
      case "screenshot": {
        const shot = await ui.screenshot(target, { format: input.format, width: input.width, display: input.display, save_path: input.save_path }, ctx.signal);
        return { artifact_id: shot.artifact_id, bytes: shot.bytes, ...(shot.saved ? { saved: shot.saved } : {}), _image: { data: shot.data, mime: shot.mime } };
      }
      case "tree": {
        const all = await ui.dumpTree(target, ctx.signal, 0, { ...scope, all_windows: input.all_windows });
        const nodes = input.node ? ui.subtree(all, input.node) : all;
        if (input.node && !nodes.length) return { nodes: 0, tree: "", hint: `No component with id/key ${input.node}; call ui tree to list ids` };
        return { nodes: nodes.length, ...ui.compactTree(nodes, { interactive: input.interactive ?? true, limit: input.limit, bundle: input.bundle, depth: input.depth }) };
      }
      case "observe": {
        const [nodes, shot] = await Promise.all([ui.dumpTree(target, ctx.signal, 0, scope), ui.screenshot(target, { format: input.format, width: input.width, display: input.display }, ctx.signal)]);
        const { tree, ...summary } = ui.compactTree(nodes, { interactive: input.interactive ?? true, limit: input.limit ?? 200, bundle: input.bundle, depth: input.depth });
        return { elements: tree, nodes: nodes.length, ...summary, screenshot: shot.artifact_id, _image: { data: shot.data, mime: shot.mime } };
      }
      case "find": {
        invariant(input.selector, "INVALID_INPUT", "selector is required");
        return ui.findElements(target, input.selector, input, ctx.signal);
      }
      case "assert": {
        invariant(input.visible || input.hidden, "INVALID_INPUT", "Pass visible or hidden selector");
        const verdict = await ui.waitFor(target, (input.visible ?? input.hidden)!, input.visible ? "visible" : "hidden", input.timeout_ms ?? 5000, ctx.signal, false, scope);
        return verdict.passed || "hint" in verdict ? verdict : { ...verdict, hint: "Not satisfied: call ui observe to inspect the screen" };
      }
      case "act": {
        invariant(input.op || input.steps, "INVALID_INPUT", "Pass op or steps");
        invariant(!(input.op && input.steps), "INVALID_INPUT", "Pass either op (one action) or steps (several), not both");
        invariant(!input.save_flow || input.assert, "INVALID_INPUT", "save_flow needs an assert that proves the goal was reached");
        const batch = await import("../domains/uibatch.js");
        if (input.op) batch.validateBatchSteps([{ ...input, op: input.op }]);
        if (input.steps) batch.validateBatchSteps(input.steps);
        const queued = batch.uiActionJob(input);
        invariant(queued || input.wait === undefined && input.request_key === undefined, "INVALID_INPUT", "wait and request_key on act require timed long_click or native scroll");
        if (queued && !ctx.fromJob) {
          const { wait, request_key, ...jobInput } = input;
          return startAndWait(queued, { ...jobInput, target }, request_key, wait);
        }
        const display = await inputDisplay();
        const consent = await ui.acceptAgreements(target, ctx.signal, undefined, 0, display);
        const { deviceInfo } = await import("../domains/device.js");
        const flows = await import("../domains/flows.js");
        if (input.steps) {
          const result = await batch.runBatch(target, input.steps, { assert: input.assert, budgetMs: SYNC_WAIT_MS }, ctx.signal);
          const screen = await screenSize(target, deviceInfo, ctx.signal).catch(() => undefined);
          // An active ui_flow recording captures batch steps too.
          for (const e of result.executed) await flows.recordStep(target, e.action, e.selector, screen).catch(() => undefined);
          let saved: unknown;
          if (result.passed && input.save_flow) {
            const { inspectProject, mainAbility } = await import("../domains/project.js");
            const project = inspectProject(input.save_flow.project);
            invariant(project.bundleName, "PROJECT_INVALID", "bundleName missing");
            const main = mainAbility(project);
            saved = flows.saveExecutedFlow(input.save_flow.project, input.save_flow.id, input.save_flow.name ?? input.save_flow.id,
              { bundleName: project.bundleName, module: main.module, ability: main.ability }, result.executed, input.assert!, screen);
          }
          const { executed: _e, ...rest } = result;
          const repeat = saved ? undefined : repeatHint(target, result.executed);
          return {
            ...rest, ...ui.automaticResult(consent.accepted, result), ...(saved ? { saved_flow: saved } : {}), ...(repeat ? { suggest: repeat } : {}),
            ...(!result.passed ? { hint: result.error?.code === "UI_OBSERVATION_FAILED" ? "Actions were sent but observation failed; inspect the UI before repeating any action"
              : result.stopped_at !== undefined ? `Time budget of one call used up: call again with steps from index ${result.stopped_at}`
              : result.failed_step !== undefined ? "Fix the failing step using the visible list, then call again with the remaining steps" : "The final assert failed: check after/visible" } : {}),
          };
        }
        const { action, resolved } = await buildAction({ ...input, display }, target, ui, ctx.signal);
        const wantDiff = input.diff !== false;
        // "before" costs no extra dump in the common cases: a selector was just resolved on a fresh tree,
        // or the previous act left its "after" tree in the cache (every act invalidates the cache first,
        // so a cached tree is the last screen this server observed). verify_change needs a fresh one.
        const before = wantDiff || input.verify_change ? await ui.dumpTree(target, ctx.signal, input.verify_change ? 1500 : 30000, { window: input.window, display }).catch(() => undefined) : undefined;
        const acted = Date.now();
        const result = await ui.act(target, action, ctx.signal);
        let after: ReturnType<typeof batch.screenDiff> | undefined;
        if (before) {
          // One dump after a short settle (skipped when the action itself took long, e.g. a fling);
          // verify_change keeps polling (up to 3 s) for slow transitions.
          const deadline = Date.now() + (input.verify_change ? 3000 : 0);
          if (Date.now() - acted < 1000) await new Promise((r) => setTimeout(r, 400));
          for (;;) {
            const observed = await ui.dumpTree(target, ctx.signal, 0, { window: input.window, display }).catch(() => undefined);
            if (!observed) break;
            const post = await ui.acceptAgreements(target, ctx.signal, observed, 0, display);
            consent.accepted.push(...post.accepted);
            const nodes = post.nodes ?? observed;
            after = batch.screenDiff(before, nodes);
            if (after.changed || Date.now() >= deadline) break;
            await new Promise((r) => setTimeout(r, 300));
          }
        }
        const recorded = await flows.recordStep(target, action, input.selector, await screenSize(target, deviceInfo, ctx.signal).catch(() => undefined)).catch(() => undefined);
        const repeat = recorded ? undefined : repeatHint(target, [{ action, selector: input.selector }]);
        return {
          ...result, ...ui.automaticResult(consent.accepted, result), ...(resolved ? { element: resolved } : {}), ...(recorded ?? {}), ...(repeat ? { suggest: repeat } : {}),
          ...(after && wantDiff ? { after } : {}),
          ...(after && input.verify_change ? { changed: after.changed, ...(!after.changed ? { hint: "Screen did not change: the target may be disabled, covered, or need a different gesture" } : {}) } : {}),
          ...(!after ? { note: "Action sent; verify with ui assert or observe" } : {}),
        };
      }
    }
  },
});

type UiInput = Omit<import("../domains/uibatch.js").BatchStep, "op"> & { op?: z.infer<typeof uiOpSchema>; window?: number; display?: number };

/** Resolve both gesture endpoints on the same layout snapshot. */
async function buildAction(input: UiInput, target: string, ui: typeof import("../domains/ui.js"), signal: AbortSignal) {
  invariant(input.op, "INVALID_INPUT", "op is required");
  const { needsPoint, stepAction } = await import("../domains/uibatch.js");
  const start = needsPoint.has(input.op) ? input.selector : undefined;
  let node: import("../domains/ui.js").UiNode | undefined, end: import("../domains/ui.js").UiNode | undefined;
  const finish = input.op === "scroll_find" ? undefined : input.to;
  if (finish || start && input.window !== undefined) {
    const nodes = await ui.dumpTree(target, signal, 0, { window: input.window, display: input.display });
    if (start) node = ui.requireMatch(ui.select(nodes, start), start);
    if (finish) end = ui.requireMatch(ui.select(nodes, finish), finish);
  } else if (start) node = await ui.resolveOne(target, start, signal);
  const action = stepAction({ ...input, op: input.op }, node && ui.center(node), end && ui.center(end));
  if (action.action === "click" || action.action === "clear_text" || action.action === "swipe" || action.action === "drag") action.window = input.window;
  if (action.action === "clear_text" && input.window !== undefined) action.selector = start;
  return { action, resolved: node && ui.describe(node) };
}

/**
 * Repeated-path hint: selector clicks extend the current path; any other action that moves through
 * the UI (coordinate taps, gestures, keys) breaks it. Text input and waits do not.
 */
function repeatHint(target: string, executed: { action: import("../domains/ui.js").Action; selector?: z.infer<typeof selectorSchema> }[]) {
  try {
    const taps = executed.flatMap((e) => (e.action.action === "click" ? [e.selector] : ["input", "clear_text", "type"].includes(e.action.action) ? [] : [undefined]));
    const { noteTaps, repeatSuggestion } = repeatModule;
    const path = noteTaps(target, taps);
    return path ? repeatSuggestion(path) : undefined;
  } catch {
    return undefined;
  }
}

const sizes = new Map<string, { w: number; h: number }>();
async function screenSize(target: string, info: (t: string, s?: AbortSignal) => Promise<{ screen?: { width: number; height: number } }>, signal: AbortSignal) {
  if (!sizes.has(target)) {
    const screen = (await info(target, signal)).screen;
    if (screen) sizes.set(target, { w: screen.width, h: screen.height });
  }
  return sizes.get(target);
}

export const uiFlowTool = tool({
  name: "ui_flow",
  title: "Reuse UI navigation flows",
  description: "Repeat a page visit or return after deploy: list(project), then show(project,id); check restart/attach mode and steps, supply required variables (e.g. input1). replay(project,target,id,variables) is a job; run then_flow replays after launch. Save via ui act steps+assert+save_flow, or record -> ui act -> stop(assert or discard=true). Files: <project>/.arkpilot/flows; delete(project,id). wait/request_key: replay only. repair=true promotes alternates; snapshot=true compares screens. Uses ui consent/setup handling; inspect blockers before retrying.",
  schema: z.object({
    action: z.enum(["list", "show", "record", "stop", "replay", "delete"]),
    project: fields.project,
    target: fields.target,
    id: z.string().optional().describe("Flow id: 1-64 lowercase letters/digits/-/_; alphanumeric ends"),
    name: z.string().optional(),
    variables: z.record(z.string(), z.string()).optional().describe("replay: ${var} values; saved inputs are required/secret by default"),
    assert: assertSchema.optional().describe("stop: final assert required to save"),
    discard: z.boolean().optional(),
    repair: z.boolean().optional(),
    snapshot: z.boolean().optional().describe("replay: final comparison; first saves baseline"),
    request_key: fields.requestKey,
    wait: fields.wait,
  }),
  params: {
    list: ["project"], show: ["project", "id"], delete: ["project", "id"],
    record: ["project", "target", "id", "name"], stop: ["project", "target", "assert", "discard"],
    replay: ["project", "target", "id", "variables", "repair", "snapshot", "request_key", "wait"],
  },
  async handler(input, ctx) {
    const flows = await import("../domains/flows.js");
    switch (input.action) {
      case "list": return { flows: flows.listFlows(input.project), drafts: await flows.listDrafts(input.project) };
      case "show": invariant(input.id, "INVALID_INPUT", "id is required"); return flows.showFlow(input.project, input.id);
      case "delete": {
        invariant(input.id, "INVALID_INPUT", "id is required");
        flows.readFlow(input.project, input.id);
        const fs = await import("node:fs");
        const path = await import("node:path");
        fs.rmSync(path.join(input.project, ".arkpilot/flows", `${input.id}.json`));
        return { deleted: input.id };
      }
      case "record": {
        invariant(input.id, "INVALID_INPUT", "id is required");
        const { inspectProject, mainAbility } = await import("../domains/project.js");
        const { resolveTarget } = await import("../domains/device.js");
        const project = inspectProject(input.project);
        invariant(project.bundleName, "PROJECT_INVALID", "bundleName missing");
        const main = mainAbility(project);
        const target = await resolveTarget(input.target, ctx.signal);
        return flows.startRecording(input.project, target, input.id, input.name ?? input.id, { bundleName: project.bundleName, module: main.module, ability: main.ability });
      }
      case "stop": {
        const { resolveTarget } = await import("../domains/device.js");
        let target = input.target;
        if (input.discard && !target) {
          const drafts = await flows.listDrafts(input.project);
          invariant(drafts.length === 1, drafts.length ? "DEVICE_AMBIGUOUS" : "NOT_FOUND", "Choose a draft target from ui_flow list", { drafts });
          target = drafts[0]!.target;
        }
        return flows.stopRecording(input.discard ? target! : await resolveTarget(target, ctx.signal), { project: input.project, assert: input.assert, discard: input.discard }, ctx.signal);
      }
      case "replay":
        invariant(input.id, "INVALID_INPUT", "id is required");
        return startAndWait("flow_replay", { project: input.project, target: input.target, id: input.id, variables: input.variables ?? {}, repair: input.repair ?? false, snapshot: input.snapshot ?? false }, input.request_key, input.wait ?? 5000);
    }
  },
});

export const diagnoseTool = tool({
  name: "diagnose",
  title: "Crash & failure diagnosis",
  readOnly: true,
  openWorld: false,
  description: "crash: fault logs; report=true for HTML. stack: hotspots. symbolize: ELF, build_id, hex pc. build: fix hints, diagnostics only (no project).",
  schema: z.object({
    action: z.enum(["crash", "stack", "symbolize", "build"]),
    target: fields.target,
    bundle: z.string().optional().describe("crash: only reports of this app"),
    log: z.string().max(4_000_000).optional().describe("Pasted report"),
    file: z.string().min(1).optional().describe("Absolute UTF-8 file, up to 4 MB"),
    directory: z.string().min(1).optional().describe("Fault logs; filter by name/latest"),
    hilog: z.boolean().optional().describe("Extract embedded HiLog"),
    report: z.boolean().optional(),
    name: z.string().optional().describe("crash: exact faultlog file name"),
    latest: z.number().int().min(1).max(5).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    build_id: z.string().optional(),
    pc: z.array(z.string()).min(1).max(40).optional(),
    since_minutes: z.number().int().min(1).max(10080).optional().describe("crash: only reports from the last N minutes (device clock)"),
    strict: z.boolean().optional().describe("crash: require readable inventory; empty scan is an explicit result"),
    diagnostics: z.array(z.object({ code: z.string().optional(), message: z.string() })).max(100).optional().describe("build: diagnostics to explain"),
    project: z.string().optional().describe("crash: project root; adds source code around app frames"),
  }),
  params: { crash: ["target", "bundle", "log", "file", "directory", "hilog", "report", "name", "latest", "since_minutes", "project", "strict"], stack: ["file", "limit"], symbolize: ["file", "build_id", "pc"], build: ["diagnostics"] },
  async handler(input, ctx) {
    const diagnose = await import("../domains/diagnose.js");
    if (input.action === "build") return { hints: diagnose.buildFailureHints(input.diagnostics ?? []) };
    if (input.action === "symbolize") {
      invariant(input.file && input.build_id && input.pc?.length, "INVALID_INPUT", "file, build_id and pc are required");
      return diagnose.symbolize(input.file, input.build_id, input.pc, ctx.signal);
    }
    if (input.action === "stack") {
      invariant(input.file, "INVALID_INPUT", "file is required");
      return diagnose.diagnoseStack(input.file, input.limit ?? 10, ctx.signal);
    }
    let target: string | undefined;
    const local = input.directory !== undefined || input.file !== undefined || input.log !== undefined;
    invariant([input.directory, input.file, input.log].filter((v) => v !== undefined).length <= 1, "INVALID_INPUT", "Pass one of log, file, or directory");
    if (local) {
      invariant(![input.target, input.bundle, input.since_minutes, input.strict].some((v) => v !== undefined), "INVALID_INPUT", "Local reports do not take device filters");
      invariant(input.directory !== undefined || (input.name === undefined && input.latest === undefined), "INVALID_INPUT", "Only directory accepts name or latest for local reports");
      invariant(input.log === undefined || input.log.trim(), "INVALID_INPUT", "log is empty");
    } else target = await (await import("../domains/device.js")).resolveTarget(input.target, ctx.signal);
    return diagnose.diagnoseCrash(input, target, ctx.signal);
  },
});

export const knowledgeTool = tool({
  name: "knowledge",
  title: "Knowledge",
  readOnly: false,
  description: [
    "Offline HarmonyOS docs and ArkTS rules/errors/crash patterns.",
    "search: Chinese/English; read: id+section; catalog: no parameters; rollback: no parameters; status/update: check.",
    "source=cloud: only query; CodeGenie auth; official(local_doc)/official_other_platform/community/unverified. Full answer: full_artifact via job read. SDK declarations and a successful build win, then official docs; community never defines the API.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["search", "read", "catalog", "status", "update", "rollback"]),
    project: fields.project.optional(),
    product: fields.product,
    query: z.string().optional(),
    id: z.string().optional(),
    section: z.string().optional(),
    catalog: z.enum(["all", "harmonyos-guides", "harmonyos-references", "best-practices", "harmonyos-faqs", "harmonyos-releases", "harmonyos-roadmap", "rules", "errors", "runtime", "skills"]).optional(),
    kind: z.enum(["all", "docs", "rules"]).optional().describe("docs = official docs, rules = ArkTS rules/cases/patterns"),
    source: z.enum(["local", "cloud"]).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(40000).optional().describe("search: results; read: characters; update: job wait ms"),
    check: z.boolean().optional().describe("status: default true (online), false = offline; update: true = check only"),
    version: z.string().optional().describe("update: specific version"),
    file: z.string().optional().describe("update: local .tgz pack or 'upstream' to build Huawei's latest docs"),
    force: z.boolean().optional().describe("update only"),
  }),
  params: {
    search: ["project", "product", "query", "catalog", "kind", "source", "limit", "offset"],
    read: ["project", "product", "id", "offset", "limit", "section"],
    catalog: [], status: ["check"], update: ["check", "version", "file", "force", "limit"], rollback: [],
  },
  async handler(input, ctx) {
    const kb = await import("../domains/knowledge.js");
    const contextualize = async (result: unknown) => {
      if (!input.project) return result;
      const p = (await import("../domains/project.js")).inspectProject(input.project, input.product);
      return { result, project_api: { compile: p.compileSdk, compatible: p.compatibleSdk, target: p.targetSdk, product: p.product }, document_version_filter: "unknown: knowledge pack lacks per-section since/deprecated metadata", guidance: "Compile SDK determines available declarations; compatible SDK sets minimum runtime. Check SDK @since with code lsp hover and guard newer APIs; documents are not silently discarded using compatibleSdkVersion." };
    };
    switch (input.action) {
      case "search":
        invariant(input.query, "INVALID_INPUT", "query is required");
        if (input.source === "cloud") return kb.cloudSearch(input.query, ctx.signal);
        return contextualize(await kb.search(input.query, { catalog: input.catalog, kind: input.kind, limit: input.limit, offset: input.offset }));
      case "read":
        invariant(input.id, "INVALID_INPUT", "id is required");
        return contextualize(await kb.read(input.id, { offset: input.offset, limit: input.limit, section: input.section }));
      case "catalog": return kb.catalog();
      case "status": return kb.status(input.check ?? true, ctx.signal);
      case "update":
        // Downloads can take minutes on slow networks: run as a job and return early.
        return input.check ? kb.status(true, ctx.signal, { source: input.file, version: input.version }) : startAndWait("kb_update", { version: input.version, source: input.file, force: input.force }, undefined, input.limit ?? 20000);
      case "rollback": return kb.rollback();
    }
  },
});

export const skillsTool = tool({
  name: "skills",
  title: "Skills",
  readOnly: false,
  description: "Built-ins: deveco-mcp-workflow, hmos-test-design, hmos-arkui-develop-skill, hmos-runtime-fix-skill. list/read; export: SKILL.md; install_mcp: host registration; init: export+install_mcp; search/install/uninstall: market.",
  schema: z.object({
    action: z.enum(["list", "read", "export", "install_mcp", "init", "search", "install", "uninstall"]),
    name: z.string().optional(),
    reference: z.string().optional().describe("read: references/ file, e.g. quick-apis/01-layout.md (see list)"),
    host: z.string().optional().describe("cursor/claude/codex/opencode/trae-cn/codebuddy/qoder/pi: skills+MCP; deveco/atomcode/dsh: skills only"),
    force: z.boolean().optional().describe("uninstall: remove edits; init/install_mcp: overwrite"),
    path: z.string().optional().describe("export/install/uninstall/init: absolute skills directory overrides host/scope"),
    scope: z.enum(["user", "project"]).optional().describe("Default user; project scope requires scope=project + project"),
    project: z.string().optional(),
    names: z.array(z.string()).optional().describe("export: skill names (not name); default all"),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  params: {
    list: [], read: ["name", "reference"],
    export: ["host", "scope", "project", "names", "path"],
    install_mcp: ["host", "scope", "project", "force"],
    init: ["host", "scope", "project", "force", "path"],
    search: ["query", "limit"],
    install: ["name", "host", "scope", "project", "path"],
    uninstall: ["name", "host", "scope", "project", "path", "force"],
  },
  async handler(input) {
    const skills = await import("../domains/skills.js");
    switch (input.action) {
      case "list": return { skills: skills.listSkills(), note: "Also available as MCP resources deveco://skills/<name>" };
      case "read": invariant(input.name, "INVALID_INPUT", "name is required"); return skills.readSkill(input.name, input.reference);
      case "export": invariant(input.host || input.path, "INVALID_INPUT", "host or path is required"); return skills.exportSkills(input.host, input.scope ?? "user", input.project, input.names, input.path);
      case "install_mcp": {
        invariant(input.host, "INVALID_INPUT", "host is required");
        const { installMcp } = await import("../domains/hostconfig.js");
        return installMcp(input.host, { scope: input.scope, project: input.project, force: input.force });
      }
      case "init": invariant(input.host, "INVALID_INPUT", "host is required"); return skills.initHost(input.host, { scope: input.scope, project: input.project, force: input.force, dir: input.path });
      case "search": invariant(input.query, "INVALID_INPUT", "query is required"); return skills.marketSearch(input.query, input.limit);
      case "install": invariant(input.name && (input.host || input.path), "INVALID_INPUT", "name and host (or path) are required"); return skills.marketInstall(input.name, input.host, input.scope ?? "user", input.project, input.path);
      case "uninstall": invariant(input.name && (input.host || input.path), "INVALID_INPUT", "name and host (or path) are required"); return skills.uninstallSkill(input.name, input.host, input.scope ?? "user", input.project, input.path, input.force);
    }
  },
});

export const authTool = tool({
  name: "auth",
  title: "Huawei login",
  description: "provider=codegenie: cloud knowledge; developer: signing (certificates/profiles/devices). login opens/returns Huawei URL; after browser completion poll status: login_pending=false, logged_in=true, no error. logged_in alone may be an old session. logout cancels login and deletes credentials. teams lists developer teams; import migrates v0.x credentials from legacy_state_dir.",
  schema: z.object({
    action: z.enum(["login", "status", "logout", "teams", "import"]),
    provider: z.enum(["developer", "codegenie"]).optional().describe("login/logout: default codegenie; status: omitted=both; teams: no parameters"),
    region: z.enum(["cn", "global", "hk", "mo"]).optional().describe("Login region (default cn)"),
    open_browser: z.boolean().optional(),
    legacy_state_dir: z.string().optional(),
  }),
  params: {
    login: ["provider", "region", "open_browser"], status: ["provider"], logout: ["provider"],
    teams: [], import: ["legacy_state_dir"],
  },
  async handler(input) {
    const auth = await import("../domains/auth.js");
    const provider = input.provider ?? "codegenie";
    switch (input.action) {
      case "login": return auth.login(provider, input.open_browser ?? true, input.region);
      case "status": return input.provider ? auth.status(provider) : { providers: await Promise.all((["developer", "codegenie"] as const).map((p) => auth.status(p))) };
      case "logout": return auth.logout(provider);
      case "teams": return auth.teams();
      case "import": {
        const os = await import("node:os");
        const path = await import("node:path");
        return auth.migrateLegacy(input.legacy_state_dir ?? path.join(os.homedir(), ".deveco-tool"));
      }
    }
  },
});
