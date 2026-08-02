# HarmonyOS Capability Pack

一个宿主无关的鸿蒙开发能力包。内容提取自 DevEco Code v0.1.5（MIT），重新组织成任何 AI agent 都能自己接入的形态：
不含任何宿主适配层，不改任何宿主配置文件。机器可读清单在 [`manifest.json`](./manifest.json)。

## 三层能力

| 层 | 目录 | 是什么 |
|---|---|---|
| 知识 | `skills/` | 57 个 Skill，分两层。**core 18 个**（DevEco Code 提取，MIT）：ArkTS 语法规则、编译错误库、崩溃诊断、工程脚手架、构建循环、插桩调试、计划文档、SDD 编排，以及 ArkUI 组件最佳实践、逻辑补全、工程理解、方案设计、响应式布局、HDS 迁移、设备管理、设计稿转代码、UI 还原度评分。**extended 39 个**（华为官方 Skill 仓库 `v0.0.2`）：多设备适配、崩溃与冻屏诊断、Kit 接入、状态管理迁移、MVVM、测试、上架审查等。路由索引见 [`skills/INDEX.md`](./skills/INDEX.md) |
| 工作流 | `commands/` + `templates/` | SDD 五阶段命令 + 三份产物模板 |
| 工具 | `src/server.mjs` | 一个 stdio MCP，24 个工具（构建、跑设备、ArkTS 静态检查、LSP、知识检索、日志采集） |

三层可以独立使用。只要 Skill 也行；只要 MCP 也行。但方法论 Skill（`harmony-build-loop` 等）里的指令会引用
MCP 工具名，缺了 MCP 就只剩流程说明。

## 接入

### 1. 装依赖

```bash
cd <PACK_ROOT>
npm install
npm run doctor     # 检查 DevEco Studio / HDC / ArkTS checker / 登录态
```

需要 Node >= 20。构建、设备、ArkTS 检查类工具需要本机装有 DevEco Studio 并配置 `DEVECO_HOME`。

### 2. 装资产

```bash
node scripts/install.mjs --dest <目标目录>                     # 默认软链，装全部 57 个 Skill
node scripts/install.mjs --dest <目标目录> --profile core      # 只装 core 层 18 个
node scripts/install.mjs --dest <目标目录> --copy              # 拷贝
node scripts/install.mjs --dest <目标目录> --dry-run           # 预演
node scripts/install.mjs --dest <目标目录> --uninstall
```

装完目标目录里是 `skills/` `commands/` `templates/` `manifest.json`。这个目录就是各命令里说的 `PACK_ROOT`。

`--profile core` 只链 `tier: "core"` 的 Skill。两种 profile 下 `manifest.json` 都是完整的 57 条，
`skills/INDEX.md` 也总会安装——宿主据此知道还有哪些没装。选 `core` 的两个理由：Skill 索引小 4 倍，
以及 extended 层的上游没有仓库级许可声明（见「许可与来源」）。

安装器只动目标目录，不碰 `~/.claude.json`、`~/.codex/config.toml` 或任何宿主配置——那部分由接入方自己决定。

### 3. 接 MCP

```bash
node scripts/install.mjs --print-mcp
```

输出可直接解析的 JSON 片段，形如：

```json
{ "command": "node", "args": ["<PACK_ROOT>/src/server.mjs"] }
```

粘进宿主的 MCP 配置即可。

## 工具名映射

命令和 Skill 里出现的工具名分两类。**本包提供的**直接对应 MCP 工具；**宿主自备的**需要接入方映射到自己的等价能力：

| 工具名 | 来源 | 说明 |
|---|---|---|
| `build_project` / `start_app` | 本包 MCP | 构建与部署 |
| `arkts_check` / `check_ets_files` | 本包 MCP | ArkTS 静态检查 |
| `arkts_knowledge_search` | 本包 MCP | 官方知识库检索，需华为账号登录（`deveco_login`） |
| `hdc_log` | 本包 MCP | 设备日志采集/清理/列设备 |
| `lsp` 及别名 | 本包 MCP | ArkTS 语言服务，1-based 行列 |
| `deveco_script` | 本包 MCP | 调用 Skill 私有脚本（崩溃解析、faultlog、模板拷贝等） |
| `document_validate` | 本包 MCP | SDD 产物的章节结构校验，写盘后调用；只报告不阻断 |
| `spec_write` | **宿主自备** | 上游有专用产物写入工具；本包命令已改为「用宿主的写文件工具」，其附带的章节校验由 `document_validate` 顶上 |
| `question` | **宿主自备** | 向用户提问。`spec-specify` 的澄清环节依赖它 |
| `read` / `edit` / `write` / `glob` / `grep` | **宿主自备** | 常规文件与检索工具 |
| `task` | **宿主自备（可选）** | 子 agent 委派，命令单线程也能跑。`d2c-fast` 的阶段 3/5/6/9 和 `harmony-sdd-workflow` 的 Phase 4/5 在有委派能力时用它，没有时由主 agent 按同一模板执行 |

