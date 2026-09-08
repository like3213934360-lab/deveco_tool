import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { configSchema, protocolVersion, release } from "../core/config.js";
import { atomicWrite, destinationPath, digest, fileDigest, privateDirectory } from "../core/files.js";
import { PayloadCipher } from "../core/crypto.js";
import { invariant } from "../core/errors.js";
import { flowSchema } from "../core/contracts.js";
import { assertQuiescent } from "./quiescence.js";
import { installationIdentity, installedRoot, nativeNodeIdentity } from "./installation.js";

const absolute = z.string().min(1).refine(path.isAbsolute, "Use an absolute path");
const specSchema = z.strictObject({
  mode: z.enum(["upgrade", "repair_missing_entry"]).default("upgrade"),
  previous_state_dirs: z.array(absolute).max(32).default([]),
  host_config: absolute,
  host_format: z.enum(["codex-toml", "mcp-json"]),
  server: z.string().regex(/^[A-Za-z0-9_-]+$/).default("deveco-tool"),
  installation: absolute,
  node: absolute,
  state_dir: absolute,
  configuration: configSchema.omit({ state_dir: true }).prefault({}),
  flow_files: z.array(absolute).max(1000).default([]),
});
const planSchema = z.strictObject({
  format: z.literal(1), release: z.literal(release), protocol: z.literal(protocolVersion),
  spec: specSchema,
  before_sha256: z.string(), entry_sha256: z.string(),
  installation_sha256: z.string(), node_sha256: z.string(),
  previous: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("complete"), installation: absolute, entry: absolute, sha256: z.string() }),
    z.object({ kind: z.literal("missing_entry"), installation: absolute, entry: absolute }),
  ]),
  flows: z.array(z.object({ path: absolute, sha256: z.string(), id: z.string(), assertion: z.boolean() })),
  after_sha256: z.string(), sha256: z.string(),
});
type Spec = z.infer<typeof specSchema>;
const read = (file: string, limit = 4 * 1024 * 1024) => {
  const stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, "UPGRADE_FILE_INVALID", "Upgrade input must be a bounded regular file");
  return fs.readFileSync(file, "utf8");
};
const checksum = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

function previousEntry(original: string, spec: Spec): string {
  if (spec.host_format === "mcp-json") {
    const config = z.object({ mcpServers: z.record(z.string(), z.unknown()) }).parse(JSON.parse(original) as unknown);
    return z.object({ args: z.array(z.string()).min(1) }).parse(config.mcpServers[spec.server]).args[0]!;
  }
  const header = new RegExp(`^\\s*\\[mcp_servers\\.(?:${spec.server}|"${spec.server}")\\]\\s*(?:#.*)?$`);
  let inside = false;
  for (const line of original.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) inside = header.test(line);
    if (!inside) continue;
    const match = /^\s*args\s*=\s*(\[.*\])\s*(?:#.*)?$/.exec(line);
    if (match) return z.array(z.string()).min(1).parse(JSON.parse(match[1]!) as unknown)[0]!;
  }
  invariant(false, "UPGRADE_HOST_UNSUPPORTED", "Upgrade requires a standalone Node entry with a single-line argument array");
}

