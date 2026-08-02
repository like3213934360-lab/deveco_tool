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

export function resolveDevecoHome() {
  const configured = process.env.DEVECO_HOME || process.env.DEVECO_PATH;
  const candidates = [
    configured,
    "/Applications/DevEco-Studio.app/Contents",
    "/Applications/DevEco-Studio.app",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    const normalized = absolute.endsWith(".app")
      ? path.join(absolute, "Contents")
      : absolute;
    if (existingDirectory(normalized)) {
      return {
        path: normalized,
        source: configured ? "environment" : "macOS-default",
        configured: Boolean(configured),
      };
    }
  }

  return {
    path: configured ? path.resolve(configured) : "",
    source: configured ? "environment" : "not-found",
    configured: Boolean(configured),
  };
}

export function resolveHdcPath() {
  const explicit = process.env.HDC_PATH;
  if (explicit && fs.existsSync(explicit)) {
    return path.resolve(explicit);
  }

  const deveco = resolveDevecoHome();
  if (deveco.path) {
    const candidates = [
      path.join(deveco.path, "sdk", "default", "openharmony", "toolchains", "hdc"),
      path.join(deveco.path, "sdk", "default", "openharmony", "toolchains", "hdc.exe"),
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (found) return found;
  }

  return explicit || "hdc";
}

export function collectEnvironmentStatus() {
  const deveco = resolveDevecoHome();
  const hdc = resolveHdcPath();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    repoRoot: REPO_ROOT,
    skillsRoot: SKILLS_ROOT,
    devecoHome: deveco.path || null,
    devecoHomeSource: deveco.source,
    hdcPath: hdc,
    hdcExists: hdc !== "hdc" && fs.existsSync(hdc),
  };
}
