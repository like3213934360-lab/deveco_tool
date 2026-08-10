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
| ~~`d2c-fast`~~ | 5 | **已退场，见表下说明。** Pixso 设计稿转 ArkTS 的十阶段流水线，含 383KB 的 vendored pixso-arkts 生成器（纯本地、零网络、零 npm 依赖），曾按宿主中立化改写 |
| `ui-reconstruction-score` | 5 | UI 还原度评分，`scripts/ui_score.py` 只依赖 Pillow 与标准库。丢弃了上游 `agents/openai.yaml`，SKILL.md 加了 Pillow 前置说明 |
| `arkui-scoring-workflow` | 1 | 构建→部署→截图→评分的编排流程。上游把工具层写成泛指的「MCP 工具」，本包补了到实际工具的绑定表 |

**`d2c-fast` 已随上游退场。** 上述表格记录的是 `9535f0f5` 时的提取结果，当时该分支有 16 个 Skill，
本包取了其中 10 个。上游其后在 `0.2.0-release` 上**整目录删除了 `d2c-fast`**（锁定的 `9535f0f5`
仍在，当前 HEAD 对该路径返回 404），本包已于同步时一并删除，故 0.2.0 来源的 Skill 现为 **9 个**。
连带删除的还有本包自建的 `references/host-mapping.md`（宿主中立化逐条对照，上游从无此文件）。
注意 gitcode 的 compare API 在删除枚举上不完整——它只列出 4 个 removed 文件，漏掉了
`references/workflow.md`；判定以目录 404 为准，不以 compare 清单为准。

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

共 19 个脚本，按 `runtime` 分派解释器（缺省 `node`，另有 `python`）。Python 侧依次尝试 `PYTHON` 环境变量、`python3`、`python`；显式设置了 `PYTHON` 但不可用时直接报 `PYTHON_NOT_FOUND` 而不回落，避免脚本跑在一个没装依赖的解释器上。

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

### 设备 UI 快速通道（本仓新增）

`ui_snapshot`、`ui_find`、`ui_tap`，由 `src/device-ui.mjs` 直接经 hdc 实现，上游没有对应工具。`get_app_ui_tree` 与 `perform_ui_action` 原样保留代理，未作任何修改——它们的 schema 与子进程逐字节对齐并有漂移测试守护，本来也改不得。

新增动机是同一条循环（截图 → 找控件 → 点击）上三处实测开销：

- `perform_ui_action` 的截图走 `uitest screenCap`，产出全分辨率 PNG，端到端 1.05s / 5.2MB。同一帧经 `snapshot_display -t jpeg` 是 0.42s / 约 260KB，UI 判读无损失。
- 从截图上估坐标每次约 2400 个图像 token，且不准：一次实测把 tab 中心估到 (640, 2670)，真值 (640, 2710)，偏 40px。`uitest dumpLayout` 每个节点自带 `$rect`，可直接算出精确中心。
- 三步全部经 CodeGenie 子进程，而该子进程握手会间歇性永久挂死（见「已核实的上游缺陷」），整条循环都继承这个风险。

实现上几处与直觉不同、有实测依据的决定：

