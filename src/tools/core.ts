import { z } from "zod";
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
  description: "No action field. Check toolchain, SDK, devices, project, knowledge pack, logins. Start here for environment failures; includes fixes.",
  schema: z.object({
    project: fields.project.optional(),
    target: fields.target,
    remote: z.boolean().optional().describe("Also check for a newer knowledge pack online"),
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
    "info: metadata; create(app_name,bundle_name): built-in template, never overwrites; clean: build outputs.",
    "sync (job): ohpm install + hvigor sync. build (job): advisory edited-file preflight + hvigor; packages or first 100 compile errors (code/file/line/message/source) with fixes. oh-package.json5/build-profile.json5 edits auto-install dependencies.",
    "test (job): SDK local/instrument tests with verified case counts; instrument requires allow_data_reset and a sole connected target. verify (job): JSON plan -> independent acceptance verdict + permanent JSON/JUnit/HTML evidence. entries: declared Ability/Extension/form/shortcut graph.",
    "Build already checks edited files: no code check first. request_key/wait: sync/build/test/verify only.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["info", "create", "sync", "build", "clean", "test", "verify", "entries"]),
    project: fields.project,
    product: fields.product,
    modules: fields.modules,
    kind: z.enum(["local", "instrument"]).optional(),
    scope: z.array(z.string()).min(1).max(100).optional(),
    coverage: z.boolean().optional(),
    target: fields.target,
    timeout_ms: z.number().int().min(1000).max(1800000).optional(),
    allow_data_reset: z.boolean().optional().describe("instrument: required; SDK uninstalls app and erases its data"),
    expected_tests: z.number().int().min(1).optional(),
    plan: z.string().optional().describe("verify: project-relative or absolute JSON plan"),
    output: z.string().optional().describe("verify: new absolute permanent evidence directory"),
    changed_only: z.boolean().optional(),
    base: z.string().optional().describe("verify changed_only: explicit Git base ref"),
    baseline_mode: z.enum(["compare", "record"]).optional(),
    allow_commands: z.boolean().optional().describe("verify: explicitly permit reviewed project commands"),
    task: z.enum(["assembleHap", "assembleHar", "assembleHsp", "assembleApp", "compileNative"]).optional().describe("build: default assembleHap; compileNative writes compile_commands.json for clangd"),
    mode: z.string().optional().describe("build: buildMode, default debug"),
    clean: z.boolean().optional().describe("build: clean first"),
    preflight: z.boolean().optional().describe("build: ArkTS preflight (default true; advisory)"),
    app_name: z.string().optional().describe("create: display name"),
    bundle_name: z.string().optional().describe("create: e.g. com.example.demo"),
    sdk_version: z.string().optional().describe("create: compile SDK version (default installed)"),
    target_api: z.number().int().optional().describe("create: target API"),
    compatible_api: z.number().int().optional().describe("create: minimum API"),
    device_types: z.array(z.enum(["phone", "tablet", "2in1", "car", "wearable", "tv"])).min(1).optional().describe("create: devices, default [phone]; deduplicated"),
    merge: z.boolean().optional().describe("create: allow a non-empty directory (never overwrites)"),
    request_key: fields.requestKey,
    wait: fields.wait,
  }),
  params: {
    info: ["project", "product"], entries: ["project", "product"],
    test: ["project", "product", "kind", "modules", "scope", "coverage", "target", "timeout_ms", "allow_data_reset", "expected_tests", "request_key", "wait"],
    verify: ["project", "product", "plan", "output", "target", "changed_only", "base", "baseline_mode", "allow_commands", "request_key", "wait"],
    create: ["project", "app_name", "bundle_name", "sdk_version", "target_api", "compatible_api", "device_types", "merge"],
    sync: ["project", "product", "request_key", "wait"],
    build: ["project", "product", "modules", "task", "mode", "clean", "preflight", "request_key", "wait"],
    clean: ["project", "product"],
  },
  async handler(input, ctx) {
    const project = await import("../domains/project.js");
    switch (input.action) {
      case "entries": return (await import("../domains/entries.js")).entryGraph(input.project, input.product);
      case "test":
        invariant(input.kind, "INVALID_INPUT", "test requires kind=local|instrument");
        return startAndWait("project_test", input, input.request_key, input.wait);
      case "verify": {
        invariant(input.plan && input.output, "INVALID_INPUT", "verify requires plan and output");
        const verify = await import("../domains/verify.js");
        const jobInput = { ...input, plan: input.plan, output: input.output };
        if (verify.planNeedsDevice(verify.readPlan(jobInput).plan)) jobInput.target = await (await import("../domains/device.js")).resolveTarget(input.target, ctx.signal);
        return startAndWait("verify", jobInput, input.request_key, input.wait);
      }
      case "info":
        return project.projectInfo(project.inspectProject(input.project, input.product));
      case "create": {
        invariant(input.app_name && input.bundle_name, "INVALID_INPUT", "create needs app_name and bundle_name");
        return project.createProject({ ...input, app_name: input.app_name, bundle_name: input.bundle_name });
      }
      case "clean":
        return project.cleanProject(project.inspectProject(input.project, input.product), new AbortController().signal);
      case "sync":
        return startAndWait("sync", { project: input.project, product: input.product }, input.request_key, input.wait);
      case "build":
        return startAndWait("build", { project: input.project, product: input.product, modules: input.modules, task: input.task, mode: input.mode, clean: input.clean, preflight: input.preflight ?? true }, input.request_key, input.wait);
    }
  },
});

