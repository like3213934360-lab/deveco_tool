// Real installed hosts and their configured models. No synthetic tool responses or provider fallback.
// Discovery evaluates proposed calls, not execution. Live trials retain the actual host/tool transcript.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { connect } from "./mcp-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const scenarios = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/model-scenarios.json"), "utf8"));
export const actionScenarios = [...scenarios, ...JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/model-actions.json"), "utf8"))];
const matches = (actual, expected) => Array.isArray(expected)
  ? Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => matches(actual[i], v))
  : expected !== null && typeof expected === "object"
  ? actual !== null && typeof actual === "object" && Object.entries(expected).every(([k, v]) => matches(actual[k], v))
  : actual === expected;
// Host/provider-qualified names are presentation aliases, not alternate tools or fuzzy matches.
const toolName = (name) => name.replace(/^(?:mcp__deveco__|(?:default\.)?deveco_)/, "");
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
const readEvents = (file) => fs.readFileSync(file, "utf8").split("\n").filter((s) => s.startsWith("{")).map((s) => JSON.parse(s));
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
export const callSet = (calls) => calls.map((c) => JSON.stringify(canonical([toolName(c.tool), c.arguments]))).sort();
export const unfinishedJobs = (calls) => calls.filter((c) => c.pending && !calls.some((done) => done.succeeded && !done.pending
  && done.result?.job_id === c.result?.job_id && done.result?.status === "succeeded")).map((c) => c.result?.job_id);

