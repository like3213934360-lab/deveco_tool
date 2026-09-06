import fs from "node:fs";
import net from "node:net";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const [mode, endpoint, statePath] = process.argv.slice(2);
if (mode === "start") {
  const child = fork(fileURLToPath(import.meta.url), ["serve", endpoint, ...(statePath ? [statePath] : [])],
    { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const timer = setTimeout(() => { child.kill(); process.exitCode = 1; }, 5000);
  child.once("message", () => { clearTimeout(timer); child.disconnect(); child.unref(); console.log("Forwardport result:OK"); });
  child.once("error", () => { clearTimeout(timer); process.exitCode = 1; });
} else {
  const sockets = new Set();
  const deadline = setTimeout(() => { for (const socket of sockets) socket.destroy(); server.close(); }, 10000);
  const server = net.createServer(socket => {
    sockets.add(socket);
    let raw = "";
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("close", () => { sockets.delete(socket); clearTimeout(deadline); server.close(); });
    socket.on("data", chunk => {
      raw += chunk;
      let request;
      try { request = JSON.parse(raw); } catch { return; }
      raw = "";
      const state = statePath ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
      if (state.rpcSilent) return;
      if (state.rpcClose) return socket.end('{"result":');
      if (request.params.api === "Driver.create") {
        socket.write(JSON.stringify(state.createReply ?? { result: "Driver#73" }));
      } else {
        state.lastTextRequest = request.params.args;
        state.lastTextReference = request.params.this;
        if (statePath) fs.writeFileSync(statePath, JSON.stringify(state));
        socket.write(JSON.stringify(state.inputReply ?? { result: null }));
      }
    });
  });
  server.listen(Number(endpoint.replace(/^tcp:/, "")), "127.0.0.1", () => process.send?.("ready"));
}
