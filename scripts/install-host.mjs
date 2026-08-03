#!/usr/bin/env node
/**
 * @file Opt-in host adapter: installs skills into Claude Code's and Codex's discovery directories.
 * @author deveco-tool
 *
 * Deliberately separate from scripts/install.mjs. That one materialises the whole pack into a
 * single PACK_ROOT and touches nothing host-specific; this one writes into directories a host
 * already owns and shares with skills from other sources. Two consequences shape the design:
 *
 *   - Ownership is per skill, not per directory. install.mjs refuses to write when its target
 *     exists, which is right for a pack root but wrong here: `~/.agents/skills` normally already
 *     contains other people's skills, and refusing wholesale would make the adapter unusable.
 *     The marker records exactly which entries this script created, and nothing else is touched.
 *
 *   - Invocation policy is rendered, never authored into skills/. The skills under skills/ are
 *     byte-identical with upstream and tests enforce that, so a skill that must not be invoked
 *     implicitly is materialised here as a patched copy instead of a symlink. manifest.json's
 *     `invocationPolicy` is the single source of truth for which ones those are.
 *
 * Both hosts default to the core tier, and for the same reason: each budgets the skill listing it
 * loads into context, and the full 57 blow through both budgets. Measured across this pack --
 * descriptions total 18,557 characters for all 57 and 5,781 for the core 18.
 *
 *   - Claude Code reads `~/.claude/skills/<skill>/SKILL.md`. Two separate limits apply. Per skill,
 *     description + when_to_use is capped at 1,536 characters; every skill here fits that (the
 *     longest is 1,076). Across the whole listing the budget is 1% of the model's context window,
 *     and when it overflows Claude Code drops descriptions starting with the skills you invoke
 *     least -- which silently strips the keywords that make a skill match. On a 1M-context model
 *     that budget is ~10,000 characters: the core tier fits, all 57 do not.
 *   - Codex reads `$HOME/.agents/skills` and budgets the initial listing at 2% of the context
 *     window, or 8,000 characters when it is unknown, counting each skill's path as well as its
 *     description. All 57 need ~22,300; the core 18 need ~6,900.
 *
 * `--profile full` stays available for both, and prints the licence warning that goes with the
 * extended tier. Raising Claude's own budget is a host-side setting (`skillListingBudgetFraction`,
 * or `SLASH_COMMAND_TOOL_CHAR_BUDGET`); low-value entries can also be set to `name-only` via
 * `skillOverrides`. Neither is something an installer should change on the user's behalf.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = ".deveco-tool-host.json";

const HOSTS = {
  claude: {
    skillsDir: path.join(os.homedir(), ".claude", "skills"),
    profile: "core",
    // Claude expresses "only the user may invoke this" as SKILL.md frontmatter.
    policy: "frontmatter",
  },
  codex: {
    skillsDir: path.join(os.homedir(), ".agents", "skills"),
    profile: "core",
    // Codex expresses it in a sibling agents/openai.yaml, which also carries tool dependencies.
    policy: "openai-yaml",
  },
};

const USAGE = `Usage: node scripts/install-host.mjs --host <claude|codex|all> [options]

  --host <h>      Which host to install for: claude, codex, or all (required)
  --profile <p>   Override the host default: core or full
  --dest <dir>    Override the host's skills directory (mainly for testing)
  --copy          Materialise every skill as a copy instead of a symlink
  --dry-run       Print the planned actions without touching the filesystem
  --uninstall     Remove only the skills this script installed, leaving others alone
  --print-mcp     Print the MCP registration snippet for the host and exit
  --help          Show this message

Defaults per host (from each host's own documentation):

  claude  ~/.claude/skills   profile core  (listing budget is 1% of the context window; all 57
                                            descriptions total 18,557 chars and overflow it, and
                                            Claude then drops descriptions from least-used skills)
  codex   ~/.agents/skills   profile core  (listing budget is 2% of the context window, or 8,000
                                            chars when unknown, and counts paths too; all 57 need
                                            ~22,300, the core 18 need ~6,900)

--profile full installs the extended tier on either host and prints a licence warning.

Skills are symlinked so edits in this repository take effect immediately. Skills whose
invocation policy has to be expressed in the installed copy are written out as patched copies
instead; manifest.json invocationPolicy says which, and the run reports each one.
`;

/**
 * Parse argv into an options object.
 * @param {string[]} argv Raw process arguments, without node and the script path.
 * @returns {{hosts: string[], profile: string|null, dest: string, copy: boolean, dryRun: boolean, uninstall: boolean, printMcp: boolean, help: boolean}} Parsed options.
 */
