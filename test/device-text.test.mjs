import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import net from "node:net";
import { once, getEventListeners } from "node:events";
import test from "node:test";
import { textRpc } from "../src/device-text.mjs";

async function connection(t, handler) {
  const peers = new Set();
  const server = net.createServer(peer => {
    peers.add(peer);
    peer.on("error", () => {});
    peer.on("close", () => peers.delete(peer));
    handler(peer);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const socket = net.createConnection({ host: "127.0.0.1", port: server.address().port });
  t.after(async () => {
    socket.destroy();
    for (const peer of peers) peer.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return socket;
}

test("text RPC preserves UTF-8 across response fragments and cleans request listeners", async t => {
  const socket = await connection(t, peer => peer.once("data", () => {
    const reply = Buffer.from(JSON.stringify({ result: "中文🙂", pts: 123 }));
    let index = 0;
    const write = () => {
      if (index === reply.length) return;
      peer.write(reply.subarray(index, ++index));
      setImmediate(write);
    };
    write();
  }));
  const abort = new AbortController();
  assert.equal(await textRpc(socket, "Driver.create", "", [], 3000, abort.signal), "中文🙂");
  assert.equal(socket.listenerCount("data"), 0);
  assert.equal(socket.listenerCount("error"), 0);
  assert.equal(getEventListeners(abort.signal, "abort").length, 0);
});

for (const [label, response] of [
  ["exception", JSON.stringify({ exception: { code: 17000006, message: "unsupported" } })],
  ["missing result", JSON.stringify({ pts: 123 })],
  ["truncated", '{"result":'],
  ["oversized", "x".repeat(65537)],
]) {
  test(`text RPC rejects ${label} receipts without retrying input`, async t => {
    let requests = 0;
    const socket = await connection(t, peer => peer.on("data", () => { requests++; peer.end(response); }));
    await assert.rejects(textRpc(socket, "Driver.inputText", "Driver#73", [{ x: 1, y: 2 }, "text", { paste: true }], 3000), { code: "UI_TEXT_FAILED" });
    assert.equal(requests, 1);
    assert.equal(socket.destroyed, true);
  });
}

test("text RPC times out and aborts silent connections without leaving listeners", async t => {
  for (const cancel of [false, true]) {
    const socket = await connection(t, () => {});
    const abort = new AbortController();
    const pending = textRpc(socket, "Driver.create", "", [], 50, abort.signal);
    if (cancel) abort.abort();
    await assert.rejects(pending, { code: cancel ? "HDC_ABORTED" : "HDC_TIMEOUT" });
    assert.equal(socket.destroyed, true);
    assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  }
});

test("distributed official agent bytes match their pinned upstream provenance", async () => {
  const directory = new URL("../src/native/hypium/", import.meta.url);
  const manifest = JSON.parse(await fs.readFile(new URL("provenance.json", directory), "utf8"));
  assert.equal(manifest.version, "6.1.210");
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert.equal(crypto.createHash("sha256").update(await fs.readFile(new URL(name, directory))).digest("hex"), expected, name);
  }
});
