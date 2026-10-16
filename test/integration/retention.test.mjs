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
    let callsDuringCleanup = 0;
    while (Date.now() < deadline + 5000) {
      const deleting = expired.some((file) => fs.existsSync(file));
      const start = performance.now();
      const response = await client.request("ping", {}, 1000);
      latencies.push(performance.now() - start);
      assert.deepEqual(response.result, {});
      if (deleting) callsDuringCleanup++;
      if (!deleting && [media, copy, orphan].every((file) => !fs.existsSync(file))) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(callsDuringCleanup > 0, "Protocol requests must run while the backlog is being removed");
    assert.deepEqual(expired.filter((file) => fs.existsSync(file)), []);
    assert.deepEqual([media, copy, orphan].map((file) => fs.existsSync(file)), [false, false, false]);
    assert.ok(fs.existsSync(fresh));
    assert.ok(fs.existsSync(user));
    assert.doesNotMatch(client.stderr, /\[retention\]/);
    t.diagnostic(`512 expired files; ${callsDuringCleanup} pings during cleanup; max ping ${Math.max(...latencies).toFixed(1)} ms; expiry observed ${Date.now() - deadline} ms after deadline`);
  } finally {
    await client.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test("MCP reports deletion failure and automatically retries after the filesystem obstruction is removed", async (t) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-retention-retry-"));
  const blocked = path.join(state, "export.mp4");
  fs.mkdirSync(blocked);
  fs.writeFileSync(path.join(blocked, "keep"), "user content");
  const db = new DatabaseSync(path.join(state, "state.db"));
  db.exec("CREATE TABLE exports(path TEXT PRIMARY KEY,created INTEGER NOT NULL)");
  db.prepare("INSERT INTO exports VALUES(?,0)").run(blocked);
  db.close();
  const client = connect({ DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") });
  try {
    await client.initialize();
    const started = Date.now();
    while (!client.stderr.includes("[retention]") && Date.now() - started < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(client.stderr, /Cannot remove expired output.*record is kept.*retry in 30s/);
    assert.equal(fs.readFileSync(path.join(blocked, "keep"), "utf8"), "user content");
    fs.rmSync(blocked, { recursive: true }); // Resolve only the obstruction created by this test.
    fs.writeFileSync(blocked, "previous export");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(fs.existsSync(blocked), "The failure must back off, not spin on an expired row");
    while (fs.existsSync(blocked) && Date.now() - started < 35000) {
      assert.deepEqual((await client.request("ping", {}, 1000)).result, {});
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(fs.existsSync(blocked), false);
    assert.equal(client.stderr.match(/\[retention\]/g)?.length, 1, "No repeated failure loop");
    t.diagnostic(`Automatic retry removed the export after ${Date.now() - started} ms`);
  } finally {
    await client.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
});
