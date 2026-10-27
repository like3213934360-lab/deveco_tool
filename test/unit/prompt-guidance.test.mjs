import { temporaryDirectory } from "../support/workspace.mjs";
// Metadata coverage, not proof of model behavior. Real host trials live in test/model/eval.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { connect } from "../support/mcp.mjs";
import { promptMetrics } from "../support/prompts.mjs";

test("guidance covers discovery, standalone tools, safe continuation and evidence rules", async () => {
  const state = temporaryDirectory("deveco-guidance-");
  const client = connect({ DEVECO_STATE_DIR: state, DEVECO_CONFIG: path.join(state, "none.json") });
  try {
    const { instructions } = (await client.initialize()).result;
    const { tools } = (await client.request("tools/list")).result;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const rule of [/doctor.*unknown\/failing/, /absolute project paths/, /Before answering.*ArkTS\/ArkUI\/@kit.*knowledge action=search\/read/,
      /exact signatures: code action=lsp op=hover\/definition.*project SDK/, /SDK declarations.*successful build > official docs > community hints/,
      /job action=wait, never repeat/, /Inspect needs_input before resume/,
      /DEVICE_AMBIGUOUS\/TEAM_AMBIGUOUS: ask the user/, /Invalid parameters execute nothing/,
      /summaries.*any returned artifact id.*job action=read artifact_id=<id>.*line\/limit.*grep.*tracked local exports expire after 24h/,
      /consent and setup\/tours automatically.*preserving selected defaults/, /ui act steps=.*ui assert.*save_flow.*then_flow/,
      /Skill placement and updates are user-managed/]) assert.match(instructions, rule);
    for (const t of tools) assert.ok(!t.description.includes(instructions), `${t.name}: server must not duplicate the global prefix`);
    for (const t of tools) {
      assert.match(instructions.slice(0, 512), new RegExp(`\\b${t.name}\\b`), `${t.name}: discoverable before tool loading`);
      if (t.inputSchema.properties.action) {
        assert.ok(t.inputSchema.required.includes("action"), `${t.name}: no inferred/default action`);
        assert.match(t.description, /^Required: action=<operation>\./, `${t.name}: explicit discriminator guidance`);
      }
      for (const action of t.inputSchema.properties.action?.enum ?? [])
        assert.ok(t.description.includes(action), `${t.name}.${action}: explain every advertised action on its own tool`);
    }

    // These constraints must remain on the relevant tool even when other tools are not loaded.
    assert.match(byName.project.description, /Build already checks edited files: no code check first/);
    assert.match(byName.run.description, /build_run: check edited files.*no code check first/);
    assert.match(byName.run.description, /then_flow=.*replay after launch; assert then verifies the final screen/);
    assert.match(byName.run.description, /first build_run on the same device/);
    assert.match(byName.code.description, /compiler is the final judge/);
    assert.match(byName.knowledge.description, /SDK declarations.*successful build win, then official docs; community never defines the API/);
    assert.match(byName.job.description, /resume.*needs_input.*only after inspection/);
    assert.match(byName.job.description, /read:.*artifact.*artifact_id.*line\/limit.*grep/);
    assert.match(byName.device.description, /action=log:.*action=sqlite:/);
    assert.match(byName.code.description, /action=lsp requires op:/);
    assert.match(byName.emulator.description, /license accepts; license_view reads/);
    assert.match(byName.ui.description, /review\(test_id\+requirement\) captures an image; inspect it before review\(test_id\+review_id\+outcome\+reason\)/);
    assert.match(byName.ui.description, /Omit outcome\/review_id on capture/);
    assert.match(byName.ui.inputSchema.properties.review_id.description, /returned image id; never invent/);
    assert.match(byName.ui.inputSchema.properties.outcome.description, /only after seeing the image; omit on capture/);
    assert.match(byName.auth.description, /login_pending=false, logged_in=true, no error/);
    assert.match(byName.auth.description, /logged_in alone may be an old session/);
    assert.match(byName.auth.description, /logout cancels login and deletes credentials/);
    assert.match(byName.emulator.inputSchema.properties.hdc_port.description, /10000-16555.*invalid: ask, never call\/substitute/);
    assert.match(byName.ui.description, /test_step\(test_id, op\/selector or visible\/hidden\)/);
    assert.match(byName.ui.description, /selector\/visible\/hidden: objects, e.g. \{"text":"Hi"\}/);
    for (const name of ["selector", "visible", "hidden"]) {
      assert.equal(byName.ui.inputSchema.properties[name].type, "object");
      assert.equal(byName.ui.inputSchema.properties[name].$ref, "#/$defs/Selector");
      assert.equal(byName.ui.inputSchema.$defs.Selector.type, "object");
    }
    assert.match(byName.ui.description, /act steps=\[.*waits for each element.*stops at first failure/);
    assert.match(byName.ui.description, /after=.*no extra observe/);
    assert.match(byName.ui.description, /app's on-screen elements/);
    assert.match(byName.ui.description, /perf: scroll smoothness\/jank/);
    assert.match(byName.ui.description, /assert.*not screenshots alone/);
    assert.match(byName.ui.description, /agreements_accepted.*preserving defaults.*onboarding_completed/);
    assert.match(byName.ui.description, /window text\/control state, never app names\/fixed IDs/);
    assert.match(byName.ui.description, /If still blocked, observe.*never blindly repeat/);
    assert.match(byName.ui_flow.description, /consent\/setup handling.*inspect.*before retrying/);
    assert.match(byName.sign.description, /Interrupted cloud mutations require reconciliation/);
    assert.match(byName.sign.description, /TEAM_AMBIGUOUS.*ask the user/);
    assert.match(byName.ui.inputSchema.properties.target.description, /Device serial\/name; multiple devices: ask user/);
    assert.match(byName.knowledge.inputSchema.properties.check.description, /status: default true \(online\), false = offline; update: true = check only/);
    assert.match(byName.knowledge.description, /catalog: no parameters/);
    assert.match(byName.diagnose.description, /build: fix hints, diagnostics only \(no project\)/);
    assert.match(byName.skills.inputSchema.properties.scope.description, /Default user; project scope requires scope=project \+ project/);
    assert.match(byName.skills.inputSchema.properties.names.description, /export: skill names \(not name\); default all/);

    // A merged input schema must still explain which action consumes each ambiguous field.
    assert.match(byName.project.description, /request_key\/wait: sync\/build\/clean\/test\/verify only/);
    assert.match(byName.run.description, /launch: project\/product\/target\/module\/ability\/want only/);
    assert.match(byName.run.description, /wait\/request_key: build_run\/deploy only/);
    assert.match(byName.run.description, /hot_reload=true saves baseline after successful launch/);
    assert.match(byName.run.inputSchema.properties.flow_variables.description, /required variables from ui_flow show/);
    assert.match(byName.code.inputSchema.properties.files.description, /check\/api_scan\/lsp diagnostics:.*check uses files, not file/);
    assert.match(byName.code.inputSchema.properties.file.description, /lint\/lsp: one file/);
    assert.match(byName.device.inputSchema.properties.bundle.description, /log:.*sqlite: debuggable app owning db/);
    assert.match(byName.ui.description, /wait\/request_key: layout forms and form/);
    assert.match(byName.ui.inputSchema.properties.test_id.description, /test_step\/review: stored session target; conflicting target rejected/);
    assert.match(byName.ui.inputSchema.properties.test_id.description, /test_finish\/test_log\/test_export need no device/);
    assert.match(byName.ui.inputSchema.properties.assert.description, /test_step uses top-level visible\/hidden, never assert/);
    assert.match(byName.ui.inputSchema.properties.steps.description, /act:.*perf:/);
    assert.match(byName.ui_flow.description, /list\(project\), then show\(project,id\).*supply required variables.*input1/);
    assert.match(byName.ui_flow.description, /wait\/request_key: replay only/);
    assert.match(byName.ui_flow.inputSchema.properties.variables.description, /required\/secret by default/);
    assert.match(byName.auth.inputSchema.properties.provider.description, /login\/logout: default codegenie; status: omitted=both; teams: no parameters/);
    assert.match(byName.sign.description, /csr\(keystore\+keystore_password\+out\).*certificate_create\(csr\+name\+out\).*profile_create\(id=certificate ID,out,bundle or project\).*profile_delete\(id=numeric AGC console profile ID\)/);
    assert.match(byName.sign.description, /wait: auto only/);
    assert.match(byName.project.description, /create\(app_name,bundle_name\)/);
    assert.match(byName.run.inputSchema.properties.then_flow.description, /flow failure does not fail deploy; inspect flow.passed/);
    assert.match(byName.code.inputSchema.properties.file.description, /except workspace_symbols/);
    assert.match(byName.ui.inputSchema.properties.steps.description, /perf: swipe\/fling\/drag\/scroll only/);
    assert.match(byName.ui.inputSchema.properties.fresh_start.description, /requires project/);
    assert.match(byName.ui.inputSchema.properties.then_flow.description, /without required variables/);
    assert.match(byName.ui_flow.inputSchema.properties.id.description, /1-64.*alphanumeric ends/);
    assert.match(byName.knowledge.description, /source=cloud: only query/);
    assert.match(byName.knowledge.inputSchema.properties.limit.description, /search: results; read: characters; update: job wait ms/);
    assert.match(byName.sign.description, /sign: file\+out and project signingConfigs or all keystore\/password\/alias\/cert\/profile fields; verify: file/);
    assert.match(byName.sign.description, /keystore_password>=6 chars/);
    assert.match(byName.emulator.inputSchema.properties.names.description, /name or names, not both/);
  } finally {
    await client.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test("prompt budgets count UTF-8 bytes and every repeated prefix", () => {
  const tools = [{ name: "a", description: "点击" }, { name: "b", description: "查阅" }];
  const metrics = promptMetrics("指引", tools);
  assert.equal(metrics.instructions_bytes, 6);
  assert.equal(metrics.instructions_chars, 2);
  assert.equal(metrics.longest_description_chars, 2);
  assert.equal(metrics.tools_list_bytes, Buffer.byteLength(JSON.stringify({ tools })));
  // Each prefix adds 6 UTF-8 bytes plus two JSON-escaped newlines (4 bytes).
  assert.equal(metrics.repeated_instructions_bytes - metrics.tools_list_bytes, 20);
});
