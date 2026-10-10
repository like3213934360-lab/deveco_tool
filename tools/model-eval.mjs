// Real installed hosts and their configured models. No synthetic tool responses or provider fallback.
// Discovery evaluates proposed calls, not execution. Live trials retain the actual host/tool transcript.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { connect } from "./mcp-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const scenarios = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/model-scenarios.json"), "utf8"));
const matches = (actual, expected) => Array.isArray(expected)
  ? Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => matches(actual[i], v))
  : expected !== null && typeof expected === "object"
  ? actual !== null && typeof actual === "object" && Object.entries(expected).every(([k, v]) => matches(actual[k], v))
  : actual === expected;
// Host/provider-qualified names are presentation aliases, not alternate tools or fuzzy matches.
const toolName = (name) => name.replace(/^(?:mcp__deveco__|(?:default\.)?deveco_)/, "");

export function grade(plans, tools, cases = scenarios) {
  assert.ok(Array.isArray(plans), "model response must be a JSON array");
  assert.equal(new Set(plans.map((p) => p.id)).size, plans.length, "duplicate scenario ids");
  assert.deepEqual(plans.map((p) => p.id).sort(), cases.map((s) => s.id).sort(), "scenario set must match");
  const schemas = Object.fromEntries(tools.map((t) => [t.name, z.fromJSONSchema(t.inputSchema).strict()]));
  return cases.map((s) => {
    const plan = plans.find((p) => p.id === s.id);
    const calls = (plan.calls ?? []).map((c) => ({ tool: toolName(c.tool), arguments: c.arguments }));
    const failures = [];
    for (const c of calls) {
      const result = schemas[c.tool]?.safeParse(c.arguments);
      if (!result?.success) failures.push({ invalid_call: c, issues: result?.error.issues ?? "unknown tool" });
    }
    for (const expected of s.expect) if (!calls.some((c) => matches(c, expected))) failures.push({ missing: expected });
    if (s.one_of && !s.one_of.some((expected) => calls.some((c) => matches(c, expected)))) failures.push({ missing_one_of: s.one_of });
    for (const forbidden of s.forbid ?? []) if (calls.some((c) => matches(c, forbidden))) failures.push({ forbidden });
    for (const field of s.forbid_fields ?? []) if (calls.some((c) => c.arguments?.[field] !== undefined)) failures.push({ forbidden_field: field });
    for (const text of s.notes_include ?? []) if (!plan.notes?.includes(text)) failures.push({ missing_note: text });
    for (const field of s.require_fields ?? []) if (!calls.some((c) => c.tool === s.expect[0].tool && c.arguments?.[field] !== undefined)) failures.push({ missing_field: field });
    return { id: s.id, passed: failures.length === 0, failures };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  assert.ok(args.length % 2 === 0, "Usage: node tools/model-eval.mjs --host codex|opencode|claude --suite discovery|live --out <directory> [--entry <compiled cli.js>] [--project <absolute path>]");
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(["--host", "--suite", "--out", "--entry", "--project"].includes(args[i]), `Unknown option ${args[i]}`);
    options[args[i].slice(2)] = args[i + 1];
  }
  const { host, suite } = options;
  assert.ok(["codex", "opencode", "claude"].includes(host) && ["discovery", "live"].includes(suite) && options.out);
  const out = path.resolve(options.out);
  assert.ok(!fs.existsSync(out), "Use a new output directory; never overwrite a failed trial");
  fs.mkdirSync(out, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist/current.json"), "utf8"));
  const entry = options.entry ? path.resolve(options.entry) : path.join(root, "dist", manifest.entry);
  const client = connect({}, entry);
  let metadata;
  try {
    const init = await client.initialize(), list = await client.request("tools/list");
    assert.ok(init.result && list.result, "MCP metadata unavailable");
    metadata = { ...init.result, tools: list.result.tools };
  } finally { await client.close(); }
  fs.writeFileSync(path.join(out, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
  const prompt = suite === "discovery"
    ? "这是工具发现与参数理解验收。仅依据当前可见的 MCP 工具说明，为下面每项独立需求给出拟调用方案，不实际执行这些操作。可以搜索/加载工具定义；不要读取仓库、文件、历史会话或网络文档，也不要调用终端。每项给出必要的工具调用与完整参数，不猜造工具名。仅返回 JSON 数组，每项为 {id,calls:[{tool,arguments}],notes}。示例路径和设备均为规划数据，不要访问。\n" + JSON.stringify(scenarios.map(({ id, goal }) => ({ id, goal })))
    : `只读核实当前鸿蒙开发环境、连接设备及工程 ${options.project} 的 SDK 和模块信息，并检索 ArkUI @Local 官方说明。请实际调用现有 MCP，报告服务器版本和构建 ID、实际检查结果和知识来源。不要修改文件、构建、部署、登录、改变设备状态或用终端替代 MCP。失败直接报告，不更换模型或环境。`;
  if (suite === "live") assert.ok(options.project && path.isAbsolute(options.project), "live requires --project <absolute path>");
  fs.writeFileSync(path.join(out, "prompt.txt"), prompt);
  const server = { command: process.execPath, args: [entry, "mcp"] };
  const env = { ...process.env };
  const argv = host === "codex"
    ? ["exec", "--json", "--ephemeral", "-s", "read-only", "-c", `mcp_servers.deveco.command=${JSON.stringify(server.command)}`, "-c", `mcp_servers.deveco.args=${JSON.stringify(server.args)}`, "-o", path.join(out, "answer.txt"), "-"]
    : host === "claude"
      ? ["-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--mcp-config", JSON.stringify({ mcpServers: { deveco: server } }), "--strict-mcp-config", "--allowedTools", "mcp__deveco__doctor,mcp__deveco__device,mcp__deveco__project,mcp__deveco__knowledge"]
      : ["run", "--format", "json", prompt];
  if (host === "opencode") env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ mcp: { deveco: { type: "local", command: [server.command, ...server.args], enabled: true } } });
  const version = execFileSync(host, ["--version"], { encoding: "utf8" }).trim();
  const started = Date.now(), stdout = fs.openSync(path.join(out, "events.jsonl"), "w"), stderr = fs.openSync(path.join(out, "stderr.txt"), "w");
  const child = spawn(host, argv, { cwd: root, env, stdio: ["pipe", stdout, stderr], detached: process.platform !== "win32" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; process.platform === "win32" ? child.kill() : process.kill(-child.pid, "SIGTERM"); }, 600000);
  child.stdin.end(host === "opencode" ? undefined : prompt);
  const exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  clearTimeout(timer); fs.closeSync(stdout); fs.closeSync(stderr);
  const events = fs.readFileSync(path.join(out, "events.jsonl"), "utf8").split("\n").filter((s) => s.startsWith("{")).map((s) => JSON.parse(s));
  const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
  const report = { host, version, suite, server_version: metadata.serverInfo.version, entry, metadata_sha256: hash(JSON.stringify(metadata)), prompt_sha256: hash(prompt), scenarios_sha256: hash(JSON.stringify(scenarios)), exit_code: exitCode, timed_out: timedOut, elapsed_ms: Date.now() - started };
  try {
    assert.equal(exitCode, 0, "host process failed"); assert.equal(timedOut, false, "host deadline exceeded");
    const answer = host === "codex" ? fs.readFileSync(path.join(out, "answer.txt"), "utf8")
      : host === "claude" ? events.findLast((e) => e.type === "result")?.result
      : events.filter((e) => e.type === "text").map((e) => e.part.text).join("\n");
    assert.ok(answer, "host returned no model answer");
    fs.writeFileSync(path.join(out, "answer.txt"), answer);
    if (suite === "discovery") {
      report.cases = grade(JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, "")), metadata.tools);
      report.passed = report.cases.every((c) => c.passed);
    } else report.passed = null; // Actual calls/results need review; prose alone never proves execution.
  } catch (error) { report.passed = false; report.error = error.message; }
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (report.passed === false) process.exitCode = 1;
}