function parseArgs(argv) {
  const options = {
    hosts: [], profile: null, dest: "", copy: false,
    dryRun: false, uninstall: false, printMcp: false, help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--host") {
      if (!value || !["claude", "codex", "all"].includes(value)) {
        throw new Error("--host must be claude, codex or all");
      }
      options.hosts = value === "all" ? Object.keys(HOSTS) : [value];
      index += 1;
    } else if (argument === "--profile") {
      if (!value || !["core", "full"].includes(value)) throw new Error("--profile must be core or full");
      options.profile = value;
      index += 1;
    } else if (argument === "--dest") {
      if (!value || value.startsWith("--")) throw new Error("--dest requires a directory path");
      options.dest = value;
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
 * Tell the operator what the full profile pulls in, licence-wise.
 *
 * scripts/install.mjs has warned about this since the default flipped to core; this installer did
 * not, so choosing --profile full here silently exposed the extended tier to a host. Written to
 * stderr and deliberately non-blocking: the exit code stays 0 and the install proceeds.
 *
 * @param {string} hostName Host the warning applies to.
 * @param {number} extendedCount How many extended-tier skills the profile adds.
 * @returns {void}
 */
function warnExtendedLicence(hostName, extendedCount) {
  process.stderr.write(
    `warning: [${hostName}] --profile full installs the extended layer (${extendedCount} skills).\n`
      + "  Upstream (harmonyos-agent-skills) ships no repository-level LICENSE, NOTICE or COPYING\n"
      + "  file, and 30 of those skills declare no licence at all — by default all rights reserved.\n"
      + "  It also overflows this host's skill-listing budget, so descriptions get shortened.\n"
      + "  Read NOTICE.harmonyos-agent-skills before redistributing. Installing anyway.\n\n",
  );
}

/**
 * Check whether a path exists, without following symlinks.
 * @param {string} target Absolute path to probe.
 * @returns {Promise<boolean>} True when something is present at that path.
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
 * Read the marker recording what a previous run of this script installed.
 * @param {string} skillsDir Absolute host skills directory.
 * @returns {Promise<{installed: Array<{name: string, mode: string}>}>} Marker contents, or an empty list.
 */
async function readMarker(skillsDir) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(skillsDir, MARKER), "utf8"));
    return { installed: Array.isArray(parsed.installed) ? parsed.installed : [] };
  } catch {
    return { installed: [] };
  }
}

/**
 * Add `disable-model-invocation: true` to a SKILL.md's YAML frontmatter.
 * @param {string} text Original SKILL.md contents.
 * @param {string} name Skill name, used in error messages.
 * @returns {string} SKILL.md contents with the field present exactly once.
 */
function withModelInvocationDisabled(text, name) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!frontmatter) throw new Error(`${name}/SKILL.md has no YAML frontmatter to patch`);
  if (/^disable-model-invocation:/m.test(frontmatter[1])) return text;
  const patched = `${frontmatter[1]}\ndisable-model-invocation: true`;
  return text.replace(frontmatter[0], `---\n${patched}\n---`);
}

// Top-level agents/openai.yaml sections this installer owns. Anything else in an upstream file --
// `interface` with its display_name, short_description, icons and default_prompt -- is the skill
// author's and must survive reinstallation. An earlier version rewrote the whole file and silently
// erased that metadata from arkui-component-best-practices.
const OWNED_YAML_SECTIONS = new Set(["policy", "dependencies"]);

