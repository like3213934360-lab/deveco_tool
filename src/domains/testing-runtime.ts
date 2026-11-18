import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isFile } from "../core/files.js";
import { invariant } from "../core/errors.js";

/** Discover a Testing CLI and its bundled Java without starting either process. */
export function testingRuntime(home = process.env.DEVECO_TESTING_HOME, serviceCli = false) {
  const win = process.platform === "win32";
  const extension = win ? ".bat" : ".sh";
  const scriptNames = serviceCli ? ["DevEcoTestingCli" + extension] : ["DevEcoTestingConsole" + extension, "DevEcoTestingCli" + extension];
  const explicit = home?.trim();
  const roots = explicit ? [path.resolve(explicit)] : [];
  if (!explicit && win) roots.push(path.join(process.env.ProgramFiles ?? "C:\\Program Files", "DevEco Testing"));
  if (!explicit && process.platform === "linux") roots.push("/opt/deveco-testing");
  if (!explicit && process.platform === "darwin") {
    for (const directory of ["/Applications", path.join(os.homedir(), "Applications")]) {
      if (!fs.existsSync(directory)) continue;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const app = path.join(directory, entry.name), contents = path.join(app, "Contents");
        roots.push(path.join(contents, "PlugIns/java.jdk/Contents/Home"), contents, app);
      }
    }
  }
  const found = new Map<string, { script: string; java: string; directory: string }>();
  for (const root of roots) {
    const scripts = scriptNames.includes(path.basename(root)) ? [root] :
      scriptNames.flatMap((name) => [path.join(root, "bin", name), path.join(root, name)]);
    for (const script of scripts) {
      if (!isFile(script)) continue;
      const directory = path.dirname(script), inBin = path.basename(directory) === "bin";
      const java = path.join(inBin ? directory : path.join(directory, "bin"), win ? "java.exe" : "java");
      if (!isFile(java)) continue;
      const installation = inBin ? path.dirname(directory) : directory;
      const identity = fs.realpathSync(installation);
      if (!found.has(identity)) found.set(identity, { script, java, directory: installation });
    }
  }
  invariant(found.size <= 1, "CAPABILITY_UNAVAILABLE", "Several DevEco Testing CLI installations found; set DEVECO_TESTING_HOME", { candidates: [...found.values()].map((entry) => entry.script) });
  const installation = found.values().next().value;
  if (!installation) return undefined;
  const { script, java, directory } = installation, manifest = path.join(directory, "capabilities.json");
  if (!isFile(manifest)) return { script, java, manifest: "missing" as const };
  const raw = fs.readFileSync(manifest, "utf8");
  let data: { commands?: unknown } | null;
  try { data = JSON.parse(raw); }
  catch { return { script, java, manifest: "invalid" as const }; }
  if (!data || !Array.isArray(data.commands) || !data.commands.every((entry) => typeof entry === "string" && entry.trim()))
    return { script, java, manifest: "invalid" as const };
  return { script, java, manifest: "present" as const, commands: [...new Set<string>(data.commands.map((name) => name.trim()))] };
}
