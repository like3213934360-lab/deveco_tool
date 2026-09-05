// Isolated MCP integration fixture: never open a real browser or contact an account service.
import os from "node:os";
import fs from "node:fs";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";

if (!process.env.DEVECO_TEST_AUTH_HOME) throw new Error("A temporary auth home is required");
os.homedir = () => process.env.DEVECO_TEST_AUTH_HOME;
process.env.DEVECO_DISABLE_CREDENTIAL_KEYCHAIN = "1";
const spawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  if (!["open", "xdg-open", "rundll32.exe"].includes(command)) return spawn(command, args, options);
  const child = new EventEmitter();
  queueMicrotask(() => child.emit("error", Object.assign(new Error("Fixture browser unavailable"), { code: "ENOENT" })));
  return child;
};
syncBuiltinESMExports();
const jwt = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, userId: "fixture", userName: "Fixture User" })).toString("base64url")}.x`;
globalThis.fetch = async (url) => {
  if (String(url).includes("/temptoken/check")) return new Response(jwt);
  if (String(url).includes("/jwToken/check")) {
    const gate = process.env.DEVECO_TEST_REFRESH_GATE;
    if (gate) {
      fs.writeFileSync(`${gate}.started`, "started");
      const deadline = Date.now() + 10000;
      // The store's revision check must remain safe even if a transport ignores abort.
      while (!fs.existsSync(gate)) {
        if (Date.now() > deadline) throw new Error("Fixture refresh gate timed out");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    return Response.json({ status: true, userInfo: { accessToken: "fixture-access", refreshToken: "fixture-refresh" } });
  }
  throw new Error(`Unexpected fixture network request: ${new URL(url).pathname}`);
};