完整清单见 `manifest.json` 的 `mcp.toolGroups` 和 `hostToolMapping`。

## SDD 五阶段

```
/spec-specify  ->  spec.md     （需求与验收标准，禁止写代码）
/spec-plan     ->  plan.md     （技术方案与架构）
/spec-tasks    ->  tasks.md    （依赖有序的任务清单）
/spec-implement            （执行到 Polish 阶段为止，不构建不部署）
/spec-verify               （build-only：build_project -> start_app -> 报告）
```

命令本身不自动推进——每条跑完就交还控制权。要把五个阶段当成一条带门禁的流程跑，加载
`harmony-sdd-workflow`：它提供阶段门禁、Backtracking 规则、`verification_scope` 标记握手和
Phase 4/5 的委派契约。只用命令、不装该 Skill 时行为与之前一致。产物默认落在
`{PROJECT_ROOT}/spec/<feature>/`，路径记在 `{PROJECT_ROOT}/spec/feature.json`。

## 与上游的差异

1. **HDC `[Fail]` 补丁**：`arkts-runtime-fix` 的 HDC 调用会把退出码为 0 但输出含 `[Fail]` 的情况判为失败，修上游误报。改动在 `skills/arkts-runtime-fix/scripts/shared/hdc.mjs` 及四个调用脚本。
2. **`spec-verify` 锁定 build-only**：本包不移植 UI 自动校验，所以 `Verification_Scope` 固定为 `build-only`，UI 校验相关的 Phase 1 step 3/4 与 Phase 2 已移除。`build-only` 是上游自带分支，不是新造的。`spec-tasks` 与 `tasks-template.md` 同步只发 build-only。
3. **三个方法论 Skill 是提取产物**：`harmony-build-loop` / `harmony-debug-instrumentation` / `harmony-plan-doc` 的内容来自上游 `build` / `debug` / `plan` agent 的 system prompt 尾部，不是上游的 Skill 文件。只搬了 HarmonyOS 方法论，agent 机制（`plan_write` / `plan_exit` / `debug_exit` / permission 表）没有搬。
4. **命令去掉了宿主绑定**：`agent:` frontmatter、`CONFIG_ROOT`（原 `~/.local/share/deveco/`）、`goal.txt` 编排器引用、`spec_write` 专用工具，全部改成宿主中立表述。每个文件头部有注释说明改了什么。
5. **ArkTS 检查器四处修复**：`src/upstream/arkts-check.cjs` 打了四个本地补丁，每处都有 `LOCAL PATCH` 注释。
   (a) 空文件集原本输出 `success: true` 并退出 0，让"没找到文件"和"检查通过"无法区分；现在报错退出 1。
   (b) `etsStandaloneChecker` 抛出的异常原本只塞进 `captured`，而诊断解析器匹配不上就丢弃，检查器崩溃会呈现为干净结果；现在带 `internalError` 字段返回且 `success: false`。
   (c) SDK 的 `WhiteListValidator` 读 `projectConfig.globalModulePaths`，但 ets-loader 的 `main.js` 只维护自己的模块级同名变量、从不写到 projectConfig 上，未定义时任何走到 `@since` 抑制逻辑的文件都会让检查器崩；现在按 `main.js` 的口径补齐 `<sdk>/ets/{api,arkts,kits}` 及 HMS 侧路径。
   (d) `process.stdout.write` 后立刻 `process.exit()`，管道上是异步写，结果超过 64 KiB 就被截断成非法 JSON；现在在写入回调里退出。
   (e) 诊断结果只保留被请求检查的那批文件。检查器会连带报告它传递引入的声明文件，全项目扫描因此把 SDK 自己的 `ets/arkts/@arkts.lang.d.ets` 的解析错误算进来，让一个源码干净的工程判为失败。显式传入项目外的文件时不受影响，仍照常报错。
   文件发现逻辑没有留在上游文件里：`collectEtsFiles` 只认 `entry/src/main/ets` 单模块布局，多模块工程一个文件都扫不到，改由 `src/arkts-check.mjs` 的 `discoverProjectEtsFiles` 按 `build-profile.json5` 的 `modules[].srcPath` 解析后显式传 `--files`。
