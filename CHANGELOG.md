# Changelog / 更新日志

## v1.0.2 (2026-09-29)

**中文**
- 内置 Skill 换成上游 DevEco Code 自带的两个（MIT 许可，保留署名），再加一个本服务的工作流 Skill：
  - `hmos-arkui-develop-skill`：ArkTS/ArkUI 高频致命错误清单，以及组件 API 速查（`quick-apis`）和约束规则（`quick-rules`），共 35 个参考文件。
  - `hmos-runtime-fix-skill`：崩溃排查流程和 9 类崩溃模式库；把原来的 `devecocli` 和私有脚本调用改成本服务的 `diagnose`、`device log`、`run`、`ui`。
  - `deveco-mcp-workflow`：各种场景下该用哪个 deveco 工具。
- 删除 v0.4 遗留的 6 个 Skill：它们引用的旧工具名在 v1 里已不存在。不提供上游的 `customize-deveco`（配置 DevEco Code 自身）和 `deveco-cli`（命令行用法）两个 Skill。
- `diagnose` 的崩溃模式匹配改为直接读取 `hmos-runtime-fix-skill/references`，Skill 文档和匹配规则只维护一份。
- 项目级导出改写到 `<project>/.agents/skills`，这是 Codex、Claude Code、Cursor、Qoder、OpenCode、DevEco Code 共同读取的目录。
- `skills read` 支持多级参考文件路径（如 `quick-apis/01-layout.md`），并拒绝越出 Skill 目录的路径。
- 服务版本号改为从 `package.json` 读取。
- 知识包重新生成：`skills` 目录收录 38 篇文档（包含 ArkUI 速查）。

**English**
- Built-in skills are now the two shipped with upstream DevEco Code (MIT, attribution kept) plus a workflow skill for this server:
  - `hmos-arkui-develop-skill`: a list of high-frequency fatal ArkTS/ArkUI mistakes, plus component API cards (`quick-apis`) and constraint rules (`quick-rules`), 35 reference files in total.
  - `hmos-runtime-fix-skill`: the crash-fix flow and a 9-category crash pattern library. Calls to `devecocli` and the private scripts are replaced with this server's `diagnose`, `device log`, `run` and `ui`.
  - `deveco-mcp-workflow`: which deveco tool to use for each task.
- Removed the 6 skills left over from v0.4, which referenced tool names that no longer exist in v1. Upstream's `customize-deveco` (configuring DevEco Code itself) and `deveco-cli` (CLI usage) skills are not included.
- `diagnose` now matches crash patterns directly from `hmos-runtime-fix-skill/references`, so the skill docs and the matcher share one source.
- Project-scope export now writes `<project>/.agents/skills`, the directory shared by Codex, Claude Code, Cursor, Qoder, OpenCode and DevEco Code.
- `skills read` accepts nested reference paths (e.g. `quick-apis/01-layout.md`) and rejects paths that escape the skill directory.
- The server version is now read from `package.json`.
- Rebuilt the knowledge pack: the `skills` catalog now holds 38 documents, including the ArkUI quick reference.

## v1.0.1 (2026-09-29)

**中文**
- 取消“可选组”：`sign`、`emulator`、`hot_reload` 默认可用，15 个工具全部对宿主 AI 可见，不再需要 `DEVECO_TOOL_GROUPS`（该变量已移除）。
- 启动时间和内存不变：这些工具的代码只在第一次调用时才加载；工具描述约增加 5 KB。

**English**
- Removed optional tool groups: `sign`, `emulator` and `hot_reload` are always enabled, so all 15 tools are visible to the host AI. `DEVECO_TOOL_GROUPS` is no longer needed and has been removed.
- No startup or memory cost: their code still loads lazily on first call; the tool list grows by about 5 KB.

## v1.0.0 (2026-09-29)