const assertSchema = z.object({
  visible: z.lazy(() => selectorSchema).optional(),
  hidden: z.lazy(() => selectorSchema).optional(),
  timeout_ms: z.number().int().min(100).max(120000).optional(),
}).refine((input) => !!input.visible !== !!input.hidden, "Pass exactly one visible or hidden selector");
export const selectorSchema = z.object({
  text: z.string().optional().describe("Case-insensitive substring unless exact=true"),
  exact: z.boolean().optional(),
  key: z.string().optional().describe("ArkUI .id('...')"),
  type: z.string().optional().describe("E.g. Button, TextInput"),
  id: z.string().optional(),
  bundle: z.string().optional(),
  clickable: z.boolean().optional(),
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  enabled: z.boolean().optional(),
  index: z.number().int().min(0).optional().describe("Nth match if ambiguous"),
}).meta({ id: "Selector" }); // emitted once per tool as $defs/Selector

const uiOpSchema = z.enum(["click", "double_click", "long_click", "input", "type", "swipe", "drag", "fling", "scroll", "key",
  "mouse_click", "mouse_double_click", "mouse_long_click", "mouse_move", "mouse_scroll", "mouse_drag"]).meta({ id: "UiOp" });
const batchStepSchema = z.object({
  op: z.union([uiOpSchema, z.literal("wait")]),
  selector: selectorSchema.optional(),
  x: z.number().int().optional(), y: z.number().int().optional(), x2: z.number().int().optional(), y2: z.number().int().optional(),
  text: z.string().optional(), append: z.boolean().optional(), key: z.string().optional(), keys: z.array(z.string()).min(1).max(3).optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(), speed: z.number().int().min(200).max(40000).optional(),
  button: z.enum(["left", "right", "middle"]).optional(), ticks: z.number().int().min(1).max(50).optional(),
  ms: z.number().int().min(0).max(10000).optional().describe("wait without selector: pause in ms"),
  timeout_ms: z.number().int().min(100).optional().describe("selector wait (default 10000)"),
}).strict();

export const runTool = tool({
  name: "run",
  title: "Deploy and launch",
  description: [
    "Deploy device-matched modules; preserve project signing.",
    "build_run: check edited files + build + install + launch + crash check; no code check first.",
    "run_mode=auto (default): first build_run on the same device deploys; later entry-module code-only edits quick-fix, others fully deploy. Returns path=hot_reload|full|relaunch, fallback_reason. full always deploys.",
    "Startup crash: LAUNCH_FAILED + crash.source(file/line/code).",
    "then_flow=<ui_flow id>: replay after launch; assert then verifies the final screen.",
    "deploy: install latest build + launch. launch: project/product/target/module/ability/want only; stop/uninstall: project/product/target only. wait/request_key: build_run/deploy only. hot_reload=true saves baseline after successful launch.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["build_run", "deploy", "launch", "stop", "uninstall"]),
    project: fields.project,
    product: fields.product,
    modules: fields.modules,
    target: fields.target,
    mode: z.string().optional(),
    module: z.string().optional().describe("Launch module (default entry)"),
    ability: z.string().optional().describe("Launch ability (default module mainElement)"),
    want: z.object({ uri: z.string().max(4096).optional(), action: z.string().max(256).optional(), parameters: z.record(z.string(), z.union([z.string().max(4096), z.number().int(), z.boolean()])).optional() }).strict().optional().describe("launch: URI/action and typed Want parameters"),
    assert: assertSchema.optional(),
    hot_reload: z.boolean().optional(),
    skip_build: z.boolean().optional().describe("build_run: latest packages without building (=deploy)"),
    uninstall_first: z.boolean().optional().describe("build_run/deploy: uninstall first (erases app data)"),
    run_mode: z.enum(["auto", "full"]).optional().describe("build_run only"),
    then_flow: z.string().optional().describe("build_run/deploy: flow failure does not fail deploy; inspect flow.passed"),
    flow_variables: z.record(z.string(), z.string()).optional().describe("then_flow: fill required variables from ui_flow show"),
    request_key: fields.requestKey,
    wait: fields.wait,
  }),
  params: {
    build_run: ["project", "product", "modules", "target", "mode", "run_mode", "module", "ability", "assert", "hot_reload", "skip_build", "uninstall_first", "then_flow", "flow_variables", "request_key", "wait"],
    deploy: ["project", "product", "modules", "target", "module", "ability", "assert", "hot_reload", "uninstall_first", "then_flow", "flow_variables", "request_key", "wait"],
    launch: ["project", "product", "target", "module", "ability", "want"],
    stop: ["project", "product", "target"],
    uninstall: ["project", "product", "target"],
  },
  async handler(input, ctx) {
    if (input.action === "build_run" || input.action === "deploy") {
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
  description: `resources: inspect same-host reservations; release_resource: exact resource+owner_pid, dead owners only after effect reconciliation. Jobs: wait (default 20000, max ${MAX_WAIT_MS} ms; repeat while running, never restart), status, list, cancel; resume interrupted/needs_input jobs only after inspection (force=true repeats an uncertain step). read: full artifacts (logs/reports/images) by artifact_id; line/limit page, grep filters.`,
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
    line: z.number().int().min(0).optional().describe("read: 0-based line; continue with returned next_line"),
    grep: z.string().optional().describe("read: regex filter, e.g. 'error|ERROR'"),
  }),
  params: {
    resources: [], release_resource: ["resource", "owner_pid"],
    wait: ["job_id", "wait"], status: ["job_id", "detail"], list: ["limit", "status"], cancel: ["job_id"],
    resume: ["job_id", "force"], read: ["artifact_id", "line", "limit", "grep"],
  },
  async handler(input) {
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
      const result = await readArtifact(input.artifact_id, { line: input.line, limit: input.limit, grep: input.grep });
      if ("image" in result && result.image) {
        const { image, ...rest } = result;
        return { ...rest, _image: { data: image, mime: result.mime } };
      }
      return result;
    }
    invariant(input.job_id, "INVALID_INPUT", "job_id is required");
    switch (input.action) {
      case "wait": return jobs.waitJob(input.job_id, input.wait ?? 20000);
      case "status": return jobs.jobStatus(input.job_id, input.detail);
      case "cancel": return jobs.cancelJob(input.job_id);
      case "resume": return jobs.resumeJob(input.job_id, input.force);
    }
  },
});

