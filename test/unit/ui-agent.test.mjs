import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { once } from "node:events";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { temporaryDirectory } from "../support/workspace.mjs";

const work = temporaryDirectory("ui-agent"), bundle = path.join(work, "agent.mjs");
await build({ entryPoints: [path.resolve("src/domains/ui.ts")], outfile: bundle, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "error" });
const { agentRpc, mp4Video, settledRotation } = await import(pathToFileURL(bundle).href);
after(() => fs.rmSync(work, { recursive: true, force: true }));
async function connection(t, onRequest) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket));
    let pending = "";
    socket.on("data", (c) => { pending += c; let request; try { request = JSON.parse(pending); } catch { return; } pending = ""; onRequest(socket, request); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const socket = net.createConnection({ host: "127.0.0.1", port: server.address().port }); socket.on("error", () => {});
  await once(socket, "connect");
  t.after(async () => { socket.destroy(); for (const peer of sockets) peer.destroy(); await new Promise((r) => server.close(r)); });
  return socket;
}

test("100 agent replies with fragmented UTF-8 do not leak listeners or timers", async (t) => {
  let calls = 0;
  const socket = await connection(t, (peer) => {
    calls++; const reply = Buffer.from(JSON.stringify({ result: "鸿蒙" }));
    const cut = reply.indexOf(Buffer.from("鸿")) + 1;
    peer.write(reply.subarray(0, cut)); setImmediate(() => peer.write(reply.subarray(cut)));
  });
  const errors = socket.listenerCount("error");
  for (let i = 0; i < 100; i++) {
    assert.equal(await agentRpc(socket, "Driver.mouseClick", "driver", [1, 2]), "鸿蒙");
    assert.equal(socket.listenerCount("error"), errors); assert.equal(socket.listenerCount("close"), 0); assert.equal(socket.listenerCount("data"), 0);
  }
  assert.equal(calls, 100);
});

test("agent disconnect is bounded, carries uncertainty and never replays a sent action", async (t) => {
  let calls = 0;
  const socket = await connection(t, (peer) => { calls++; peer.destroy(); });
  await assert.rejects(agentRpc(socket, "Driver.mouseClick", "driver", [1, 2]), (e) => e.code === "UI_AGENT_CONNECTION" && /unknown/.test(e.message));
  assert.equal(calls, 1); assert.equal(socket.listenerCount("data"), 0);
});

test("agent cancellation closes the socket and removes request listeners", async (t) => {
  let received;
  const sent = new Promise((r) => { received = r; });
  const socket = await connection(t, () => received()); const controller = new AbortController();
  const result = agentRpc(socket, "Driver.mouseClick", "driver", [1, 2], controller.signal);
  await sent; controller.abort(); await assert.rejects(result, (e) => e.code === "CANCELLED");
  assert.equal(socket.destroyed, true); assert.equal(socket.listenerCount("data"), 0);
});

test("recording export requires finalized MP4 video container and media bytes", () => {
  const box = (name, content) => { const b = Buffer.alloc(8 + content.length); b.writeUInt32BE(b.length); b.write(name, 4); content.copy(b, 8); return b; };
  const valid = Buffer.concat([box("ftyp", Buffer.from("isom")), box("mdat", Buffer.from("samples")), box("moov", Buffer.from("vide"))]);
  assert.equal(mp4Video(valid), true);
  for (const bad of [Buffer.alloc(0), Buffer.from("[FAIL]"), valid.subarray(0, -1), box("ftyp", Buffer.from("isom")), Buffer.concat([box("ftyp", Buffer.from("isom")), box("mdat", Buffer.from("samples"))])]) assert.equal(mp4Video(bad), false);
});


test("rotation waits for asynchronous state without replaying a setter and remains bounded", async () => {
  const signal = new AbortController().signal; let calls = 0;
  assert.equal(await settledRotation(async () => ++calls < 3 ? 0 : 1, 1, signal), 1);
  assert.equal(calls, 3);
  calls = 0; assert.equal(await settledRotation(async () => { calls++; return 0; }, 1, signal, 20), 0);
  assert.ok(calls <= 3);
  await assert.rejects(settledRotation(async () => '1', 1, signal), { code: 'DEVICE_OUTPUT_INVALID' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(settledRotation(async () => 1, 1, controller.signal));
});
