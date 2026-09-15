# 当前 MCP 本地能力与验收审计（2026-09-12，只读）

## 身份与取证范围

- 当前安装 `/Users/dreamlike/Library/Application Support/DevEcoMCP/installations/native-7-release-0.3.0-20260911-1`：package release 0.3.0 / native-7，29 个公开 MCP 工具，8 个固定工作流，8 个 Skill 引导流程。公开契约由安装包实际 `dist/src/core/catalog.js` 导入读取，无 Runtime 创建、无设备操作。完整 schema 保存在 `/tmp/deveco-installed-capabilities.json`。

- cwd `/Users/dreamlike/DreamLike/deveco_tool` 仍是旧 0.2.0 / native-6、25 工具代码；不能当作“当前运行”。

- `/Users/dreamlike/.codex/worktrees/5ab5/deveco_tool` HEAD 是 713734c8eaf40d52013ff88982306aef0d0c563f，但工作树有大量面向 0.4.0 的未提交变更。工作树当前 dist 有 342 文件，安装包 318 文件：24 新增、55 共有文件不同。不得把这些新增能力算入当前安装。

- 已以 git archive HEAD 生成干净只读审计副本 `/tmp/deveco-local-audit-head-713734c`。其 106 个 src TS 文件按锁定编译语义 ES2024 + verbatimModuleSyntax 转译后，106/106 生产 JS 与当前安装逐字节一致；129 个 resources 文件与安装全部相同；安装携带的 5 个 provenance 文件也与 HEAD 全部相同。因此以下源码引用指这个干净副本，避免脏工作树行号/实现误导。单文件转译只用于身份比对，不声称本轮跑过完整构建测试。

- 安装包只带 installed-skill-fingerprints/resources/upstream-mapping/upstream-lock/native-dependencies 五种 provenance 文件；upstream-capabilities、release-scope、历史验收报告和 docs 来自对应冻结 HEAD，不在生产包内。

## 当前全部公开工具与动作

动作枚举从实际安装 package 生成；未设 action 的工具注明固定操作或其他字段。

