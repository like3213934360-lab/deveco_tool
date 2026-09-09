import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Optional isolated source copy for validation. It uses the root package and exact lock unchanged.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith(".ts") ? ".." : "../..");
const output = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || fs.existsSync(output)) throw new Error("Provide a new isolated source directory");
fs.mkdirSync(output, { recursive: true });
function copy(relative: string) {
  const source = path.join(root, relative), stat = fs.lstatSync(source), target = path.join(output, relative);
  if (stat.isSymbolicLink()) throw new Error(`Source copy must not traverse a symlink: ${relative}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source)) copy(path.join(relative, name));
  } else {
    if (!stat.isFile()) throw new Error(`Source copy requires regular files: ${relative}`);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
}
for (const directory of ["src", "scripts", "test", "resources", "provenance", "docs"]) copy(directory);
for (const file of ["tsconfig.json", "package.json", "package-lock.json", "README.md", "LICENSE", ...fs.readdirSync(root).filter((name) => name.startsWith("NOTICE."))]) copy(file);
process.stdout.write(`Isolated source copy: ${output}\nInstall the unchanged lock with npm ci, then npm run build.\n`);
