import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSON5 from "json5";
import { z } from "zod";
import { stateDir } from "../core/config.js";
import { errorResult, invariant, ToolError } from "../core/errors.js";
import { atomicWrite, fileSha256, inside, sha256 } from "../core/files.js";
import { jobStatus } from "../core/jobs.js";
import { install, installStamp, launch, launchDeepLink } from "./device.js";
import { checkedCommand, parseBundleInfo, parseForeground } from "./device-controls.js";
import { installedPatchVersion } from "./hotreload.js";
import { mainAbility, type Project } from "./project.js";
import { selectorSchema } from "./selectors.js";
import { invalidate, waitFor } from "./ui.js";
import { validateSelector } from "./ui-query.js";
import { validateDeepLink } from "./uitest.js";

export const routeOptions = z.object({
  baseline_job: z.string().min(1),
  edits: z.array(z.object({ file: z.string().min(1), before_sha256: z.string().regex(/^[\da-f]{64}$/), content: z.string().min(1).max(256_000) }).strict()).min(1).max(8),
  cases: z.array(z.object({ uri: z.string().min(1).max(4096), visible: selectorSchema.optional(), hidden: selectorSchema.optional(), timeout_ms: z.number().int().min(100).max(30000).optional() }).strict()
    .refine((entry) => !!entry.visible !== !!entry.hidden, "Pass one visible or hidden selector")).min(1).max(10),
}).strict();

export function readRoutes(options: unknown) {
  const parsed = routeOptions.parse(options);
  for (const entry of parsed.cases) { validateDeepLink(entry.uri); validateSelector((entry.visible ?? entry.hidden)!); }
  return parsed;
}

function packageOutputs(project: Project) {
  return project.modules.flatMap((module) => {
    const directory = path.join(module.root, "build", project.product, "outputs", module.target);
    return (fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }) : [])
      .filter((entry) => entry.isFile() && /\.(hap|hsp)$/.test(entry.name)).map((entry) => path.join(directory, entry.name));
  });
}

async function installedIdentity(target: string, bundle: string, signal: AbortSignal) {
  const info = parseBundleInfo(await checkedCommand(target, ["bm", "dump", "-n", bundle], signal));
  const details = z.object({ name: z.literal(bundle), applicationInfo: z.object({ debug: z.literal(true) }),
    versionCode: z.number().int(), versionName: z.string(), hapModuleInfos: z.array(z.object({ moduleName: z.string() })).min(1) }).safeParse(info);
  invariant(details.success, "CAPABILITY_UNAVAILABLE", "Temporary routes require a verifiable installed debug package");
  return { version: details.data.versionName, code: details.data.versionCode, modules: details.data.hapModuleInfos.map((module) => module.moduleName).sort() };
}