export const codeTool = tool({
  name: "code",
  title: "Code checks & LSP",
  readOnly: false,
  openWorld: false,
  description: [
    "origin: key/text/file static source candidates with Git changed-line/blame context; no runtime mapping. ArkTS/C++ checks and LSP use the project SDK.",
    "check: static checks/fix hints, no build; fix=true applies safe fixes. May diagnose dependencies; scope counts roots, report_artifact has all issues. The compiler is the final judge.",
    "lint: Code Linter report. api_scan / api_versions: API compatibility between SDK versions.",
    "action=lsp requires op: see enum; locate by symbol (+line hint). lsp_restart restarts servers.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["check", "lint", "api_scan", "api_versions", "lsp", "lsp_restart", "origin"]),
    project: fields.project.optional().describe("Project root; required except api_versions"),
    files: z.array(z.string()).max(200).optional().describe("check/api_scan/lsp diagnostics: check uses files, not file. Existing .ets/.ts or C/C++; omit for project; no mixed languages"),
    fix: z.boolean().optional(),
    product: fields.product,
    op: z.enum(["hover", "definition", "declaration", "implementation", "references", "symbols", "workspace_symbols", "diagnostics", "completion", "signature", "call_hierarchy"]).optional().describe("lsp operation"),
    direction: z.enum(["incoming", "outgoing"]).optional().describe("call_hierarchy: incoming=callers (default), outgoing=callees"),
    file: z.string().optional().describe("lint/lsp: one file (except workspace_symbols)"),
    symbol: z.string().optional().describe("Locate identifier, e.g. pushUrl or router.pushUrl"),
    line: z.number().int().min(1).optional().describe("1-based line (hint when symbol is given)"),
    column: z.number().int().min(1).optional().describe("1-based column (only without symbol)"),
    key: z.string().optional(),
    text: z.string().optional(),
    query: z.string().optional().describe("workspace_symbols query"),
    language: z.enum(["arkts", "cpp", "all"]).optional().describe("lsp: default by extension; lsp_restart: default all servers"),
    modules: fields.modules,
    output_path: z.string().optional().describe("lint/api_scan: also save report at absolute path"),
    config_path: z.string().optional().describe("lint: .json/.json5 rules (default code-linter.json5)"),
    incremental: z.boolean().optional().describe("lint: only uncommitted files"),
    from: z.string().optional().describe("api_scan: from version, e.g. HarmonyOS_5.0.0(12)_Release"),
    to: z.string().optional().describe("api_scan: target version"),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  params: {
    origin: ["project", "key", "text", "file", "line"],
    check: ["project", "files", "fix"],
    lint: ["project", "file", "fix", "product", "config_path", "incremental", "output_path"],
    api_scan: ["project", "from", "to", "files", "modules", "output_path"],
    api_versions: ["project"],
    lsp: ["project", "op", "file", "files", "symbol", "line", "column", "query", "language", "limit", "direction", "product"],
    lsp_restart: ["project", "language"],
  },
  async handler(input, ctx) {
    if (input.action === "origin") { invariant(input.project, "INVALID_INPUT", "origin requires project"); return (await import("../domains/origin.js")).sourceOrigin(input.project, input, ctx.signal); }
    const code = await import("../domains/code.js");
    if (input.action === "api_versions") return { versions: code.apiVersions() };
    invariant(input.project, "INVALID_INPUT", "project is required");
    const project = input.project;
    switch (input.action) {
      case "check":
        if (input.files?.some((f) => /\.(c|cc|cpp|h|hpp)$/.test(f))) {
          invariant(input.files.every((f) => /\.(c|cc|cpp|h|hpp)$/.test(f)), "INVALID_INPUT", "Check ArkTS/TypeScript and C/C++ files in separate calls");
          invariant(!input.fix, "INVALID_INPUT", "fix=true is only supported for ArkTS/TypeScript checks");
          return code.cppCheck(project, input.files, ctx.signal);
        }
        return code.arktsCheck(project, input.files, ctx.signal, input.fix ?? false);
      case "lint":
        return code.codeLinter(project, { path: input.file, fix: input.fix, product: input.product, config_path: input.config_path, incremental: input.incremental, output_path: input.output_path }, ctx.signal);
      case "api_scan":
        invariant(!(input.files?.length && input.modules?.length), "INVALID_INPUT", "Pass files or modules, not both");
        return code.apiScan(project, { from: input.from, to: input.to, files: input.files, modules: input.modules, output_path: input.output_path }, ctx.signal);
      case "lsp_restart":
        return code.restartLsp(project, input.language ?? "all");
      case "lsp":
        invariant(input.op, "INVALID_INPUT", "op is required for lsp");
        return code.lsp({ project, action: input.op, file: input.file, files: input.files, symbol: input.symbol, line: input.line, column: input.column, query: input.query, language: input.language === "all" ? undefined : input.language, limit: input.limit, direction: input.direction }, ctx.signal);
    }
  },
});

export const deviceTool = tool({
  name: "device",
  title: "Devices/logs/files",
  description: "list: connected devices; info: model/API/screen. action=log: hilog by bundle/grep/level, from/to window (from=5m), follow+cursor, clear; project locates source. shell: read-only commands. databases: discover app RDB paths (debug/user100). fixture: owned scratch table prepare/inspect/cleanup, refuses cleanup if changed. scenario: background/clear_data/grant/revoke; explicit reset for clear_data. trace: bounded official hitrace capture, no inferred source stack. action=sqlite: db+sql query (read-only unless write=true). send: local to remote; recv: remote to local.",
  schema: z.object({
    action: z.enum(["list", "info", "log", "shell", "sqlite", "send", "recv", "databases", "scenario", "fixture", "trace"]),
    operation: z.enum(["background", "clear_data", "grant", "revoke", "prepare", "inspect", "cleanup"]).optional(),
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
    from: z.string().optional().describe("log: window start, e.g. 5m/30s/1h ago (device clock)"),
    to: z.string().optional().describe("log: window end, e.g. 1m ago (default now)"),
    follow: z.boolean().optional().describe("log: newer than cursor; await wait_ms; returns next cursor"),
    cursor: z.string().optional().describe("log follow: previous cursor (omit initially)"),
    wait_ms: z.number().int().min(0).max(30000).optional().describe("log follow: max wait for new lines (default 5000)"),
    command: z.string().optional().describe("shell: read-only command line"),
    local: z.string().optional(),
    remote: z.string().optional(),
    project: z.string().optional().describe("log: project root for error source files/lines/code"),
  }),
  params: {
    list: [], info: ["target"],
    databases: ["target", "bundle", "module"], scenario: ["target", "operation", "bundle", "permission", "allow_data_reset"],
    fixture: ["target", "operation", "db", "bundle", "module", "fixture_id", "rows"], trace: ["target", "seconds", "categories"],
    log: ["target", "bundle", "grep", "level", "lines", "clear", "from", "to", "follow", "cursor", "wait_ms", "project"],
    shell: ["target", "command"], sqlite: ["target", "db", "module", "sql", "write", "bundle", "lines"],
    send: ["target", "local", "remote"], recv: ["target", "local", "remote"],
  },
  async handler(input, ctx) {
    const device = await import("../domains/device.js");
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
    "observe: screenshot+elements; screenshot/tree/find/windows: inspect. tree: window/depth/all_windows/node.",
    "selector/visible/hidden: objects, e.g. {\"text\":\"Hi\"}.",
    "act: click/double_click/long_click selector or x,y; input/type text; swipe/drag/fling x,y,x2,y2; scroll; key/keys chord; mouse_* for tablet/2in1.",
    "act after={changed,kind:none/state/updated/navigated,added,removed}: app's on-screen elements; no extra observe.",
    "act steps=[...]: waits for each element, stops at first failure with controls. save_flow={project,id} for run then_flow. ~52 s/call; stopped_at=continuation.",
    "assert: visible OR hidden, not screenshots alone.",
    "Accept consent (agreements_accepted) and setup/tours preserving defaults (onboarding_completed) by window text/control state, never app names/fixed IDs. If still blocked, observe; never blindly repeat.",
    "visual: baseline (first saves, update replaces); changed_ratio/regions/diff_artifact; dimming=global_shift.",
    "layout: off-screen/overlap/tiny targets, clipped text; forms=[foldable,widefold,triplefold] job. wait/request_key: layout forms only.",
    "perf: scroll smoothness/jank; no data=inconclusive + diagnostic_artifact; bundle adds pss. record_start/record_stop/record_status: mp4. record_receipts/record_archive(target,name)/record_restore(receipt_id): offline; preserve receipts, no device I/O.",
    "Tests: test_start(plan) -> test_step(test_id, op/selector or visible/hidden) -> review(test_id+requirement) captures an image; inspect it before review(test_id+review_id+outcome+reason) -> test_finish -> test_log/test_export. Omit outcome/review_id on capture. checklist_item links assertions/reviews to every plan item; missing coverage is inconclusive.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["observe", "screenshot", "tree", "find", "act", "assert", "windows", "perf", "visual", "layout", "record_start", "record_stop", "record_status", "record_receipts", "record_archive", "record_restore",
      "test_start", "test_step", "review", "test_finish", "test_log", "test_export"]),
    target: fields.target,
    window: z.number().int().optional().describe("tree/observe: id from windows"),
    all_windows: z.boolean().optional().describe("tree: all windows/displays; excludes window"),
    node: z.string().optional().describe("tree: one component (id/key) subtree"),
    display: z.number().int().optional().describe("screenshot: display id"),
    save_path: z.string().optional().describe("screenshot/record_stop: absolute copy; retention_days expiry"),
    depth: z.number().int().min(0).max(100).optional().describe("tree/observe: depth (0 all, 1 root)"),
    all: z.boolean().optional().describe("windows: include system windows"),
    discard: z.boolean().optional().describe("record_stop: stop without downloading"),
    external: z.boolean().optional().describe("record_stop: stop a foreign recording"),
    receipt_id: z.string().optional().describe("record_restore: archived receipt id"),
    test_id: z.string().optional().describe("test_step/review: stored session target; conflicting target rejected; test_finish/test_log/test_export need no device"),
    plan: z.string().max(20000).optional().describe("test_start: steps + expected results"),
    project: z.string().optional().describe("test_start/visual/layout: project root"),
    fresh_start: z.boolean().optional().describe("test_start: restart app; requires project"),
    checklist_item: z.number().int().min(1).max(50).optional().describe("test_step/review: 1-based checklist item; required for multi-item plans"),
    description: z.string().max(500).optional().describe("test_step: checklist item"),
    requirement: z.string().max(2000).optional().describe("review: what the screen must show"),
    outcome: z.enum(["passed", "failed", "insufficient"]).optional().describe("review: judge only after seeing the image; omit on capture"),
    reason: z.string().max(2000).optional(),
    review_id: z.number().int().optional().describe("review: returned image id; never invent"),
    directory: z.string().optional().describe("test_export: absolute output directory"),
    max_chars: z.number().int().min(-1).optional().describe("test_log: -1 = unlimited, default 5000"),
    grep: z.string().optional().describe("test_log: keyword/regex filter"),
    selector: selectorSchema.optional(),
    op: uiOpSchema.optional(),
    keys: z.array(z.string()).min(1).max(3).optional().describe("key chord e.g. [\"ctrl\",\"c\"]; mouse_*: modifiers"),
    button: z.enum(["left", "right", "middle"]).optional().describe("mouse click button"),
    ticks: z.number().int().min(1).max(50).optional().describe("mouse_scroll wheel ticks (default 3)"),
    verify_change: z.boolean().optional().describe("act: poll up to 3 s"),
    diff: z.boolean().optional().describe("act: return the after diff (default true)"),
    steps: z.array(batchStepSchema).min(1).max(30).optional().describe("act: path instead of op; perf: swipe/fling/drag/scroll only"),
    assert: assertSchema.optional().describe("act steps: final check; test_step uses top-level visible/hidden, never assert"),
    save_flow: z.object({ project: z.string(), id: z.string(), name: z.string().optional() }).optional()
      .describe("act steps + assert: save ui_flow; start at launch screen"),
    x: z.number().int().optional(), y: z.number().int().optional(), x2: z.number().int().optional(), y2: z.number().int().optional(),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    text: z.string().optional(),
    append: z.boolean().optional().describe("input: keep existing text (default replaces it)"),
    key: z.string().optional().describe("back, home, enter, delete... or a keycode"),
    speed: z.number().int().min(200).max(40000).optional(),
    visible: selectorSchema.optional(),
    hidden: selectorSchema.optional(),
    timeout_ms: z.number().int().min(100).max(120000).optional(),
    interactive: z.boolean().optional().describe("observe/tree: interactive/labelled only (default true)"),
    bundle: z.string().optional().describe("observe/tree/layout/test_start/perf: app bundle"),
    format: z.enum(["jpeg", "png"]).optional(),
    width: z.number().int().min(240).max(2560).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
    repeat: z.number().int().min(1).max(20).optional().describe("perf: number of up+down fling pairs (default 3)"),
    name: z.string().optional().describe("visual: baseline; record_archive: exact pending filename"),
    update: z.boolean().optional().describe("visual: replace baseline"),
    context: z.string().max(256).optional().describe("visual: declared scene/theme/locale identity"),
    require_baseline: z.boolean().optional().describe("visual: missing baseline is an error, never auto-create"),
    min_target_vp: z.number().min(1).max(100).optional(),
    strict_targets: z.boolean().optional().describe("layout: tiny targets fail; default advisory"),
    threshold: z.number().int().min(1).max(64).optional().describe("visual: gray difference per block (default 8)"),
    forms: z.array(z.enum(["foldable", "widefold", "triplefold"])).min(1).max(3).optional().describe("layout: emulator forms to check (job)"),
    then_flow: z.string().optional().describe("layout forms: ui_flow without required variables"),
    keep_running: z.boolean().optional().describe("layout forms: leave the emulators running"),
    request_key: fields.requestKey,
    wait: fields.wait,
  }).superRefine((input, ctx) => {
    if (input.visible && input.hidden) ctx.addIssue({ code: "custom", message: "Pass exactly one visible or hidden selector" });
    if (input.action === "act" && !input.steps && (input.assert || input.save_flow)) ctx.addIssue({ code: "custom", message: "assert/save_flow require steps; use a one-step array for one action plus assertion" });
  }),
  params: (() => {
    const act = ["target", "op", "selector", "keys", "button", "ticks", "verify_change", "x", "y", "x2", "y2", "direction", "text", "append", "key", "speed"];
    return {
      act: [...act, "diff", "steps", "assert", "save_flow"],
      observe: ["target", "window", "depth", "interactive", "limit", "bundle", "format", "width"],
      screenshot: ["target", "display", "save_path", "format", "width"],
      tree: ["target", "window", "all_windows", "node", "depth", "interactive", "limit", "bundle"],
      find: ["target", "selector", "limit"],
      assert: ["target", "visible", "hidden", "timeout_ms"],
      windows: ["target", "all"],
      perf: ["target", "steps", "repeat", "bundle"],
      visual: ["target", "project", "name", "update", "threshold", "require_baseline", "context"],
      layout: ["target", "project", "bundle", "forms", "then_flow", "keep_running", "min_target_vp", "strict_targets", "request_key", "wait"],
      record_start: ["target"], record_status: ["target"], record_stop: ["target", "discard", "external", "save_path"],
      record_receipts: ["target"], record_archive: ["target", "name", "reason"], record_restore: ["receipt_id"],
      test_start: ["target", "plan", "project", "bundle", "fresh_start"],
      test_step: [...act, "test_id", "checklist_item", "description", "visible", "hidden", "timeout_ms"],
      review: ["target", "test_id", "checklist_item", "requirement", "outcome", "reason", "review_id"],
      test_finish: ["target", "test_id"], test_log: ["target", "test_id", "grep", "max_chars"], test_export: ["target", "test_id", "directory"],
    };
  })(),
  async handler(input, ctx) {
    // Domain callers also use this handler without the MCP schema boundary.
    invariant(!(input.visible && input.hidden), "INVALID_INPUT", "Pass exactly one visible or hidden selector");
    if (input.action === "act" && !input.steps) invariant(!input.assert && !input.save_flow, "INVALID_INPUT", "assert/save_flow require steps; use a one-step array for one action plus assertion");
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
      if (input.action === "test_log") return t.testLog(input.test_id, { grep: input.grep, max_chars: input.max_chars });
      invariant(input.directory, "INVALID_INPUT", "directory is required");
      return t.exportTest(input.test_id, input.directory);
    }
    if (input.action === "layout" && input.forms) {
      invariant(input.project, "INVALID_INPUT", "layout forms needs project");
      return startAndWait("layout_check", { project: input.project, forms: input.forms, then_flow: input.then_flow, keep_running: input.keep_running }, input.request_key, input.wait ?? 3000);
    }
    let projectTypes: string[] | undefined;
    if (input.action === "test_start" && input.project && !input.target) {
      const { inspectProject, runnableDeviceTypes } = await import("../domains/project.js");
      try { projectTypes = runnableDeviceTypes(inspectProject(input.project)); } catch { /* reported by test_start below */ }
    }
    const target = await resolveTarget(input.target, ctx.signal, projectTypes);
    const scope = { window: input.window };
    switch (input.action) {
      case "windows": return { windows: await ui.listWindows(target, input.all, ctx.signal) };
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
        invariant(input.project && input.name, "INVALID_INPUT", "visual needs project and name");
        const { visualCheck } = await import("../domains/visual.js");
        const { deviceInfo } = await import("../domains/device.js");
        const info = await deviceInfo(target, ctx.signal);
        return visualCheck(target, { project: input.project, name: input.name, update: input.update, threshold: input.threshold, require_baseline: input.require_baseline, context: input.context },
          { model: info.model ?? info.name ?? target, os: info.os, api: info.api_level, size: info.screen ? { w: info.screen.width, h: info.screen.height } : undefined }, ctx.signal);
      }
      case "perf": {
        const { measureScroll } = await import("../domains/perf.js");
        const { stepAction } = await import("../domains/uibatch.js");
        const { deviceInfo } = await import("../domains/device.js");
        const gestures = input.steps?.map((s) => {
          invariant(["swipe", "fling", "drag", "scroll"].includes(s.op), "INVALID_INPUT", `perf steps take gestures (swipe/fling/drag/scroll), not ${s.op}`);
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
        if (input.op) await buildAction({ ...input, selector: undefined, x: input.selector ? 0 : input.x, y: input.selector ? 0 : input.y }, target, ui, ctx.signal);
        const consent = input.op ? await ui.acceptAgreements(target, ctx.signal) : undefined;
        const action = input.op ? await buildAction(input, target, ui, ctx.signal) : undefined;
        const assert = input.visible || input.hidden ? { visible: input.visible, hidden: input.hidden, timeout_ms: input.timeout_ms } : undefined;
        return (await uitest()).testStep(input.test_id, { checklist_item: input.checklist_item, description: input.description, action: action?.action, selector: input.selector, automatic: consent?.accepted, assert }, ctx.signal);
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
        return { nodes: nodes.length, tree: ui.compact(nodes, { interactive: input.interactive ?? true, limit: input.limit, bundle: input.bundle, depth: input.depth }) };
      }
      case "observe": {
        const [nodes, shot] = await Promise.all([ui.dumpTree(target, ctx.signal, 0, scope), ui.screenshot(target, { format: input.format, width: input.width }, ctx.signal)]);
        return { elements: ui.compact(nodes, { interactive: input.interactive ?? true, limit: input.limit ?? 200, bundle: input.bundle, depth: input.depth }), screenshot: shot.artifact_id, _image: { data: shot.data, mime: shot.mime } };
      }
      case "find": {
        invariant(input.selector, "INVALID_INPUT", "selector is required");
        const matches = ui.select(await ui.dumpTree(target, ctx.signal), input.selector);
        return { count: matches.length, matches: matches.slice(0, input.limit ?? 20).map(ui.describe) };
      }
      case "assert": {
        invariant(input.visible || input.hidden, "INVALID_INPUT", "Pass visible or hidden selector");
        const verdict = await ui.waitFor(target, (input.visible ?? input.hidden)!, input.visible ? "visible" : "hidden", input.timeout_ms ?? 5000, ctx.signal);
        return verdict.passed ? verdict : { ...verdict, hint: "Not satisfied: call ui observe to inspect the screen" };
      }
      case "act": {
        invariant(input.op || input.steps, "INVALID_INPUT", "Pass op or steps");
        invariant(!(input.op && input.steps), "INVALID_INPUT", "Pass either op (one action) or steps (several), not both");
        invariant(!input.save_flow || input.assert, "INVALID_INPUT", "save_flow needs an assert that proves the goal was reached");
        if (input.op) await buildAction({ ...input, selector: undefined, x: input.selector ? 0 : input.x, y: input.selector ? 0 : input.y }, target, ui, ctx.signal);
        const consent = await ui.acceptAgreements(target, ctx.signal);
        const { deviceInfo } = await import("../domains/device.js");
        const flows = await import("../domains/flows.js");
        const batch = await import("../domains/uibatch.js");
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
            ...(!result.passed ? { hint: result.stopped_at !== undefined ? `Time budget of one call used up: call again with steps from index ${result.stopped_at}`
              : result.failed_step !== undefined ? "Fix the failing step using the visible list, then call again with the remaining steps" : "The final assert failed: check after/visible" } : {}),
          };
        }
        const { action, resolved } = await buildAction(input, target, ui, ctx.signal);
        const wantDiff = input.diff !== false;
        // "before" costs no extra dump in the common cases: a selector was just resolved on a fresh tree,
        // or the previous act left its "after" tree in the cache (every act invalidates the cache first,
        // so a cached tree is the last screen this server observed). verify_change needs a fresh one.
        const before = wantDiff || input.verify_change ? await ui.dumpTree(target, ctx.signal, input.verify_change ? 1500 : 30000).catch(() => undefined) : undefined;
        const acted = Date.now();
        const result = await ui.act(target, action, ctx.signal);
        let after: ReturnType<typeof batch.screenDiff> | undefined;
        if (before) {
          // One dump after a short settle (skipped when the action itself took long, e.g. a fling);
          // verify_change keeps polling (up to 3 s) for slow transitions.
          const deadline = Date.now() + (input.verify_change ? 3000 : 0);
          if (Date.now() - acted < 1000) await new Promise((r) => setTimeout(r, 400));
          for (;;) {
            const observed = await ui.dumpTree(target, ctx.signal).catch(() => undefined);
            if (!observed) break;
            const post = await ui.acceptAgreements(target, ctx.signal, observed);
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

type UiInput = {
  op?: "click" | "double_click" | "long_click" | "input" | "type" | "swipe" | "drag" | "fling" | "scroll" | "key"
    | "mouse_click" | "mouse_double_click" | "mouse_long_click" | "mouse_move" | "mouse_scroll" | "mouse_drag";
  keys?: string[]; button?: "left" | "right" | "middle"; ticks?: number;
  selector?: z.infer<typeof selectorSchema>; x?: number; y?: number; x2?: number; y2?: number; text?: string; append?: boolean;
  direction?: "up" | "down" | "left" | "right"; key?: string; speed?: number;
};
/** Turn act parameters into a concrete action, resolving a selector to coordinates. */
async function buildAction(input: UiInput, target: string, ui: typeof import("../domains/ui.js"), signal: AbortSignal) {
  invariant(input.op, "INVALID_INPUT", "op is required");
  let x = input.x, y = input.y;
  let resolved: ReturnType<typeof ui.describe> | undefined;
  if (input.selector && ["click", "double_click", "long_click", "input", "mouse_click", "mouse_double_click", "mouse_long_click", "mouse_move", "mouse_scroll"].includes(input.op)) {
    const node = await ui.resolveOne(target, input.selector, signal);
    ({ x, y } = ui.center(node));
    resolved = ui.describe(node);
  }
  const need = (cond: unknown, what: string) => invariant(cond, "INVALID_INPUT", `${input.op} needs ${what}`);
  let action: import("../domains/ui.js").Action;
  switch (input.op) {
    case "click": case "double_click": case "long_click": need(x !== undefined && y !== undefined, "selector or x,y"); action = { action: input.op, x: x!, y: y! }; break;
    case "input": need(x !== undefined && input.text !== undefined, "selector or x,y and text"); action = { action: "input", x: x!, y: y!, text: input.text!, append: input.append }; break;
    case "type": need(input.text !== undefined, "text"); action = { action: "type", text: input.text! }; break;
    case "swipe": case "drag": case "fling": need([input.x, input.y, input.x2, input.y2].every((v) => v !== undefined), "x,y,x2,y2"); action = { action: input.op, x: input.x!, y: input.y!, x2: input.x2!, y2: input.y2!, speed: input.speed }; break;
    case "scroll": need(input.direction, "direction"); action = { action: "scroll", direction: input.direction!, speed: input.speed }; break;
    case "key":
      need(input.key || input.keys, "key or keys");
      action = input.keys ? { action: "keys", keys: input.keys } : { action: "key", key: input.key! }; break;
    case "mouse_click": case "mouse_double_click": case "mouse_long_click":
      need(x !== undefined && y !== undefined, "selector or x,y"); action = { action: input.op, x: x!, y: y!, button: input.button, keys: input.keys }; break;
    case "mouse_move": need(x !== undefined && y !== undefined, "selector or x,y"); action = { action: "mouse_move", x: x!, y: y! }; break;
    case "mouse_scroll":
      need(x !== undefined && y !== undefined && (input.direction === "up" || input.direction === "down"), "selector or x,y and direction up/down");
      action = { action: "mouse_scroll", x: x!, y: y!, direction: input.direction as "up" | "down", ticks: input.ticks, keys: input.keys }; break;
    case "mouse_drag": need([input.x, input.y, input.x2, input.y2].every((v) => v !== undefined), "x,y,x2,y2"); action = { action: "mouse_drag", x: input.x!, y: input.y!, x2: input.x2!, y2: input.y2!, speed: input.speed }; break;
  }
  return { action: action!, resolved };
}

/**
 * Repeated-path hint: selector clicks extend the current path; any other action that moves through
 * the UI (coordinate taps, gestures, keys) breaks it. Text input and waits do not.
 */
function repeatHint(target: string, executed: { action: import("../domains/ui.js").Action; selector?: z.infer<typeof selectorSchema> }[]) {
  try {
    const taps = executed.flatMap((e) => (e.action.action === "click" ? [e.selector] : ["input", "type"].includes(e.action.action) ? [] : [undefined]));
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
  title: "Record/replay UI flows",
  description: "In <project>/.arkpilot/flows; save via ui act steps + save_flow. list/show/delete; record -> ui act -> stop with final assert (or discard=true). replay restarts app (job); show first, supply required variables (e.g. input1). wait/request_key: replay only. repair=true promotes working alternates, snapshot=true compares screens. Uses ui consent/setup handling; inspect blockers before retrying.",
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
    snapshot: z.boolean().optional().describe("replay: after final assert, compare screen; first snapshot replay saves baseline"),
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
  description: "crash: latest jscrash/cppcrash/appfreeze or pasted log; error, app frames, fault-pattern causes; project adds source (file/line/code). build_run/launch attach startup crashes. build: fix hints, diagnostics only (no project).",
  schema: z.object({
    action: z.enum(["crash", "build"]),
    target: fields.target,
    bundle: z.string().optional().describe("crash: only reports of this app"),
    log: z.string().max(4_000_000).optional().describe("crash: analyze this text instead of reading the device"),
    name: z.string().optional().describe("crash: exact faultlog file name"),
    latest: z.number().int().min(1).max(5).optional(),
    since_minutes: z.number().int().min(1).max(10080).optional().describe("crash: only reports from the last N minutes (device clock)"),
    strict: z.boolean().optional().describe("crash: require readable inventory; empty scan is an explicit result"),
    diagnostics: z.array(z.object({ code: z.string().optional(), message: z.string() })).max(100).optional().describe("build: diagnostics to explain"),
    project: z.string().optional().describe("crash: project root; adds source code around app frames"),
  }),
  params: { crash: ["target", "bundle", "log", "name", "latest", "since_minutes", "project", "strict"], build: ["diagnostics"] },
  async handler(input, ctx) {
    const diagnose = await import("../domains/diagnose.js");
    if (input.action === "build") return { hints: diagnose.buildFailureHints(input.diagnostics ?? []) };
    let target: string | undefined;
    if (!input.log) target = await (await import("../domains/device.js")).resolveTarget(input.target, ctx.signal);
    return diagnose.diagnoseCrash(input, target, ctx.signal);
  },
});

export const knowledgeTool = tool({
  name: "knowledge",
  title: "Knowledge",
  readOnly: false,
  description: [
    "Updatable offline HarmonyOS guides/APIs/best practices/FAQ/releases, ArkTS rules/compile errors/crash patterns.",
    "search: Chinese/English full text, APIs, decorators, errors. read: id, section=heading. catalog: no parameters; rollback: restore previous pack, no parameters. status/update: check.",
    "source=cloud: only query; Huawei CodeGenie (auth provider=codegenie); labels: official (local_doc = matching document) / official_other_platform (not ArkTS) / community / unverified; full_artifact holds full answer (job action=read).",
    "Conflicts: SDK declarations (code lsp hover) and a successful build win, then official docs; community never defines the API.",
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
  description: "Built-ins: hmos-arkui-develop-skill (ArkTS/ArkUI gotchas/APIs), hmos-runtime-fix-skill (crash/white-screen diagnosis), deveco-mcp-workflow (tool choice). list/read; export: SKILL.md folders (scope=project: <project>/.agents/skills); install_mcp: host registration; init: export+install_mcp; search/install/uninstall: OpenHarmony market.",
  schema: z.object({
    action: z.enum(["list", "read", "export", "install_mcp", "init", "search", "install", "uninstall"]),
    name: z.string().optional(),
    reference: z.string().optional().describe("read: references/ file, e.g. quick-apis/01-layout.md (see list)"),
    host: z.string().optional().describe("cursor/claude/codex/opencode/trae-cn/codebuddy/qoder/pi: skills+MCP; deveco/atomcode/dsh: skills only"),
    force: z.boolean().optional().describe("install_mcp/init: overwrite an existing entry"),
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
    uninstall: ["name", "host", "scope", "project", "path"],
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
      case "uninstall": invariant(input.name && (input.host || input.path), "INVALID_INPUT", "name and host (or path) are required"); return skills.uninstallSkill(input.name, input.host, input.scope ?? "user", input.project, input.path);
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
    region: z.enum(["cn", "global"]).optional().describe("login: account site (default cn; global = overseas devecostudio.huawei.com)"),
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
