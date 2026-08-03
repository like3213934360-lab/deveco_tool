# DevEco 能力清单

## 原始 Skill

以下目录均从 DevEco Code v0.1.5（`537543c5`）提取，合计 129 个文件；该内容与发布线 v0.1.6（`ab476caf`）无差异，验证过程见 `SOURCES.md`。DevEco 环境自定义配置 Skill 未纳入包体（保留在 `docs/customize-deveco/`）；`arkts-runtime-fix` 的 HDC 共享调用和四个调用脚本增加了退出码与失败文本联合判断，其余 Skill 内容保持上游版本。

| Skill | 文件数 | 内容 |
| --- | ---: | --- |
| `arkts-error-fixes` | 65 | 30 个 ArkTS 错误示例、对应参考说明和 Skill 使用说明 |
| `arkts-grammar-standards` | 8 | ArkTS/ArkUI 规则、Kit API 速查、配方和 TS→ArkTS 改写参考 |
| `arkts-runtime-fix` | 21 | JS/ArkTS 崩溃模式、faultlogger/hilog 诊断参考和 5 个运行时脚本 |
| `deveco-create-project` | 4 | 工程文件清单和 `copy-template`/`detect-sdk` 脚本。原来的 31 个工程模板文件已移出（见「与上游的差异」第 12 条）|

脚本目录中的可调用脚本已经进入统一白名单：

`copy_template`、`detect_sdk`、`collect_hilog`、`fetch_faultlog`、`jscrash_report`、`parse_jscrash_log`、`probe_faultlogger`。

## 提取的方法论 Skill

以下四个 Skill 不是上游的 Skill 文件，而是从内置 agent 的 system prompt 提取的内容。agent 机制本身（`plan_write` / `plan_exit` / `debug_exit` / permission 表 / 轮次协议）没有提取，宿主专有工具的调用要求已改写为宿主中立表述。

| Skill | 来源 prompt | 提取范围 |
| --- | --- | --- |
| `harmony-build-loop` | `build` agent（v0.1.5 二进制 `var Nt`） | `## Tools Guidelines` 至末尾（去掉第 8 条 UI 校验工具门禁）、`# ArkTS rules`、`# ArkTS Project Build failure diagnosis` |
| `harmony-debug-instrumentation` | `debug` agent（v0.1.5 二进制 `var at`） | `# ArkTs Project debug Workflow`、`# Interactive debugging`、`# Constraints`、`# Log instrumentation rules` |
| `harmony-plan-doc` | `plan` agent（v0.1.5 二进制 `var Ct`） | `## ArkTS planning awareness`、`## Plan output contract`、`## Plan writing guidelines`、`## Asking questions guide` |
| `harmony-sdd-workflow` | `goal` agent（`src/agent/prompt/goal.txt`，165 行） | 五阶段编排骨架、Phase 1-3 门禁与选项、Backtracking 规则、Coverage Gap Resolution、`verification_scope` 标记握手、Phase 4/5 委派契约与重试预算、异常协议 |

前三个当初从二进制 strings 提取；源码仓的 `packages/opencode/src/agent/prompt/*.txt` 是同样内容的明文，已核对 v0.1.5 到 0.2.0-release 之间这三个 prompt 的 diff 为空，提取内容不落后。

未提取的内置 agent：`build`、`plan`、`goal`、`debug`、`general`、`explore`、`spec-implementation`、`spec-verify`、`compaction`、`title`、`summary`，共 11 个——其中 `build`、`plan`、`debug`、`goal` 四个的内容已按上表提取，未提取的是它们的 permission 表、mode/temperature 配置和轮次协议这些 harness 级能力。

已复核其余 7 个 prompt 的鸿蒙内容密度，确认没有遗漏值得提炼的方法论：`explore` 20 行 0 处关键词、`compaction` 9 行 0 处、`summary` 11 行 0 处、`title` 44 行 0 处、`spec-implementation` 38 行 1 处、`spec-verify` 30 行 1 处。

