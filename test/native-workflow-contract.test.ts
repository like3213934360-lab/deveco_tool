import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import {
  createToolCatalog,
  parseConnectionInput,
} from "../src/core/catalog.js";
import { publicWorkflowRunSchema, tools } from "../src/core/contracts.js";

const id = randomUUID();
const hash = "a".repeat(64);
test("workflow discovery enforces action fields and typed workflow inputs", () => {
  const schema = createToolCatalog().find(
    (tool) => tool.name === "workflow_run",
  )!.inputSchema;
  const validate = new AjvJsonSchemaValidator().getValidator(
    JSON.parse(JSON.stringify(schema)),
  );
  const valid = [
    {
      action: "start",
      workflow: "project_build",
      input: { project_path: "/project" },
    },
    {
      action: "start",
      workflow: "crash_diagnose",
      input: { log_text: "Retained evidence" },
    },
    {
      action: "start",
      workflow: "crash_diagnose",
      input: { source_run_id: id, collect_missing: true },
    },
    { action: "status", run_id: id },
    { action: "cancel", run_id: id },
    { action: "resume", run_id: id, resume_input: { action: "recheck" } },
    { action: "list", detail: "full" },
    { action: "read_result", run_id: id },
    { action: "read_result", run_id: id, offset: 20, expected_sha256: hash },
    { action: "read_events", run_id: id, offset: 20, limit: 100 },
    { action: "read_artifact", artifact_id: id, as: "image" },
    { action: "read_artifact", artifact_id: id, offset: 20, limit: 512 },
  ];
  const invalid = [
    { action: "start", workflow: "project_build" },
    {
      action: "start",
      workflow: "project_build",
      input: { project_path: "/project", log_text: "Wrong workflow" },
    },
    { action: "start", workflow: "crash_diagnose", input: { log_file: 123 } },
    {
      action: "start",
      workflow: "crash_diagnose",
      input: { source_run_id: id, target: "relabel" },
    },
    {
      action: "start",
      workflow: "crash_diagnose",
      input: { source_run_id: id, log_text: "relabel" },
    },
    {
      action: "start",
      workflow: "crash_diagnose",
      input: { collect_missing: true },
    },
    {
      action: "start",
      workflow: "project_build",
      input: { project_path: "/project", sync: "maybe" },
    },
    { action: "start", workflow: "shell", input: {} },
    { action: "status" },
    { action: "resume", run_id: id, input: {} },
    { action: "status", run_id: id, request_key: "ignored" },
    { action: "cancel", run_id: id, wait_ms: 10 },
    { action: "list", workflow: "project_build" },
    { action: "read_result", run_id: id, offset: 1 },
    { action: "read_events", run_id: id, limit: 101 },
    { action: "read_artifact", artifact_id: id, as: "image", offset: 1 },
    { action: "read_artifact", artifact_id: id, as: "image", limit: 1 },
    { action: "capacity" },
  ];
  for (const request of valid) {
    assert.equal(validate(request).valid, true, JSON.stringify(request));
    const parsed = publicWorkflowRunSchema.parse(request);
    assert.deepEqual(
      publicWorkflowRunSchema.parse(parsed),
      parsed,
      "Host/Worker parsing is idempotent",
    );
  }
  for (const request of invalid) {
    assert.equal(validate(request).valid, false, JSON.stringify(request));
    assert.equal(
      publicWorkflowRunSchema.safeParse(request).success,
      false,
      JSON.stringify(request),
    );
  }
});

test("storage aliases stay callable while discovery routes storage through maintenance", () => {
  for (const request of [
    { action: "capacity", additional_bytes: 100 },
    { action: "cleanup_plan", run_ids: [id] },
    { action: "cleanup_apply", run_ids: [id], plan_hash: hash },
    { action: "export", run_ids: [id], export_directory: "/new-export" },
    { action: "storage_receipt", receipt_id: hash },
  ]) {
    const alias = parseConnectionInput("workflow_run", request, ["core"]);
    assert.deepEqual(alias, tools.maintenance.schema.parse(request));
    assert.deepEqual(tools.workflow_run.schema.parse(alias), alias);
  }
  assert.throws(() =>
    parseConnectionInput(
      "workflow_run",
      { action: "cleanup_apply", run_ids: [id] },
      ["core"],
    ),
  );
  assert.throws(() =>
    parseConnectionInput("workflow_run", { action: "capacity", run_id: id }, [
      "core",
    ]),
  );
});
