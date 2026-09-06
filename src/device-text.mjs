import crypto from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { hdcFailureMessage, runHdc, targetArgs } from "./hdc-log.mjs";

function fail(message, code = "UI_TEXT_FAILED") { throw Object.assign(new Error(message), { code }); }

export function textRequest(point, text) {
  if (!point || ![point.x, point.y].every(n => Number.isInteger(n) && n >= 0 && n <= 2147483647)) {
    fail("Text input requires a target control or non-negative x/y coordinates", "UI_ARGS_INVALID");
  }
  if (point.displayId !== undefined && (!Number.isInteger(point.displayId) || point.displayId < 0 || point.displayId > 2147483647)) {
    fail("displayId must be a non-negative 32-bit integer", "UI_ARGS_INVALID");
  }
  if (typeof text !== "string" || !text.length || !text.isWellFormed()
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    fail("text must be non-empty valid Unicode without control characters other than tab/newline", "UI_ARGS_INVALID");
  }
  const request = JSON.stringify([point, text, { paste: true }]);
  if (Buffer.byteLength(request) > 61440) fail("Encoded text input exceeds 60 KiB", "UI_ARGS_INVALID");
  return request;
}

export function textAgent(machine, version) {
  if (!["aarch64", "arm64", "x86_64"].includes(machine)) {
    fail(`No official text agent is available for device architecture ${machine}`, "UI_TEXT_UNSUPPORTED");
  }
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) fail("Cannot determine the device UiTest version", "UI_TEXT_UNSUPPORTED");
  const numbers = version.split(".").map(Number), minimum = [6, 0, 2, 2];
  const difference = numbers.map((n, i) => n - minimum[i]).find(n => n !== 0) ?? 0;
  const unix = machine !== "x86_64" && difference >= 0;
  return {
    asset: machine === "x86_64" ? "uitest_agent_v1.1.9.x86_64.so" : unix ? "uitest_agent_v1.2.2.so" : "uitest_agent_v1.1.9.so",
    endpoint: unix ? "localabstract:uitest_socket" : "tcp:8012",
    probe: unix ? "cat /proc/net/unix | grep -q '@uitest_socket$'" : "netstat -an | grep -E '[:.]8012[[:space:]].*LISTEN' >/dev/null",
  };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

// The official agent uses sequential, unframed JSON replies. A TCP data event is
// not a whole reply: retain UTF-8 decoder state and accumulate fragments.
export function textRpc(socket, api, self, args, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let raw = "", size = 0;
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.off("data", onData); socket.off("error", onError); socket.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
      if (error) { socket.destroy(); reject(error); } else resolve(value);
    };
    const error = (message, code = "UI_TEXT_FAILED") => Object.assign(new Error(message), { code });
    const onError = () => finish(error("UiTest text connection failed"));
    const onClose = () => finish(error("UiTest closed the connection without a complete API receipt"));
    const onAbort = () => finish(error("Text input was cancelled; verify the field before retrying", "HDC_ABORTED"));
    const onData = chunk => {
      raw += chunk; size += Buffer.byteLength(chunk);
      if (size > 65536) return finish(error("UiTest text receipt exceeds 64 KiB"));
      let reply;
      try { reply = JSON.parse(raw); } catch { return; }
      if (!reply || typeof reply !== "object" || !Object.hasOwn(reply, "result") || reply.exception) {
        return finish(error(`UiTest ${api} failed${reply?.exception ? `: ${JSON.stringify(reply.exception).slice(0, 1000)}` : " (invalid API receipt)"}`));
      }
      finish(null, reply.result);
    };
    const timer = setTimeout(() => finish(error("UiTest text API timed out; verify the field before retrying", "HDC_TIMEOUT")), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("data", onData); socket.once("error", onError); socket.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    socket.write(JSON.stringify({ module: "com.ohos.devicetest.hypiumApiHelper", method: "callHypiumApi",
      params: { api, this: self, args, message_type: "hypium" }, request_id: crypto.randomUUID() }));
  });
}

/** Caller owns the per-device uitest lock, including any target lookup. */
export async function pasteDeviceText({ hdc, deviceId, point, text, timeoutMs, signal }) {
  const request = JSON.parse(textRequest(point, text));
  const deadline = Date.now() + timeoutMs;
  const remaining = () => {
    if (signal?.aborted) fail("Text input was cancelled", "HDC_ABORTED");
    const value = deadline - Date.now();
    if (value <= 0) fail("UiTest text input timed out", "HDC_TIMEOUT");
    return value;
  };
  const command = async args => {
    const result = await runHdc([hdc, ...targetArgs(deviceId), ...args], remaining(), { signal });
    const error = hdcFailureMessage(result);
    if (error) fail(error);
    return result.stdout;
  };
  const machine = (await command(["shell", "uname", "-m"])).trim();
  const version = (await command(["shell", "uitest", "--version"])).trim();
  const agent = textAgent(machine, version);
  const ready = async () => (await command(["shell", `if ${agent.probe}; then echo DEVECO_TEXT_READY; else echo DEVECO_TEXT_ABSENT; fi`])).trim() === "DEVECO_TEXT_READY";
  let remote, forward, socket;
  try {
    // Reuse an existing official service. Never replace agent.so, restart another
    // client's daemon, or kill uitest globally. Our service uses upstream's idle exit.
    if (!await ready()) {
      const name = `deveco-text-${crypto.randomUUID()}.so`;
      remote = `/data/local/tmp/${name}`;
      const library = fileURLToPath(new URL(`./native/hypium/${agent.asset}`, import.meta.url));
      const output = await command(["file", "send", library, remote]);
      if (!/File\s*transfer finish/i.test(output)) fail("HDC did not confirm official text-agent transfer");
      await command(["shell", "uitest", "start-daemon", "singleness", "--extension-name", name]);
      const startupDeadline = Math.min(deadline, Date.now() + 5000);
      while (!await ready()) {
        if (Date.now() >= startupDeadline) fail("Official UiTest text service did not start; check device UiTest support and extension-load diagnostics", "UI_TEXT_START_FAILED");
        await delay(Math.min(100, remaining()), undefined, { signal });
      }
    }
    forward = `tcp:${await freePort()}`;
    const output = await command(["fport", forward, agent.endpoint]);
    if (!/result:\s*OK/i.test(output)) fail("HDC did not confirm text-service port forwarding");
    socket = net.createConnection({ host: "127.0.0.1", port: Number(forward.slice(4)) });
    const reference = await textRpc(socket, "Driver.create", "", [], remaining(), signal);
    if (typeof reference !== "string" || !/^Driver#\d+$/.test(reference)) fail("UiTest did not return a valid Driver reference");
    const result = await textRpc(socket, "Driver.inputText", reference, request, remaining(), signal);
    if (result !== null) fail("UiTest did not confirm forced text paste");
    return { method: "uitest-forced-paste", point, commandAccepted: true, outcomeVerified: false };
  } finally {
    socket?.destroy();
    // Removing a forward closes this RPC session. The shared official service is
    // left available to its other clients and exits on its upstream idle timeout.
    const cleanup = [];
    if (forward) cleanup.push(["fport", "rm", forward, agent.endpoint]);
    if (remote) cleanup.push(["shell", "rm", "-f", remote]);
    for (const args of cleanup) {
      try { await runHdc([hdc, ...targetArgs(deviceId), ...args], 5000); } catch { /* disconnected device */ }
    }
  }
}
