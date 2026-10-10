import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { artifactPath, commitArtifact } from "../core/artifacts.js";
import { config, packageRoot } from "../core/config.js";
import { invariant, ToolError } from "../core/errors.js";
import { fileSha256, inside, isFile, readJson5, walk } from "../core/files.js";
import { run } from "../core/proc.js";
import { sdkInfo, toolCommand, toolchain } from "../core/toolchain.js";

export interface Module {
  name: string;
  root: string;
  type: "entry" | "feature" | "har" | "shared" | "unknown";
  target: string;
  /** module.json5 deviceTypes ("phone", "wearable", "default" = phone...) */
  deviceTypes: string[];
}
export interface Project {
  root: string;
  product: string;
  products: string[];
  compileSdk?: string;
  targetSdk?: string;
  compatibleSdk?: string;
  modules: Module[];
  bundleName?: string;
  /** debug, release and the build-profile buildModeSet names */
  buildModes?: string[];
}

/**
 * `modules` entries may be `name` or `name@target` (like devecocli --module). Returns plain names
 * plus the explicit targets, which inspectProject applies.
 */
export function parseModuleSpecs(specs: string[] | undefined) {
  const targets: Record<string, string> = {};
  const names = specs?.map((s) => {
    const at = s.indexOf("@");
    if (at <= 0) return s;
    targets[s.slice(0, at)] = s.slice(at + 1);
    return s.slice(0, at);
  });
  return { names, targets };
}

/** inspectProject for a tool input carrying project/product/modules (with optional @target). */
export function projectFor(input: { project: string; product?: string; modules?: string[] }) {
  const { names, targets } = parseModuleSpecs(input.modules);
  return { project: inspectProject(input.project, input.product, targets), modules: names };
}

type Profile = {
  app?: {
    products?: { name: string; compileSdkVersion?: unknown; compatibleSdkVersion?: unknown; targetSdkVersion?: unknown }[];
    compileSdkVersion?: unknown; compatibleSdkVersion?: unknown; targetSdkVersion?: unknown;
    buildModeSet?: { name: string }[];
  };
  modules?: { name: string; srcPath: string; targets?: { name: string; applyToProducts?: string[] }[] }[];
};

/** Read the project model from build-profile.json5 (cheap; no SDK needed). */
export function inspectProject(projectPath: string, productName?: string, targets: Record<string, string> = {}): Project {
  const root = path.resolve(projectPath);
  const profileFile = path.join(root, "build-profile.json5");
  invariant(isFile(profileFile), "PROJECT_INVALID", `${root} is not a HarmonyOS project (build-profile.json5 missing)`,
    undefined, "Pass the project root, or create one with project action=create");
  const profile = readJson5(profileFile) as Profile;
  const products = profile.app?.products ?? [];
  invariant(products.length > 0, "PROJECT_INVALID", "build-profile.json5 declares no products");
  const product = productName
    ? products.find((p) => p.name === productName)
    : products.find((p) => p.name === "default") ?? (products.length === 1 ? products[0] : undefined);
  invariant(product, "PRODUCT_AMBIGUOUS", productName ? `Unknown product ${productName}` : "Several products exist; pass product",
    { products: products.map((p) => p.name) });
  const modules: Module[] = [];
  for (const item of profile.modules ?? []) {
    const applicable = item.targets?.filter((t) => !t.applyToProducts || t.applyToProducts.includes(product.name)) ?? [{ name: "default" }];
    if (!applicable.length) continue;
    const wanted = targets[item.name];
    const target = wanted
      ? applicable.find((t) => t.name === wanted)
      : applicable.find((t) => t.name === "default") ?? applicable[0];
    invariant(target, "INVALID_INPUT", `Target ${item.name}@${wanted} does not apply to product ${product.name}`,
      { targets: applicable.map((t) => t.name) }, `Use one of: ${applicable.map((t) => `${item.name}@${t.name}`).join(", ")}`);
    const moduleRoot = inside(root, item.srcPath);
    let type: Module["type"] = "unknown";
    let deviceTypes: string[] = [];
    const manifest = path.join(moduleRoot, "src/main/module.json5");
    if (isFile(manifest)) {
      const m = readJson5(manifest).module as { type?: Module["type"]; deviceTypes?: string[] } | undefined;
      type = m?.type ?? "unknown";
      deviceTypes = m?.deviceTypes ?? [];
    }
    modules.push({ name: item.name, root: moduleRoot, type, target: target.name, deviceTypes });
  }
  let bundleName: string | undefined;
  const app = path.join(root, "AppScope/app.json5");
  if (isFile(app)) bundleName = (readJson5(app).app as { bundleName?: string } | undefined)?.bundleName;
  const text = (value: unknown) => (value === undefined ? undefined : String(value));
  const unknownTargets = Object.keys(targets).filter((n) => !(profile.modules ?? []).some((m) => m.name === n));
  invariant(!unknownTargets.length, "INVALID_INPUT", `Unknown modules: ${unknownTargets.join(", ")}`, { modules: (profile.modules ?? []).map((m) => m.name) });
  return {
    root, product: product.name, products: products.map((p) => p.name),
    buildModes: [...new Set(["debug", "release", ...(profile.app?.buildModeSet ?? []).map((m) => m.name)])],
    compileSdk: text(product.compileSdkVersion ?? profile.app?.compileSdkVersion),
    targetSdk: text(product.targetSdkVersion ?? profile.app?.targetSdkVersion),
    compatibleSdk: text(product.compatibleSdkVersion ?? profile.app?.compatibleSdkVersion),
    modules, bundleName,
  };
}

