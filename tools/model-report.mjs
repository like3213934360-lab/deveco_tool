// Publish an allowlisted summary; raw model transcripts contain private host/device/account data.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { actualCalls, callSet } from "./model-eval.mjs";

const [directory, output] = process.argv.slice(2);
assert.ok(directory && output, "Usage: model-report.mjs <private trial directory> <summary.json>");
const root = path.resolve(directory), trials = [], capabilities = new Map();
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function providerEvidence(directory, calls) {
  const requests = fs.readdirSync(directory).filter((name) => /^provider-\d+\.request\.json$/.test(name));
  if (!requests.length) return undefined;
  const schemas = new Set(), providerCalls = [], selectorTypes = {};
  let responses = 0, malformedArguments = 0;
  for (const file of requests) {
    const request = read(path.join(directory, file));
    const ui = request.tools.find((t) => (t.function?.name ?? t.name) === "deveco_ui");
    const schema = (ui.function ?? ui).parameters, selector = schema.properties.selector;
    schemas.add(JSON.stringify({ selector_type: selector.type ?? null, reference_type: schema.$defs?.Selector?.type ?? null }));
    const response = path.join(directory, file.replace(".request.json", ".response.txt"));
    if (!fs.existsSync(response)) continue;
    responses++;
    const chat = new Map(), completed = [];
    for (const line of fs.readFileSync(response, "utf8").split("\n").filter((s) => s.startsWith("data: ") && s !== "data: [DONE]")) {
      const event = JSON.parse(line.slice(6));
      if (event.type === "response.output_item.done" && event.item.type === "function_call") completed.push(event.item);
      for (const part of event.choices?.[0]?.delta?.tool_calls ?? []) {
        const call = chat.get(part.index) ?? { name: "", arguments: "" };
        call.name += part.function?.name ?? ""; call.arguments += part.function?.arguments ?? "";
        chat.set(part.index, call);
      }
    }
    for (const call of [...chat.values(), ...completed].filter((c) => c.name.startsWith("deveco_"))) {
      let args;
      try { args = JSON.parse(call.arguments); } catch { malformedArguments++; continue; }
      providerCalls.push({ tool: call.name, arguments: args });
      if (call.name === "deveco_ui" && "selector" in args) {
        const type = args.selector === null ? "null" : Array.isArray(args.selector) ? "array" : typeof args.selector;
        selectorTypes[type] = (selectorTypes[type] ?? 0) + 1;
      }
    }
  }
  return { requests: requests.length, captured_responses: responses, schemas: [...schemas].map(JSON.parse),
    provider_calls: providerCalls.length, malformed_arguments: malformedArguments, selector_argument_types: selectorTypes,
    matches_mcp_calls: requests.length === responses && malformedArguments === 0 && JSON.stringify(callSet(providerCalls)) === JSON.stringify(callSet(calls)) };
}
const category = (report) => report.timed_out ? "deadline" : !report.error ? undefined
  : /forbidden operation/.test(report.error) ? "blocked-operation"
  : /host process|host\/provider/.test(report.error) ? "host-or-provider"
  : /JSON/.test(report.error) ? "invalid-model-json"
  : /outside the MCP|external context/.test(report.error) ? "outside-test-scope"
  : /host and server calls/.test(report.error) ? "transport-mismatch" : "acceptance-error";
