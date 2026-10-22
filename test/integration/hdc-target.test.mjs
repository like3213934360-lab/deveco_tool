import { temporaryDirectory } from "../support/workspace.mjs";
// Real loopback streams; fixture peers exercise HDC routing, not SDK/device test verdicts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { test, after } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const work = temporaryDirectory("deveco-hdc-target-");
const bundle = path.join(work, 'target.mjs');
await build({ entryPoints: [path.resolve('src/core/hdc-target.ts')], outfile: bundle, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const { openHdcTarget } = await import(pathToFileURL(bundle));
after(() => fs.rmSync(work, { recursive: true, force: true }));
const frame = (data) => { const bytes = Buffer.from(data), result = Buffer.alloc(4 + bytes.length); result.writeUInt32BE(bytes.length); bytes.copy(result, 4); return result; };
function hello(key = 'any', versioned = false) {
  const data = Buffer.alloc(versioned ? 108 : 44); data.write('OHOS HDC'); data.write(key, 12); return frame(data);
}
async function peer(t, onFrame) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    const greeting = hello('channel'); socket.write(greeting.subarray(0, 3)); socket.write(greeting.subarray(3));
    let pending = Buffer.alloc(0), n = 0;
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4 && pending.length >= pending.readUInt32BE(0) + 4) {
        const length = pending.readUInt32BE(0) + 4, data = pending.subarray(4, length); pending = pending.subarray(length);
        onFrame(data, n++, socket);
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const s of sockets) s.destroy(); await new Promise((r) => server.close(r)); });
  return server.address().port;
}
async function connect(t, port) {
  const socket = net.connect({ host: '127.0.0.1', port });
  socket.on('error', (e) => assert.equal(e.code, 'ECONNRESET')); t.after(() => socket.destroy());
  await once(socket, 'connect');
  let bytes = Buffer.alloc(0);
  for await (const part of socket.iterator({ destroyOnReturn: false })) { bytes = Buffer.concat([bytes, part]); if (bytes.length >= 48) break; }
  assert.deepEqual(bytes, hello('channel')); return socket;
}

test('concurrent jobs pin different targets and preserve split/coalesced transfers', { timeout: 10000 }, async (t) => {
  const seen = [], payload = Buffer.alloc(192 * 1024, 0xa5), response = frame('actual device response');
  const port = await peer(t, (bytes, n, socket) => {
    if (n === 0) seen.push(bytes.subarray(12, 44).toString().replace(/\0.*$/s, ''));
    if (n === 1) assert.equal(bytes.toString(), 'file send source destination\0');
    if (n === 2) { assert.deepEqual(bytes, payload); socket.end(response); }
  });
  await Promise.all([['USB_TARGET', false], ['127.0.0.1:5555', true]].map(async ([target, versioned]) => {
    const route = await openHdcTarget(target, port); t.after(() => route.close());
    const client = await connect(t, route.port), request = Buffer.concat([hello('any', versioned), frame('file send source destination\0'), frame(payload)]);
    client.write(request.subarray(0, 2)); client.write(request.subarray(2, 47)); client.write(request.subarray(47));
    const chunks = []; for await (const part of client) chunks.push(part);
    assert.deepEqual(Buffer.concat(chunks), response); route.assertHealthy();
    assert.equal(route.routing.commands, 1); assert.equal(route.routing.connections, 1);
  }));
  assert.deepEqual(seen.sort(), ['127.0.0.1:5555', 'USB_TARGET']);
});

test('invalid handshake, wrong target and global commands never reach a device command', { timeout: 10000 }, async (t) => {
  for (const [label, request] of [
    ['wrong-target', Buffer.concat([hello('UNSELECTED'), frame('uninstall com.devecomcp.probe')])],
    ['server-command', Buffer.concat([hello(), frame('tconn another-device')])],
    ['empty-target', Buffer.concat([hello(''), frame('list targets')])],
    ['bad-banner', Buffer.concat([frame(Buffer.alloc(44)), frame('shell echo unexpected')])],
    ['oversized', Buffer.from([0x7f, 0xff, 0xff, 0xff])],
  ]) await t.test(label, async (t) => {
    const seen = []; const port = await peer(t, (bytes) => seen.push(bytes));
    const route = await openHdcTarget('SELECTED', port); t.after(() => route.close());
    const client = await connect(t, route.port); client.write(request);
    await new Promise((r) => client.once('close', r));
    assert.throws(() => route.assertHealthy());
    assert.ok(seen.length <= 1); assert.equal(route.routing.commands, 0);
  });
});

test('closing a cancelled job destroys open connections and releases its port', { timeout: 10000 }, async (t) => {
  const port = await peer(t, () => {}), route = await openHdcTarget('SELECTED', port);
  const client = await connect(t, route.port); client.write(hello());
  const closed = new Promise((r) => client.once('close', r)); await route.close(); await closed;
  const replacement = net.createServer(); replacement.listen(route.port, '127.0.0.1'); await once(replacement, 'listening');
  await new Promise((r) => replacement.close(r));
});

test('a stalled handshake times out without forwarding a command', { timeout: 15000 }, async (t) => {
  const seen = [], port = await peer(t, (bytes) => seen.push(bytes));
  const route = await openHdcTarget('SELECTED', port); t.after(() => route.close());
  const client = await connect(t, route.port); client.write(hello().subarray(0, 10));
  await new Promise((r) => client.once('close', r));
  assert.throws(() => route.assertHealthy(), { code: 'TIMEOUT' });
  assert.equal(seen.length, 0); assert.equal(route.routing.commands, 0);
});

test('unavailable upstream and invalid identities fail explicitly', { timeout: 10000 }, async (t) => {
  for (const target of ['', 'any', 'all', 'x\ny', 'x'.repeat(33)]) await assert.rejects(openHdcTarget(target), { code: 'INVALID_INPUT' });
  for (const port of [0, -1, 65536, NaN]) await assert.rejects(openHdcTarget('SELECTED', port), { code: 'INVALID_INPUT' });
  const unused = net.createServer(); unused.listen(0, '127.0.0.1'); await once(unused, 'listening');
  const port = unused.address().port; await new Promise((r) => unused.close(r));
  const route = await openHdcTarget('SELECTED', port); t.after(() => route.close());
  const client = net.connect({ host: '127.0.0.1', port: route.port }); client.on('error', () => {}); await once(client, 'close');
  assert.throws(() => route.assertHealthy(), /ECONNREFUSED/); assert.equal(route.routing.commands, 0);
});
