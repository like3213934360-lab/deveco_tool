import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { invariant } from "./errors.js";
import { isFile, readJson5 } from "./files.js";
import type { Command } from "./proc.js";

export type Component =
  | "node" | "java" | "ohpm" | "hvigor" | "hdc" | "arkts" | "clangd"
  | "linter" | "apiscan" | "emulator" | "signer" | "etsLoader";

export interface Toolchain {
  root: string;
  kind: "studio" | "clt";
  content: string;
  sdk: string;
  version: string;
  components: Partial<Record<Component, string>>;
}

let cached: { key: string; value: Toolchain } | undefined;

/** Cheap discovery: stat only. Cached until the configured root changes. */
export function toolchain(): Toolchain {
  const cfg = config();
  const fallback =
    process.platform === "darwin"
      ? "/Applications/DevEco-Studio.app"
      : process.platform === "win32"
        ? "C:\\Program Files\\Huawei\\DevEco Studio"
        : "";
  const requested = cfg.clt || cfg.studio || process.env.DEVECO_HOME || fallback;
  invariant(requested && fs.existsSync(requested), "TOOLCHAIN_MISSING",
    "DevEco Studio or Command Line Tools not found",
    { searched: requested || null },
    'Set "studio" or "clt" in the JSON file referenced by DEVECO_CONFIG');
  const key = `${requested}|${cfg.java_home ?? ""}`;
  if (cached?.key === key) return cached.value;

  const root = fs.realpathSync.native(requested);
  const kind: Toolchain["kind"] = cfg.clt ? "clt" : "studio";
  const content = kind === "studio" && fs.existsSync(path.join(root, "Contents")) ? path.join(root, "Contents") : root;
  const tools = kind === "studio" ? path.join(content, "tools") : content;
  const sdk = path.join(content, "sdk");
  const win = process.platform === "win32";
  const exe = (name: string) => (win ? `${name}.exe` : name);
  const javaHome = cfg.java_home || (kind === "clt" ? process.env.JAVA_HOME : undefined);
  const candidates: Record<Component, string[]> = {
    node: [path.join(tools, kind === "clt" ? "tool/node" : "node", win ? "node.exe" : "bin/node")],
    java: javaHome
      ? [path.join(javaHome, "bin", exe("java"))]
      : [path.join(content, "jbr/Contents/Home/bin", exe("java")), path.join(content, "jbr/bin", exe("java"))],
    ohpm: [path.join(tools, "ohpm/bin/pm-cli.js")],
    hvigor: [path.join(tools, "hvigor/bin/hvigorw.js")],
    hdc: [path.join(sdk, "default/openharmony/toolchains", exe("hdc")), path.join(sdk, "openharmony/toolchains", exe("hdc"))],
    arkts: [path.join(content, kind === "clt" ? "arkts-lsp/lib/out/standardIndex/index.js" : "plugins/openharmony/ace-server/out/standardIndex/index.js")],
    clangd: [path.join(sdk, "default/openharmony/native/llvm/bin", exe("clangd"))],
    linter: (kind === "clt"
      ? ["codelinter/index.js", "codelinter/run/index.js", "tool/codelinter/bin/codelinter.js"]
      : ["plugins/codelinter/run/index.js", "plugins/codelinter/index.js", "tools/codelinter/bin/codelinter.js"]
    ).map((file) => path.join(content, file)),
    apiscan: [path.join(content, "plugins/harmony/arkanalyzer-apiscan/api-change-scan.js")],
    emulator: [path.join(tools, "emulator", exe("Emulator"))],
    signer: [path.join(sdk, "default/openharmony/toolchains/lib/hap-sign-tool.jar")],
    etsLoader: [
      path.join(sdk, "default/openharmony/ets/build-tools/ets-loader/lib/ets_checker.js"),
      path.join(sdk, "openharmony/ets/build-tools/ets-loader/lib/ets_checker.js"),
    ],
  };
  if (!javaHome && kind === "clt")
    candidates.java.push(
      ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, exe("java"))),
    );
  const components: Partial<Record<Component, string>> = {};
  for (const [name, list] of Object.entries(candidates)) {
    const found = list.find(isFile);
    if (found) components[name as Component] = found;
  }
  let version = "unknown";
  for (const file of [path.join(content, "Resources/product-info.json"), path.join(content, "product-info.json"), path.join(root, "sdk-pkg.json")]) {
    if (isFile(file)) {
      const data = readJson5(file);
      version = String((data.data as Record<string, unknown> | undefined)?.version ?? data.version ?? version);
      break;
    }
  }
  if (kind === "clt" && isFile(path.join(root, "version.txt")))
    version = /^#\s*Version:\s*(\S+)/m.exec(fs.readFileSync(path.join(root, "version.txt"), "utf8"))?.[1] ?? version;
  const value: Toolchain = { root, kind, content, sdk, version, components };
  cached = { key, value };
  return value;
}

export function component(name: Component, tc = toolchain()): string {
  const file = tc.components[name];
  invariant(file, "CAPABILITY_UNAVAILABLE", `${name} is not available in ${tc.kind} ${tc.version}`,
    { component: name }, "Install or update DevEco Studio / Command Line Tools, then run doctor");
  return file;
}

/** Build a spawnable command for a toolchain component (js via bundled node, jar via java). */
export function toolCommand(name: Component, args: string[], cwd?: string, extraEnv?: Record<string, string>): Command {
  const tc = toolchain();
  const file = component(name, tc);
  const env: Record<string, string | undefined> = {
    ...process.env,
    DEVECO_SDK_HOME: tc.sdk,
    ...(tc.components.java ? { JAVA_HOME: path.dirname(path.dirname(tc.components.java)) } : {}),
    ...extraEnv,
  };
  if (file.endsWith(".js")) return { file: component("node", tc), args: [file, ...args], cwd, env };
  if (file.endsWith(".jar")) return { file: component("java", tc), args: ["-jar", file, ...args], cwd, env };
  return { file, args, cwd, env };
}

export function sdkInfo(tc = toolchain()) {
  const file = path.join(tc.sdk, "default/sdk-pkg.json");
  if (!isFile(file)) return null;
  const data = (readJson5(file).data ?? {}) as Record<string, unknown>;
  const api = Number(data.apiVersion);
  return {
    api_level: Number.isSafeInteger(api) ? api : null,
    platform_version: typeof data.platformVersion === "string" ? data.platformVersion : null,
    version: typeof data.version === "string" ? data.version : null,
  };
}