/** Device types any runnable (entry/feature) module of the project supports. */
export function runnableDeviceTypes(project: Project) {
  return [...new Set(project.modules.filter((m) => m.type === "entry" || m.type === "feature").flatMap((m) => m.deviceTypes.map(normalizeDeviceType)))];
}

/** Device type as used in module.json5 ("default" is the phone type). */
export function normalizeDeviceType(type: string) {
  const t = type.trim().toLowerCase();
  return t === "default" ? "phone" : t === "2in1" || t === "pc" ? "2in1" : t;
}

/**
 * Which runnable modules (entry/feature, plus the HSPs they need) to build and install.
 * A HarmonyOS app may carry one entry per device class (phone + watch...). Installing packages
 * made for another device class is rejected by the device, so:
 *   - explicit `modules` always win (and must be runnable),
 *   - otherwise pick the entry/feature modules whose deviceTypes include the device's type,
 *   - with exactly one runnable module, that one.
 * Ambiguity (several candidates and no device type) is an error listing the choices.
 */
export function selectRunModules(project: Project, options: { modules?: string[]; deviceType?: string }) {
  const runnable = project.modules.filter((m) => m.type === "entry" || m.type === "feature");
  if (options.modules?.length) {
    const unknown = options.modules.filter((n) => !project.modules.some((m) => m.name === n));
    invariant(!unknown.length, "INVALID_INPUT", `Unknown modules: ${unknown.join(", ")}`, { runnable: runnable.map((m) => m.name) });
    const chosen = project.modules.filter((m) => options.modules!.includes(m.name) && (m.type === "entry" || m.type === "feature" || m.type === "shared"));
    invariant(chosen.some((m) => m.type === "entry" || m.type === "feature"), "INVALID_INPUT", "modules must include an entry or feature module", { runnable: runnable.map((m) => m.name) });
    // Refuse before touching the device: e.g. the watch HAP on a phone is rejected by the device anyway.
    const type = options.deviceType ? normalizeDeviceType(options.deviceType) : undefined;
    const wrong = type ? chosen.filter((m) => m.type !== "shared" && m.deviceTypes.length && !m.deviceTypes.map(normalizeDeviceType).includes(type)) : [];
    invariant(!wrong.length, "DEVICE_MISMATCH", `${wrong.map((m) => `${m.name} (${m.deviceTypes.join("/")})`).join(", ")} cannot run on this ${type} device`,
      { device_type: type, modules: runnable.map((m) => ({ name: m.name, deviceTypes: m.deviceTypes })) },
      `Choose the module for this device, or connect a matching device (target=...)`);
    return { modules: chosen, reason: "explicit" };
  }
  invariant(runnable.length, "PROJECT_INVALID", "Project has no entry/feature module to run");
  if (runnable.length === 1) return { modules: runnable, reason: "only runnable module" };
  const type = options.deviceType ? normalizeDeviceType(options.deviceType) : undefined;
  const byDevice = type ? runnable.filter((m) => m.deviceTypes.map(normalizeDeviceType).includes(type)) : [];
  if (byDevice.length) {
    // One entry per device class; features only when they target the same device.
    const entries = byDevice.filter((m) => m.type === "entry");
    invariant(entries.length <= 1, "INVALID_INPUT", `Several entry modules support ${type}; pass modules`, { candidates: entries.map((m) => m.name) });
    return { modules: byDevice, reason: `deviceTypes include ${type}` };
  }
  throw new ToolError("INVALID_INPUT", type ? `No runnable module supports device type ${type}` : "Several runnable modules; pass modules",
    { runnable: runnable.map((m) => ({ name: m.name, type: m.type, deviceTypes: m.deviceTypes })) },
    "Pass modules=[\"<module>\"] (e.g. the phone or the watch entry)");
}

export function mainAbility(project: Project, moduleName?: string) {
  const module = moduleName ? project.modules.find((m) => m.name === moduleName) : project.modules.find((m) => m.type === "entry");
  invariant(module, "INVALID_INPUT", moduleName ? `Unknown module ${moduleName}` : "No entry module found");
  const manifest = readJson5(path.join(module.root, "src/main/module.json5")).module as { name: string; mainElement?: string; abilities?: { name: string }[] };
  const ability = manifest.mainElement ?? manifest.abilities?.[0]?.name;
  invariant(ability, "PROJECT_INVALID", `Module ${module.name} declares no ability`);
  return { module: manifest.name, ability };
}

/* ----------------------------- build diagnostics ----------------------------- */

