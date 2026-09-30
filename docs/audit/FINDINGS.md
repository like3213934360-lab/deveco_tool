# 审计结论明细（自动生成）

由 `node test/audit/report.mjs` 从 `docs/audit/findings.jsonl` 生成；同一编号以最后一次记录为准。

共 381 项：VERIFIED 371，DEFECT 0，UNVERIFIED 4，INFERRED 6。

## DEFECT

| 编号 | 结论摘要 | 证据 |
| --- | --- | --- |

## UNVERIFIED

| 编号 | 结论摘要 | 证据 |
| --- | --- | --- |
| B.code.check.project.mytestapp | hvigor refuses to build this project (00306003 Invalid project path: path contains non-ASCII characters), so checker's 290 errors cannot be compared with the compiler here; excluded from false-positive statistics | `docs/audit/evidence/check-rules/project-mytestapp.json` |
| B.code.check.project.settings_fixture | not a buildable project (build-profile.json5 declares no products, no .ets sources); excluded from check/build comparison | `docs/audit/evidence/check-rules/project-settings_fixture.json` |
| C.syscap-classify.e2e_acceptance | no device_compat (build succeeded; no compile warnings of this kind) | `docs/audit/evidence/syscap/classification.json` |
| E.cross-platform.untested | never executed against a real toolchain outside macOS: Windows default install path 'C:\\Program Files\\Huawei\\DevEco Studio' (toolchain.ts:29), .exe lookups for hdc/java/clangd, node.exe path, taskkill tree kill (proc.ts:37), rundll32 URL opener (auth.ts:147), %LOCALAPPDATA%\\Huawei emulator license dir (emulator.ts:82), %APPDATA% host configs for trae-cn/qoder. Linux: empty default path (DEVECO_HOME or config required), xdg-open, no emulator. The /private realpath handling (project.ts:196, hotreload.ts:68, code.ts:362) is macOS-verified only |  |

## INFERRED