/**
 * Split a YAML document into top-level sections, keyed by their heading.
 *
 * Deliberately not a YAML parser: the pack has no YAML dependency, and these files only ever use
 * top-level keys with indented bodies. Preserving unknown sections verbatim is both simpler and
 * safer than round-tripping them through a parser we would have to add.
 *
 * @param {string} text Existing YAML document.
 * @returns {Map<string, string>} Section name to its literal text, including the heading line.
 */
function splitYamlSections(text) {
  const sections = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(line);
    if (heading) {
      current = heading[1];
      sections.set(current, line);
      continue;
    }
    // Leading comments and blank lines before the first heading are dropped: the header this
    // installer writes replaces them.
    if (current === null) continue;
    sections.set(current, `${sections.get(current)}\n${line}`);
  }
  // Trim the trailing blank lines each section accumulates from the blank line before the next one.
  for (const [name, body] of sections) sections.set(name, body.replace(/\s+$/, ""));
  return sections;
}

/**
 * Render agents/openai.yaml, preserving any sections the skill author already wrote.
 * @param {{disableImplicit: boolean, mcp: {server: string, transport: string}|null, existing: string|null}} spec What to declare.
 * @returns {string} YAML document contents.
 */
function renderOpenAiYaml(spec) {
  const preserved = spec.existing ? splitYamlSections(spec.existing) : new Map();
  const blocks = [];

  for (const [name, body] of preserved) {
    if (!OWNED_YAML_SECTIONS.has(name)) blocks.push(body);
  }

  if (spec.disableImplicit) {
    blocks.push([
      "policy:",
      "  # Loading this skill can cause an irreversible or outward-facing action,",
      "  # so Codex must not pick it up on its own. Explicit $skill invocation still works.",
      "  allow_implicit_invocation: false",
    ].join("\n"));
  } else if (preserved.has("policy")) {
    // The author said something about invocation and the manifest does not override it.
    blocks.push(preserved.get("policy"));
  }

  if (spec.mcp) {
    blocks.push([
      "dependencies:",
      "  tools:",
      '    - type: "mcp"',
      `      value: "${spec.mcp.server}"`,
      '      description: "deveco-tool stdio MCP: this skill cannot complete its workflow without it"',
      `      transport: "${spec.mcp.transport}"`,
    ].join("\n"));
  } else if (preserved.has("dependencies")) {
    blocks.push(preserved.get("dependencies"));
  }

  const header = [
    "# policy and dependencies are generated by scripts/install-host.mjs from manifest.json",
    "# invocationPolicy; edit the manifest, not this file. Other sections are preserved as-is.",
  ].join("\n");
  return `${[header, ...blocks].join("\n\n")}\n`;
}

/**
 * Work out how each selected skill has to be materialised for a host.
 * @param {object} manifest Parsed manifest.json.
 * @param {string} hostName Host key in HOSTS.
 * @param {string} profile Either core or full.
 * @param {boolean} forceCopy True when --copy was given.
 * @returns {Array<{name: string, mode: string, reason: string, disableImplicit: boolean, mcp: object|null}>} Install plan, one entry per skill.
 */
function planSkills(manifest, hostName, profile, forceCopy) {
  const policy = manifest.invocationPolicy;
  const disabled = new Set(Object.keys(policy.disableImplicitInvocation).filter((key) => key !== "$comment"));
  // Explicit list, not `skill.scripts`: instruction-only skills like harmony-build-loop declare no
  // scripts yet call build_project and start_app straight from their prose.
  const needsMcp = new Set(policy.mcpDependency.skills);
  const host = HOSTS[hostName];

  return manifest.skills
    .filter((skill) => profile === "full" || skill.tier === "core")
    .map((skill) => {
      const disableImplicit = disabled.has(skill.name);
      // Codex carries both invocation policy and tool dependencies in a file that lives inside
      // the skill directory, so any skill needing either cannot be a bare symlink.
      const needsYaml = host.policy === "openai-yaml"
        && (disableImplicit || needsMcp.has(skill.name));
      const needsFrontmatter = host.policy === "frontmatter" && disableImplicit;
      const mustCopy = needsYaml || needsFrontmatter;
      const reason = needsFrontmatter ? "disable-model-invocation"
        : needsYaml && disableImplicit ? "openai.yaml: policy + mcp dependency"
          : needsYaml ? "openai.yaml: mcp dependency"
            : forceCopy ? "--copy" : "";
      return {
        name: skill.name,
        mode: mustCopy || forceCopy ? "copy" : "symlink",
        reason,
        disableImplicit,
        mcp: needsYaml && needsMcp.has(skill.name)
          ? { server: policy.mcpDependency.server, transport: policy.mcpDependency.transport }
          : null,
      };
    });
}