`goal` 曾按同一密度标准记为「165 行 4 处、无需提取」。该判断已推翻：这个标准只度量鸿蒙关键词，而 `goal` 的价值是五阶段编排逻辑，不体现为关键词密度。`spec-implementation` 与 `spec-verify` 的行为约束靠 permission 表机械强制（前者显式 deny `build_project` / `start_app`；子 agent 自动 deny 任务列表与再次委派），能力包无法表达这套机制，已在 `harmony-sdd-workflow/references/delegation-contracts.md` 改写为委派 prompt 里的显式约束。

## 0.2.0-release 提取的 Skill

来自 `0.2.0-release` 分支（提交 `9535f0f5`，2026-08-01），共 10 个 Skill。前七个逐字节与上游一致；后三个有本地改动，逐条记在表内。

| Skill | 文件 | 内容 |
| --- | ---: | --- |
| `arkui-component-best-practices` | 28 | 22 个组件模式库（swiper / tabs / navigation / list-grid-scroll / stack / input-focus / picker / video / xcomponent 等）+ `component-practice-index.json` 索引 + 检索脚本 |
| `arkts-logic-completer` | 60 | 约 50 个 ArkUI 组件的功能逻辑补全参考、五要素检查清单、常见页面级调用链 |
| `repo-understand-skill` | 16 | ArkTS 工程理解八步流程（含行为等价审计），methodology / architecture-patterns / engineering 三层参考 |
| `solution-design` | 11 | 技术方案生成，含 UI 页面 / 网络 / 多媒体 / 数据存储 / 设备能力五套模板与增量设计参考 |
| `responsive-layout-generator` | 8 | 绝对定位 DSL 转响应式布局 DSL，含断点、chunks、多设备布局参考 |
| `arkui2hds` | 8 | ArkUI 组件迁移到 HDS（UI Design Kit），含 Tabs 迁移前后完整案例 |
| `deveco-cli` | 1 | 设备与模拟器管理 |
| `d2c-fast` | 5 | Pixso 设计稿转 ArkTS 的十阶段流水线，含 383KB 的 vendored pixso-arkts 生成器（纯本地、零网络、零 npm 依赖）。**已宿主中立化改写**，逐条对照见 `skills/d2c-fast/references/host-mapping.md` |
| `ui-reconstruction-score` | 5 | UI 还原度评分，`scripts/ui_score.py` 只依赖 Pillow 与标准库。丢弃了上游 `agents/openai.yaml`，SKILL.md 加了 Pillow 前置说明 |
| `arkui-scoring-workflow` | 1 | 构建→部署→截图→评分的编排流程。上游把工具层写成泛指的「MCP 工具」，本包补了到实际工具的绑定表 |

未取 `solution-design/SKILL.bak`（上游未清理的备份文件）。三个 `agents/openai.yaml` 未纳入：上游的 skill 加载器只 glob `**/SKILL.md`，运行时根本不读它们，它们服务于 DevEco Code IDE 前端的工作流卡片。`d2c-fast` 的那份里有五条紧凑的停止条件，已搬进其 SKILL.md。

### 0.2.0-release 中未提取的 Skill

| Skill | 未提取原因 |
| --- | --- |
| `d2c` | 阶段 11 强制要求调用 `verify_ui` 并明文禁止用截图观察、代码审查、手工 checklist 或子 agent 替代，而本包不提供 UI 自动校验。逐文件核实：`d2c` 对 `verify_ui` 有 24 处引用（`references/workflow.md` 18、`SKILL.md` 5、`agents/openai.yaml` 1）|

**此前 `d2c-fast`、`arkui-scoring-workflow`、`ui-reconstruction-score` 也在这张表里，理由已被推翻：**