| 工具 | 公开动作/功能 | 对应源码 |
| --- | --- | --- |
| `skill_manage` | catalog, read | [src/core/contracts.ts:567](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:567) |
| `skill_workflow` | catalog, start, list, read, write, transition, publish | [src/core/contracts.ts:571](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:571) |
| `workflow_catalog` | list, get | [src/core/contracts.ts:575](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:575) |
| `workflow_run` | start, list, status, resume, cancel, read_artifact, capacity, cleanup_plan, cleanup_apply, export, storage_receipt | [src/core/contracts.ts:583](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:583) |
| `harmony_knowledge` | catalog, search, read | [src/core/contracts.ts:642](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:642) |
| `harmony_auth` | login, status, logout, teams | [src/core/contracts.ts:672](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:672) |
| `switch_cwd` | 选择后续请求默认工程 | [src/core/contracts.ts:681](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:681) |
| `deveco_doctor` | 主机/SDK/工具链与可用能力；显式 target 才只读探测设备 | [src/core/contracts.ts:686](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:686) |
| `deveco_restart` | 中断任务并重建运行 Worker | [src/core/contracts.ts:691](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:691) |
| `lsp` | hover, definition, implementation, references, diagnostics, documentSymbol, workspaceSymbol, prepareCallHierarchy, incomingCalls, outgoingCalls | [src/core/contracts.ts:696](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:696) |
| `arkts_check` | ArkTS 静态预检（files 可选） | [src/core/contracts.ts:745](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:745) |
| `code_lint` | 原生 Linter；fix/incremental/config_path/path/limit | [src/core/contracts.ts:753](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:753) |
| `check_cpp_files` | clangd/CMake 编译数据库诊断；abi、debug/release | [src/core/contracts.ts:765](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:765) |
| `device_info` | list=true 清单，或目标属性 | [src/core/contracts.ts:778](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:778) |
| `hdc_log` | collect, probe, fetch, clear | [src/core/contracts.ts:788](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:788) |
| `hot_reload` | start, status, apply, stop | [src/core/contracts.ts:837](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:837) |
| `app_signature` | inspect, configure, keypair, csr, sign, verify, certificates, certificate_create, certificate_delete, profile_create, profile_delete, devices, device_register | [src/core/contracts.ts:850](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:850) |
| `ui_snapshot` | mode=image/tree/both；截图尺寸、格式、变化摘要 | [src/core/contracts.ts:882](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:882) |
| `ui_observe` | 一次快照评估单选择器或至多 32 命名选择器 | [src/core/contracts.ts:895](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:895) |
| `ui_find` | 实时/已有快照/离线树查询，显式状态窗口显示器 | [src/core/contracts.ts:906](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:906) |
| `ui_tap` | 唯一 enabled 节点点击 | [src/core/contracts.ts:936](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:936) |
| `ui_flow` | list, read, validate, save, delete, routes, run, navigate, record_start, record_status, record_stop, record_cancel | [src/core/contracts.ts:941](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:941) |
| `verify_ui` | 最终控件断言及/或持久视觉审阅 | [src/core/contracts.ts:949](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:949) |
| `ui_review` | list, status, cancel, complete | [src/core/contracts.ts:968](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:968) |
| `ui_test` | start, plan, status, resume, cancel, finish, check, act, replan, logs, report, export | [src/core/contracts.ts:977](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:977) |
| `ui_inspect` | 树元信息、筛选节点、分页和可选截图 | [src/core/contracts.ts:991](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:991) |
| `ui_control` | 17 操作：click, doubleClick, longClick, swipe, fling, drag, dircFling, keyEvent, inputText, text, mouseClick, mouseDoubleClick, mouseLongClick, mouseMoveTo, mouseScroll, mouseMoveWithTrack, mouseDrag | [src/core/contracts.ts:1008](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:1008) |
| `emulator_manage` | list, start, stop, create, delete, images, image_install, image_uninstall, license_view, license_accept | [src/core/contracts.ts:1013](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:1013) |
| `emulator_scenario` | shake, power, rotation, volume, folded_state, battery, battery_status, gps, outdoor_running, outdoor_cycling, driving_navigation, sensor | [src/core/contracts.ts:1018](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:1018) |

UI control 的 17 种操作包含触摸、键盘、定位输入、焦点文字、7 种鼠标操作。`ui_test.act` 复用同一契约；UI 流程录制/保存的 step schema 仍是独立契约，不应仅凭 control 中存在某个动作就声称所有录制/重放语义都支持。

`emulator_scenario` 的 gps 支持 longitude/latitude/altitude/bearing，sensor 支持 light/humidity/temperature/steps/heartrate；原生命令确认不等于应用已经感知对应状态。[src/core/emulator-contracts.ts:93](/tmp/deveco-local-audit-head-713734c/src/core/emulator-contracts.ts:93)

## 八个固定工作流

| 工作流 | 固定执行含义 | 完成条件 |
| --- | --- | --- |
| `project_create` | Create an SDK-matched project without overwriting a directory. | The generated project model and application identity are valid. |
| `project_sync` | Install dependencies, synchronize and verify the native project model. | OHPM and Hvigor complete and a current model is present. |
| `project_build` | Optionally sync, run a fresh ArkTS preflight, stop on blocking diagnostics, then build and validate matching package artifacts. | Native compilation succeeds and each reported artifact exists with a digest. |
| `app_deploy` | Validate a package, install, launch and inspect application state. | Installation is acknowledged and the requested application process runs. |
| `build_deploy_verify` | Check current ArkTS sources, build or hot apply only after preflight, deploy, execute a saved route and verify an explicit UI assertion. | The specified final UI assertion passes on the captured target. |
| `code_diagnose` | Run requested native diagnostics and associate local rules and cases. | Requested checks complete with classified diagnostics; this is not compilation proof. |
| `crash_diagnose` | Collect bounded crash evidence, parse frames and associate local cases. | Evidence and parsed findings are reported, including insufficient-evidence status. |
| `api_compatibility` | Validate source/target versions, scan and return native reports. | The API scanner completes with reports or an explicit no-change result. |

