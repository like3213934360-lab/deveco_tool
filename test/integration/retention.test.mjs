import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { connect } from "../support/mcp.mjs";

test("MCP expires media and exports at their deadline without jobs, and remains responsive during cleanup", async (t) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-retention-"));
  const dir = path.join(state, "artifacts");
  fs.mkdirSync(dir);
  const db = new DatabaseSync(path.join(state, "state.db"));
  // Persistent output from an earlier session; startup supplies the remaining real schema.
  db.exec(`CREATE TABLE artifacts(id TEXT PRIMARY KEY,job_id TEXT,file TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE exports(path TEXT PRIMARY KEY,created INTEGER NOT NULL);`);
  const put = db.prepare("INSERT INTO artifacts VALUES(?,NULL,?,'video/mp4',1,?)");
  const expired = [];
  db.exec("BEGIN");
  for (let i = 0; i < 512; i++) {
    const file = path.join(dir, `old-${i}.mp4`);
    fs.writeFileSync(file, "x");
    put.run(`old-${i}`, file, 0);
    expired.push(file);
  }
  db.exec("COMMIT");
  const discardedPack = path.join(state, "kb", "unused-pack");
  fs.mkdirSync(discardedPack, { recursive: true });
  for (let i = 0; i < 512; i++) fs.writeFileSync(path.join(discardedPack, `doc-${i}`), "x");
  const deadline = Date.now() + 2500;
  const media = path.join(dir, "due.mp4"), copy = path.join(state, "copy.mp4");
  const orphan = path.join(dir, "unfinished.mp4"), fresh = path.join(dir, "fresh.mp4");
  const user = path.join(state, "user.mp4");
  for (const file of [media, copy, orphan, fresh, user]) fs.writeFileSync(file, "x");
  put.run("due", media, deadline - 86400000);
  put.run("fresh", fresh, Date.now());
  db.prepare("INSERT INTO exports VALUES(?,?)").run(copy, deadline - 86400000);
  fs.utimesSync(orphan, (deadline - 86400000) / 1000, (deadline - 86400000) / 1000);
  db.close();
  const client = connect({ DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") });
  try {
    await client.initialize();
    assert.ok(Date.now() < deadline, "Fixture must still be unexpired when the server starts");
    assert.ok(fs.existsSync(media));
    assert.ok(fs.existsSync(copy));
    const latencies = [];
    let callsDuringCleanup = 0, callsDuringPackCleanup = 0;
    while (Date.now() < deadline + 5000) {
      const deleting = expired.some((file) => fs.existsSync(file));
      const start = performance.now();
      const response = await client.request("ping", {}, 1000);
      latencies.push(performance.now() - start);
      assert.deepEqual(response.result, {});
      if (deleting) callsDuringCleanup++;
      if (!deleting && fs.existsSync(discardedPack)) callsDuringPackCleanup++;
      if (!deleting && [media, copy, orphan, discardedPack].every((file) => !fs.existsSync(file))) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(callsDuringCleanup > 0, "Protocol requests must run while the backlog is being removed");
    assert.ok(callsDuringPackCleanup > 0, "Protocol requests must also run during recursive package cleanup");
    assert.equal(fs.existsSync(discardedPack), false);
    assert.deepEqual(expired.filter((file) => fs.existsSync(file)), []);
    assert.deepEqual([media, copy, orphan].map((file) => fs.existsSync(file)), [false, false, false]);
    assert.ok(fs.existsSync(fresh));
    assert.ok(fs.existsSync(user));
    assert.doesNotMatch(client.stderr, /\[retention\]/);
    t.diagnostic(`512 expired files and 512 package files; ${callsDuringCleanup}/${callsDuringPackCleanup} pings during cleanup; max ping ${Math.max(...latencies).toFixed(1)} ms; expiry observed ${Date.now() - deadline} ms after deadline`);
  } finally {
    await client.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test("MCP logs a bounded failure summary, never retries the file and preserves the exclusion after restart", async (t) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-retention-failure-"));
  const blocked = path.join(state, "export-0.mp4");
  const db = new DatabaseSync(path.join(state, "state.db"));
  db.exec("CREATE TABLE exports(path TEXT PRIMARY KEY,created INTEGER NOT NULL)");
  db.exec("BEGIN");
  for (let i = 0; i < 70; i++) {
    const file = path.join(state, `export-${i}.mp4`);
    fs.mkdirSync(file);
    fs.writeFileSync(path.join(file, "keep"), "user content");
    db.prepare("INSERT INTO exports VALUES(?,0)").run(file);
  }
  const healthy = path.join(state, "healthy.mp4");
  fs.writeFileSync(healthy, "expiring normally");
  db.prepare("INSERT INTO exports VALUES(?,?)").run(healthy, Date.now() - 86400000 + 1500);
  db.exec("COMMIT");
  db.close();
  const env = { DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") };
  let client = connect(env);
  try {
    await client.initialize();
    const started = Date.now();
    while (!client.stderr.includes("[retention]") && Date.now() - started < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(client.stderr, /70 deletion\(s\) failed.*Automatic retries disabled, including after restart/);
    assert.equal(fs.readFileSync(path.join(blocked, "keep"), "utf8"), "user content");
    fs.rmSync(blocked, { recursive: true }); // Correct the obstruction without generating a new MCP export.
    fs.writeFileSync(blocked, "retained for manual cleanup");
    while (Date.now() - started < 31000) {
      assert.deepEqual((await client.request("ping", {}, 1000)).result, {});
      assert.ok(fs.existsSync(blocked), "A failed file must not be retried, even after its permissions/obstruction change");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(fs.existsSync(healthy), false, "Failures must not block other expiry deadlines");
    const lines = client.stderr.split("\n").filter((line) => line.startsWith("[retention]"));
    assert.equal(lines.length, 1);
    assert.ok(lines[0].length < 600, "One bounded summary, not one log per file or per poll");
    await client.close();
    client = connect(env);
    await client.initialize();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(fs.readFileSync(blocked, "utf8"), "retained for manual cleanup");
    assert.doesNotMatch(client.stderr, /\[retention\]/, "Restart must not retry or relog the failed files");
    const check = new DatabaseSync(path.join(state, "state.db"), { readOnly: true });
    try { assert.equal(check.prepare("SELECT COUNT(*) AS n FROM retention_failures").get().n, 70); }
    finally { check.close(); }
    t.diagnostic("70 failed files: one log, no retry after 31 seconds or process restart; healthy export expired");
  } finally {
    await client.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test("an inaccessible cleanup directory stops the cleaner once until a repaired process restarts", async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-retention-stopped-"));
  const dir = path.join(state, "artifacts"), copy = path.join(state, "copy.mp4");
  fs.writeFileSync(dir, "directory obstruction");
  fs.writeFileSync(copy, "await manual repair");
  const db = new DatabaseSync(path.join(state, "state.db"));
  db.exec("CREATE TABLE exports(path TEXT PRIMARY KEY,created INTEGER NOT NULL)");
  const deadline = Date.now() + 1500;
  db.prepare("INSERT INTO exports VALUES(?,?)").run(copy, deadline - 86400000);
  db.close();
  const env = { DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") };
  let client = connect(env);
  try {
    await client.initialize();
    const started = Date.now();
    while (!client.stderr.includes("[retention]") && Date.now() - started < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(client.stderr, /Cleanup stopped:.*No automatic retry; fix the error and restart MCP/);
    assert.ok(Date.now() < deadline, "The directory error must precede the export deadline");
    fs.unlinkSync(dir);
    fs.mkdirSync(dir);
    while (Date.now() < deadline + 500) {
      assert.deepEqual((await client.request("ping", {}, 1000)).result, {});
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(fs.existsSync(copy), "Fixing the directory must not silently restart a stopped cleaner");
    assert.equal(client.stderr.split("\n").filter((line) => line.startsWith("[retention]")).length, 1);
    await client.close();
    client = connect(env);
    await client.initialize();
    const restarted = Date.now();
    while (fs.existsSync(copy) && Date.now() - restarted < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(fs.existsSync(copy), false, "A repaired process restart restores normal expiry");
    assert.doesNotMatch(client.stderr, /\[retention\]/);
  } finally {
    await client.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
});
