import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { invariant, ToolError } from "../core/errors.js";
import { atomicWrite, clip, fileSha256, inside, readJson5, sha256, walk } from "../core/files.js";
import { run } from "../core/proc.js";
import { toolCommand } from "../core/toolchain.js";
import { hdc, install, installStamp, pidOf, shell } from "./device.js";
import { BuildOutputParser, type Project } from "./project.js";
import { decryptPassword } from "./sign.js";

/*
 * Hot reload = HQF quick fix applied to the running app (no reinstall, no restart):
 *   baseline: run build_run hot_reload=true (records source digests + device/app)
 *   apply:    diff sources -> changedFileList.json -> `hvigor assembleDevHqf`
 *             (ColdReloadArkTS compiles only changed files against the baseline symbol map,
 *              PackageHqf packs <module>-<target>-unsigned.hqf) -> sign -> `bm quickfix -a -f`
 * State: <module>/build/<product>/intermediates/deveco-mcp-hot.json
 */

interface Baseline {
  module: string; bundle: string; target: string; files: Record<string, string>; at: number;
  restore?: { directory: string; install: string; packages: { file: string; sha256: string }[] };
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
  return project.modules.filter((m) => (m.type === "entry" || m.type === "feature") && fs.existsSync(statePath(project, m.name))).map((m) => m.name);
}

function sourceDigests(moduleRoot: string) {
  const out: Record<string, string> = {};
  for (const file of walk(path.join(moduleRoot, "src/main/ets"), new Set())) if (/\.(ets|ts)$/.test(file)) out[file] = sha256(fs.readFileSync(file));
  return out;
}