源码契约 [src/core/contracts.ts:382](/tmp/deveco-local-audit-head-713734c/src/core/contracts.ts:382)；描述和目录 [src/core/catalog.ts:15](/tmp/deveco-local-audit-head-713734c/src/core/catalog.ts:15)。签名变更、热重载、模拟器变更、UI 录制等同样持久化 run_id，但不计为这八个公开目录工作流。

## 八个 Skill 引导流程与六个内置 Skill

| 引导流程 | 包含 Skill | 原生完成证据类别 |
| --- | --- | --- |
| `plan` | deveco-native-tools | 无强制原生完成类别；宿主判断 |
| `debug` | deveco-runtime-debug, deveco-native-tools | build_deploy_verify, ui_test, ui_flow |
| `spec` | deveco-arkts-standards, deveco-native-tools | project_build, build_deploy_verify, ui_test |
| `customize` | deveco-customize-host | 无强制原生完成类别；宿主判断 |
| `arkts` | deveco-arkts-standards | project_build, build_deploy_verify |
| `repair` | deveco-arkts-errors, deveco-arkts-standards | project_build |
| `create` | deveco-project-create, deveco-arkts-standards | project_build, build_deploy_verify |
| `ui_test` | deveco-native-tools, deveco-runtime-debug | ui_test |

| 内置 Skill | 上游来源 Skill |
| --- | --- |
| `deveco-arkts-standards` | `packages/opencode/resources/skills/arkts-grammar-standards/SKILL.md` |
| `deveco-arkts-errors` | `packages/opencode/resources/skills/arkts-error-fixes/SKILL.md` |
| `deveco-runtime-debug` | `packages/opencode/resources/skills/arkts-runtime-fix/SKILL.md` |
| `deveco-project-create` | `packages/opencode/resources/skills/deveco-create-project/SKILL.md` |
| `deveco-native-tools` | `packages/opencode/resources/skills/deveco-cli/SKILL.md` |
| `deveco-customize-host` | `packages/opencode/resources/skills/customize-deveco/SKILL.md` |

具体知识/完整引用是否遗漏由上游资源专项对照补充。这里只确认当前实际包六个改写 Skill、79 份知识文件，并非把上游项目里所有 SKILL.md 任意安装到客户端。[docs/builtin-skill-workflows.md:43](/tmp/deveco-local-audit-head-713734c/docs/builtin-skill-workflows.md:43)

编排有真实实现：阶段 planning/implementing/verifying/completed/cancelled、版本 expected_revision、原始 objective/项目/设备固定、定义摘要固定、文档持久化、证据引用/保留/导出。完成回执必须为成功、类别相符、项目或设备/应用相符，时间不得早于最近一次 implementing。[src/services/skill-workflow.ts:349](/tmp/deveco-local-audit-head-713734c/src/services/skill-workflow.ts:349)；[src/services/skill-workflow.ts:379](/tmp/deveco-local-audit-head-713734c/src/services/skill-workflow.ts:379)

但引导流程不会自己修改业务代码/推理/识图，相关动作仍由宿主 AI 执行；read 和完成结果故意 `verified:false`，只证明门禁及记录关联，不证明任意自然语言目标被实现。[src/services/skill-workflow.ts:142](/tmp/deveco-local-audit-head-713734c/src/services/skill-workflow.ts:142)；[docs/builtin-skill-workflows.md:39](/tmp/deveco-local-audit-head-713734c/docs/builtin-skill-workflows.md:39)

## “覆盖全部”的真实含义与已确认缺口

1. **28 工具 / 50 操作全 verified 不等于 50 实现成功。** 矩阵将 12 工具交给客户端、9 工具原生交付、7 工具引导交付。逐操作证据是 35 executed、15 unsupported。unsupported = 12 宿主工具 + skill.install/uninstall + lsp.outgoingCalls。对宿主能力的验收只检查 MCP 返回 TOOL_UNKNOWN、未产生状态，没有执行相应宿主编辑/搜索/子代理能力。[provenance/upstream-capabilities.json:9](/tmp/deveco-local-audit-head-713734c/provenance/upstream-capabilities.json:9)；[docs/next-release-progress.md:17](/tmp/deveco-local-audit-head-713734c/docs/next-release-progress.md:17)