- `snapshot_display` 只接受 `.jpeg` 后缀，且只给 `-w` **不保宽高比**（请求 640 得到 640x2848）。因此默认不缩放，取原生尺寸：实测原生 0.42s 与半宽 0.44s 基本持平（设备端缩放的开销抵消了传输的节省），而原生让 `coordinateScale` 恒为 1，杜绝了「把缩放图上的像素当设备坐标」这个最容易犯的错。`width` 仅作为压缩图像 token 的可选项保留。
- `format: "png"` 回退到 `uitest screenCap`，保留无损全分辨率能力。回退时本地文件扩展名会改为 `.png` 并同时返回 `requestedPath`，不会把 PNG 字节写进 `.jpeg` 路径。
- 回退分三态：设备根本没有 `snapshot_display` 时按设备缓存该结论，之后不再重复探测；偶发失败只回退一次；**超时不回退**——设备已经卡住，再跑一次 `screenCap` 只会把等待翻倍。
- `-i <displayId>` 只在调用方显式指定时才拼。默认写死 0 会打挂折叠屏展开态、2-in-1 和外接屏场景。
- `ui_find` 直接 `uitest dumpLayout`，因此不受 `get_app_ui_tree` 的 `full` 模式那条「应用未启动，请先启动应用」限制，任意前台应用都能查。
- `inputText` 不做字符白名单，而是按 hdc 的传参模式引用。hdc 对单个 `shell` 参数原样转发，对多参数中含空格者各套一层自己的双引号，于是分两种模式：无空格文本由本仓套一层单引号即可让任意字符字面化（反引号、`$`、`~`、`;`、`|`、`>`、`"`、括号、glob 均实测惰性）；含空格文本只能依赖 hdc 那层双引号，其中 `$`、反引号、`\` 仍活跃，且 `"` 能把包裹闭合掉（`a" ; id ; "b` 实测在设备上执行了 `id`），故只拦这四个字符。本仓自己的引号在第二种模式下帮不上忙——它会落进 hdc 的引号里，变成用户没打过的字面字符。此前的白名单两头都错：放行了 `(` `)`（第一种模式下是 `/bin/sh: syntax error` 硬失败），又拒掉了全部中文标点（`，` `。` 不属于 `\p{L}`、`\p{M}`、`\p{N}` 中任何一类）。
- `clickableOnly` 是选择器而非过滤器。实测一屏 35 个 clickable 节点无一带文字——承接点击的是包着标签的 Stack / Flex / FormComponent。若只当过滤器叠加在「有文字」这个默认之上，「列出我能点什么」永远返回 0。
- 设备端临时文件按 pid 命名，每进程有界但跨进程无界（实测某开发设备累积 14 个 / 6.9MB，含一个 5.2MB 的 PNG）。每进程每设备在后台清理一次，不阻塞已经优化过的截图路径，且只删 60 分钟未改动的文件：另一个 server 进程可能正在同一设备上截图，它的文件只有几秒钟大，无条件 `rm` 会在它 write 与 recv 之间把文件删掉。清理命令必须作为单个 argv 元素传入，否则 `-name 'deveco_ui_*'` 的引号会被 hdc 一并送到设备端，匹配不到任何文件。
- `ui_find` 取节点文字时把 `description` 作为最后回退：`uitest dumpLayout` 把无障碍标签写在这里，而不是 `accessibilityText`（该字段在两种 dump 形状里都不存在）。纯图标控件没有 `text`，这是唯一能按名字定位它们的途径；节点同时有真实文字时仍以真实文字优先。

第二轮优化的依据，同样来自实测，几条与直觉相反：

