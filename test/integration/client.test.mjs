import { temporaryDirectory } from "../support/workspace.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { connect, waitJob } from "../support/mcp.mjs";

function server(t, body) {
  const directory = temporaryDirectory("deveco-client-"), entry = path.join(directory, "server.mjs");
  fs.writeFileSync(entry, `import {createInterface} from 'node:readline';\nconst lines=createInterface({input:process.stdin});\nlines.on('line',async line=>{const m=JSON.parse(line);${body}});\n`);
  const client = connect({}, entry);
  t.after(async () => { await client.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return client;
}

test("client preserves fragmented Unicode and rejects RPC errors as errors", async (t) => {
  const c = server(t, `if(m.method==='tools/call'){process.stdout.write(JSON.stringify({id:m.id,error:{code:-32603,message:'broken'}})+'\\n');return;}
    const bytes=Buffer.from(JSON.stringify({id:m.id,result:{text:'你好鸿蒙'}})+'\\n');for(const b of bytes)process.stdout.write(Buffer.from([b]));`);
  assert.equal((await c.request("unicode")).result.text, "你好鸿蒙");
  await assert.rejects(c.call("doctor"), /broken/);
});

test("malformed output and premature exit reject every outstanding request", async (t) => {
  for (const body of ["process.stdout.write('{bad\\n');", "process.exit(7);"]) await t.test(body, async (t) => {
    const c = server(t, body);
    const results = await Promise.allSettled([c.request("one"), c.request("two")]);
    assert.ok(results.every((r) => r.status === "rejected"));
    await c.close(); await c.close();
    await assert.rejects(c.request("after-close"), /closed|Invalid/);
  });
});

test("request deadlines cancel exactly that request and later traffic stays usable", async (t) => {
  const c = server(t, `if(m.method==='slow')return;if(m.method==='notifications/cancelled'){globalThis.cancelled=m.params.requestId;return;}
    process.stdout.write(JSON.stringify({id:m.id,result:{cancelled:globalThis.cancelled}})+'\\n');`);
  // Handshake before the short deadline avoids measuring process startup on slow CI hosts.
  await c.request("ready");
  await assert.rejects(c.request("slow", {}, 50), /timed out/);
  assert.equal((await c.request("read")).result.cancelled, 2);
});

test("job deadlines and failed terminal states cannot be mistaken for success", async () => {
  const failed = { status: "failed", job_id: "j1", error: { code: "BUILD_FAILED" } };
  assert.equal(await waitJob(async () => failed, { status: "queued", job_id: "j1" }), failed);
  await assert.rejects(waitJob(async () => assert.fail("deadline must stop polling"), { status: "running", job_id: "j1" }, 0), /timed out/);
});
