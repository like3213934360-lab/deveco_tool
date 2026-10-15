import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { artifactPath, commitArtifact, saveArtifact } from "../core/artifacts.js";
import { stateDir } from "../core/config.js";
import { atomicWrite, sha256 } from "../core/files.js";
import { invariant, errorResult, ToolError } from "../core/errors.js";
import { shell, sqlite, recvFile, installStamp, appDatabasePath, forceStop } from "./device.js";

const identifier = (value: string, label: string) => invariant(/^[A-Za-z][\w.-]*$/.test(value), "INVALID_INPUT", `Invalid ${label}`);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export async function databases(target: string, bundle: string, module: string | undefined, signal: AbortSignal) {
  identifier(bundle, "bundle"); if (module) identifier(module, "module");
  const root = `/data/app/el2/100/database/${bundle}`;
  const list = async (directory: string) => {
    const result = await shell(target, ["ls", "-1", directory], signal);
    const text = result.stdout + result.stderr;
    invariant(result.code === 0 && !/Permission denied|No such file|not found/i.test(text), "CAPABILITY_UNAVAILABLE", "Cannot enumerate this app database directory", { directory, output: text.slice(0, 1000) }, "Use an installed debuggable app with an initialized database; only user 100 is currently supported");
    return result.stdout.split(/\r?\n/).filter(Boolean);
  };
  const modules = module ? [module] : await list(root), files = [];
  for (const owner of modules) {
    identifier(owner, "module");
    for (const name of await list(`${root}/${owner}/rdb`)) {
      if (/-(wal|shm|journal|dwr|compare)$/.test(name)) continue;
      invariant(/^[\w.-]+$/.test(name), "EVIDENCE_MISSING", "Unexpected database filename", { name });
      files.push({ path: `${root}/${owner}/rdb/${name}`, module: owner, name });
    }
  }
  return { target, bundle, scope: "el2/user100", databases: files };

}