2. **LSP 契约完整，当前后端适配不完整。** 现役在 SDK26 ArkTS 的能力检查中把 documentSymbol/workspaceSymbol/prepareCallHierarchy/incomingCalls/outgoingCalls 判为不支持；这不证明 SDK 无法通过其他协议/适配提供对应功能。clangd 对前四项有真实成功证据、outgoingCalls 返回 method-not-found。当前把“报告不支持的边界”纳入 verified；不能宣传 ArkTS 全符号/调用层次已经可用。[provenance/upstream-capabilities.json:599](/tmp/deveco-local-audit-head-713734c/provenance/upstream-capabilities.json:599)；[provenance/upstream-capabilities.json:778](/tmp/deveco-local-audit-head-713734c/provenance/upstream-capabilities.json:778)

3. **客户端 Skill 安装/卸载明确移除。** 内置读取、检索和流程是现有替代方案。这能满足“无须安装即可使用这些内置知识”，不能等同上游动态安装任意外部 Skill 的扩展行为。仓库记录旧用户决策不安装客户端 Skill；本轮用户意图若要求 MCP 包内所有上游资源，应保留这一边界并单独决定扩展能力。[provenance/upstream-capabilities.json:452](/tmp/deveco-local-audit-head-713734c/provenance/upstream-capabilities.json:452)

4. **规划/规格/调试模式是语义改写。** plan_enter/exit 变成 MCP 状态阶段、不会切换宿主 system mode；todowrite 变成 tasks.md/阶段记录而非宿主 todo UI；spec.design 映射受控 plan.md；debug_exit 变成带原生证据的流程完成。不能称宿主模式/会话功能逐项等价。[docs/builtin-skill-workflows.md:17](/tmp/deveco-local-audit-head-713734c/docs/builtin-skill-workflows.md:17)

5. **UI 自然语言测试为宿主指导协作。** 服务拥有步骤、断言、作用域、动作预算、无进展检测、图像 token/hash、恢复与不可变完成；宿主拥有步骤解释和真实视觉判断。Hilog 是 PID/epoch/步骤关联的有界环形缓冲区样本，明确 complete=false，不是完整连续日志。[docs/builtin-skill-workflows.md:49](/tmp/deveco-local-audit-head-713734c/docs/builtin-skill-workflows.md:49)

6. **完整 deveco-code 是 AI 开发宿主，不只是 MCP。** packages/、宿主脚本/包装/遥测/客户端会话等有整段 exclude；这合理描述模块化产品边界，但不符合字面“所有上游功能都在我的 MCP 内”。新增 tool 目录文件有 unmapped 防护，其他宿主扩展落在排除规则内不会自然转成 MCP 能力。[provenance/upstream-mapping.json:183](/tmp/deveco-local-audit-head-713734c/provenance/upstream-mapping.json:183)；[provenance/upstream-mapping.json:2237](/tmp/deveco-local-audit-head-713734c/provenance/upstream-mapping.json:2237)

7. **来源截点之后功能尚未自动继承。** 0.3.0锁定 Code aeb4536 / CLI a71f93d；对应文档已明确 CLI37b82a2 的默认启动崩溃/白屏检查尚未适配。当前脏 worktree确有 startup-check 等开发代码，但其 JS 与安装不一致，不能计为已交付。[docs/next-release-progress.md:11](/tmp/deveco-local-audit-head-713734c/docs/next-release-progress.md:11)

## 门禁能证明什么，不能证明什么

- 旧 `baseline-capabilities.json` 冻结于私有旧网关提交 aab1405…，40 工具 +7 脚本。`migration-matrix` 相应仍是19 verified/28 pending。它严格核对旧参数/动作映射，但本质是旧网关重构迁移基线，不是最新上游全部功能清单。[scripts/lib/migration.ts:77](/tmp/deveco-local-audit-head-713734c/scripts/lib/migration.ts:77)；[scripts/lib/migration.ts:133](/tmp/deveco-local-audit-head-713734c/scripts/lib/migration.ts:133)

