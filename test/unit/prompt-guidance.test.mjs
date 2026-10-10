// These are model-facing behavioral contracts, not an exact wording snapshot.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect } from "../../tools/mcp-client.mjs";
import { promptMetrics } from "../../tools/prompt-audit.mjs";

test("compact metadata retains tool selection, safe continuation and evidence rules", async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "deveco-guidance-"));
  const client = connect({ DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") });
  try {
    const { instructions } = (await client.initialize()).result;
    const { tools } = (await client.request("tools/list")).result;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const rule of [/doctor.*unknown\/failing/, /absolute project paths/, /Before answering.*ArkTS\/ArkUI\/@kit.*knowledge search\/read/,
      /exact signatures: code lsp hover\/definition/, /job action=wait.*never repeat.*needs_input.*inspection/,
      /DEVICE_AMBIGUOUS\/TEAM_AMBIGUOUS: ask the user/, /Invalid parameters execute nothing/,
      /summaries.*job action=read artifact_id=<id>.*any returned artifact id.*1 day/]) assert.match(instructions, rule);
    for (const t of tools) assert.ok(!t.description.includes(instructions), `${t.name}: server must not duplicate the global prefix`);

    // These constraints must remain on the relevant tool even when other tools are not loaded.
    assert.match(byName.project.description, /Build already checks edited files: no code check first/);
    assert.match(byName.run.description, /build_run: check edited files.*no code check first/);
    assert.match(byName.run.description, /then_flow=.*assert verifies/);
    assert.match(byName.code.description, /compiler is the final judge/);
    assert.match(byName.knowledge.description, /SDK declarations.*successful build win, then official docs; community never defines the API/);
    assert.match(byName.job.description, /resume.*needs_input.*after checking it/);
    assert.match(byName.job.description, /read:.*artifact.*line.*grep/);
    assert.match(byName.ui.description, /act steps=\[.*waits for each element.*stops at first failure/);
    assert.match(byName.ui.description, /after=.*no extra observe/);
    assert.match(byName.ui.description, /assert.*not screenshots alone/);
    assert.match(byName.ui.description, /agreements_accepted.*preserving defaults.*onboarding_completed/);
    assert.match(byName.ui.description, /window text\/control state, never app names\/fixed IDs/);
    assert.match(byName.ui.description, /If still blocked, observe.*never blindly repeat/);
    assert.match(byName.ui_flow.description, /consent\/setup handling.*inspect.*before retrying/);
    assert.match(byName.sign.description, /Interrupted cloud mutations require reconciliation/);
    assert.match(byName.sign.description, /TEAM_AMBIGUOUS.*ask the user/);
    assert.match(byName.ui.inputSchema.properties.target.description, /ask the user when several/);
  } finally {
    await client.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test("prompt budgets count UTF-8 bytes and every repeated prefix", () => {
  const tools = [{ name: "a", description: "点击" }, { name: "b", description: "查阅" }];
  const metrics = promptMetrics("指引", tools);
  assert.equal(metrics.instructions_bytes, 6);
  assert.equal(metrics.tools_list_bytes, Buffer.byteLength(JSON.stringify({ tools })));
  // Each prefix adds 6 UTF-8 bytes plus two JSON-escaped newlines (4 bytes).
  assert.equal(metrics.repeated_instructions_bytes - metrics.tools_list_bytes, 20);
});
