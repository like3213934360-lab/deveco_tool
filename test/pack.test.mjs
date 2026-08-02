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

test("--print-mcp emits a parseable stdio config pointing at this pack", async () => {
  const result = await runInstaller(["--print-mcp"]);
  assert.equal(result.exitCode, 0);
  const snippet = JSON.parse(result.stdout);
  assert.equal(snippet.command, "node");
  assert.equal(snippet.args[0], path.join(PACK_ROOT, "src", "server.mjs"));
});