- `d2c-fast` 曾记为「同上，是 `d2c` 的精简流程」。逐文件 grep 确认它对 `verify_ui` / `save_ui_screenshot` / `get_ui_verification_log` / 两个评分 skill / VLM **零命中**——这个理由是从 `d2c` 顺手套用的，没有逐文件验证。它确实需要运行截图，但本包的 `perform_ui_action` 就能截图（`{"actionType":"screenshot","localPath":...}`），不依赖被禁用的那条链路。
- `ui-reconstruction-score` 曾记为「依赖多模态模型」。实际 `ui_score.py` 只 import Pillow 和标准库，零网络零模型调用；整份 SKILL.md 提到视觉模型只有一处，是「阅读 `vlm_prompt.md` 了解提示词」的增强说明，不是门禁。
- `arkui-scoring-workflow` 曾记为「绑定上游 agent 机制的编排壳」。它确实是编排壳，但表述本身已是工具中立的，只需把泛指的「MCP 工具」绑定到本包实物。

保留的 10 个 Skill 已核对，对 `d2c` 以及 `verify_ui` / `save_ui_screenshot` / `get_ui_verification_log` 是零引用。

`arkui-component-best-practices/scripts/search-practices.mjs` 已登记进脚本注册表（`search_practices`）。`arkts-logic-completer/evals/validate_references.py` 仍未登记，但理由变了：脚本注册表现在支持 `runtime: "python"`，跑得了 Python；不登记是因为它只服务 evals，不是运行期能力。

## SDD 命令与模板

取自本机物化目录 `~/.local/share/deveco/specs/`（`.version` 为 `0.1.5`）。

| 目录 | 文件 |
| --- | --- |
| `commands/` | `spec-specify.md`、`spec-plan.md`、`spec-tasks.md`、`spec-implement.md`、`spec-verify.md` |
| `templates/` | `spec-template.md`、`plan-template.md`、`tasks-template.md` |

宿主中立化改动（每个文件头部注释均有记录）：

- 去掉 frontmatter 的 `agent:` 绑定（原为 `goal` 或 `spec-verify`）
- `CONFIG_ROOT`（原写死 `~/.local/share/deveco/`）改为 `PACK_ROOT`，模板引用改为 `{PACK_ROOT}/templates/*.md`
- `goal.txt` 父编排器改为「调用方」
- `spec_write` 专用产物写入工具改为「宿主的写文件工具」
- `spec-verify` 的 `Verification_Scope` 锁定为 `build-only`，移除 UI 校验相关的 Phase 1 step 3/4 与 Phase 2；`build-only` 是上游自带分支
- `spec-tasks` 与 `tasks-template.md` 同步只生成 `build-only` 的 Verification 阶段

## 统一 MCP 工具

### 本仓库适配层

`deveco_script_catalog`、`deveco_script`、`switch_cwd`、`init_project_path`、`deveco_doctor`、`deveco_login`、`deveco_logout`、`deveco_status`、`arkts_knowledge_search`、`arkts_check`、`check_ets_files`、`hdc_log`、`document_validate`。

`document_validate` 是从上游 `packages/opencode/src/tool/document-validation/`（6 个文件）提取的。上游把它放在 `spec_write` 里，写完产物后自动追加章节校验报告；本包用宿主的写文件工具，这个链路断了，所以提取成独立工具，由三条 SDD 命令在写盘后显式调用。规则表、中英双语别名表和 fence-aware 解析器逐字照搬，只把 Effect 包装换成普通函数；另修了两处上游报告缺陷并把上游从不读取的 `ruleId` / `suggestion` 放进结构化返回（见「已核实的上游缺陷」）。

### 脚本注册表

共 20 个脚本，按 `runtime` 分派解释器（缺省 `node`，另有 `python`）。Python 侧依次尝试 `PYTHON` 环境变量、`python3`、`python`；显式设置了 `PYTHON` 但不可用时直接报 `PYTHON_NOT_FOUND` 而不回落，避免脚本跑在一个没装依赖的解释器上。