**中文** | [English](#english)

v1.0 是一次从零开始的重写，目标是**更轻、更快、和上游对齐更全**。这是不兼容升级，旧版 v0.x 的工具名和参数不再保留。

#### 亮点

- **轻量原生架构**：内置最小化的 MCP stdio 传输，去掉了 `@modelcontextprotocol/sdk` 和 LangGraph；运行时依赖只剩 3 个（json5、yauzl、zod）。
- **性能**：握手约 90 ms，空闲 CPU 约为 0（没有常驻定时器或轮询），空闲内存约 65 MB；esbuild 构建约 60 ms。
- **可靠的任务执行**：构建、部署等有副作用的操作都作为任务运行。执行前先记录意图、完成后记录回执，服务中断后不会盲目重做；任务数据存在 `node:sqlite`（WAL 模式）里。
- **可单独更新的知识包**：每个 `.tgz` 包含 FTS5 索引、中文分词词表和文档，下载时校验 sha512，原子切换，支持回滚；也可以直接用上游最新的知识库生成。
- **12 个核心工具加 3 个可选组**：`doctor`、`project`、`run`、`job`、`code`、`device`、`ui`、`ui_flow`、`diagnose`、`knowledge`、`skills`、`auth`；可选组：`sign`、`emulator`、`hot_reload`。

#### 和上游对齐（deveco-code / deveco-cli）

能力级验收：上游共 81 项，**60 项完整覆盖、3 项由命令行子命令提供、18 项由宿主 AI 自身提供，缺口为 0**。每次 CI 都会读取服务实际的工具 JSON Schema 做参数级比对。

- **UI 测试会话**（宿主驱动）：`test_start` → `test_step` → `review` → `test_finish` → `test_log` / `test_export`。每一步自动记录操作前后截图、控件摘要和应用日志片段。视觉判断由宿主 AI 完成；控件断言失败时，视觉判断不能改判为通过。
- **启动冒烟判定**：`build_run` 返回 `PASS` / `FAIL_CRASH` / `FAIL_BLANK`，其中 `FAIL_BLANK` 表示启动后白屏或黑屏。
- `device sqlite`：查询设备上的数据库，返回 JSON；默认只读，也可以按 bundle 直接访问调试包的 RDB 数据库。
- `ui windows`：列出窗口；`tree` / `observe` 支持按窗口和深度过滤。录屏新增 `record_status` / `discard` / `external`，录制状态持久化保存。
- `project build task=compileNative`：编译后合并 `compile_commands.json`，供 clangd 使用。
- `code api_versions`；`doctor` 新增 SDK 与设备的兼容性检查。
- `sign auto` 会从 `module.json5` 自动推导 ACL 权限；登录支持 `region` cn / global。
- 命令行：`init --host <宿主>` 一步完成 MCP 配置和 Skill 导出，支持 8 种宿主，重复执行不会重复写入；`serve-lsp [--cpp]` 把 ArkTS 或 C++ 语言服务透传给编辑器。

#### 从 v0.4 保留的功能

逐项评估见 [docs/v0-feature-review.md](docs/v0-feature-review.md)，最终保留：

- 鼠标操作（点击、双击、长按、移动、滚轮、拖拽）和组合键（最多 3 个键）。
- `ui act verify_change`：比较操作前后的界面，判断操作是否生效。
- `diagnose crash since_minutes`：按时间窗口补采崩溃日志；量产手机上也能读取故障日志。
- `sign` 可选组逐项操作：`keypair`、`csr`、`certificate_create`、`profile_create`、`profile_delete`。

#### 升级说明

- **不兼容升级**：工具名、参数和状态目录都变了。v0.x 的登录凭据可以用 `auth action=import` 迁移。
- 需要 Node 22.18 及以上，以及 DevEco Studio 或 Command Line Tools。
- 安装：`npm ci && npm run build`，然后执行 `node dist/cli.js init --host cursor`，或者参考 README 手动配置。

---

<a id="english"></a>

### English

v1.0 is a **from-scratch rewrite** focused on a smaller footprint, faster startup, and more complete upstream parity. It is a **breaking release**: v0.x tool names and parameters are not kept.

#### Highlights

- **Lean native architecture**: the built-in minimal MCP stdio transport replaces `@modelcontextprotocol/sdk` and LangGraph. Only 3 runtime dependencies remain (json5, yauzl, zod).
- **Performance**: about 90 ms handshake, near-zero idle CPU (no background timers or polling), about 65 MB idle RSS, and about 60 ms esbuild builds.
- **Durable jobs**: builds, deploys and other side effects run as jobs that record intent before running and a receipt after, so an interrupted server never blindly repeats work. Job state is stored in `node:sqlite` (WAL).
- **Independently updatable knowledge packs**: each `.tgz` holds an FTS5 index, a Chinese segmentation vocabulary and the docs. Downloads are sha512-verified, switched atomically and can be rolled back; a pack can also be built from the latest upstream knowledge base.
- **12 core tools plus 3 optional groups**: `doctor`, `project`, `run`, `job`, `code`, `device`, `ui`, `ui_flow`, `diagnose`, `knowledge`, `skills`, `auth`; optional groups: `sign`, `emulator`, `hot_reload`.

#### Upstream parity (deveco-code / deveco-cli)

Capability-level check: of 81 upstream capabilities, **60 are fully covered, 3 are CLI subcommands, 18 are provided by the host AI itself, and 0 are missing**. CI compares the server's live tool JSON Schemas parameter by parameter.

- **UI test sessions** (host-driven): `test_start` → `test_step` → `review` → `test_finish` → `test_log` / `test_export`. Every step records before/after screenshots, an element summary and a window of the app's logs. The host AI makes the visual judgement; it can never overturn a failed control assertion.
- **Launch smoke verdict**: `build_run` returns `PASS` / `FAIL_CRASH` / `FAIL_BLANK`, where `FAIL_BLANK` means the screen is blank (white or black) after launch.
- `device sqlite`: queries on-device databases and returns JSON rows. It is read-only by default, and a debuggable app's RDB store can be reached by bundle.
- `ui windows` lists windows; `tree` / `observe` can filter by window and depth. Screen recording adds `record_status`, `discard` and `external`, and the recording state survives server restarts.
- `project build task=compileNative` merges `compile_commands.json` for clangd.
- `code api_versions`; `doctor` now checks SDK and device compatibility.
- `sign auto` derives ACL permissions from `module.json5`; login supports `region` cn / global.
- CLI: `init --host <host>` sets up the MCP config and exports skills in one step for 8 hosts, and re-running it never duplicates entries. `serve-lsp [--cpp]` passes the ArkTS or C++ language server through to editors.

#### Kept from v0.4

Each feature was assessed in [docs/v0-feature-review.md](docs/v0-feature-review.md). The kept ones:

- Mouse actions (click, double click, long press, move, wheel, drag) and key chords of up to 3 keys.
- `ui act verify_change`: compares the screen before and after an action to show whether it took effect.
- `diagnose crash since_minutes`: collects crash logs from a time window, including fault logs on production phones.
- Itemized actions in the `sign` group: `keypair`, `csr`, `certificate_create`, `profile_create`, `profile_delete`.

#### Upgrading

- **Breaking**: tool names, parameters and the state directory have changed. Import v0.x credentials with `auth action=import`.
- Requires Node 22.18 or later, plus DevEco Studio or the Command Line Tools.
- Install with `npm ci && npm run build`, then run `node dist/cli.js init --host cursor`, or configure the host by hand as described in the README.