export interface Diagnostic {
  severity: "error" | "warning";
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
}

/**
 * An API the compiler flags as "not supported on all devices" of the module's deviceTypes (hvigor:
 * "The system capacity of this api 'X' is not supported on all devices"). It compiles, but calling it
 * on a device without the capability crashes (verified: TypeError on a phone for a 2in1-only kit) unless
 * the call is guarded with canIUse('SystemCapability....'); the compiler recognises that guard and then
 * no longer warns (verified), so each entry is an unguarded call.
 */
export interface DeviceApiWarning { api: string; file: string; line: number; column: number }

/**
 * Streaming parser for hvigor/ArkTS output. Recognised forms (verified on hvigor 26 logs):
 *   `N ERROR: 10605040 ArkTS Compiler Error` + `Error Message: <msg> At File: <path>:<line>:<col>`  (one per error)
 *   `N WARN: ArkTS:WARN File: <path>:<line>:<col>` + message line
 *   `> hvigor ERROR: 00306003 Specification Limit Violation` + `Error Message: <cause>` (+ `. At file: <path>:<line>`)
 *   `> hvigor ERROR: Failed :<module>:<target>@<Task>...`  (failed task, kept apart)
 * Every error is counted; the list is bounded (`limit`) and the rest stays in the log artifact.
 */
export class BuildOutputParser {
  readonly diagnostics: Diagnostic[] = [];
  readonly deviceApis: DeviceApiWarning[] = [];
  readonly failedTasks: string[] = [];
  counts = { error: 0, warning: 0 };
  private pending?: Diagnostic & { title?: string };
  private seen = new Set<string>();
  constructor(private readonly root: string, private readonly limit = 100) {}
  line(raw: string) {
    const text = raw.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (!text) return;
    const failed = /^>?\s*hvigor ERROR:\s*Failed :(\S+?)\.*\s*$/.exec(text);
    if (failed) { this.flush(); this.failedTasks.push(failed[1]!); return; }
    // Numbered compiler entry: "12 ERROR: 10605040 ArkTS Compiler Error" / "3 WARN: ArkTS:WARN File: ..."
    const numbered = /^\d+\s+(ERROR|WARN):\s*(\d{8})?\s*(.*)$/.exec(text);
    const arkts = /ArkTS:(ERROR|WARN)\b/.exec(text);
    // hvigor-level: "> hvigor ERROR: 00306003 Specification Limit Violation"; packaging/signing tools
    // print the same shape without the prefix: "ERROR: 11013002 Certificate format is incorrect, ..."
    const hvigorError = /^>?\s*(?:hvigor )?ERROR:\s*(?:(\d{8})\s+)?(.*)$/.exec(text);
    if (numbered || arkts || (hvigorError && hvigorError[1])) {
      this.flush();
      const severity = (numbered?.[1] ?? arkts?.[1] ?? "ERROR") === "ERROR" ? "error" : "warning";
      const code = numbered?.[2] ?? hvigorError?.[1] ?? /(\d{8})/.exec(text)?.[1];
      const title = (numbered?.[3] ?? hvigorError?.[2] ?? "").replace(/^ArkTS:(ERROR|WARN)\s*/, "").replace(/File:.*$/, "").trim();
      this.pending = { severity, message: "", ...(code ? { code } : {}), ...(title ? { title } : {}) };
      this.attachFile(text);
      return;
    }
    if (this.pending) {
      const message = /^Error Message:\s*(.*)$/.exec(text)?.[1];
      if (message !== undefined) {
        const at = /\s*\.?\s*At File:\s*(.+?):(\d+)(?::(\d+))?\s*$/i.exec(message);
        this.pending.message = (at ? message.slice(0, at.index) : message).trim();
        if (at) this.attachFile(`File: ${at[1]}:${at[2]}:${at[3] ?? 0}`);
        return;
      }
      if (/^\.?\s*At file:/i.test(text) || (/^(?:At File|File):/.test(text) && !this.pending.file)) { this.attachFile(text); return; }
      if (/^(COMPILE RESULT|>|\* Try|Error Code|\d+\s+(ERROR|WARN):)/.test(text)) this.flush();
      else if (!this.pending.message) { this.pending.message = text; return; }
      else if (/^(Solution|Cause|Detail|More info|>)/i.test(text)) { this.flush(); return; }
      else { this.flush(); }
    }
    const native = /^(.+\.(?:cpp|cc|c|h|hpp)):(\d+):(\d+):\s*(?:fatal )?error:\s*(.+)$/.exec(text);
    if (native) this.push({ severity: "error", file: this.relative(native[1]!), line: +native[2]!, column: +native[3]!, message: native[4]! });
    // "Tools execution failed." only says a packaging tool (signer, packer) failed: its own coded ERROR carries the cause.
    else if (/^>?\s*hvigor ERROR:\s*Tools execution failed/.test(text)) this.toolsFailed = true;
    else if (/^>?\s*hvigor ERROR:/.test(text) && !/BUILD FAILED|ArkTS Compiler Error\s*$/.test(text)) this.push({ severity: "error", message: text.replace(/^>?\s*hvigor ERROR:\s*/, "") });
    else if (/error TS\d+/.test(text)) this.push({ severity: "error", message: text });
  }
  private attachFile(text: string) {
    if (!this.pending || this.pending.file) return;
    const at = /(?:At File|File|At file):\s*(.+?):(\d+)(?::(\d+))?\s*$/i.exec(text);
    if (at) Object.assign(this.pending, { file: this.relative(at[1]!), line: +at[2]!, column: +(at[3] ?? 0) });
  }
  private relative(file: string) {
    // hvigor prints real paths (/private/var/... for /var/... on macOS): compare against the real root too.
    this.realRoot ??= (() => { try { return fs.realpathSync(this.root); } catch { return this.root; } })();
    for (const root of [this.root, this.realRoot]) {
      const rel = path.relative(root, file);
      // Always forward slashes: stable across platforms (Windows hvigor prints either separator).
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
    }
    return file;
  }
  private realRoot?: string;
  private toolsFailed = false;
  private push(d: Diagnostic) {
    const key = `${d.file}:${d.line}:${d.column}:${d.message}`;
    if (this.seen.has(key)) return;
    this.counts[d.severity]++;
    // Errors are never crowded out by warnings: warnings only fill what errors leave. Build-level errors
    // (no file: failed configuration, invalid path...) always get listed, however many compile errors came first.
    const fileErrors = this.diagnostics.filter((x) => x.severity === "error" && x.file).length;
    if (d.severity === "warning" ? this.diagnostics.length >= Math.min(this.limit, 30) : d.file && fileErrors >= this.limit) return;
    this.seen.add(key);
    this.diagnostics.push(d);
  }
  private flush() {
    const p = this.pending;
    this.pending = undefined;
    if (!p) return;
    const { title, ...d } = p;
    // "ArkTS Compiler Error" is a category, not a message: the Error Message line carries the cause.
    const generic = !title || /^ArkTS Compiler Error$/i.test(title);
    d.message = d.message ? (generic ? d.message : `${title}: ${d.message}`) : (title || "(no message)");
    const api = /system capacity of this api '([^']+)' is not supported on all devices/.exec(d.message)?.[1];
    if (api && d.file) this.deviceApis.push({ api, file: d.file, line: d.line ?? 0, column: d.column ?? 0 });
    this.push(d);
  }
  finish() {
    this.flush();
    // The generic line only when no tool printed its own coded cause.
    if (this.toolsFailed && !this.diagnostics.some((d) => d.severity === "error" && !d.file))
      this.push({ severity: "error", message: `Tools execution failed.${this.failedTasks.length ? ` (${this.failedTasks.at(-1)})` : ""}` });
    // Errors first so the host sees blocking issues immediately.
    this.diagnostics.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
    // Build-level errors first (they explain why the build stopped), then compile errors by file.
    this.diagnostics.sort((a, b) => (a.severity !== b.severity ? (a.severity === "error" ? -1 : 1) : a.file && !b.file ? 1 : !a.file && b.file ? -1 : 0));
    const listedErrors = this.diagnostics.filter((d) => d.severity === "error").length;
    return {
      counts: this.counts, diagnostics: this.diagnostics, device_apis: this.deviceApis,
      ...(this.failedTasks.length ? { failed_tasks: [...new Set(this.failedTasks)] } : {}),
      ...(this.counts.error > listedErrors ? { more_errors: this.counts.error - listedErrors } : {}),
      ...(this.deviceApis.length ? { device_compat: summarizeDeviceApis(this.deviceApis) } : {}),
    };
  }
}

