import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { configuration } from "./config.js";
import { invariant } from "./errors.js";
import { parseObject, digest, fileDigest } from "./files.js";
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
const entryDigests = new Map<string, { metadata: string; sha256: string }>();
const metadataRecords = new Map<string, { sha256: string; record: Record<string, unknown>; bytes: number }>();
let metadataBytes = 0;
/** Read current bytes on every discovery. Only parsing is cached: even a
 * same-size edit with a restored timestamp must change the SDK identity. */
function readMetadata(file: string) {
  const bytes = fs.readFileSync(file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const previous = metadataRecords.get(file);
  if (previous?.sha256 === sha256) {
    metadataRecords.delete(file);
    metadataRecords.set(file, previous);
    return previous;
  }
  const result = { sha256, record: parseObject(bytes.toString("utf8")), bytes: bytes.length };
  if (previous) {
    metadataBytes -= previous.bytes;
    metadataRecords.delete(file);
  }
  if (bytes.length <= 4 * 1024 * 1024) {
    while (metadataRecords.size >= 128 || metadataBytes + bytes.length > 4 * 1024 * 1024) {
      const oldest = metadataRecords.keys().next().value!;
      metadataBytes -= metadataRecords.get(oldest)!.bytes;
      metadataRecords.delete(oldest);
    }
    metadataRecords.set(file, result);
    metadataBytes += bytes.length;
  }
  return result;
}
function entryDigest(file: string): string {
  const identity = () => {
    const stat = fs.statSync(file, { bigint: true });
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join(":");
  };
  const metadata = identity(), cached = entryDigests.get(file);
  if (cached?.metadata === metadata) return cached.sha256;
  const sha256 = fileDigest(file);
  invariant(identity() === metadata, "TOOLCHAIN_CHANGED", "Toolchain entry changed while its content was captured");
  if (!entryDigests.has(file) && entryDigests.size >= 128) entryDigests.delete(entryDigests.keys().next().value!);
  entryDigests.set(file, { metadata, sha256 });
  return sha256;
}
function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["ENOENT", "ENOTDIR"].includes(String(error.code))
    )
      return false;
    throw error;
  }
}
export function discoverToolchain(): Toolchain {
  const config = configuration();
  const defaultRoot =
    process.platform === "darwin"
      ? "/Applications/DevEco-Studio.app"
      : process.platform === "win32"
        ? "C:\\Program Files\\Huawei\\DevEco Studio"
        : "";
  const requestedRoot = path.resolve(
    config.clt || config.studio || defaultRoot || ".",
  );
  invariant(
    (config.clt || config.studio || defaultRoot) &&
      fs.existsSync(requestedRoot),
    "TOOLCHAIN_MISSING",
    "Configure studio or clt in DEVECO_CONFIG",
  );
  const root = fs.realpathSync.native(requestedRoot);
  const kind = config.clt ? "clt" : "studio";
  const content =
    kind === "studio" && fs.existsSync(path.join(root, "Contents"))
      ? path.join(root, "Contents")
      : root;
  const tools = kind === "studio" ? path.join(content, "tools") : content;
  const sdk = path.join(content, "sdk");
  const windows = process.platform === "win32";
  const executable = (name: string) => (windows ? `${name}.exe` : name);
  const javaHome =
    config.java_home ||
    (kind === "clt" ? process.env.JAVA_HOME?.trim() : undefined);
  const externalJava = javaHome
    ? path.join(path.resolve(javaHome), "bin", executable("java"))
    : undefined;
  invariant(
    !externalJava || isFile(externalJava),
    "JAVA_HOME_INVALID",
    "java_home or JAVA_HOME must identify a JDK containing bin/java",
  );
  const candidates: Record<Component, string[]> = {
    node: [
      path.join(
        tools,
        kind === "clt" ? "tool/node" : "node",
        windows ? "node.exe" : "bin/node",
      ),
    ],
    java: externalJava
      ? [externalJava]
      : kind === "clt"
        ? (process.env.Path ?? process.env.PATH ?? "")
            .split(path.delimiter)
            .filter((directory) => path.isAbsolute(directory.trim()))
            .map((directory) => path.join(directory.trim(), executable("java")))
        : [
            path.join(content, "jbr/Contents/Home/bin", executable("java")),
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
    linter: (kind === "clt"
      ? [
          "codelinter/index.js",
          "codelinter/run/index.js",
          "tool/codelinter/bin/codelinter.js",
          "tool/codelinter/codelinter.js",
        ]
      : [
          "plugins/codelinter/run/index.js",
          "plugins/codelinter/index.js",
          "tools/codelinter/bin/codelinter.js",
          "tools/codelinter/codelinter.js",
        ]
    ).map((file) => path.join(content, file)),
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
    const value = values.find(isFile);
    if (value) components[name as Component] = fs.realpathSync.native(value);
  }
  let version = "unknown";
  const cltVersion = path.join(root, "version.txt");
  if (kind === "clt" && isFile(cltVersion)) {
    invariant(
      fs.statSync(cltVersion).size <= 65536,
      "TOOLCHAIN_METADATA_INVALID",
      "CLT version metadata exceeds 64 KiB",
    );
    version =
      fs
        .readFileSync(cltVersion, "utf8")
        .match(/^#\s*Version:\s*(\S+)/m)?.[1] ?? "unknown";
  }
  for (const file of [
    path.join(content, "Resources/product-info.json"),
    path.join(content, "product-info.json"),
    path.join(root, "sdk-pkg.json"),
  ]) {
    if (fs.existsSync(file)) {
      const data = readMetadata(file).record;
      version = String(data.version ?? version);
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
  // The native emulator touches its own entry on startup without changing bytes.
  // Freeze content identity; stat metadata only invalidates the bounded digest
  // cache, so real replacements are detected without treating a touch as an SDK upgrade.
  const entries = Object.entries(components).map(([name, file]) => {
    let parent = path.dirname(file);
    while (parent.startsWith(content + path.sep)) {
      manifests.add(path.join(parent, "package.json"));
      parent = path.dirname(parent);
    }
    return [name, file, entryDigest(file)];
  });
  const versions: Record<string, string> = {};
  const metadata = [...manifests].sort().flatMap((file) => {
    if (!fs.existsSync(file)) return [];
    const { record, sha256 } = readMetadata(file);
    const data = record.data;
    const version =
      data && typeof data === "object" && "version" in data
        ? data.version
        : record.version;
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (typeof version === "string") versions[relative] = version;
    return [[relative, sha256]];
  });
  if (kind === "clt" && isFile(cltVersion)) {
    metadata.push(["version.txt", fileDigest(cltVersion)]);
    versions["version.txt"] = version;
  }
  if (components.java) {
    const release = path.join(
      path.dirname(path.dirname(components.java)),
      "release",
    );
    if (isFile(release)) {
      invariant(
        fs.statSync(release).size <= 65536,
        "TOOLCHAIN_METADATA_INVALID",
        "JDK release metadata exceeds 64 KiB",
      );
      metadata.push(["java/release", fileDigest(release)]);
      const value = fs
        .readFileSync(release, "utf8")
        .match(/^JAVA_VERSION="([^"]+)"/m)?.[1];
      if (value) versions["java/release"] = value;
    }
  }
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
    file && isFile(file),
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
