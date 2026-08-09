# deveco-tool

本目录是本机使用的 DevEco Code 能力整理仓库，同时是一个宿主无关的**鸿蒙开发能力包**：把 DevEco Code v0.1.5 的知识、工作流和工具三层能力整理成任何 AI agent 都能自己接入的形态。核心资产不含宿主适配；Claude Code 与 Codex 的适配是**单独一层、可选安装**（`scripts/install-host.mjs`），不装它核心照常可用。

接入方先读这两个文件：

- [`manifest.json`](./manifest.json) — 机器可读清单（Skill / 命令 / 模板 / MCP 工具分组 / 宿主工具映射）
- [`PACK.md`](./PACK.md) — 人读的接入说明与工具名映射表

```
skills/      56 个 Skill，分两层：core 17 个（DevEco Code 提取，MIT）+ extended 39 个（华为官方 Skill 仓库 v0.0.2）
             路由索引见 skills/INDEX.md；安装器默认只装 core 层，--profile full 才加装 extended
commands/    SDD 五阶段命令
templates/   SDD 三份产物模板
src/         统一 stdio MCP，24 个工具
scripts/     install.mjs 通用安装器；install-host.mjs 宿主适配层（Claude / Codex，可选）
docs/        customize-deveco（上游第 5 个 Skill，仅作参考，不进包）
provenance/  来源、许可与改动记录
```

一键装到目标目录：

```bash
npm install
node scripts/install.mjs --dest <目标目录>   # 装 skills(core 18)/commands/templates/manifest.json
node scripts/install.mjs --dest <目标目录> --profile full   # 加装 extended 层，共 56 个
node scripts/install.mjs --print-mcp         # 打印 stdio MCP 配置片段
```

默认 profile 是 `core`。`--profile full` 会加装 extended 层并在 stderr 打印许可警告——该层上游没有任何仓库级许可声明，其中 30 个自身也没有声明，默认处于保留所有权利状态，详见 [`LICENSE`](./LICENSE) 的 Scope 段与 `NOTICE.harmonyos-agent-skills`。

`install.mjs` 只动目标目录，不改 `~/.claude.json`、`~/.codex/config.toml` 等任何宿主配置。

想让宿主**自动发现**这些 Skill，再装可选的适配层：

```bash
node scripts/install-host.mjs --host claude    # → ~/.claude/skills，默认 core 17 个
node scripts/install-host.mjs --host codex     # → ~/.agents/skills，默认 core 17 个
node scripts/install-host.mjs --host all --profile full   # 加装 extended，会打许可警告
node scripts/install-host.mjs --host codex --print-mcp     # MCP 注册片段
```

**两个宿主都默认只装 core，原因一样**：它们都会把全部 Skill 的描述加载进上下文，也都会在超预算时裁剪——裁掉的正是让 Skill 被正确匹配的关键词，而且不报错。实测本包描述合计：56 个 **17,947** 字符，core 17 个 **5,561** 字符（口径：SKILL.md frontmatter 的 `description` 字段，空白归一后计长）。

| 宿主 | 限制 | 结论 |
|---|---|---|
| Claude | 单个 Skill 的 `description` + `when_to_use` ≤ **1536**；整个列表预算 = 上下文的 **1%**，超出后**从最少使用的 Skill 开始删描述** | 单条限制 56 个全部合格（最长 1076）；但 1M 上下文对应约 10,000 字符预算，全量 17,947 会被削，core 5,561 安全 |
| Codex | 初始列表预算 = 上下文的 **2%**、未知时 **8000** 字符，**且含每个 Skill 的路径** | 全量约 22,300 会被压缩甚至省略 Skill；core 含路径约 6,900 安全 |

想在 Claude 上装全量，可以先用宿主侧设置抬高预算（`skillListingBudgetFraction`，或 `SLASH_COMMAND_TOOL_CHAR_BUDGET`），或把低价值条目用 `skillOverrides` 设成 `name-only`。安装器不会替你改这些设置。`/doctor` 能看列表的上下文开销估算。