/**
 * Compact summary of "not supported on all devices" warnings: the project's own code first (grouped
 * by API with every location, bounded), dependencies (oh_modules) only counted, since the app cannot
 * change them. Data comes verbatim from the compiler; nothing is inferred.
 */
export function summarizeDeviceApis(items: DeviceApiWarning[], maxApis = 40, maxLocations = 8) {
  const own = items.filter((w) => !/(^|[\\/])oh_modules[\\/]/.test(w.file));
  const deps = items.length - own.length;
  const byApi = new Map<string, DeviceApiWarning[]>();
  for (const w of own) { const list = byApi.get(w.api); if (list) list.push(w); else byApi.set(w.api, [w]); }
  const apis = [...byApi.entries()].sort((a, b) => b[1].length - a[1].length);
  return {
    project_warnings: own.length,
    dependency_warnings: deps,
    files: new Set(own.map((w) => w.file)).size,
    apis: apis.slice(0, maxApis).map(([api, list]) => ({ api, count: list.length, at: list.slice(0, maxLocations).map((w) => `${w.file}:${w.line}:${w.column}`) })),
    ...(apis.length > maxApis ? { more_apis: apis.length - maxApis } : {}),
    note: "Calls to APIs that not every device in the module's deviceTypes supports, made without a canIUse guard (the compiler drops the warning once the call is inside if (canIUse('SystemCapability.…'))). On a device without the capability they crash at runtime. Fix: wrap each location in canIUse (the capability name is in code action=lsp op=diagnostics for that file), or move the code to a module whose deviceTypes all support it. Only files compiled in this build are reported: an incremental build with no changes reports none.",
  };
}

