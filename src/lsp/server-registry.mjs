import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { resolveDevecoToolchain } from "../config.mjs";

const require = createRequire(import.meta.url);

let testCommand = null;

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function officialCliEntry() {
  try {
    const packageFile = require.resolve("@deveco/deveco-cli/package.json");
    const entry = path.join(path.dirname(packageFile), "dist", "cli.js");
    return isFile(entry) ? entry : null;
  } catch {
    return null;
  }
}

function studioContentRoot(root) {
  if (process.platform === "darwin" && root.endsWith(".app")) {
    return path.join(root, "Contents");
  }
  return root;
}

function officialBackendPath(toolchain) {
  if (!toolchain?.root) return null;
  if (toolchain.kind === "clt") {
    return path.join(
      toolchain.root,
      "arkts-lsp",
      "lib",
      "out",
      "standardIndex",
      "index.js",
    );
  }
  if (toolchain.kind === "studio") {
    return path.join(
      studioContentRoot(toolchain.root),
      "plugins",
      "openharmony",
      "ace-server",
      "out",
      "standardIndex",
      "index.js",
    );
  }
  return null;
}

function officialToolchainVersion(toolchain) {
  if (toolchain?.kind !== "studio" || !toolchain.root) return null;
  const contentRoot = studioContentRoot(toolchain.root);
  const candidates = [
    path.join(contentRoot, "Resources", "product-info.json"),
    path.join(contentRoot, "product-info.json"),
  ];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(fs.readFileSync(candidate, "utf8"));
      return {
        name: value.name ?? "DevEco Studio",
        version: value.version ?? null,
        buildNumber: value.buildNumber ?? null,
      };
    } catch {
      // Try the next official product metadata location.
    }
  }
  return null;
}

export function officialArktsServerStatus() {
  if (testCommand) {
    return {
      installed: true,
      provider: "test-only",
      bridge: testCommand.command,
      backend: testCommand.backend ?? null,
      toolchainKind: "test",
      toolchainRoot: null,
      toolchainSource: "test-only",
      toolchainVersion: null,
    };
  }

  const bridge = officialCliEntry();
  const toolchain = resolveDevecoToolchain();
  const backend = officialBackendPath(toolchain);
  return {
    installed: Boolean(bridge && backend && isFile(backend)),
    provider: "@deveco/deveco-cli",
    bridge,
    backend,
    toolchainKind: toolchain.kind,
    toolchainRoot: toolchain.root || null,
    toolchainSource: toolchain.source,
    toolchainVersion: officialToolchainVersion(toolchain),
  };
}

export function resolveOfficialArktsServer(projectRoot) {
  if (testCommand) {
    return {
      provider: "test-only",
      command: testCommand.command,
      args: typeof testCommand.args === "function"
        ? testCommand.args(projectRoot)
        : [...(testCommand.args ?? [])],
      cwd: projectRoot,
      env: { ...process.env, ...(testCommand.env ?? {}) },
      backend: testCommand.backend ?? null,
    };
  }

  const status = officialArktsServerStatus();
  if (!status.bridge) {
    const error = new Error(
      "The official @deveco/deveco-cli LSP bridge is not installed.",
    );
    error.code = "LSP_OFFICIAL_CLI_MISSING";
    error.hint = "Install this package's dependencies with npm install.";
    error.details = status;
    throw error;
  }
  if (!status.backend || !isFile(status.backend)) {
    const error = new Error(
      "The official ArkTS ace-server was not found in the selected DevEco Studio or Command Line Tools installation.",
    );
    error.code = "LSP_OFFICIAL_BACKEND_MISSING";
    error.hint = process.platform === "linux"
      ? "Install the official DevEco Command Line Tools and set DEVECO_CLI_CLT_PATH."
      : "Install DevEco Studio or set DEVECO_CLI_STUDIO_PATH/DEVECO_CLI_CLT_PATH to the official toolchain root.";
    error.details = status;
    throw error;
  }

  return {
    provider: status.provider,
    command: process.execPath,
    args: [
      status.bridge,
      "serve",
      "lsp",
      "--arkts",
      "--project-path",
      projectRoot,
    ],
    cwd: projectRoot,
    env: { ...process.env },
    backend: status.backend,
  };
}

/** Test-only protocol fixture injection; production discovery never reads an override. */
export function setOfficialArktsServerForTests(command) {
  testCommand = command ? { ...command } : null;
}