/** Owned fixtures touch only a newly created table. Existing application rows are never restored blindly. */
export async function fixture(target: string, input: { operation: "prepare" | "inspect" | "cleanup"; db?: string; bundle?: string; module?: string; fixture_id?: string; rows?: Record<string, string>[] }, signal: AbortSignal) {
  const directory = path.join(stateDir(), "fixtures");
  if (input.operation === "prepare") {
    invariant(input.db && input.bundle && input.rows?.length, "INVALID_INPUT", "fixture prepare requires db, bundle and rows");
    const db = input.db.startsWith("/") ? input.db : appDatabasePath(input.bundle, input.db, input.module);
    // Read first so a typo cannot create an unrelated empty database.
    await sqlite(target, db, "SELECT name FROM sqlite_master LIMIT 1", {}, signal);
    const id = crypto.randomBytes(12).toString("hex"), table = `_deveco_fixture_${id}`;
    const rows = input.rows.map((r) => JSON.stringify(r));
    const sql = `BEGIN IMMEDIATE; CREATE TABLE ${table}(id INTEGER PRIMARY KEY, value TEXT NOT NULL); ${rows.map((r, i) => `INSERT INTO ${table} VALUES(${i + 1},'${r.replaceAll("'", "''")}');`).join(" ")} COMMIT;`;
    const receipt = { schema: 1, id, target, db, bundle: input.bundle, table, values: rows, expected: sha256(JSON.stringify(rows.map((value, i) => ({ id: i + 1, value })))), rows: rows.length, phase: "intent" };
    atomicWrite(path.join(directory, `${id}.json`), JSON.stringify(receipt));
    await sqlite(target, db, sql, { write: true }, signal);
    atomicWrite(path.join(directory, `${id}.json`), JSON.stringify({ ...receipt, phase: "prepared" }));
    return { fixture_id: id, table, db, rows: rows.length, cleanup: { tool: "device", action: "fixture", operation: "cleanup", target, fixture_id: id } };
  }
  invariant(input.fixture_id && /^[a-f0-9]{24}$/.test(input.fixture_id), "INVALID_INPUT", "fixture_id required");
  const file = path.join(directory, `${input.fixture_id}.json`);
  invariant(fs.existsSync(file), "NOT_FOUND", "Fixture ownership receipt missing");
  const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(receipt.target === target && receipt.phase === "prepared" && receipt.id === input.fixture_id && receipt.table === `_deveco_fixture_${input.fixture_id}` && Array.isArray(receipt.values), "CONFLICT", "Fixture target or lifecycle differs; inspect the intent before recovery", { receipt });
  const result = await sqlite(target, receipt.db, `SELECT id,value FROM ${receipt.table} ORDER BY id`, { limit: 1000 }, signal);
  const rows = "rows" in result ? result.rows as { value: string }[] : undefined;
  const matches = !!rows && sha256(JSON.stringify(rows)) === receipt.expected;
  if (input.operation === "inspect") return { fixture_id: receipt.id, matches, result };
  invariant(matches, "CONFLICT", "Fixture changed after preparation; refusing to delete another writer's changes");
  const conditions = [`(SELECT count(*) FROM ${receipt.table})=${receipt.rows}`, ...receipt.values.map((value: string, i: number) => `(SELECT count(*) FROM ${receipt.table} WHERE id=${i + 1} AND value='${value.replaceAll("'", "''")}')=1`)];
  // Guard and drop share the same SQLite write transaction, excluding app writers between them.
  await sqlite(target, receipt.db, `BEGIN IMMEDIATE; CREATE TEMP TABLE fixture_guard(value); CREATE TEMP TRIGGER fixture_guard_check BEFORE INSERT ON fixture_guard WHEN NOT (${conditions.join(" AND ")}) BEGIN SELECT RAISE(ABORT,'fixture changed'); END; INSERT INTO fixture_guard VALUES(1); DROP TABLE ${receipt.table}; COMMIT;`, { write: true }, signal);
  atomicWrite(file, JSON.stringify({ ...receipt, phase: "cleaned" }));
  return { fixture_id: receipt.id, cleaned: true, preserved_other_tables: true };
}

export async function systemScenario(target: string, input: { operation: "background" | "clear_data" | "grant" | "revoke"; bundle?: string; permission?: string; allow_data_reset?: boolean }, signal: AbortSignal) {
  if (input.operation === "background") {
    const result = await shell(target, ["uitest", "uiInput", "keyEvent", "Home"], signal);
    invariant(result.code === 0 && /^(?:No Error|success)/i.test((result.stdout + result.stderr).trim()), "SCENARIO_FAILED", "Home input failed", { output: result.stdout + result.stderr });
    return { operation: input.operation, scope: "focused-window", command_completed: true, verified_foreground: false, next: "ui windows to inspect the resulting foreground" };
  }
  invariant(input.bundle, "INVALID_INPUT", "bundle required"); identifier(input.bundle, "bundle");
  const before = await installStamp(target, input.bundle, signal);
  invariant(before, "NOT_FOUND", "Application is not installed");
  if (input.operation === "clear_data") {
    invariant(input.allow_data_reset, "DATA_RESET_REQUIRED", "clear_data requires allow_data_reset=true");
    await forceStop(target, input.bundle, signal);
    const result = await shell(target, ["bm", "clean", "-n", input.bundle, "-d"], signal);
    invariant(/success/i.test(result.stdout) && !/fail|error/i.test(result.stdout + result.stderr), "SCENARIO_FAILED", "SDK did not confirm data reset", { output: result.stdout + result.stderr });
    const after = await installStamp(target, input.bundle, signal);
    invariant(after === before, "EVIDENCE_MISSING", "Installation identity changed during data reset", { before, after });
    return { operation: input.operation, data_reset: true, installation_preserved: true, install_stamp: after };
  }
  invariant(input.permission && /^ohos\.permission\.[A-Z_]+$/.test(input.permission), "INVALID_INPUT", "Valid ohos.permission.* permission required");
  const dump = await shell(target, ["bm", "dump", "-n", input.bundle], signal);
  const token = /"accessTokenId"\s*:\s*(\d+)/.exec(dump.stdout)?.[1];
  invariant(token, "CAPABILITY_UNAVAILABLE", "Bundle dump did not expose a permission token");
  const result = await shell(target, ["atm", "perm", input.operation === "grant" ? "-g" : "-c", "-i", token, "-p", input.permission], signal);
  const text = result.stdout + result.stderr;
  invariant(result.code === 0 && /success/i.test(text) && !/fail|error/i.test(text), "CAPABILITY_UNAVAILABLE", "Permission mutation was not confirmed (only debug HAP tokens can be changed)", { output: text });
  return { operation: input.operation, bundle: input.bundle, permission: input.permission, command_confirmed: true, application_effect_verified: false, receipt_artifact: (await saveArtifact(text)).artifact_id };
}

/** Official bounded capture. Returns raw trace evidence, never an invented ArkTS stack mapping. */
export async function captureTrace(target: string, seconds: number, categories: string[], signal: AbortSignal) {
  invariant(categories.length && categories.every((c) => /^[a-z][a-z0-9_]*$/.test(c)), "INVALID_INPUT", "Invalid trace categories");
  const remote = `/data/local/tmp/deveco-trace-${crypto.randomBytes(8).toString("hex")}.txt`, artifact = artifactPath();
  let failure: unknown;
  try {
    const command = await shell(target, ["hitrace", "--text", "-t", String(seconds), "-o", remote, ...categories], signal, (seconds + 20) * 1000);
    invariant(command.code === 0 && !/permission denied|unknown category|error:/i.test(command.stdout + command.stderr), "CAPABILITY_UNAVAILABLE", "hitrace did not complete", { output: command.stdout + command.stderr });
    await recvFile(target, remote, artifact.file, signal);
    const text = fs.readFileSync(artifact.file, "utf8"), events = text.split("\n").filter((l) => /\d+\.\d+:/.test(l)).length;
    return { verdict: events ? "captured" : "inconclusive", events, seconds, categories, target, trace_artifact: (await commitArtifact(artifact.id, artifact.file, "text/plain")).artifact_id, attribution: "raw trace; no component/source mapping without matching debug metadata" };
  } catch (e) { failure = e; throw e; }
  finally {
    if (failure || signal.aborted) await shell(target, ["hitrace", "--trace_finish_nodump"], AbortSignal.timeout(10000));
    const cleanup = await shell(target, ["rm", "-f", quote(remote)], AbortSignal.timeout(10000));
    if (cleanup.code !== 0 || /error|denied|failed/i.test(cleanup.stdout + cleanup.stderr)) throw new ToolError("CLEANUP_FAILED", "Trace file cleanup failed", { remote, original_error: failure ? errorResult(failure) : undefined });
  }
}