/* --------------------------------- hvigor --------------------------------- */

async function hvigor(project: Project, args: string[], signal: AbortSignal, label: string, jobId?: string) {
  const { id, file } = artifactPath();
  const parser = new BuildOutputParser(project.root);
  const daemon = (config() as { hvigor_daemon?: boolean }).hvigor_daemon === true;
  const cmd = toolCommand("hvigor", [...args, daemon ? "--daemon" : "--no-daemon", "--parallel", "--incremental", "--analyze=normal"], project.root);
  try {
    const result = await run(cmd, { signal, timeoutMs: 30 * 60000, logFile: file, keepBytes: 64 * 1024, allowFailure: true, onLine: (line) => parser.line(line) });
    const log = await commitArtifact(id, file, "text/plain", jobId);
    const parsed = parser.finish();
    if (result.code !== 0) {
      // The code at the first few error locations, so the fix needs no extra file read.
      const { snippet } = await import("./sourcemap.js");
      let shown = 0;
      for (const d of parsed.diagnostics) {
        if (shown >= 5 || d.severity !== "error" || !d.file || !d.line) continue;
        const lines = snippet(path.isAbsolute(d.file) ? d.file : path.join(project.root, d.file), d.line, 2);
        if (lines.length) { (d as Diagnostic & { source?: string[] }).source = lines; shown++; }
      }
      throw new ToolError("BUILD_FAILED", `${label} failed (${parsed.counts.error} errors)`, {
        ...parsed, device_apis: undefined, device_compat: undefined, log_artifact: log.artifact_id, elapsed_ms: result.elapsedMs,
        ...(parsed.diagnostics.length ? {} : { tail: (result.stderr || result.stdout).slice(-3000) }),
      }, "Fix the listed diagnostics (knowledge search with the error code helps), then build again. Read the full log with job read artifact_id=" + log.artifact_id);
    }
    return { ...parsed, log_artifact: log.artifact_id, elapsed_ms: result.elapsedMs };
  } catch (error) {
    if (!(error instanceof ToolError && error.code === "BUILD_FAILED")) await commitArtifact(id, file, "text/plain", jobId).catch(() => {});
    throw error;
  }
}

/** Hash of every dependency manifest (root + modules) and build-profile.json5. */
export function dependencyStamp(project: Project) {
  const files = [path.join(project.root, "oh-package.json5"), path.join(project.root, "build-profile.json5"),
    ...project.modules.map((m) => path.join(m.root, "oh-package.json5"))];
  const h = crypto.createHash("sha256");
  for (const f of files) { h.update(f); try { h.update(fs.readFileSync(f)); } catch { h.update("-"); } }
  return h.digest("hex");
}
const stampFile = (project: Project) => path.join(project.root, ".hvigor", "deveco-mcp-deps.sha256");
export function readDependencyStamp(project: Project) {
  try { return fs.readFileSync(stampFile(project), "utf8").trim(); } catch { return undefined; }
}
function writeDependencyStamp(project: Project) {
  try { fs.mkdirSync(path.dirname(stampFile(project)), { recursive: true }); fs.writeFileSync(stampFile(project), dependencyStamp(project)); } catch { /* best effort */ }
}
/** ohpm's install marker (oh_modules/.ohpm/lock or oh-package-lock.json5) newer than every oh-package.json5. */
function installedAfterManifests(project: Project) {
  const mtime = (f: string) => { try { return fs.statSync(f).mtimeMs; } catch { return undefined; } };
  const installed = Math.max(mtime(path.join(project.root, "oh_modules", ".ohpm", "lock.json5")) ?? 0, mtime(path.join(project.root, "oh_modules")) ?? 0,
    mtime(path.join(project.root, "oh-package-lock.json5")) ?? 0);
  if (!installed) return false;
  const manifests = [path.join(project.root, "oh-package.json5"), ...project.modules.map((m) => path.join(m.root, "oh-package.json5"))];
  return manifests.every((f) => (mtime(f) ?? 0) <= installed);
}

export async function syncProject(project: Project, signal: AbortSignal, install = true, jobId?: string) {
  const started = Date.now();
  if (install && isFile(path.join(project.root, "oh-package.json5"))) {
    await run(toolCommand("ohpm", ["install", "--all"], project.root), { signal, timeoutMs: 10 * 60000 });
  }
  const result = await hvigor(project, ["--sync", "-p", `product=${project.product}`], signal, "Sync", jobId);
  // Stamp lives in .hvigor (build cache, gitignored by the templates): never in the sources.
  writeDependencyStamp(project);
  return { synced: true, product: project.product, modules: project.modules.map((m) => m.name), elapsed_ms: Date.now() - started, log_artifact: result.log_artifact };
}

