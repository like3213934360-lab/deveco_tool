import assert from "node:assert/strict";
import net from "node:net";
import { once, getEventListeners } from "node:events";
import test, { type TestContext } from "node:test";
import { textRpc, textRequest } from "../src/services/text.js";

async function connection(t: TestContext, handler: (peer: net.Socket) => void) {
  const peers = new Set<net.Socket>();
  const server = net.createServer((peer) => {
    peers.add(peer);
    peer.on("error", () => {});
    peer.on("close", () => peers.delete(peer));
    handler(peer);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const socket = net.createConnection({
    host: "127.0.0.1",
    port: address.port,
  });
  t.after(async () => {
    socket.destroy();
    for (const peer of peers) peer.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return socket;
}
test("Unicode RPC receipts survive byte fragmentation and release all request listeners", async (t) => {
  const socket = await connection(t, (peer) =>
    peer.once("data", () => {
      const reply = Buffer.from(JSON.stringify({ result: "中文🙂", pts: 123 }));
      let index = 0;
      const write = () => {
        if (index === reply.length) return;
        peer.write(reply.subarray(index, ++index));
        setImmediate(write);
      };
      write();
    }),
  );
  const abort = new AbortController();
  assert.equal(
    await textRpc(socket, "Driver.create", "", [], abort.signal, 3000),
    "中文🙂",
  );
  assert.equal(socket.listenerCount("data"), 0);
  assert.equal(socket.listenerCount("error"), 0);
  assert.equal(socket.listenerCount("close"), 0);
  assert.equal(getEventListeners(abort.signal, "abort").length, 0);
});
for (const [label, response, code] of [
  [
    "exception",
    JSON.stringify({ exception: { code: 17000006 } }),
    "UI_RPC_FAILED",
  ],
  ["missing result", JSON.stringify({ pts: 123 }), "UI_RPC_FAILED"],
  ["truncated", '{"result":', "UI_RPC_CLOSED"],
  ["oversized", "x".repeat(65537), "UI_RPC_TOO_LARGE"],
] as const)
  test(`Unicode RPC rejects ${label} without repeating an input action`, async (t) => {
    let requests = 0;
    const socket = await connection(t, (peer) =>
      peer.on("data", () => {
        requests++;
        peer.end(response);
      }),
    );
    await assert.rejects(
      textRpc(
        socket,
        "Driver.inputText",
        "Driver#73",
        textRequest({ x: 1, y: 2 }, "中文🙂"),
        undefined,
        3000,
      ),
      { code },
    );
    assert.equal(requests, 1);
    assert.equal(socket.destroyed, true);
  });
test("silent Unicode RPC requests time out or cancel without leaving listeners", async (t) => {
  for (const cancel of [false, true]) {
    const socket = await connection(t, () => {}),
      abort = new AbortController();
    const pending = textRpc(socket, "Driver.create", "", [], abort.signal, 50);
    if (cancel) abort.abort();
    await assert.rejects(pending, {
      code: cancel ? "CANCELLED" : "UI_RPC_TIMEOUT",
    });
    assert.equal(socket.destroyed, true);
    assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  }
});
test("text input rejects unpaired Unicode, control bytes and oversized requests before dispatch", () => {
  for (const value of ["\ud800", "\u0000", "x".repeat(61440)])
    assert.throws(() => textRequest({ x: 1, y: 2 }, value));
  assert.deepEqual(textRequest({ x: 1, y: 2 }, "中文🙂\n\t"), [
    { x: 1, y: 2 },
    "中文🙂\n\t",
    { paste: true },
  ]);
});