Skill 默认软链，改仓库即时生效。少数「自动加载即可能产生副作用」的 Skill（建工程、批量写产物、起模拟器、真机跑测试、上架审查）会以打过补丁的副本安装，关闭隐式调用——Claude 用 `disable-model-invocation: true`，Codex 用 `agents/openai.yaml` 的 `allow_implicit_invocation: false`。名单在 `manifest.json` 的 `invocationPolicy`，`skills/` 下的原文件一字不改。

适配层按 Skill 记录归属，可以和目录里已有的其他来源 Skill 共存，`--uninstall` 也只删自己装的。

不移植的部分：内置 agent 的 harness 机制（permission 表、mode/temperature 配置、轮次协议）与 UI 自动校验链路。11 个 agent 里可移植的是 prompt 内容，`build` / `debug` / `plan` / `goal` 四个已提取成 `harmony-build-loop` / `harmony-debug-instrumentation` / `harmony-plan-doc` / `harmony-sdd-workflow`；其余 7 个是 OpenCode 通用会话 agent，零鸿蒙内容。UI 自动校验的相关 MCP 工具被禁用，但截图与 UI 树能力保留，详见 `PACK.md`。

## 统一 MCP

可以把多个 Skill 脚本注册在一个 MCP 服务里。本仓库的 `src/server.mjs` 采用白名单脚本注册表，当前通过一个 `deveco_script` 工具调度 19 个脚本：

- 工程与 SDK：`copy_template`、`detect_sdk`
- 崩溃与日志：`collect_hilog`、`fetch_faultlog`、`jscrash_report`、`parse_jscrash_log`、`probe_faultlogger`
- 检索与生成：`search_practices`、`d2c_pixso_arkts`、`arkts_docs_search`、`arkui_docs_search`、`arkui_docs_rebuild_index`
- 诊断（Python）：`appfreeze_analyze`、`appfreeze_sample_stack`、`apifault_collect_hilog`、`apifault_analyze_media`、`memleak_analyze`
- 测试与评分（Python）：`local_test_run`、`instrument_test_run`、`ui_score`

注册表按条目的 `runtime` 分派解释器：`node` 走 `process.execPath`，`python` 依次尝试 `PYTHON` 环境变量、`python3`、`python`。解释器不可用时返回 `PYTHON_NOT_FOUND` 而不是静默失败。`ui_score` 还需要 Pillow——系统自带的 python3 通常没有，`deveco_doctor` 会报告本机状态。

同一个 stdio MCP 入口还代理了 CodeGenie UI/构建工具、ArkTS 知识检索、ArkTS LSP、ArkTS 静态检查和 HDC 日志工具，不需要为每一组能力启动独立 MCP。

## 本地运行

```bash
npm install
npm run doctor
npm run scripts
npm run mcp
```

MCP 工具按来源分为：

- 统一脚本入口：`deveco_script_catalog`、`deveco_script`；脚本参数可以通过 `args` 对象传入，也可以通过 `argv` 数组原样传给上游脚本。
- 项目和环境：`switch_cwd`、`init_project_path`、`deveco_doctor`。
- 登录和知识：`deveco_login`、`deveco_logout`、`deveco_status`、`arkts_knowledge_search`。登录会兼容读取 `~/.deveco-knowledge-mcp/auth.json`，旧 MCP 本身不会被修改或迁移。
- ArkTS 语言服务：官方兼容入口 `lsp`（支持 `goToDefinition`、`findReferences`、`hover`、`documentSymbol`、`workspaceSymbol`、`goToImplementation`、`prepareCallHierarchy`、`incomingCalls`、`outgoingCalls`），以及易用的独立入口 `find_references`、`go_to_definition`、`get_hover`、`list_symbols`、`find_call_hierarchy`。位置参数均为 1-based；首次调用时按当前项目启动本地 `@arkts/language-server`。
- ArkTS 和设备诊断：`arkts_check`、`check_ets_files`、`hdc_log`。两个 ArkTS 检查入口都直接调用本地 DevEco 静态检查器并返回结构化 JSON；`check_ets_files` 保留 CodeGenie 的兼容参数格式。`hdc_log` 支持 `list_devices`、`collect`、`clear` 三种操作；收集或清除前会验证目标设备，且会识别 HDC 退出码为 0 时输出的失败标记。`clear` 会清空设备日志缓冲区，应在确认后调用。
- 构建与运行：`build_project`、`start_app`。由本服务通过 `@deveco/deveco-cli` 直接实现，不经 CodeGenie 子进程。`build_project` 保留 `log_path`、`module` 单值与「先清理再构建」的 `clean` 语义；`start_app` 会部署全部可运行模块（只部署入口模块会因 HSP 依赖缺失而安装失败），并在只有一台设备在线时自动解析 `hvd`。
- CodeGenie 代理：`check_cpp_files`、`get_app_ui_tree`、`perform_ui_action`。这些工具由固定版本的 `@deveco-codegenie/mcp` 子进程提供。`perform_ui_action` 省略 `hvd` 时由本服务按已连接设备解析，不会把未启动的模拟器算作候选。

