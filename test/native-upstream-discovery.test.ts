import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { discoveryHash, discoverUpstream, discoverCliDependency, reviewDiscovery, type UpstreamDiscovery } from "../scripts/lib/upstream-discovery.js";
import { packageRoot } from "../src/core/config.js";

function fixture(url = "https://gitcode.com/openharmony-sig/deveco-code") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-discovery-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  const write = (file: string, value: string | Buffer) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); };
  git("-c", "init.templateDir=", "init", "--quiet"); git("remote", "add", "origin", url);
  const commit = () => { git("add", "--all"); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${root}/no-hooks`, "commit", "--quiet", "-m", "fixed source"); return git("rev-parse", "HEAD"); };
  const close = () => fs.rmSync(root, { recursive: true, force: true });
  return { root, git, write, commit, close };
}
const registry = "packages/opencode/src/tool/registry.ts";
const toolFile = "packages/opencode/src/tool/new-tool.ts";
const skillFile = "packages/opencode/resources/skills/new-method/SKILL.md";
const tool = (actions = '"inspect", "repair"') => `export const NovelTool = Tool.define("novel_native", { parameters: Schema.Struct({ action: Schema.Literals([${actions}]), target: Schema.String }) });`;
function seed(f: ReturnType<typeof fixture>) {
  f.write(registry, 'import { NovelTool } from "./new-tool"; function* create() { const novel = yield* NovelTool; const tool = { novel: Tool.init(novel) }; return { builtin: [tool.novel] }; }');
  f.write(toolFile, tool());
  f.write("packages/opencode/src/agent/agent.ts", 'const agents = { novel: { name: "new-planner", mode: "subagent" } };');
  f.write(skillFile, "# Method\nRun `scripts/helper.mjs` and read [image](assets/图.png).\n");
  f.write("packages/opencode/resources/skills/new-method/scripts/helper.mjs", 'import "./shared.mjs"; throw new Error("Do not execute upstream code");');
  f.write("packages/opencode/resources/skills/new-method/scripts/shared.mjs", 'export const reference = "domain behavior";');
  f.write("packages/opencode/resources/skills/new-method/assets/图.png", Buffer.from([0, 255, 128, 65]));
  f.write("packages/opencode/resources/future-domain/new.asset", "Unknown new asset must be reviewed");
  f.write("packages/opencode/resources/spec/commands/novel.md", "# New SDD command");
  f.write("packages/opencode/resources/spec/templates/novel.md", "# New SDD template");
  f.write("packages/opencode/src/command/template/novel.txt", "New host command");
  f.write(".agents/skills/dev/SKILL.md", "Repository development only");
  f.write("packages/opencode/test/fixtures/sample/SKILL.md", "Test fixture only");
}
function review(discovery: UpstreamDiscovery): Parameters<typeof reviewDiscovery>[1] {
  return { discovery_sha256: discovery.sha256, assets: discovery.assets.map((asset) => ({ id: asset.id, sha256: asset.sha256, classification: "host-delegated", implementation: "adapted", evidence: "pending", environment: "unobserved", reason: "Source reference delivered to host; runtime acceptance remains separate", targets: [] })) };
}

test("fixed official Git source discovers new IDs, action schemas, host assets, Unicode paths and transitive scripts without execution", () => {
  const f = fixture();
  try {
    seed(f); const commit = f.commit(), result = discoverUpstream(f.root, commit);
    assert.deepEqual(result.tools.map((item) => item.id), ["novel_native"]);
    assert.deepEqual(result.tools[0]!.operations, ["inspect", "repair"]);
    assert.deepEqual(result.tools[0]!.parameters.map((item) => item.name), ["action", "target"]);
    assert.deepEqual(result.agents.map((item) => item.id), ["new-planner"]);
    assert.ok(result.assets.some((item) => item.path.endsWith("shared.mjs")));
    assert.equal(result.assets.find((item) => item.path.endsWith("图.png"))!.sha256, discoveryHash(Buffer.from([0, 255, 128, 65])));
    for (const kind of ["sdd-command", "sdd-template", "builtin-command", "repository-development", "test-fixture", "unclassified-product-asset"]) assert.ok(result.assets.some((item) => item.kind === kind), kind);
    assert.deepEqual(result.unresolved, []);
    assert.equal(reviewDiscovery(result, review(result)).ready, true);
    f.write(toolFile, tool('"uncommitted"'));
    assert.deepEqual(discoverUpstream(f.root, commit), result, "uncommitted checkout files cannot alter fixed Git blobs");
    assert.throws(() => discoverUpstream(f.root, "HEAD"), /full fixed/);
    f.git("remote", "set-url", "origin", "https://example.invalid/impostor");
    assert.throws(() => discoverUpstream(f.root, commit), /official Code origin/);
  } finally { f.close(); }
});

test("new operations, added host assets, deleted dependencies and unknown references remain pending until their exact source changes are reviewed", () => {
  const f = fixture();
  try {
    seed(f); const baseline = discoverUpstream(f.root, f.commit()), approved = review(baseline);
    f.write(toolFile, tool('"inspect", "repair", "new-operation"'));
    f.write("packages/opencode/src/command/template/new-command.txt", "A new host command");
    f.write(skillFile, "# Method\n[missing](references/not-provided.md)\n");
    fs.unlinkSync(path.join(f.root, "packages/opencode/test/fixtures/sample/SKILL.md"));
    const next = discoverUpstream(f.root, f.commit()), result = reviewDiscovery(next, approved);
    assert.equal(result.ready, false);
    assert.ok(next.tools[0]!.operations.includes("new-operation"));
    assert.ok(result.pending.includes(toolFile));
    assert.ok(result.pending.some((item) => item.includes("new-command.txt")));
    assert.ok(result.pending.some((item) => item.startsWith("removed:")));
    const current = review(next);
    assert.equal(reviewDiscovery(next, current).ready, false, "updating inventory identity alone does not excuse unresolved source links");
    current.reference_exceptions = [{ source_path: skillFile, source_sha256: next.assets.find((item) => item.path === skillFile)!.sha256, target: "references/not-provided.md", classification: "upstream-missing", reason: "Fixed commit has no referenced document; disclose the missing original" }];
    assert.equal(reviewDiscovery(next, current).ready, true);
    current.assets[0]!.classification = "required-native"; current.assets[0]!.implementation = "not_applicable";
    assert.equal(reviewDiscovery(next, current).ready, false);
  } finally { f.close(); }
});

test("dynamic registry members and nonliteral operation contracts fail closed while spread schemas retain operations", () => {
  const f = fixture();
  try {
    seed(f);
    f.write(toolFile, 'const Common = { operation: Schema.Literals(["inspect", "apply"]) }; export const NovelTool = Tool.define("novel_native", { parameters: Schema.Struct({ ...Common, target: Schema.String }) });');
    const spread = discoverUpstream(f.root, f.commit());
    assert.deepEqual(spread.tools[0]!.operations, ["apply", "inspect"]);
    f.write(toolFile, 'export const NovelTool = Tool.define("novel_native", { parameters: Schema.Struct({ action: Schema.Literals(["inspect", runtimeAction]), ...runtimeFields }) });');
    f.write(registry, fs.readFileSync(path.join(f.root, registry), "utf8").replace("[tool.novel]", "[tool.novel, ...runtimeTools]"));
    f.write("packages/opencode/resources/skills/new-method/scripts/helper.mjs", 'import "./missing.mjs";');
    const dynamic = discoverUpstream(f.root, f.commit());
    assert.ok(dynamic.unresolved.some((item) => item.startsWith("registry:unresolved-builtin")));
    assert.ok(dynamic.unresolved.some((item) => item.startsWith("schema:unresolved-operation")));
    assert.ok(dynamic.unresolved.some((item) => item.startsWith("schema:unresolved-fields")));
    assert.ok(dynamic.unresolved.some((item) => item.startsWith("dependency:unresolved")));
    assert.equal(reviewDiscovery(dynamic, review(dynamic)).ready, false);
  } finally { f.close(); }
});

test("CLI commands are discovered under their own fixed identity rather than inferred from Code's CLI dependency or bundled asset version", () => {
  const f = fixture("https://gitcode.com/openharmony-sig/deveco-cli");
  try {
    f.write("src/command.ts", 'program.command("new-command").requiredOption("--device <id>").option("--format <kind>");');
    f.write("package.json", '{"name":"@deveco/deveco-cli","version":"99.0.0"}');
    const result = discoverCliDependency(f.root, f.commit());
    assert.equal(result.source.id, "deveco-cli");
    assert.deepEqual(result.files.find((file) => file.path.endsWith("command.ts"))!.contracts.map((item) => item.kind).sort(), ["command", "option", "requiredOption"]);
    assert.equal(result.acceptance, "pending_final_validation");
    assert.throws(() => discoverUpstream(f.root, result.source.commit), /official Code origin/);
  } finally { f.close(); }
  const identities = JSON.parse(fs.readFileSync(path.join(packageRoot, "provenance/upstream-source-identities.json"), "utf8"));
  const discovery = JSON.parse(fs.readFileSync(path.join(packageRoot, identities.code.discovery), "utf8"));
  const cli = JSON.parse(fs.readFileSync(path.join(packageRoot, identities.cli.discovery), "utf8"));
  assert.equal(discovery.source.commit, identities.code.resource_lock);
  assert.equal(cli.source.commit, identities.cli.reviewed_candidate);
  assert.notEqual(identities.cli.protocol_lock, identities.cli.reviewed_candidate);
  assert.equal(identities.code.code_cli_dependency, "1.3.2");
  const resourceSources = JSON.parse(fs.readFileSync(path.join(packageRoot, "provenance/resources.json"), "utf8")).sources;
  assert.equal(resourceSources.find((source: { id: string }) => source.id === "deveco-cli-assets").version, "1.3.1");
  assert.equal(identities.code.candidate_domain_change, false);
  assert.ok(identities.cli.candidate_changes.length > 0);
});