function patchHost(original: string, spec: Spec): string {
  const entry = { command: spec.node, args: [path.join(spec.installation, "dist/src/cli.js")], env: {
    DEVECO_CONFIG: path.join(spec.state_dir, "configuration.json"), DEVECO_STATE_DIR: spec.state_dir,
  } };
  if (spec.host_format === "mcp-json") {
    const config = z.record(z.string(), z.unknown()).parse(JSON.parse(original) as unknown);
    const servers = z.record(z.string(), z.unknown()).parse(config.mcpServers);
    invariant(Object.hasOwn(servers, spec.server), "UPGRADE_SERVER_MISSING", "Selected MCP entry is missing");
    const prior = z.record(z.string(), z.unknown()).parse(servers[spec.server]);
    for (const key of ["command", "args", "env", "env_vars", "cwd", "experimental_environment"]) delete prior[key];
    servers[spec.server] = { ...prior, ...entry }; config.mcpServers = servers;
    return JSON.stringify(config, null, 2) + "\n";
  }
  // Keep timeout, enablement and approval/tool policies, including nested tool
  // tables. Only this server's launch fields and environment are replaced.
  const rootHeader = new RegExp(`^\\s*\\[mcp_servers\\.(?:${spec.server}|"${spec.server}")\\]\\s*(?:#.*)?$`);
  const envHeader = new RegExp(`^\\s*\\[mcp_servers\\.(?:${spec.server}|"${spec.server}")\\.env\\]\\s*(?:#.*)?$`);
  let selected = false, environment = false, found = false;
  const lines: string[] = [];
  for (const line of original.split(/(?<=\n)/)) {
    if (/^\s*\[/.test(line)) {
      selected = rootHeader.test(line.trimEnd()); environment = envHeader.test(line.trimEnd());
      if (selected) {
        invariant(!found, "UPGRADE_HOST_UNSUPPORTED", "Duplicate selected MCP table"); found = true;
        lines.push(line.endsWith("\n") ? line : line + "\n", `command = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\n`);
        continue;
      }
    }
    if (environment) continue;
    if (selected && /^\s*["'](?:command|args|env|env_vars|cwd|experimental_environment)["']\s*=/.test(line)) invariant(false, "UPGRADE_HOST_UNSUPPORTED", "Quoted launch keys require explicit normalization before a byte-preserving upgrade");
    if (selected && /^\s*(?:command|args|env|env_vars|cwd|experimental_environment)\s*=/.test(line)) {
      const value = line.slice(line.indexOf("=") + 1).trim();
      invariant(!value.startsWith('"""') && !value.startsWith("'''") && !(value.startsWith("[") && !/\]\s*(?:#.*)?$/.test(value)) && !(value.startsWith("{") && !/\}\s*(?:#.*)?$/.test(value)), "UPGRADE_HOST_UNSUPPORTED", "Launch fields must use single-line values for a byte-preserving upgrade");
      continue;
    }
    lines.push(line);
  }
  invariant(found, "UPGRADE_SERVER_MISSING", "Selected MCP TOML entry is missing or unsupported");
  return lines.join("") + "\n\n" + `[mcp_servers.${spec.server}.env]\nDEVECO_CONFIG = ${JSON.stringify(entry.env.DEVECO_CONFIG)}\nDEVECO_STATE_DIR = ${JSON.stringify(entry.env.DEVECO_STATE_DIR)}\n`;

}
export function planUpgrade(raw: unknown) {
  const spec = specSchema.parse(raw);
  spec.host_config = fs.realpathSync.native(spec.host_config);
  spec.installation = fs.realpathSync.native(spec.installation);
  spec.node = fs.realpathSync.native(spec.node);
  spec.state_dir = destinationPath(spec.state_dir);
  invariant(!fs.existsSync(spec.state_dir), "UPGRADE_STATE_EXISTS", "Execution protocol changes require a new state directory");
  const entry = path.join(spec.installation, "dist/src/cli.js"),
    pkg = z.object({ version: z.literal(release), bin: z.object({ "deveco-tool": z.literal("dist/src/cli.js") }) }).parse(JSON.parse(read(path.join(spec.installation, "package.json"))) as unknown);
  invariant(pkg.version === release && fs.lstatSync(entry).isFile() && !fs.lstatSync(entry).isSymbolicLink(), "UPGRADE_ENTRY_INVALID", "Installation must contain this compiled native release");
  const flows = spec.flow_files.map((file) => {
    const content = read(file), flow = flowSchema.parse(JSON.parse(content) as unknown);
    return { path: file, sha256: checksum(content), id: flow.id, assertion: !!flow.assert };
  });
  const before = read(spec.host_config), after = patchHost(before, spec);
  const previous = previousEntry(before, spec);
  invariant(path.isAbsolute(previous), "UPGRADE_PREVIOUS_INSTALLATION_MISSING", "Previous host entry must be absolute");
  let previousRoot: string, previousIdentity: z.infer<typeof planSchema>["previous"];
  if (spec.mode === "repair_missing_entry") {
    invariant(!fs.lstatSync(previous, { throwIfNoEntry: false }), "UPGRADE_REPAIR_NOT_APPLICABLE", "Missing-entry repair requires the recorded entry to be absent");
    previousRoot = path.dirname(previous);
    for (let depth = 0; depth < 5 && !fs.existsSync(path.join(previousRoot, "package.json")); depth++) previousRoot = path.dirname(previousRoot);
    invariant(fs.existsSync(path.join(previousRoot, "package.json")), "UPGRADE_PREVIOUS_INSTALLATION_MISSING", "Missing entry has no identifiable installation root");
    previousRoot = fs.realpathSync.native(previousRoot);
    previousIdentity = { kind: "missing_entry", installation: previousRoot, entry: previous };
  } else {
    previousRoot = installedRoot(previous);
    previousIdentity = { kind: "complete", installation: previousRoot, entry: previous, sha256: installationIdentity(previousRoot).sha256 };
  }
  invariant(previousRoot !== spec.installation && !spec.installation.startsWith(previousRoot + path.sep) && !previousRoot.startsWith(spec.installation + path.sep), "UPGRADE_INSTALLATION_IN_PLACE", "Install releases side by side so rollback retains the complete previous installation");
  const plan = { format: 1 as const, release, protocol: protocolVersion, spec, before_sha256: checksum(before), entry_sha256: fileDigest(entry), installation_sha256: installationIdentity(spec.installation).sha256, node_sha256: nativeNodeIdentity(spec.node).sha256, previous: previousIdentity, flows, after_sha256: checksum(after) };
  return { ...plan, sha256: digest(plan) };
}
export function applyUpgrade(raw: unknown, journal: string, sessionsEnded: boolean) {
  const plan = planSchema.parse(raw), { sha256, ...payload } = plan;
  invariant(digest(payload) === sha256, "UPGRADE_PLAN_CHANGED", "Upgrade plan digest differs");
  const { spec } = plan;
  invariant(spec.mode === "repair_missing_entry" || sessionsEnded, "UPGRADE_SESSIONS_ACTIVE", "End tasks and sessions before applying; pass --sessions-ended after doing so");
  invariant((spec.mode === "repair_missing_entry") === (plan.previous.kind === "missing_entry"), "UPGRADE_PLAN_CHANGED", "Repair mode and previous installation evidence differ");
  journal = destinationPath(journal);
  const savedPath = path.join(journal, "rollback.encrypted"), resumed = fs.existsSync(savedPath);
  invariant(resumed || !fs.existsSync(spec.state_dir), "UPGRADE_STATE_EXISTS", "New execution state already exists without this upgrade journal");
  invariant(!fs.existsSync(journal) || (fs.lstatSync(journal).isDirectory() && !fs.lstatSync(journal).isSymbolicLink()), "UPGRADE_JOURNAL_INVALID", "Upgrade journal must be a private directory");
  invariant(fileDigest(path.join(spec.installation, "dist/src/cli.js")) === plan.entry_sha256, "UPGRADE_INSTALLATION_CHANGED", "Compiled entry changed after planning");
  invariant(installationIdentity(spec.installation).sha256 === plan.installation_sha256 && nativeNodeIdentity(spec.node).sha256 === plan.node_sha256, "UPGRADE_INSTALLATION_CHANGED", "Installed runtime or Node changed after planning");
  if (plan.previous.kind === "complete") invariant(installationIdentity(plan.previous.installation).sha256 === plan.previous.sha256 && fs.existsSync(plan.previous.entry), "UPGRADE_PREVIOUS_INSTALLATION_CHANGED", "Previous full installation changed after planning");
  else invariant(!fs.lstatSync(plan.previous.entry, { throwIfNoEntry: false }), "UPGRADE_PREVIOUS_INSTALLATION_CHANGED", "The old entry was restored; use a regular upgrade plan");
  const quiescence = assertQuiescent([plan.previous.installation, spec.installation], [...spec.previous_state_dirs, spec.state_dir]);
  for (const flow of plan.flows) invariant(fileDigest(flow.path) === flow.sha256, "UPGRADE_FLOW_CHANGED", "A saved UI flow changed after planning");
  privateDirectory(journal);
  invariant(!resumed || fs.existsSync(path.join(journal, "journal.key")), "UPGRADE_JOURNAL_KEY_MISSING", "Original upgrade key is required");
  const cipher = new PayloadCipher(path.join(journal, "journal.key"));
  try {
    const current = read(spec.host_config);
    let before: string, after: string;
    if (resumed) {
      const saved = z.object({ before: z.string(), after: z.string(), plan: planSchema }).parse(JSON.parse(cipher.open(sha256, read(savedPath, 32 * 1024 * 1024))) as unknown);
      invariant(digest(saved.plan) === digest(plan), "UPGRADE_JOURNAL_CONFLICT", "This journal belongs to another upgrade plan");
      before = saved.before; after = saved.after;
    } else {
      before = current; after = patchHost(current, spec);
      invariant(checksum(before) === plan.before_sha256 && checksum(after) === plan.after_sha256, "UPGRADE_HOST_CHANGED", "Host configuration changed after planning");
      // Full host configuration can contain other MCP credentials. Journal it encrypted before any mutation.
      atomicWrite(savedPath, cipher.seal(sha256, JSON.stringify({ before, after, plan })), false);
    }
    invariant(checksum(before) === plan.before_sha256 && checksum(after) === plan.after_sha256 && [plan.before_sha256, plan.after_sha256].includes(checksum(current)), "UPGRADE_HOST_CHANGED", "Host configuration differs from the recorded upgrade");
    const receipt = JSON.stringify({ plan_sha256: sha256, host_config: spec.host_config, after_sha256: plan.after_sha256, release, protocol: protocolVersion, restart_required: true }, null, 2) + "\n";
    const receiptPath = path.join(journal, "receipt.json");
    if (fs.existsSync(receiptPath)) invariant(read(receiptPath) === receipt, "UPGRADE_JOURNAL_CONFLICT", "Upgrade receipt changed");
    else atomicWrite(receiptPath, receipt, false);
    privateDirectory(spec.state_dir);
    const configurationFile = path.join(spec.state_dir, "configuration.json"), configurationText = JSON.stringify(spec.configuration, null, 2) + "\n";
    if (fs.existsSync(configurationFile)) invariant(read(configurationFile) === configurationText, "UPGRADE_CONFIGURATION_CHANGED", "New native configuration changed during upgrade");
    else atomicWrite(configurationFile, configurationText, false);
    invariant(fileDigest(spec.host_config) === checksum(current), "UPGRADE_HOST_CHANGED", "Host configuration changed before commit");
    assertQuiescent([plan.previous.installation, spec.installation], [...spec.previous_state_dirs, spec.state_dir]);
    if (checksum(current) !== plan.after_sha256) atomicWrite(spec.host_config, after);
    return { applied: true, resumed, restart_required: true, rollback_available: plan.previous.kind === "complete", quiescence, journal, state_dir: spec.state_dir, flows_preserved: plan.flows.length, authentication: "Log in again; credentials were not imported" };
  } finally { cipher.close(); }
}
export function rollbackUpgrade(journal: string, sessionsEnded: boolean) {
  invariant(sessionsEnded, "UPGRADE_SESSIONS_ACTIVE", "End tasks and sessions before rollback; pass --sessions-ended after doing so");
  journal = fs.realpathSync.native(path.resolve(journal));
  const receipt = z.object({ plan_sha256: z.string() }).parse(JSON.parse(read(path.join(journal, "receipt.json"))) as unknown),
    cipher = new PayloadCipher(path.join(journal, "journal.key"));
  try {
    const record = z.object({ before: z.string(), after: z.string(), plan: planSchema }).parse(JSON.parse(cipher.open(receipt.plan_sha256, read(path.join(journal, "rollback.encrypted"), 32 * 1024 * 1024))) as unknown);
    const { plan } = record, current = read(plan.spec.host_config);
    invariant(checksum(record.before) === plan.before_sha256 && checksum(record.after) === plan.after_sha256, "UPGRADE_JOURNAL_CHANGED", "Rollback journal has inconsistent hashes");
    invariant(plan.previous.kind === "complete", "UPGRADE_ROLLBACK_UNAVAILABLE", "Missing-entry repair has no runnable previous installation; restoring a broken entry is not rollback");
    assertQuiescent([plan.previous.installation, plan.spec.installation], [...plan.spec.previous_state_dirs, plan.spec.state_dir]);
    invariant(fs.existsSync(plan.previous.entry) && installationIdentity(plan.previous.installation).sha256 === plan.previous.sha256, "UPGRADE_PREVIOUS_INSTALLATION_CHANGED", "Restore the complete previous installation before switching back");
    invariant(checksum(current) === plan.after_sha256 || checksum(current) === plan.before_sha256, "UPGRADE_HOST_CHANGED", "Host changed after upgrade; review those changes before rollback");
    if (checksum(current) !== plan.before_sha256) atomicWrite(plan.spec.host_config, record.before);
    return { rolled_back: true, restart_required: true, state_preserved: plan.spec.state_dir, external_effects_reverted: false };
  } finally { cipher.close(); }
}

export async function maintenance(args: string[]) {
  const [action, input, output] = args;
  invariant(input, "MAINTENANCE_ARGUMENT", "Usage: maintenance plan SPEC PLAN | apply PLAN JOURNAL --sessions-ended | rollback JOURNAL --sessions-ended");
  let result: unknown;
  if (action === "skills-plan") {
    const { planSkillCleanup } = await import("./skill-cleanup.js");
    invariant(output && args[3], "MAINTENANCE_ARGUMENT", "Usage: maintenance skills-plan HOST_SKILLS OLD_INSTALLATION PLAN");
    result = planSkillCleanup(input, output); atomicWrite(args[3], JSON.stringify(result, null, 2) + "\n", false);
  }
  else if (action === "skills-apply") { const { applySkillCleanup } = await import("./skill-cleanup.js"); result = applySkillCleanup(JSON.parse(read(input)) as unknown); }
  else if (action === "plan") { invariant(output, "MAINTENANCE_ARGUMENT", "Plan output is required"); result = planUpgrade(JSON.parse(read(input)) as unknown); atomicWrite(output, JSON.stringify(result, null, 2) + "\n", false); }
  else if (action === "apply") { invariant(output, "MAINTENANCE_ARGUMENT", "Private journal directory is required"); result = applyUpgrade(JSON.parse(read(input)) as unknown, output, args.includes("--sessions-ended")); }
  else if (action === "rollback") result = rollbackUpgrade(input, args.includes("--sessions-ended"));
  else invariant(false, "MAINTENANCE_ARGUMENT", "Unknown maintenance action");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