UI 自动校验链路（`verify_ui`、`save_ui_screenshot`、`get_ui_verification_log`）已被本服务禁用，既不出现在工具列表里，直接调用也会返回 `TOOL_DISABLED`。原因见 [PACK.md](./PACK.md)。

工具数量恒为 24：`tools/list` 由静态表回答，不等 CodeGenie 子进程，所以子进程挂死时列表照常返回（实测 1ms），只是那 3 个代理工具在调用时返回 `CODEGENIE_UNAVAILABLE`。`check_ets_files` 不依赖 CodeGenie 子进程。

### 直接调用示例

```json
{
  "name": "deveco_script",
  "arguments": {
    "script": "parse_jscrash_log",
    "args": { "logFile": "/tmp/jscrash.log", "source": "file" }
  }
}
```

```json
{
  "name": "switch_cwd",
  "arguments": { "project_path": "/path/to/MyHarmonyProject" }
}
```

## 内容来源

**core 层 17 个**分四类来源：四个原始 Skill 来自 DevEco Code 的 `packages/opencode/resources/skills`，与发布线 v0.1.7 逐文件核对一致；九个（`arkui-component-best-practices`、`arkts-logic-completer`、`repo-understand-skill`、`solution-design`、`responsive-layout-generator`、`arkui2hds`、`deveco-cli`、`ui-reconstruction-score`、`arkui-scoring-workflow`）来自尚未发版的 `0.2.0-release` 分支；四个方法论 Skill 是从内置 agent 的 system prompt 提取的衍生内容。SDD 命令与模板取自本机物化目录 `~/.local/share/deveco/specs/`（`.version` 为 `0.1.5`）。

**extended 层 39 个**来自另一个仓库：`gitcode.com/HarmonyOS_Skills/harmonyos-agent-skills`，锁定 tag `v0.0.2`。它不是 DevEco Code 的一部分，许可状态也不同（上游无仓库级 LICENSE），详见 `NOTICE.harmonyos-agent-skills` 与 `PACK.md` 的「许可与来源」。

具体提交、提取范围、逐项改动和许可证信息见 `provenance/`。

除 `arkts-runtime-fix` 中 HDC 调用增加失败文本识别外，原始 Skill 内容保持上游版本；DevEco 环境自定义配置 Skill 未纳入包体，保留在 `docs/customize-deveco/`。命令与模板做了宿主中立化改写（去 `agent:` 绑定、`CONFIG_ROOT` 改 `PACK_ROOT`、`spec-verify` 锁 build-only），每个文件头部注释都记了改动内容。

`src/` 是本仓库新增的适配层：它只注册白名单脚本、连接本地语言服务和代理已安装的 CodeGenie MCP，不会把旧的 `deveco-knowledge-mcp` 或旧 ArkTS LSP MCP 复制进来。迁移时只需把 stdio MCP 指向：

```text
node /Users/dreamlike/DreamLike/deveco_tool/src/server.mjs
```

当前 Codex CLI 支持的最高推理强度是 `xhigh`；如果全局配置使用不受支持的值，Codex 会在加载 MCP 配置前直接退出。