function visit(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) visit(file);
    else if (item.name === "catalog.txt") {
      for (const match of fs.readFileSync(file, "utf8").matchAll(/^(opencode\/[^\n]+)\n(\{[\s\S]*?^\})/gm)) {
        const model = JSON.parse(match[2]);
        capabilities.set(match[1], { model: match[1], input: model.capabilities.input,
          toolcall: model.capabilities.toolcall, catalog_sha256: hash(file) });
      }
    } else if (item.name === "report.json") {
      const report = read(file);
      if (!report.host || !report.suite || !report.entry) continue;
      const traceFile = path.join(directory, "transport.jsonl");
      const trace = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
      const calls = actualCalls(trace);
      const completed = (c) => c.succeeded && (!c.pending || calls.some((done) => done.succeeded && !done.pending
        && done.result?.job_id === c.result?.job_id && done.result?.status === "succeeded"));
      const counts = {};
      for (const c of calls) {
        const key = `${c.tool}${c.arguments.action ? `.${c.arguments.action}` : ""}`;
        const count = counts[key] ??= { requested: 0, replied: 0, completed: 0, errors: {} };
        count.requested++;
        if (c.received) count.replied++;
        if (completed(c)) count.completed++;
        else if (c.received && !c.succeeded) {
          const code = c.result?.error?.code ?? c.result?.status ?? "assertion-failed";
          count.errors[code] = (count.errors[code] ?? 0) + 1;
        }
      }
      const inspection = path.join(directory, "inspection.json");
      const inspected = fs.existsSync(inspection) ? read(inspection) : undefined;
      const models = report.models ?? inspected?.models ?? [];
      const observationFile = path.join(directory, "host-observation.json");
      const observation = fs.existsSync(observationFile) ? read(observationFile) : undefined;
      const eventsFile = path.join(directory, "events.jsonl");
      const hostErrors = fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, "utf8").split("\n").filter((line) => line.startsWith("{"))
        .map(JSON.parse).filter((event) => event.type === "error").map((event) => ({
          name: event.error?.name, status_code: event.error?.data?.statusCode,
        })) : [];
      const evidence = Object.fromEntries(fs.readdirSync(directory).filter((name) => fs.statSync(path.join(directory, name)).isFile())
        .map((name) => [name, hash(path.join(directory, name))]));
      trials.push({ trial: path.relative(root, directory), host: report.host, host_version: report.version, suite: report.suite,
        requested_model: report.requested_model, observed_models: models, identity_confirmed: models.length === 1 && models[0] === report.requested_model,
        server_version: report.server_version, build_id: /builds[\\/]([a-f0-9]{64})-/.exec(report.entry)?.[1],
        passed: report.passed, interrupted: fs.existsSync(path.join(directory, "interrupted.json")), error_category: category(report),
        host_errors: hostErrors,
        host_observation: observation && { category: observation.kind, source: observation.source, error_count: observation.errors.length,
          first_at: observation.errors[0]?.at, last_at: observation.errors.at(-1)?.at },
        provider_evidence: providerEvidence(directory, calls),
        elapsed_ms: report.elapsed_ms, cases: report.cases?.map((c) => ({ id: c.id, passed: c.passed,
          failures: c.failures.map((f) => ({ kind: Object.keys(f)[0], tool: (f.missing ?? f.forbidden ?? f.invalid_call)?.tool,
            action: (f.missing ?? f.forbidden ?? f.invalid_call)?.arguments?.action,
            fields: Object.keys((f.missing ?? f.forbidden ?? f.invalid_call)?.arguments ?? {}) })) })),
        completed_calls: calls.filter(completed).length, requested_calls: calls.length, calls_by_action: counts,
        blocked_calls: trace.filter((e) => e.direction === "blocked").map((e) => ({ tool: e.message.params.name, action: e.message.params.arguments?.action })),
        metadata_sha256: report.metadata_sha256, evidence });
    }
  }
}
visit(root);
trials.sort((a, b) => a.trial.localeCompare(b.trial));
fs.writeFileSync(output, JSON.stringify({ note: "Planning scores, successful transport calls and whole-trial acceptance are distinct. completed_calls counts successful protocol results and resolved jobs, not independent artifact or functional verification. Interrupted/provider/model failures remain failures. Modality declarations determine applicability, not successful visual understanding. No raw paths, device identities, credentials or tool arguments are published.",
  model_capabilities: [...capabilities.values()].sort((a, b) => a.model.localeCompare(b.model)), trials }, null, 2) + "\n");
console.log(JSON.stringify({ trials: trials.length, output }));
