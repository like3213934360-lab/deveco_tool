import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { invariant, ToolError } from "../core/errors.js";
import { atomicWrite, clip, fileSha256, inside, readJson5, sha256, walk } from "../core/files.js";
import { run } from "../core/proc.js";
import { toolCommand } from "../core/toolchain.js";
import { hdc, install, installStamp, pidOf, resolveTarget, shell } from "./device.js";
import { BuildOutputParser, localModuleDependencies, mainAbility, runnableDeviceTypes, selectRunModules, type Module, type Project } from "./project.js";
import { decryptPassword } from "./sign.js";

/*
 * Hot reload = HQF quick fix applied to the running app (no reinstall, no restart):
 *   baseline: run build_run hot_reload=true (records source digests + device/app)
 *   apply:    diff sources -> changedFileList.json -> `hvigor assembleDevHqf`
 *             (ColdReloadArkTS compiles only changed files against the baseline symbol map,
 *              PackageHqf packs <module>-<target>-unsigned.hqf) -> sign -> `bm quickfix -a -f`
 * State: <module>/build/<product>/intermediates/deveco-mcp-hot.json
 */

interface ModuleBaseline {
  module: string; moduleTarget: string; files: Record<string, string>;
  resources?: Record<string, string>;
  harRoots?: string[];
  patchedFiles?: string[];
}

interface Baseline extends ModuleBaseline {
  bundle: string; target: string; at: number;
  debugLine?: boolean;
  launch?: { module: string; ability: string };
  others?: ModuleBaseline[];
  patchVersion?: number;
  pending?: boolean;
  restore?: { directory: string; install: string; packages: { file: string; sha256: string }[] };
}

export function patchableModule(module: Module) {
  return module.type === "entry" || module.type === "feature" || module.type === "shared";
}

function statePath(project: Project, module: string) {
  const m = project.modules.find((x) => x.name === module)!;
  return path.join(m.root, "build", project.product, "intermediates", "deveco-mcp-hot.json");
}
function baselineArchive(file: string, directory: string) {
  invariant(/^deveco-mcp-baseline-[a-f0-9]{16}$/.test(directory), "CONFLICT", "Invalid baseline archive directory");
  return path.join(path.dirname(file), directory);
}

/** Modules that have a hot-reload baseline (installed with build_run hot_reload=true). */
export function baselineModules(project: Project) {
  return project.modules.filter((m) => patchableModule(m) && fs.existsSync(statePath(project, m.name))).map((m) => m.name);
}

function findBaseline(project: Project, module: string) {
  for (const name of [module, ...baselineModules(project).filter((name) => name !== module)]) {
    const file = statePath(project, name);
    if (!fs.existsSync(file)) continue;
    const baseline = JSON.parse(fs.readFileSync(file, "utf8")) as Baseline;
    if (name === module || baseline.others?.some((m) => m.module === module)) return { file, baseline };
  }
  throw new ToolError("NOT_FOUND", "No hot-reload baseline for this module", undefined, "Start with run build_run hot_reload=true");
}

/** Resolve the recorded target before acquiring locks; an explicit device never redirects a baseline. */
export async function hotReloadSelection(project: Project, module: string | undefined, requested: string | undefined, signal: AbortSignal) {
  const target = requested ? await resolveTarget(requested, signal, runnableDeviceTypes(project)) : undefined;
  if (!module) {
    const recorded = target ? [] : baselineModules(project);
    if (recorded.length === 1) module = recorded[0];
    else {
      const type = target ? await shell(target, ["param", "get", "const.product.devicetype"], signal, 10000) : undefined;
      invariant(!type || type.code === 0, "DEVICE_OUTPUT_INVALID", "Cannot select a hot-reload module from the device type");
      module = selectRunModules(project, { deviceType: type?.stdout.trim() }).modules.find((m) => m.type === "entry")?.name;
    }
  }
  invariant(module && project.modules.some((m) => m.name === module), "INVALID_INPUT", "Choose a hot-reload module explicitly");
  const { baseline } = findBaseline(project, module);
  invariant(typeof baseline.target === "string" && baseline.target && baseline.bundle === project.bundleName && (!target || target === baseline.target),
    "CONFLICT", "Hot-reload device/bundle does not match the recorded baseline", { requested_target: target, baseline_target: baseline.target });
  return { module, target: baseline.target };
}

