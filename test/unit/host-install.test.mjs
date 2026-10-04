// Exercise actual filesystem writers in isolated homes, not just merge helpers.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const root = path.resolve(import.meta.dirname, "../.."), work = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-hosts-"));
process.env.APPDATA = path.join(work, "AppData");
const bundle = path.join(root, "node_modules/.cache/deveco-host-install.mjs");
await build({ stdin: { contents: `export * from ${JSON.stringify(path.join(root, "src/domains/hostconfig.ts"))};export {initHost,listSkills} from ${JSON.stringify(path.join(root, "src/domains/skills.ts"))};`, resolveDir: root }, outfile: bundle, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error", plugins: [{ name: "home", setup(b) {
  b.onResolve({ filter: /^node:os$/ }, (a) => /domains\/(?:hostconfig|skills)\.ts$/.test(a.importer.replaceAll("\\", "/")) ? { path: "os", namespace: "fixture" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export default {homedir:()=>${JSON.stringify(work)}};` }));
} }] });
const m = await import(pathToFileURL(bundle).href);
after(() => { fs.rmSync(bundle, { force: true }); fs.rmSync(work, { recursive: true, force: true }); });
test("all eleven hosts export real skills in both scopes; eight MCP writers preserve peers and are idempotent", async () => {
  const all = ["cursor", "claude", "codex", "opencode", "deveco", "trae-cn", "codebuddy", "qoder", "pi", "atomcode", "dsh"];
  const count = m.listSkills().length; assert.ok(count > 0);
  for (const host of all) for (const scope of ["user", "project"]) {
    const project = path.join(work, "projects", host);
    const entry = m.hosts[host];
    const file = entry && (scope === "user" ? entry.global : path.join(project, entry.project));
    if (file) {
      assert.ok(file.startsWith(work)); fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, entry.format === "codex" ? 'model = "keep-me"\n[mcp_servers.peer]\ncommand = "peer"\n' : JSON.stringify({ keep: "keep-me", [entry.format === "opencode" ? "mcp" : "mcpServers"]: { peer: { command: "peer" } } }));
    }
    const first = await m.initHost(host, { scope, project });
    assert.equal(first.skills.exported.length, count, `${host}/${scope}`); assert.ok(first.skills.directory.startsWith(work));
    for (const name of first.skills.exported) assert.ok(fs.readFileSync(path.join(first.skills.directory, name, "SKILL.md"), "utf8").length > 100);
    if (!entry) { assert.ok(first.mcp.skipped); continue; }
    assert.equal(first.mcp.written, true);
    const before = fs.readFileSync(file, "utf8"), second = await m.initHost(host, { scope, project });
    assert.equal(second.mcp.written, false); assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.equal(m.installMcp(host, { scope, project, force: true }).written, true);
    const final = fs.readFileSync(file, "utf8"); assert.match(final, /keep-me/); assert.match(final, /peer/); assert.match(final, /deveco/);
    if (entry.format !== "codex") { const data = JSON.parse(final); assert.equal(data.keep, "keep-me"); assert.deepEqual(data[entry.format === "opencode" ? "mcp" : "mcpServers"].peer, { command: "peer" }); }
  }
});
