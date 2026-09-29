import { z } from "zod";
import { invariant } from "../core/errors.js";
import { fields, tool } from "../registry.js";

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
  description: "Check toolchain, SDK, devices, project, knowledge pack and logins in one call; every failed check includes a fix. Use first when anything environment-related fails.",
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
    "HarmonyOS project operations.",
    "info: read product/modules/SDK (instant).",
    "create: new app from the built-in template (does not overwrite).",
    "sync: ohpm install + hvigor sync (job).",
    "build: advisory ArkTS preflight + hvigor build (job); returns packages and structured compile errors with fix hints (hvigor decides; preflight findings never block).",
    "clean: hvigor clean.",
    "Build/sync return a job: if status is running, call job action=wait.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["info", "create", "sync", "build", "clean"]),
    project: fields.project,
    product: fields.product,
    modules: fields.modules,
    task: z.enum(["assembleHap", "assembleHar", "assembleHsp", "assembleApp", "compileNative"]).optional().describe("build: default assembleHap; compileNative compiles C/C++ only and writes .idea/.deveco/cxx/compile_commands.json for clangd"),
    mode: z.string().optional().describe("build: buildMode, default debug"),
    clean: z.boolean().optional().describe("build: clean first"),
    preflight: z.boolean().optional().describe("build: run the advisory ArkTS static check first (default true; reported, never blocks)"),
    app_name: z.string().optional().describe("create: display name"),
    bundle_name: z.string().optional().describe("create: e.g. com.example.demo"),
    sdk_version: z.string().optional().describe("create: compile SDK platform version, default installed SDK"),
    target_api: z.number().int().optional(),
    compatible_api: z.number().int().optional(),
    merge: z.boolean().optional().describe("create: allow a non-empty directory (never overwrites)"),
    request_key: fields.requestKey,
    wait: fields.wait,
  }),
  async handler(input) {
    const project = await import("../domains/project.js");
    switch (input.action) {
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
});
export const selectorSchema = z.object({
  text: z.string().optional().describe("Substring match (case-insensitive) unless exact=true"),
  exact: z.boolean().optional(),
  key: z.string().optional().describe("Component id/key set in ArkUI (.id('...'))"),
  type: z.string().optional().describe("Component type, e.g. Button, TextInput"),
  id: z.string().optional(),
  bundle: z.string().optional(),
  clickable: z.boolean().optional(),
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  enabled: z.boolean().optional(),
  index: z.number().int().min(0).optional().describe("Pick the n-th match when several match"),
}).meta({ id: "Selector" }); // emitted once per tool as $defs/Selector

export const runTool = tool({
  name: "run",
  title: "Deploy and launch",
  description: [
    "Put the app on a device. Multi-device apps (e.g. phone + watch entry modules): only the modules whose module.json5 deviceTypes match the target device are built and installed (pass modules/module to choose explicitly). Project signing (build-profile or hvigorfile overrides) is used as-is.",
    "build_run: build + install + launch + startup check (crash detection) — the usual 'run it' action.",
    "deploy: install already-built packages (latest outputs) + launch.",
    "launch: start the installed app. stop: force-stop. uninstall: remove the app.",
    "Pass assert to verify a UI outcome after launch (e.g. {visible:{text:'Welcome'}}).",
    "hot_reload=true on build_run installs a hot-reload build; then use hot_reload tool for instant updates.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["build_run", "deploy", "launch", "stop", "uninstall"]),
    project: fields.project,
    product: fields.product,
    modules: fields.modules,
    target: fields.target,
    mode: z.string().optional(),
    module: z.string().optional().describe("Module whose ability to launch (default: entry)"),
    ability: z.string().optional().describe("Ability to launch (default: module mainElement)"),
    assert: assertSchema.optional(),
    hot_reload: z.boolean().optional(),
    skip_build: z.boolean().optional().describe("build_run: deploy the latest built packages without building (same as action=deploy)"),
    uninstall_first: z.boolean().optional().describe("build_run/deploy: uninstall the app before installing (clears app data)"),
    request_key: fields.requestKey,
    wait: fields.wait,
  }),
  async handler(input, ctx) {
    if (input.action === "build_run" || input.action === "deploy")
      return startAndWait(input.action === "build_run" && input.skip_build ? "deploy" : input.action, input, input.request_key, input.wait ?? 3000);
    const { inspectProject, mainAbility } = await import("../domains/project.js");
    const device = await import("../domains/device.js");
    const project = inspectProject(input.project, input.product);
    const target = await device.resolveTarget(input.target, ctx.signal);
    invariant(project.bundleName, "PROJECT_INVALID", "bundleName missing in AppScope/app.json5");
    if (input.action === "stop") { await device.forceStop(target, project.bundleName, ctx.signal); return { stopped: project.bundleName }; }
    if (input.action === "uninstall") return device.uninstall(target, project.bundleName, ctx.signal);
    const { selectRunModules } = await import("../domains/project.js");
    const deviceType = input.module ? undefined : (await device.shell(target, ["param", "get", "const.product.devicetype"], ctx.signal, 10000).catch(() => undefined))?.stdout.trim();
    const entry = input.module ?? selectRunModules(project, { deviceType }).modules.find((m) => m.type === "entry")?.name;
    const main = mainAbility(project, entry);
    return device.launchAndCheck(target, project.bundleName, input.ability ?? main.ability, main.module, ctx.signal);
  },
});

