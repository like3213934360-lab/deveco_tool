// Real acceptance; explicit objects and private traces. See ../README.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { session, hashes, globalConfigs, required } from "../support/acceptance.mjs";

test("skills", async (t) => {
  const { call, raw, directory, run } = await session(t);

  const root = process.env.E2E_SKILLS;
  assert.ok(root && path.isAbsolute(root), "E2E_SKILLS must be explicitly chosen by the user");
  const before = globalConfigs(), destination = path.join(root, run);
  fs.mkdirSync(destination, { recursive: true });
  const source = path.resolve("knowledge/skills"), bundled = fs.readdirSync(source).sort();
  await t.test("skills.export-full-content", async () => {
    const d = await call("skills", { action: "export", path: path.join(destination, "exported") });
    assert.deepEqual(d.exported.sort(), bundled);
    assert.deepEqual(hashes(d.directory), hashes(source));
  });
  const host = required("E2E_HOST");
  assert.ok(["codex", "opencode"].includes(host));
  {
    const project = path.join(destination, host), skills = path.join(project, "skills");
    const file = path.join(project, host === "codex" ? ".codex/config.toml" : ".opencode/opencode.json");
    const sentinel = host === "codex" ? '[mcp_servers.audit_preserved]\ncommand = "node"\nargs = ["--version"]\n'
      : JSON.stringify({ mcp: { audit_preserved: { type: "local", command: ["node", "--version"], enabled: false } } });
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, sentinel);
    await t.test(`skills.install_mcp-${host}`, async () => {
      const d = await call("skills", { action: "install_mcp", host, scope: "project", project });
      assert.equal(d.file, file); assert.equal(d.written, true);
      const text = fs.readFileSync(file, "utf8");
      if (host === "codex") assert.ok(text.startsWith(sentinel));
      else assert.deepEqual(JSON.parse(text).mcp.audit_preserved, JSON.parse(sentinel).mcp.audit_preserved);
      const again = await call("skills", { action: "install_mcp", host, scope: "project", project });
      assert.equal(again.written, false); assert.equal(fs.readFileSync(file, "utf8"), text);
      const args = host === "codex" ? ["mcp", "get", "deveco", "--json"] : ["mcp", "list"];
      const output = execFileSync(host, args, { cwd: project, encoding: "utf8", timeout: 120000 });
      fs.writeFileSync(path.join(directory, `${run}-${host}-registration.txt`), output);
      assert.match(output, /deveco/);
      if (host === "opencode") assert.match(output, /connected/);
      else assert.equal(JSON.parse(output).transport.args[0], path.resolve("bin/deveco-mcp.mjs"));
      const hostText = fs.readFileSync(file, "utf8");
      fs.writeFileSync(path.join(directory, `${run}-${host}-after-host.txt`), hostText);
      const afterHost = await call("skills", { action: "install_mcp", host, scope: "project", project });
      assert.equal(afterHost.written, false); assert.equal(fs.readFileSync(file, "utf8"), hostText);
    });
    await t.test(`skills.init-${host}`, async () => {
      const d = await call("skills", { action: "init", host, scope: "project", project, path: skills });
      assert.equal(d.skills.directory, skills); assert.deepEqual(hashes(skills), hashes(source));
      assert.equal(d.mcp.written, false);
      const forced = await call("skills", { action: "install_mcp", host, scope: "project", project, force: true });
      assert.equal(forced.written, true);
      const text = fs.readFileSync(file, "utf8");
      if (host === "codex") assert.ok(text.startsWith(sentinel));
      else assert.deepEqual(JSON.parse(text).mcp.audit_preserved, JSON.parse(sentinel).mcp.audit_preserved);
    });
  }
  await t.test("skills.market-install-uninstall", async () => {
    const found = await call("skills", { action: "search", query: "ArkUI", limit: 5 });
    assert.ok(found.skills.length > 0);
    const name = found.skills[0].name, market = path.join(destination, "market");
    const installed = await call("skills", { action: "install", name, path: market });
    assert.equal(installed.installed, name); assert.equal(installed.directory, path.join(market, name));
    const content = fs.readFileSync(path.join(installed.directory, "SKILL.md"), "utf8");
    assert.match(content, /^---/); assert.ok(content.length > 100);
    fs.writeFileSync(path.join(directory, `${run}-market-hashes.json`), JSON.stringify(hashes(installed.directory), null, 2));
    const removed = await call("skills", { action: "uninstall", name, path: market });
    assert.equal(removed.removed, name); assert.equal(fs.existsSync(installed.directory), false);
    const absent = await raw("skills", { action: "uninstall", name, path: market });
    assert.equal(absent.isError, true); assert.equal(absent.data.error.code, "NOT_FOUND");
  });
  await t.test("skills.global-configs-unchanged", async () => assert.deepEqual(globalConfigs(), before));

});