export type BuildTask = "assembleHap" | "assembleHar" | "assembleHsp" | "assembleApp" | "compileNative";
const taskTypes: Record<BuildTask, Module["type"][]> = {
  assembleHap: ["entry", "feature"], assembleHar: ["har"], assembleHsp: ["shared"], assembleApp: [], compileNative: ["entry", "feature", "har", "shared"],
};
const suffix: Record<BuildTask, string> = { assembleHap: ".hap", assembleHar: ".har", assembleHsp: ".hsp", assembleApp: ".app", compileNative: "" };

/** Central compilation database (same location DevEco Studio and deveco-cli use). */
export function compileCommandsPath(root: string) {
  return path.join(root, ".idea", ".deveco", "cxx", "compile_commands.json");
}

/** Merge every module's .cxx/**\/compile_commands.json into the central file. Returns entry count. */
export function mergeCompileCommands(project: Project): number {
  const merged: unknown[] = [];
  for (const m of project.modules) {
    const cxx = path.join(m.root, ".cxx");
    if (!fs.existsSync(cxx)) continue;
    for (const file of walk(cxx, new Set())) {
      if (path.basename(file) !== "compile_commands.json") continue;
      try { merged.push(...(JSON.parse(fs.readFileSync(file, "utf8")) as unknown[])); } catch { /* skip partial files */ }
    }
  }
  if (!merged.length) return 0;
  const out = compileCommandsPath(project.root);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(merged));
  return merged.length;
}

/** First HarmonyOS project root at or below `dir` (breadth-first, bounded, skips build/deps). */
export function findProjectRoot(dir: string, maxDepth = 4): string | undefined {
  const skip = new Set(["node_modules", "oh_modules", ".git", ".hvigor", "build", ".idea", ".deveco"]);
  let level = [path.resolve(dir)];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    for (const d of level) if (fs.existsSync(path.join(d, "build-profile.json5")) && fs.existsSync(path.join(d, "AppScope"))) return d;
    level = level.flatMap((d) => {
      try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !skip.has(e.name) && !e.name.startsWith(".")).map((e) => path.join(d, e.name)); }
      catch { return []; }
    }).slice(0, 2000);
  }
  return undefined;
}

export function hasNativeCode(project: Project) {
  return project.modules.some((m) => fs.existsSync(path.join(m.root, "src/main/cpp")));
}