function sourceDigests(module: Module, harRoots: string[]) {
  const out: Record<string, string> = {};
  for (const root of [module.root, ...harRoots]) {
    for (const file of walk(path.join(root, "src/main/ets"), new Set())) if (/\.(ets|ts)$/.test(file)) out[file] = sha256(fs.readFileSync(file));
  }
  for (const root of module.type === "shared" ? [module.root, ...harRoots] : harRoots) {
    const { main } = readJson5(path.join(root, "oh-package.json5")) as { main?: unknown };
    if (typeof main !== "string" || !/\.(ets|ts)$/.test(main)) continue;
    const file = inside(root, main);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const actual = fs.realpathSync(file);
      const canonicalRoot = fs.realpathSync(root);
      inside(canonicalRoot, path.relative(canonicalRoot, actual));
      out[file] ??= sha256(fs.readFileSync(actual));
    }
  }
  return out;
}

function consumedHarRoots(project: Project, module: Module) {
  return localModuleDependencies(project, [module], ["har"]).map((m) => m.root).sort();
}

function resourceFiles(roots: string[]) {
  const assets = new Map<string, string>();
  for (const moduleRoot of roots) {
    const resourcePath = path.join(moduleRoot, "src/main/resources");
    for (const folder of ["rawfile", "resfile"]) {
      for (const file of walk(path.join(resourcePath, folder))) assets.set(file, resourcePath);
    }
  }
  return assets;
}

interface ResourceEdit { filePath: string; resourcePath: string }

async function verifyPatch(file: string, entries: Map<string, string>, bundle: string, module: string, signal: AbortSignal) {
  const { openPromise } = await import("yauzl");
  const zip = await openPromise(file, { lazyEntries: true });
  const verified = new Set<string>();
  let version: number | undefined;
  try {
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted();
      if (entry.fileName === "patch.json") {
        invariant(version === undefined && entry.uncompressedSize <= 16384, "BUILD_FAILED", "Invalid HQF patch manifest");
        const chunks: Buffer[] = [];
        for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
        const manifest = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          app?: { bundleName?: string; patchVersionCode?: number }; module?: { name?: string; type?: string };
        };
        version = manifest.app?.patchVersionCode;
        invariant(manifest.app?.bundleName === bundle && manifest.module?.name === module && manifest.module.type === "patch"
          && Number.isSafeInteger(version) && version! > 0, "BUILD_FAILED", "HQF identity does not match the installed app and module");
        continue;
      }
      const expected = entries.get(entry.fileName);
      if (!expected) continue;
      invariant(!verified.has(entry.fileName), "BUILD_FAILED", "Duplicate resource in HQF", { path: entry.fileName });
      const hash = crypto.createHash("sha256");
      for await (const chunk of await zip.openReadStreamPromise(entry)) {
        signal.throwIfAborted();
        hash.update(chunk as Buffer);
      }
      invariant(hash.digest("hex") === expected, "BUILD_FAILED", "HQF resource bytes differ from the requested edit", { path: entry.fileName });
      verified.add(entry.fileName);
    }
  } finally { zip.close(); }
  invariant(verified.size === entries.size, "BUILD_FAILED", "HQF omitted requested resources",
    { missing: [...entries.keys()].filter((entry) => !verified.has(entry)) });
  invariant(version !== undefined, "BUILD_FAILED", "HQF is missing patch.json");
  return version;
}

export async function installedPatchVersion(target: string, bundle: string, signal: AbortSignal) {
  const result = await shell(target, ["bm", "quickfix", "-q", "-b", bundle], signal, 15000);
  const output = result.stdout + result.stderr;
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const versions = lines.flatMap((line) => /^patch version code:\s*(\d+)$/.exec(line)?.slice(1) ?? []);
  invariant(result.code === 0 && !result.truncated && lines.includes(`bundle name: ${bundle}`)
    && versions.length === 1 && Number.isSafeInteger(Number(versions[0])) && !lines.some((line) => /^(?:error|fail(?:ed)?)(?:\b|:)/i.test(line)),
  "EFFECT_UNCERTAIN", "The installed HQF version could not be read", { output: clip(output, 1300) });
  return Number(versions[0]);
}

