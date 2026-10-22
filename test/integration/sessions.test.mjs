import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { temporaryDirectory } from "../support/workspace.mjs";

const work = temporaryDirectory("deveco-sessions-"), bundle = path.join(work, "sessions.mjs");
await build({ entryPoints: [path.resolve("src/core/sessions.ts")], outfile: bundle, bundle: true,
  platform: "node", format: "esm", packages: "external", logLevel: "error" });
const { SessionPool } = await import(pathToFileURL(bundle).href);
after(() => fs.rmSync(work, { recursive: true, force: true }));

test("concurrent callers share creation and a busy pool has a hard resource bound", async () => {
  const pool = new SessionPool(1), resources = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const create = async () => {
    const resource = { closed: false, close() { this.closed = true; } };
    resources.push(resource); return resource;
  };
  const uses = Array.from({ length: 8 }, () => pool.use("same", create, async (value) => { await gate; return value; }));
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resources.length, 1, "one language-server process per key");
    await assert.rejects(pool.use("other", create, async () => {}), { code: "RESOURCE_BUSY" });
    assert.equal(resources.length, 1);
  } finally { release(); await Promise.allSettled(uses); await pool.closeAll(); }
  assert.ok(resources.every((r) => r.closed), "no superseded process leaks");
});

test("failed creation cannot evict a replacement, and idle eviction closes before replacement starts", async () => {
  const pool = new SessionPool(1), events = [];
  try {
    await assert.rejects(pool.use("bad", async () => { throw new Error("startup failed"); }, async () => {}), /startup failed/);
    await pool.use("one", async () => ({ async close() { await new Promise((r) => setTimeout(r, 20)); events.push("closed"); } }), async () => {});
    await pool.use("two", async () => { events.push("created"); return { close() {} }; }, async () => {});
    assert.deepEqual(events, ["closed", "created"]);
  } finally { await pool.closeAll(); }
});
