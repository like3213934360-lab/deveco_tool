// Observe the real host/server transport. Forward original bytes; never fabricate or repair calls.
// Raw traces can contain local paths, device identities and credentials. Keep them private.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const [entry, trace, casesFile] = process.argv.slice(2);
if (!entry || !trace) throw new Error("Usage: model-proxy.mjs <compiled cli.js> <new trace.jsonl>");
const fd = fs.openSync(trace, "ax", 0o600);
const child = spawn(process.execPath, [entry, "mcp"], { stdio: ["pipe", "pipe", "inherit"] });
const cases = casesFile ? JSON.parse(fs.readFileSync(casesFile, "utf8")) : [];
const matches = (value, expected) => expected && typeof expected === "object"
  ? value && typeof value === "object" && Object.entries(expected).every(([key, item]) => matches(value[key], item)) : value === expected;
const forbidden = cases.flatMap((c) => c.forbid ?? []);
const targets = new Set(cases.flatMap((c) => c.expect ?? []).map((c) => c.arguments?.target).filter(Boolean));
const projects = new Set(cases.flatMap((c) => c.expect ?? []).map((c) => c.arguments?.project).filter(Boolean));
const record = (direction, message) => fs.writeSync(fd, JSON.stringify({ direction, message }) + "\n");
function observe(stream, direction) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  stream.on("data", (data) => {
    buffer += decoder.write(data);
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) record(direction, JSON.parse(line));
    }
  });
}
observe(child.stdout, "response");
// Inspect whole request frames before forwarding their original bytes. A prohibited operation
// ends the trial, never receives a fabricated tool result and can never count as a successful call.
let pending = Buffer.alloc(0);
process.stdin.on("data", (data) => {
  pending = Buffer.concat([pending, data]);
  let index;
  while ((index = pending.indexOf(10)) !== -1) {
    const frame = pending.subarray(0, index + 1);
    pending = pending.subarray(index + 1);
    if (frame.toString().trim()) {
      const message = JSON.parse(frame.toString());
      if (message.method === "tools/call") {
        const call = { tool: message.params.name, arguments: message.params.arguments ?? {} };
        const args = call.arguments;
        if (forbidden.some((rule) => matches(call, rule)) || (targets.size && args.target && !targets.has(args.target))
          || (projects.size && args.project && !projects.has(args.project))) {
          record("blocked", message);
          child.kill("SIGTERM");
          process.exitCode = 1;
          process.stdin.pause();
          return;
        }
      }
      record("request", message);
    }
    child.stdin.write(frame);
  }
});
process.stdin.on("end", () => {
  if (pending.length) throw new Error("Incomplete MCP request frame");
  child.stdin.end();
});
child.stdout.pipe(process.stdout);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("close", (code, signal) => { fs.closeSync(fd); process.exit(process.exitCode ?? code ?? (signal ? 1 : 0)); });
