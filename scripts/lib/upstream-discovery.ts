import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const discoveryHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export type DiscoveredAsset = { id: string; source: string; path: string; sha256: string; kind: string; references: { target: string; resolved: string | null; kind: string }[] };
export type DiscoveredTool = { id: string; file: string; sha256: string; export: string; parameters: { name: string; schema: string; sha256: string }[]; schema: string; schema_sha256: string; operations: string[]; discovery: "resolved" | "pending" };
export type UpstreamDiscovery = { format: 1; source: { id: string; url: string; commit: string; tree: string }; registry: { file: string; sha256: string }; tools: DiscoveredTool[]; agents: { id: string; file: string; sha256: string; definition: string }[]; assets: DiscoveredAsset[]; dependencies: { file: string; name: string; version: string; sha256: string }[]; unresolved: string[]; sha256: string };
const official = "https://gitcode.com/openharmony-sig/deveco-code";
function visit(node: ts.Node, fn: (node: ts.Node) => void) { fn(node); ts.forEachChild(node, (child) => visit(child, fn)); }
function literal(node?: ts.Node): string | undefined { return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined; }
function propertyName(node: ts.PropertyName): string { return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : node.getText(); }
/** Static discovery only: fixed Git blobs are parsed, never imported or executed. */
export function discoverUpstream(repository: string, commit: string): UpstreamDiscovery {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Discovery requires a full fixed Git commit");
  const git = (args: string[]) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } });
  if (git(["remote", "get-url", "origin"]).trim().replace(/\.git$/, "") !== official) throw new Error("Upstream checkout must have the official Code origin");
  const tree = git(["rev-parse", `${commit}^{tree}`]).trim();
  const files = git(["ls-tree", "-rz", "--name-only", commit]).split("\0").filter(Boolean), fileSet = new Set(files), cache = new Map<string, string>();
  const bytes = (file: string) => execFileSync("git", ["-C", repository, "show", `${commit}:${file}`], { maxBuffer: 32 * 1024 * 1024 });
  const read = (file: string) => { let value = cache.get(file); if (value === undefined) { value = git(["show", `${commit}:${file}`]); cache.set(file, value); } return value; };
  const resolve = (file: string, target: string): string | null => {
    const base = target.startsWith("@/") ? `packages/opencode/src/${target.slice(2)}` : target.startsWith("@opencode-ai/core/") ? `packages/core/src/${target.slice(18)}` : target.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file), target)) : target;
    return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`].find((name) => fileSet.has(name)) ?? null;
  };
  const registryFile = "packages/opencode/src/tool/registry.ts", registryText = read(registryFile), registry = ts.createSourceFile(registryFile, registryText, ts.ScriptTarget.Latest, true);
  const imports = new Map<string, { file: string; name: string }>(), bindings = new Map<string, string>(), initialized = new Map<string, string>(), registered = new Set<string>(), unresolved: string[] = [];
  const collectBuiltin = (node: ts.Expression): void => {
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(registry) === "tool") { registered.add(node.name.text); return; }
    if (ts.isArrayLiteralExpression(node)) { for (const item of node.elements) collectBuiltin(item); return; }
    if (ts.isSpreadElement(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) { collectBuiltin(node.expression); return; }
    // Host feature flags select a subset; enumerate both statically declared arms.
    if (ts.isConditionalExpression(node)) { collectBuiltin(node.whenTrue); collectBuiltin(node.whenFalse); return; }
    unresolved.push(`registry:unresolved-builtin:${node.getText(registry)}`);
  };
  for (const node of registry.statements) if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    const imported = node.importClause?.namedBindings, file = resolve(registryFile, node.moduleSpecifier.text);
    if (file && imported && ts.isNamedImports(imported)) for (const item of imported.elements) imports.set(item.name.text, { file, name: item.propertyName?.text ?? item.name.text });
  }
  visit(registry, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isYieldExpression(node.initializer) && node.initializer.expression && ts.isIdentifier(node.initializer.expression)) bindings.set(node.name.text, node.initializer.expression.text);
    if (ts.isPropertyAssignment(node) && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(registry) === "Tool.init") {
      const arg = node.initializer.arguments[0]; if (arg && ts.isIdentifier(arg)) initialized.set(propertyName(node.name), bindings.get(arg.text) ?? arg.text);
    }
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === "builtin") collectBuiltin(node.initializer);
  });
  const tools: DiscoveredTool[] = [];
  for (const registeredName of [...registered].sort()) {
    const exported = initialized.get(registeredName), imported = exported ? imports.get(exported) : undefined;
    if (!imported) { unresolved.push(`registry:${registeredName}`); continue; }
    const text = read(imported.file), ast = ts.createSourceFile(imported.file, text, ts.ScriptTarget.Latest, true), constants = new Map<string, ts.Expression>();
    visit(ast, (node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer); });
    const definition = constants.get(imported.name); let id: string | undefined, schemaNode: ts.Expression | undefined;
    type Expression = { node: ts.Expression; ast: ts.SourceFile };
    const lookup = (file: string, name: string, seen: Set<string>): Expression | undefined => {
      const key = `${file}:${name}`; if (seen.has(key) || seen.size > 32) return; seen.add(key);
      const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true); let found: Expression | undefined;
      visit(source, (node) => {
        if (!found && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found = { node: node.initializer, ast: source };
        if (!found && ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) visit(node.body, (child) => { if (!found && ts.isReturnStatement(child) && child.expression) found = { node: child.expression, ast: source }; });
      });
      if (found) return found;
      for (const item of source.statements) if ((ts.isImportDeclaration(item) || ts.isExportDeclaration(item)) && item.moduleSpecifier) {
        const target = literal(item.moduleSpecifier), resolved = target ? resolve(file, target) : null; if (!resolved) continue;
        const names = ts.isImportDeclaration(item) ? item.importClause?.namedBindings : item.exportClause;
        if (names && (ts.isNamedImports(names) || ts.isNamedExports(names))) for (const binding of names.elements) if (binding.name.text === name) return lookup(resolved, binding.propertyName?.text ?? name, seen);
      }
      return undefined;
    };
    const dereference = (value: Expression, seen = new Set<string>()): Expression => {
      const { node, ast: source } = value;
      if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) return dereference({ node: node.expression, ast: source }, seen);
      if (ts.isIdentifier(node)) { const found = lookup(source.fileName, node.text, seen); if (found) return dereference(found, seen); }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        for (const item of source.statements) if (ts.isImportDeclaration(item) && item.importClause?.namedBindings && ts.isStringLiteral(item.moduleSpecifier)) {
          const names = item.importClause.namedBindings;
          if ((ts.isNamedImports(names) && names.elements.some((name) => name.name.text === node.expression.getText(source))) || (ts.isNamespaceImport(names) && names.name.text === node.expression.getText(source))) {
            const file = resolve(source.fileName, item.moduleSpecifier.text); const found = file ? lookup(file, node.name.text, seen) : undefined; if (found) return dereference(found, seen);
          }
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) { const found = lookup(source.fileName, node.expression.text, seen); if (found) return dereference(found, seen); }
      return value;
    };
    if (definition && ts.isCallExpression(definition)) {
      const idNode = definition.arguments[0]; id = idNode ? literal(dereference({ node: idNode, ast }).node) : undefined;
      visit(definition, (node) => { if (!schemaNode && ts.isPropertyAssignment(node) && propertyName(node.name) === "parameters") schemaNode = node.initializer; });
    }
    let expanded = schemaNode ? dereference({ node: schemaNode, ast }) : undefined;
    // Factories may return a runtime prompt object. Its explicitly exported
    // Parameters remains the static contract; never execute a prompt factory.
    if (expanded && ts.isPropertyAccessExpression(expanded.node)) { const declaration = lookup(imported.file, "Parameters", new Set()); if (declaration) expanded = dereference(declaration); }
    const parameters: DiscoveredTool["parameters"] = [], operationFields: Expression[] = []; let schemaResolved = false;
    const collect = (value: Expression) => {
      const resolved = dereference(value); if (!ts.isObjectLiteralExpression(resolved.node)) { unresolved.push(`schema:unresolved-fields:${imported.file}:${resolved.node.getText(resolved.ast)}`); return; }
      schemaResolved = true;
      for (const member of resolved.node.properties) {
        if (ts.isSpreadAssignment(member)) collect({ node: member.expression, ast: resolved.ast });
        if (ts.isPropertyAssignment(member)) { if (ts.isComputedPropertyName(member.name)) unresolved.push(`schema:computed-parameter:${imported.file}`); const schema = member.initializer.getText(resolved.ast); parameters.push({ name: propertyName(member.name), schema, sha256: discoveryHash(schema) }); if (["action", "operation"].includes(propertyName(member.name))) operationFields.push({ node: member.initializer, ast: resolved.ast }); }
      }
    };
    if (expanded) visit(expanded.node, (node) => {
      if (!schemaResolved && ts.isCallExpression(node) && /(?:Schema\.Struct|z\.(?:strictObject|object))$/.test(node.expression.getText(expanded!.ast))) { const object = node.arguments[0]; if (object) collect({ node: object, ast: expanded!.ast }); }
    });
    const operations: string[] = [];
    for (const field of operationFields) { const initialCount = operations.length; visit(dereference(field).node, (child) => {
        if (ts.isCallExpression(child) && /(?:Literals|Literal|enum|literal)$/.test(child.expression.getText(field.ast))) for (const arg of child.arguments) {
          const value = dereference({ node: arg, ast: field.ast }); if (ts.isArrayLiteralExpression(value.node)) for (const element of value.node.elements) { const item = literal(element); if (item) operations.push(item); else unresolved.push(`schema:unresolved-operation:${imported.file}:${element.getText(value.ast)}`); }
          else { const item = literal(value.node); if (item) operations.push(item); else unresolved.push(`schema:unresolved-operation:${imported.file}:${value.node.getText(value.ast)}`); }
        }
      }); if (initialCount === operations.length) unresolved.push(`schema:unresolved-operation:${imported.file}:${field.node.getText(field.ast)}`); }
    const schema = expanded?.node.getText(expanded.ast) ?? "UNRESOLVED";
    if (!id || !schemaNode || !schemaResolved) unresolved.push(`schema:${imported.file}:${imported.name}`);
    tools.push({ id: id ?? `unresolved:${registeredName}`, file: imported.file, sha256: discoveryHash(text), export: imported.name, parameters, schema, schema_sha256: discoveryHash(schema), operations: [...new Set(operations.length ? operations : ["execute"])].sort(), discovery: id && schemaNode && schemaResolved ? "resolved" : "pending" });
  }
  const kind = (file: string): string | null => {
    if (/^packages\/opencode\/resources\/skills\//.test(file)) return file.includes("/scripts/") ? "product-skill-script" : "product-skill-file";
    if (/^packages\/opencode\/resources\/spec\/commands\//.test(file)) return "sdd-command";
    if (/^packages\/opencode\/resources\/spec\/templates\//.test(file)) return "sdd-template";
    if (/^packages\/opencode\/src\/agent\/.*\.txt$/.test(file)) return "agent-prompt";
    if (/^packages\/opencode\/src\/command\/template\//.test(file)) return "builtin-command";
    if (file === "packages/opencode/resources/models.dev.json") return "host-provider-catalog";
    if (/^packages\/opencode\/resources\//.test(file)) return "unclassified-product-asset";
    if (/^(?:\.agents|\.opencode)\/(?:skills|agent|command)\//.test(file)) return "repository-development";
    if (/(?:^|\/)(?:test|tests|fixtures)\//.test(file) && /SKILL\.md$/.test(file)) return "test-fixture";
    if (file === registryFile || tools.some((tool) => tool.file === file)) return "registry-tool";
    if (["packages/opencode/src/agent/agent.ts", "packages/opencode/src/command/index.ts"].includes(file)) return "registry-behavior";
    if (/^packages\/opencode\/src\/(?:agent|command)\//.test(file)) return "host-behavior";
    return null;
  };
  const queue = files.filter((file) => kind(file)), selected = new Map<string, string>(queue.map((file) => [file, kind(file)!])), assets: DiscoveredAsset[] = [];
  for (let index = 0; index < queue.length; index++) {
    const file = queue[index]!, text = read(file), references: DiscoveredAsset["references"] = [];
    const add = (target: string, referenceKind: string) => {
      if (!target || target.startsWith("#") || /^(?:https?|mailto|data):/.test(target)) return;
      const clean = target.split("#")[0]!.split("?")[0]!, resolved = resolve(file, referenceKind !== "import" && !clean.startsWith(".") ? `./${clean}` : clean);
      if (!references.some((ref) => ref.target === target && ref.kind === referenceKind)) references.push({ target, resolved, kind: referenceKind });
      if (!resolved && referenceKind === "import" && /^(?:\.|@\/|@opencode-ai\/core\/)/.test(target)) unresolved.push(`dependency:unresolved:${file}:${target}`);
      if (resolved && !selected.has(resolved)) { selected.set(resolved, "transitive-dependency"); queue.push(resolved); }
    };
    if (/\.(?:md|txt)$/.test(file)) {
      for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) add(match[1]!, "markdown-link");
      for (const match of text.matchAll(/`((?:\.{0,2}\/)?(?:scripts|reference|references|assets|templates)\/[\w./-]+\.[\w]+)`/g)) add(match[1]!, "body-reference");
    }
    if (/\.(?:[cm]?js|tsx?)$/.test(file)) {
      const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      visit(ast, (node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) { const target = literal(node.moduleSpecifier); if (target) add(target, "import"); }
        if (ts.isCallExpression(node) && ["require", "import"].includes(node.expression.getText(ast))) { const target = literal(node.arguments[0]); if (target) add(target, "import"); }
      });
    }
    assets.push({ id: discoveryHash(`deveco-code:${file}`).slice(0, 24), source: "deveco-code", path: file, sha256: discoveryHash(bytes(file)), kind: selected.get(file)!, references: references.sort((a, b) => a.target.localeCompare(b.target)) });
    if (queue.length > 5000) throw new Error("Upstream dependency discovery exceeded the bounded source inventory");
  }
  const agents: UpstreamDiscovery["agents"] = [];
  const agentFile = "packages/opencode/src/agent/agent.ts", agentAst = ts.createSourceFile(agentFile, read(agentFile), ts.ScriptTarget.Latest, true);
  visit(agentAst, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    const name = node.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === "name");
    const mode = node.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === "mode");
    const id = name ? literal(name.initializer) : undefined;
    if (id && mode && literal(mode.initializer)) { const definition = node.getText(agentAst); agents.push({ id, file: agentFile, sha256: discoveryHash(definition), definition }); }
    // Schema declarations are not instances. Explicit native:false factories
    // describe user-configured host agents, whose implementation remains hashed
    // in registry-behavior; their runtime user keys are not built-in agent IDs.
    else if (name && mode && literal(mode.initializer) && !node.properties.some((item) => ts.isPropertyAssignment(item) && propertyName(item.name) === "native" && item.initializer.kind === ts.SyntaxKind.FalseKeyword)) unresolved.push(`agent:unresolved:${node.getText(agentAst)}`);
  });
  const dependencies: UpstreamDiscovery["dependencies"] = [];
  for (const file of files.filter((file) => /(^|\/)package\.json$/.test(file))) {
    const text = read(file), json = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) for (const [name, version] of Object.entries((json[key] ?? {}) as Record<string, string>)) if (name.includes("deveco") || name.includes("hypium")) dependencies.push({ file, name, version, sha256: discoveryHash(text) });
  }
  const body = { format: 1 as const, source: { id: "deveco-code", url: official, commit, tree }, registry: { file: registryFile, sha256: discoveryHash(registryText) }, tools: tools.sort((a, b) => a.id.localeCompare(b.id)), agents: agents.sort((a, b) => a.id.localeCompare(b.id)), assets: assets.sort((a, b) => a.path.localeCompare(b.path)), dependencies, unresolved: unresolved.sort() };
  return { ...body, sha256: discoveryHash(JSON.stringify(body)) };
}

export function reviewDiscovery(discovery: UpstreamDiscovery, review: { discovery_sha256: string; assets: { id: string; sha256: string; classification: string; implementation: string; evidence: string; environment: string; reason: string; targets: string[] }[]; reference_exceptions?: { source_path: string; source_sha256: string; target: string; classification: string; reason: string }[] }) {
  const pending: string[] = [...discovery.unresolved];
  if (review.discovery_sha256 !== discovery.sha256) pending.push("discovery-content-changed");
  const seen = new Set<string>();
  for (const item of discovery.assets) {
    const row = review.assets.find((row) => row.id === item.id);
    if (!row || row.sha256 !== item.sha256 || !["required-native", "host-delegated", "intentional-boundary"].includes(row.classification) || !["implemented", "adapted", "not_applicable"].includes(row.implementation) || (row.classification === "required-native" && row.implementation === "not_applicable") || !row.reason.trim()) pending.push(item.path);
    for (const ref of item.references.filter((ref) => !ref.resolved && ref.kind !== "import")) {
      const exception = review.reference_exceptions?.find((entry) => entry.source_path === item.path && entry.source_sha256 === item.sha256 && entry.target === ref.target);
      if (!exception || !["upstream-missing", "example-placeholder", "test-fixture"].includes(exception.classification) || !exception.reason.trim()) pending.push(`reference:${item.path}:${ref.target}`);
    }
    if (seen.has(item.id)) pending.push(`duplicate:${item.id}`); seen.add(item.id);
  }
  const reviewed = new Set<string>();
  for (const row of review.assets) { if (!seen.has(row.id)) pending.push(`removed:${row.id}`); if (reviewed.has(row.id)) pending.push(`duplicate-review:${row.id}`); reviewed.add(row.id); }
  return { ready: !pending.length, pending, source: discovery.source, assets: discovery.assets.length, schema_operations: discovery.tools.reduce((sum, tool) => sum + tool.operations.length, 0), note: "Reviewed source mapping is independent of runtime acceptance and environment support." };
}

/** CLI is an independent source, not inferred to advance with Code's lock. */
export function discoverCliDependency(repository: string, commit: string) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Dependency discovery requires a full fixed commit");
  const url = "https://gitcode.com/openharmony-sig/deveco-cli";
  const git = (args: string[]) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (git(["remote", "get-url", "origin"]).trim().replace(/\.git$/, "") !== url) throw new Error("Dependency origin does not match official CLI");
  const tree = git(["rev-parse", `${commit}^{tree}`]).trim();
  const paths = git(["ls-tree", "-rz", "--name-only", commit]).split("\0").filter(Boolean);
  const files = paths.filter((file) => /(?:^SKILL\.md$|^src\/|^scripts\/|(?:^|\/)package\.json$)/.test(file)).map((file) => {
    const text = git(["show", `${commit}:${file}`]), contracts: { kind: string; value: string; schema: string }[] = [];
    if (/\.[cm]?[jt]s$/.test(file)) {
      const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      visit(ast, (node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["command", "option", "requiredOption", "argument", "choices"].includes(node.expression.name.text)) {
          const value = literal(node.arguments[0]); if (value) contracts.push({ kind: node.expression.name.text, value, schema: node.getText(ast) });
        }
      });
    }
    return { path: file, sha256: discoveryHash(text), contracts };
  });
  const body = { format: 1, source: { id: "deveco-cli", url, commit, tree }, files, acceptance: "pending_final_validation", note: "Static commands/options are source contracts; CLI runtime and SDK behavior require separate acceptance." };
  return { ...body, sha256: discoveryHash(JSON.stringify(body)) };
}

// This entry generates product inventory; it does not run checks or approve evidence.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repository, commit, output] = process.argv.slice(2);
  if (!repository || !commit || !output) throw new Error("Usage: upstream-discovery <official-checkout> <full-commit> <output.json>");
  fs.writeFileSync(output, `${JSON.stringify(process.argv[5] === "--cli" ? discoverCliDependency(repository, commit) : discoverUpstream(repository, commit), null, 2)}\n`);
}
