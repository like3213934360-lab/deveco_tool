import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PACK_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MANIFEST = JSON.parse(await fs.readFile(path.join(PACK_ROOT, "manifest.json"), "utf8"));

/**
 * Run the installer and capture its result.
 * @param {string[]} args CLI arguments passed to scripts/install.mjs.
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} Process outcome.
 */
function runInstaller(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(PACK_ROOT, "scripts/install.mjs"), ...args], {
      cwd: PACK_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

/**
 * Run the host adapter installer and capture its result.
 * @param {string[]} args CLI arguments passed to scripts/install-host.mjs.
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} Process outcome.
 */
function runHostInstaller(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(PACK_ROOT, "scripts/install-host.mjs"), ...args], {
      cwd: PACK_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

/**
 * Read the YAML frontmatter `name` of a SKILL.md file.
 * @param {string} file Absolute path to a SKILL.md.
 * @returns {Promise<string>} The declared skill name, with any YAML quoting removed.
 */
async function skillName(file) {
  const text = await fs.readFile(file, "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(frontmatter, `${file} is missing YAML frontmatter`);
  const name = /^name:\s*(.+)$/m.exec(frontmatter[1]);
  assert.ok(name, `${file} frontmatter is missing a name`);
  // A quoted YAML scalar is legal and upstream skills use both forms, so strip one
  // matched pair of quotes before comparing against the directory name.
  const raw = name[1].trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(raw);
  return quoted ? quoted[2] : raw;
}

/**
 * Collect every markdown file under a directory, recursively.
 * @param {string} dir Absolute directory path.
 * @returns {Promise<string[]>} Absolute paths of every `.md` file below `dir`.
 */
async function markdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(full)));
    else if (entry.name.endsWith(".md")) found.push(full);
  }
  return found;
}

test("every manifest path exists on disk", async () => {
  const paths = [
    ...MANIFEST.skills.map((skill) => skill.path),
    ...MANIFEST.commands.map((command) => command.path),
    ...MANIFEST.templates.map((template) => template.path),
    ...MANIFEST.commands.flatMap((command) => command.templates),
    MANIFEST.mcp.entry,
  ];
  for (const relative of paths) {
    await fs.access(path.join(PACK_ROOT, relative));
  }
});

test("manifest skills match the skills directory exactly", async () => {
  const entries = await fs.readdir(path.join(PACK_ROOT, "skills"), { withFileTypes: true });
  const onDisk = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const declared = MANIFEST.skills.map((skill) => skill.name).sort();
  assert.deepEqual(declared, onDisk);

  for (const skill of MANIFEST.skills) {
    assert.equal(await skillName(path.join(PACK_ROOT, skill.path)), skill.name);
  }
});

test("skill names are unique and every origin is a known provenance value", () => {
  const names = MANIFEST.skills.map((skill) => skill.name);
  assert.equal(new Set(names).size, names.length, "duplicate skill names in manifest");

  // Every value here must have a matching section in provenance/SOURCES.md. Skills that carry a
  // different licence story than the DevEco Code tree get their own value rather than sharing one.
  const knownOrigins = new Set([
    "upstream",
    "upstream+patched",
    "upstream-0.2.0",
    "upstream-0.2.0+patched",
    "extracted-from-agent-prompt",
    "harmonyos-agent-skills-v0.0.2",
  ]);
  const knownCategories = new Set(["design", "solutions", "development", "test", "launch", "tools"]);
  for (const skill of MANIFEST.skills) {
    assert.ok(knownOrigins.has(skill.origin), `${skill.name} has unknown origin ${skill.origin}`);
    // tier drives what `install.mjs --profile core` links; category drives the routing index.
    assert.ok(["core", "extended"].includes(skill.tier), `${skill.name} has invalid tier ${skill.tier}`);
    assert.ok(knownCategories.has(skill.category), `${skill.name} has unknown category ${skill.category}`);
  }
});

test("manifest script declarations match the script registry exactly", async () => {
  const { listScripts } = await import("../src/script-registry.mjs");
  const registered = listScripts();
  const declared = MANIFEST.skills.flatMap((skill) => skill.scripts ?? []).sort();
  assert.deepEqual(declared, registered.map((script) => script.id).sort());

  // Each script must be declared by the skill that actually carries it, not just by any skill.
  const owner = new Map(MANIFEST.skills.flatMap((s) => (s.scripts ?? []).map((id) => [id, s.name])));
  for (const script of registered) {
    assert.equal(owner.get(script.id), script.skill, `${script.id} is declared under the wrong skill`);
  }
});

