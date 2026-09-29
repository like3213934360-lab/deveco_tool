# Changelog / 更新日志

## v1.1.2 (2026-09-29)

**中文**

每个工具的每个动作都做了实测（单元测试 44 项、模拟器端到端测试 19 项、LingDong 真机 62 项全部通过），并修复了测试中发现的问题：
- **代码静态检查的误报**（上游 `deveco-cli` 自带的 `arkts-check.cjs` 同样存在）：注释或字符串里的 `{`、`}` 被当成代码，导致 `@Builder` 之后的普通方法都被判为"界面代码里不能声明变量/写循环"；容器组件名单是写死的，不认识 `HdsNavigation` 等 HMS 组件。现在括号扫描会跳过注释和字符串，容器判断改为读取本机 SDK（OpenHarmony + HMS）的组件描述，与编译器一致；SDK 不认识的组件不再报错。LingDong 全项目检查由 119 个误报降为 0；8 个用例（4 个真错误 + 4 个易误报的合法写法）的结论与编译器完全一致。
- **构建成功时明确告诉 AI 预检报错是误报**：构建结果中的 `preflight` 会写明"编译器已接受这些代码，不要为此修改"，避免 AI 去改能正常编译的代码。
- **模拟器操作失败被当成成功**：Emulator 命令失败时也返回成功，现在按输出判断；运行中的模拟器拒绝删除；`list`/`stop` 支持 `instance_path`。
- **取消构建后代码检查一直卡住**：检查进程或语言服务退出后会自动换新进程，不再卡住。
- **MCP 服务崩溃后任务无法继续**：被中断的任务会显示为"已中断"，可以继续执行或取消。
- **输入框中的英文引号被改成中文弯引号**：现在原样输入。
- **签名校验**：未签名的包返回 `verified=false` 和原因，不再报工具错误；校验通过时给出 profile 摘要（包名、设备数、到期时间、ACL 权限）。签名密码错误时直接说明原因。
- **测试**：新增云端签名和登录的模拟服务测试、覆盖所有 UI 操作的手势测试页；真机冒烟测试只使用 LingDong。

**English**

