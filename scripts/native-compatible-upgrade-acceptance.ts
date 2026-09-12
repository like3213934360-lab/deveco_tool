import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { z } from "zod";
import { packageRoot } from "../src/core/config.js";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { PayloadCipher } from "../src/core/crypto.js";
import { errorResult } from "../src/core/errors.js";
import { ProcessService } from "../src/core/process.js";
import { installationIdentity } from "../src/maintenance/installation.js";
import { inspectStateSchema } from "../src/core/state-schema.js";
import { assertQuiescent } from "../src/maintenance/quiescence.js";
import { evidenceIdentity } from "./lib/evidence.js";
import { finishAcceptance } from "./lib/acceptance-report.js";
import { AcceptanceMcp } from "./lib/mcp-acceptance-client.js";

const [root, previousInstallation, credentialInputs] = z.tuple([z.string().min(1), z.string().min(1), z.string().min(1).optional()]).parse(process.argv.slice(2));
assert.ok(path.isAbsolute(root) && path.isAbsolute(previousInstallation));
const credentialStates = credentialInputs
  ? z.strictObject({ developer: z.string().min(1), codegenie: z.string().min(1) }).parse(JSON.parse(fs.readFileSync(credentialInputs, "utf8")))
  : undefined;
assert.equal(fs.existsSync(root), false, "Use a new isolated acceptance directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const tested = evidenceIdentity(), results: Record<string, unknown> = {};
const file = path.join(root, "evidence.json"), old = path.join(root, "previous"), next = path.join(root, "candidate");
const state = path.join(root, "state"), configuration = path.join(root, "config.json"), host = path.join(root, "host.json"), planFile = path.join(root, "plan.json"), journal = path.join(root, "journal");
const processes = new ProcessService();
let client: AcceptanceMcp | undefined, completed = false, closed = false;
const save = () => atomicWrite(file, JSON.stringify({ results, scope: "Owned isolated copies of the real previous installation and compiled candidate. Public MCP creates a crash-diagnosis workflow and reads history/artifacts before upgrade, after upgrade/restart, and after rollback. " + (credentialStates ? "Authentication imports existing authenticated provider payloads from explicitly selected quiescent states, decrypts only in memory and re-encrypts under the owned installation key. Both providers must retain identity and perform real read-only cloud queries at every stage. Original login states remain unchanged; this does not claim a browser login on the previous installation or an expired-token failure. " : "Authentication uses synthetic encrypted valid/expired fixtures; no user credentials or real cloud login are asserted. ") + "Not final release-package acceptance." }, null, 2));
const credentialUsers = new Map<string, string>();
function userDigest(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function copyCredential(provider: "developer" | "codegenie", source: string, destination: Database.Database, cipher: PayloadCipher) {
  assert.ok(path.isAbsolute(source));
  const sourceRoot = fs.realpathSync.native(source);
  assert.notEqual(sourceRoot, state);
  assertQuiescent([], [sourceRoot]);
  const databaseFile = path.join(sourceRoot, "state.sqlite"), keyFile = path.join(sourceRoot, "credential.key");
  // Do not let PayloadCipher create a missing key in the source login state.
  for (const name of [databaseFile, keyFile]) assert.ok(fs.lstatSync(name).isFile() && !fs.lstatSync(name).isSymbolicLink());
  const originals = [databaseFile, keyFile, `${databaseFile}-wal`].filter(name => fs.existsSync(name)).map(name => ({ name, sha256: fileDigest(name) }));
  const sourceDb = new Database(databaseFile, { readonly: true, fileMustExist: true }), sourceCipher = new PayloadCipher(keyFile);
  try {
    const row = z.object({ ciphertext: z.instanceof(Buffer) }).parse(sourceDb.prepare("SELECT ciphertext FROM credentials WHERE provider=?").get(provider));
    const plain = sourceCipher.openBytes(provider, row.ciphertext);
    try {
      const metadata = z.object({ userId: z.string().min(1), expires: z.number().positive(), saved: z.number().positive() }).parse(JSON.parse(plain.toString("utf8")));
      assert.ok(metadata.expires * 1000 > Date.now(), "Real credentials must still be valid; never rewrite expiry to pass acceptance");
      credentialUsers.set(provider, userDigest(metadata.userId));
      assert.equal(destination.prepare("UPDATE credentials SET ciphertext=? WHERE provider=?").run(cipher.sealBytes(provider, plain), provider).changes, 1);
      results[`credential_import:${provider}`] = { source_unchanged: true, user_sha256: userDigest(metadata.userId), saved_at: metadata.saved, expires_at: metadata.expires, payload_modified: false };
    } finally { plain.fill(0); }
  } finally { sourceCipher.close(); sourceDb.close(); }
  assertQuiescent([], [sourceRoot]);
  for (const original of originals) assert.equal(fileDigest(original.name), original.sha256, "Original login state changed during credential capture");
}
async function authentication() {
  assert.ok(client);
  if (!credentialStates) return {
    valid: z.object({ logged_in: z.literal(true), user_id: z.literal("owned-upgrade-fixture") }).parse(await client.call("harmony_auth", { action: "status", provider: "developer" })),
    expired: z.object({ logged_in: z.literal(false) }).parse(await client.call("harmony_auth", { action: "status", provider: "codegenie" })),
  };
  const providers: Record<string, unknown> = {};
  for (const provider of ["developer", "codegenie"] as const) {
    const status = z.object({ logged_in: z.literal(true), user_id: z.string().min(1) }).parse(await client.call("harmony_auth", { action: "status", provider }));
    assert.equal(userDigest(status.user_id), credentialUsers.get(provider));
    providers[provider] = { logged_in: true, user_sha256: userDigest(status.user_id) };
  }
  const teams = z.object({ teams: z.array(z.object({ id: z.string().min(1) })).min(1) }).parse(await client.call("harmony_auth", { action: "teams", provider: "developer" }));
  const knowledge = z.object({ source: z.literal("cloud"), content: z.string().min(1) }).parse(await client.call("harmony_knowledge", { action: "search", source: "cloud", query: "ArkTS 中如何声明 const 变量？" }));
  return { providers, real_cloud_queries: { team_count: teams.teams.length, knowledge_characters: knowledge.content.length, knowledge_sha256: userDigest(knowledge.content) } };
}
function copyInstallation(source: string, destination: string) {
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const name of ["dist/src", "resources", "provenance", "skills", "package.json", "package-lock.json", "node_modules"])
    if (fs.existsSync(path.join(source, name))) fs.cpSync(path.join(source, name), path.join(destination, name), { recursive: true, verbatimSymlinks: true });
  return installationIdentity(destination);
}
async function connect(installation: string, config = configuration) {
  client = new AcceptanceMcp(root, "native-compatible-upgrade", { installation, state_dir: state, configuration_file: config });
  await client.connect();
}
async function disconnect() { await client?.close(); client = undefined; }
async function command(args: string[], expectedFailure?: string) {
  const result = await processes.run({ executable: process.execPath, args: [path.join(next, "dist/src/cli.js"), "maintenance", ...args], cwd: next, sensitive: true }, { allowFailure: true, timeoutMs: 60000, limitBytes: 1024 * 1024 });
  if (expectedFailure) {
    assert.notEqual(result.exitCode, 0);
    const failure = z.object({ code: z.literal(expectedFailure) }).parse(JSON.parse(result.stderr.trim()));
    return { rejected: failure.code, exit_code: result.exitCode };
  }
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.truncated, false);
  return JSON.parse(result.stdout) as unknown;
}
async function inspect(key: string, run: string, artifact: string, expectedArtifact: string, schema?: number) {
  assert.ok(client);
  const doctor = await client.call("deveco_doctor", {});
  if (schema !== undefined) z.object({ state_schema_revision: z.literal(schema) }).parse(doctor);
  const auth = await authentication();
  const history = z.object({ status: z.literal("succeeded"), result: z.unknown() }).parse(await client.call("workflow_run", { action: "status", run_id: run }));
  const page = z.object({ data: z.string() }).parse(await client.call("workflow_run", { action: "read_artifact", artifact_id: artifact }));
  assert.equal(page.data, expectedArtifact);
  results[key] = { doctor, ...auth, history, artifact_sha256: crypto.createHash("sha256").update(Buffer.from(page.data, "base64")).digest("hex") }; save();
}
try {
  results.original_installation = installationIdentity(previousInstallation);
  results.previous_installation = copyInstallation(previousInstallation, old);
  results.candidate_installation = copyInstallation(packageRoot, next);
  atomicWrite(configuration, JSON.stringify({ max_runs: 100, retention_days: 30, max_bytes: 536870912 }));
  await connect(old);
  const submitted = z.object({ run_id: z.string() }).parse(await client!.call("workflow_run", { action: "start", workflow: "crash_diagnose", input: { log_text: "Process name: com.deveco.upgrade.fixture\nPid:12345\nReason:TypeError\nError message:owned compatibility fixture\nStacktrace:\n  at fixture (entry/src/main/ets/pages/Index.ets:10:3)\n" }, request_key: "upgrade:history" }));
  results.submitted = submitted; save();
  let result: unknown;
  for (let i = 0; i < 30; i++) {
    const status = z.object({ status: z.string(), result: z.unknown(), error: z.unknown().optional() }).parse(await client!.call("workflow_run", { action: "status", run_id: submitted.run_id, wait_ms: 1000 }));
    if (["running", "queued"].includes(status.status)) continue;
    assert.equal(status.status, "succeeded", JSON.stringify(status.error)); result = status.result; break;
  }
  const artifact = z.object({ collect_evidence: z.object({ artifact: z.object({ artifact_id: z.string() }) }) }).parse(result).collect_evidence.artifact.artifact_id;
  const page = z.object({ data: z.string() }).parse(await client!.call("workflow_run", { action: "read_artifact", artifact_id: artifact }));
  await disconnect();
  // Synthetic credentials are generated only in memory, encrypted in the
  // existing format, and never sent to a remote service or printed.
  const db = new Database(path.join(state, "state.sqlite")), cipher = new PayloadCipher(path.join(state, "credential.key"));
  try {
    results.before_schema = inspectStateSchema(db);
    if (credentialStates) {
      for (const provider of ["developer", "codegenie"] as const) copyCredential(provider, credentialStates[provider], db, cipher);
    } else for (const [provider, expires] of [["developer", Date.now() / 1000 + 3600], ["codegenie", Date.now() / 1000 - 3600]] as const) {
      const secret = crypto.randomBytes(32).toString("hex");
      const plain = Buffer.from(JSON.stringify({ jwt: `synthetic.${secret}`, access: secret, saved: Date.now(), userId: "owned-upgrade-fixture", userName: "Owned fixture", expires }));
      try { db.prepare("UPDATE credentials SET ciphertext=? WHERE provider=?").run(cipher.sealBytes(provider, plain), provider); }
      finally { plain.fill(0); }
    }
  } finally { cipher.close(); db.close(); }
  const keyHash = fileDigest(path.join(state, "credential.key"));
  const flow = path.join(root, "saved-flow.json");
  atomicWrite(flow, JSON.stringify({ version: 1, id: "compatible-flow", name: "Preserved owned flow", app: { bundleName: "com.deveco.upgrade.fixture", module: "entry", ability: "EntryAbility" }, steps: [{ id: "home", action: "key", key: "HOME" }] }));
  const flowHash = fileDigest(flow);
  const original = JSON.stringify({ mcpServers: { "deveco-tool": { command: process.execPath, args: [path.join(old, "dist/src/cli.js")], env: { DEVECO_STATE_DIR: state, DEVECO_CONFIG: configuration, USER_SETTING: "preserved" }, env_vars: ["USER_SETTING"], cwd: root }, unrelated: { command: "unchanged" } } }, null, 2) + "\n";
  atomicWrite(host, original);
  const spec = path.join(root, "spec.json");
  atomicWrite(spec, JSON.stringify({ host_config: host, host_format: "mcp-json", installation: next, node: fs.realpathSync.native(process.execPath), state_dir: state, state_strategy: "reuse", flow_files: [flow] }));
  results.plan = await command(["plan", spec, planFile]); save();
  await connect(old); await inspect("before", submitted.run_id, artifact, page.data);
  results.live_instance_rejection = await command(["apply", planFile, journal, "--sessions-ended"], "UPGRADE_SESSIONS_ACTIVE"); save();
  await disconnect();
  results.applied = await command(["apply", planFile, journal, "--sessions-ended"]); save();
  assert.equal(fileDigest(path.join(state, "credential.key")), keyHash);
  assert.equal(fileDigest(flow), flowHash);
  await connect(next, path.join(state, "configuration.json"));
  await inspect("after_upgrade", submitted.run_id, artifact, page.data, 2);
  results.worker_restart = await client!.call("deveco_restart", {});
  await inspect("after_worker_restart", submitted.run_id, artifact, page.data, 2);
  await disconnect(); await connect(next, path.join(state, "configuration.json"));
  await inspect("after_process_restart", submitted.run_id, artifact, page.data, 2); await disconnect();
  results.rolled_back = await command(["rollback", journal, "--sessions-ended"]); save();
  assert.equal(fs.readFileSync(host, "utf8"), original);
  const restored = new Database(path.join(state, "state.sqlite"), { readonly: true });
  try { results.after_rollback_schema = inspectStateSchema(restored); assert.equal(inspectStateSchema(restored).revision, 1); }
  finally { restored.close(); }
  await connect(old); await inspect("after_rollback", submitted.run_id, artifact, page.data); await disconnect();
  assert.equal(fileDigest(flow), flowHash); assert.equal(fileDigest(path.join(state, "credential.key")), keyHash);
  results.identity_unchanged = installationIdentity(previousInstallation).sha256 === (results.original_installation as { sha256: string }).sha256;
  assert.equal(results.identity_unchanged, true);
  completed = true;
} catch (error) { results.error = errorResult(error); console.error(JSON.stringify(errorResult(error))); }
finally {
  try { await disconnect(); assert.equal(processes.size, 0); closed = true; } catch (error) { results.close_error = errorResult(error); }
  save(); const passed = finishAcceptance(file, tested, completed, closed);
  console.log(`Public compatible upgrade acceptance: ${passed ? "passed" : "failed"}`);
}
