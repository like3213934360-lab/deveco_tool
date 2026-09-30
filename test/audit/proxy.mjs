// Proxy support: the MCP server started with HTTPS_PROXY must send its outbound requests through the
// proxy (like deveco-code c68ca36d2 for Huawei auth). A local recording proxy counts CONNECTs; the
// server makes a real outbound call (skills search -> matrix.openharmony.cn).
import http from "node:http";
import { connect } from "../../tools/mcp-client.mjs";
import { evidence, record } from "./lib.mjs";

let seen = [];
const proxy = http.createServer();
proxy.on("connect", (req, sock) => { seen.push(req.url); sock.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); });
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${proxy.address().port}`;

const run = async (env) => {
  seen = [];
  const c = connect(env); await c.initialize();
  const r = await c.call("skills", { action: "search", query: "harmony" });
  await c.close();
  return { error: r.isError ? r.data.error.message.slice(0, 120) : null, proxy_connects: [...seen] };
};
const withProxy = await run({ HTTPS_PROXY: url, NO_PROXY: "" });
const noProxy = await run({ HTTPS_PROXY: "", HTTP_PROXY: "", https_proxy: "", http_proxy: "" });
proxy.close();
const ev = evidence("upstream", "proxy-mcp.json", { node: process.version, withProxy, noProxy });
record("A.upstream.new.proxy-env", withProxy.proxy_connects.length > 0 && noProxy.proxy_connects.length === 0 ? "VERIFIED" : "DEFECT",
  `MCP server with HTTPS_PROXY: ${withProxy.proxy_connects.length} CONNECT(s) through the proxy (${withProxy.proxy_connects.join(", ")}), request ${withProxy.error ? "failed as the test proxy refuses" : "ok"}; without proxy variables: ${noProxy.proxy_connects.length} proxy connects, request ${noProxy.error ? "failed: " + noProxy.error : "ok"}`, [ev]);
