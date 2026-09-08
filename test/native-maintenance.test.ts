import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { release } from "../src/core/config.js";
import { atomicWrite } from "../src/core/files.js";
import { planUpgrade, applyUpgrade, rollbackUpgrade } from "../src/maintenance/upgrade.js";
import { assertQuiescent } from "../src/maintenance/quiescence.js";
import { planSkillCleanup, applySkillCleanup } from "../src/maintenance/skill-cleanup.js";

function fixture(missing = false) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "native-maintenance-")));
  const old = path.join(root, "old"), current = path.join(root, "new");
  for (const installation of [old, current]) {
    atomicWrite(path.join(installation, "package.json"), JSON.stringify({ version: release, bin: { "deveco-tool": "dist/src/cli.js" } }));
    atomicWrite(path.join(installation, "package-lock.json"), "{}");
    atomicWrite(path.join(installation, "node_modules/example/index.js"), "export default 1;\n");
    if (installation !== old || !missing) atomicWrite(path.join(installation, "dist/src/cli.js"), "// Fixture identity only; never executed.\n");
  }
  const config = path.join(root, "host.toml"), original = `[mcp_servers.deveco-tool]\ncommand = "old-node"\nargs = ${JSON.stringify([path.join(old, "dist/src/cli.js")])}\nenabled = false\ntool_timeout_sec = 99\n[mcp_servers.deveco-tool.env]\nTOKEN = "fixture-private-secret"\n[mcp_servers.deveco-tool.tools.app_signature]\npermission = "ask"\n[mcp_servers.unrelated]\ncommand = "keep-me"\n`;
  atomicWrite(config, original);
  const spec = { mode: missing ? "repair_missing_entry" : "upgrade", host_config: config, host_format: "codex-toml", installation: current, node: fs.realpathSync.native(process.execPath), state_dir: path.join(root, "state"), previous_state_dirs: [] };
  return { root, old, current, config, original, spec };
}

test("missing-entry repair preserves MCP policies, journals secrets encrypted and refuses fictitious rollback", () => {
  const f = fixture(true);
  try {
    const plan = planUpgrade(f.spec), journal = path.join(f.root, "journal");
    assert.equal(plan.previous.kind, "missing_entry");
    assert.equal(applyUpgrade(plan, journal, false).rollback_available, false);
    const next = fs.readFileSync(f.config, "utf8");
    assert.match(next, /enabled = false\ntool_timeout_sec = 99/);
    assert.match(next, /\[mcp_servers.deveco-tool.tools.app_signature\]\npermission = "ask"/);
    assert.match(next, /\[mcp_servers.unrelated\]\ncommand = "keep-me"/);
    assert.equal(next.includes("fixture-private-secret"), false);
    assert.equal(fs.readFileSync(path.join(journal, "rollback.encrypted"), "utf8").includes("fixture-private-secret"), false);
    assert.equal(applyUpgrade(plan, journal, false).resumed, true);
    assert.throws(() => rollbackUpgrade(journal, true), { code: "UPGRADE_ROLLBACK_UNAVAILABLE" });
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("normal upgrade checks installed dependency bytes and restores the complete original host configuration", () => {
  const f = fixture();
  try {
    const plan = planUpgrade(f.spec), dependency = path.join(f.current, "node_modules/example/index.js"), journal = path.join(f.root, "journal");
    atomicWrite(dependency, "export default 2;\n");
    assert.throws(() => applyUpgrade(plan, journal, true), { code: "UPGRADE_INSTALLATION_CHANGED" });
    assert.equal(fs.readFileSync(f.config, "utf8"), f.original);
    atomicWrite(dependency, "export default 1;\n");
    assert.throws(() => applyUpgrade(plan, journal, false), { code: "UPGRADE_SESSIONS_ACTIVE" });
    assert.equal(applyUpgrade(plan, journal, true).rollback_available, true);
    assert.equal(rollbackUpgrade(journal, true).rolled_back, true);
    assert.equal(fs.readFileSync(f.config, "utf8"), f.original);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("upgrade refuses interrupted durable work rather than treating it as a closed session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-quiescence-")), db = new Database(path.join(root, "state.sqlite"));
  try {
    db.exec("CREATE TABLE managed_processes(id TEXT, status TEXT); CREATE TABLE external_sessions(id TEXT, status TEXT); CREATE TABLE runs(id TEXT, status TEXT); INSERT INTO runs VALUES ('fixture', 'interrupted');");
    assert.throws(() => assertQuiescent([], [root]), { code: "UPGRADE_SESSIONS_ACTIVE" });
    db.exec("UPDATE runs SET status='succeeded'");
    assert.equal(assertQuiescent([], [root]).checked_state_directories, 1);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("Skill cleanup removes only an owned broken link, preserves edited copies and is retryable", () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "native-skill-cleanup-"))), host = path.join(root, "host"), old = path.join(root, "old");
  try {
    fs.mkdirSync(host); fs.mkdirSync(old);
    atomicWrite(path.join(host, ".deveco-tool-host.json"), JSON.stringify({ packRoot: old, host: "codex", installed: [{ name: "owned-link", mode: "symlink" }, { name: "edited-copy", mode: "copy" }] }));
    fs.symlinkSync(path.join(old, "skills/owned-link"), path.join(host, "owned-link"), process.platform === "win32" ? "junction" : "dir");
    atomicWrite(path.join(host, "edited-copy/SKILL.md"), "User maintained content\n");
    const plan = planSkillCleanup(host, old);
    assert.equal(plan.entries.find((item) => item.name === "edited-copy")?.disposition, "retain");
    applySkillCleanup(plan); applySkillCleanup(plan);
    assert.equal(fs.lstatSync(path.join(host, "owned-link"), { throwIfNoEntry: false }), undefined);
    assert.equal(fs.readFileSync(path.join(host, "edited-copy/SKILL.md"), "utf8"), "User maintained content\n");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
