import fs from "node:fs";
import path from "node:path";
import { config, stateDir, toolGroups, version } from "../core/config.js";
import { errorResult } from "../core/errors.js";
import { sdkInfo, toolchain, type Component } from "../core/toolchain.js";

/** One call that tells the host what works, what is missing and how to fix it. */
export async function doctor(options: { project?: string; target?: string; remote?: boolean }, signal: AbortSignal) {
  const checks: { name: string; ok: boolean; detail?: unknown; fix?: string }[] = [];
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
  if (options.project) {
    try {
      const { inspectProject, projectInfo } = await import("./project.js");
      const info = projectInfo(inspectProject(options.project));
      checks.push({ name: "project", ok: true, detail: info, fix: info.dependencies_installed ? undefined : "Run project action=sync" });
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
    server: { version, node: process.version, state_dir: stateDir(), groups: [...toolGroups()], config: process.env.DEVECO_CONFIG ?? null, retention_days: config().retention_days },
    ok: checks.filter((c) => ["toolchain", "sdk"].includes(c.name)).every((c) => c.ok),
    checks,
  };
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
