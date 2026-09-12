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
import { previousHost, patchHost } from "./host-config.js";
import { initializeStateSchema, inspectStateSchema, stateMaintenancePath } from "../core/state-schema.js";
import { fenceState, inspectCompatibleState, saveStateSnapshot, restoreStateSnapshot } from "./state-snapshot.js";

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
  state_strategy: z.enum(["auto", "reuse", "fresh"]).default("auto"),
  source_state_dir: absolute.optional(),
  configuration: configSchema.omit({ state_dir: true }).prefault({}),
  flow_files: z.array(absolute).max(1000).default([]),
});
const planSchema = z.strictObject({
  format: z.literal(2), release: z.literal(release), protocol: z.literal(protocolVersion),
  spec: specSchema,
  before_sha256: z.string(), entry_sha256: z.string(),
  installation_sha256: z.string(), node_sha256: z.string(),
  previous: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("complete"), installation: absolute, entry: absolute, sha256: z.string() }),
    z.object({ kind: z.literal("missing_entry"), installation: absolute, entry: absolute }),
  ]),
  state: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("fresh") }),
    z.object({ kind: z.literal("reuse"), protocol: z.string(), revision: z.number().int(), schema_sha256: z.string() }),
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

export function planUpgrade(raw: unknown) {
  const spec = specSchema.parse(raw);
  spec.host_config = fs.realpathSync.native(spec.host_config);
  spec.installation = fs.realpathSync.native(spec.installation);
  spec.node = fs.realpathSync.native(spec.node);
  spec.state_dir = destinationPath(spec.state_dir);
  const entry = path.join(spec.installation, "dist/src/cli.js"),
    pkg = z.object({ version: z.literal(release), bin: z.object({ "deveco-tool": z.literal("dist/src/cli.js") }) }).parse(JSON.parse(read(path.join(spec.installation, "package.json"))) as unknown);
  invariant(pkg.version === release && fs.lstatSync(entry).isFile() && !fs.lstatSync(entry).isSymbolicLink(), "UPGRADE_ENTRY_INVALID", "Installation must contain this compiled native release");
  const flows = spec.flow_files.map((file) => {
    const content = read(file), flow = flowSchema.parse(JSON.parse(content) as unknown);
    return { path: file, sha256: checksum(content), id: flow.id, assertion: !!flow.assert };
  });
  const before = read(spec.host_config), host = previousHost(before, spec);
  let source = host.state_dir;
  if (!source && host.configuration_file) source = configSchema.parse(JSON.parse(read(host.configuration_file)) as unknown).state_dir;
  if (source) { invariant(path.isAbsolute(source), "UPGRADE_STATE_SOURCE_REQUIRED", "Normalize the selected host state path before planning"); source = destinationPath(source); }
  if (spec.source_state_dir) {
    spec.source_state_dir = destinationPath(spec.source_state_dir);
    invariant(!source || source === spec.source_state_dir, "UPGRADE_STATE_SOURCE_MISMATCH", "Explicit source state differs from the selected MCP entry");
    source = spec.source_state_dir;
  }
  let state: z.infer<typeof planSchema>["state"];
  if (fs.existsSync(spec.state_dir)) {
    invariant(spec.state_strategy !== "fresh", "UPGRADE_STATE_EXISTS", "Fresh state must use an unoccupied directory");
    invariant(source === spec.state_dir, "UPGRADE_STATE_SOURCE_REQUIRED", "Reuse must select the existing state of this MCP entry; provide source_state_dir when its path is inherited");
    state = { kind: "reuse", ...inspectCompatibleState(spec.state_dir) };
    if (!Object.hasOwn(z.record(z.string(), z.unknown()).parse(raw), "configuration") && host.configuration_file) {
      const { state_dir: _state, ...configuration } = configSchema.parse(JSON.parse(read(host.configuration_file)) as unknown);
      spec.configuration = configuration;
    }
  } else {
    invariant(spec.state_strategy !== "reuse", "UPGRADE_STATE_MISSING", "Compatible reuse requires existing native state");
    invariant(!source || !fs.existsSync(path.join(source, "state.sqlite")) || spec.state_strategy === "fresh", "UPGRADE_STATE_DECISION_REQUIRED", "Existing state is available: reuse its original directory to preserve authentication/history, or explicitly choose fresh state after export");
    state = { kind: "fresh" };
  }
  if (source && !spec.previous_state_dirs.includes(source)) spec.previous_state_dirs.push(source);
  const after = patchHost(before, spec), previous = host.entry;
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
  const plan = { format: 2 as const, release, protocol: protocolVersion, spec, before_sha256: checksum(before), entry_sha256: fileDigest(entry), installation_sha256: installationIdentity(spec.installation).sha256, node_sha256: nativeNodeIdentity(spec.node).sha256, previous: previousIdentity, state, flows, after_sha256: checksum(after) };
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
  invariant(plan.state.kind === "reuse" || resumed || !fs.existsSync(spec.state_dir), "UPGRADE_STATE_EXISTS", "New execution state already exists without this upgrade journal");
  invariant(journal !== spec.state_dir && !journal.startsWith(spec.state_dir + path.sep) && !spec.state_dir.startsWith(journal + path.sep), "UPGRADE_JOURNAL_INVALID", "Upgrade journal must be outside the state directory");
  invariant(!fs.existsSync(path.join(journal, "rolled-back.json")), "UPGRADE_ALREADY_ROLLED_BACK", "This upgrade was rolled back; create a new plan and journal to upgrade again");
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
  let fence: ReturnType<typeof fenceState> | undefined, success = false;
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
    if (plan.state.kind === "reuse") {
      fence = fenceState(spec.state_dir, journal, sha256);
      assertQuiescent([plan.previous.installation, spec.installation], [...spec.previous_state_dirs, spec.state_dir]);
      const db = fence.lock(), state = inspectStateSchema(db);
      if (!fs.existsSync(path.join(journal, "state-before"))) invariant(state.schema_sha256 === plan.state.schema_sha256, "UPGRADE_STATE_CHANGED", "State schema changed after planning");
      saveStateSnapshot(spec.state_dir, journal, sha256, db, cipher);
      initializeStateSchema(db);
    } else privateDirectory(spec.state_dir);
    const configurationFile = path.join(spec.state_dir, "configuration.json"), configurationText = JSON.stringify(spec.configuration, null, 2) + "\n";
    if (plan.state.kind === "reuse") {
      if (fs.existsSync(path.join(journal, "applied.json"))) invariant(read(configurationFile) === configurationText, "UPGRADE_CONFIGURATION_CHANGED", "Configuration changed after upgrade; retry cannot overwrite later user settings");
      else atomicWrite(configurationFile, configurationText);
    }
    else if (fs.existsSync(configurationFile)) invariant(read(configurationFile) === configurationText, "UPGRADE_CONFIGURATION_CHANGED", "New native configuration changed during upgrade");
    else atomicWrite(configurationFile, configurationText, false);
    invariant(fileDigest(spec.host_config) === checksum(current), "UPGRADE_HOST_CHANGED", "Host configuration changed before commit");
    assertQuiescent([plan.previous.installation, spec.installation], [...spec.previous_state_dirs, spec.state_dir]);
    if (checksum(current) !== plan.after_sha256) atomicWrite(spec.host_config, after);
    fence?.closeDatabase(true);
    atomicWrite(path.join(journal, "applied.json"), JSON.stringify({ plan_sha256: sha256, state: plan.state.kind }), true);
    success = true;
    return { applied: true, resumed, restart_required: true, rollback_available: plan.previous.kind === "complete", quiescence, journal, state_dir: spec.state_dir, state: plan.state.kind, flows_preserved: plan.flows.length, authentication: plan.state.kind === "reuse" ? "Encrypted credentials preserved; original expiry and refresh rules still apply" : "Fresh state requires login; original state remains available" };
  } finally { try { fence?.finish(success); } finally { cipher.close(); } }
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
    const completed = path.join(journal, "rolled-back.json"), completion = JSON.stringify({ plan_sha256: receipt.plan_sha256 });
    if (fs.existsSync(completed)) {
      invariant(read(completed) === completion && checksum(current) === plan.before_sha256, "UPGRADE_JOURNAL_CONFLICT", "Completed rollback differs from its host configuration");
      // The completion receipt precedes fence removal. Resume that final crash
      // window without restoring the snapshot again or overwriting later data.
      if (plan.state.kind === "reuse" && fs.existsSync(stateMaintenancePath(plan.spec.state_dir))) {
        const fence = fenceState(plan.spec.state_dir, journal, receipt.plan_sha256);
        let success = false;
        try {
          assertQuiescent([plan.previous.installation, plan.spec.installation], [...plan.spec.previous_state_dirs, plan.spec.state_dir]);
          invariant(inspectCompatibleState(plan.spec.state_dir).schema_sha256 === plan.state.schema_sha256, "UPGRADE_STATE_CHANGED", "Completed rollback state no longer matches the original schema");
          success = true;
        } finally { fence.finish(success); }
      }
      return { rolled_back: true, resumed: true, restart_required: true, external_effects_reverted: false };
    }
    let fence: ReturnType<typeof fenceState> | undefined, success = false, state: unknown;
    try {
      if (plan.state.kind === "reuse") {
        fence = fenceState(plan.spec.state_dir, journal, receipt.plan_sha256);
        assertQuiescent([plan.previous.installation, plan.spec.installation], [...plan.spec.previous_state_dirs, plan.spec.state_dir]);
        if (fs.existsSync(path.join(plan.spec.state_dir, "state.sqlite"))) {
          fence.lock();
          fence.closeDatabase();
        }
        state = restoreStateSnapshot(plan.spec.state_dir, journal, receipt.plan_sha256, cipher);
      }
      if (checksum(current) !== plan.before_sha256) atomicWrite(plan.spec.host_config, record.before);
      atomicWrite(completed, completion, false);
      success = true;
      return { rolled_back: true, restart_required: true, state, state_preserved: plan.spec.state_dir, external_effects_reverted: false };
    } finally { fence?.finish(success); }
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
