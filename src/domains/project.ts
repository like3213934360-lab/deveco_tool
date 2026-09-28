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
    invariant(target, "INVALID_INPUT", `Target ${item.name}@${wanted} does not apply to product ${product.name}`);
    const moduleRoot = inside(root, item.srcPath);
    let type: Module["type"] = "unknown";
    const manifest = path.join(moduleRoot, "src/main/module.json5");
    if (isFile(manifest)) type = ((readJson5(manifest).module as { type?: Module["type"] } | undefined)?.type ?? "unknown");
    modules.push({ name: item.name, root: moduleRoot, type, target: target.name });
  }
  let bundleName: string | undefined;
  const app = path.join(root, "AppScope/app.json5");
  if (isFile(app)) bundleName = (readJson5(app).app as { bundleName?: string } | undefined)?.bundleName;
  const text = (value: unknown) => (value === undefined ? undefined : String(value));
  return {
    root, product: product.name, products: products.map((p) => p.name),
    compileSdk: text(product.compileSdkVersion ?? profile.app?.compileSdkVersion),
    targetSdk: text(product.targetSdkVersion ?? profile.app?.targetSdkVersion),
    compatibleSdk: text(product.compatibleSdkVersion ?? profile.app?.compatibleSdkVersion),
    modules, bundleName,
  };
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

/** Streaming parser for hvigor/ArkTS output: collects unique errors (bounded) as they appear. */
export class BuildOutputParser {
  readonly diagnostics: Diagnostic[] = [];
  counts = { error: 0, warning: 0 };
  private pending?: Diagnostic;
  private seen = new Set<string>();
  constructor(private readonly root: string, private readonly limit = 30) {}
  line(raw: string) {
    const text = raw.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (!text) return;
    const header = /ArkTS:(ERROR|WARN)\b/.exec(text);
    if (header) {
      this.flush();
      this.pending = { severity: header[1] === "ERROR" ? "error" : "warning", message: "" };
      const code = /(\d{8})/.exec(text)?.[1];
      if (code) this.pending.code = code;
      const at = /File:\s*(.+?):(\d+):(\d+)/.exec(text);
      if (at) Object.assign(this.pending, { file: this.relative(at[1]!), line: +at[2]!, column: +at[3]! });
      return;
    }
    if (this.pending) {
      const at = /(?:At File|File):\s*(.+?):(\d+):(\d+)/.exec(text);
      if (at && !this.pending.file) { Object.assign(this.pending, { file: this.relative(at[1]!), line: +at[2]!, column: +at[3]! }); return; }
      const message = /^Error Message:\s*(.*)$/.exec(text)?.[1];
      if (message !== undefined) { this.pending.message = message; return; }
      if (/^(COMPILE RESULT|>|\* Try|Error Code)/.test(text)) { this.flush(); }
      else if (!this.pending.message) { this.pending.message = text; return; }
      else { this.flush(); }
    }
    const tsError = /^(?:ERROR|error)[:\s].*?(?:(\S+\.(?:ets|ts|js|cpp|c|h)):(\d+):(\d+))?[:\s-]*(.+)$/.exec(text);
    const native = /^(.+\.(?:cpp|cc|c|h|hpp)):(\d+):(\d+):\s*(?:fatal )?error:\s*(.+)$/.exec(text);
    if (native) this.push({ severity: "error", file: this.relative(native[1]!), line: +native[2]!, column: +native[3]!, message: native[4]! });
    else if (/^hvigor ERROR:|^> hvigor ERROR:|BUILD FAILED/.test(text)) this.push({ severity: "error", message: text.replace(/^>?\s*hvigor ERROR:\s*/, "") });
    else if (tsError && /error TS\d+/.test(text)) this.push({ severity: "error", message: text });
  }
  private relative(file: string) {
    const rel = path.relative(this.root, file);
    return rel.startsWith("..") ? file : rel;
  }
  private push(d: Diagnostic) {
    this.counts[d.severity]++;
    const key = `${d.file}:${d.line}:${d.message}`;
    if (this.seen.has(key) || this.diagnostics.length >= this.limit) return;
    this.seen.add(key);
    this.diagnostics.push(d);
  }
  private flush() {
    if (this.pending) this.push({ ...this.pending, message: this.pending.message || "(no message)" });
    this.pending = undefined;
  }
  finish() {
    this.flush();
    // Errors first so the host sees blocking issues immediately.
    this.diagnostics.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
    return { counts: this.counts, diagnostics: this.diagnostics };
  }
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
    if (result.code !== 0)
      throw new ToolError("BUILD_FAILED", `${label} failed (${parsed.counts.error} errors)`, {
        ...parsed, log_artifact: log.artifact_id, elapsed_ms: result.elapsedMs,
        ...(parsed.diagnostics.length ? {} : { tail: (result.stderr || result.stdout).slice(-3000) }),
      }, "Fix the listed diagnostics (knowledge search with the error code helps), then build again. Read the full log with job read artifact_id=" + log.artifact_id);
    return { ...parsed, log_artifact: log.artifact_id, elapsed_ms: result.elapsedMs };
  } catch (error) {
    if (!(error instanceof ToolError && error.code === "BUILD_FAILED")) await commitArtifact(id, file, "text/plain", jobId).catch(() => {});
    throw error;
  }
}