- 新 `upstream-capabilities` 审计比旧矩阵进一步覆盖上游注册工具，但工具名单仍硬编码28个；只对LSP硬编码九动作，其他各工具要求 operations.min(1)，没有核对上游每一参数及 enum 操作集合。source.registry_sha256、upstream_sha256 仅检查格式，没有在该函数中读上游内容再校验。因此漏掉新动作/参数也可能通过当前门禁。[scripts/lib/upstream-capabilities.ts:8](/tmp/deveco-local-audit-head-713734c/scripts/lib/upstream-capabilities.ts:8)；[scripts/lib/upstream-capabilities.ts:48](/tmp/deveco-local-audit-head-713734c/scripts/lib/upstream-capabilities.ts:48)；[scripts/lib/upstream-capabilities.ts:172](/tmp/deveco-local-audit-head-713734c/scripts/lib/upstream-capabilities.ts:172)

- 强项：证据文件/附件摘要、runtime/compiled/package_lock/resource/upstream_lock五重身份、case精确 ID、不存在目标/检查、重复工具/动作都有核对。弱项：`outcome: executed|unsupported` 均可 passed，`ready` 只看 verified和非空证据；没有强制 delivery=native 的功能必须 executed且真正成功。[scripts/lib/upstream-capabilities.ts:112](/tmp/deveco-local-audit-head-713734c/scripts/lib/upstream-capabilities.ts:112)；[scripts/lib/upstream-capabilities.ts:122](/tmp/deveco-local-audit-head-713734c/scripts/lib/upstream-capabilities.ts:122)；[scripts/lib/upstream-capabilities.ts:188](/tmp/deveco-local-audit-head-713734c/scripts/lib/upstream-capabilities.ts:188)

- 路径映射门禁检查候选文件变化与adapt/exclude/unmapped、目标/测试是否存在；不会证明每一自然语言 Skill 要求已被保留或功能行为等价。它是变更分流和人工适配入口。[scripts/lib/upstream.ts:147](/tmp/deveco-local-audit-head-713734c/scripts/lib/upstream.ts:147)

- 发布门禁允许完整迁移验收或明确范围声明，之后再过上游/能力门禁；“通过 release gate”因此也不代表所有迁移、真实设备、性能或跨平台场景通过。[scripts/lib/release-gate.ts:88](/tmp/deveco-local-audit-head-713734c/scripts/lib/release-gate.ts:88)

## v0.3.0 证据与剩余范围

- 冻结源码文档报告六组CI（macOS/Linux×Node22/24每组482，Windows每组471）、六组干净安装各11、Windows各20轮压力通过；本机检查器21、SDK26、Skill35、多模块45、Lint6通过；无线专用API26应用完成自然语言测试、日志、重连/取消、录制/回放与安装包生命周期。它们是历史留存证据，本轮未重跑，不应说本轮完成了真机测试。[docs/next-release-progress.md:21](/tmp/deveco-local-audit-head-713734c/docs/next-release-progress.md:21)；[docs/next-release-progress.md:67](/tmp/deveco-local-audit-head-713734c/docs/next-release-progress.md:67)

- 0.3.0仍有28条迁移范围例外、22项验收例外、19项性能例外、21项必验收；长稳沿用历史证据。[provenance/release-scope-0.3.0.json:30](/tmp/deveco-local-audit-head-713734c/provenance/release-scope-0.3.0.json:30)；[provenance/release-scope-0.3.0.json:263](/tmp/deveco-local-audit-head-713734c/provenance/release-scope-0.3.0.json:263)；[provenance/release-scope-0.3.0.json:375](/tmp/deveco-local-audit-head-713734c/provenance/release-scope-0.3.0.json:375)；[provenance/release-scope-0.3.0.json:472](/tmp/deveco-local-audit-head-713734c/provenance/release-scope-0.3.0.json:472)

- 主要环境缺口：真实过期认证与云端变更中断、更多SDK/CLT/平台、所有签名类型、多设备、多显示器、全部模拟器传感器及派发后取消、录制与长期热重载共同资源协调、完整实时性能和当前最终版本长稳。pending不自动等于缺少实现，既有专项也不自动关闭整行。