Every action of every tool is now exercised by tests (44 unit, 19 emulator end-to-end and 62 real-device checks on LingDong, all passing). Fixes for the problems the tests found:
- **False positives in the ArkTS static check** (also present in upstream `deveco-cli`'s `arkts-check.cjs`): braces inside comments and strings were counted as code, so every method after a `@Builder` was reported as builder code; the container list was hard-coded and missed HMS components such as `HdsNavigation`. Brace scanning now skips comments and strings, and container detection reads the installed SDK's component descriptors (OpenHarmony and HMS), as the compiler does. Components the SDK does not know are no longer reported. LingDong's whole-project check went from 119 false errors to 0, and the verdict on 8 cases (4 real errors and 4 valid but easily misjudged patterns) now matches the compiler on all of them.
- **A successful build tells the agent that preflight errors were false positives**: the build result's `preflight` says the compiler accepted the code and that nothing should be changed for it.
- **Failed emulator operations were reported as successes**: the Emulator CLI exits 0 on failure, so failure is now detected from its output. Deleting a running emulator is refused, and `list`/`stop` accept `instance_path`.
- **Code checks hung after a cancelled build**: a checker or language server whose process died is replaced automatically.
- **Jobs could not continue after an MCP server crash**: interrupted jobs now show as interrupted and can be resumed or cancelled.
- **Straight quotes in text input became curly quotes**: text is now entered exactly as given.
- **Signature verification**: unsigned packages return `verified=false` with a reason instead of a tool error; verified packages include a profile summary (bundle, device count, expiry, ACL permissions). A wrong keystore password is now reported as such.
- **Tests**: mock-service tests for cloud signing and login, and a gesture page covering every UI action. The real-device smoke test uses LingDong only.

## v1.1.1 (2026-09-29)

**中文**

在真实项目上发现并修复的问题（全部已在真机实测通过）：
- **重新构建会打断正在运行的 MCP 服务**：之前每次构建都会清空 `dist/`，正在运行的 Codex/Cursor 里的服务再按需加载模块时就会报 `Cannot find module dist/chunks/...`，这正是 Codex 无法安装应用的原因。现在构建只新增文件，一天以上的旧文件才清理；已验证重新构建后，正在运行的服务仍能正常调用。
- **多设备工程只构建、安装匹配设备的模块**：像 LingDong 这样“手机 + 手表”两个 entry 的工程，`run` 会先识别目标设备类型，再只构建和安装 `deviceTypes` 匹配的模块（手机只装 `default`，手表只装 `watch`），不会再把两个包一起装。显式指定 `modules` 时，如果模块不适用于该设备，会在安装前直接拒绝并说明原因。`launch` 和 `hot_reload` 默认模块也按设备选择。
- **不改动工程已有的签名**：`sign auto` 检测到工程已配置签名（`build-profile.json5` 或 `hvigorfile.ts` 的 overrides）时拒绝执行，不做任何修改（`force=true` 才会替换）。热重载优先使用 hvigor 用工程签名生成的补丁包，不再自行签名。
- **ArkTS 预检不再阻断构建**：静态预检是近似检查，在真实工程上有误报（例如 `HdsNavigation` 作为根节点），之前会直接跳过构建。现在只作为提示随结果返回，以 hvigor 编译结果为准。问题文件路径也改为相对于工程根目录。

真机验证（手机 Pura 80 Pro，API 26）：
- LingDong：`build_run` 自动选择 `default` 模块，只构建和安装 `default-default-signed.hap`，启动冒烟判定 PASS；显式指定 `watch` 时在安装前返回 `DEVICE_MISMATCH`；`sign auto` 返回 `SIGN_CONFIGURED`，签名保持不变。
- MyStarRing：`build_run` 成功，冒烟判定 PASS。热重载在工程的一份副本上测试：使用 hvigorfile overrides 签名打出的补丁包在真机上生效（日志中出现补丁代码输出的标记），测试后已撤销补丁，并重新部署原版应用。
- 两个工程的源码均未修改（前后逐文件哈希对比）。唯一的变化是 hvigor 每次构建都会重新生成的 `BuildProfile.ets`，这与 DevEco Studio 自己构建时的行为相同。

**English**

Problems found on real projects and fixed (all verified on a physical phone):
- **Rebuilding broke running MCP servers**: every build wiped `dist/`, so a server already running in Codex or Cursor failed to load its next module (`Cannot find module dist/chunks/...`). That is why Codex could not install apps. Builds now only add files, and chunks older than a day are pruned. Verified: a running server keeps working after a rebuild.
- **Multi-device apps build and install only the matching modules**: for projects with one entry per device class (LingDong: phone + watch), `run` detects the target device type and builds and installs only the modules whose `deviceTypes` match (phone gets `default`, watch gets `watch`), so both packages are never installed together. An explicit `modules` choice that cannot run on the device is refused before anything is installed. `launch` and the `hot_reload` default module follow the same rule.
- **Existing project signing is never changed**: `sign auto` refuses and changes nothing when the project already has signing (`build-profile.json5` or `hvigorfile.ts` overrides); only `force=true` replaces it. Hot reload now uses the HQF that hvigor signed with the project's own signing instead of signing it itself.
- **The ArkTS preflight no longer blocks builds**: the static check is an approximation and had false positives on real projects (such as `HdsNavigation` as the root node), which previously skipped the build. Its findings are now reported with the result and hvigor decides. Issue paths are now relative to the project root.

Verified on a phone (Pura 80 Pro, API 26):
- LingDong: `build_run` picks the `default` module and builds and installs only `default-default-signed.hap`, with smoke verdict PASS. Explicitly choosing `watch` returns `DEVICE_MISMATCH` before installing, and `sign auto` returns `SIGN_CONFIGURED` with signing untouched.
- MyStarRing: `build_run` succeeds with smoke verdict PASS. Hot reload was tested on a copy of the project: the HQF signed through the hvigorfile overrides took effect on the phone (a marker from the patched code appeared in the log); the patch was then removed and the original app redeployed.
- Neither project's source changed (per-file hash comparison before and after). The only difference is `BuildProfile.ets`, which hvigor regenerates on every build, just as DevEco Studio does.

## v1.1.0 (2026-09-29)

**中文**

对齐方式重建：以前的对齐检查依据一张手写对照表，会漏。现在改为由脚本从上游源码**全量自动抽取**所有能力项（工具、参数、取值、命令、选项、选项取值、deveco-cli 自带 MCP 服务的工具、Skill），共 467 项。每一项都必须有明确决策：完整覆盖（写明对应的工具和参数，由脚本对照服务实际的 JSON Schema 核对）、由宿主提供、或明确不需要（写明理由）。没有决策、核对不通过、决策过期或上游有新提交，CI 都会失败；GitHub 上每周自动检查一次。完整清单见 `docs/upstream-alignment.md`。

按清单补齐的功能：
- 代码导航：`code lsp` 新增 `call_hierarchy`（`direction` 调用者/被调用者，C++ 仅支持调用者）和 `declaration`；`lsp_restart` 可只重启 ArkTS 或 C++。
- 代码检查：`lint` 新增 `config_path`、`incremental`（只查未提交文件）、`output_path`；`api_scan` 新增 `modules`、`output_path`。
- 日志：`device log` 新增 `from`/`to` 相对时间段（在设备上按分钟预过滤，繁忙真机也能取到半小时前的日志）；`follow` 加游标持续获取新日志，不常驻后台进程。
- 运行：`run build_run` 新增 `skip_build`、`uninstall_first`；`hot_reload` 新增 `files`（指定改动文件）、`restart`（打补丁后重启应用）和 `stop_daemon`。
- 模拟器：新增 `remove_image`、`license_view`（只读）；`create` 新增 `screen_profile`、`screen`、`hot_boot`、`instance_path`、`image_root`、`force`；`start`/`stop` 支持多个名称；`images` 默认只列已下载的，`all` 列出全部；`install_image` 支持 `force`；新增湿度、温度传感器和 `battery_status`。
- 模拟器许可协议：启动、创建、下载镜像时如果协议还没同意，会自动同意并在结果中注明（`auto_accept_license=false` 可关闭）；拒绝启动时立即返回原因，不再等待超时；模拟器进程不再随 MCP 服务退出而关闭。
- UI：`screenshot` 新增 `display`、`save_path`；`tree` 新增 `all_windows`、`node`（单个组件子树）；`record_stop` 新增 `save_path`；文本输入改为 base64 传输，空格、引号、`$` 等特殊字符都能原样输入。
- Skill：`export`/`install`/`uninstall`/`init` 新增 `path`（任意目录）；命令行 `serve-lsp` 新增 `--auto-detect`。

其他：
- 安装失败 9568297（设备 API 低于应用要求）给出明确提示。
- tools/list 中重复的选择器定义只输出一次，工具描述总大小控制在 36 KB 以内。`npm run bench` 增加性能预算检查（握手 < 150 ms、空闲内存 ≤ 70 MB、工具描述 ≤ 36 KB、空闲 CPU 不增长）。
- 经评估不做 spec 规格开发流程（宿主自带 Plan 模式已经覆盖），同时删除 `implement-feature` Prompt。
- 行为对照：白屏判定与上游的图像指纹算法在 7 组样本上结论一致；按组件 id 点击、向焦点控件输入文本与上游行为一致。

**English**

Alignment rebuilt: the previous check relied on a hand-written mapping and missed things. A script now **extracts every capability item from upstream source automatically** (tools, parameters, enum values, commands, options, choices, deveco-cli's bundled MCP tools, skills): 467 items. Each needs an explicit decision: full (with a target that the script verifies against the server's live JSON Schemas), host-provided, or not needed (with a reason). Undecided or unverifiable items, stale decisions and new upstream commits all fail CI, and GitHub re-checks weekly. The full list is in `docs/upstream-alignment.md`.

Gaps closed from the list:
- Code navigation: `code lsp` adds `call_hierarchy` (`direction` callers/callees; C++ supports callers only) and `declaration`; `lsp_restart` can restart only ArkTS or C++.
- Code checks: `lint` adds `config_path`, `incremental` (uncommitted files only) and `output_path`; `api_scan` adds `modules` and `output_path`.
- Logs: `device log` adds `from`/`to` relative windows (pre-filtered on the device by minute, so busy phones still return logs from half an hour ago) and `follow` with a cursor that streams new lines across calls without a background process.
- Run: `run build_run` adds `skip_build` and `uninstall_first`; `hot_reload` adds `files` (explicit changed files), `restart` (relaunch after patching) and `stop_daemon`.
- Emulator: adds `remove_image` and read-only `license_view`; `create` adds `screen_profile`, `screen`, `hot_boot`, `instance_path`, `image_root` and `force`; `start`/`stop` take several names; `images` lists downloaded images by default and every image with `all`; `install_image` supports `force`; adds humidity and temperature sensors and `battery_status`.
- Emulator license: start, create and image download accept the agreements automatically when needed and say so in the result (`auto_accept_license=false` opts out). A refused start now reports the reason at once instead of timing out, and emulators no longer exit when the MCP server does.
- UI: `screenshot` adds `display` and `save_path`; `tree` adds `all_windows` and `node` (one component subtree); `record_stop` adds `save_path`. Text input is now sent base64-encoded, so spaces, quotes, `$` and other special characters arrive exactly as typed.
- Skills: `export`/`install`/`uninstall`/`init` add `path` (any directory); the `serve-lsp` CLI command adds `--auto-detect`.

Also:
- Install error 9568297 (device API lower than the app requires) now comes with a clear hint.
- The selector schema is emitted once in tools/list, keeping all tool descriptions within 36 KB. `npm run bench` now enforces performance budgets (handshake < 150 ms, idle RSS ≤ 70 MB, tool descriptions ≤ 36 KB, no idle CPU growth).
- The spec-driven workflow was evaluated and dropped (the host's own plan mode covers it), and the `implement-feature` prompt was removed.
- Behaviour checks: blank-screen detection agrees with upstream's image-fingerprint algorithm on all 7 samples; clicking by component id and typing into the focused field match upstream behaviour.

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