6. **`detect-sdk.mjs` 补了 CLI 入口**：上游只 export 函数，而本包的脚本注册表把 `detect_sdk` 登记为可执行脚本，直接跑会 stdout 全空、退出 0，看起来像成功。现在直接运行会打印 SDK 元数据 JSON，import 用法不变。
7. **崩溃日志 `error_message` 取值修正**：`shared/jscrash-parse.mjs` 的 `detectErrorMessage` 原本返回整行且优先命中 `Error name:`（`CRASH_SIGNAL_RE` 含裸词 `error`），真实的 `Error message:` 被盖掉；无崩溃时还会回落到日志最后一行。现在优先解析显式的 `Error message:` 并只取冒号后的负载，无信号时返回 `(not found)`。
8. **CodeGenie 子进程不再能拖死整个网关**：上游子进程的 MCP 握手会间歇性永久挂死（空闲机器 12 次复现 2 次）。原先在 `server.connect()` 之前 `await` 它，一挂死整个 MCP 连 `initialize` 都不回应，18 个与它无关的本地工具跟着一起没了。现在先连接自身 transport 再后台预热，握手 5 秒封顶并重试一次，失败则降级为只提供本地工具。
9. **UI 自动校验链路已移除**：见下一节。
10. **知识层是混合来源**：`arkts-error-fixes` / `arkts-grammar-standards` / `arkts-runtime-fix` / `deveco-create-project` 以发布线 v0.1.6 为基线（逐文件核对一致），另外 10 个来自尚未发版的 `0.2.0-release`。这四个不从 0.2.0 重取的理由是它们带本仓的 `LOCAL PATCH`，重取只会丢补丁——前三个在 v0.1.6 与 0.2.0 之间的 diff 本身是空的。0.2.0 只剩 `d2c` 未取（它硬依赖 `verify_ui`），原因见 `provenance/INVENTORY.md`。
11. **`build_project` / `start_app` 改为原生实现**：跟进上游 0.2.0 的方向，从 CodeGenie 代理换成通过 `@deveco/deveco-cli` 调用。参数保持向后兼容（保留 `log_path`、`module` 单值、`clean` 先清后建），`enable_inspector_source_jump` 无对应能力时显式提示而非静默忽略。`start_app` 部署全部可运行模块而非只部署入口模块——后者在多模块工程上会因 HSP 依赖缺失而安装失败。
12. **建工程改走 `devecocli create`**：跟进上游 0.2.0——它把建工程从「拷贝内置模板」改成调 DevEco CLI，31 个模板文件随之删除。本包同样不再分发工程模板，但不复制上游那句写死的 `spawnSync('devecocli')`（它依赖 PATH 上的 shim，本包不提供），改为 `DEVECO_CLI_ENTRY` 环境变量 → `require.resolve("@deveco/deveco-cli/dist/cli.js")` → PATH 三级解析，都失败时报 `DEVECO_CLI_NOT_FOUND`。原模板目录移到 `test/fixtures/harmony-app/` 只作 ArkTS 检查器的测试夹具，不随包分发；上游那 5 个被 UTF-8 写坏的 PNG 因此与本包彻底无关。
13. **`document_validate` 独立成工具**：上游在 `spec_write` 写完产物后自动追加章节校验报告。本包用宿主的写文件工具，这个链路断了，所以把校验逻辑提取成独立 MCP 工具，由三条 SDD 命令在写盘后显式调用。保留上游「只报告不阻断」的语义，另修了两处上游报告缺陷（缺失章节一律按一级标题渲染、level-2 上限那行打的是实测值而非上限），并把上游从不读取的 `ruleId` / `suggestion` 放进结构化返回。
14. **新增 `harmony-sdd-workflow` 编排层**：见「SDD 五阶段」一节。
15. **`d2c-fast` 已宿主中立化纳入**：产物根参数化、`task`/`general` 委派改为「宿主有委派能力就委派，没有就主 agent 按同一模板执行」、运行截图要求映射到本包工具、六处上游没配 fallback 的用户门禁逐条补齐、三处被清洗的语句和一处自相矛盾的产物路径已修。逐条对照见 `skills/d2c-fast/references/host-mapping.md`。
16. **第四提取源**：`skills/` 里 `tier: "extended"` 的 39 个来自华为官方 Skill 仓库（独立于 DevEco Code），锁定 tag `v0.0.2`。**该仓库没有仓库级许可声明**，详见「许可与来源」与 `NOTICE.harmonyos-agent-skills`。

