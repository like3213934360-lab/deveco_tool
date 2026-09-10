import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { tools } from "../src/core/contracts.js";

test("UI flow action schemas reject recording/replay confusion and publish distinct discovery branches", () => {
  const schema = tools.ui_flow.schema;
  assert.equal(
    schema.safeParse({ action: "run", id: "saved", mode: "attach" }).success,
    false,
  );
  assert.equal(schema.safeParse({ action: "run", id: "saved" }).success, true);
  assert.equal(schema.safeParse({ action: "run" }).success, false);
  assert.equal(
    schema.safeParse({
      action: "record_start",
      id: "new",
      name: "New",
      route: { ability: "EntryAbility" },
      mode: "attach",
    }).success,
    true,
  );
  assert.equal(
    schema.safeParse({ action: "record_start", id: "new", name: "New" })
      .success,
    false,
  );
  assert.equal(
    schema.safeParse({
      action: "record_status",
      recording_id: "bfba68b3-4064-4bc4-a9c9-9db7ba39fb19",
      project_path: "/other",
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ action: "navigate", goal: "Open the settings" }).success,
    true,
  );
  const json = z.toJSONSchema(schema, { io: "input" }) as { oneOf?: unknown[] };
  assert.equal(json.oneOf?.length, 12);
  const branches = json.oneOf as {
    properties: Record<string, { const?: string } | false>;
    required?: string[];
  }[];
  const run = branches.find(
    (branch) =>
      branch.properties.action && branch.properties.action.const === "run",
  )!;
  assert.deepEqual(run.properties.mode, { not: {} });
  assert.ok(run.required!.includes("id"));
  assert.equal(
    tools.verify_ui.schema.safeParse({ capture: { format: "jpeg" } }).success,
    false,
  );
  assert.equal(
    tools.ui_snapshot.schema.safeParse({
      mode: "image",
      capture: { format: "jpeg" },
    }).success,
    true,
  );
});