export async function buildProject(
  project: Project,
  options: { task?: BuildTask; modules?: string[]; mode?: string; clean?: boolean; sync?: boolean; props?: string[] },
  signal: AbortSignal,
  jobId?: string,
) {
  const task = options.task ?? "assembleHap";
  let modules = project.modules;
  if (task === "compileNative") {
    invariant(hasNativeCode(project), "INVALID_INPUT", "Project has no C/C++ sources (src/main/cpp)");
    modules = project.modules.filter((m) => fs.existsSync(path.join(m.root, "src/main/cpp")) && (!options.modules?.length || options.modules.includes(m.name)));
  } else if (task !== "assembleApp") {
    if (options.modules?.length) {
      const unknown = options.modules.filter((name) => !project.modules.some((m) => m.name === name));
      invariant(!unknown.length, "INVALID_INPUT", `Unknown modules: ${unknown.join(", ")}`, { modules: project.modules.map((m) => m.name) });
      modules = project.modules.filter((m) => options.modules!.includes(m.name));
    }
    modules = modules.filter((m) => taskTypes[task].includes(m.type));
    invariant(modules.length, "INVALID_INPUT", `No ${taskTypes[task].join("/")} modules to build with ${task}`,
      { modules: project.modules.map((m) => `${m.name}(${m.type})`) });
  }
  const mode = options.mode ?? "debug";
  invariant(!project.buildModes || project.buildModes.includes(mode), "INVALID_INPUT", `Build mode '${mode}' not found`,
    { modes: project.buildModes }, `Available modes: ${project.buildModes?.join(", ")}`);
  // Like devecocli build: dependencies must match oh-package.json5 before compiling. A dependency
  // added after the last install otherwise fails in CompileArkTS with "Cannot find module".
  const stamp = readDependencyStamp(project);
  // No stamp yet (first build through this server): trust an install that is newer than every
  // manifest (DevEco Studio or an earlier sync did it), otherwise install now.
  const depsChanged = stamp === undefined ? !installedAfterManifests(project) : stamp !== dependencyStamp(project);
  if (stamp === undefined && !depsChanged) writeDependencyStamp(project);
  const noModules = !fs.existsSync(path.join(project.root, "oh_modules")) && isFile(path.join(project.root, "oh-package.json5"));
  let synced: string | undefined;
  if (options.sync || noModules || depsChanged) {
    await syncProject(project, signal, true, jobId);
    synced = options.sync ? "requested" : noModules ? "dependencies not installed" : "oh-package.json5 / build-profile.json5 changed since the last install";
  }
  // A leftover hot-reload buildConfig.json (e.g. from an interrupted apply) breaks regular ArkTS compiles.
  for (const m of project.modules) fs.rmSync(path.join(m.root, "build", "config", "buildConfig.json"), { force: true });
  const args = task === "assembleApp"
    ? ["--mode", "project", "-p", `product=${project.product}`, "-p", `buildMode=${mode}`]
    : ["--mode", "module", "-p", `module=${modules.map((m) => `${m.name}@${m.target}`).join(",")}`, "-p", `product=${project.product}`, "-p", `buildMode=${mode}`];
  if (mode !== "release") args.push("-p", "debuggable=true");
  if (options.props) args.push(...options.props);
  args.push(...(options.clean ? ["clean", task] : [task]));
  // hvigor rewrites each module's BuildProfile.ets (build mode constants). When those files are
  // committed, a build would show up as a source change: restore their exact bytes afterwards.
  const profileFiles = project.modules.map((m) => path.join(m.root, "BuildProfile.ets"));
  const profiles = profileFiles.filter((f) => isFile(f)).map((f) => [f, fs.readFileSync(f)] as const);
  const absent = profileFiles.filter((f) => !isFile(f));
  const restoreProfiles = () => {
    for (const [f, bytes] of profiles) { try { if (!fs.readFileSync(f).equals(bytes)) fs.writeFileSync(f, bytes); } catch { /* removed by clean */ } }
    // Files hvigor generated during this build (the module had none before) are removed again.
    for (const f of absent) fs.rmSync(f, { force: true });
  };
  const result = await hvigor(project, args, signal, "Build", jobId).finally(restoreProfiles);
  // Any build of a C/C++ module emits per-module compile_commands.json; keep the central one fresh for clangd.
  const compileCommands = hasNativeCode(project) ? mergeCompileCommands(project) : 0;
  if (task === "compileNative")
    return { success: true, task, product: project.product, compile_commands: compileCommands ? compileCommandsPath(project.root) : null, entries: compileCommands, log_artifact: result.log_artifact, elapsed_ms: result.elapsed_ms };
  const artifacts = await buildOutputs(project, task, modules);
  invariant(artifacts.length, "BUILD_FAILED", "Build finished but produced no package", { log_artifact: result.log_artifact });
  // Device-compatibility warnings are listed apart: they are the warnings that turn into runtime crashes.
  // Each one is verified against the SDK (hvigor's own check has false positives), see syscap.ts.
  const general = result.diagnostics.filter((d) => !/is not supported on all devices/.test(d.message));
  let deviceCompat: unknown = result.device_compat;
  if (result.device_apis.length) {
    const own = result.device_apis.filter((w) => !/(^|[\\/])oh_modules[\\/]/.test(w.file));
    try {
      const { verifyDeviceApis, summarizeVerified } = await import("./syscap.js");
      deviceCompat = summarizeVerified(await verifyDeviceApis(project, own, signal), result.device_apis.length - own.length);
    } catch { /* keep the compiler's unverified list */ }
  }
  return { success: true, task, product: project.product, mode, ...(synced ? { synced } : {}), artifacts, warnings: result.counts.warning, diagnostics: general.slice(0, 10),
    ...(deviceCompat ? { device_compat: deviceCompat } : {}), log_artifact: result.log_artifact, elapsed_ms: result.elapsed_ms };
}

/** Locate packages in the standard output directories (newest first). */
export async function buildOutputs(project: Project, task: BuildTask = "assembleHap", modules = project.modules) {
  const ext = suffix[task];
  const dirs = task === "assembleApp"
    ? [path.join(project.root, "build/outputs", project.product), path.join(project.root, "build/outputs/default")]
    : modules.map((m) => path.join(m.root, "build", project.product, "outputs", m.target));
  const found: { path: string; module?: string; signed: boolean; bytes: number; sha256: string; mtime: number }[] = [];
  for (const [index, dir] of dirs.entries()) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(ext)) continue;
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      found.push({ path: file, module: task === "assembleApp" ? undefined : modules[index]?.name, signed: !name.includes("-unsigned"), bytes: stat.size, sha256: "", mtime: stat.mtimeMs });
    }
  }
  // Prefer signed packages; keep only the newest per module.
  const best = new Map<string, (typeof found)[number]>();
  for (const item of found.sort((a, b) => Number(b.signed) - Number(a.signed) || b.mtime - a.mtime)) {
    const key = item.module ?? item.path;
    if (!best.has(key)) best.set(key, item);
  }
  const list = [...best.values()];
  for (const item of list) item.sha256 = await fileSha256(item.path);
  return list.map(({ mtime: _m, ...rest }) => rest);
}

export async function cleanProject(project: Project, signal: AbortSignal) {
  await hvigor(project, ["clean"], signal, "Clean");
  return { cleaned: true };
}

/* --------------------------------- create --------------------------------- */

