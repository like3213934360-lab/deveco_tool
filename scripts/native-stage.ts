import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Runs before dependency installation so validation never installs the old CLI,
// child MCP or Skills. This creates a private validation kit, not a Release.
const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    import.meta.url.endsWith(".ts") ? ".." : "../..",
  ),
  output = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || fs.existsSync(output))
  throw new Error("Provide a new validation directory");
const raw: unknown = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
if (
  !raw ||
  typeof raw !== "object" ||
  !("dependencies" in raw) ||
  !("devDependencies" in raw)
)
  throw new Error("Missing package dependency declarations");
function record(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid dependency declarations");
  const entries = Object.entries(value);
  if (entries.some(([, version]) => typeof version !== "string"))
    throw new Error("Invalid dependency version");
  return Object.fromEntries(entries) as Record<string, string>;
}
const sourceDependencies = record(raw.dependencies),
  names = [
    "@langchain/core",
    "@langchain/langgraph",
    "@langchain/langgraph-checkpoint",
    "@langchain/langgraph-checkpoint-sqlite",
    "@modelcontextprotocol/sdk",
    "adm-zip",
    "ajv",
    "better-sqlite3",
    "json5",
    "koffi",
    "vscode-jsonrpc",
    "vscode-uri",
    "yauzl",
    "zod",
  ],
  dependencies = Object.fromEntries(
    names.map((name) => {
      const version = sourceDependencies[name];
      if (!version || !/^\d+\.\d+\.\d+$/.test(version))
        throw new Error(`Native dependency must be exactly pinned: ${name}`);
      return [name, version];
    }),
  );
fs.mkdirSync(output, { recursive: true });
function copy(directory: string, filter: (file: string) => boolean) {
  const walk = (relative: string) => {
    for (const item of fs.readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const file = path.join(relative, item.name);
      if (item.isSymbolicLink())
        throw new Error(`Validation input must not be a symlink: ${file}`);
      if (item.isDirectory()) walk(file);
      else if (item.isFile() && filter(file)) {
        fs.mkdirSync(path.dirname(path.join(output, file)), {
          recursive: true,
        });
        fs.copyFileSync(path.join(root, file), path.join(output, file));
      }
    }
  };
  walk(directory);
}
for (const directory of ["src", "scripts", "test"])
  copy(
    directory,
    (file) =>
      file.endsWith(".ts") ||
      file.startsWith(path.join("test", "fixtures", "harmony-app") + path.sep),
  );
for (const directory of ["resources", "provenance"])
  copy(directory, () => true);
copy("docs", (file) => path.basename(file).startsWith("native-"));
for (const file of [
  "tsconfig.json",
  "package-lock.json",
  "LICENSE",
  ...fs.readdirSync(root).filter((name) => name.startsWith("NOTICE.")),
])
  fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.writeFileSync(
  path.join(output, "package.json"),
  JSON.stringify(
    {
      name: "deveco-tool",
      version: "0.0.0-native-validation",
      private: true,
      description: "Private native TypeScript validation kit; not a release",
      type: "module",
      engines: { node: ">=22.18" },
      bin: { "deveco-tool": "dist/src/cli.js" },
      scripts: {
        build: "node --experimental-strip-types scripts/build.ts",
        typecheck: "tsc -p tsconfig.json --noEmit",
        test: "node dist/scripts/native-regression.js",
      },
      dependencies,
      devDependencies: record(raw.devDependencies),
    },
    null,
    2,
  ) + "\n",
);
fs.writeFileSync(
  path.join(output, "VALIDATION.md"),
  "# Native validation kit\n\nThis directory contains the native TypeScript architecture, fixtures and provenance. It is not a release and has no Skill installer, official CLI, child MCP, old launch entry or compatibility runtime. Normalize the copied lock with `npm install --package-lock-only --ignore-scripts`, install with `npm ci`, then run `npm run build`. Run `node dist/scripts/native-regression.js /absolute/new-evidence` to record tested bytes and results. SDK/device evidence and release gates are separate.\n",
);
process.stdout.write(`Native validation kit: ${output}\n`);