## 关于 UI 自动校验

本包**不包含** UI 自动校验能力，并且从 MCP 层把这条链路**关掉**了。

`verify_ui`、`save_ui_screenshot`、`get_ui_verification_log` 三个工具不出现在 `listTools` 里，
直接调用会返回 `TOOL_DISABLED`，也不会转发给 CodeGenie 子进程。原因：

- 上游的 `verify_ui` 判图靠一个多模态模型，来源是配置项 `agent.ui_verification.model`（登录态下为 Qwen3-VL），
  取不到才回落到环境变量 `UI_VERIFY_BASE_URL` / `UI_VERIFY_API_KEY` / `UI_VERIFY_MODEL_NAME`。
  本包这三个都不配，实测在已登录状态下上游也没走通登录态那条路，只报缺环境变量；
- `save_ui_screenshot` 和 `get_ui_verification_log` 都以 `verify_ui` 的任务 id 为入参，
  没有 `verify_ui` 就只能恒返回 not found，留着是纯粹的噪声；
- 没有任何 Skill 或命令依赖它们（`spec-verify` 已锁定 `build-only`）。

保留的是**不依赖多模态模型、实测可用**的两个：`get_app_ui_tree`（`simple` / `full` 两种 dump）
和 `perform_ui_action`（`click` / `directionalFling` / `inputText` / `keyEvent` / `screenshot`）。
这两个在 `manifest.json` 里归入 `device-ui` 组，不再标 `optional`。

**截图能力是有的。** `perform_ui_action` 的 `screenshot` 动作带 `savePath` / `localPath` / `displayId`
参数，不依赖任何校验任务 id，可以独立落盘。`d2c-fast` 的阶段 9 审计和 `arkui-scoring-workflow`
的评分流程用的就是它。

`ui-reconstruction-score` 提供的是**另一种东西**：`scripts/ui_score.py` 只依赖 Pillow 和标准库，
零网络零模型调用，产出的是确定性像素指标（SSIM、边带差异、区域热力图）。它与被禁用的 `verify_ui`
不是同类——后者需要多模态模型判图，前者不需要。它需要的 Pillow 常常不在系统 python3 上，
`deveco_doctor` 会报告本机的 python 与 Pillow 状态。

要用 UI 自动校验就自己接一个多模态模型，并把 `DISABLED_CODEGENIE_TOOLS`（`src/server.mjs`）清空、
把 `UI_VERIFY_*` 的透传加回 `src/codegenie-client.mjs`。

## 许可与来源

**core 层（18 个 Skill、命令、模板、`src/`）**：上游 DevEco Code 为 MIT，其中华为工具与脚本文件保留各自的
Apache-2.0 文件头，复制分发时必须保留。

**extended 层（39 个 Skill）**：来自 `gitcode.com/HarmonyOS_Skills/harmonyos-agent-skills`，锁定 tag
`v0.0.2`（提交 `37f8f380`）。**该仓库根目录没有 LICENSE 文件，README 也没有许可章节。** 纳入的 39 个里
只有 9 个在 frontmatter 声明了 MIT，其余 30 个没有任何许可声明，处于默认的「保留所有权利」状态。
本包保留了全部原始文件头，并在 [`NOTICE.harmonyos-agent-skills`](./NOTICE.harmonyos-agent-skills)
中逐 Skill 记录了声明状态。**再分发本包前请自行评估这一层的许可风险**；只要 core 层的话用
`--profile core`。带安全风险的（运行期远程加载 + 对宿主 Skill 目录 `rm -rf`）和零许可的预编译二进制
已排除，逐条理由见 `provenance/SOURCES.md`。

逐项来源、提取范围、改动记录见 [`provenance/`](./provenance/)。

`docs/customize-deveco/` 是上游第 5 个 Skill，讲的是 DevEco Code 自身的配置格式（Skill 加载路径优先级、
agent 的 `mode` 字段、`.deveco/` 结构、`skills.urls` 远程加载）。对其他宿主没有直接用处，但写适配时有参考价值，
所以留在 `docs/` 而不进包。
