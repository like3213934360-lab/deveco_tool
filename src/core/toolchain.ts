import fs from "node:fs";
import path from "node:path";
import { configuration } from "./config.js";
import { invariant } from "./errors.js";
import { readObject, digest, fileDigest } from "./files.js";
import type { Command } from "./process.js";

export type Component =
  | "node"
  | "java"
  | "ohpm"
  | "hvigor"
  | "hdc"
  | "arkts"
  | "clangd"
  | "linter"
  | "apiscan"
  | "emulator"
  | "signer";
export interface Toolchain {
  root: string;
  kind: "studio" | "clt";
  sdk: string;
  version: string;
  versions: Record<string, string>;
  fingerprint: string;
  components: Partial<Record<Component, string>>;
}
export function discoverToolchain(): Toolchain {
  const config = configuration();
  const defaultRoot =
    process.platform === "darwin"
      ? "/Applications/DevEco-Studio.app"
      : process.platform === "win32"
        ? "C:\\Program Files\\Huawei\\DevEco Studio"
        : "";
  const root = path.resolve(config.clt || config.studio || defaultRoot || ".");
  invariant(
    config.clt || config.studio || (defaultRoot && fs.existsSync(defaultRoot)),
    "TOOLCHAIN_MISSING",
    "Configure studio or clt in DEVECO_CONFIG",
  );
  const kind = config.clt ? "clt" : "studio";
  const content =
    kind === "studio" && fs.existsSync(path.join(root, "Contents"))
      ? path.join(root, "Contents")
      : root;
  const tools = kind === "studio" ? path.join(content, "tools") : content;
  const sdk = path.join(content, "sdk");
  const windows = process.platform === "win32";
  const executable = (name: string) => (windows ? `${name}.exe` : name);
  const candidates: Record<Component, string[]> = {
    node: [
      path.join(
        tools,
        kind === "clt" ? "tool/node" : "node",
        windows ? "node.exe" : "bin/node",
      ),
    ],
    java: [
      path.join(
        content,
        kind === "clt" ? "tool/jbr/bin" : "jbr/Contents/Home/bin",
        executable("java"),
      ),
      path.join(content, "jbr/bin", executable("java")),
    ],
    ohpm: [path.join(tools, "ohpm/bin/pm-cli.js")],
    hvigor: [path.join(tools, "hvigor/bin/hvigorw.js")],
    hdc: [
      path.join(sdk, "default/openharmony/toolchains", executable("hdc")),
      path.join(sdk, "openharmony/toolchains", executable("hdc")),
    ],
    arkts: [
      path.join(
        content,
        kind === "clt"
          ? "arkts-lsp/lib/out/standardIndex/index.js"
          : "plugins/openharmony/ace-server/out/standardIndex/index.js",
      ),
    ],
    clangd: [
      path.join(
        sdk,
        "default/openharmony/native/llvm/bin",
        executable("clangd"),
      ),
    ],
    linter: [
      path.join(content, "plugins/codelinter/run/index.js"),
      path.join(content, "codelinter/runner.js"),
    ],
    apiscan: [
      path.join(
        content,
        "plugins/harmony/arkanalyzer-apiscan/api-change-scan.js",
      ),
    ],
    emulator: [path.join(tools, "emulator", executable("Emulator"))],
    signer: [
      path.join(sdk, "default/openharmony/toolchains/lib/hap-sign-tool.jar"),
    ],
  };
  const components: Partial<Record<Component, string>> = {};
  for (const [name, values] of Object.entries(candidates)) {
    const value = values.find((file) => fs.existsSync(file));
    if (value) components[name as Component] = value;
  }
  let version = "unknown";
  for (const file of [
    path.join(content, "Resources/product-info.json"),
    path.join(content, "product-info.json"),
    path.join(root, "sdk-pkg.json"),
  ]) {
    if (fs.existsSync(file)) {
      const data = readObject(file);
      version = String(data.version ?? "unknown");
      break;
    }
  }
  const manifests = new Set([
    path.join(content, "Resources/product-info.json"),
    path.join(content, "product-info.json"),
    path.join(root, "sdk-pkg.json"),
    path.join(sdk, "default/sdk-pkg.json"),
    path.join(tools, "hvigor/hvigor/package.json"),
    path.join(tools, "hvigor/hvigor-ohos-plugin/package.json"),
    path.join(tools, "ohpm/package.json"),
  ]);
  const sdkDefault = path.join(sdk, "default");
  if (fs.existsSync(sdkDefault))
    for (const namespace of fs.readdirSync(sdkDefault, {
      withFileTypes: true,
    })) {
      if (!namespace.isDirectory()) continue;
      const directory = path.join(sdkDefault, namespace.name);
      for (const item of fs.readdirSync(directory, { withFileTypes: true }))
        if (item.isDirectory())
          manifests.add(path.join(directory, item.name, "oh-uni-package.json"));
    }
  // Capture entry-file replacement and package metadata without hashing SDK binaries
  // on every device call. SDK packages below the selected root are never executed.
  const entries = Object.entries(components).map(([name, file]) => {
    const stat = fs.statSync(file, { bigint: true });
    let parent = path.dirname(file);
    while (parent.startsWith(content + path.sep)) {
      manifests.add(path.join(parent, "package.json"));
      parent = path.dirname(parent);
    }
    return [
      name,
      fs.realpathSync(file),
      String(stat.ino),
      String(stat.size),
      String(stat.mtimeNs),
      String(stat.ctimeNs),
    ];
  });
  const versions: Record<string, string> = {};
  const metadata = [...manifests].sort().flatMap((file) => {
    if (!fs.existsSync(file)) return [];
    const record = readObject(file);
    const data = record.data;
    const version =
      data && typeof data === "object" && "version" in data
        ? data.version
        : record.version;
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (typeof version === "string") versions[relative] = version;
    return [[relative, fileDigest(file)]];
  });
  return {
    root,
    kind,
    sdk,
    version,
    versions,
    fingerprint: digest({ entries, metadata }),
    components,
  };
}
export function component(toolchain: Toolchain, name: Component): string {
  const file = toolchain.components[name];
  invariant(
    file && fs.existsSync(file),
    "CAPABILITY_UNAVAILABLE",
    `${name} is unavailable in selected ${toolchain.kind} ${toolchain.version}`,
  );
  return file;
}
export function toolCommand(
  toolchain: Toolchain,
  name: Component,
  args: string[],
  cwd?: string,
): Command {
  const file = component(toolchain, name);
  const env = {
    ...process.env,
    DEVECO_SDK_HOME: toolchain.sdk,
    JAVA_HOME: toolchain.components.java
      ? path.dirname(path.dirname(toolchain.components.java))
      : process.env.JAVA_HOME,
  };
  if (file.endsWith(".js"))
    return {
      executable: component(toolchain, "node"),
      args: [file, ...args],
      cwd,
      env,
    };
  if (file.endsWith(".jar"))
    return {
      executable: component(toolchain, "java"),
      args: ["-jar", file, ...args],
      cwd,
      env,
    };
  return { executable: file, args, cwd, env };
}