export async function syncProject(project: Project, signal: AbortSignal, install = true, jobId?: string) {
  const started = Date.now();
  if (install && isFile(path.join(project.root, "oh-package.json5"))) {
    await run(toolCommand("ohpm", ["install", "--all"], project.root), { signal, timeoutMs: 10 * 60000 });
  }
  const result = await hvigor(project, ["--sync", "-p", `product=${project.product}`], signal, "Sync", jobId);
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
  if (options.sync || !fs.existsSync(path.join(project.root, "oh_modules")) && isFile(path.join(project.root, "oh-package.json5")))
    await syncProject(project, signal, true, jobId);
  // A leftover hot-reload buildConfig.json (e.g. from an interrupted apply) breaks regular ArkTS compiles.
  for (const m of project.modules) fs.rmSync(path.join(m.root, "build", "config", "buildConfig.json"), { force: true });
  const mode = options.mode ?? "debug";
  const args = task === "assembleApp"
    ? ["--mode", "project", "-p", `product=${project.product}`, "-p", `buildMode=${mode}`]
    : ["--mode", "module", "-p", `module=${modules.map((m) => `${m.name}@${m.target}`).join(",")}`, "-p", `product=${project.product}`, "-p", `buildMode=${mode}`];
  if (mode !== "release") args.push("-p", "debuggable=true");
  if (options.props) args.push(...options.props);
  args.push(...(options.clean ? ["clean", task] : [task]));
  const result = await hvigor(project, args, signal, "Build", jobId);
  // Any build of a C/C++ module emits per-module compile_commands.json; keep the central one fresh for clangd.
  const compileCommands = hasNativeCode(project) ? mergeCompileCommands(project) : 0;
  if (task === "compileNative")
    return { success: true, task, product: project.product, compile_commands: compileCommands ? compileCommandsPath(project.root) : null, entries: compileCommands, log_artifact: result.log_artifact, elapsed_ms: result.elapsed_ms };
  const artifacts = await buildOutputs(project, task, modules);
  invariant(artifacts.length, "BUILD_FAILED", "Build finished but produced no package", { log_artifact: result.log_artifact });
  return { success: true, task, product: project.product, mode, artifacts, warnings: result.counts.warning, diagnostics: result.diagnostics.slice(0, 10), log_artifact: result.log_artifact, elapsed_ms: result.elapsed_ms };
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
  project: string; app_name: string; bundle_name: string; sdk_version?: string; target_api?: number; compatible_api?: number; merge?: boolean;
}) {
  const destination = path.resolve(input.project);
  invariant(/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+){2,}$/.test(input.bundle_name), "INVALID_INPUT", "bundle_name must look like com.example.app (at least 3 segments)");
  if (fs.existsSync(destination))
    invariant(input.merge || fs.readdirSync(destination).length === 0, "CONFLICT", `${destination} is not empty`, undefined, "Pass merge=true to add files without overwriting");
  const sdk = sdkInfo(toolchain());
  invariant(sdk?.platform_version && sdk.api_level, "TOOLCHAIN_MISSING", "Installed SDK version metadata is missing");
  const compileVersion = input.sdk_version ?? sdk.platform_version;
  const versionFor = (api: number | undefined) => (api === undefined || api === sdk.api_level ? compileVersion : versionForApi(api));
  const template = path.join(packageRoot, "templates/application");
  const files = [...walk(template, new Set())].map((file) => path.relative(template, file));
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
    } else if (rel === "build-profile.json5") {
      const profile = readJson5(path.join(template, rel));
      // No signingConfig: debug builds on emulators work unsigned; sign action configures real devices.
      (profile.app as Record<string, unknown>).products = [{
        name: "default",
        compileSdkVersion: compileVersion,
        compatibleSdkVersion: versionFor(input.compatible_api ?? input.target_api),
        targetSdkVersion: versionFor(input.target_api),
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
    created: destination, files: written.length, bundle_name: input.bundle_name, product: project.product,
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
