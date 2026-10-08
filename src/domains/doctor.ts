import fs from "node:fs";
import path from "node:path";
import { buildInfo, config, stateDir, version } from "../core/config.js";
import { errorResult } from "../core/errors.js";
import { sdkInfo, toolchain, type Component } from "../core/toolchain.js";

/** One call that tells the host what works, what is missing and how to fix it. */
export async function doctor(options: { project?: string; target?: string; remote?: boolean }, signal: AbortSignal) {
  const checks: { name: string; ok: boolean; detail?: unknown; fix?: string }[] = [];
  try {
    const { database, recovered } = await import("../core/db.js");
    await database();
    const now = (await import("../core/db.js")).recovered ?? recovered;
    checks.push(now
      ? { name: "state", ok: false, detail: now, fix: `The state database was corrupted and recreated (backup ${now.backup}); log in again with auth if needed. The backup can be deleted` }
      : { name: "state", ok: true, detail: { dir: stateDir() } });
  } catch (error) {
    checks.push({ name: "state", ok: false, detail: errorResult(error), fix: `Check permissions of ${stateDir()} (or set DEVECO_STATE_DIR)` });
  }
  let tc: ReturnType<typeof toolchain> | undefined;
  try {
    tc = toolchain();
    checks.push({ name: "toolchain", ok: true, detail: { kind: tc.kind, version: tc.version, root: tc.root } });
  } catch (error) {
    checks.push({ name: "toolchain", ok: false, detail: errorResult(error), fix: 'Install DevEco Studio or Command Line Tools and set "studio"/"clt" in DEVECO_CONFIG' });
  }
  if (tc) {
    const sdk = sdkInfo(tc);
    checks.push({ name: "sdk", ok: !!sdk?.api_level, detail: sdk ?? undefined, fix: sdk?.api_level ? undefined : "Install an SDK via DevEco Studio SDK Manager" });
    const important: [Component, string][] = [
      ["node", "run hvigor/ohpm"], ["hvigor", "build"], ["ohpm", "install dependencies"], ["hdc", "devices"], ["arkts", "ArkTS language service"],
      ["etsLoader", "ArkTS static check"], ["java", "signing / HQF"], ["signer", "signing"], ["linter", "Code Linter"], ["clangd", "C/C++ language service"],
      ["emulator", "emulator"], ["apiscan", "API compatibility scan"],
    ];
    const missing = important.filter(([c]) => !tc!.components[c]).map(([c, use]) => `${c} (${use})`);
    checks.push({ name: "components", ok: missing.length === 0, detail: missing.length ? { missing } : { all: important.length } });
  }
  if (tc?.components.hdc) {
    try {
      const { listTargets, deviceInfo } = await import("./device.js");
      const targets = await listTargets(signal);
      const info = options.target ?? (targets.length === 1 ? targets[0] : undefined);
      checks.push({
        name: "devices", ok: targets.length > 0, detail: { connected: targets, ...(info ? { info: await deviceInfo(info, signal).catch((e) => errorResult(e)) } : {}) },
        fix: targets.length ? undefined : "Connect a device with USB debugging, or start an emulator (emulator action=start)",
      });
    } catch (error) {
      checks.push({ name: "devices", ok: false, detail: errorResult(error) });
    }
  }
  let deviceApi: number | undefined;
  const deviceCheck = checks.find((c) => c.name === "devices");
  const info = (deviceCheck?.detail as { info?: { api_level?: number } } | undefined)?.info;
  if (info?.api_level) deviceApi = info.api_level;
  if (options.project) {
    try {
      const { inspectProject, projectInfo } = await import("./project.js");
      const info = projectInfo(inspectProject(options.project));
      checks.push({ name: "project", ok: true, detail: info, fix: info.dependencies_installed ? undefined : "Run project action=sync" });
      if (tc) checks.push(compatibility(info.sdk, sdkInfo(tc)?.api_level ?? undefined, deviceApi));
    } catch (error) {
      checks.push({ name: "project", ok: false, detail: errorResult(error) });
    }
  }
  const { status: kbStatus } = await import("./knowledge.js");
  const kb = await kbStatus(options.remote ?? false);
  checks.push({ name: "knowledge", ok: !!kb.installed, detail: kb, fix: kb.installed ? ("update_available" in kb && kb.update_available ? "knowledge action=update" : undefined) : "knowledge action=update" });
  const { status: authStatus } = await import("./auth.js");
  const auth = await Promise.all((["developer", "codegenie"] as const).map((p) => authStatus(p).catch(() => ({ provider: p, logged_in: false }))));
  checks.push({ name: "auth", ok: true, detail: auth, fix: auth.some((a) => !a.logged_in) ? "Optional: auth action=login provider=codegenie (cloud knowledge) / developer (signing)" : undefined });
  return {
    server: { version, build_id: buildInfo.input_hash, node: process.version, state_dir: stateDir(), config: process.env.DEVECO_CONFIG ?? null, retention_days: config().retention_days },
    ok: checks.filter((c) => ["toolchain", "sdk"].includes(c.name)).every((c) => c.ok),
    checks,
  };
}

/** API level from "5.0.0(12)", "6.0.2(22)", "26.0.0" or "12". */
export function apiOf(version?: string): number | undefined {
  if (!version) return undefined;
  const paren = /\((\d+)\)/.exec(version)?.[1];
  if (paren) return Number(paren);
  const major = Number(/^(\d+)/.exec(version)?.[1]);
  // Platform 26.0.0 maps to API 26; bare integers are API levels.
  return Number.isFinite(major) ? major : undefined;
}

/** Project SDK vs installed SDK vs device API (upstream `check versions`, extended with fixes). */
export function compatibility(sdk: { compile?: string; target?: string; compatible?: string }, installedApi: number | undefined, deviceApi: number | undefined) {
  const compile = apiOf(sdk.compile), compatible = apiOf(sdk.compatible);
  const problems: string[] = [];
  const fixes: string[] = [];
  if (compile && installedApi && compile > installedApi) {
    problems.push(`compileSdkVersion API ${compile} is newer than the installed SDK (API ${installedApi})`);
    fixes.push("Install the matching SDK in DevEco Studio, or lower compileSdkVersion in build-profile.json5");
  }
  if (compatible && compile && compatible > compile) {
    problems.push(`compatibleSdkVersion API ${compatible} exceeds compileSdkVersion API ${compile}`);
    fixes.push("Set compatibleSdkVersion <= compileSdkVersion");
  }
  if (compatible && deviceApi && deviceApi < compatible) {
    problems.push(`Device API ${deviceApi} is below compatibleSdkVersion API ${compatible}: install will fail`);
    fixes.push("Use a newer device/emulator image, or lower compatibleSdkVersion (check APIs with code action=api_scan)");
  }
  return { name: "compatibility", ok: problems.length === 0, detail: { compile_api: compile, compatible_api: compatible, installed_sdk_api: installedApi, device_api: deviceApi, problems }, fix: fixes.join("; ") || undefined };
}

export function stateUsage() {
  const dir = stateDir();
  const size = (p: string): number => {
    if (!fs.existsSync(p)) return 0;
    const stat = fs.statSync(p);
    return stat.isDirectory() ? fs.readdirSync(p).reduce((sum, e) => sum + size(path.join(p, e)), 0) : stat.size;
  };
  return { state_dir: dir, bytes: { artifacts: size(path.join(dir, "artifacts")), kb: size(path.join(dir, "kb")), db: size(path.join(dir, "state.db")) } };
}