| runtime | 脚本 |
| --- | --- |
| node（9） | `copy_template`、`detect_sdk`、`collect_hilog`、`fetch_faultlog`、`jscrash_report`、`parse_jscrash_log`、`probe_faultlogger`、`search_practices`、`d2c_pixso_arkts` |
| python（11） | `ui_score`、`apifault_collect_hilog`、`apifault_analyze_media`、`appfreeze_analyze`、`appfreeze_sample_stack`、`arkts_docs_search`、`arkui_docs_search`、`arkui_docs_rebuild_index`、`instrument_test_run`、`local_test_run`、`memleak_analyze` |

除 `ui_score` 需要 Pillow 外，全部 Python 脚本只依赖标准库。`deveco_doctor` 会报告本机的 python 版本与 Pillow 可用性——**系统自带的 python3 通常没有 Pillow**。

`d2c_pixso_arkts` 的全部选项都是 flag、无位置参数，所以 `args` 对象形式可用（`rawOut` → `--raw-out`）。`ui_score` 和 `search_practices` 有位置参数，只能走 `argv` 数组。

### ArkTS LSP

`lsp`（9 个官方操作：`goToDefinition`、`findReferences`、`hover`、`documentSymbol`、`workspaceSymbol`、`goToImplementation`、`prepareCallHierarchy`、`incomingCalls`、`outgoingCalls`），以及兼容旧 ArkTS LSP MCP 的：

`find_references`、`go_to_definition`、`get_hover`、`list_symbols`、`find_call_hierarchy`。

### CodeGenie MCP 代理

`check_cpp_files`、`get_app_ui_tree`、`perform_ui_action`。

`build_project` 与 `start_app` 不再走 CodeGenie 代理，改为本仓 `src/deveco-cli.mjs` 通过 `@deveco/deveco-cli` 实现（跟进上游 0.2.0 把这两个工具原生化的方向）。两点与上游不同：

- 参数向后兼容。上游 `build_project` 只有 `clean` / `product` / `modules` / `build_mode`；本仓保留原 CodeGenie 参数中的 `log_path`（上游无对应能力，本地落盘实现）和 `module` 单值形式，并且 `clean` 保持「先清理再构建」而不是上游的只清理不构建。`enable_inspector_source_jump` 在 DevEco CLI 中没有对应开关，调用时会显式提示未生效，不静默忽略。
- `start_app` 部署全部可运行模块，而不是只部署被请求的那一个。实测多模块工程上只传入口模块会失败：`Failed to install the HAP or HSP because the dependent module does not exist. phone's dependent module: card_catalog does not exist`。可运行模块集由 CLI 自身给出（先不带 `--module` 调一次，解析 `Available runnable modules:`），而不是从 `build-profile.json5` 猜——后者会把 HAR 也算进来。

CodeGenie 的 `init_project_path` 由本仓库的统一项目上下文入口管理，因此不重复注册子进程同名工具。CodeGenie 的 `check_ets_files` 由已验证稳定的本地 DevEco 检查器实现替代，保留原工具名和参数。

CodeGenie 的 `verify_ui`、`save_ui_screenshot`、`get_ui_verification_log` 被本服务禁用：既从工具列表过滤，调用时也直接返回 `TOOL_DISABLED` 而不转发给子进程。`verify_ui` 需要本包不配置的多模态模型，另两个以 `verify_ui` 的任务 id 为入参，没有它只能恒返回 not found。相应地 `UI_VERIFY_BASE_URL` / `UI_VERIFY_API_KEY` / `UI_VERIFY_MODEL_NAME` 也不再透传给子进程。

`perform_ui_action` 省略 `hvd` 时由本服务按 `hdc list targets` 解析目标设备：恰好一台则注入，零台或多台返回本地错误。上游会把已安装但未启动的模拟器也算作候选从而强制要求 `hvd`，与 `get_app_ui_tree` 的自动选择行为不一致。

当前 CodeGenie 正常启动时，统一服务共暴露 24 个工具；如果 CodeGenie 包缺失，其他本地工具仍可以使用。

