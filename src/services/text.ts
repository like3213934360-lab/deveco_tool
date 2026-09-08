import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resourceRoot } from "../core/config.js";
import { invariant, object, ToolError } from "../core/errors.js";
import type { DeviceService } from "./device.js";
import { textComponent } from "./text-component.js";

export function textRequest(
  point: { x: number; y: number; displayId?: number },
  value: string,
): unknown[] {
  invariant(
    [point.x, point.y].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 2147483647,
    ),
    "UI_COORDINATES_INVALID",
    "Invalid input coordinates",
  );
  invariant(
    point.displayId === undefined ||
      (Number.isInteger(point.displayId) &&
        point.displayId >= 0 &&
        point.displayId <= 2147483647),
    "UI_DISPLAY_INVALID",
    "Invalid input display",
  );
  invariant(
    value.length > 0 &&
      value.isWellFormed() &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    "UI_TEXT_INVALID",
    "Text must be valid Unicode without control characters other than tab/newline",
  );
  const request = [point, value, { paste: true }];
  invariant(
    Buffer.byteLength(JSON.stringify(request)) <= 61440,
    "UI_TEXT_TOO_LARGE",
    "Encoded text exceeds 60 KiB",
  );
  return request;
}
export async function textRpc(
  socket: net.Socket,
  api: string,
  self: string,
  args: unknown[],
  signal?: AbortSignal,
  timeoutMs = 15000,
): Promise<unknown> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let raw = "";
    let settled = false;
    const finish = (error: Error | null, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        socket.destroy();
        reject(error);
      } else resolve(result);
    };
    const onError = (error: Error) => finish(error);
    const onClose = () =>
      finish(
        new ToolError(
          "UI_RPC_CLOSED",
          "UiTest closed without a complete receipt",
        ),
      );
    const onAbort = () =>
      finish(
        new ToolError(
          "CANCELLED",
          "Text input cancelled; verify the field before retrying",
        ),
      );
    const onData = (chunk: string) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > 65536)
        return finish(
          new ToolError("UI_RPC_TOO_LARGE", "UiTest receipt exceeds 64 KiB"),
        );
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return;
      }
      try {
        const reply = object(parsed);
        invariant(
          Object.hasOwn(reply, "result") && !reply.exception,
          "UI_RPC_FAILED",
          `UiTest ${api} did not confirm success`,
        );
        finish(null, reply.result);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const timer = setTimeout(
      () =>
        finish(
          new ToolError(
            "UI_RPC_TIMEOUT",
            "UiTest receipt timed out; verify before retrying",
          ),
        ),
      timeoutMs,
    );
    socket.setEncoding("utf8");
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    socket.write(
      JSON.stringify({
        module: "com.ohos.devicetest.hypiumApiHelper",
        method: "callHypiumApi",
        params: { api, this: self, args, message_type: "hypium" },
        request_id: crypto.randomUUID(),
      }),
    );
  });
}
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  invariant(
    address && typeof address !== "string",
    "PORT_UNAVAILABLE",
    "Cannot allocate local port",
  );
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
export async function pasteText(
  device: DeviceService,
  target: string,
  point: { x: number; y: number; displayId?: number },
  value: string,
  signal?: AbortSignal,
) {
  const args = textRequest(point, value);
  const machine = (
    await device.shell(target, ["uname", "-m"], signal)
  ).stdout.trim();
  const version = (
    await device.shell(target, ["uitest", "--version"], signal)
  ).stdout.trim();
  const { unix, asset, endpoint } = textComponent(machine, version);
  const ready = async () => {
    const output = unix
      ? (await device.shell(target, ["cat", "/proc/net/unix"], signal)).stdout
      : (await device.shell(target, ["netstat", "-an"], signal)).stdout;
    return unix
      ? /@uitest_socket\s*$/m.test(output)
      : /[:.]8012\s+.*LISTEN/.test(output);
  };
  let remote: string | undefined,
    forward: string | undefined,
    socket: net.Socket | undefined;
  try {
    if (!(await ready())) {
      const name = `deveco-text-${crypto.randomUUID()}.so`;
      remote = `/data/local/tmp/${name}`;
      const transfer = await device.command(
        [
          "-t",
          target,
          "file",
          "send",
          path.join(resourceRoot, "native/hypium", asset),
          remote,
        ],
        signal,
      );
      invariant(
        /File\s*transfer finish/i.test(transfer.stdout),
        "UI_AGENT_TRANSFER",
        "UiTest component transfer unconfirmed",
      );
      await device.shell(
        target,
        ["uitest", "start-daemon", "singleness", "--extension-name", name],
        signal,
      );
      const deadline = Date.now() + 5000;
      while (!(await ready())) {
        invariant(
          Date.now() < deadline,
          "UI_AGENT_START",
          "UiTest service did not become ready",
        );
        await delay(100, undefined, { signal });
      }
    }
    forward = `tcp:${await freePort()}`;
    const receipt = await device.command(
      ["-t", target, "fport", forward, endpoint],
      signal,
    );
    invariant(
      /result:\s*OK/i.test(receipt.stdout),
      "UI_FORWARD_FAILED",
      "Port forwarding not confirmed",
    );
    socket = net.createConnection({
      host: "127.0.0.1",
      port: Number(forward.slice(4)),
    });
    const driver = await textRpc(socket, "Driver.create", "", [], signal);
    invariant(
      typeof driver === "string" && /^Driver#\d+$/.test(driver),
      "UI_DRIVER_INVALID",
      "Invalid UiTest driver reference",
    );
    const result = await textRpc(
      socket,
      "Driver.inputText",
      driver,
      args,
      signal,
    );
    invariant(
      result === null,
      "UI_TEXT_UNCONFIRMED",
      "UiTest did not confirm paste",
    );
    return {
      method: "uitest-forced-paste",
      commandAccepted: true,
      outcomeVerified: false,
    };
  } finally {
    socket?.destroy();
    if (forward)
      await device
        .command(
          ["-t", target, "fport", "rm", forward, endpoint],
          undefined,
          5000,
        )
        .catch(() => {});
    if (remote)
      await device
        .shell(target, ["rm", "-f", remote], undefined, 5000)
        .catch(() => {});
  }
}