test("manifest commands and templates match their directories exactly", async () => {
  const commands = (await fs.readdir(path.join(PACK_ROOT, "commands"))).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(MANIFEST.commands.map((c) => path.basename(c.path)).sort(), commands);

  const templates = (await fs.readdir(path.join(PACK_ROOT, "templates"))).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(MANIFEST.templates.map((t) => path.basename(t.path)).sort(), templates);
});

test("manifest tool groups match the tools the MCP actually advertises", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: PACK_ROOT,
    stderr: "ignore",
  });
  const client = new Client({ name: "harmony-pack-manifest-test", version: "0.1.0" });
  t.after(async () => { await transport.close(); });
  await client.connect(transport);

  const live = (await client.listTools()).tools.map((tool) => tool.name).sort();
  const declared = MANIFEST.mcp.toolGroups.flatMap((group) => group.tools).sort();
  assert.deepEqual(declared, live);
  assert.equal(MANIFEST.mcp.toolCount, live.length);
});

test("no tool group is optional and nothing in the pack depends on a removed tool", async () => {
  // The UI auto-verification chain used to ship as an optional, degraded group.
  // It is now disabled outright, so every advertised group must be usable.
  const optional = MANIFEST.mcp.toolGroups.filter((group) => group.optional === true);
  assert.equal(optional.length, 0);

  const removedTools = new Set(["verify_ui", "save_ui_screenshot", "get_ui_verification_log"]);
  const advertised = new Set(MANIFEST.mcp.toolGroups.flatMap((group) => group.tools));
  for (const tool of removedTools) {
    assert.ok(!advertised.has(tool), `manifest still advertises removed tool ${tool}`);
  }

  for (const command of MANIFEST.commands) {
    for (const tool of command.packTools) {
      assert.ok(!removedTools.has(tool), `${command.name} depends on removed tool ${tool}`);
    }
  }

  // Skills must not instruct the reader to call an excluded tool. Prose that explains a tool was
  // deliberately dropped is fine, so only flag imperative call sites (backtick-quoted invocation).
  // The scan covers every markdown file in the skill, not just SKILL.md: the workflow bodies under
  // references/ carry most of the instructions, and used to sit outside this guard entirely.
  const forbidden = [...removedTools, "debug_exit", "plan_exit", "spec_write"];
  for (const skill of MANIFEST.skills) {
    const skillDir = path.dirname(path.join(PACK_ROOT, skill.path));
    for (const file of await markdownFiles(skillDir)) {
      const text = await fs.readFile(file, "utf8");
      for (const tool of forbidden) {
        assert.ok(
          !new RegExp(`(call|invoke|use|run)\\s+\`${tool}\``, "i").test(text),
          `${path.relative(PACK_ROOT, file)} instructs calling excluded tool ${tool}`,
        );
      }
    }
  }
});