DevEco Code 内部的 `debug_exit` 会话调试工具没有迁移；CodeGenie 的同名 `init_project_path` 也没有重复暴露，而是统一由本服务的项目上下文管理。其余未迁移的 DevEco 专有工具：`spec_write`、`plan_enter`、`plan_exit`、`plan_write`、`question`、`skill`、`doom_loop`、`repo_overview`（后者只出现在内置 agent 的 permission 表中，二进制里没有找到对应实现，可能是预留名）。这些属于 agent harness 级能力，由接入方宿主自备，`manifest.json` 的 `hostToolMapping` 有对应关系。

## 已核实的上游缺陷

`~/.local/share/deveco/skills/deveco-create-project/` 中 5 个 PNG 在物化到磁盘时被按 UTF-8 文本写出，首字节 `0x89` 被替换字符 `EF BF BD` 顶掉，`file` 判定为 `data`，体积膨胀约 1.84 倍：

| 文件 | 官方物化 | 源码仓原件 |
| --- | ---: | ---: |
| `application/AppScope/resources/base/media/background.png` | 169003 | 91942 |
| `application/AppScope/resources/base/media/foreground.png` | 25119 | 15325 |
| `application/entry/src/main/resources/base/media/background.png` | 169003 | 91942 |
| `application/entry/src/main/resources/base/media/foreground.png` | 12822 | 8805 |
| `application/entry/src/main/resources/base/media/startIcon.png` | 37394 | 20093 |

影响：用官方 CLI 的 `deveco-create-project` 建出来的工程，图标资源是损坏的。本仓库的模板来自源码仓，是正常 PNG。

**该缺陷对本包已不适用**：建工程改走 `devecocli create` 后，本包不再分发任何工程模板，这 5 个 PNG 随模板一起移到 `test/fixtures/harmony-app/`，只作 ArkTS 检查器的测试夹具，不进安装包。记录保留是因为它仍然是上游物化流程的有效缺陷。

### `document-validation` 的两个上游报告缺陷

两处都只影响报告文本，不影响判定结果，本包已修（`src/document-validate.mjs` 有 `LOCAL PATCH` 注释）：

| 位置 | 缺陷 |
| --- | --- |
| `document-validate-tool.ts:169` | `Too many level-2 sections (max ${tooManyLevel2[0].count} allowed)` 打印的是**实测数量**而不是上限，所以这条消息永远是错的（实测 8 个会显示成 "max 8 allowed"）。本包改为同时给出两个数：`(found N, max M allowed)` |
| `document-validate-tool.ts:152` | 缺失章节一律按 `formatReportLine(m, 1)` 渲染成 `#` 前缀，即使那是个二级章节要求。本包改用 `RequiredSection.level` |

另外 `config.ts` 里每条规则都带 `ruleId` / `message` / `suggestion`，但上游的报告格式化器从不读这三个字段——是死元数据。本包把它们放进结构化返回的 `issues.missing[]`，让调用方拿到可动作化的信息；`report` 文本仍保持上游格式。

### `d2c-fast` 的上游文档缺陷

| 位置 | 缺陷 | 处置 |
| --- | --- | --- |
| `workflow.md` 首帧稳定补全一句 | 两个工具名被清洗后留下空缺：「、截图和　　前」 | 按上下文补为「运行截图和结构快照采集前」 |
| `workflow.md` edge-band 审计一句 | 句尾被清洗：「审计不得依赖阶段 10 。」 | 补为「阶段 10 的总结结论」 |
| `workflow.md` 阶段 10 总结清单一项 | 整条只剩「- 　结果。」 | 按第 13 章的八项审计补全 |
| `inputs-manifest.json` 示例、阶段 2 命令示例 | 硬编码 `.deveco/d2c-fast/source/...` 等非 run 路径，与同一文件规定的「单次运行产物必须写入 `<d2cFastRunDir>`」直接冲突 | 统一改为 `<d2cFastRunDir>/...` |
| 六处需要向用户提问的门禁 | **全部没有配 fallback**，与同仓库 `goal.txt`（每个门禁都写了「若提问被拒绝则按默认继续」）形成对比 | 逐条补齐，安全类默认停、取舍类默认继续并留痕，见 `skills/d2c-fast/references/host-mapping.md` |

