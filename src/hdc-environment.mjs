import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function darwinUserTemp() {
  const directory = execFileSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], {
    encoding: "utf8", timeout: 1000, maxBuffer: 4096, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  return path.isAbsolute(directory) && fs.statSync(directory).isDirectory() ? directory : null;
}

// Some MCP hosts pass a minimal environment. On macOS, omitting TMPDIR added ~1.3 s
// to every HDC invocation in a controlled comparison. Resolve once, without a shell.
export function createHdcEnvironmentResolver({ platform = process.platform, resolveTemp = darwinUserTemp } = {}) {
  let resolved = false;
  let directory = null;
  return (environment = process.env) => {
    if (platform !== "darwin" || environment.TMPDIR) return environment;
    if (!resolved) {
      resolved = true;
      try { directory = resolveTemp(); } catch { /* Preserve existing fallback if discovery is unavailable. */ }
    }
    return directory ? { ...environment, TMPDIR: directory } : environment;
  };
}

export const hdcEnvironment = createHdcEnvironmentResolver();