/** Apply caller-reviewed edits only while installed debug package and source backups are verifiable. */
export async function verifyTemporaryRoute(project: Project, target: string, options: unknown, deploy: (remember: (id: string) => void) => Promise<void>, signal: AbortSignal) {
  const routes = readRoutes(options), bundle = project.bundleName;
  invariant(bundle && /^[\w.]+$/.test(bundle), "INVALID_INPUT", "Temporary routes require an app bundle");
  const root = fs.realpathSync(project.root), main = mainAbility(project);
  invariant(main.ability, "INVALID_INPUT", "The project has no launchable ability");
  const edits = routes.edits.map((edit, i) => {
    const file = inside(root, edit.file);
    invariant(fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() && fs.realpathSync(file) === file, "INVALID_INPUT", "Temporary edits require existing regular project files", { file: edit.file });
    invariant(project.modules.some((module) => {
      const relative = path.relative(module.root, file).replaceAll("\\", "/");
      return relative === "src/main/module.json5" || /^src\/main\/ets\/[^\n]+\.ets$/.test(relative) || /^src\/main\/resources\/base\/profile\/[\w-]+\.json$/.test(relative);
    }), "INVALID_INPUT", "Temporary edits are limited to ArkTS, module manifests and page profiles", { file: edit.file });
    const bytes = fs.readFileSync(file);
    invariant(sha256(bytes) === edit.before_sha256, "CONFLICT", "Source changed since the temporary route was reviewed", { file: edit.file });
    if (path.basename(file) === "module.json5") {
      const prior = JSON5.parse(bytes.toString("utf8")).module, after = JSON5.parse(edit.content).module;
      invariant(after && prior && ["name", "type", "mainElement"].every((field) => after[field] === prior[field]),
        "INVALID_INPUT", "Temporary routes must preserve the module and main ability identity", { file: edit.file });
    }
    return { file, bytes, mode: fs.statSync(file).mode & 0o777, original: edit.before_sha256, replacement: sha256(edit.content), content: edit.content, backup: `source-${i}` };
  });
  invariant(new Set(edits.map((edit) => edit.file)).size === edits.length, "INVALID_INPUT", "Temporary edits contain duplicate files");
  invariant(await installedPatchVersion(target, bundle, signal) === 0, "CONFLICT", "Reset the app's active HQF before verifying temporary routes");
  const stamp = await installStamp(target, bundle, signal);
  invariant(stamp, "EVIDENCE_MISSING", "The original installation could not be identified");
  const baseline = await jobStatus(routes.baseline_job, true), receipt = baseline.outputs?.install;
  invariant(baseline.kind === "build_run" && baseline.status === "succeeded" && baseline.input?.project && fs.realpathSync(baseline.input.project) === root
    && baseline.outputs?.target?.target === target && receipt?.stamp === stamp,
  "CONFLICT", "Baseline job does not identify the current project installation", undefined, "Deploy with run build_run debug_line=true run_mode=full and use its job ID");
  const identity = await installedIdentity(target, bundle, signal);
  const packages = z.array(z.object({ path: z.string(), module: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).safeParse(receipt.package_files);
  invariant(packages.success && JSON.stringify(packages.data.map((pkg) => pkg.module).sort()) === JSON.stringify(identity.modules),
    "EVIDENCE_MISSING", "Baseline job does not cover the installed module set", { installed_modules: identity.modules });
  const foreground = parseForeground(await checkedCommand(target, ["aa", "dump", "-l"], signal)).some((entry) => entry.bundle === bundle);
  const recoveryRoot = path.join(stateDir(), "route-recovery");
  fs.mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
  const backup = fs.mkdtempSync(path.join(recoveryRoot, "run-"));
  let deployAttempted = false, temporaryJob: string | undefined, temporaryStamp: string | undefined, failure: unknown;
  const written: typeof edits = [];
  const saved: { file: string; sha256: string }[] = [];
  const outputs = new Map<string, { file: string; sha256: string }>();
  try {
    for (const [i, pkg] of packages.data.entries()) {
      signal.throwIfAborted();
      const file = path.join(backup, `package-${i}${path.extname(pkg.path)}`);
      invariant(fs.existsSync(pkg.path), "EVIDENCE_MISSING", "Original build package is missing", { file: pkg.path });
      fs.copyFileSync(pkg.path, file, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
      invariant(await fileSha256(file) === pkg.sha256, "EVIDENCE_MISSING", "Original build package changed after installation", { file: pkg.path });
      saved.push({ file, sha256: pkg.sha256 });
      outputs.set(pkg.path, saved[i]!);
    }
    for (const output of packageOutputs(project)) {
      if (outputs.has(output)) continue;
      const file = path.join(backup, `output-${outputs.size}${path.extname(output)}`);
      fs.copyFileSync(output, file, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
      outputs.set(output, { file, sha256: await fileSha256(file) });
    }
    atomicWrite(path.join(backup, "recovery.json"), JSON.stringify({ target, bundle, stamp,
      files: edits.map(({ file, mode, original, replacement, backup }) => ({ file, mode, original, replacement, backup })), packages: saved, outputs: Object.fromEntries(outputs) }), 0o600);
    for (const edit of edits) {
      signal.throwIfAborted();
      invariant(fs.realpathSync(edit.file) === edit.file && sha256(fs.readFileSync(edit.file)) === edit.original,
        "CONFLICT", "Source changed before the temporary edit", { file: edit.file });
      atomicWrite(path.join(backup, edit.backup), edit.bytes, 0o600);
      written.push(edit);
      atomicWrite(edit.file, edit.content, edit.mode);
      fs.chmodSync(edit.file, edit.mode);
    }
    invariant(await installStamp(target, bundle, signal) === stamp, "CONFLICT", "The app changed while the temporary route was prepared");
    deployAttempted = true;
    await deploy((id) => { temporaryJob = id; });
    temporaryStamp = temporaryJob ? (await jobStatus(temporaryJob, true)).outputs?.install?.stamp : undefined;
    invariant(temporaryStamp && temporaryStamp !== stamp && await installStamp(target, bundle, signal) === temporaryStamp,
      "EFFECT_UNCERTAIN", "The temporary installation could not be identified");
    const samples = [];
    for (const [index, entry] of routes.cases.entries()) {
      await launchDeepLink(target, bundle, entry.uri, signal);
      invalidate(target);
      const visible = await waitFor(target, { bundle }, "visible", entry.timeout_ms ?? 5000, signal, false, { bundle });
      invariant(visible.passed, "EVIDENCE_MISSING", "The route was accepted but the expected app did not become visible", { case: index + 1 });
      const verdict = await waitFor(target, (entry.visible ?? entry.hidden)!, entry.visible ? "visible" : "hidden", entry.timeout_ms ?? 5000, signal, false, { bundle });
      samples.push({ case: index + 1, ...verdict });
    }
    return { verdict: samples.every((sample) => sample.passed) ? "passed" as const : "failed" as const, cases: samples, restored: true };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const errors = [];
    for (const edit of written.reverse()) {
      try {
        invariant(fs.realpathSync(edit.file) === edit.file, "CONFLICT", "Temporary source path changed during verification", { file: edit.file });
        const current = sha256(fs.readFileSync(edit.file));
        if (current === edit.original) continue;
        invariant(current === edit.replacement, "CONFLICT", "Source was edited during verification", { file: edit.file });
        atomicWrite(edit.file, edit.bytes, edit.mode);
        fs.chmodSync(edit.file, edit.mode);
        invariant(sha256(fs.readFileSync(edit.file)) === edit.original, "EVIDENCE_MISSING", "Restored source digest differs", { file: edit.file });
      } catch (error) { errors.push(errorResult(error)); }
    }
    if (deployAttempted) {
      const cleanup = AbortSignal.timeout(600000);
      try {
        if (!temporaryStamp && temporaryJob) temporaryStamp = (await jobStatus(temporaryJob, true)).outputs?.install?.stamp;
        const current = await installStamp(target, bundle, cleanup);
        invariant(current && (current === stamp || current === temporaryStamp), "CONFLICT", "The current app installation could not be attributed to this verification");
        if (current !== stamp) {
          const files = saved.map((pkg) => pkg.file);
          await install(target, files, cleanup);
        }
        invariant(JSON.stringify(await installedIdentity(target, bundle, cleanup)) === JSON.stringify(identity), "EVIDENCE_MISSING", "Restored installation identity differs");
        invariant(await installedPatchVersion(target, bundle, cleanup) === 0, "EVIDENCE_MISSING", "Unexpected patch state after restoring original debug packages");
        if (foreground && current !== stamp) await launch(target, bundle, main.ability, main.module, cleanup);
      } catch (error) { errors.push(errorResult(error)); }
      try {
        for (const output of packageOutputs(project)) if (!outputs.has(output)) fs.rmSync(output);
        for (const [output, entry] of outputs) {
          if (fs.existsSync(output) && await fileSha256(output) === entry.sha256) continue;
          const next = `${output}.${crypto.randomUUID()}.tmp`;
          try { fs.copyFileSync(entry.file, next, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE); fs.renameSync(next, output); }
          finally { fs.rmSync(next, { force: true }); }
          invariant(await fileSha256(output) === entry.sha256, "EVIDENCE_MISSING", "Restored build output digest differs", { file: output });
        }
      } catch (error) { errors.push(errorResult(error)); }
    }
    if (errors.length) throw new ToolError("DEVICE_CLEANUP_FAILED", "Temporary route restoration requires attention", { backup, errors, original: failure ? errorResult(failure) : undefined });
    fs.rmSync(backup, { recursive: true, force: true });
  }
}