export function grade(plans, tools, cases = scenarios) {
  assert.ok(Array.isArray(plans), "model response must be a JSON array");
  assert.equal(new Set(plans.map((p) => p.id)).size, plans.length, "duplicate scenario ids");
  assert.deepEqual(plans.map((p) => p.id).sort(), cases.map((s) => s.id).sort(), "scenario set must match");
  const schemas = Object.fromEntries(tools.map((t) => [t.name, z.fromJSONSchema(t.inputSchema).strict()]));
  return cases.map((s) => {
    const plan = plans.find((p) => p.id === s.id);
    assert.ok(Array.isArray(plan.calls), `${s.id}: calls must be an array`);
    const calls = plan.calls.map((c) => ({ tool: toolName(c.tool), arguments: c.arguments }));
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

/** Transport evidence is separate from both model prose and host UI events. */
export function actualCalls(trace) {
  const requests = trace.filter((e) => e.direction === "request" && e.message.method === "tools/call");
  const responses = new Map(trace.filter((e) => e.direction === "response").map((e) => [e.message.id, e.message]));
  return requests.map(({ message: { id, params } }) => {
    const response = responses.get(id);
    const text = response?.result?.content?.find((c) => c.type === "text")?.text;
    const result = text === undefined ? undefined : JSON.parse(text);
    return { tool: params.name, arguments: params.arguments ?? {}, result,
      received: !!response, succeeded: !!response?.result && !response.result.isError && !result?.error && result?.passed !== false
        && !["failed", "cancelled", "interrupted", "needs_input"].includes(result?.status),
      pending: ["running", "queued"].includes(result?.status) };
  });
}

export function gradeLive(calls, tools, cases) {
  const plans = cases.map((s) => ({ id: s.id, calls, notes: "" }));
  const input = ({ result, ...call }) => call;
  const succeeded = (expected) => calls.some((c) => c.succeeded && matches(c, input(expected))
    && (expected.result === undefined || matches(c.result, expected.result)));
  const results = grade(plans, tools, cases.map((s) => ({ ...s, expect: s.expect.map(input), one_of: s.one_of?.map(input) })));
  for (const result of results) {
    const s = cases.find((s) => s.id === result.id);
    for (const expected of s.expect) if (!succeeded(expected)) result.failures.push({ missing_successful_call: expected });
    if (s.one_of && !s.one_of.some(succeeded)) result.failures.push({ missing_successful_alternative: s.one_of });
    result.passed = result.failures.length === 0;
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  assert.ok(args.length % 2 === 0, "Usage: model-eval.mjs --host codex|opencode --suite discovery|live --out <new directory> [--model provider/id] [--cases file.json] [--entry cli.js] [--project path]");
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(["--host", "--suite", "--out", "--entry", "--project", "--model", "--cases", "--capture-provider"].includes(args[i]), `Unknown option ${args[i]}`);
    options[args[i].slice(2)] = args[i + 1];
  }
  const { host, suite } = options;
  assert.ok(["codex", "opencode"].includes(host) && ["discovery", "live"].includes(suite) && options.out);
  assert.ok(!options.model || host === "opencode", "Explicit model selection is supported for OpenCode trials");
  assert.ok(!options["capture-provider"] || host === "opencode" && options["capture-provider"] === "true", "Provider observation requires OpenCode and --capture-provider true");
  const out = path.resolve(options.out);
  assert.ok(!fs.existsSync(out), "Use a new output directory; never overwrite a failed trial");
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
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
  const cases = options.cases === "all" ? actionScenarios : options.cases ? JSON.parse(fs.readFileSync(path.resolve(options.cases), "utf8")) : scenarios;
  const prompt = suite === "discovery"
    ? "这是工具发现与参数理解验收。仅依据当前可见的 MCP 工具说明，为下面每项独立需求给出拟调用方案，不实际执行这些操作。可以搜索/加载工具定义；不要读取仓库、文件、Skill、历史会话或网络文档，也不要调用终端。每项给出必要的工具调用与完整参数，不猜造工具名。仅返回 JSON 数组，每项为 {id,calls:[{tool,arguments}],notes}。示例路径和设备均为规划数据，不要访问。\n" + JSON.stringify(cases.map(({ id, goal }) => ({ id, goal })))
    : "这是真实调用验收。请通过现有 MCP 实际完成以下需求；按返回值继续等待任务、读取产物和验证结果。仅可调用 deveco MCP 工具，不调用宿主任务清单、终端、文件、Skill 或其他工具；不修改需求、模型、SDK 或宿主配置。失败如实报告，不将拟调用方案或 running 状态称为完成。\n" + (options.cases
      ? JSON.stringify(cases.map(({ id, goal }) => ({ id, goal })))
      : `只读核实环境、连接设备、工程 ${options.project} 的 SDK/模块，并检索和读取 ArkUI @Local 官方说明。报告服务器版本/构建 ID 和来源，不构建、部署、登录或改变设备状态。`);
  if (suite === "live" && !options.cases) assert.ok(options.project && path.isAbsolute(options.project), "live requires --cases or --project");
  fs.writeFileSync(path.join(out, "prompt.txt"), prompt);
  const casesFile = path.join(out, "cases.json");
  fs.writeFileSync(casesFile, JSON.stringify(cases, null, 2) + "\n", { mode: 0o600 });
  const server = { command: process.execPath, args: [path.join(root, "tools/model-proxy.mjs"), entry, path.join(out, "transport.jsonl"), casesFile] };
  const env = { ...process.env };
  const argv = host === "codex"
    ? ["exec", "--json", "--ephemeral", "-s", "read-only", "-c", `mcp_servers.deveco.command=${JSON.stringify(server.command)}`, "-c", `mcp_servers.deveco.args=${JSON.stringify(server.args)}`, "-o", path.join(out, "answer.txt"), "-"]
    : ["run", "--format", "json", ...(options.model ? ["--model", options.model] : []), prompt];
  if (host === "opencode") {
    if (options["capture-provider"]) env.DEVECO_MODEL_CAPTURE = out;
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ mcp: { deveco: { type: "local", command: [server.command, ...server.args], enabled: true } },
      ...(options["capture-provider"] ? { plugin: [pathToFileURL(path.join(root, "tools/model-capture.mjs")).href] } : {}) });
  }
  const version = execFileSync(host, ["--version"], { encoding: "utf8" }).trim();
  const started = Date.now(), stdout = fs.openSync(path.join(out, "events.jsonl"), "w"), stderr = fs.openSync(path.join(out, "stderr.txt"), "w");
  const child = spawn(host, argv, { cwd: root, env, stdio: ["pipe", stdout, stderr], detached: process.platform !== "win32" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; process.platform === "win32" ? child.kill() : process.kill(-child.pid, "SIGTERM"); }, 600000);
  child.stdin.end(host === "opencode" ? undefined : prompt);
  const exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  clearTimeout(timer); fs.closeSync(stdout); fs.closeSync(stderr);
  const events = readEvents(path.join(out, "events.jsonl"));
  const report = { host, version, suite, requested_model: options.model, server_version: metadata.serverInfo.version, entry,
    metadata_sha256: hash(JSON.stringify(metadata)), prompt_sha256: hash(prompt), scenarios_sha256: hash(JSON.stringify(cases)),
    exit_code: exitCode, timed_out: timedOut, elapsed_ms: Date.now() - started };
  try {
    const traceFile = path.join(out, "transport.jsonl");
    const trace = fs.existsSync(traceFile) ? readEvents(traceFile) : [];
    report.calls = actualCalls(trace); // Retain partial execution even when the host/provider fails.
    report.blocked_calls = trace.filter((e) => e.direction === "blocked").map((e) => e.message.params);
    assert.equal(report.blocked_calls.length, 0, "model attempted a forbidden operation; request was not forwarded");
    assert.equal(exitCode, 0, "host process failed"); assert.equal(timedOut, false, "host deadline exceeded");
    assert.ok(!events.some((e) => e.type === "error"), "host/provider reported an error; inspect events.jsonl");
    const listed = trace.find((e) => e.direction === "response" && e.message.result?.tools)?.message.result.tools;
    assert.deepEqual(listed, metadata.tools, "host must load the pinned tool metadata");
    if (host === "opencode") {
      const session = events.find((e) => e.sessionID)?.sessionID;
      assert.ok(session, "missing OpenCode session id");
      // OpenCode can exit before a piped stdout flushes a large export. A regular file descriptor
      // preserves its complete output; no truncation repair or guessed model identity is accepted.
      const sessionFile = path.join(out, "session.json"), fd = fs.openSync(sessionFile, "wx", 0o600);
      try { execFileSync(host, ["export", session], { stdio: ["ignore", fd, "pipe"] }); }
      finally { fs.closeSync(fd); }
      const messages = JSON.parse(fs.readFileSync(sessionFile, "utf8")).messages.filter((m) => m.info.role === "assistant");
      report.models = [...new Set(messages.map((m) => `${m.info.providerID}/${m.info.modelID}`))];
      assert.equal(report.models.length, 1, "missing or changed model identity");
      if (options.model) assert.equal(report.models[0], options.model, "host model differs from requested model");
      const hostCalls = events.filter((e) => e.type === "tool_use").map((e) => e.part);
      report.host_tools = hostCalls.map((c) => c.tool);
      if (suite === "discovery") assert.equal(hostCalls.length, 0, "discovery executed tools or read external context");
      else {
        assert.ok(hostCalls.every((c) => c.tool.startsWith("deveco_")), "live trial used tools outside the MCP");
        assert.deepEqual(callSet(hostCalls.map((c) => ({ tool: c.tool, arguments: c.state.input }))), callSet(report.calls), "host and server calls differ");
      }
    }
    const answer = host === "codex" ? fs.readFileSync(path.join(out, "answer.txt"), "utf8")
      : events.filter((e) => e.type === "text").map((e) => e.part.text).join("\n");
    assert.ok(answer, "host returned no model answer");
    fs.writeFileSync(path.join(out, "answer.txt"), answer);
    if (suite === "discovery") {
      assert.equal(report.calls.length, 0, "planning must not execute MCP calls");
      report.cases = grade(JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, "")), metadata.tools, cases);
      report.passed = report.cases.every((c) => c.passed);
    } else if (options.cases) {
      report.cases = gradeLive(report.calls, metadata.tools, cases);
      report.unfinished_jobs = unfinishedJobs(report.calls);
      report.passed = report.cases.every((c) => c.passed) && report.calls.every((c) => c.succeeded) && report.unfinished_jobs.length === 0;
    } else report.passed = null; // Unspecified result assertions still require manual review.
  } catch (error) { report.passed = false; report.error = error.message; }
  report.evidence = Object.fromEntries(fs.readdirSync(out).filter((f) => f !== "report.json").map((f) => [f, hash(fs.readFileSync(path.join(out, f)))]));
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ host, suite, models: report.models, passed: report.passed, cases: report.cases?.filter((c) => c.passed).length,
    total: report.cases?.length, calls: report.calls?.length, error: report.error, out }));
  if (report.passed === false) process.exitCode = 1;
}