## 上游28工具/50操作逐项映射及证据状态（冻结矩阵）

| 上游工具/操作 | 交付方式 | 矩阵状态/实证 | 替代入口 |
| --- | --- | --- |
| `invalid.execute` | client_required | verified / **unsupported** | MCP schema rejection / structured ToolError |
| `shell.execute` | client_required | verified / **unsupported** | Client-provided exec_command / write_stdin, scoped workdir |
| `read.execute` | client_required | verified / **unsupported** | Client-provided filesystem read / image inspection with bounded content |
| `glob.execute` | client_required | verified / **unsupported** | Client-provided rg --files with file glob |
| `grep.execute` | client_required | verified / **unsupported** | Client-provided rg with path and pattern |
| `edit.execute` | client_required | verified / **unsupported** | Client-provided apply_patch with exact old context |
| `write.execute` | client_required | verified / **unsupported** | Client-provided file creation / apply_patch |
| `task.execute` | client_required | verified / **unsupported** | Client-provided explicitly requested new thread or authorized subagent; no implicit delegation |
| `webfetch.execute` | client_required | verified / **unsupported** | Client-provided official web open |
| `todowrite.execute` | mcp_guided | verified / **executed** | skill_workflow documents, phases and retained task records |
| `websearch.execute` | client_required | verified / **unsupported** | Client-provided web search_query |
| `skill.list` | mcp_guided | verified / **executed** | skill_manage catalog/read serves bundled instructions and references over MCP; skill_workflow supplies current-phase guidance, persistent state and native completion gates. |
| `skill.search` | mcp_guided | verified / **executed** | skill_manage catalog/read serves bundled instructions and references over MCP; skill_workflow supplies current-phase guidance, persistent state and native completion gates. |
| `skill.read` | mcp_guided | verified / **executed** | skill_manage catalog/read serves bundled instructions and references over MCP; skill_workflow supplies current-phase guidance, persistent state and native completion gates. |
| `skill.install` | mcp_guided | verified / **unsupported** | Intentionally unsupported by the new owner-approved architecture. All Skills and knowledge are bundled in MCP, with no client-directory installer or remover. |
| `skill.uninstall` | mcp_guided | verified / **unsupported** | Intentionally unsupported by the new owner-approved architecture. All Skills and knowledge are bundled in MCP, with no client-directory installer or remover. |
| `apply_patch.execute` | client_required | verified / **unsupported** | Client-provided apply_patch |
| `question.execute` | client_required | verified / **unsupported** | Client-provided request_user_input_async or direct concise question |
| `lsp.goToDefinition` | native | verified / **executed** | lsp definition with explicit project_path/file and zero-based UTF-16 line/character; SDK capability checked |
| `lsp.findReferences` | native | verified / **executed** | lsp references with explicit project_path/file and zero-based UTF-16 line/character; SDK capability checked |
| `lsp.hover` | native | verified / **executed** | lsp hover with explicit project_path/file and zero-based UTF-16 line/character; SDK capability checked |
| `lsp.documentSymbol` | native | verified / **executed** | lsp documentSymbol with explicit project_path/file and zero-based UTF-16 line/character; SDK capability checked |
| `lsp.workspaceSymbol` | native | verified / **executed** | lsp workspaceSymbol with explicit project_path/file and zero-based UTF-16 line/character; SDK capability checked |
| `lsp.goToImplementation` | native | verified / **executed** | lsp implementation with explicit project_path/file and zero-based UTF-16 line/character; SDK capability checked |
| `lsp.prepareCallHierarchy` | native | verified / **executed** | lsp prepareCallHierarchy with explicit project_path/file and zero-based UTF-16 line/character; SDK capability checked |
| `lsp.incomingCalls` | native | verified / **executed** | lsp incomingCalls with explicit project_path/file and zero-based UTF-16 line/character; SDK capability checked |
| `lsp.outgoingCalls` | native | verified / **unsupported** | lsp outgoingCalls with explicit project_path/file and zero-based UTF-16 line/character; SDK capability checked |
| `plan_exit.execute` | mcp_guided | verified / **executed** | skill_workflow transition phase=implementing with expected_revision and rationale |
| `plan_write.execute` | mcp_guided | verified / **executed** | skill_workflow write name=plan.md with expected_revision; publish to an explicitly selected new file |
| `plan_enter.execute` | mcp_guided | verified / **executed** | skill_workflow start kind=plan captures objective, project and planning phase |
| `spec_write.spec` | mcp_guided | verified / **executed** | skill_workflow kind=spec write spec.md/plan.md/tasks.md; validate sections, task completion and native evidence |
| `spec_write.design` | mcp_guided | verified / **executed** | skill_workflow kind=spec write spec.md/plan.md/tasks.md; validate sections, task completion and native evidence |
| `spec_write.tasks` | mcp_guided | verified / **executed** | skill_workflow kind=spec write spec.md/plan.md/tasks.md; validate sections, task completion and native evidence |
| `hdc_log.collect` | native | verified / **executed** | hdc_log action=collect with explicit target/device_id and bounded filter/lines |
| `hdc_log.clear` | native | verified / **executed** | hdc_log action=clear with explicit target; clears default app/core buffers |
| `hdc_log.list_devices` | native | verified / **executed** | device_info list=true |
| `switch_cwd.execute` | native | verified / **executed** | switch_cwd project_path explicit; project context captured per run |
| `arkts_check.execute` | native | verified / **executed** | arkts_check project_path/files with summary.errorCount and success; full fresh default build preflight |
| `build_project.execute` | native | verified / **executed** | build_project/project_build with product,module_targets,mode,clean; native route capture and fresh full check before build |
| `start_app.execute` | native | verified / **executed** | project routes -> app_deploy with validated packages -> Ability launch; explicit target selection |
| `verify_ui.testPlan` | native | verified / **executed** | ui_test start/plan/resume/act/check/finish/cancel plus ui_review read/complete; fixed requirements and durable native evidence |
| `verify_ui.freshStart` | native | verified / **executed** | ui_test start/plan/resume/act/check/finish/cancel plus ui_review read/complete; fixed requirements and durable native evidence |
| `verify_ui.step_execution` | native | verified / **executed** | ui_test start/plan/resume/act/check/finish/cancel plus ui_review read/complete; fixed requirements and durable native evidence |
| `verify_ui.visual_review` | native | verified / **executed** | ui_test start/plan/resume/act/check/finish/cancel plus ui_review read/complete; fixed requirements and durable native evidence |
| `verify_ui.resume` | native | verified / **executed** | ui_test start/plan/resume/act/check/finish/cancel plus ui_review read/complete; fixed requirements and durable native evidence |
| `verify_ui.cancel` | native | verified / **executed** | ui_test start/plan/resume/act/check/finish/cancel plus ui_review read/complete; fixed requirements and durable native evidence |
| `get_ui_verification_log.read` | native | verified / **executed** | ui_test logs test_id, optional chunk_id/search_keywords/offset/max_bytes; main-app PID/device-time/step association |
| `get_ui_verification_log.search` | native | verified / **executed** | ui_test logs test_id, optional chunk_id/search_keywords/offset/max_bytes; main-app PID/device-time/step association |
| `save_ui_screenshot.export_steps` | native | verified / **executed** | ui_test export test_id,directory produces owned report, step images, logs and SHA-256 manifest |
| `debug_exit.execute` | mcp_guided | verified / **executed** | skill_workflow kind=debug transition phase=completed after native reproduction evidence and host review |

## 建议的验收口径

将“资源完整度”“MCP原生行为覆盖”“宿主协作覆盖”“平台可运行性”“工作流端到端通过”五种结果分列；implemented、verified-executed、unsupported、client-required、intentionally-excluded不可混作一个100%。先固定上游提交和适用边界，再从registry/Schema/Skill引用树机器提取分母；新增/删除/修改动作和参数必须更新差异表。对明确支持的原生动作要求成功业务结果，对不支持保持不支持状态。Skill逐条要求、配置扩展、日志持续性及LSP后端能力需要独立语义对照。