- **锁按被争用的资源加，而不是按设备。** 原先每设备一把队列，理由是 uitest 在设备端是单例——但这个理由只覆盖 uitest 系命令。`snapshot_display` 是另一个二进制，实测与 `dumpLayout` 有 356ms 的真实并发重叠且双双成功，排队纯属白等。现在只有 `dumpLayout` / `uiInput` / `screenCap` 取锁。解除排队后必须给截图的设备端路径加每次调用的唯一后缀，否则同进程两次并发截图会写同一个文件。
- **跨进程互斥是必需的，而且冲突不是快速失败。** 两个独立进程同时 `dumpLayout`：一个 1303ms 成功，另一个 **30533ms** 后失败并留下 0 字节产物，错误是 `Wait for subscribe uitest.broadcast.command.reply timeout`。进程内队列挡不住这个。`src/device-lock.mjs` 用 `open(…, "wx")` 原子创建的文件锁协调本包的进程，按 pid 判活回收崩溃者、按 90 秒上限回收卡死者（正常持有约 1.3 秒）。**它覆盖不了 DevEco Studio**——那边走自己的 uitest 客户端，永远不会取这把锁，所以上面那个签名被单独识别为 `UI_DEVICE_BUSY` 并给出可执行提示。
- **融合观察的收益来自设备端重叠，不是来自减少往返。** 把 4 次往返压到 2 次单独做毫无用处：顺序融合 1736ms，对比分开调用 1731ms——`file recv` 只值 48ms，而 `dumpLayout` 单独就是 1.25s。把截图 `&` 到后台与 dump 并行才有效，实测 1238ms。因此也放弃了「设备端 base64 经 stdout 回传压到 1 次往返」：省的那 48ms 不值 shell 通道传二进制的风险。融合命令里两条命令的输出必须落到设备文件并随 tar 一起回来，不能丢进 `/dev/null`——正向标记是它们唯一的成功证据。
- **设备写的是 GNU 风格 tar 魔数。** toybox 0.8.12 写 `"ustar "`（尾随空格）而不是 POSIX 的 `"ustar\0"`，按后者做相等判断会拒绝每一个真实归档。这是拿真机产物验读取器时发现的，不是靠自造 fixture。GNU 布局下偏移 345 也不是路径前缀，读它会凭空造出目录名。
- **指纹必须投影掉 `accessibilityId` 与 `hashcode`。** 同一未变画面连续两次 dump，这两个字段在 214 个节点里有 90 个不同——它们标识一次 dump，不标识一块屏幕，所以对原始 JSON 做哈希每次都不一样。`signature` 含文字，实时内容（时钟、计数器）会让它一直变，这是正确行为；判断「是否发生了导航」用不含文字的 `structureSignature`。
- **捕获按"消费端会保留的最长边"封顶，而不是按选定宽度。** 图像成本只跟像素面积走，与文件格式、字节数无关——所以换 WebP/PNG 一个 token 都省不了（且 `snapshot_display` 实测拒绝 webp，只写 jpeg 与 png）。而视觉模型会先把长边压到自己的上限再计费，超过那条线的像素被丢弃，只剩传输开销。因此默认改为"原生尺寸，长边超过 2576 才缩到 2576"：稠密屏被缩、小屏不动，缩到的正好是消费端本来就会缩到的尺寸。此前的固定 480px 错了两次——它取自一块屏的一次判读，又把"缩放倍率"写成了绝对宽度（480px 在 1276 宽的屏上是 38%，在 1600 宽的屏上只有 30%，同一个数字随屏幕变密而悄悄变差，表现为模型看错界面而不是设置不对）。实测还发现 JPEG 损失在低分辨率下更严重（480px 时 PSNR 34.0dB，1154px 时 37.7dB）：缩放与压缩损伤的是同一批文字边缘，会叠加。注意消费端可能再压一次（实测某宿主把 1154x2576 显示为 896x2000），本包无从探知，`width` 留给调用方按自己的客户端下调。
- **观察这条路已经贴着地板，剩下的省法是不走它。** 逐项量过：`uitest dumpLayout` 约 1200ms，占融合观察 1419ms 的绝大部分，而这 1200ms 是与无障碍服务通信的固有开销，不是可以削的启动成本——常驻 `uitest start-daemon` 只改变 5ms，`-b <bundle>` 把输出从 105KB 降到 36KB 却仍要 1122ms（只省不到 20%，还丢掉其余窗口），`-m false` 反而更慢（1737ms）。非 dump 的部分只剩 `tar` 约 60ms 加 `recv` 约 57ms，加上 hdc 每次调用 68ms 的往返地板。**「用设备端 base64 经 stdout 回传以省掉一次 recv」这个想法实测作废：1255ms，比 `file recv` 的 57ms 慢 20 倍**——shell 通道不适合传批量数据，好在量了才没写进去。因此新增的是 `ui_snapshot` 的 `ifChangedFrom`：JPEG 编码是确定性的，静止画面连续 8 次截图得到同一个摘要，所以帧摘要是可靠的相等性判据（不是相似度；时钟跳一下就会变，这是正确行为）。命中时返回 `unchanged:true` 且不回传图片。实测轮询 425ms 且零图像 token，对比完整观察 1301ms 加约 2400 图像 token；而不带该参数的普通截图是 432ms——**问这个问题不比不问贵，任何分支都不会更慢**。
- **按选择器点击时，由设备的 `clickable` 标志消歧。** 可见文字几乎总是命中两个节点：实测底部 tab 是 `Column "互动卡片" clickable=true` 包着 `Text "互动卡片" clickable=false`。若一律拒绝，文字选择器基本不可用；取那个设备称为可点的节点不是猜测，另一个根本点不动。两个都可点则仍然拒绝并列出候选。

当前 CodeGenie 正常启动时，统一服务共暴露 29 个工具；如果 CodeGenie 包缺失，其他本地工具仍可以使用，其中设备 UI 快速通道这 3 个完全不依赖该子进程。

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

> **状态：已随 Skill 退场，本节仅供追溯。** `d2c-fast` 已被上游从 `0.2.0-release` 整目录删除，
> 本包同步删除，下表的「处置」均已随文件消失。保留本节的理由是：这些缺陷（门禁无 fallback、
> 产物路径自相矛盾、工具名被清洗后留下的语句空缺）是上游 d2c 系 Skill 的**共性问题**，
> 将来若纳入 `d2c` 或其后继者，同一张表就是复查清单。

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

本仓库的处置：先 `server.connect()` 再后台预热子进程；握手的 connect 与 tools/list 各 5 秒封顶；挂死重试一次（客户端会缓存首次 `tools/list`，丢掉那一次就等于整个会话没有 `build_project` / `start_app`）；仍然失败则清空记忆，后续请求可再试。子进程不可用时服务降级为 26 个本地工具而不是不可用（`deveco_restart` 把本地工具从 21 带到 22，设备 UI 快速通道的 `ui_snapshot` / `ui_find` / `ui_tap` 带到 25，`ui_observe` 带到 26；此前记的 18 与 22 都是更早期的数字，已过时）。

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