export const jobTool = tool({
  name: "job",
  title: "Long-running jobs",
  description: "Track jobs started by project/run/ui_flow. wait: block up to wait ms (default 20000) for completion. status/list/cancel. resume: continue an interrupted or needs_input job (force=true re-runs an uncertain step after you inspected it). read: page a log/report artifact by line, optionally filtered with grep.",
  schema: z.object({
    action: z.enum(["wait", "status", "list", "cancel", "resume", "read"]),
    job_id: z.string().optional(),
    wait: z.number().int().min(0).max(60000).optional(),
    detail: z.boolean().optional(),
    force: z.boolean().optional(),
    status: z.string().optional().describe("list: filter by status"),
    limit: z.number().int().min(1).max(2000).optional(),
    artifact_id: z.string().optional().describe("read: artifact to read"),
    line: z.number().int().min(0).optional().describe("read: start line (0-based); use next_line from the previous page"),
    grep: z.string().optional().describe("read: regex filter, e.g. 'error|ERROR'"),
  }),
  async handler(input) {
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
  title: "Code intelligence & checks",
  readOnly: true,
  description: [
    "ArkTS/C++ code checks and language server queries against the project's SDK.",
    "check: fast ArkTS static check (files, or whole project) with error-fix hints — run after editing .ets files, before building. fix=true applies upstream safe auto-fixes.",
    "lint: Code Linter report. api_scan: API compatibility between SDK versions.",
    "lsp: hover (types/signatures), definition, implementation, references, symbols, workspace_symbols, diagnostics (multiple files), completion (available members), signature.",
    "Locate positions with symbol (plus optional line hint) instead of exact columns.",
    "lsp op=call_hierarchy direction=incoming|outgoing: callers / callees of a function (C/C++: incoming only). op=declaration differs from definition for ArkTS re-exports.",
    "lint: config_path, incremental (uncommitted files only), output_path. api_scan: modules or files, output_path. lsp_restart language=arkts|cpp|all. api_versions: SDK versions accepted by api_scan from/to.",
  ].join(" "),
  schema: z.object({
    action: z.enum(["check", "lint", "api_scan", "api_versions", "lsp", "lsp_restart"]),
    project: fields.project.optional().describe("Project root (required except for api_versions)"),
    files: z.array(z.string()).max(200).optional().describe("Relative or absolute paths"),
    fix: z.boolean().optional(),
    product: fields.product,
    op: z.enum(["hover", "definition", "declaration", "implementation", "references", "symbols", "workspace_symbols", "diagnostics", "completion", "signature", "call_hierarchy"]).optional().describe("lsp operation"),
    direction: z.enum(["incoming", "outgoing"]).optional().describe("call_hierarchy: incoming = callers (default), outgoing = callees"),
    file: z.string().optional(),
    symbol: z.string().optional().describe("Identifier to locate, e.g. 'pushUrl' or 'router.pushUrl'"),
    line: z.number().int().min(1).optional().describe("1-based line (hint when symbol is given)"),
    column: z.number().int().min(1).optional().describe("1-based column (only without symbol)"),
    query: z.string().optional().describe("workspace_symbols query"),
    language: z.enum(["arkts", "cpp", "all"]).optional().describe("lsp: server to use (default by file extension); lsp_restart: which to restart (default all)"),
    modules: fields.modules,
    output_path: z.string().optional().describe("lint/api_scan: also save the report to this absolute path"),
    config_path: z.string().optional().describe("lint: .json/.json5 rule config (default code-linter.json5)"),
    incremental: z.boolean().optional().describe("lint: only uncommitted files"),
    from: z.string().optional().describe("api_scan: source version e.g. HarmonyOS_5.0.0(12)_Release"),
    to: z.string().optional().describe("api_scan: target version"),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  async handler(input, ctx) {
    const code = await import("../domains/code.js");
    if (input.action === "api_versions") return { versions: code.apiVersions() };
    invariant(input.project, "INVALID_INPUT", "project is required");
    const project = input.project;
    switch (input.action) {
      case "check":
        if (input.files?.some((f) => /\.(c|cc|cpp|h|hpp)$/.test(f))) return code.cppCheck(project, input.files, ctx.signal);
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
  title: "Devices, logs, files",
  description: "HDC device access. list: connected devices. info: model/API/screen. log: recent hilog (filter by bundle, grep, level; from/to time window like from=5m to=1m; follow=true + cursor streams new lines across calls; clear=true clears). shell: read-only inspection commands (ls, cat, ps, param get, bm dump, hidumper...). sqlite: query an on-device database (db path + sql; JSON rows; read-only unless write=true). send/recv: transfer files.",
  schema: z.object({
    action: z.enum(["list", "info", "log", "shell", "sqlite", "send", "recv"]),
    db: z.string().optional().describe("sqlite: absolute device path, or an app RDB store name (e.g. app.db) together with bundle (+ module, default entry) of a debuggable app"),
    module: z.string().optional().describe("sqlite: module owning the RDB store (default entry)"),
    sql: z.string().max(20000).optional().describe("sqlite: SQL or .tables/.schema"),
    write: z.boolean().optional().describe("sqlite: allow modifying statements"),
    target: fields.target,
    bundle: z.string().optional().describe("log: only this app's process"),
    grep: z.string().optional().describe("log: regex filter"),
    level: z.enum(["D", "I", "W", "E", "F"]).optional().describe("log: minimum level"),
    lines: z.number().int().min(1).max(20000).optional(),
    clear: z.boolean().optional(),
    from: z.string().optional().describe("log: window start as time ago, e.g. 5m, 30s, 1h (device clock)"),
    to: z.string().optional().describe("log: window end as time ago (default now), e.g. 1m"),
    follow: z.boolean().optional().describe("log: only lines newer than cursor; waits up to wait_ms for new ones; returns the next cursor"),
    cursor: z.string().optional().describe("log follow: cursor from the previous response (omit on the first call)"),
    wait_ms: z.number().int().min(0).max(30000).optional().describe("log follow: max wait for new lines (default 5000)"),
    command: z.string().optional().describe("shell: read-only command line"),
    local: z.string().optional(),
    remote: z.string().optional(),
  }),
  async handler(input, ctx) {
    const device = await import("../domains/device.js");
    if (input.action === "list") {
      const targets = await device.listTargets(ctx.signal);
      return { devices: await Promise.all(targets.map((t) => device.deviceInfo(t, ctx.signal).catch(() => ({ target: t })))) };
    }
    const target = await device.resolveTarget(input.target, ctx.signal);
    switch (input.action) {
      case "info": return device.deviceInfo(target, ctx.signal);
      case "log": return input.clear ? device.clearLog(target, ctx.signal) : device.hilog(target, { lines: input.lines, bundle: input.bundle, grep: input.grep, level: input.level, from: input.from, to: input.to, follow: input.follow, cursor: input.cursor, wait_ms: input.wait_ms }, ctx.signal);
      case "shell": invariant(input.command, "INVALID_INPUT", "command is required"); return device.readonlyShell(target, input.command, ctx.signal);
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
    "Observe and operate the device UI.",
    "observe: screenshot + compact element list (#index Type [bounds] \"text\" key=..). screenshot / tree for one of them.",
    "find: elements matching a selector.",
    "act: click/double_click/long_click (selector or x,y), input (types text into a field; Chinese supported), type (into the focused field), swipe/drag/fling (x,y,x2,y2), scroll (direction), key (back/home/enter/...; keys=[\"ctrl\",\"a\"] for chords up to 3), mouse_click/mouse_double_click/mouse_long_click (button, keys modifiers), mouse_move, mouse_scroll (direction up/down, ticks), mouse_drag (x2,y2) for 2in1/tablet. verify_change=true reports whether the screen changed.",
    "assert: wait until a selector is visible/hidden — use this to verify outcomes, not screenshots.",
    "windows: list app windows (all=true includes system windows); tree/observe accept window id and depth; tree all_windows=true merges every window, node=<id> returns one component subtree; screenshot display=<id>, save_path.",
    "record_start/record_stop/record_status: screen recording to mp4 (real devices; stop discard=true drops it, external=true stops a foreign recording).",
    "UI test sessions (you execute the plan and judge visuals): test_start(plan, project or bundle, fresh_start) -> test_step(op+selector or visible/hidden assert, description) per item -> review(requirement) returns a screenshot, then review(outcome, reason) -> test_finish -> test_log / test_export(directory).",
  ].join(" "),
  schema: z.object({
    action: z.enum(["observe", "screenshot", "tree", "find", "act", "assert", "windows", "record_start", "record_stop", "record_status",
      "test_start", "test_step", "review", "test_finish", "test_log", "test_export"]),
    target: fields.target,
    window: z.number().int().optional().describe("tree/observe: window id from action=windows"),
    all_windows: z.boolean().optional().describe("tree: every window on every display (not with window)"),
    node: z.string().optional().describe("tree: only the component with this id/key and its subtree"),
    display: z.number().int().optional().describe("screenshot: display id (multi-screen devices)"),
    save_path: z.string().optional().describe("screenshot/record_stop: also save the file to this absolute path (file or directory)"),
    depth: z.number().int().min(0).max(100).optional().describe("tree/observe: maximum depth"),
    all: z.boolean().optional().describe("windows: include system windows"),
    discard: z.boolean().optional().describe("record_stop: stop without downloading"),
    external: z.boolean().optional().describe("record_stop: stop a recording started outside this server"),
    test_id: z.string().optional(),
    plan: z.string().max(20000).optional().describe("test_start: natural-language test plan with steps and expected results"),
    project: z.string().optional().describe("test_start: project root to infer bundle/ability"),
    fresh_start: z.boolean().optional().describe("test_start: restart the app first"),
    description: z.string().max(500).optional().describe("test_step: which checklist item this is"),
    requirement: z.string().max(2000).optional().describe("review: what the screen must show"),
    outcome: z.enum(["passed", "failed", "insufficient"]).optional().describe("review: your visual judgement"),
    reason: z.string().max(2000).optional(),
    review_id: z.number().int().optional(),
    directory: z.string().optional().describe("test_export: absolute output directory"),
    max_chars: z.number().int().min(-1).optional().describe("test_log: -1 = unlimited, default 5000"),
    grep: z.string().optional().describe("test_log: keyword/regex filter"),
    selector: selectorSchema.optional(),
    op: z.enum(["click", "double_click", "long_click", "input", "type", "swipe", "drag", "fling", "scroll", "key",
      "mouse_click", "mouse_double_click", "mouse_long_click", "mouse_move", "mouse_scroll", "mouse_drag"]).optional().describe("act operation"),
    keys: z.array(z.string()).min(1).max(3).optional().describe("key: chord like [\"ctrl\",\"c\"]; mouse_*: up to 2 modifier keys"),
    button: z.enum(["left", "right", "middle"]).optional().describe("mouse click button"),
    ticks: z.number().int().min(1).max(50).optional().describe("mouse_scroll wheel ticks (default 3)"),
    verify_change: z.boolean().optional().describe("act: wait up to 3s and report whether the screen changed"),
    x: z.number().int().optional(), y: z.number().int().optional(), x2: z.number().int().optional(), y2: z.number().int().optional(),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    text: z.string().optional(),
    append: z.boolean().optional().describe("input: keep existing text (default replaces it)"),
    key: z.string().optional().describe("back, home, power, enter, delete, tab, volume_up... or numeric keycode"),
    speed: z.number().int().min(200).max(40000).optional(),
    visible: selectorSchema.optional(),
    hidden: selectorSchema.optional(),
    timeout_ms: z.number().int().min(100).max(120000).optional(),
    interactive: z.boolean().optional().describe("observe/tree: only interactive or labelled elements (default true)"),
    bundle: z.string().optional().describe("observe/tree: only this app's elements"),
    format: z.enum(["jpeg", "png"]).optional(),
    width: z.number().int().min(240).max(2560).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
  }),
  async handler(input, ctx) {
    const { resolveTarget } = await import("../domains/device.js");
    const ui = await import("../domains/ui.js");
    const uitest = () => import("../domains/uitest.js");
    // Test log/finish/export work from stored state and must not require a connected device.
    if (input.action === "test_log" || input.action === "test_finish" || input.action === "test_export") {
      invariant(input.test_id, "INVALID_INPUT", "test_id is required");
      const t = await uitest();
      if (input.action === "test_finish") return t.finishTest(input.test_id);
      if (input.action === "test_log") return t.testLog(input.test_id, { grep: input.grep, max_chars: input.max_chars });
      invariant(input.directory, "INVALID_INPUT", "directory is required");
      return t.exportTest(input.test_id, input.directory);
    }
    const target = await resolveTarget(input.target, ctx.signal);
    const scope = { window: input.window };
    switch (input.action) {
      case "windows": return { windows: await ui.listWindows(target, input.all, ctx.signal) };
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
        const action = input.op ? await buildAction(input, target, ui, ctx.signal) : undefined;
        const assert = input.visible || input.hidden ? { visible: input.visible, hidden: input.hidden, timeout_ms: input.timeout_ms } : undefined;
        return (await uitest()).testStep(input.test_id, { description: input.description, action: action?.action, selector: input.selector, assert }, ctx.signal);
      }
      case "review": {
        invariant(input.test_id, "INVALID_INPUT", "test_id is required");
        return (await uitest()).review(input.test_id, { requirement: input.requirement, outcome: input.outcome, reason: input.reason, review_id: input.review_id }, ctx.signal);
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
        const { action, resolved } = await buildAction(input, target, ui, ctx.signal);
        const result = input.verify_change ? await ui.actAndVerify(target, action, ctx.signal) : await ui.act(target, action, ctx.signal);
        const { recordStep } = await import("../domains/flows.js");
        const { deviceInfo } = await import("../domains/device.js");
        const recorded = await recordStep(target, action, input.selector, await screenSize(target, deviceInfo, ctx.signal)).catch(() => undefined);
        return { ...result, ...(resolved ? { element: resolved } : {}), ...(recorded ?? {}), note: "Action sent; verify with ui assert or observe" };
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
  title: "Record & replay UI flows",
  description: "Reusable UI paths stored in <project>/.arkpilot/flows. list; show; record (start recording, then use ui act with selectors); stop (save with a final assert proving the goal, or discard=true); replay (restart app, run steps, check the assert — job; repair=true promotes working alternates); delete.",
  schema: z.object({
    action: z.enum(["list", "show", "record", "stop", "replay", "delete"]),
    project: fields.project,
    target: fields.target,
    id: z.string().optional().describe("Flow id: lowercase letters, digits, - and _"),
    name: z.string().optional(),
    variables: z.record(z.string(), z.string()).optional().describe("replay: values for ${var} inputs"),
    assert: assertSchema.optional().describe("stop: final assert required to save"),
    discard: z.boolean().optional(),
    repair: z.boolean().optional(),
    request_key: fields.requestKey,
    wait: fields.wait,
  }),
  async handler(input, ctx) {
    const flows = await import("../domains/flows.js");
    switch (input.action) {
      case "list": return { flows: flows.listFlows(input.project) };
      case "show": invariant(input.id, "INVALID_INPUT", "id is required"); return flows.readFlow(input.project, input.id);
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
        return flows.stopRecording(await resolveTarget(input.target, ctx.signal), { assert: input.assert, discard: input.discard }, ctx.signal);
      }
      case "replay":
        invariant(input.id, "INVALID_INPUT", "id is required");
        return startAndWait("flow_replay", { project: input.project, target: input.target, id: input.id, variables: input.variables ?? {}, repair: input.repair ?? false }, input.request_key, input.wait ?? 5000);
    }
  },
});

export const diagnoseTool = tool({
  name: "diagnose",
  title: "Crash & failure diagnosis",
  readOnly: true,
  description: "crash: read the latest jscrash/cppcrash/appfreeze report from the device (or analyze pasted log text), extract error type/message/code/app frames, and match the HarmonyOS fault-pattern library for likely causes and fixes. build: explain build/check diagnostics with fix hints.",
  schema: z.object({
    action: z.enum(["crash", "build"]),
    target: fields.target,
    bundle: z.string().optional().describe("crash: only reports of this app"),
    log: z.string().max(4_000_000).optional().describe("crash: analyze this text instead of reading the device"),
    name: z.string().optional().describe("crash: exact faultlog file name"),
    latest: z.number().int().min(1).max(5).optional(),
    since_minutes: z.number().int().min(1).max(10080).optional().describe("crash: only reports from the last N minutes (device clock)"),
    diagnostics: z.array(z.object({ code: z.string().optional(), message: z.string() })).max(100).optional().describe("build: diagnostics to explain"),
  }),
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
  title: "HarmonyOS knowledge",
  readOnly: true,
  description: [
    "Offline HarmonyOS docs (guides, API reference, best practices, FAQ, release notes) plus ArkTS rules, compile-error cases and runtime crash patterns, from an updatable knowledge pack.",
    "search: full-text (Chinese or English; use API names, decorators, error codes). read: a document by id (section= for one heading).",
    "catalog/status: pack info. update: download the latest pack (check=true only checks). rollback: previous pack.",
    "source=cloud: search Huawei's online CodeGenie knowledge (needs auth provider=codegenie).",
  ].join(" "),
  schema: z.object({
    action: z.enum(["search", "read", "catalog", "status", "update", "rollback"]),
    query: z.string().optional(),
    id: z.string().optional(),
    section: z.string().optional(),
    catalog: z.enum(["all", "harmonyos-guides", "harmonyos-references", "best-practices", "harmonyos-faqs", "harmonyos-releases", "harmonyos-roadmap", "rules", "errors", "runtime", "skills"]).optional(),
    kind: z.enum(["all", "docs", "rules"]).optional().describe("docs = official docs, rules = ArkTS rules/cases/patterns"),
    source: z.enum(["local", "cloud"]).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(40000).optional(),
    check: z.boolean().optional(),
    version: z.string().optional().describe("update: specific version"),
    file: z.string().optional().describe("update: install from a local .tgz pack, or 'upstream' to build one from Huawei's latest docs package"),
    force: z.boolean().optional(),
  }),
  async handler(input, ctx) {
    const kb = await import("../domains/knowledge.js");
    switch (input.action) {
      case "search":
        invariant(input.query, "INVALID_INPUT", "query is required");
        if (input.source === "cloud") return kb.cloudSearch(input.query, ctx.signal);
        return kb.search(input.query, { catalog: input.catalog, kind: input.kind, limit: input.limit, offset: input.offset });
      case "read":
        invariant(input.id, "INVALID_INPUT", "id is required");
        return kb.read(input.id, { offset: input.offset, limit: input.limit, section: input.section });
      case "catalog": return kb.catalog();
      case "status": return kb.status(input.check ?? true);
      case "update":
        // Downloads can take minutes on slow networks: run as a job and return early.
        return input.check ? kb.status(true) : startAndWait("kb_update", { version: input.version, source: input.file, force: input.force }, undefined, input.limit ?? 20000);
      case "rollback": return kb.rollback();
    }
  },
});

export const skillsTool = tool({
  name: "skills",
  title: "HarmonyOS skills",
  readOnly: false,
  description: "Built-in HarmonyOS skills: hmos-arkui-develop-skill (ArkTS/ArkUI gotchas + API quick reference, from DevEco Code), hmos-runtime-fix-skill (crash/white-screen diagnosis + fault pattern library), deveco-mcp-workflow (which deveco tool to use when). list/read; export: install them as native SKILL.md folders (scope=project writes <project>/.agents/skills, shared by Codex, Claude Code, Cursor, Qoder, OpenCode). install_mcp: register this MCP server in a host's config (idempotent; force overwrites). init: export + install_mcp. search/install/uninstall: OpenHarmony skill market (matrix.openharmony.cn).",
  schema: z.object({
    action: z.enum(["list", "read", "export", "install_mcp", "init", "search", "install", "uninstall"]),
    name: z.string().optional(),
    reference: z.string().optional().describe("read: a file under references/, e.g. quick-apis/01-layout.md (see list)"),
    host: z.string().optional().describe("cursor | claude | codex | opencode | trae-cn | codebuddy | qoder | pi | deveco (skills only)"),
    force: z.boolean().optional().describe("install_mcp/init: overwrite an existing entry"),
    path: z.string().optional().describe("export/install/uninstall/init: explicit absolute skills directory instead of host/scope"),
    scope: z.enum(["user", "project"]).optional(),
    project: z.string().optional(),
    names: z.array(z.string()).optional(),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
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
  description: "Browser login to Huawei developer services. provider=codegenie: cloud knowledge search. provider=developer: signing (certificates, profiles, devices). login returns a URL (opened automatically); call status after finishing in the browser. teams lists developer teams. import migrates v0.x credentials from legacy_state_dir.",
  schema: z.object({
    action: z.enum(["login", "status", "logout", "teams", "import"]),
    provider: z.enum(["developer", "codegenie"]).optional(),
    region: z.enum(["cn", "global"]).optional().describe("login: account site (default cn; global = overseas devecostudio.huawei.com)"),
    open_browser: z.boolean().optional(),
    legacy_state_dir: z.string().optional(),
  }),
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
