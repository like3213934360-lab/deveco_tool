#!/usr/bin/env node
/**
 * @file Host-neutral installer for the HarmonyOS capability pack.
 * @author deveco-tool
 *
 * Materialises `skills/`, `commands/`, `templates/` and `manifest.json` into a target
 * directory. It deliberately does NOT touch any host configuration file — wiring the pack
 * into a specific AI tool is the consumer's decision. Use `--print-mcp` to obtain the stdio
 * MCP snippet to paste wherever the host expects it.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = ["skills", "commands", "templates", "manifest.json"];
const MARKER = ".harmony-pack.json";

const USAGE = `Usage: node scripts/install.mjs [options]

  --dest <dir>    Target directory to install into (required unless --print-mcp)
  --profile <p>   Which skills to install: full (default) or core
  --copy          Copy assets instead of symlinking them (default: symlink)
  --dry-run       Print the planned actions without touching the filesystem
  --uninstall     Remove assets previously installed by this script from <dir>
  --print-mcp     Print the stdio MCP config snippet as JSON and exit
  --help          Show this message

Installed assets: ${ASSETS.join(", ")}

Profiles differ only in which skill directories are linked. manifest.json is always installed
whole, so the routing index in skills/INDEX.md stays accurate about what exists upstream:

  full   every skill (core + extended)
  core   only tier "core" skills — the DevEco Code extraction, MIT throughout. Leaves out the
         extended layer, whose upstream ships no repository-level licence declaration.
`;

/**
 * Parse argv into an options object.
 * @param {string[]} argv Raw process arguments (without node and script path).
 * @returns {{dest: string, copy: boolean, dryRun: boolean, uninstall: boolean, printMcp: boolean, help: boolean}} Parsed options.
 */
function parseArgs(argv) {
  const options = {
    dest: "",
    profile: "full",
    copy: false,
    dryRun: false,
    uninstall: false,
    printMcp: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dest") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--dest requires a directory path");
      options.dest = value;
      index += 1;
    } else if (argument === "--profile") {
      const value = argv[index + 1];
      if (!value || !["core", "full"].includes(value)) throw new Error("--profile must be core or full");
      options.profile = value;
      index += 1;
    } else if (argument === "--copy") options.copy = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--uninstall") options.uninstall = true;
    else if (argument === "--print-mcp") options.printMcp = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

/**
 * Build the stdio MCP configuration snippet for this pack.
 * @returns {{command: string, args: string[]}} A host-agnostic stdio MCP entry.
 */
function mcpSnippet() {
  return { command: "node", args: [path.join(PACK_ROOT, "src", "server.mjs")] };
}

/**
 * Read the pack manifest.
 * @returns {Promise<Record<string, unknown>>} Parsed manifest.json contents.
 */
async function readManifest() {
  return JSON.parse(await fs.readFile(path.join(PACK_ROOT, "manifest.json"), "utf8"));
}

/**
 * Check whether a path exists.
 * @param {string} target Absolute path to probe.
 * @returns {Promise<boolean>} True when the path exists (symlinks are not followed).
 */
async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a previously installed asset, refusing to delete anything this script did not place.
 * @param {string} target Absolute path inside the destination directory.
 * @param {Set<string>} owned Asset names recorded in the install marker.
 * @param {boolean} dryRun When true, only report what would happen.
 * @returns {Promise<string>} A human-readable outcome for logging.
 */
async function removeAsset(target, owned, dryRun) {
  const name = path.basename(target);
  if (!(await exists(target))) return `skip ${name} (absent)`;
  if (!owned.has(name)) return `keep ${name} (not installed by this script)`;
  if (dryRun) return `would remove ${name}`;
  await fs.rm(target, { recursive: true, force: true });
  return `removed ${name}`;
}

/**
 * Install one asset into the destination directory.
 * @param {string} name Asset name relative to the pack root.
 * @param {string} dest Absolute destination directory.
 * @param {{copy: boolean, dryRun: boolean, owned: Set<string>}} options Install behaviour.
 * @returns {Promise<string>} A human-readable outcome for logging.
 */