/**
 * Materialise one planned skill into the host directory.
 * @param {{name: string, mode: string, disableImplicit: boolean, mcp: object|null}} entry Plan entry.
 * @param {string} skillsDir Absolute host skills directory.
 * @param {string} hostName Host key in HOSTS.
 * @returns {Promise<void>} Resolves once the skill is in place.
 */
async function materialise(entry, skillsDir, hostName) {
  const source = path.join(PACK_ROOT, "skills", entry.name);
  const target = path.join(skillsDir, entry.name);

  if (entry.mode === "symlink") {
    await fs.symlink(source, target);
    return;
  }

  await fs.cp(source, target, {
    recursive: true,
    filter: (from) => path.basename(from) !== ".DS_Store",
  });

  if (hostName === "claude" && entry.disableImplicit) {
    const file = path.join(target, "SKILL.md");
    await fs.writeFile(file, withModelInvocationDisabled(await fs.readFile(file, "utf8"), entry.name));
  }
  if (hostName === "codex" && (entry.disableImplicit || entry.mcp)) {
    const yamlPath = path.join(target, "agents", "openai.yaml");
    // The copy was made from the source skill, so an upstream openai.yaml is already here. Read it
    // before overwriting so its interface metadata survives.
    let existing = null;
    try { existing = await fs.readFile(yamlPath, "utf8"); } catch { /* the skill shipped none */ }
    await fs.mkdir(path.dirname(yamlPath), { recursive: true });
    await fs.writeFile(
      yamlPath,
      renderOpenAiYaml({ disableImplicit: entry.disableImplicit, mcp: entry.mcp, existing }),
    );
  }
}

/**
 * Print the MCP registration snippet a host expects.
 * @param {string} hostName Host key in HOSTS.
 * @returns {string} A snippet to paste into that host's configuration.
 */
function mcpSnippet(hostName) {
  const entry = path.join(PACK_ROOT, "src", "server.mjs");
  if (hostName === "codex") {
    return `# Append to ~/.codex/config.toml\n[mcp_servers.deveco-tool]\ncommand = "node"\nargs = ["${entry}"]\n`;
  }
  return `${JSON.stringify({ mcpServers: { "deveco-tool": { command: "node", args: [entry] } } }, null, 2)}\n`;
}

/**
 * Install or uninstall for one host.
 * @param {string} hostName Host key in HOSTS.
 * @param {object} options Parsed CLI options.
 * @param {object} manifest Parsed manifest.json.
 * @returns {Promise<string[]>} Report lines for this host.
 */