test("d2c-fast carries no leftover host bindings from upstream", async () => {
  // The host-neutral rewrite of this skill is 1100 lines of prose, so a missed spot would not
  // surface anywhere else. These two markers are the ones a partial rewrite leaves behind.
  const skillDir = path.join(PACK_ROOT, "skills", "d2c-fast");
  for (const file of await markdownFiles(skillDir)) {
    const text = await fs.readFile(file, "utf8");
    const relative = path.relative(PACK_ROOT, file);
    // The artifact root is parameterised as {D2C_OUT_ROOT}; a bare path means R6 missed a line.
    // host-mapping.md documents the default, so it is allowed to name it.
    if (path.basename(file) !== "host-mapping.md") {
      assert.ok(
        !/(?<!`)\.deveco\/d2c-fast\//.test(text.replace(/`\.deveco\/d2c-fast\/`/g, "")),
        `${relative} still hardcodes the .deveco/d2c-fast artifact root`,
      );
    }
    // Delegation is expressed as a capability, not as upstream's subagent registry.
    assert.ok(!text.includes("subagent_type"), `${relative} still names the upstream subagent registry`);
  }
});

test("no skill instructs the model to call a host-specific tool by name", async () => {
  // This pack is host-neutral: naming Claude's AskUserQuestion or TodoWrite, or upstream's
  // subagent registry, tells a Codex or OpenCode session to call something that does not exist.
  // Capabilities are named instead, with the mapping in manifest.json hostToolMapping.
  const BINDINGS = ["AskUserQuestion", "TodoWrite", "subagent_type"];
  // Two kinds of legitimate mention: a LOCAL PATCH comment recording what upstream said, and the
  // one skill whose job is to explain which parts of upstream's harness were deliberately dropped.
  const EXPLAINS_NON_PORTAGE = ["skills/harmony-sdd-workflow/SKILL.md", "skills/d2c-fast/references/host-mapping.md"];

  const offenders = [];
  for (const file of await markdownFiles(path.join(PACK_ROOT, "skills"))) {
    const relative = path.relative(PACK_ROOT, file);
    if (EXPLAINS_NON_PORTAGE.includes(relative)) continue;
    // Strip HTML comments: a LOCAL PATCH note names the upstream tool it replaced, on purpose.
    const text = (await fs.readFile(file, "utf8")).replace(/<!--[\s\S]*?-->/g, "");
    for (const binding of BINDINGS) {
      if (text.includes(binding)) offenders.push(`${relative}: ${binding}`);
    }
  }
  assert.deepEqual(offenders, [], `host-specific tool bindings must be expressed as capabilities:\n${offenders.join("\n")}`);
});

test("SDD commands cover the five phases in order", () => {
  assert.deepEqual(MANIFEST.commands.map((command) => command.phase), [1, 2, 3, 4, 5]);
  assert.equal(MANIFEST.commands.at(-1).variant, "build-only");
});

test("the installer is idempotent, guards foreign files, and uninstalls cleanly", async () => {
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "harmony-pack-")), "pack");
  try {
    const dry = await runInstaller(["--dest", dest, "--dry-run"]);
    assert.equal(dry.exitCode, 0);
    assert.equal(await fs.access(dest).then(() => true, () => false), false, "--dry-run must not create anything");

    const first = await runInstaller(["--dest", dest]);
    assert.equal(first.exitCode, 0);
    const second = await runInstaller(["--dest", dest]);
    assert.equal(second.exitCode, 0);

    const installed = await fs.readFile(path.join(dest, "manifest.json"), "utf8");
    assert.equal(JSON.parse(installed).skills.length, MANIFEST.skills.length);

    const removed = await runInstaller(["--dest", dest, "--uninstall"]);
    assert.equal(removed.exitCode, 0);
    assert.deepEqual((await fs.readdir(dest)).sort(), []);

    await fs.writeFile(path.join(dest, "manifest.json"), "not ours\n");
    const guarded = await runInstaller(["--dest", dest]);
    assert.equal(guarded.exitCode, 1);
    assert.match(guarded.stderr, /Nothing was written/);
    assert.deepEqual((await fs.readdir(dest)).sort(), ["manifest.json"]);
  } finally {
    await fs.rm(path.dirname(dest), { recursive: true, force: true });
  }
});

test("--profile core installs only the core layer but still ships the full manifest", async () => {
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "harmony-pack-core-")), "pack");
  try {
    const result = await runInstaller(["--dest", dest, "--profile", "core"]);
    assert.equal(result.exitCode, 0);

    const core = MANIFEST.skills.filter((skill) => skill.tier === "core").map((skill) => skill.name);
    const installed = (await fs.readdir(path.join(dest, "skills"))).sort();
    // The routing index ships with either profile: it is how a host discovers what it did not install.
    assert.deepEqual(installed, [...core, "INDEX.md"].sort());

    // The manifest is never filtered — it stays the authoritative inventory of what exists upstream.
    const manifest = JSON.parse(await fs.readFile(path.join(dest, "manifest.json"), "utf8"));
    assert.equal(manifest.skills.length, MANIFEST.skills.length);

    const marker = JSON.parse(await fs.readFile(path.join(dest, ".harmony-pack.json"), "utf8"));
    assert.equal(marker.profile, "core");
    assert.deepEqual(marker.installedSkills.sort(), core.sort());

    const removed = await runInstaller(["--dest", dest, "--uninstall"]);
    assert.equal(removed.exitCode, 0);
    assert.deepEqual((await fs.readdir(dest)).sort(), []);
  } finally {
    await fs.rm(path.dirname(dest), { recursive: true, force: true });
  }
});

test("the default profile is core, and full warns about the extended licence without blocking", async () => {
  // The extended tier's upstream ships no repository-level licence declaration and 30 of its
  // 39 skills declare none either, so shipping it must be an explicit choice rather than the
  // path of least resistance. The warning is advisory: it must not change the exit code.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harmony-pack-default-"));
  try {
    const core = MANIFEST.skills.filter((skill) => skill.tier === "core").map((skill) => skill.name);

    const defaulted = await runInstaller(["--dest", path.join(root, "default")]);
    assert.equal(defaulted.exitCode, 0);
    assert.deepEqual(
      (await fs.readdir(path.join(root, "default", "skills"))).sort(),
      [...core, "INDEX.md"].sort(),
      "omitting --profile must install the core layer only",
    );
    assert.equal(defaulted.stderr, "", "the default profile has nothing to warn about");

    const full = await runInstaller(["--dest", path.join(root, "full"), "--profile", "full"]);
    assert.equal(full.exitCode, 0, "the licence warning must not block the install");
    assert.match(full.stderr, /NOTICE\.harmonyos-agent-skills/);
    assert.equal(
      (await fs.readdir(path.join(root, "full", "skills"))).length,
      MANIFEST.skills.length + 1,
      "--profile full still installs every skill plus INDEX.md",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the host adapter renders invocation policy without touching the skills it ships", async () => {
  // The skills under skills/ are byte-identical with upstream and other tests enforce that, so
  // a skill that must not be auto-invoked is materialised as a patched copy in the host's
  // directory. If this ever regressed into editing the source, the pack would quietly stop
  // matching upstream.
  const policy = MANIFEST.invocationPolicy.disableImplicitInvocation;
  const disabled = Object.keys(policy).filter((key) => key !== "$comment");
  assert.ok(disabled.length > 0, "the policy table must not be empty");
  for (const name of disabled) {
    assert.ok(MANIFEST.skills.some((skill) => skill.name === name), `unknown skill in policy: ${name}`);
    const source = await fs.readFile(path.join(PACK_ROOT, "skills", name, "SKILL.md"), "utf8");
    assert.ok(
      !source.includes("disable-model-invocation"),
      `${name}/SKILL.md must stay upstream-clean; the field belongs in the installed copy`,
    );
  }

  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "harmony-host-claude-")), "skills");
  try {
    // Explicit --profile full: the policy table spans both tiers, and claude now defaults to core.
    const result = await runHostInstaller(["--host", "claude", "--dest", dest, "--profile", "full"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.readdir(dest)).length, MANIFEST.skills.length + 1, "every skill plus the marker");

    for (const name of disabled) {
      const installed = await fs.readFile(path.join(dest, name, "SKILL.md"), "utf8");
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(installed);
      assert.ok(frontmatter, `${name} lost its frontmatter during patching`);
      assert.match(frontmatter[1], /^disable-model-invocation: true$/m, `${name} was not patched`);
    }

    // Everything else stays a symlink so edits in this repository take effect without reinstalling.
    const untouched = MANIFEST.skills.find((skill) => !disabled.includes(skill.name)).name;
    assert.ok((await fs.lstat(path.join(dest, untouched))).isSymbolicLink());
  } finally {
    await fs.rm(path.dirname(dest), { recursive: true, force: true });
  }
});

test("the host adapter merges into a shared directory instead of claiming it", async () => {
  // ~/.agents/skills and ~/.claude/skills normally already hold skills from other sources.
  // Per-directory ownership (what scripts/install.mjs uses for a pack root) would make the
  // adapter unusable there, so ownership is tracked per skill.
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "harmony-host-merge-")), "skills");
  const foreign = path.join(dest, "someone-elses-skill");
  await fs.mkdir(foreign, { recursive: true });
  await fs.writeFile(path.join(foreign, "SKILL.md"), "---\nname: someone-elses-skill\n---\nkeep me\n");

  try {
    assert.equal((await runHostInstaller(["--host", "codex", "--dest", dest])).exitCode, 0);
    assert.equal(
      await fs.readFile(path.join(foreign, "SKILL.md"), "utf8"),
      "---\nname: someone-elses-skill\n---\nkeep me\n",
      "a foreign skill must survive installation untouched",
    );

    // Reinstalling over our own entries is fine; it is how an update lands.
    assert.equal((await runHostInstaller(["--host", "codex", "--dest", dest])).exitCode, 0);

    const removed = await runHostInstaller(["--host", "codex", "--dest", dest, "--uninstall"]);
    assert.equal(removed.exitCode, 0);
    assert.deepEqual(
      (await fs.readdir(dest)).sort(),
      ["someone-elses-skill"],
      "uninstall must remove only what this script installed",
    );
  } finally {
    await fs.rm(path.dirname(dest), { recursive: true, force: true });
  }
});

test("switching to a narrower profile retires the skills it no longer covers", async () => {
  // full -> core used to leave the 39 extended skills on disk while rewriting the marker to list
  // only 18. They became orphans: the host kept routing to them, and --uninstall could no longer
  // reach them because ownership is tracked through the marker.
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "harmony-host-profile-")), "skills");
  const core = MANIFEST.skills.filter((skill) => skill.tier === "core").length;
  const entries = async () => (await fs.readdir(dest)).filter((name) => !name.startsWith("."));

  try {
    await runHostInstaller(["--host", "claude", "--dest", dest, "--profile", "full"]);
    assert.equal((await entries()).length, MANIFEST.skills.length, "full installs every skill");

    await runHostInstaller(["--host", "claude", "--dest", dest, "--profile", "core"]);
    assert.equal((await entries()).length, core, "downgrading must retire the extended tier");

    const marker = JSON.parse(await fs.readFile(path.join(dest, ".deveco-tool-host.json"), "utf8"));
    assert.equal(marker.installed.length, core, "the marker must match what is on disk");

    // Upgrading back has to restore them, so retirement must not be one-way.
    await runHostInstaller(["--host", "claude", "--dest", dest, "--profile", "full"]);
    assert.equal((await entries()).length, MANIFEST.skills.length);

    await runHostInstaller(["--host", "claude", "--dest", dest, "--uninstall"]);
    assert.deepEqual(await entries(), [], "uninstall must leave nothing of ours behind");
  } finally {
    await fs.rm(path.dirname(dest), { recursive: true, force: true });
  }
});

/**
 * Read a skill's frontmatter description, including multi-line values.
 *
 * An earlier version used a regex with the `m` flag, where `$` matches end of line rather than end
 * of input, so multi-line descriptions were measured at their first line only. That undercounted
 * the listing budget by roughly a third and made the budget test pass on numbers that were wrong.
 *
 * @param {string} file Absolute path to a SKILL.md.
 * @returns {Promise<string>} The description text as the host would load it.
 */
async function skillDescription(file) {
  const text = await fs.readFile(file, "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(frontmatter, `${file} is missing YAML frontmatter`);
  const lines = frontmatter[1].split(/\r?\n/);
  const start = lines.findIndex((line) => /^description:/.test(line));
  if (start < 0) return "";
  const collected = [lines[start].replace(/^description:\s*/, "")];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z_-]+:/.test(lines[index])) break;
    collected.push(lines[index]);
  }
  return collected.join("\n").trim();
}

test("the core tier fits both hosts' skill-listing budgets", async () => {
  // Both hosts load a listing of every skill's description into context and both trim it when it
  // overflows -- Claude by dropping descriptions from the skills you invoke least, Codex by
  // shortening descriptions and then omitting skills. Either way the keywords that make a skill
  // match are what get lost, so overflowing degrades routing silently. This is why both hosts
  // default to core rather than to everything.
  const CLAUDE_PER_SKILL = 1536;          // description + when_to_use, per skill
  const CLAUDE_LISTING = 10_000;          // 1% of a 1M-token context window
  const CODEX_LISTING = 8_000;            // 2% of the window, or this floor when it is unknown

  let coreDescriptions = 0;
  let coreWithPaths = 0;
  let allDescriptions = 0;

  for (const skill of MANIFEST.skills) {
    const description = await skillDescription(path.join(PACK_ROOT, skill.path));
    assert.ok(description, `${skill.name} has no description for the host to route on`);
    assert.ok(
      description.length <= CLAUDE_PER_SKILL,
      `${skill.name} description is ${description.length} chars, over Claude's ${CLAUDE_PER_SKILL} cap`,
    );
    allDescriptions += description.length;
    if (skill.tier !== "core") continue;
    coreDescriptions += description.length;
    // Codex's listing includes each skill's file path, so the installed path counts too.
    coreWithPaths += description.length
      + path.join(os.homedir(), ".agents", "skills", skill.name, "SKILL.md").length;
  }

  assert.ok(
    coreDescriptions < CLAUDE_LISTING,
    `core descriptions are ${coreDescriptions} chars, over Claude's ${CLAUDE_LISTING} listing budget`,
  );
  assert.ok(
    coreWithPaths < CODEX_LISTING,
    `core metadata is ${coreWithPaths} chars, over Codex's ${CODEX_LISTING} floor`,
  );
  // The reason for the default. If trimming the extended tier ever brings it under budget, this
  // assertion is what says the default can be revisited.
  assert.ok(
    allDescriptions > CLAUDE_LISTING,
    `all ${MANIFEST.skills.length} descriptions now total ${allDescriptions} chars, which fits `
      + "Claude's listing budget — the core-only default may no longer be necessary",
  );
});

test("the MCP dependency list matches the skills that actually need the MCP", async () => {
  // This used to be derived from each skill's `scripts` field, which missed every instruction-only
  // skill: harmony-build-loop declares no scripts but its whole workflow is build_project and
  // start_app. The list is explicit in the manifest now, and recomputed here so it cannot drift.
  const declared = new Set(MANIFEST.invocationPolicy.mcpDependency.skills);
  const toolNames = MANIFEST.mcp.toolGroups.flatMap((group) => group.tools);
  const reference = new RegExp(`\\b(${toolNames.join("|")})\\b`);

  const actual = new Set();
  for (const skill of MANIFEST.skills) {
    if ((skill.scripts ?? []).length > 0) { actual.add(skill.name); continue; }
    for (const file of await markdownFiles(path.join(PACK_ROOT, "skills", skill.name))) {
      if (reference.test(await fs.readFile(file, "utf8"))) { actual.add(skill.name); break; }
    }
  }

  const missing = [...actual].filter((name) => !declared.has(name)).sort();
  const stale = [...declared].filter((name) => !actual.has(name)).sort();
  assert.deepEqual(missing, [], `these skills call MCP tools but are not declared: ${missing.join(", ")}`);
  assert.deepEqual(stale, [], `these skills are declared but no longer call MCP tools: ${stale.join(", ")}`);
});

test("installing for Codex preserves a skill's own openai.yaml metadata", async () => {
  // Skills may ship their own agents/openai.yaml with display_name, short_description and
  // default_prompt. The installer owns only `policy` and `dependencies`; rewriting the whole file
  // erased the rest, which is how arkui-component-best-practices lost its Codex UI metadata.
  const withYaml = [];
  for (const skill of MANIFEST.skills) {
    const source = path.join(PACK_ROOT, "skills", skill.name, "agents", "openai.yaml");
    try { await fs.access(source); withYaml.push(skill.name); } catch { /* most ship none */ }
  }
  assert.ok(withYaml.length > 0, "this test needs at least one skill shipping its own openai.yaml");

  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "harmony-host-yaml-")), "skills");
  try {
    assert.equal((await runHostInstaller(["--host", "codex", "--dest", dest, "--profile", "full"])).exitCode, 0);
    for (const name of withYaml) {
      const before = await fs.readFile(path.join(PACK_ROOT, "skills", name, "agents", "openai.yaml"), "utf8");
      const after = await fs.readFile(path.join(dest, name, "agents", "openai.yaml"), "utf8");
      for (const line of before.split("\n")) {
        const trimmed = line.trim();
        // Only `policy` and `dependencies` bodies may change; everything else must come through.
        if (!trimmed || trimmed.startsWith("#")) continue;
        if (/^(policy|dependencies):/.test(trimmed) || /allow_implicit_invocation|^-\s|^tools:/.test(trimmed)) continue;
        assert.ok(after.includes(trimmed), `${name}/agents/openai.yaml lost: ${trimmed}`);
      }
      assert.match(after, /dependencies:/, `${name} must still declare its MCP dependency`);
    }
  } finally {
    await fs.rm(path.dirname(dest), { recursive: true, force: true });
  }
});

test("both host adapters default to the core tier", async () => {
  // Defaulting either host to full would put the unlicensed extended tier into a discovery
  // directory and overflow that host's listing budget in one step.
  const source = await fs.readFile(path.join(PACK_ROOT, "scripts/install-host.mjs"), "utf8");
  const profiles = [...source.matchAll(/profile:\s*"(core|full)"/g)].map((match) => match[1]);
  assert.ok(profiles.length >= 2, "both hosts must declare a default profile");
  assert.deepEqual([...new Set(profiles)], ["core"], "every host default must be core");
});

test("--print-mcp emits a parseable stdio config pointing at this pack", async () => {
  const result = await runInstaller(["--print-mcp"]);
  assert.equal(result.exitCode, 0);
  const snippet = JSON.parse(result.stdout);
  assert.equal(snippet.command, "node");
  assert.equal(snippet.args[0], path.join(PACK_ROOT, "src", "server.mjs"));
});