async function installAsset(name, dest, options) {
  const source = path.join(PACK_ROOT, name);
  const target = path.join(dest, name);
  const mode = options.copy ? "copy" : "symlink";
  // Under the core profile the skills directory is assembled entry by entry rather than linked
  // whole, so the extended layer stays out of the host's skill index.
  const selective = name === "skills" && options.coreSkills !== undefined;
  const suffix = selective ? `, core profile: ${options.coreSkills.length} skills` : "";

  if (await exists(target)) {
    if (!options.owned.has(name)) {
      throw new Error(
        `${target} already exists and was not installed by this script. Move it aside or pick another --dest.`,
      );
    }
    if (options.dryRun) return `would replace ${name} (${mode}${suffix})`;
    await fs.rm(target, { recursive: true, force: true });
  } else if (options.dryRun) {
    return `would install ${name} (${mode}${suffix})`;
  }

  if (selective) {
    await fs.mkdir(target, { recursive: true });
    for (const entry of [...options.coreSkills, "INDEX.md"]) {
      const from = path.join(source, entry);
      const to = path.join(target, entry);
      if (options.copy) await fs.cp(from, to, { recursive: true });
      else await fs.symlink(from, to);
    }
    return `installed ${name} (${mode}${suffix})`;
  }

  if (options.copy) await fs.cp(source, target, { recursive: true });
  else await fs.symlink(source, target);
  return `installed ${name} (${mode})`;
}

/**
 * Read the install marker written by a previous run.
 * @param {string} dest Absolute destination directory.
 * @returns {Promise<{assets: string[]}>} Marker contents, or an empty asset list.
 */
async function readMarker(dest) {
  try {
    const raw = await fs.readFile(path.join(dest, MARKER), "utf8");
    const parsed = JSON.parse(raw);
    return { assets: Array.isArray(parsed.assets) ? parsed.assets : [] };
  } catch {
    return { assets: [] };
  }
}

/**
 * Entry point.
 * @returns {Promise<void>} Resolves once the requested action completed.
 */
async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (options.printMcp) {
    process.stdout.write(`${JSON.stringify(mcpSnippet(), null, 2)}\n`);
    return;
  }

  if (!options.dest) {
    process.stderr.write(`--dest is required.\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  const dest = path.resolve(options.dest);
  if (dest === PACK_ROOT) {
    process.stderr.write("--dest must not be the pack root itself.\n");
    process.exitCode = 2;
    return;
  }

  const marker = await readMarker(dest);
  const owned = new Set(marker.assets);
  const lines = [];

  if (options.uninstall) {
    for (const name of ASSETS) {
      lines.push(await removeAsset(path.join(dest, name), owned, options.dryRun));
    }
    const markerPath = path.join(dest, MARKER);
    if (await exists(markerPath)) {
      if (options.dryRun) lines.push(`would remove ${MARKER}`);
      else {
        await fs.rm(markerPath, { force: true });
        lines.push(`removed ${MARKER}`);
      }
    }
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  const conflicts = [];
  for (const name of ASSETS) {
    if ((await exists(path.join(dest, name))) && !owned.has(name)) conflicts.push(name);
  }
  if (conflicts.length > 0) {
    process.stderr.write(
      `${conflicts.map((name) => path.join(dest, name)).join("\n")}\n` +
        "The paths above already exist and were not installed by this script. " +
        "Move them aside or pick another --dest. Nothing was written.\n",
    );
    process.exitCode = 1;
    return;
  }

  if (!options.dryRun) await fs.mkdir(dest, { recursive: true });

  const manifestForProfile = await readManifest();
  const coreSkills = options.profile === "core"
    ? manifestForProfile.skills.filter((skill) => skill.tier === "core").map((skill) => skill.name)
    : undefined;

  try {
    for (const name of ASSETS) {
      lines.push(await installAsset(name, dest, {
        copy: options.copy, dryRun: options.dryRun, owned, coreSkills,
      }));
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (!options.dryRun) {
    await fs.writeFile(
      path.join(dest, MARKER),
      `${JSON.stringify({
        packRoot: PACK_ROOT,
        mode: options.copy ? "copy" : "symlink",
        profile: options.profile,
        assets: ASSETS,
        ...(coreSkills ? { installedSkills: coreSkills } : {}),
      }, null, 2)}\n`,
    );
  }

  const manifest = manifestForProfile;
  lines.push("");
  lines.push(`PACK_ROOT (installed)  ${dest}`);
  lines.push(`source                 ${PACK_ROOT}`);
  lines.push(`profile                ${options.profile}`);
  lines.push(`skills                 ${coreSkills ? `${coreSkills.length} of ${manifest.skills.length}` : manifest.skills.length}`);
  lines.push(`commands               ${manifest.commands.length}`);
  lines.push(`templates              ${manifest.templates.length}`);
  lines.push(`mcp                    node ${mcpSnippet().args[0]}`);
  lines.push("");
  lines.push("Next: run `node scripts/install.mjs --print-mcp` and paste the snippet into your host's MCP config.");
  process.stdout.write(`${lines.join("\n")}\n`);
}

await main();
