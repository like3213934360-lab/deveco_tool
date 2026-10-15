import net from "node:net";
import { Transform, type TransformCallback } from "node:stream";
import { invariant, ToolError } from "./errors.js";

// HDC ChannelHandShake: 4-byte BE frame length, 12-byte banner, 32-byte connectKey,
// optionally 64-byte version. Keep the server handshake/version and all result bytes intact.
// https://github.com/openharmony/developtools_hdc/blob/master/src/common/channel.h
const handshakeSizes = new Set([44, 108]);
function handshake(frame: Buffer) {
  invariant(handshakeSizes.has(frame.readUInt32BE(0)) && frame.subarray(4, 12).toString() === "OHOS HDC",
    "CAPABILITY_UNAVAILABLE", "Unsupported HDC channel handshake; no device command was forwarded");
}

/** Inspect only initial frames, then stream binary transfers with native backpressure. */
class PrefixFrames extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  constructor(private readonly inspect: Array<(frame: Buffer) => void>) { super(); }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    try {
      if (!this.inspect.length) { callback(null, chunk); return; }
      this.pending = Buffer.concat([this.pending, chunk]);
      while (this.inspect.length && this.pending.length >= 4) {
        const length = this.pending.readUInt32BE(0);
        invariant(length > 0 && length <= 65536, "CAPABILITY_UNAVAILABLE", "Invalid HDC initial frame length");
        if (this.pending.length < length + 4) break;
        const frame = Buffer.from(this.pending.subarray(0, length + 4));
        this.pending = this.pending.subarray(length + 4);
        this.inspect.shift()!(frame); this.push(frame);
      }
      if (!this.inspect.length && this.pending.length) { this.push(this.pending); this.pending = Buffer.alloc(0); }
      callback();
    } catch (error) { callback(error as Error); }
  }
  override _flush(callback: TransformCallback) {
    callback(this.inspect.length ? new ToolError("PROCESS_FAILED", "HDC disconnected before the selected device command") : undefined);
  }
}

/** Bind untargeted SDK HDC clients to one existing target, without moving/disconnecting devices.
 * The loopback endpoint is private to this job's child environment, not a system proxy or sandbox.
 */
export async function openHdcTarget(target: string, upstreamPort = Number(process.env.OHOS_HDC_SERVER_PORT ?? 8710)) {
  invariant(target && !["any", "all"].includes(target) && !/[\x00-\x20\x7f]/.test(target) && Buffer.byteLength(target) <= 32,
    "INVALID_INPUT", "Selected device must fit the HDC connect-key field");
  invariant(Number.isInteger(upstreamPort) && upstreamPort > 0 && upstreamPort <= 65535,
    "INVALID_INPUT", "OHOS_HDC_SERVER_PORT must be a valid port");
  const sockets = new Set<net.Socket>(), timers = new Set<ReturnType<typeof setTimeout>>();
  const routing = { target, method: "hdc-channel-target", connections: 0, commands: 0 };
  let failure: Error | undefined, closing = false;
  const fail = (error: Error) => {
    if (closing) return;
    failure ??= error;
    for (const socket of sockets) socket.destroy();
  };
  const server = net.createServer((client) => {
    if (failure || closing) { client.destroy(); return; }
    const upstream = net.connect({ host: "127.0.0.1", port: upstreamPort });
    sockets.add(client); sockets.add(upstream);
    const timer = setTimeout(() => fail(new ToolError("TIMEOUT", "HDC target handshake timed out")), 10000);
    timers.add(timer);
    const incoming = new PrefixFrames([handshake]);
    const outgoing = new PrefixFrames([
      (frame) => {
        handshake(frame);
        const key = frame.subarray(16, 48).toString().replace(/\0.*$/s, "");
        invariant(key === "any" || key === target, "CONFLICT", "SDK attempted a different or untargeted server operation", { target, requested: key });
        frame.fill(0, 16, 48); frame.write(target, 16); routing.connections++;
      },
      (frame) => {
        const command = frame.subarray(4).toString().replace(/\0$/, "");
        invariant(/^(shell |install |uninstall |file (send|recv) )/.test(command),
          "CAPABILITY_UNAVAILABLE", "SDK requested an unsupported HDC operation; no command was forwarded");
        routing.commands++; clearTimeout(timer); timers.delete(timer);
      },
    ]);
    for (const stream of [client, upstream, incoming, outgoing]) stream.on("error", fail);
    client.pipe(outgoing).pipe(upstream); upstream.pipe(incoming).pipe(client);
    client.on("close", () => {
      clearTimeout(timer); timers.delete(timer); upstream.destroy(); incoming.destroy(); outgoing.destroy();
      sockets.delete(client); sockets.delete(upstream);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); server.on("error", fail); resolve(); });
  });
  return {
    port: (server.address() as net.AddressInfo).port, routing,
    assertHealthy() {
      if (failure) throw failure instanceof ToolError ? failure : new ToolError("PROCESS_FAILED", `HDC target routing failed: ${failure.message}`, { target });
    },
    async close() {
      closing = true;
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