/** Extra hvigor props for the baseline build (kept for parity with DevEco's hot-reload baseline). */
export function hotBuildProps() {
  return [] as string[];
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

function writeChangeList(project: Project, module: string, files: string[]) {
  const m = project.modules.find((x) => x.name === module)!;
  const patchDir = path.join(m.root, "build", project.product, "intermediates", "patch", m.target);
  fs.mkdirSync(patchDir, { recursive: true });
  const etsBase = path.join(m.root, "src/main/ets");
  fs.writeFileSync(path.join(patchDir, "changedFileList.json"),
    JSON.stringify({ resources: { resFile: [], rawFile: [] }, modifiedFiles: files.map((f) => path.relative(etsBase, f).replaceAll("\\", "/")) }));
  // hvigor keeps only changed files listed in ets.json#compiledFileList (the baseline's module graph).
  // Seed it with every current source so a patch compile never silently drops the edit.
  const etsJson = path.join(patchDir, "ets.json");
  const existing = fs.existsSync(etsJson) ? (JSON.parse(fs.readFileSync(etsJson, "utf8")) as { compiledFileList?: string[] }) : {};
  // hvigor compares resolved real paths (e.g. /private/var on macOS).
  const compiled = new Set([...(existing.compiledFileList ?? []), ...Object.keys(sourceDigests(m.root)).flatMap((f) => [f, fs.realpathSync(f)])]);
  fs.writeFileSync(etsJson, JSON.stringify({ ...existing, compiledFileList: [...compiled] }));
  return patchDir;
}

async function devHqf(project: Project, module: string, signal: AbortSignal) {
  const m = project.modules.find((x) => x.name === module)!;
  const parser = new BuildOutputParser(project.root);
  const result = await run(toolCommand("hvigor", ["assembleDevHqf", "--mode", "module", "-p", `module=${module}@${m.target}`, "-p", `product=${project.product}`,
    "-p", "debuggable=true", "--no-daemon", "--parallel", "--incremental"], project.root),
    { signal, timeoutMs: 600000, allowFailure: true, onLine: (l) => parser.line(l) });
  return { result, diagnostics: parser.finish() };
}

/**
 * Baseline: compile the unchanged module once through the cold-reload pipeline so hvigor
 * writes the symbol map (loader_out/ets/symbolMap.map) that later patch compiles diff against.
 */
export async function recordBaseline(project: Project, module: string, bundle: string, target: string, signal: AbortSignal, packages: { path: string; sha256: string }[]) {
  const m = project.modules.find((x) => x.name === module);
  invariant(m, "INVALID_INPUT", `Unknown module ${module}`);
  invariant(packages?.length, "NOT_FOUND", "Installed package receipt is missing; deploy again with hot_reload=true");
  const stamp = await installStamp(target, bundle, signal);
  invariant(stamp, "EFFECT_UNCERTAIN", "Cannot identify the installed baseline");
  const file = statePath(project, module);
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as Baseline : undefined;
  const directory = `deveco-mcp-baseline-${crypto.randomBytes(8).toString("hex")}`;
  const archive = baselineArchive(file, directory);
  const saved: { file: string; sha256: string }[] = [];
  const files = sourceDigests(m.root);
  fs.mkdirSync(archive, { recursive: true });
  try {
    for (const pkg of packages) {
      const name = path.basename(pkg.path);
      invariant(!saved.some((p) => p.file === name), "CONFLICT", `Duplicate baseline package name: ${name}`);
      fs.copyFileSync(pkg.path, path.join(archive, name), fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
      invariant(await fileSha256(path.join(archive, name)) === pkg.sha256, "CONFLICT", `Package changed after deployment: ${name}`);
      saved.push({ file: name, sha256: pkg.sha256 });
    }
    writeBuildConfig(project, module, false);
    writeChangeList(project, module, []);
    const { result, diagnostics } = await devHqf(project, module, signal).finally(() => clearBuildConfig(project));
    invariant(result.code === 0, "BUILD_FAILED", "Hot reload baseline compile failed", { ...diagnostics, tail: clip(result.stderr || result.stdout, 1500) });
    invariant(saved.every((p) => fs.existsSync(path.join(archive, p.file))), "CONFLICT", "Baseline packages were removed during compilation");
    invariant(await installStamp(target, bundle, signal) === stamp, "CONFLICT", "Installed app changed while recording the baseline");
    const baseline: Baseline = { module, bundle, target, files, at: Date.now(), restore: { directory, install: stamp, packages: saved } };
    atomicWrite(file, JSON.stringify(baseline));
  } catch (error) {
    fs.rmSync(archive, { recursive: true, force: true });
    throw error;
  }
  if (previous?.restore) fs.rmSync(baselineArchive(file, previous.restore.directory), { recursive: true, force: true });
  return { baseline: true, module, files: Object.keys(files).length, packages: saved.length };
}

/** bm quickfix -r only deletes inactive patches. Restore the exact installed packages instead. */
export async function resetHotReload(project: Project, module: string, target: string | undefined, signal: AbortSignal) {
  const file = statePath(project, module);
  const baseline = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Baseline) : undefined;
  const device = target ?? baseline?.target;
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
  const result = await shell(device, ["bm", "quickfix", "-q", "-b", baseline.bundle], signal, 15000);
  const output = result.stdout + result.stderr;
  invariant(result.code === 0 && /^\s*patch version code:\s*0\s*$/m.test(output)
    && new RegExp(`^\\s*bundle name:\\s*${baseline.bundle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(output)
    && !/fail|error/i.test(output), "EFFECT_UNCERTAIN", "Baseline packages installed, but cleared patch state could not be verified; baseline retained", { output: clip(output, 800) });
  // Replacement clears bundle-wide patches, including baselines recorded for other modules.
  for (const name of baselineModules(project)) {
    const state = statePath(project, name);
    const other = JSON.parse(fs.readFileSync(state, "utf8")) as Baseline;
    if (other.bundle !== baseline.bundle || other.target !== device) continue;
    if (other.restore) fs.rmSync(baselineArchive(state, other.restore.directory), { recursive: true, force: true });
    fs.rmSync(state, { force: true });
    fs.rmSync(path.join(project.modules.find((m) => m.name === name)!.root, "patch.json"), { force: true });
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

export async function applyHotReload(project: Project, module: string, signal: AbortSignal, log: (m: string) => void, options: { files?: string[]; restart?: boolean; ability?: string } = {}) {
  const m = project.modules.find((x) => x.name === module);
  invariant(m && ["entry", "feature"].includes(m.type), "INVALID_INPUT", `Hot reload needs an entry/feature module, got ${module}`);
  const file = statePath(project, module);
  invariant(fs.existsSync(file), "NOT_FOUND", "No hot-reload baseline for this module", undefined,
    "Start with run action=build_run hot_reload=true (installs the baseline build)");
  const baseline = JSON.parse(fs.readFileSync(file, "utf8")) as Baseline;
  const current = sourceDigests(m.root);
  // Explicit file list (like devecocli's --apply <fileName> list) or the automatic source diff.
  const explicit = options.files?.map((f) => path.resolve(project.root, f));
  for (const f of explicit ?? []) invariant(current[f] !== undefined, "INVALID_INPUT", `${path.relative(project.root, f)} is not an .ets/.ts source of module ${module}`);
  const changed = explicit ?? Object.keys(current).filter((f) => baseline.files[f] !== current[f]);
  const added = changed.filter((f) => !baseline.files[f]);
  const removed = Object.keys(baseline.files).filter((f) => !current[f]);
  invariant(changed.length, "INVALID_INPUT", "No .ets/.ts changes since the last hot reload");
  invariant(!removed.length, "INVALID_INPUT", "Files were deleted; hot reload cannot remove code", { removed: removed.map((f) => path.relative(project.root, f)) }, "Redeploy with run action=build_run");
  const pid = await pidOf(baseline.target, baseline.bundle, signal);
  invariant(pid, "NOT_FOUND", `${baseline.bundle} is not running on ${baseline.target}`, undefined, "Launch the app, then apply again");

  // 1. compile changed files against the baseline symbol map + package HQF
  log(`compiling patch for ${changed.length} file(s)`);
  writeBuildConfig(project, module, true);
  const patchDir = writeChangeList(project, module, changed);
  const outDir = path.join(m.root, "build", project.product, "outputs", m.target);
  const unsigned = path.join(outDir, `${module}-${m.target}-unsigned.hqf`);
  const signed = path.join(outDir, `${module}-${m.target}-signed.hqf`);
  fs.rmSync(unsigned, { force: true });
  fs.rmSync(signed, { force: true });
  const hvigorSigned = path.join(outDir, `${module}-${m.target}-signed.hqf`);
  fs.rmSync(path.join(patchDir, "ets"), { recursive: true, force: true });
  const { result, diagnostics } = await devHqf(project, module, signal).finally(() => clearBuildConfig(project));
  const patchAbc = [...walk(path.join(patchDir, "ets"), new Set())].some((f) => f.endsWith(".abc"));
  if (result.code !== 0 || !fs.existsSync(unsigned) || !patchAbc)
    throw new ToolError("BUILD_FAILED", patchAbc || result.code !== 0 ? "Hot reload compile failed" : "Compiler produced no patch code for these changes", { ...diagnostics, tail: clip(result.stderr || result.stdout, 2000) },
      "Fix compile errors. Structural changes (new pages, decorators, resources, module.json) need a full redeploy: run action=build_run");

  // 3. signing: hvigor signs the HQF itself whenever the project's signing is configured (build-profile
  //    signingConfigs or hvigorfile overrides) — use that as-is. Only sign ourselves from build-profile
  //    material when hvigor did not; never touch the project's signing files.
  let hqf = unsigned;
  const profile = readJson5(path.join(project.root, "build-profile.json5")) as { app: { signingConfigs?: any[]; products?: any[] } };
  const configName = profile.app.products?.find((p) => p.name === project.product)?.signingConfig;
  const signing = fs.existsSync(hvigorSigned) ? undefined : profile.app.signingConfigs?.find((c) => c.name === configName)?.material;
  if (fs.existsSync(hvigorSigned)) hqf = hvigorSigned;
  else if (signing) {
    const store = path.resolve(project.root, signing.storeFile);
    const sign = await run(toolCommand("signer", ["sign-app", "-mode", "localSign", "-keyAlias", signing.keyAlias, "-keyPwd", decryptPassword(signing.keyPassword, store),
      "-appCertFile", path.resolve(project.root, signing.certpath), "-profileFile", path.resolve(project.root, signing.profile), "-inFile", unsigned,
      "-signAlg", signing.signAlg ?? "SHA256withECDSA", "-keystoreFile", store, "-keystorePwd", decryptPassword(signing.storePassword, store), "-outFile", signed]), { signal, timeoutMs: 120000, allowFailure: true });
    invariant(sign.code === 0 && fs.existsSync(signed), "SIGN_FAILED", "Signing the HQF failed", { tail: clip(sign.stdout + sign.stderr, 800) });
    hqf = signed;
  }

  // 4. apply on device
  log("applying quick fix on device");
  const remote = `/data/local/tmp/deveco-hqf-${crypto.randomBytes(4).toString("hex")}`;
  await shell(baseline.target, ["mkdir", "-p", remote], signal);
  try {
    const remoteFile = `${remote}/${baseline.bundle}_0.hqf`;
    const sent = await hdc(["-t", baseline.target, "file", "send", hqf, remoteFile], signal, 60000, true);
    invariant(/finish/i.test(sent.stdout), "PROCESS_FAILED", `HQF transfer failed: ${clip(sent.stdout, 200)}`);
    const applied = await shell(baseline.target, ["bm", "quickfix", "-a", "-f", remoteFile, "-d"], signal, 120000);
    const text = applied.stdout + applied.stderr;
    invariant(/succe/i.test(text) && !/fail|error/i.test(text), "HOT_APPLY_FAILED", `bm quickfix failed: ${clip(text, 600)}`,
      undefined, hqf !== unsigned ? "The change may be unsupported by quick fix: redeploy with run action=build_run" : "Real devices require a signed HQF: configure signing (sign action=auto)");
  } finally {
    await shell(baseline.target, ["rm", "-rf", remote], undefined, 5000).catch(() => {}); // awaited: the host may exit right after this call
  }
  let launch: Awaited<ReturnType<typeof import("./device.js").launchAndCheck>> | undefined;
  if (options.restart && options.ability) {
    // `devecocli run --apply`: quick fix then relaunch, so startup code also runs the patch.
    const { launchAndCheck } = await import("./device.js");
    const { mainAbility } = await import("./project.js");
    const main = mainAbility(project, module);
    launch = await launchAndCheck(baseline.target, baseline.bundle, options.ability ?? main.ability, main.module, signal, 1500);
  }
  const after = await pidOf(baseline.target, baseline.bundle, signal);
  // Commit the new baseline so the next apply only sends newer changes.
  atomicWrite(file, JSON.stringify({ ...baseline, files: current, at: Date.now() }));
  return {
    applied: true, files: changed.map((f) => path.relative(project.root, f)), added: added.length,
    restarted: after !== pid, pid: after, ...(launch ? { launch } : {}),
    note: "Verify the change with ui observe/assert",
  };
}