三处清洗残留的补法是按上下文推断的，不是上游原文，均以 `LOCAL PATCH` 注释标注。

### ArkTS 检查器的四个静默失败

`packages/opencode/src/tool/arkts-check.cjs`（本仓库 `src/upstream/arkts-check.cjs`）有四处会让"检查失败"呈现为"检查通过"。前三处都能单独造成假阴性，叠加起来使得多模块工程的全项目扫描恒返回 `success: true / errorCount: 0`。

| 位置 | 缺陷 | 触发条件 | 表现 |
| --- | --- | --- | --- |
| `collectEtsFiles` | 扫描根硬编码为 `entry/src/main/ets` | 工程不是 DevEco 单模块模板布局 | 收集到 0 个文件 |
| 零文件分支 | 0 个文件时输出 `success: true` 并退出 0 | 承上 | "没找到文件"与"检查通过"同形 |
| `etsStandaloneChecker` 的 catch | 异常只推进 `captured`，而诊断解析器匹配不上就丢弃 | 检查器抛异常 | 崩溃呈现为干净结果 |
| 结果写出 | `process.stdout.write` 后立刻 `process.exit()` | 结果超过管道缓冲区（64 KiB） | 输出被截断成非法 JSON |
| 诊断范围 | 连带报告传递引入的声明文件 | 检查任意引用了 SDK 的源文件 | SDK 自身 `@arkts.lang.d.ets` 的解析错误被算作项目错误 |

第三条在本机稳定复现：SDK 的 `WhiteListValidator.hasApiFileName`（`ets-loader/lib/fast_build/system_api/api_validator/api_validate_node.js`）读取 `_main.projectConfig.globalModulePaths`，但 ets-loader 的 `main.js` 只维护自己的模块级 `globalModulePaths` 并 `exports` 出去，从不写到 `projectConfig` 上。独立检查器构造的 `projectConfig` 自然没有这个字段，于是任何走到 `@since` 抑制逻辑的源文件都会抛 `TypeError: Cannot read properties of undefined (reading 'some')`。这既是上游检查器的缺陷（没有补齐字段），也是 SDK 侧的读写位置不一致。

实测：对一个 21 模块、998 个 `.ets` 的真实工程，修复前全项目扫描报 0 错误；四处修复后同一工程在约 1.8 秒内报出 8 个 error、274 个 warning，分布在 77 个文件。

### `detect-sdk.mjs` 没有 CLI 入口

`packages/opencode/resources/skills/deveco-create-project/scripts/detect-sdk.mjs` 只 export 函数，没有 main。作为脚本直接运行时 stdout 为空、退出码 0，与成功无法区分。上游自身通过 import 使用，所以没暴露；把它当可执行脚本登记的接入方会拿到静默空结果。

### CodeGenie 子进程握手会间歇性挂死

`@deveco-codegenie/mcp@1.1.11` 的 MCP 握手正常约 115ms 完成，但会间歇性**永不完成**——不报错、不退出、没有任何输出。在空闲机器上连续 12 次独立启动中复现 2 次（10 秒后仍无响应）。

原先 `src/server.mjs` 在模块顶层 `await getCodeGenieTools()`，位置在 `server.connect(transport)` **之前**，因此子进程一挂死，网关自身的 stdio transport 永远不会连接，整个 MCP 连 `initialize` 都不会回应。表现是本地那些与 CodeGenie 完全无关的工具（ArkTS 检查、LSP、日志、脚本）被一个只提供五个工具的子进程一起拖死。

本仓库的处置：先 `server.connect()` 再后台预热子进程；握手的 connect 与 tools/list 各 5 秒封顶；挂死重试一次（客户端会缓存首次 `tools/list`，丢掉那一次就等于整个会话没有 `build_project` / `start_app`）；仍然失败则清空记忆，后续请求可再试。子进程不可用时服务降级为 18 个本地工具而不是不可用。

