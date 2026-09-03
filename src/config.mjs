import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(sourceDir, "..");
export const SKILLS_ROOT = path.join(REPO_ROOT, "skills");

function existingDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function normalizeStudioRoot(candidate) {
  const absolute = path.resolve(candidate);
  return path.basename(absolute) === "Contents" && absolute.endsWith(".app/Contents")
    ? path.dirname(absolute)
    : absolute;
}

function toolPaths(root, kind) {
  const windows = process.platform === "win32";
  if (kind === "clt") {
    const sdk = path.join(root, "sdk");
    return {
      node: path.join(root, "tool", "node", windows ? "node.exe" : "bin/node"),
      ohpm: path.join(root, "ohpm", "bin", "pm-cli.js"),
      hvigor: path.join(root, "hvigor", "bin", "hvigorw.js"),
      sdk,
      hdc: path.join(sdk, "default", "openharmony", "toolchains", windows ? "hdc.exe" : "hdc"),
      emulator: path.join(root, "emulator", windows ? "Emulator.exe" : "Emulator"),
    };
  }
  const contentRoot = process.platform === "darwin"
    && (root.endsWith(".app") || existingDirectory(path.join(root, "Contents")))
    ? path.join(root, "Contents")
    : root;
  const sdk = path.join(contentRoot, "sdk");
  return {
    node: path.join(contentRoot, "tools", "node", windows ? "node.exe" : "bin/node"),
    ohpm: path.join(contentRoot, "tools", "ohpm", "bin", "pm-cli.js"),
    hvigor: path.join(contentRoot, "tools", "hvigor", "bin", "hvigorw.js"),
    sdk,
    hdc: path.join(sdk, "default", "openharmony", "toolchains", windows ? "hdc.exe" : "hdc"),
    emulator: path.join(contentRoot, "tools", "emulator", windows ? "Emulator.exe" : "Emulator"),
  };
}

/** Resolve the official Studio/CLT environment priority and directory layouts. */
export function resolveDevecoToolchain() {
  const explicit = [
    ["DEVECO_CLI_STUDIO_PATH", "studio"],
    ["DEVECO_CLI_CLT_PATH", "clt"],
    ["DEVECO_HOME", "studio"],
    ["DEVECO_PATH", "studio"],
  ];
  for (const [name, kind] of explicit) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    const root = kind === "studio" ? normalizeStudioRoot(value) : path.resolve(value);
    return { root, kind, source: name, configured: true, paths: toolPaths(root, kind) };
  }

  const defaults = process.platform === "darwin"
    ? ["/Applications/DevEco-Studio.app"]
    : process.platform === "win32"
      ? ["C:\\Program Files\\Huawei\\DevEco Studio"]
      : [];
  const root = defaults.map(normalizeStudioRoot).find(existingDirectory);
  if (root) return { root, kind: "studio", source: "platform-default", configured: false, paths: toolPaths(root, "studio") };
  return { root: "", kind: null, source: "not-found", configured: false, paths: null };
}

export function resolveDevecoHome() {
  const toolchain = resolveDevecoToolchain();
  if (!toolchain.root) return { path: "", source: toolchain.source, configured: false, kind: null };
  const compatibilityPath = toolchain.kind === "studio" && process.platform === "darwin" && toolchain.root.endsWith(".app")
    ? path.join(toolchain.root, "Contents")
    : toolchain.root;
  return {
    path: compatibilityPath,
    source: toolchain.source,
    configured: toolchain.configured,
    kind: toolchain.kind,
  };
}

export function resolveHdcPath() {
  const explicit = process.env.HDC_PATH;
  if (explicit && fs.existsSync(explicit)) {
    return path.resolve(explicit);
  }

  const toolchain = resolveDevecoToolchain();
  if (toolchain.paths && fs.existsSync(toolchain.paths.hdc)) return toolchain.paths.hdc;

  return explicit || "hdc";
}

export function collectEnvironmentStatus() {
  const deveco = resolveDevecoHome();
  const toolchain = resolveDevecoToolchain();
  const hdc = resolveHdcPath();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    repoRoot: REPO_ROOT,
    skillsRoot: SKILLS_ROOT,
    devecoHome: deveco.path || null,
    devecoHomeSource: deveco.source,
    toolchainKind: toolchain.kind,
    toolchainRoot: toolchain.root || null,
    sdkPath: toolchain.paths?.sdk ?? null,
    hdcPath: hdc,
    hdcExists: hdc !== "hdc" && fs.existsSync(hdc),
  };
}
