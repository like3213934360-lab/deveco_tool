import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { parse } from "smol-toml";
import { release } from "../src/core/config.js";
import { atomicWrite, fileDigest } from "../src/core/files.js";
import { PayloadCipher } from "../src/core/crypto.js";
import { StateStore } from "../src/core/store.js";
import { inspectStateSchema, stateMaintenancePath } from "../src/core/state-schema.js";
import { AuthService } from "../src/services/auth.js";
import { ProcessService } from "../src/core/process.js";
import { planUpgrade, applyUpgrade, rollbackUpgrade } from "../src/maintenance/upgrade.js";
import { patchHost } from "../src/maintenance/host-config.js";
import { assertQuiescent } from "../src/maintenance/quiescence.js";
import { fenceState } from "../src/maintenance/state-snapshot.js";

async function fixture(legacy = true) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deveco-compatible-")));
  const old = path.join(root, "old"), installation = path.join(root, "next"), state = path.join(root, "状态 with space");
  for (const directory of [old, installation]) {
    atomicWrite(path.join(directory, "package.json"), JSON.stringify({ version: release, bin: { "deveco-tool": "dist/src/cli.js" } }));
    atomicWrite(path.join(directory, "package-lock.json"), "{}");
    atomicWrite(path.join(directory, "node_modules/example/index.js"), "export default 1;\n");
    atomicWrite(path.join(directory, "dist/src/cli.js"), "// Fixture identity only; never executed.\n");
  }
  const store = new StateStore(state), auth = new AuthService(store, new ProcessService());
  const run = store.create("fixture-history", { private_value: "历史输入🙂" }).run;
  const artifact = store.artifact(run.id, "历史制品🙂");
  store.update(run.id, "succeeded", { artifact_id: artifact.artifact_id });
  const credentialCipher = new PayloadCipher(path.join(state, "credential.key"));
  for (const [provider, expires] of [["developer", Date.now() / 1000 + 3600], ["codegenie", Date.now() / 1000 - 3600]] as const) {
    store.db.prepare("UPDATE credentials SET ciphertext=? WHERE provider=?").run(credentialCipher.sealBytes(provider, Buffer.from(JSON.stringify({ jwt: "fixture-sensitive-jwt", access: "fixture-sensitive-access", saved: Date.now(), userId: "fixture-user", userName: "Fixture", expires }))), provider);
  }
  credentialCipher.close(); await auth.close(); store.close();
  if (legacy) {
    const db = new Database(path.join(state, "state.sqlite"));
    db.exec("DROP TABLE state_schema; DROP TABLE runtime_instances; DROP TABLE ui_log_sessions; DROP TABLE ui_log_chunks");
    db.close();
  }
  const configuration = path.join(state, "configuration.json");
  atomicWrite(configuration, JSON.stringify({ max_runs: 333, retention_days: 30, max_bytes: 536870912, default_project: path.join(root, "user-project") }));
  const host = path.join(root, "host.json"), original = JSON.stringify({ mcpServers: {
    "deveco-tool": { command: "prior-node", args: [path.join(old, "dist/src/cli.js")], env: { USER_SETTING: "kept", DEVECO_CONFIG: configuration, DEVECO_STATE_DIR: state }, cwd: root, env_vars: ["LOCAL_SECRET"], experimental_environment: { USER_VALUE: "kept" }, enabled: false },
    unrelated: { command: "keep", env: { PRIVATE: "fixture-other-secret" } },
  } }, null, 2) + "\n";
  atomicWrite(host, original);
  const spec = { host_config: host, host_format: "mcp-json", installation, node: fs.realpathSync.native(process.execPath), state_dir: state };
  return { root, old, installation, state, run, artifact, host, original, configuration, spec, journal: path.join(root, "journal"), close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("compatible reuse preserves encrypted authentication, expiry, history, artifact paths and configuration across restart and rollback", async () => {
  const f = await fixture();
  try {
    const keyHash = fileDigest(path.join(f.state, "credential.key"));
    const plan = planUpgrade(f.spec);
    assert.equal(plan.state.kind, "reuse");
    if (plan.state.kind !== "reuse") throw new Error("reuse expected");
    assert.equal(plan.state.revision, 1);
    assert.equal(plan.spec.configuration.max_runs, 333);
    assert.match(applyUpgrade(plan, f.journal, true).authentication, /Encrypted credentials preserved/);
    assert.equal(fileDigest(path.join(f.state, "credential.key")), keyHash);
    assert.equal(JSON.parse(fs.readFileSync(f.host, "utf8")).mcpServers["deveco-tool"].env.USER_SETTING, "kept");
    let laterRun: string | undefined;
    for (let restart = 0; restart < 2; restart++) {
      const store = new StateStore(f.state), auth = new AuthService(store, new ProcessService());
      try {
        assert.equal(inspectStateSchema(store.db).revision, 2);
        assert.equal(auth.status("developer").logged_in, true);
        assert.equal(auth.status("codegenie").logged_in, false);
        assert.deepEqual(JSON.parse(store.get(f.run.id).input), { private_value: "历史输入🙂" });
        assert.equal(Buffer.from(store.readArtifact(f.artifact.artifact_id).data, "base64").toString(), "历史制品🙂");
        if (!restart) { laterRun = store.create("after-upgrade", {}).run.id; store.update(laterRun, "succeeded"); }
      } finally { await auth.close(); store.close(); }
    }
    assert.equal(applyUpgrade(plan, f.journal, true).resumed, true);
    const rolled = rollbackUpgrade(f.journal, true);
    assert.equal(rolled.rolled_back, true);
    assert.equal(fs.readFileSync(f.host, "utf8"), f.original);
    const original = new Database(path.join(f.state, "state.sqlite"));
    try {
      assert.equal(inspectStateSchema(original).revision, 1);
      assert.equal(original.prepare("SELECT id FROM runs WHERE id=?").get(laterRun), undefined);
    } finally { original.close(); }
    const retained = (rolled as { state: { post_upgrade_state_retained: string } }).state.post_upgrade_state_retained;
    const after = new Database(path.join(retained, "state.sqlite"), { readonly: true });
    try { assert.ok(after.prepare("SELECT id FROM runs WHERE id=?").get(laterRun)); } finally { after.close(); }
    assert.equal(rollbackUpgrade(f.journal, true).rolled_back, true);
    assert.throws(() => applyUpgrade(plan, f.journal, true), { code: "UPGRADE_ALREADY_ROLLED_BACK" });
    for (const name of fs.readdirSync(path.join(f.journal, "state-before"))) {
      const content = fs.readFileSync(path.join(f.journal, "state-before", name));
      assert.equal(content.includes(Buffer.from("fixture-sensitive")), false);
      assert.equal(content.includes(Buffer.from("历史输入")), false);
    }
  } finally { f.close(); }
});

test("live same-state instances and background log sessions block upgrade before host mutation", async () => {
  const f = await fixture(false);
  let store: StateStore | undefined;
  try {
    const plan = planUpgrade(f.spec);
    store = new StateStore(f.state);
    assert.throws(() => applyUpgrade(plan, f.journal, true), { code: "UPGRADE_SESSIONS_ACTIVE" });
    assert.equal(fs.readFileSync(f.host, "utf8"), f.original);
    store.db.prepare("INSERT INTO ui_log_sessions VALUES (?,?,?,?,?)").run(f.run.id, store.owner, "running", "{}", Date.now());
    store.close(); store = undefined;
    assert.throws(() => assertQuiescent([], [f.state]), { code: "UPGRADE_SESSIONS_ACTIVE" });
  } finally { store?.close(); f.close(); }
});

test("the encrypted SQLite snapshot includes committed pages that have not been checkpointed out of WAL", async () => {
  const f = await fixture();
  let writer: Database.Database | undefined;
  try {
    const database = path.join(f.state, "state.sqlite"), before = fileDigest(database);
    writer = new Database(database); writer.pragma("wal_autocheckpoint = 0");
    writer.prepare("INSERT INTO events(run_id,kind,data,created) VALUES (?,?,?,?)").run(f.run.id, "wal-only", "fixture-committed", Date.now());
    assert.ok(fs.statSync(database + "-wal").size > 0);
    assert.equal(fileDigest(database), before);
    const plan = planUpgrade(f.spec); applyUpgrade(plan, f.journal, true);
    writer.close(); writer = undefined;
    rollbackUpgrade(f.journal, true);
    const restored = new Database(database, { readonly: true });
    try { assert.equal((restored.prepare("SELECT data FROM events WHERE kind='wal-only'").get() as { data: string }).data, "fixture-committed"); }
    finally { restored.close(); }
  } finally { writer?.close(); f.close(); }
});

test("same protocol does not admit unknown SQL contracts, new schema revisions or a different protocol", async () => {
  for (const [sql, code] of [["ALTER TABLE runs ADD COLUMN unknown TEXT", "STATE_SCHEMA_UNSUPPORTED"], ["UPDATE state_schema SET revision=99", "STATE_SCHEMA_UNSUPPORTED"], ["UPDATE runtime_meta SET version='native-unknown'", "STATE_VERSION_MISMATCH"], ["CREATE TRIGGER unknown AFTER INSERT ON runs BEGIN SELECT 1; END", "STATE_SCHEMA_UNSUPPORTED"]]) {
    const f = await fixture(false);
    try {
      const db = new Database(path.join(f.state, "state.sqlite")); db.exec(sql!); db.close();
      assert.throws(() => planUpgrade(f.spec), { code });
      assert.throws(() => new StateStore(f.state), { code });
      assert.equal(fs.readFileSync(f.host, "utf8"), f.original);
    } finally { f.close(); }
  }
});

test("interruption before the host switch keeps a durable fence and reuses the original coherent encrypted snapshot", async (t) => {
  const f = await fixture();
  try {
    const plan = planUpgrade(f.spec), rename = fs.renameSync;
    const mocked = t.mock.method(fs, "renameSync", (old: fs.PathLike, next: fs.PathLike) => {
      if (String(next) === f.host) throw new Error("fixture switch interruption");
      return rename(old, next);
    });
    assert.throws(() => applyUpgrade(plan, f.journal, true), /fixture switch interruption/);
    mocked.mock.restore();
    assert.equal(fs.readFileSync(f.host, "utf8"), f.original);
    assert.throws(() => new StateStore(f.state), { code: "STATE_MAINTENANCE_ACTIVE" });
    const backupHash = fileDigest(path.join(f.journal, "state-before", "manifest.encrypted"));
    assert.equal(applyUpgrade(plan, f.journal, true).resumed, true);
    assert.equal(fileDigest(path.join(f.journal, "state-before", "manifest.encrypted")), backupHash);
    assert.equal(fs.existsSync(stateMaintenancePath(f.state)), false);
    assert.equal(rollbackUpgrade(f.journal, true).rolled_back, true);
  } finally { t.mock.restoreAll(); f.close(); }
});

test("rollback resumes after the current state was retained but before the old state directory was published", async (t) => {
  const f = await fixture();
  try {
    const plan = planUpgrade(f.spec); applyUpgrade(plan, f.journal, true);
    const rename = fs.renameSync;
    const mocked = t.mock.method(fs, "renameSync", (old: fs.PathLike, next: fs.PathLike) => {
      if (String(old).includes(".restore-") && String(next) === f.state) throw new Error("fixture restore interruption");
      return rename(old, next);
    });
    assert.throws(() => rollbackUpgrade(f.journal, true), /fixture restore interruption/);
    mocked.mock.restore();
    assert.equal(fs.existsSync(f.state), false);
    assert.throws(() => new StateStore(f.state), { code: "STATE_MAINTENANCE_ACTIVE" });
    assert.equal(rollbackUpgrade(f.journal, true).rolled_back, true);
    assert.equal(fs.readFileSync(f.host, "utf8"), f.original);
    const db = new Database(path.join(f.state, "state.sqlite"));
    try { assert.equal(inspectStateSchema(db).revision, 1); } finally { db.close(); }
  } finally { t.mock.restoreAll(); f.close(); }
});

test("tampered state backup cannot restore or switch the host back", async () => {
  const f = await fixture();
  try {
    const plan = planUpgrade(f.spec); applyUpgrade(plan, f.journal, true);
    const beforeHost = fs.readFileSync(f.host, "utf8"), file = path.join(f.journal, "state-before", "0.bin");
    const bytes = fs.readFileSync(file); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; fs.writeFileSync(file, bytes);
    assert.throws(() => rollbackUpgrade(f.journal, true));
    assert.equal(fs.readFileSync(f.host, "utf8"), beforeHost);
    assert.equal(fs.existsSync(f.state), true);
    assert.equal(fs.existsSync(stateMaintenancePath(f.state)), true);
  } finally { f.close(); }
});

test("rollback resumes fence removal after its completion receipt without restoring twice", async () => {
  const f = await fixture();
  try {
    const plan = planUpgrade(f.spec); applyUpgrade(plan, f.journal, true);
    rollbackUpgrade(f.journal, true);
    // Reproduce durable state after a crash between completion and fence removal.
    const fence = fenceState(f.state, f.journal, plan.sha256); fence.finish(false);
    const laterFile = path.join(f.state, "later-owned-evidence.txt");
    atomicWrite(laterFile, "preserve after completed rollback");
    assert.throws(() => new StateStore(f.state), { code: "STATE_MAINTENANCE_ACTIVE" });
    assert.equal(rollbackUpgrade(f.journal, true).resumed, true);
    assert.equal(fs.existsSync(stateMaintenancePath(f.state)), false);
    assert.equal(fs.readFileSync(laterFile, "utf8"), "preserve after completed rollback");
    const store = new StateStore(f.state); store.close();
  } finally { f.close(); }
});

test("a fresh destination cannot silently discard an available authentication/history state", async () => {
  const f = await fixture();
  try {
    const spec = { ...f.spec, state_dir: path.join(f.root, "fresh") };
    assert.throws(() => planUpgrade(spec), { code: "UPGRADE_STATE_DECISION_REQUIRED" });
    assert.equal(planUpgrade({ ...spec, state_strategy: "fresh" }).state.kind, "fresh");
    assert.throws(() => planUpgrade({ ...f.spec, source_state_dir: path.join(f.root, "wrong") }), { code: "UPGRADE_STATE_SOURCE_MISMATCH" });
  } finally { f.close(); }
});

test("a maintenance fence excludes concurrent instances and competing maintenance journals", async () => {
  const f = await fixture(false);
  try {
    fs.mkdirSync(f.journal);
    const fence = fenceState(f.state, f.journal, "fixture-identity");
    try {
      fence.lock();
      assert.throws(() => new StateStore(f.state), { code: "STATE_MAINTENANCE_ACTIVE" });
      assert.throws(() => fenceState(f.state, f.journal, "fixture-identity"), { code: "UPGRADE_SESSIONS_ACTIVE" });
      assert.throws(() => fenceState(f.state, f.journal, "different"), { code: "UPGRADE_FENCE_CONFLICT" });
    } finally { fence.finish(true); }
    const store = new StateStore(f.state); store.close();
  } finally { f.close(); }
});

test("TOML inline environment, quoted tables, multiline arguments and unrelated typed values survive patching", () => {
  const original = `title = "User settings"\nlarge = 9223372036854775807\nfloat = 1.0\n[mcp_servers."deveco-tool"]\ncommand = "old"\nargs = [\n "/old/dist/src/cli.js",\n "mcp",\n]\nenv = { USER_SECRET = "fixture-private-secret", DEVECO_STATE_DIR = "/old/state" }\nenv_vars = ["PASSTHROUGH"]\ncwd = "/user/project"\nenabled = false\n[mcp_servers.other]\ncommand = "keep"\ntimeout = 90\n`;
  const result = patchHost(original, { host_format: "codex-toml", server: "deveco-tool", node: "/new/node", installation: "/new/install", state_dir: "/user/state" });
  const before = parse(original, { integersAsBigInt: true }), after = parse(result, { integersAsBigInt: true });
  assert.equal(after.large, before.large); assert.equal(after.float, before.float);
  const oldServers = before.mcp_servers as Record<string, unknown>, nextServers = after.mcp_servers as Record<string, unknown>;
  assert.deepEqual(nextServers.other, oldServers.other);
  const entry = nextServers["deveco-tool"] as Record<string, unknown>;
  assert.equal((entry.env as Record<string, unknown>).USER_SECRET, "fixture-private-secret");
  assert.deepEqual(entry.env_vars, ["PASSTHROUGH"]); assert.equal(entry.cwd, "/user/project"); assert.equal(entry.enabled, false);
});