/**
 * ColdReloadArkCompile only runs when <module>/build/config/buildConfig.json exists. An empty
 * compileConfig lets hvigor derive the real settings (explicit paths break module resolution).
 */
/** buildConfig.json also alters regular CompileArkTS; it must only exist during hot-reload compiles. */
export function clearBuildConfig(project: Project) {
  for (const m of project.modules) fs.rmSync(path.join(m.root, "build", "config", "buildConfig.json"), { force: true });
}

export function writeBuildConfig(project: Project, module: string, patch: boolean) {
  const m = project.modules.find((x) => x.name === module)!;
  fs.mkdirSync(path.join(m.root, "build", "config"), { recursive: true });
  // Without patchConfig hvigor treats the compile as a first build: full compile + symbol table dump.
  // With patchConfig.mode=coldReload it marks the compile as a reload: only changed files -> patch ABC.
  const config = patch ? { compileConfig: {}, patchConfig: { mode: "coldReload" } } : { compileConfig: {} };
  fs.writeFileSync(path.join(m.root, "build", "config", "buildConfig.json"), JSON.stringify(config));
}

function writeChangeList(project: Project, module: string, files: string[], sources: Record<string, string>, resources: { resFile: ResourceEdit[]; rawFile: ResourceEdit[] } = { resFile: [], rawFile: [] }) {
  const m = project.modules.find((x) => x.name === module)!;
  const patchDir = path.join(m.root, "build", project.product, "intermediates", "patch", m.target);
  fs.mkdirSync(patchDir, { recursive: true });
  const etsBase = path.join(m.root, "src/main/ets");
  fs.writeFileSync(path.join(patchDir, "changedFileList.json"),
    JSON.stringify({ resources, modifiedFiles: files.map((f) => path.relative(etsBase, f).replaceAll("\\", "/")) }));
  // hvigor keeps only changed files listed in ets.json#compiledFileList (the baseline's module graph).
  // Seed it with every current source so a patch compile never silently drops the edit.
  const etsJson = path.join(patchDir, "ets.json");
  const existing = fs.existsSync(etsJson) ? (JSON.parse(fs.readFileSync(etsJson, "utf8")) as { compiledFileList?: string[] }) : {};
  // hvigor compares resolved real paths (e.g. /private/var on macOS).
  const compiled = new Set([...(existing.compiledFileList ?? []), ...Object.keys(sources).flatMap((f) => [f, fs.realpathSync(f)])]);
  fs.writeFileSync(etsJson, JSON.stringify({ ...existing, compiledFileList: [...compiled] }));
  return patchDir;
}

async function devHqf(project: Project, modules: Module[], signal: AbortSignal, debugLine?: boolean) {
  const parser = new BuildOutputParser(project.root);
  const result = await run(toolCommand("hvigor", ["assembleDevHqf", "--mode", "module", "-p", `module=${modules.map((m) => `${m.name}@${m.target}`).join(",")}`, "-p", `product=${project.product}`,
    "-p", "debuggable=true", ...(debugLine ? ["-p", "debugLine=true"] : []), "--no-daemon", "--parallel", "--incremental"], project.root),
    { signal, timeoutMs: 600000, allowFailure: true, onLine: (l) => parser.line(l) });
  return { result, diagnostics: parser.finish() };
}

/**
 * Baseline: compile the unchanged module once through the cold-reload pipeline so hvigor
 * writes the symbol map (loader_out/ets/symbolMap.map) that later patch compiles diff against.
 */