| 编号 | 结论摘要 | 证据 |
| --- | --- | --- |
| A.upstream.semantic-method | semantic review covered the high-risk command groups (run/install/uninstall/launch/smoke, build/sync, log, ui input/layout/screenshot/windows, device selection, emulator scenario/images, create api level, sqlite) against upstream source lines and on device; 8 behaviour gaps found where names were 'full' but behaviour differs (device name, module@target, ohpm install per build, build-mode validation, layout depth, ui text focused, uninstall classification, proxy env). The remaining 'full' option items were checked for presence and default only (schema-level), not each executed — their semantic parity is not proven |  |
| B.real-sign.auto-profile-leak | revised after the user's AGC console check (6 profiles, none named audit_*): profiles created through the IDE endpoint (ide/test/provision/add, the same one DevEco Studio's automatic signing uses) do not appear in the console's profile list, so the 'leak into the user's AGC list' did not happen; whether AGC counts them toward a quota is not observable |  |
| B.real-sign.lifecycle | certificate_create not executed against the real account: the user confirmed debug certificates can always be generated (DevEco's auto signing replaces its own auto_debug_<team>.cer); an additional named certificate hit the quota (205389872), which now yields a specific hint. After deleting MCPValidationd98b7ba2 there is room for one more certificate; not used, to keep the account unchanged |  |
| C.syscap-hvigor-bugs.note | numbers changed since the earlier report (192 warnings / 106 false) to 191 / 105: LingDong sources were edited by the user between runs (see E.no-modify); the classification method (range-aware @syscap tag from LSP hover + SDK device-define sets) is the same as src/domains/syscap.ts, so its independent confirmation is the controlled experiments S1/S2 (hvigor output on minimal projects), not this re-count | `docs/audit/evidence/syscap/lingdong-full.json`<br>`docs/audit/evidence/syscap/experiments.json` |
| D.text.22 | tools/list skills.description: "scope=project writes <project>/.agents/skills, shared by Codex, Claude Code, Cursor, Qoder, OpenCode" — path written verified (B.action.skills.export/init); whether each host actually reads .agents/skills was not tested per host in this audit | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| E.cross-platform.linux-default | Linux has no default toolchain path (toolchain.ts:27-30 falls back to ''), so every tool reports TOOLCHAIN_MISSING with the hint to set DEVECO_CONFIG until the user configures it. By design (Command Line Tools location varies); not verified on Linux | `src/core/toolchain.ts` |

## VERIFIED

| 编号 | 结论摘要 | 证据 |
| --- | --- | --- |
| A.agc.error-mapping | fixed: hints for 205389872 (certificate limit: delete an unused one after asking, or use auto which replaces its own auto_debug certificate), 205389904 (account not enabled for HarmonyOS in this team), 205389830 (profile name taken), in addition to 205389938 / 205389859 |  |
| A.upstream.build.build-mode | fixed: mode validated against debug/release + buildModeSet before hvigor runs (mode=bogus -> INVALID_INPUT 'Available modes: debug, release') |  |
| A.upstream.build.module-target | fixed: modules accept name@target (build/build_run/deploy); an unknown target fails with the valid choices (entry@nosuch -> 'Use one of: entry@default') |  |
| A.upstream.build.ohpm-install | adding a local dependency after the first build: second build succeeds without an explicit sync (hvigor resolves it) | `docs/audit/evidence/upstream/build-after-dependency-change.json` |
| A.upstream.create.api-level | compatible_api=12 -> compatibleSdkVersion": "5.0.0(12)", | `docs/audit/evidence/upstream/create-api.json` |
| A.upstream.device-by-name | fixed: target accepts a device name or model as well as the serial (device info target='HUAWEI Pura 80 Pro' -> 4VF0225613017854); several devices without target -> DEVICE_AMBIGUOUS listing name/model/emulator/device_type/matches_project and telling the agent to ask the user |  |
| A.upstream.device.sqlite-readonly | write SQL without write=true -> INVALID_INPUT | `docs/audit/evidence/upstream/sqlite-readonly.json` |
| A.upstream.emulator.image-list | images parsed into rows (like upstream): 4 downloaded, e.g. {"device_type":"phone","os_version":"HarmonyOS 7.0.0(26.0.0)","software_version":"7.0.0.107","downloaded":true,"upgradable":false,"release":"Release"} | `docs/audit/evidence/upstream/images-rows.json` |
| A.upstream.emulator.scenario-validation | out-of-range values are rejected by the Emulator itself with a clear message that we surface as EMULATOR_FAILED (latitude 200, light -5); upstream validates the same ranges client-side before calling. Outcome equivalent (error + reason), ours is one process call later. heartrate on this phone emulator: 'supported sensors are: light, steps' (device-dependent, correctly reported). gps city is accepted by the Emulator though upstream has no --city option | `docs/audit/evidence/upstream/emulator-scenario-validation.json` |
| A.upstream.host-skip | reviewed all 112 host/skip items one by one: 70 host = the upstream agent's own generic tools/modes (file read/write/edit/glob/grep, bash, web fetch/search, plan/todo/question/task, agent modes, initialize/review) that every MCP host provides; 42 skip = 26 human --format table/text switches (MCP returns JSON), devecocli self-update (2), DevEco-Code-only skills/spec prompts (user decision, 13), switch_cwd (explicit project path per call). Every reason holds; none is a HarmonyOS capability |  |
| A.upstream.init.mcp-hosts | MCP config table for the 8 upstream MCP agents (cursor, claude-code, codex, opencode, trae-cn, codebuddy, qoder, pi): global and project paths identical, file formats identical (standard mcpServers / opencode 'mcp' / codex TOML mcp_servers); entries are {type:'stdio',command,args,env}. Differences by design: command is this server's node + dist/cli.js mcp instead of 'devecocli serve mcp', and no PROJECT_PATH env (our tools take an explicit project per call). Upstream MCP table has no atomcode/dsh entries (skills only) |  |
| A.upstream.log.crash | crash for bundle with a known crash (rules pass-2 appstorage case): BusinessError @Component 'owning @Component UNKNOWN': Illegal variable value error with decorated variable undefin | `docs/audit/evidence/upstream/log-crash.json` |
| A.upstream.log.keyword | grep 'ability\|Ability' over 2000 lines -> 18 matches, 0 non-matching lines (upstream --keyword uses hilog -e regex on device; ours filters locally, case-insensitive) | `docs/audit/evidence/upstream/log-grep.json` |
| A.upstream.log.level | behaviour differs by design and is documented: upstream --level W shows only W lines (hilog -L W); ours level=W shows W and above (-L W,E,F), matching our schema text 'minimum level'. Verified on the phone that both hilog forms behave as described | `docs/audit/evidence/upstream/log-level.txt` |
| A.upstream.log.tail | lines=5 -> 5 lines returned (upstream --tail N = latest N lines) | `docs/audit/evidence/upstream/log-lines.json` |
| A.upstream.new-commits | upstream moved during the audit: deveco-cli 8f69118->4a5730f (5 commits), deveco-code 9a55cd6->a7ae14c24 (2 commits). Reviewed every diff: cli = telemetry/memory-tracker (opt-out, RSS polling), doc search telemetry field, ArkTS LSP init progress messages in its own MCP arkts-check tool (retry text/progress), dependency-parse progress callback — no new command/option/tool; code = Codex gpt-6 model listing (host-side, not applicable) and proxy env for Huawei auth (see A.upstream.new.proxy-env). Alignment gate: 467 items unchanged, 0 gaps |  |
| A.upstream.new.proxy-env | MCP server with HTTPS_PROXY: 1 CONNECT(s) through the proxy (matrix.openharmony.cn:443), request failed as the test proxy refuses; without proxy variables: 0 proxy connects, request ok | `docs/audit/evidence/upstream/proxy-mcp.json` |
| A.upstream.run.install | install: upstream always uses mkdir + file send + 'bm install -p <dir>' (no -r) and checks 'install bundle successfully.'; ours uses 'hdc install -r' for one package and 'bm install -p <dir> -r' for several, same success marker; replace (-r) keeps app data like DevEco Studio. Different command, equivalent outcome; our multi-package path matches upstream plus -r |  |
| A.upstream.run.smoke-blank | same verdict as upstream on 7/8 synthetic images (solid white/black/grey, status-bar only, small text, normal UI). Differs on a smooth full-screen vertical gradient: upstream pHash (median-threshold of 32x32 DCT) calls it blank (hamming 0), ours does not (uniform 5.6%). A gradient is not a blank screen, so ours is stricter-correct here; also upstream waits 1000 ms after launch (DEVECO_CLI_SMOKE_WAIT_MS), ours observes 3000 ms | `docs/audit/evidence/upstream/blank-verdict.json` |
| A.upstream.run.uninstall | installed -> {"bundle":"com.devecomcp.upfix","uninstalled":true}; not installed -> {"bundle":"com.devecomcp.upfix","uninstalled":false,"reason":"not_installed"}; other failures now raise UNINSTALL_FAILED (like devecocli) | `docs/audit/evidence/upstream/uninstall-fixed.json` |
| A.upstream.skills.agents | project export: atomcode -> /var/folders/dm/cg7mvtkd3px6hy3cm0lgpvwc0000gn/T/audit-upfix-sRVyxV/U/.atomcode/skills, dsh -> /var/folders/dm/cg7mvtkd3px6hy3cm0lgpvwc0000gn/T/audit-upfix-sRVyxV/U/.dsh/skills (upstream AGENT_SKILLS_CONFIG / getProjectAgentSkillsDir) | `docs/audit/evidence/upstream/skills-agents-fixed.json` |
| A.upstream.ui.layout-depth | lines: omitted 64, depth=0 64 (unlimited), depth=1 1 (root only), depth=2 3 (root+children) | `docs/audit/evidence/upstream/ui-depth-fixed.json` |
| A.upstream.ui.screenshot-display | display=0 -> ok; display=99 -> SCREENSHOT_FAILED: snapshot_display failed: error: displayId 99 invalid! tips: supported displayIds: 	0 | `docs/audit/evidence/upstream/ui-screenshot-display.json` |
| A.upstream.ui.text-focused | correction of my earlier DEFECT: upstream 'ui text <text>' (focused field) maps to our op='type' (returns performed:type); op='input' is the targeted variant (upstream inputText x y / --id). My first test used the wrong op | `docs/audit/evidence/upstream/ui-type-focused.json` |
| A.upstream.ui.window-all | windows: default 1, all=true 29 (upstream --all adds system windows) | `docs/audit/evidence/upstream/ui-windows.json` |
| B.action.auth.import.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/auth.import.failure.json` |
| B.action.auth.login.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/auth.login.failure.json` |
| B.action.auth.logout | logout on an isolated state dir: {"provider":"codegenie","logged_in":false}; status afterwards all logged_out=true (real login untouched) | `docs/audit/evidence/actions/auth.logout.isolated.json` |
| B.action.auth.status.success | success path as expected (2 ms) | `docs/audit/evidence/actions/auth.status.success.json` |
| B.action.auth.teams.success | success path as expected (348 ms) | `docs/audit/evidence/actions/auth.teams.success.json` |
| B.action.code.api_scan.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/code.api_scan.failure.json` |
| B.action.code.api_scan.success | success path as expected (5196 ms) | `docs/audit/evidence/actions/code.api_scan.success.json` |
| B.action.code.api_versions.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/code.api_versions.failure.json` |
| B.action.code.api_versions.success | success path as expected (4 ms) | `docs/audit/evidence/actions/code.api_versions.success.json` |
| B.action.code.check.failure | failure path as expected (7 ms) | `docs/audit/evidence/actions/code.check.failure.json` |
| B.action.code.check.success | success path as expected (902 ms) | `docs/audit/evidence/actions/code.check.success.json` |
| B.action.code.lint.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/code.lint.failure.json` |
| B.action.code.lint.success | success path as expected (2139 ms) | `docs/audit/evidence/actions/code.lint.success.json` |
| B.action.code.lsp_restart.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/code.lsp_restart.failure.json` |
| B.action.code.lsp_restart.success | success path as expected (1 ms) | `docs/audit/evidence/actions/code.lsp_restart.success.json` |
| B.action.code.lsp.call_hierarchy.success | success path as expected (1 ms) | `docs/audit/evidence/actions/code.lsp.call_hierarchy.success.json` |
| B.action.code.lsp.completion.success | success path as expected (7 ms) | `docs/audit/evidence/actions/code.lsp.completion.success.json` |
| B.action.code.lsp.declaration.success | success path as expected (0 ms) | `docs/audit/evidence/actions/code.lsp.declaration.success.json` |
| B.action.code.lsp.definition.success | success path as expected (2 ms) | `docs/audit/evidence/actions/code.lsp.definition.success.json` |
| B.action.code.lsp.diagnostics.success | success path as expected (38 ms) | `docs/audit/evidence/actions/code.lsp.diagnostics.success.json` |
| B.action.code.lsp.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/code.lsp.failure.json` |
| B.action.code.lsp.hover.success | success path as expected (1700 ms) | `docs/audit/evidence/actions/code.lsp.hover.success.json` |
| B.action.code.lsp.implementation.success | success path as expected (93 ms) | `docs/audit/evidence/actions/code.lsp.implementation.success.json` |
| B.action.code.lsp.references.success | success path as expected (7 ms) | `docs/audit/evidence/actions/code.lsp.references.success.json` |
| B.action.code.lsp.signature.success | success path as expected (2 ms) | `docs/audit/evidence/actions/code.lsp.signature.success.json` |
| B.action.code.lsp.symbols.success | success path as expected (3 ms) | `docs/audit/evidence/actions/code.lsp.symbols.success.json` |
| B.action.code.lsp.workspace_symbols.success | success path as expected (89 ms) | `docs/audit/evidence/actions/code.lsp.workspace_symbols.success.json` |
| B.action.device.info.failure | failure path as expected (131 ms) | `docs/audit/evidence/actions/device.info.failure.json` |
| B.action.device.info.success | success path as expected (245 ms) | `docs/audit/evidence/actions/device.info.success.json` |
| B.action.device.list.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/device.list.failure.json` |
| B.action.device.list.success | success path as expected (247 ms) | `docs/audit/evidence/actions/device.list.success.json` |
| B.action.device.log.failure | failure path as expected (46 ms) | `docs/audit/evidence/actions/device.log.failure.json` |
| B.action.device.log.success | success path as expected (73 ms) | `docs/audit/evidence/actions/device.log.success.json` |
| B.action.device.recv.failure | failure path as expected (35 ms) | `docs/audit/evidence/actions/device.recv.failure.json` |
| B.action.device.recv.success | success path as expected (67 ms) | `docs/audit/evidence/actions/device.recv.success.json` |
| B.action.device.send.failure | failure path as expected (17 ms) | `docs/audit/evidence/actions/device.send.failure.json` |
| B.action.device.send.success | success path as expected (65 ms) | `docs/audit/evidence/actions/device.send.success.json` |
| B.action.device.shell.failure | failure path as expected (17 ms) | `docs/audit/evidence/actions/device.shell.failure.json` |
| B.action.device.shell.success | success path as expected (41 ms) | `docs/audit/evidence/actions/device.shell.success.json` |
| B.action.device.sqlite.failure | failure path as expected (42 ms) | `docs/audit/evidence/actions/device.sqlite.failure.json` |
| B.action.device.sqlite.readonly | delete without write=true -> INVALID_INPUT | `docs/audit/evidence/actions/device.sqlite.success.json` |
| B.action.device.sqlite.success | read 'select name from t' -> {"db":"/data/app/el2/100/database/com.devecomcp.sql/entry/rdb/audit.db","rows":[{"name":"alpha"}],"total":1} | `docs/audit/evidence/actions/device.sqlite.success.json` |
| B.action.diagnose.build.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/diagnose.build.failure.json` |
| B.action.diagnose.build.success | success path as expected (1 ms) | `docs/audit/evidence/actions/diagnose.build.success.json` |
| B.action.diagnose.crash.failure | failure path as expected (132 ms) | `docs/audit/evidence/actions/diagnose.crash.failure.json` |
| B.action.diagnose.crash.success | success path as expected (120 ms) | `docs/audit/evidence/actions/diagnose.crash.success.json` |
| B.action.doctor.doctor.failure | failure path as expected (17 ms) | `docs/audit/evidence/actions/doctor.doctor.failure.json` |
| B.action.doctor.doctor.success | success path as expected (108 ms) | `docs/audit/evidence/actions/doctor.doctor.success.json` |
| B.action.emulator.create.failure | failure path as expected (22 ms) | `docs/audit/evidence/actions/emulator.create.failure.json` |
| B.action.emulator.delete.failure | failure path as expected (150 ms) | `docs/audit/evidence/actions/emulator.delete.failure.json` |
| B.action.emulator.images.success | success path as expected (254 ms) | `docs/audit/evidence/actions/emulator.images.success.json` |
| B.action.emulator.license_view.success | success path as expected (1 ms) | `docs/audit/evidence/actions/emulator.license_view.success.json` |
| B.action.emulator.license.success | success path as expected (22 ms) | `docs/audit/evidence/actions/emulator.license.success.json` |
| B.action.emulator.list.success | success path as expected (184 ms) | `docs/audit/evidence/actions/emulator.list.success.json` |
| B.action.emulator.scenario.failure | failure path as expected (20 ms) | `docs/audit/evidence/actions/emulator.scenario.failure.json` |
| B.action.emulator.scenario.success | success path as expected (21 ms) | `docs/audit/evidence/actions/emulator.scenario.success.json` |
| B.action.emulator.start.failure | failure path as expected (2183 ms) | `docs/audit/evidence/actions/emulator.start.failure.json` |
| B.action.emulator.stop.failure | failure path as expected (193 ms) | `docs/audit/evidence/actions/emulator.stop.failure.json` |
| B.action.hot_reload.apply.failure | failure path as expected (44 ms) | `docs/audit/evidence/actions/hot_reload.apply.failure.json` |
| B.action.hot_reload.apply.success | success path as expected (2451 ms) | `docs/audit/evidence/actions/hot_reload.apply.success.json` |
| B.action.hot_reload.reset.success | success path as expected (79 ms) | `docs/audit/evidence/actions/hot_reload.reset.success.json` |
| B.action.hot_reload.stop_daemon.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/hot_reload.stop_daemon.failure.json` |
| B.action.hot_reload.stop_daemon.success | success path as expected (153 ms) | `docs/audit/evidence/actions/hot_reload.stop_daemon.success.json` |
| B.action.job.cancel.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/job.cancel.failure.json` |
| B.action.job.cancel.success | success path as expected (1 ms) | `docs/audit/evidence/actions/job.cancel.success.json` |
| B.action.job.list.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/job.list.failure.json` |
| B.action.job.list.success | success path as expected (1 ms) | `docs/audit/evidence/actions/job.list.success.json` |
| B.action.job.read.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/job.read.failure.json` |
| B.action.job.read.success | success path as expected (0 ms) | `docs/audit/evidence/actions/job.read.success.json` |
| B.action.job.resume.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/job.resume.failure.json` |
| B.action.job.resume.stale-status | fixed: resume now answers status=running with next=job wait; a second resume at that moment is correctly refused (CONFLICT, already running) | `docs/audit/evidence/claims/job-orphan.json` |
| B.action.job.resume.success.cancelled-refused | success.cancelled-refused path as expected (0 ms) | `docs/audit/evidence/actions/job.resume.success.cancelled-refused.json` |
| B.action.job.status.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/job.status.failure.json` |
| B.action.job.status.success | success path as expected (744 ms) | `docs/audit/evidence/actions/job.status.success.json` |
| B.action.job.wait.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/job.wait.failure.json` |
| B.action.job.wait.success | success path as expected (0 ms) | `docs/audit/evidence/actions/job.wait.success.json` |
| B.action.knowledge.catalog.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/knowledge.catalog.failure.json` |
| B.action.knowledge.catalog.success | success path as expected (2 ms) | `docs/audit/evidence/actions/knowledge.catalog.success.json` |
| B.action.knowledge.read.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/knowledge.read.failure.json` |
| B.action.knowledge.read.success | success path as expected (457 ms) | `docs/audit/evidence/actions/knowledge.read.success.json` |
| B.action.knowledge.rollback.params | fixed via B.schema.unknown-params: knowledge rollback with version -> INVALID_INPUT 'does not use: version', nothing executed |  |
| B.action.knowledge.search.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/knowledge.search.failure.json` |
| B.action.knowledge.search.success | success path as expected (10 ms) | `docs/audit/evidence/actions/knowledge.search.success.json` |
| B.action.knowledge.status.success | success path as expected (439 ms) | `docs/audit/evidence/actions/knowledge.status.success.json` |
| B.action.knowledge.update.success | success path as expected (105 ms) | `docs/audit/evidence/actions/knowledge.update.success.json` |
| B.action.locked-screen-hint | phone with a locked screen (passcode): record_start hint 'The device screen is locked (with a passcode it cannot be unlocked rem'; launch hint 'The device screen is locked (a passcode cannot be entered remotely): a' (10106102 was mapped to 'not installed' / 'needs a real device' before) | `docs/audit/evidence/actions/locked-phone.json` |
| B.action.project.build.failure | failure path as expected (14 ms) | `docs/audit/evidence/actions/project.build.failure.json` |
| B.action.project.build.success | success path as expected (3393 ms) | `docs/audit/evidence/actions/project.build.success.json` |
| B.action.project.clean.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/project.clean.failure.json` |
| B.action.project.clean.success | success path as expected (683 ms) | `docs/audit/evidence/actions/project.clean.success.json` |
| B.action.project.create.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/project.create.failure.json` |
| B.action.project.create.success | success path as expected (12 ms) | `docs/audit/evidence/actions/project.create.success.json` |
| B.action.project.info.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/project.info.failure.json` |
| B.action.project.info.success | success path as expected (0 ms) | `docs/audit/evidence/actions/project.info.success.json` |
| B.action.project.sync.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/project.sync.failure.json` |
| B.action.project.sync.success | success path as expected (1062 ms) | `docs/audit/evidence/actions/project.sync.success.json` |
| B.action.run.build_run.failure | failure path as expected (116 ms) | `docs/audit/evidence/actions/run.build_run.failure.json` |
| B.action.run.build_run.lingdong-watch-on-phone.failure | failure path as expected (336 ms) | `docs/audit/evidence/actions/run.build_run.lingdong-watch-on-phone.failure.json` |
| B.action.run.build_run.success | success path as expected (6129 ms) | `docs/audit/evidence/actions/run.build_run.success.json` |
| B.action.run.deploy.failure | failure path as expected (128 ms) | `docs/audit/evidence/actions/run.deploy.failure.json` |
| B.action.run.deploy.success | success path as expected (3580 ms) | `docs/audit/evidence/actions/run.deploy.success.json` |
| B.action.run.launch.failure | failure path as expected (192 ms) | `docs/audit/evidence/actions/run.launch.failure.json` |
| B.action.run.launch.success | success path as expected (3425 ms) | `docs/audit/evidence/actions/run.launch.success.json` |
| B.action.run.stop.failure | failure path as expected (136 ms) | `docs/audit/evidence/actions/run.stop.failure.json` |
| B.action.run.stop.success | success path as expected (76 ms) | `docs/audit/evidence/actions/run.stop.success.json` |
| B.action.run.uninstall.failure | failure path as expected (121 ms) | `docs/audit/evidence/actions/run.uninstall.failure.json` |
| B.action.run.uninstall.success | success path as expected (162 ms) | `docs/audit/evidence/actions/run.uninstall.success.json` |
| B.action.sign.auto.failure | failure path as expected (4 ms) | `docs/audit/evidence/actions/sign.auto.failure.json` |
| B.action.sign.certificates.success | success path as expected (68 ms) | `docs/audit/evidence/actions/sign.certificates.success.json` |
| B.action.sign.devices.success | success path as expected (47 ms) | `docs/audit/evidence/actions/sign.devices.success.json` |
| B.action.sign.verify.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/sign.verify.failure.json` |
| B.action.sign.verify.success | success path as expected (188 ms) | `docs/audit/evidence/actions/sign.verify.success.json` |
| B.action.skills.export.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/skills.export.failure.json` |
| B.action.skills.export.success | success path as expected (7 ms) | `docs/audit/evidence/actions/skills.export.success.json` |
| B.action.skills.init.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/skills.init.failure.json` |
| B.action.skills.init.success | success path as expected (6 ms) | `docs/audit/evidence/actions/skills.init.success.json` |
| B.action.skills.install_mcp.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/skills.install_mcp.failure.json` |
| B.action.skills.install_mcp.success | success path as expected (1 ms) | `docs/audit/evidence/actions/skills.install_mcp.success.json` |
| B.action.skills.install.failure | failure path as expected (86 ms) | `docs/audit/evidence/actions/skills.install.failure.json` |
| B.action.skills.install.success | success path as expected (482 ms) | `docs/audit/evidence/actions/skills.install.success.json` |
| B.action.skills.list.failure | failure path as expected (3 ms) | `docs/audit/evidence/actions/skills.list.failure.json` |
| B.action.skills.list.success | success path as expected (2 ms) | `docs/audit/evidence/actions/skills.list.success.json` |
| B.action.skills.read.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/skills.read.failure.json` |
| B.action.skills.read.success | success path as expected (1 ms) | `docs/audit/evidence/actions/skills.read.success.json` |
| B.action.skills.search.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/skills.search.failure.json` |
| B.action.skills.search.success | success path as expected (365 ms) | `docs/audit/evidence/actions/skills.search.success.json` |
| B.action.skills.uninstall.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/skills.uninstall.failure.json` |
| B.action.skills.uninstall.success | success path as expected (6 ms) | `docs/audit/evidence/actions/skills.uninstall.success.json` |
| B.action.ui_flow.delete.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/ui_flow.delete.failure.json` |
| B.action.ui_flow.delete.success | success path as expected (1 ms) | `docs/audit/evidence/actions/ui_flow.delete.success.json` |
| B.action.ui_flow.list.success | success path as expected (0 ms) | `docs/audit/evidence/actions/ui_flow.list.success.json` |
| B.action.ui_flow.list.success.empty-project | success.empty-project path as expected (0 ms) | `docs/audit/evidence/actions/ui_flow.list.success.empty-project.json` |
| B.action.ui_flow.record.failure | failure path as expected (132 ms) | `docs/audit/evidence/actions/ui_flow.record.failure.json` |
| B.action.ui_flow.record.failure-conflict | as expected | `docs/audit/evidence/actions/ui_flow.record.failure-conflict.json` |
| B.action.ui_flow.record.success | success path as expected (15 ms) | `docs/audit/evidence/actions/ui_flow.record.success.json` |
| B.action.ui_flow.replay.failure | failure path as expected (87 ms) | `docs/audit/evidence/actions/ui_flow.replay.failure.json` |
| B.action.ui_flow.replay.success | success path as expected (1029 ms) | `docs/audit/evidence/actions/ui_flow.replay.success.json` |
| B.action.ui_flow.show.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/ui_flow.show.failure.json` |
| B.action.ui_flow.show.success | success path as expected (0 ms) | `docs/audit/evidence/actions/ui_flow.show.success.json` |
| B.action.ui_flow.stop.failure | failure path as expected (17 ms) | `docs/audit/evidence/actions/ui_flow.stop.failure.json` |
| B.action.ui_flow.stop.project-ignored | stop with a different project -> INVALID_INPUT: The recording on 127.0.0.1:5555 belongs to /var/folders/dm/cg7mvtkd3px6hy3cm0lgpvwc0000gn/; second record while one is open -> CONFLICT with details {"flow":"f1","project":"/var/folders/dm/cg7mvtkd3px6hy3cm0lgpvwc0000gn/T/audit-upfix-sRVyxV/U","steps":0,"started":"2026 | `docs/audit/evidence/actions/ui_flow-stop-fixed.json` |
| B.action.ui_flow.stop.success | success path as expected (156 ms) | `docs/audit/evidence/actions/ui_flow.stop.success.json` |
| B.action.ui.act.click.success | success path as expected (307 ms) | `docs/audit/evidence/actions/ui.act.click.success.json` |
| B.action.ui.act.double_click.success | success path as expected (799 ms) | `docs/audit/evidence/actions/ui.act.double_click.success.json` |
| B.action.ui.act.drag.success | success path as expected (7652 ms) | `docs/audit/evidence/actions/ui.act.drag.success.json` |
| B.action.ui.act.failure | failure path as expected (154 ms) | `docs/audit/evidence/actions/ui.act.failure.json` |
| B.action.ui.act.fling.success | success path as expected (6431 ms) | `docs/audit/evidence/actions/ui.act.fling.success.json` |
| B.action.ui.act.input.success | success path as expected (2961 ms) | `docs/audit/evidence/actions/ui.act.input.success.json` |
| B.action.ui.act.key.success | success path as expected (188 ms) | `docs/audit/evidence/actions/ui.act.key.success.json` |
| B.action.ui.act.long_click.success | success path as expected (1717 ms) | `docs/audit/evidence/actions/ui.act.long_click.success.json` |
| B.action.ui.act.mouse_click.success | success path as expected (376 ms) | `docs/audit/evidence/actions/ui.act.mouse_click.success.json` |
| B.action.ui.act.mouse_double_click.success | success path as expected (678 ms) | `docs/audit/evidence/actions/ui.act.mouse_double_click.success.json` |
| B.action.ui.act.mouse_drag.success | success path as expected (4454 ms) | `docs/audit/evidence/actions/ui.act.mouse_drag.success.json` |
| B.action.ui.act.mouse_long_click.success | success path as expected (1965 ms) | `docs/audit/evidence/actions/ui.act.mouse_long_click.success.json` |
| B.action.ui.act.mouse_move.success | success path as expected (152 ms) | `docs/audit/evidence/actions/ui.act.mouse_move.success.json` |
| B.action.ui.act.mouse_scroll.success | success path as expected (533 ms) | `docs/audit/evidence/actions/ui.act.mouse_scroll.success.json` |
| B.action.ui.act.scroll.success | success path as expected (5463 ms) | `docs/audit/evidence/actions/ui.act.scroll.success.json` |
| B.action.ui.act.swipe.success | success path as expected (6342 ms) | `docs/audit/evidence/actions/ui.act.swipe.success.json` |
| B.action.ui.act.type.success | success path as expected (152 ms) | `docs/audit/evidence/actions/ui.act.type.success.json` |
| B.action.ui.assert.failure | failure path as expected (1843 ms) | `docs/audit/evidence/actions/ui.assert.failure.json` |
| B.action.ui.assert.success | success path as expected (157 ms) | `docs/audit/evidence/actions/ui.assert.success.json` |
| B.action.ui.find.failure | failure path as expected (16 ms) | `docs/audit/evidence/actions/ui.find.failure.json` |
| B.action.ui.find.success | success path as expected (150 ms) | `docs/audit/evidence/actions/ui.find.success.json` |
| B.action.ui.observe.failure | failure path as expected (114 ms) | `docs/audit/evidence/actions/ui.observe.failure.json` |
| B.action.ui.observe.success | success path as expected (293 ms) | `docs/audit/evidence/actions/ui.observe.success.json` |
| B.action.ui.record_start.failure | failure path as expected (141 ms) | `docs/audit/evidence/actions/ui.record_start.failure.json` |
| B.action.ui.record_start.success | success path as expected (536 ms) | `docs/audit/evidence/actions/ui.record_start.success.json` |
| B.action.ui.record_status.failure | failure path as expected (128 ms) | `docs/audit/evidence/actions/ui.record_status.failure.json` |
| B.action.ui.record_status.success | success path as expected (186 ms) | `docs/audit/evidence/actions/ui.record_status.success.json` |
| B.action.ui.record_stop.failure | failure path as expected (209 ms) | `docs/audit/evidence/actions/ui.record_stop.failure.json` |
| B.action.ui.record_stop.success | success path as expected (9060 ms) | `docs/audit/evidence/actions/ui.record_stop.success.json` |
| B.action.ui.record.phone | phone (screen awake): start ok, status recording, stop -> mp4 642702 bytes | `docs/audit/evidence/actions/ui.record.phone.json` |
| B.action.ui.review.failure | failure path as expected (136 ms) | `docs/audit/evidence/actions/ui.review.failure.json` |
| B.action.ui.review.image | review response content blocks: text, image:image/jpeg:71928; verdict {"review_id":0,"recorded":"passed"}; finish {"test_id":"t_munhju1a74f5","status":"passed","steps":3,"failed_steps":[],"failed_reviews":0,"unreso | `docs/audit/evidence/actions/ui.review.image.json` |
| B.action.ui.screenshot.failure | failure path as expected (89 ms) | `docs/audit/evidence/actions/ui.screenshot.failure.json` |
| B.action.ui.screenshot.success | success path as expected (155 ms) | `docs/audit/evidence/actions/ui.screenshot.success.json` |
| B.action.ui.test_export.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/ui.test_export.failure.json` |
| B.action.ui.test_export.success | success path as expected (1 ms) | `docs/audit/evidence/actions/ui.test_export.success.json` |
| B.action.ui.test_finish.failure | failure path as expected (1 ms) | `docs/audit/evidence/actions/ui.test_finish.failure.json` |
| B.action.ui.test_finish.success | success path as expected (0 ms) | `docs/audit/evidence/actions/ui.test_finish.success.json` |
| B.action.ui.test_log.failure | failure path as expected (0 ms) | `docs/audit/evidence/actions/ui.test_log.failure.json` |
| B.action.ui.test_log.success | success path as expected (0 ms) | `docs/audit/evidence/actions/ui.test_log.success.json` |
| B.action.ui.test_start.success | success path as expected (654 ms) | `docs/audit/evidence/actions/ui.test_start.success.json` |
| B.action.ui.test_step.failure | failure path as expected (132 ms) | `docs/audit/evidence/actions/ui.test_step.failure.json` |
| B.action.ui.test_step.success | success path as expected (1422 ms) | `docs/audit/evidence/actions/ui.test_step.success.json` |
| B.action.ui.tree.failure | failure path as expected (156 ms) | `docs/audit/evidence/actions/ui.tree.failure.json` |
| B.action.ui.tree.success | success path as expected (151 ms) | `docs/audit/evidence/actions/ui.tree.success.json` |
| B.action.ui.windows.failure | failure path as expected (133 ms) | `docs/audit/evidence/actions/ui.windows.failure.json` |
| B.action.ui.windows.success | success path as expected (48 ms) | `docs/audit/evidence/actions/ui.windows.success.json` |
| B.code.check.legal.app-resource-name-check_(comment/string) | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.app-resource-name-check_(nested_module) | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.appstorage-observedv2-mixing | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.builder-body-ui-only | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.component-decorator-version-mismatch | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.entry-build-root-node | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.hide-nav-bar-hides-content | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.nav-destination-root-node | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.nav-destination-single-builder | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.observed-v2-state-property-type | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.param-requires-require | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.permission-reason-required | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.regular-property-init | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.resource-name-check | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.struct-name-builtin-collision | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.legal.v1-decorator-function-type | valid look-alike code: hvigor builds, checker silent | `docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.project.e2e_acceptance | [object Object] | `docs/audit/evidence/check-rules/project-e2e_acceptance.json` |
| B.code.check.project.lingdong | [object Object] | `docs/audit/evidence/check-rules/project-lingdong.json` |
| B.code.check.project.lingdong_wt | [object Object] | `docs/audit/evidence/check-rules/project-lingdong_wt.json` |
| B.code.check.project.locket | [object Object] | `docs/audit/evidence/check-rules/project-locket.json` |
| B.code.check.project.mystarring | [object Object] | `docs/audit/evidence/check-rules/project-mystarring.json` |
| B.code.check.project.mytestapp_copy | line-level vs hvigor's 209 HAR errors (the build-log sample that check-projects.mjs sees is capped at 100 listed errors, hence its 'unmatched'): checker 211, all 209 hvigor errors matched at file:line, 2 extra = AlertDialog statements hvigor rejects 2 lines lower; 0 app-resource false positives | `docs/audit/evidence/check-rules/project-mytestapp_copy.json`<br>`docs/audit/evidence/check-rules/mytestapp-hvigor-har-errors.json` |
| B.code.check.recall.mytestapp | all 209 hvigor ArkTS errors in the two HAR modules are also reported by the checker at the same file:line (0 missed) | `docs/audit/evidence/check-rules/mytestapp-vs-hvigor.json` |
| B.code.check.rule.app-resource-name-check | fixed: module roots come from build-profile.json5 srcPath (nested modules indexed); $r(...) in comments/strings ignored. Violation case still agrees with hvigor; nested-module and comment/string legal cases now silent (check-rules.mjs, check-rules-legal.mjs) | `docs/audit/evidence/check-rules/rules-vs-hvigor.json`<br>`docs/audit/evidence/check-rules/rules-legal.json` |
| B.code.check.rule.appstorage-observedv2-mixing | fires; app crashes/does not start on device ({"started":false,"error":"App crashed on startup","details":{"started":false,"crashed":true,"new_crash_logs":["jscrash-com.devecomcp.rules2-20020076-20260930095) [pass 2, device 127.0.0.1:5555] | `docs/audit/evidence/check-rules/rules-pass2.json` |
| B.code.check.rule.builder-body-ui-only | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.component-decorator-version-mismatch | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.entry-build-root-node | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.hide-nav-bar-hides-content | fires; on device the content under Navigation is hidden [pass 2, device 127.0.0.1:5555] | `docs/audit/evidence/check-rules/rules-pass2.json` |
| B.code.check.rule.model-version-consistency | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.nav-destination-root-node | fires; on device the routed page without NavDestination shows nothing [pass 2, device 127.0.0.1:5555] | `docs/audit/evidence/check-rules/rules-pass2.json` |
| B.code.check.rule.nav-destination-single-builder | fires; on device pushPath('A') opens B (last builder wins), as the rule states [pass 2, device 127.0.0.1:5555] | `docs/audit/evidence/check-rules/rules-pass2.json` |
| B.code.check.rule.object-link-observed-type | dead rule removed from arkts-check.cjs (it was never called; hvigor accepts @ObjectLink on a plain class, so it could only produce false positives); first-pass case correctly shows no checker error and a successful build | `resources/vendor/arkts-check.cjs` |
| B.code.check.rule.observed-v2-state-property-type | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.page-entry-count | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.page-file-exists | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.param-requires-require | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.permission-name-exists | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.permission-reason-required | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.permission-reason-resource | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.regular-property-init | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.resource-dir-name | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.resource-name-check | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.route-map-build-function-missing | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.route-map-invalid-json | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.route-map-missing-key | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.route-map-unknown-key | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.struct-name-builtin-collision | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.check.rule.tsc-dialog-builder | re-examined: not a false positive. The two AlertDialog.show calls (GifCropView.ets:245/286) contain UI components inside an arrow builder, which hvigor rejects at the same statements (':' expected / "UI component 'Column' cannot be used in this place" at 247-248 and 288-289). The checker reports the same broken statement from its type side on the opening line; the code does not compile either way | `docs/audit/evidence/check-rules/mytestapp-hvigor-har-errors.json` |
| B.code.check.rule.v1-decorator-function-type | violation case: checker and hvigor both reject | `docs/audit/evidence/check-rules/rules-vs-hvigor.json` |
| B.code.lsp.empty-syscap-message | fixed: LSP diagnostics drop ace-server's 'do not include . Configure the capabilities' error (empty capability name) and report it under suppressed with the reason; @ohos.arkui.layoutAlgorithm import now shows 0 LSP errors and the build succeeds | `docs/audit/evidence/syscap/empty-syscap.json` |
| B.emulator.images-empty | no downloaded wearable image -> {"images":[]} | `docs/audit/evidence/upstream/images-empty-fixed.json` |
| B.knowledge.cloud.labels | fixed (labels from text overlap with the local official pack, candidate docs by title + content search). 679 sections / 8 queries vs the text-overlap truth: labelled official 247 (235 confirmed; 9 are Huawei Codelabs or HMS Core Android / Cangjie pages absent from the ArkTS pack, which the new label marks official / official_other_platform — reviewed bodies in disputed-bodies.json — and 3 undeterminable), labelled community 257 (246 confirmed, 0 official texts called community, 11 undeterminable), unverified 175 (60 decidable, presented as 'treat like community'). Official-as-community errors: 47 -> 0; community-as-official: 5 -> 0. Cloud search latency with labelling: 3.6-4.3 s (was ~2 s without verification) | `docs/audit/evidence/cloud-labels/sections.json`<br>`docs/audit/evidence/cloud-labels/disputed-bodies.json` |
| B.knowledge.cloud.official-other-platform | 0 of 235 'official' sections are Huawei docs for another platform/language (HMS Core Android/Java 0, Cangjie 0); labelled official they would be treated as ArkTS authority | `docs/audit/evidence/cloud-labels/platform.json` |
| B.knowledge.local.snippet-readability | snippets now come from the original text: 开通推送服务 \| 在开通推送服务前，请先参考“应用开发准备”创建项目和应用工程。 从HarmonyOS NEXT Developer Beta2起，开发者无需配置公钥指纹和Client ID。 登录AppGallery Connect网站， | `docs/audit/evidence/claims/snippets-after.json` |
| B.project.build.parser-drops-arkts-errors | fixed: HAR build with 209 ArkTS errors -> counts.error 209, 100 listed with code/file/line/column/message, more_errors 109 (rest in the log artifact), failed_tasks [videocreategif:default@HarCompileArkTS]; hints per error code |  |
| B.project.build.parser-drops-error-message | fixed: '> hvigor ERROR: 00306003 ...' + 'Error Message: Invalid project path...' is one diagnostic 'Specification Limit Violation: Invalid project path. Current path does not match: ...' with a hint to move the project to an ASCII-only path |  |
| B.real-emulator.install | install_image wearable 'HarmonyOS 7.0.0(26.0.0)': success in 75 s; listed as downloaded afterwards: true | `docs/audit/evidence/real-emulator/run.json` |
| B.real-emulator.install-bad-version | install_image with a non-existent OS version: EMULATOR_FAILED: Emulator install_image failed: The type or version entered is incorrect; download is not possible. | `docs/audit/evidence/real-emulator/run.json` |
| B.real-emulator.install-output | install_image result: {"installed":"wearable HarmonyOS 7.0.0(26.0.0)","path":"/Users/dreamlike/Library/Huawei/Sdk/system-image/HarmonyOS-7.0.0/wearable_arm/","bytes":954729272,"seconds":75,"output":"the image will be download to /Users/dreamlike/Library/Huawei/Sdk/system-image/HarmonyOS-7.0.0/wearable_arm/\nThe image is  | `docs/audit/evidence/real-emulator/run.json` |
| B.real-emulator.remove | remove_image: success; still downloaded afterwards: false | `docs/audit/evidence/real-emulator/run.json` |
| B.real-emulator.remove-missing | remove_image again (already removed): NOT_FOUND: Emulator remove_image failed: No images are available in the local environment. | `docs/audit/evidence/real-emulator/run.json` |
| B.real-sign.cleanup | revised: the 2 audit profiles were created through the IDE endpoint and do not appear in the user's AGC profile list (user screenshot: 6 profiles, no audit_*); nothing is left for the user to delete. Certificates: MCPValidationd98b7ba2 deleted on the user's request (6 -> 5) | `docs/audit/evidence/real-sign/delete-mcpvalidation.json` |
| B.real-sign.delete-mcpvalidation | certificates 6 -> 5; deleted {"deleted":"2034956198666588928","name":"MCPValidationd98b7ba2","type":"debug"}; remaining: his, ice, StarRing, StarRingRelease, auto_debug_<personal team id>.cer | `docs/audit/evidence/real-sign/delete-mcpvalidation.json` |
| B.real-sign.delete-nonexistent | delete_certificate id=1 -> NOT_FOUND (was reported as deleted before) | `docs/audit/evidence/real-sign/team-ambiguous.json` |
| B.real-sign.failures | fixed: missing CSR -> NOT_FOUND with hint (was INTERNAL ENOENT); delete of an unknown certificate -> NOT_FOUND (checked against the list, confirmed afterwards); profile_delete refuses non-numeric ids and says AGC does not confirm existence |  |
| B.real-sign.profile | profile_create on the existing debug certificate auto_debug_<team>.cer: AGC accepted, p7b downloaded (4131 bytes), 2 registered devices included | `docs/audit/evidence/real-sign/profile.json` |
| B.real-sign.profile-id | fixed: profile_create no longer returns profile:null; it states that the IDE endpoint returns only the profile file (response keys ret, provisionFileUrl) and that such profiles are not listed in the AGC console. The dead delete-after-download in auto signing was removed | `docs/audit/evidence/real-sign/provision-add-shape.json` |
| B.real-sign.register-existing | register_device on the already-registered phone -> {"registered":false,"already":true,"id":"1728957984152771008","udid":"B52ACB1D0125F1B0E8E4F06EA1FF1A0C7095872439EBDCE2A6; device count unchanged: true | `docs/audit/evidence/real-sign/run.json` |
| B.real-sign.rollback | AGC before/after: certificates 6 -> 6, devices 2 -> 2; id sets identical: true | `docs/audit/evidence/real-sign/run.json` |
| B.real-sign.team-ambiguous | real account with 3 teams: register_device without team -> TEAM_AMBIGUOUS (<user>, <team B>, <team C>); certificates without team still works: true | `docs/audit/evidence/real-sign/team-ambiguous.json` |
| B.schema.unknown-params | fixed: unknown parameters are rejected with did_you_mean (job wiat -> wait) and nothing runs; parameters an action does not use are rejected (project info + wait, knowledge rollback + version); wait above 60000 is capped with a note (opencode's wait=600000 build now succeeds) |  |
| C.agc-formats | AGC routes identical to upstream deveco-cli config/signature.ts; real cert list, device list, device add (already registered -> detected), provision add (accepted, p7b valid) and delete calls accepted. Response-shape gap: see B.real-sign.auto-profile-leak | `docs/audit/evidence/real-sign/profile.json` |
| C.all-actions-tested | corrected statement: 15 tools, 93 actions (+11 lsp ops, 16 ui act ops); all run against real devices/services in test/audit/actions.mjs (176 checks pass; phone screen recording needs the phone unlocked — the tool now says so) | `docs/audit/evidence/actions/summary.json` |
| C.api-modules-30 | all 30 checked on 6 device types. 22 resolve only with 2in1 (openFileBoost also tablet); avMusicTemplate=car, cashierComponent=tv, settingsLite=wearable; wifiext resolves nowhere (syscap WiFi.AP.Extension is only in api-white-list); appController/feedbackService are empty declaration shells ('export default X' without a declaration, no @syscap). Earlier '22 PC-only + 8 device/system-only' claim holds; its 8 were INFERRED before, now measured | `docs/audit/evidence/syscap/modules30.json` |
| C.buildprofile-restored | all pre-existing module BuildProfile.ets files byte-identical after the audit's builds (LingDong 32, MyStarRing 21, LingDong worktree 32). Exception: a module without one gets a newly generated BuildProfile.ets that is not removed (E.no-modify.mystarring) | `docs/audit/evidence/cross-risk/snapshot-diff-lingdong.json`<br>`docs/audit/evidence/cross-risk/snapshot-diff-mystarring.json` |
| C.canIUse-enclosing-if | FileGuard in phone+tablet+2in1 module: unguarded 2, enclosing if(canIUse(exact)) 0, early-return guard 2, canIUse(other syscap) 2 warning(s) | `docs/audit/evidence/syscap/experiments.json` |
| C.check-false-positives-fixed | LingDong whole-project arkts-check: 0 errors on the current tree, build succeeds (B.code.check.project.lingdong); same for MyStarRing and the LingDong worktree. Rule-level precision/recall with hvigor: see B.code.check.rule.* (3 rules with defects remain: app/sys resource-name scope, resource-dir-name scope, dead object-link rule) | `docs/audit/evidence/check-rules/project-lingdong.json` |
| C.cloud-full-artifact | Push Kit 获取 Pu: 85/85 sections, line ok 85; LazyForEach 列表: 85/85 sections, line ok 85; 卡片 FormExtensi: 84/84 sections, line ok 84 | `docs/audit/evidence/cloud-labels/artifact-check.json` |
| C.cloud-labels | see B.knowledge.cloud.labels (after fix: 0 official texts labelled community, 0 community labelled official; other-platform official docs marked separately) |  |
| C.daemon-recovery | killed 1 child process(es) of the server; next lsp symbols ok; check ok | `docs/audit/evidence/claims/daemon-recovery.json` |
| C.emulator-failure-detection | real outputs: successful install/remove not misread as failure; bad version and double remove detected (exit code 0 in both cases) | `docs/audit/evidence/real-emulator/run.json` |
| C.hms-kits-resolve | hover by symbol on 8 kit members (6 HMS, 2 OH): 8 real signatures, 0 missing/any (); 'Cannot find module' diagnostics: 0 | `docs/audit/evidence/claims/hms-kits-hover.json` |
| C.incremental-no-warnings | unchanged rebuild: 0 syscap warnings (first build 2) | `docs/audit/evidence/syscap/experiments.json` |
| C.input-quotes | sent "it's \"q\" $HOME `x` & \| ; 中文" -> shown "[it's \"q\" $HOME `x` & \| ; 中文]" | `docs/audit/evidence/claims/input-quotes.json` |
| C.job-orphan-resume | server SIGKILLed mid-build: new server reads interrupted; resume -> then wait: succeeded | `docs/audit/evidence/claims/job-orphan.json` |
| C.local-kb-complete | longest of top 3 Navigation docs: 161850 chars in 14 pages (reported total 161850) | `docs/audit/evidence/claims/kb-paging.json` |
| C.locket-spatialImage | checker's only error on Locket (Index.ets:6 '@kit.SpatialReconKit' has no exported member 'spatialImage') is confirmed by hvigor: "'spatialImage' is not exported from Kit '@kit.SpatialReconKit'" — a real error in the project, not a checker false positive | `docs/audit/evidence/check-rules/project-locket.json` |
| C.lsp-codes-not-in-kb | 2307: none; 28005: none; 28057: none; 10903329: 编译错误码; 10905209: ArkUI Structure Rules; 00303107: none | `docs/audit/evidence/claims/codes-in-kb.json` |
| C.multi-device-select | LingDong build_run on phone: succeeded; modules ["default"]; launch {"started":true,"pid":63649,"crashed":false,"new_crash_logs":[],"smoke":"PASS","screen_uniformity":0 | `docs/audit/evidence/claims/multi-device-select.json` |
| C.opencode-deploy-phone | build_run target='HUAWEI Pura 80 Pro' -> succeeded on 4VF0225613017854, modules ["default"], smoke PASS | `docs/audit/evidence/claims/opencode-scenario.json` |
| C.opencode-device-choice | build_run without target, 2 devices -> DEVICE_AMBIGUOUS: Pura 90 (emulator, matches true); HUAWEI Pura 80 Pro (real, matches true); hint: Do not choose on your own: ask the user which device to use (list name, real dev | `docs/audit/evidence/claims/opencode-scenario.json` |
| C.opencode-wait | LingDong project build wait=600000 -> succeeded; note: wait=600000 capped at 60000 ms; if the job is still running, call job action=wait again | `docs/audit/evidence/claims/opencode-scenario.json` |
| C.perf | handshake median 79.3 ms (min 78.4, max 82.9); idle RSS 64.4 MB; tools/list 37.7 KB (earlier claim: ~86-89 ms, 67-68 MB, ~36 KB) | `docs/audit/evidence/cross-risk/perf.json` |
| C.push-client-id | local official doc push-config-setting states verbatim: '从HarmonyOS NEXT Developer Beta2起，开发者无需配置公钥指纹和Client ID。' (Codex's conclusion correct); a separate '配置Client ID' doc exists for other scenarios (e.g. account/1001500001 fingerprint errors), so client_id is not universally unnecessary | `docs/audit/evidence/claims/push-client-id.json` |
| C.push-token-signature | SDK: * @syscap SystemCapability.Push.PushService \| * @since 5.1.0(18) \| function on(type: 'tokenUpdate', ability: Ability, callback: Callback<string>): void; | `docs/audit/evidence/claims/push-token-signature.txt` |
| C.retention | after 2 simulated days + restart: save_path copy true->false, test_export files 4->0 (directory itself kept on purpose), artifacts 5->0, ui test NOT_FOUND, untracked user file kept: true | `docs/audit/evidence/cross-risk/retention.json` |
| C.sign-auto-refuses | sign auto on LingDong -> failed SIGN_CONFIGURED 'Project already has signing (hvigorfile.ts: overrides.signingConfig); nothing changed' after 3 ms (no file touched: LingDong snapshot diff in E.no-modify) | `docs/audit/evidence/actions/sign.auto.failure.json` |
| C.skills-paths | after the fix: all 11 upstream agents supported with the same user and project directories (atomcode .atomcode/skills, dsh .dsh/skills added); the earlier claim was wrong and has been corrected | `docs/audit/evidence/upstream/skills-agents-fixed.json` |
| C.syscap-classify.lingdong | unguarded 83, compiler false positives 105, unverified 3, deps 22; independently re-derived 30 listed locations: 0 mismatches | `docs/audit/evidence/syscap/classification.json` |
| C.syscap-classify.lingdong_wt | unguarded 88, compiler false positives 102, unverified 3, deps 22; independently re-derived 30 listed locations: 0 mismatches | `docs/audit/evidence/syscap/classification.json` |
| C.syscap-classify.mystarring | unguarded 0, compiler false positives 78, unverified 0, deps 0; independently re-derived 0 listed locations: 0 mismatches | `docs/audit/evidence/syscap/classification.json` |
| C.syscap-hvigor-bugs | LingDong 191 project warnings, independent classification: real 83, false 105, unverifiable 3; MCP reported 83/105/3 | `docs/audit/evidence/syscap/lingdong-full.json` |
| C.syscap-hvigor-bugs.default-alias | wearEngine.getDeviceClient: deviceTypes ["default"] -> 2 warning(s), ["phone"] -> 0 | `docs/audit/evidence/syscap/experiments.json` |
| C.syscap-hvigor-bugs.since-suffix | precise: the single warning is on the 'audio' namespace, whose tag is '@syscap SystemCapability.Multimedia.Audio.Core [since 12]'; getAudioManager (plain '@syscap SystemCapability.Multimedia.Audio.Core') on the same line gets none. Audio.Core is in default/tablet/2in1 device-define. MCP device_compat classifies it as compiler_false_positives=1, unguarded=0 | `docs/audit/evidence/syscap/experiments.json`<br>`docs/audit/evidence/syscap-hvigor-source.txt` |
| C.tests-clean-temp | npm test (all unit suites pass) leaves no new entry in $TMPDIR (only 'cursor-sandbox-cache', created by the IDE sandbox, not the tests) |  |
| C.unguarded-crash | phone emulator, tap calls new fileGuard.FileGuard() unguarded: {"kind":"TypeError","message":"Cannot read property FileGuard of undefined"} | `docs/audit/evidence/syscap/experiments.json` |
| C.upstream-467 | corrected statement: the 467 items match by name; behaviour was audited for the high-risk command groups and every gap found there (11) is fixed (A.upstream.*). Remaining options were checked for presence/default only (A.upstream.semantic-method, INFERRED) |  |
| C.verify-unsigned | unsigned temp HAP -> verified:false with reason 'signature not found / No Hap Signing Block'; LingDong signed HAP -> verified:true with profile summary (debug, bundle, developer, 69 devices, validity) | `docs/audit/evidence/actions/sign.verify.success.json`<br>`docs/audit/evidence/claims/verify-signed.json` |
| C.verify-unsigned.signed | LingDong default-default-signed.hap: verified=true, profile {"type":"debug","bundle":"com.dream.nimble_widget_app","developer":"<developer id>","devices":69,"valid_from":"2026-0 | `docs/audit/evidence/claims/verify-signed.json` |
| D.text.01 | tools/list code.description: "The compiler is the final judge: if project build succeeds, code it flagged is valid — do not rewrite it." — B.code.check.* (checker false positives exist: app-resource-name-check nested modules, comment/string refs; hvigor built those projects) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.02 | tools/list code.description: "check: fast ArkTS static check ... with error-fix hints" — B.action.code.check.success | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.03 | tools/list project.description: "build ... returns packages and structured compile errors with fix hints" — B.project.build.parser-drops-arkts-errors / -error-message fixed: every error counted, first 100 listed with code/file/line; description updated to say so | `test/audit/agent-text.json` |
| D.text.04 | tools/list project.description: "sync: ohpm install + hvigor sync (job)" — B.action.project.sync.success | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.05 | tools/list project.description / SKILL.md 编译报错: "(implicit) build keeps dependencies current" — A.upstream.build.ohpm-install fixed; description and SKILL.md now state that dependencies are installed automatically after oh-package.json5 changes | `test/audit/agent-text.json` |
| D.text.06 | tools/list run.description: "Multi-device apps (e.g. phone + watch entry modules): only the modules whose module.json5 deviceTypes match the target device are built and " — C.multi-device-select, B.action.run.build_run.lingdong-watch-on-phone.failure (DEVICE_MISMATCH) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.07 | tools/list run.description: "Project signing (build-profile or hvigorfile overrides) is used as-is." — C.sign-auto-refuses; LingDong built and launched with its own signing (C.multi-device-select) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.08 | tools/list run.description: "build_run: build + install + launch + startup check (crash detection)" — B.code.check.rule.appstorage-observedv2-mixing pass 2: build_run reported 'App crashed on startup', smoke FAIL_CRASH, crash log name | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.09 | tools/list job.description: "resume: continue an interrupted or needs_input job" — B.action.job.resume.stale-status fixed; description says resume returns running, then wait | `test/audit/agent-text.json` |
| D.text.10 | tools/list device.description: "log ... level" — A.upstream.log.level (minimum level, documented as such) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.11 | tools/list device.target (all tools): "target: HDC device serial; optional when exactly one device is connected" — B.action.ui.test_step (DEVICE_AMBIGUOUS with two devices). Note: upstream also accepts device names (A.upstream.device-by-name) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.12 | tools/list ui.description: "input (types text into a field; Chinese supported), type (into the focused field)" — C.input-quotes (quotes, $, backtick, &, \|, ;, Chinese kept exactly), A.upstream.ui.text-focused | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.13 | tools/list ui.depth: "depth: tree/observe: maximum depth" — A.upstream.ui.layout-depth fixed; description: 0/omitted unlimited, 1 root only, 2 root+children | `test/audit/agent-text.json` |
| D.text.14 | tools/list ui.description: "review(requirement) returns a screenshot" — B.action.ui.review.image (image/jpeg block attached) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.15 | tools/list ui.description: "record_start/record_stop/record_status: screen recording to mp4 (real devices ...)" — B.action.ui.record_start/record_status/record_stop on the phone (mp4 saved) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.16 | tools/list ui_flow.description: "stop (save with a final assert ...)" — B.action.ui_flow.stop.project-ignored fixed; description: stop with the same project as record | `test/audit/agent-text.json` |
| D.text.17 | tools/list knowledge.description: "its sections are labelled official or community" — C.cloud-labels fixed (text-verified labels, 4 classes); description explains each label | `test/audit/agent-text.json` |
| D.text.18 | tools/list knowledge.description / SKILL.md: "the complete answer (every section, untruncated) is in full_artifact (job action=read, line=sources[].line)" — C.cloud-full-artifact (85/85, 85/85, 84/84 sections; line pointers exact) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.19 | tools/list knowledge.description / server instructions / SKILL.md: "trust order: SDK declarations and a successful build > official docs > community" — rule is sound; but its middle tier depends on labels that are 90.5% accurate (C.cloud-labels) and 'official' includes non-ArkTS platforms — the text does not warn about Android/Cangjie official docs | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.20 | tools/list knowledge.version: "version: update: specific version" — B.schema.unknown-params fixed: version passed to rollback is refused | `test/audit/agent-text.json` |
| D.text.21 | tools/list skills.host: "cursor \| claude \| codex \| opencode \| trae-cn \| codebuddy \| qoder \| pi \| deveco (skills only)" — A.upstream.skills.agents fixed; host list includes atomcode, dsh (skills only) | `test/audit/agent-text.json` |
| D.text.23 | tools/list sign.description: "auto: ... creates keystore+CSR, debug certificate, registers connected devices, creates a debug profile and writes signi" — auto no longer claims a cloud profile cleanup; certificate quota and team rules described; TEAM_AMBIGUOUS for write actions | `test/audit/agent-text.json` |
| D.text.24 | tools/list sign.description: "profile_delete (id)" — profile_delete described as for ids shown in the AGC console; profile_create no longer returns a null id | `test/audit/agent-text.json` |
| D.text.25 | tools/list emulator.description: "install_image (force re-downloads), remove_image" — B.real-emulator.install/remove/remove-missing/install-bad-version | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.26 | tools/list emulator.description: "sensor (light/humidity/temperature/steps/heartrate)" — A.upstream.emulator.scenario-validation: phone emulator supports light and steps only; the Emulator reports this and we surface it | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.27 | tools/list hot_reload.description: "First deploy with run action=build_run hot_reload=true; after editing .ets files call apply" — B.action.hot_reload.apply.success (after hot_reload build_run), NOT_FOUND with that hint otherwise | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.28 | project.ts device_compat.note / syscap.ts note: "the compiler drops the warning once the call is inside if (canIUse('SystemCapability.…')) ... On a device without the capability they crash " — C.canIUse-enclosing-if (enclosing if: 0, early-return/other syscap: warning kept), C.unguarded-crash (TypeError on phone emulator) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.29 | project.ts device_compat.note: "compiler_false_positives: hvigor misreads '@syscap X [since N]' tags and the 'default' device alias; nothing to change" — C.syscap-hvigor-bugs.since-suffix, C.syscap-hvigor-bugs.default-alias | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.30 | project.ts device_compat.note: "Only files compiled in this build are reported: an incremental build with no changes reports none." — C.incremental-no-warnings | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.31 | diagnose.ts hint syscap: "Not a missing dependency: <cap> is not available on this module's deviceTypes" — C.api-modules-30 (LSP 2307 message names the capability; resolves when deviceTypes include the device) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.32 | LSP diagnostics passthrough: "(LSP error) The default system capabilities of devices phone do not include . Configure the capabilities in syscap.json." — B.code.lsp.empty-syscap-message fixed: dropped and reported under suppressed with the reason | `test/audit/agent-text.json` |
| D.text.33 | server instructions: "Long operations (build, run, sync) return a job; use job action=wait rather than repeating the call." — B.action.job.* | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.34 | SKILL.md: "deveco MCP 提供 15 个工具" — tools/list returns 15 tools (docs/audit/evidence/agent-text/tools.md) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.35 | SKILL.md 部署运行: "返回 smoke: PASS / FAIL_CRASH / FAIL_BLANK" — C.multi-device-select (PASS), rules pass-2 appstorage (FAIL_CRASH), A.upstream.run.smoke-blank (blank rule) | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.36 | SKILL.md '约 3 秒生效': apply+restart on emulator took 4.4s, 4.4s, 4.7s; new text on screen: true, true, true | `docs/audit/evidence/agent-text/hotreload-timing.json` |
| D.text.37 | SKILL.md 数据库/文件: "device action=sqlite bundle=... db=<name>（调试包 RDB，默认只读）" — B.action.device.sqlite.success, B.action.device.sqlite.readonly | `test/audit/agent-text.json`<br>`docs/audit/evidence/agent-text/tools.md` |
| D.text.38 | SKILL.md 资料冲突: "云端官方段落带 local_doc 时，用 knowledge action=read id=<local_doc> 读本地全文核对" — SKILL.md rewritten: local_doc is the document containing the section's text; other-platform label explained | `test/audit/agent-text.json` |
| E.cross-platform.ci | CI runs unit tests on ubuntu/macos/windows (last 3 runs green): path handling, config, jobs, knowledge, parsers, host configs. These run without a real DevEco toolchain or device | `.github/workflows` |
| E.no-modify.e2e_acceptance | no source file changed during the audit | `docs/audit/evidence/cross-risk/snapshot-diff-e2e_acceptance.json` |
| E.no-modify.lingdong | all 105 differences are the user's own commits during the audit/fix session (git log: 10:01 '提交工作区全部改动', 11:52 '壁纸分类能力下沉到公共模块', 11:52 '动态锁屏选择壁纸页…', 11:53 '流量统计设置页…' by dreamlike): wallpaper category code/resources moved from features/wallpaperpage to commons/utils, Toolbox and specialModules pages. No MCP code path writes these files; working tree clean after the commits. All module BuildProfile.ets unchanged | `docs/audit/evidence/cross-risk/snapshot-diff-lingdong.json` |
| E.no-modify.lingdong_wt | no source file changed during the audit | `docs/audit/evidence/cross-risk/snapshot-diff-lingdong_wt.json` |
| E.no-modify.locket | no source file changed during the audit | `docs/audit/evidence/cross-risk/snapshot-diff-locket.json` |
| E.no-modify.mystarring | only build products differ: products/phone/.test/** (hvigor test-build cache, gitignored) removed by the audit's clean build; commons/card_widgets/BuildProfile.ets, generated by hvigor during builds, is now removed after each build (fix) — it is no longer present. No source file changed | `docs/audit/evidence/cross-risk/snapshot-diff-mystarring.json` |
| E.no-modify.mytestapp | no source file changed during the audit | `docs/audit/evidence/cross-risk/snapshot-diff-mytestapp.json` |
| E.no-modify.settings_fixture | no source file changed during the audit | `docs/audit/evidence/cross-risk/snapshot-diff-settings_fixture.json` |
| E.perf.load | after 60 searches + 20 checks + 20 LSP calls: server RSS 78.2 MB, 2 child processes (1244 MB: checker daemon + ace-server); after close: 0 orphaned children | `docs/audit/evidence/cross-risk/perf.json` |
| E.tmp.emulator-log | fixed: the start log is removed after a successful boot (as before) and is now tracked for retention, so a failed start's log is removed after retention_days |  |