挂死的成因未定位到上游代码的具体位置，只能观测到现象；修复方式是让它不再致命，不是消除它。

### `perform_ui_action` 的设备候选口径

`@deveco-codegenie/mcp@1.1.11` 的 `perform_ui_action` 把已安装但未启动的模拟器也算作"可用设备"，因此在只有一台真机在线时仍报"检测到多个可用设备"并强制要求 `hvd`；同一子进程的 `get_app_ui_tree` 则能自动选中唯一在线设备。两者口径不一致。本仓库在网关层按 `hdc list targets` 统一解析。

## 云端官方 Skill（extended 层）

来源 `gitcode.com/HarmonyOS_Skills/harmonyos-agent-skills`，tag `v0.0.2`（提交 `37f8f380`）。这是独立于 DevEco Code 的另一个仓库，完整的来源说明、许可现状与排除理由见 `SOURCES.md` 的「第四提取源」，逐 Skill 的许可声明状态见 `NOTICE.harmonyos-agent-skills`。

上游 46 个主 Skill，本包纳入 35 个，加 `hmos-push-kit` 拍平的 4 个子 Skill，共 **39 个目录**。

| 分类 | 数量 | Skill |
| --- | ---: | --- |
| solutions | 10 | 多设备适配 6 个（避让区、折叠态、硬件访问、交互方式、自然方向、屏幕窗口尺寸）+ 稳定性 4 个（`hmos-apifault-analysis`、`hmos-appfreeze-analysis`、`hmos-jscrash-analysis`、`hmos-memleak-analysis`）|
| development | 22 | ArkUI 6 个（开发、知识检索、场景开发、MVVM、状态管理迁移、一镜到底转场）、ArkTS 2 个（知识检索、废弃接口检查）、原子化服务 4 个、Kit 类 9 个（push-kit 主 + 4 子、scan-kit 2 个、account-kit、live-view-kit）、ability 1 个 |
| tools | 3 | `deveco-studio-codelinter`、`deveco-studio-emulator`、`deveco-studio-verify` |
| test | 2 | `hmos-local-test`、`hmos-instrument-test` |
| design | 1 | `hmos-design-visual-mobile` |
| launch | 1 | `app-metadata-audit-skill` |

### 与 core 层的职责重叠

纳入的 39 个里有几个与 core 层部分重叠，纳入是因为角度互补，不是因为无重叠：

- `hmos-jscrash-analysis` vs `arkts-runtime-fix` — 前者的 `references/fault-mode-library.md` 是三级根因表，比后者更系统；后者有可执行的 `jscrash-parse.mjs` 且修过上游 bug。两者互补。
- `hmos-arkui-knowledge-retriever` / `hmos-arkts-knowledge-retriever` vs `arkts-grammar-standards` — 前两者是检索式（本地文档索引 + Python 检索脚本），后者是规则式（linter 规则字典）。
- `hmos-multidevice-screen-window-size` vs `responsive-layout-generator` — 前者是断点系统与 GridRow 知识库加 `.ets` 模板，后者是「绝对定位 DSL → 响应式 DSL」的转换器。
- `hmos-design-visual-mobile` vs `arkui2hds` — 前者做设计规范到高保真 HTML，后者做 ArkUI 到 HDS 组件迁移。

已排除的 5 个则是**完全重复**（`hmos-arkts-syntax-checker`、`deveco-studio-hvigor`、`deveco-studio-hilog`、`deveco-requirement-development`、`deveco-autobugfix`），理由见 `SOURCES.md`。

### Python 依赖

extended 层引入了本包的第一批 Python 脚本。核实结果：**除 `ui_score`（需 Pillow）外，全部只依赖标准库**。11 个 Python 入口已登记进脚本注册表；各 Skill 内部的模块（如 `hmos-memleak-analysis/scripts/filter_on.py`）不登记，它们由入口脚本自己 import。