export async function createProject(input: {
  project: string; app_name: string; bundle_name: string; sdk_version?: string; target_api?: number; compatible_api?: number; device_types?: string[]; merge?: boolean;
}) {
  const destination = path.resolve(input.project);
  invariant(/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+){2,}$/.test(input.bundle_name), "INVALID_INPUT", "bundle_name must look like com.example.app (at least 3 segments)");
  const deviceTypes = [...new Set(input.device_types ?? ["phone"])];
  invariant(deviceTypes.length && deviceTypes.every((t) => ["phone", "tablet", "2in1", "car", "wearable", "tv"].includes(t)),
    "INVALID_INPUT", "device_types must contain phone, tablet, 2in1, car, wearable or tv");
  if (fs.existsSync(destination))
    invariant(input.merge || fs.readdirSync(destination).length === 0, "CONFLICT", `${destination} is not empty`, undefined, "Pass merge=true to add files without overwriting");
  const sdk = sdkInfo(toolchain());
  invariant(sdk?.platform_version && sdk.api_level, "TOOLCHAIN_MISSING", "Installed SDK version metadata is missing");
  const compileVersion = input.sdk_version ?? sdk.platform_version;
  const versionFor = (api: number | undefined) => (api === undefined || api === sdk.api_level ? compileVersion : versionForApi(api));
  const compatibleVersion = versionFor(input.compatible_api ?? input.target_api), targetVersion = versionFor(input.target_api);
  const template = path.join(packageRoot, "templates/application");
  const files = [...walk(template, new Set())].map((file) => path.relative(template, file).split(path.sep).join("/"));
  const target = (rel: string) => path.join(destination, path.basename(rel) === "gitignore.txt" ? path.join(path.dirname(rel), ".gitignore") : rel);
  const conflicts = files.filter((rel) => fs.existsSync(target(rel)));
  invariant(!conflicts.length, "CONFLICT", "Project creation would overwrite existing files", { conflicts: conflicts.slice(0, 20) });
  const written: string[] = [];
  for (const rel of files) {
    const out = target(rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let content = fs.readFileSync(path.join(template, rel));
    if (rel === "AppScope/app.json5") {
      const app = readJson5(path.join(template, rel));
      app.app = { ...(app.app as object), bundleName: input.bundle_name };
      content = Buffer.from(JSON.stringify(app, null, 2));
    } else if (rel === "AppScope/resources/base/element/string.json") {
      content = Buffer.from(JSON.stringify({ string: [{ name: "app_name", value: input.app_name }] }, null, 2));
    } else if (rel === "entry/src/main/module.json5") {
      const data = readJson5(path.join(template, rel));
      (data.module as Record<string, unknown>).deviceTypes = deviceTypes;
      content = Buffer.from(JSON.stringify(data, null, 2));
    } else if (rel === "build-profile.json5") {
      const profile = readJson5(path.join(template, rel));
      // No signingConfig: debug builds on emulators work unsigned; sign action configures real devices.
      (profile.app as Record<string, unknown>).products = [{
        name: "default",
        compileSdkVersion: compileVersion,
        compatibleSdkVersion: compatibleVersion,
        targetSdkVersion: targetVersion,
        runtimeOS: "HarmonyOS",
        buildOption: { strictMode: { caseSensitiveCheck: true, useNormalizedOHMUrl: true } },
      }];
      content = Buffer.from(JSON.stringify(profile, null, 2));
    } else if (rel === "oh-package.json5" || rel === "hvigor/hvigor-config.json5") {
      const data = readJson5(path.join(template, rel));
      data.modelVersion = sdk.platform_version;
      content = Buffer.from(JSON.stringify(data, null, 2));
    }
    fs.writeFileSync(out, content, { flag: "wx" });
    written.push(rel);
  }
  const project = inspectProject(destination);
  return {
    created: destination, files: written.length, bundle_name: input.bundle_name, product: project.product, device_types: deviceTypes,
    sdk: { compile: compileVersion, api_level: sdk.api_level },
    next: [{ tool: "project", action: "build", project: destination }, { tool: "run", action: "build_run", project: destination }],
  };
}

function versionForApi(api: number) {
  const file = path.join(toolchain().sdk, "default/hms/ets/build-tools/ts-checker-hooks/sdkApiVersionMap.json");
  invariant(isFile(file), "TOOLCHAIN_MISSING", `Cannot map API ${api} to a platform version: SDK version map missing`);
  const map = readJson5(file) as Record<string, string[]>;
  const found = new Set(Object.values(map).flat().filter((v) => {
    const m = /^(\d+)\.\d+\.\d+(?:\((\d+)\))?$/.exec(v);
    return m && Number(m[2] ?? m[1]) === api;
  }));
  invariant(found.size === 1, "INVALID_INPUT", `SDK does not declare exactly one platform version for API ${api}`);
  return [...found][0]!;
}

export function projectInfo(project: Project) {
  const outputs = project.modules.map((m) => ({ name: m.name, type: m.type, target: m.target, path: path.relative(project.root, m.root) || "." }));
  return {
    root: project.root, bundle_name: project.bundleName, product: project.product, products: project.products,
    sdk: { compile: project.compileSdk, target: project.targetSdk, compatible: project.compatibleSdk },
    modules: outputs,
    synced: fs.existsSync(path.join(project.root, ".hvigor/outputs/sync/output.json")),
    dependencies_installed: fs.existsSync(path.join(project.root, "oh_modules")),
  };
}