export async function recordBaseline(project: Project, selection: string | string[], bundle: string, target: string, signal: AbortSignal, packages: { path: string; sha256: string }[], options: Pick<Baseline, "debugLine" | "launch"> = {}) {
  const names = Array.isArray(selection) ? selection : [selection];
  invariant(names.length && new Set(names).size === names.length, "INVALID_INPUT", "Choose distinct hot-reload modules");
  const modules = names.map((name) => {
    const m = project.modules.find((x) => x.name === name);
    invariant(m && patchableModule(m), "INVALID_INPUT", `Hot reload needs an entry, feature or shared module, got ${name}`);
    return m;
  });
  invariant(packages?.length, "NOT_FOUND", "Installed package receipt is missing; deploy again with hot_reload=true");
  const stamp = await installStamp(target, bundle, signal);
  invariant(stamp, "EFFECT_UNCERTAIN", "Cannot identify the installed baseline");
  const file = statePath(project, names[0]!);
  const superseded = baselineModules(project).map((name) => {
    const file = statePath(project, name);
    return { file, baseline: JSON.parse(fs.readFileSync(file, "utf8")) as Baseline };
  }).filter(({ baseline }) => baseline.target === target && baseline.bundle === bundle
    || [baseline, ...(baseline.others ?? [])].some((member) => names.includes(member.module)));
  const directory = `deveco-mcp-baseline-${crypto.randomBytes(8).toString("hex")}`;
  const archive = baselineArchive(file, directory);
  const saved: { file: string; sha256: string }[] = [];
  const states: ModuleBaseline[] = [];
  for (const m of modules) {
    const harRoots = consumedHarRoots(project, m);
    const files = sourceDigests(m, harRoots);
    const resources: Record<string, string> = {};
    for (const resource of resourceFiles([m.root, ...harRoots]).keys()) {
      signal.throwIfAborted();
      resources[resource] = await fileSha256(resource);
    }
    states.push({ module: m.name, moduleTarget: m.target, files, resources, harRoots });
  }
  fs.mkdirSync(archive, { recursive: true });
  try {
    for (const pkg of packages) {
      const name = path.basename(pkg.path);
      invariant(!saved.some((p) => p.file === name), "CONFLICT", `Duplicate baseline package name: ${name}`);
      fs.copyFileSync(pkg.path, path.join(archive, name), fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
      invariant(await fileSha256(path.join(archive, name)) === pkg.sha256, "CONFLICT", `Package changed after deployment: ${name}`);
      saved.push({ file: name, sha256: pkg.sha256 });
    }
    try {
      for (const state of states) {
        writeBuildConfig(project, state.module, false);
        writeChangeList(project, state.module, [], state.files);
      }
      const { result, diagnostics } = await devHqf(project, modules, signal, options.debugLine);
      invariant(result.code === 0, "BUILD_FAILED", "Hot reload baseline compile failed", { ...diagnostics, tail: clip(result.stderr || result.stdout, 1500) });
    } finally { clearBuildConfig(project); }
    invariant(saved.every((p) => fs.existsSync(path.join(archive, p.file))), "CONFLICT", "Baseline packages were removed during compilation");
    invariant(await installStamp(target, bundle, signal) === stamp, "CONFLICT", "Installed app changed while recording the baseline");
    const [first, ...others] = states;
    const baseline: Baseline = { ...first!, ...(others.length ? { others } : {}), bundle, target, at: Date.now(), ...options, restore: { directory, install: stamp, packages: saved } };
    atomicWrite(file, JSON.stringify(baseline));
  } catch (error) {
    fs.rmSync(archive, { recursive: true, force: true });
    throw error;
  }
  for (const prior of superseded) {
    if (prior.file !== file) fs.rmSync(prior.file, { force: true });
    if (prior.baseline.restore) fs.rmSync(baselineArchive(prior.file, prior.baseline.restore.directory), { recursive: true, force: true });
  }
  return { baseline: true, module: names[0], ...(names.length > 1 ? { modules: names } : {}), files: states.reduce((sum, state) => sum + Object.keys(state.files).length, 0), packages: saved.length };
}

/** bm quickfix -r only deletes inactive patches. Restore the exact installed packages instead. */
export async function resetHotReload(project: Project, module: string, target: string | undefined, signal: AbortSignal) {
  invariant(project.modules.some((m) => m.name === module), "INVALID_INPUT", "Unknown hot-reload module");
  const { file, baseline } = findBaseline(project, module);
  const device = target ?? baseline.target;
  invariant(baseline?.restore?.packages.length, "NOT_FOUND", "No saved installation packages for this baseline", undefined,
    "Create a new baseline with run build_run hot_reload=true; older baselines cannot be reconstructed from current sources");
  invariant(device === baseline.target && project.bundleName === baseline.bundle, "CONFLICT", "Reset device/bundle does not match the baseline");
  const archive = baselineArchive(file, baseline.restore.directory);
  const packages = [];
  for (const pkg of baseline.restore.packages) {
    const saved = inside(archive, pkg.file);
    invariant(fs.existsSync(saved) && await fileSha256(saved) === pkg.sha256, "CONFLICT", `Baseline package missing or changed: ${pkg.file}`);
    packages.push(saved);
  }
  invariant(await installStamp(device, baseline.bundle, signal) === baseline.restore.install, "CONFLICT", "Installed app changed since this baseline; reset refused");
  await install(device, packages, signal, true);
  invariant(await installedPatchVersion(device, baseline.bundle, signal) === 0,
    "EFFECT_UNCERTAIN", "Baseline packages installed, but cleared patch state could not be verified; baseline retained");
  // Replacement clears bundle-wide patches, including baselines recorded for other modules.
  for (const name of baselineModules(project)) {
    const state = statePath(project, name);
    const other = JSON.parse(fs.readFileSync(state, "utf8")) as Baseline;
    if (other.bundle !== baseline.bundle || other.target !== device) continue;
    if (other.restore) fs.rmSync(baselineArchive(state, other.restore.directory), { recursive: true, force: true });
    fs.rmSync(state, { force: true });
    for (const member of [other, ...(other.others ?? [])]) {
      const root = project.modules.find((m) => m.name === member.module)?.root;
      if (root) fs.rmSync(path.join(root, "patch.json"), { force: true });
    }
  }
  const { stateDir } = await import("../core/config.js");
  const { stateFile } = await import("./hotpath.js");
  fs.rmSync(stateFile(stateDir(), project.root, device), { force: true });
  return { reset: true, method: "restore_baseline_packages", patch_version: 0, packages: baseline.restore.packages.map((p) => p.file), note: "Original packages restored without rebuilding; app data preserved. Launch the app to run the baseline code" };
}

/** `devecocli run --hotreload stop`: shut down the project's hvigor daemon. */
export async function stopDaemon(project: Project, signal: AbortSignal) {
  const result = await run(toolCommand("hvigor", ["--stop-daemon"], project.root), { signal, timeoutMs: 60000, allowFailure: true });
  return { stopped: result.code === 0, output: clip((result.stdout + result.stderr).trim(), 300) };
}


async function planPatch(project: Project, baseline: ModuleBaseline, explicit: string[] | undefined, accepted: Set<string>, signal: AbortSignal) {
  const module = baseline.module;
  const m = project.modules.find((x) => x.name === module);
  invariant(m && patchableModule(m) && m.target === baseline.moduleTarget, "CONFLICT", "Hot-reload module target changed since deployment", { module });
  const harRoots = baseline.harRoots ?? [];
  invariant(!baseline.harRoots || JSON.stringify(harRoots) === JSON.stringify(consumedHarRoots(project, m)),
    "CONFLICT", "Declared HAR dependencies changed since the baseline; redeploy before applying a patch");
  const current = sourceDigests(m, harRoots);
  // Explicit file list (like devecocli's --apply <fileName> list) or the automatic source diff.
  const resources: Record<string, string> = {};
  const available = resourceFiles([m.root, ...harRoots]);
  for (const f of explicit ?? []) {
    if (current[f] === undefined && !available.has(f)) continue;
    accepted.add(f);
    invariant(!available.has(f) || baseline.resources, "CONFLICT", "This baseline predates resource patches; redeploy with hot_reload=true");
  }
  if (baseline.resources) for (const resource of explicit ? explicit.filter((f) => available.has(f)) : available.keys()) {
    signal.throwIfAborted();
    resources[resource] = await fileSha256(resource);
  }
  const changed = (explicit ?? Object.keys(current)).filter((f) => current[f] !== undefined && (explicit || baseline.files[f] !== current[f]));
  const assetEdits = Object.keys(resources).filter((f) => explicit || baseline.resources![f] !== resources[f]);
  const added = changed.filter((f) => !baseline.files[f]).length + assetEdits.filter((f) => !baseline.resources![f]).length;
  const removed = Object.keys(baseline.files).filter((f) => !current[f]);
  removed.push(...Object.keys(baseline.resources ?? {}).filter((f) => !available.has(f)));
  invariant(!removed.length, "INVALID_INPUT", "Files were deleted; redeploy to remove them", { removed: removed.map((f) => path.relative(project.root, f)) });
  const requested = [...changed, ...assetEdits];
  const patched = new Set([...requested, ...(baseline.patchedFiles ?? [])]);
  const requestedSet = new Set(requested);
  // The bundle manager replaces the prior HQF. Re-include applied files and reject unsent edits.
  for (const f of patched) {
    if (requestedSet.has(f)) continue;
    const resource = available.has(f);
    const digest = resource ? await fileSha256(f) : current[f];
    invariant(digest !== undefined && digest === (resource ? baseline.resources?.[f] : baseline.files[f]),
      "CONFLICT", "A previously patched file has unsent changes", { file: path.relative(project.root, f) },
      "Include the file in this apply or restore its last applied contents");
    if (resource) resources[f] = digest;
  }
  const patchSources = [...patched].filter((f) => current[f] !== undefined);
  const patchResources = [...patched].filter((f) => available.has(f));
  const assets = { resFile: [] as ResourceEdit[], rawFile: [] as ResourceEdit[] };
  const expectedResources = new Map<string, string>();
  for (const filePath of patchResources) {
    const resourcePath = available.get(filePath)!;
    const relative = path.relative(resourcePath, filePath).replaceAll("\\", "/");
    const duplicates = [...available].filter(([asset, root]) => asset !== filePath && path.relative(root, asset).replaceAll("\\", "/") === relative);
    invariant(!duplicates.length, "CONFLICT", "Several modules provide the same patch resource path", { path: relative, files: [filePath, ...duplicates.map(([file]) => file)] });
    (relative.startsWith("rawfile/") ? assets.rawFile : assets.resFile).push({ filePath, resourcePath });
    expectedResources.set(`resources/${relative}`, resources[filePath]!);
  }
  const next: ModuleBaseline = { ...baseline, files: { ...baseline.files, ...Object.fromEntries(changed.map((f) => [f, current[f]!])) },
    resources: baseline.resources && { ...baseline.resources, ...Object.fromEntries(assetEdits.map((f) => [f, resources[f]!])) }, patchedFiles: [...patched] };
  return { m, harRoots, current, resources, requested, added, patchSources, patchResources, assets, expectedResources, next };
}

function preparePatch(project: Project, plan: Awaited<ReturnType<typeof planPatch>>) {
  const { m, patchSources, current, assets } = plan;
  const module = m.name;
  writeBuildConfig(project, module, true);
  const patchDir = writeChangeList(project, module, patchSources, current, assets);
  const outDir = path.join(m.root, "build", project.product, "outputs", m.target);
  const unsigned = path.join(outDir, `${module}-${m.target}-unsigned.hqf`);
  const signed = path.join(outDir, `${module}-${m.target}-signed.hqf`);
  fs.rmSync(unsigned, { force: true });
  fs.rmSync(signed, { force: true });
  fs.rmSync(path.join(patchDir, "ets"), { recursive: true, force: true });
  return { ...plan, patchDir, unsigned, signed };
}

/** Prefer Hvigor's signed output and reuse the existing configured signer when needed. */
async function signedPatch(project: Project, unsigned: string, signed: string, signal: AbortSignal) {
  let hqf = unsigned;
  const profile = readJson5(path.join(project.root, "build-profile.json5")) as { app: { signingConfigs?: any[]; products?: any[] } };
  const configName = profile.app.products?.find((p) => p.name === project.product)?.signingConfig;
  const signing = fs.existsSync(signed) ? undefined : profile.app.signingConfigs?.find((c) => c.name === configName)?.material;
  if (fs.existsSync(signed)) hqf = signed;
  else if (signing) {
    const store = path.resolve(project.root, signing.storeFile);
    const sign = await run(toolCommand("signer", ["sign-app", "-mode", "localSign", "-keyAlias", signing.keyAlias, "-keyPwd", decryptPassword(signing.keyPassword, store),
      "-appCertFile", path.resolve(project.root, signing.certpath), "-profileFile", path.resolve(project.root, signing.profile), "-inFile", unsigned,
      "-signAlg", signing.signAlg ?? "SHA256withECDSA", "-keystoreFile", store, "-keystorePwd", decryptPassword(signing.storePassword, store), "-outFile", signed]), { signal, timeoutMs: 120000, allowFailure: true });
    invariant(sign.code === 0 && fs.existsSync(signed), "SIGN_FAILED", "Signing the HQF failed", { tail: clip(sign.stdout + sign.stderr, 800) });
    hqf = signed;
  }

  return hqf;
}

export async function applyHotReload(project: Project, module: string, signal: AbortSignal, log: (m: string) => void, options: { files?: string[]; restart?: boolean; ability?: string; target?: string } = {}) {
  const started = Date.now();
  invariant(project.modules.some((m) => m.name === module && patchableModule(m)), "INVALID_INPUT", "Unknown hot-reload module", { module });
  const { file, baseline } = findBaseline(project, module);
  const { others, bundle, target, debugLine, restore } = baseline;
  invariant(bundle === project.bundleName && (!options.target || options.target === target), "CONFLICT", "Hot-reload device/bundle does not match the recorded baseline");
  invariant(!baseline.pending, "EFFECT_UNCERTAIN", "A previous apply could not be verified. Reset the baseline before applying again");
  const launchTarget = options.restart ? baseline.launch ?? mainAbility(project, module) : undefined;
  invariant(restore?.install && await installStamp(target, bundle, signal) === restore.install,
    "CONFLICT", "Installed app changed or baseline installation identity is missing; redeploy before applying a patch");
  const explicit = options.files && [...new Set(options.files.map((f) => path.resolve(project.root, f)))];
  const accepted = new Set<string>();
  const anchor: ModuleBaseline = { module: baseline.module, moduleTarget: baseline.moduleTarget, files: baseline.files, resources: baseline.resources,
    harRoots: baseline.harRoots, patchedFiles: baseline.patchedFiles };
  const plans = [];
  for (const state of [anchor, ...(others ?? [])]) plans.push(await planPatch(project, state, explicit, accepted, signal));
  for (const f of explicit ?? []) invariant(accepted.has(f), "INVALID_INPUT", "File is outside the patchable sources/resources of the baseline", { file: path.relative(project.root, f) });
  const requested = [...new Set(plans.flatMap((p) => p.requested))];
  invariant(requested.length, "INVALID_INPUT", "No patchable code or resource changes since the last hot reload");
  const pid = await pidOf(target, bundle, signal);
  invariant(pid, "NOT_FOUND", "The baseline application is not running", { target, bundle }, "Launch the app, then apply again");

  const active = plans.filter((p) => p.next.patchedFiles?.length);
  log(`Compiling ${requested.length} file(s) for ${active.length} module(s)`);
  const prepared: ReturnType<typeof preparePatch>[] = [];
  const { result, diagnostics } = await (async () => {
    for (const plan of active) prepared.push(preparePatch(project, plan));
    return devHqf(project, active.map((p) => p.m), signal, debugLine);
  })().finally(() => clearBuildConfig(project));
  invariant(result.code === 0, "BUILD_FAILED", "Hot reload compile failed", { ...diagnostics, tail: clip(result.stderr || result.stdout, 2000) });
  const signingStarted = Date.now();
  const patches = [];
  const verify = !!others?.length || prepared.some((p) => p.expectedResources.size > 0);
  for (const plan of prepared) {
    const patchAbc = [...walk(path.join(plan.patchDir, "ets"), new Set())].some((f) => f.endsWith(".abc"));
    invariant(fs.existsSync(plan.unsigned) && (!plan.patchSources.length || patchAbc), "BUILD_FAILED", "Compiler omitted a requested HQF or patch ABC", { module: plan.m.name });
    const hqf = await signedPatch(project, plan.unsigned, plan.signed, signal);
    const version = verify ? await verifyPatch(hqf, plan.expectedResources, bundle, plan.m.name, signal) : undefined;
    patches.push({ module: plan.m.name, hqf, version, hash: verify ? await fileSha256(hqf) : undefined });
  }
  const patchVersion = patches[0]!.version;
  invariant(patches.every((p) => p.version === patchVersion), "BUILD_FAILED", "Hvigor produced conflicting HQF versions for one installation");
  const signingMs = Date.now() - signingStarted;

  const verifyInputs = async () => {
    for (const plan of active) {
      const compiledSources = sourceDigests(plan.m, plan.harRoots);
      invariant(plan.patchSources.every((f) => compiledSources[f] === plan.current[f]), "CONFLICT", "Sources changed during patch compilation; patch was not applied");
      for (const asset of plan.patchResources) invariant(await fileSha256(asset) === plan.resources[asset],
        "CONFLICT", "Resources changed during patch compilation; patch was not applied", { file: asset });
    }
    invariant(await installStamp(target, bundle, signal) === restore.install, "CONFLICT", "Installed app changed during patch compilation");
  };
  await verifyInputs();
  log("Applying quick fix on device");
  let transferMs = 0, applyMs = 0;
  const remote = `/data/local/tmp/deveco-hqf-${crypto.randomBytes(4).toString("hex")}`;
  try {
    await shell(target, ["mkdir", "-p", remote], signal);
    const remoteFiles = [];
    for (const [i, patch] of patches.entries()) {
      const remoteFile = `${remote}/patch-${i}.hqf`;
      const sent = await hdc(["-t", target, "file", "send", patch.hqf, remoteFile], signal, 60000, true);
      transferMs += sent.elapsedMs;
      invariant(sent.code === 0 && /finish/i.test(sent.stdout), "PROCESS_FAILED", "HQF transfer failed", { module: patch.module, output: clip(sent.stdout, 200) });
      if (patch.hash) invariant(await fileSha256(patch.hqf) === patch.hash, "CONFLICT", "HQF changed during transfer; patch was not applied");
      remoteFiles.push(remoteFile);
    }
    if (others?.length) {
      await verifyInputs();
      const observed = await installedPatchVersion(target, bundle, signal);
      invariant(observed === (baseline.patchVersion ?? 0), "CONFLICT", "An external quick fix changed the installed patch set", { observed, expected: baseline.patchVersion ?? 0 });
      // Persist intent before replacing the whole set. A lost response leaves reset available.
      atomicWrite(file, JSON.stringify({ ...baseline, pending: true }));
    }
    const applied = await shell(target, ["bm", "quickfix", "-a", "-f", ...remoteFiles, "-d", ...(verify ? ["-o"] : [])], signal, 120000);
    applyMs = applied.elapsedMs;
    const output = applied.stdout + applied.stderr;
    invariant(applied.code === 0 && /succe/i.test(output) && !/fail|error/i.test(output), "HOT_APPLY_FAILED", "bm quickfix failed", { output: clip(output, 600) });
    if (patchVersion !== undefined) {
      const observed = await installedPatchVersion(target, bundle, signal);
      invariant(observed === patchVersion, "EFFECT_UNCERTAIN", "The installed HQF version could not be verified", { expected: patchVersion, observed });
    }
    const [next, ...nextOthers] = plans.map((p) => p.next);
    atomicWrite(file, JSON.stringify({ ...baseline, ...next, ...(others ? { others: nextOthers } : {}), at: Date.now(), pending: undefined, patchVersion }));
  } finally {
    await shell(target, ["rm", "-rf", remote], undefined, 5000).catch(() => {});
  }
  const restartStarted = Date.now();
  let launch: Awaited<ReturnType<typeof import("./device.js").launchAndCheck>> | undefined;
  if (launchTarget) {
    const { launchAndCheck } = await import("./device.js");
    launch = await launchAndCheck(target, bundle, options.ability ?? launchTarget.ability, launchTarget.module, signal, 1500);
  }
  const after = await pidOf(target, bundle, signal);
  return {
    applied: true, files: requested.map((f) => path.relative(project.root, f)), added: plans.reduce((sum, p) => sum + p.added, 0),
    ...(others?.length ? { patches: patches.map(({ module, hash }) => ({ module, sha256: hash })) } : {}),
    ...(patchVersion !== undefined ? { resource_files: active.reduce((sum, p) => sum + p.patchResources.length, 0), patch_version: patchVersion,
      ...(patches.length === 1 ? { patch_sha256: patches[0]!.hash } : {}), requires_restart: !launch?.started } : {}),
    timings_ms: { compile: result.elapsedMs, signing: signingMs, transfer: transferMs, apply: applyMs, restart: Date.now() - restartStarted, total: Date.now() - started },
    restarted: after !== pid, pid: after, ...(launch ? { launch } : {}),
    note: "Verify the change with ui observe/assert",
  };
}