async function runHost(hostName, options, manifest) {
  const host = HOSTS[hostName];
  const skillsDir = options.dest ? path.resolve(options.dest) : host.skillsDir;
  const profile = options.profile ?? host.profile;
  const marker = await readMarker(skillsDir);
  const owned = new Map(marker.installed.map((item) => [item.name, item.mode]));
  const lines = [`[${hostName}] ${skillsDir}`];

  if (options.uninstall) {
    for (const [name] of owned) {
      const target = path.join(skillsDir, name);
      if (!(await exists(target))) { lines.push(`  skip ${name} (already gone)`); continue; }
      if (options.dryRun) { lines.push(`  would remove ${name}`); continue; }
      await fs.rm(target, { recursive: true, force: true });
      lines.push(`  removed ${name}`);
    }
    const markerPath = path.join(skillsDir, MARKER);
    if (await exists(markerPath) && !options.dryRun) await fs.rm(markerPath, { force: true });
    lines.push(`  ${owned.size} skill(s) removed; everything else in this directory was left alone`);
    return lines;
  }

  const plan = planSkills(manifest, hostName, profile, options.copy);

  if (profile === "full") {
    warnExtendedLicence(hostName, manifest.skills.filter((skill) => skill.tier === "extended").length);
  }

  // Only entries this script created may be replaced. A skill someone else put here — or wrote by
  // hand — is left untouched and reported, rather than silently overwritten.
  const foreign = [];
  for (const entry of plan) {
    if (await exists(path.join(skillsDir, entry.name)) && !owned.has(entry.name)) foreign.push(entry.name);
  }
  if (foreign.length > 0) {
    throw new Error(
      `[${hostName}] these already exist in ${skillsDir} and were not installed by this script:\n`
        + `${foreign.map((name) => `  ${name}`).join("\n")}\n`
        + "Move them aside or pick another --dest. Nothing was written.",
    );
  }

  if (!options.dryRun) await fs.mkdir(skillsDir, { recursive: true });

  // Reinstalling under a narrower profile has to retire what the previous run installed and this
  // one no longer covers. Without this, full -> core left the 39 extended skills on disk while the
  // marker recorded only 18, so they became orphans that --uninstall could no longer reach: the
  // host kept routing to them and nothing here could clean them up.
  const planned = new Set(plan.map((entry) => entry.name));
  const retired = [...owned.keys()].filter((name) => !planned.has(name));
  for (const name of retired) {
    if (options.dryRun) { lines.push(`  would retire ${name} (not in profile ${profile})`); continue; }
    await fs.rm(path.join(skillsDir, name), { recursive: true, force: true });
  }
  if (retired.length > 0 && !options.dryRun) {
    lines.push(`  retired ${retired.length} skill(s) no longer in profile ${profile}`);
  }

  const installed = [];
  for (const entry of plan) {
    const suffix = entry.reason ? ` — ${entry.reason}` : "";
    if (options.dryRun) {
      lines.push(`  would install ${entry.name} (${entry.mode})${suffix}`);
      installed.push({ name: entry.name, mode: entry.mode });
      continue;
    }
    if (owned.has(entry.name)) await fs.rm(path.join(skillsDir, entry.name), { recursive: true, force: true });
    await materialise(entry, skillsDir, hostName);
    installed.push({ name: entry.name, mode: entry.mode });
    if (entry.reason) lines.push(`  installed ${entry.name} (${entry.mode})${suffix}`);
  }

  if (!options.dryRun) {
    await fs.writeFile(
      path.join(skillsDir, MARKER),
      `${JSON.stringify({ packRoot: PACK_ROOT, host: hostName, profile, installed }, null, 2)}\n`,
    );
  }

  const copies = installed.filter((item) => item.mode === "copy").length;
  lines.push(`  ${installed.length} skill(s): ${installed.length - copies} symlinked, ${copies} copied`);
  lines.push(`  profile ${profile}`);
  return lines;
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

  if (options.help) { process.stdout.write(USAGE); return; }
  if (options.hosts.length === 0) {
    process.stderr.write(`--host is required.\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.printMcp) {
    process.stdout.write(options.hosts.map(mcpSnippet).join("\n"));
    return;
  }
  if (options.dest && options.hosts.length > 1) {
    process.stderr.write("--dest applies to a single host; pass --host claude or --host codex.\n");
    process.exitCode = 2;
    return;
  }

  const manifest = JSON.parse(await fs.readFile(path.join(PACK_ROOT, "manifest.json"), "utf8"));
  const lines = [];
  try {
    for (const hostName of options.hosts) lines.push(...(await runHost(hostName, options, manifest)), "");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  lines.push("Skills only cover the knowledge and workflow layers. Register the MCP too:");
  lines.push("  node scripts/install-host.mjs --host <host> --print-mcp");
  process.stdout.write(`${lines.join("\n")}\n`);
}

await main();
