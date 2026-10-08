# deveco-mcp

**中文** | [English](#english)

一个轻量的鸿蒙（HarmonyOS）开发 MCP 服务。任何 MCP 宿主（Cursor、Claude Code、Codex 等）都可以通过它调用 DevEco 工具链，完成鸿蒙应用的构建、运行、调试和验证，并离线查询鸿蒙开发知识。

- **完整覆盖上游。** 对照 [deveco-code](https://gitcode.com/openharmony-sig/deveco-code) 和 [deveco-cli](https://gitcode.com/openharmony-sig/deveco-cli) 做了全量验收：脚本从上游源码自动抽取每一个工具、参数、取值、命令、选项和内置 MCP 工具，共 467 项，每一项都有经过核对的对应关系（完整覆盖 355 项，由宿主 AI 提供 70 项，明确不需要 42 项并写明理由），缺口为 0。完整清单见 [docs/upstream-alignment.md](docs/upstream-alignment.md)，CI 每周自动重跑，上游有新提交或新能力时会报出。在此之外，还提供可恢复的异步任务、UI 流程录制与回放、崩溃模式匹配、按符号名定位的 LSP 查询，以及可以独立于服务更新的知识包。
- **轻量。** 运行时依赖只有 3 个，不用 LangGraph，也没有原生模块（数据库用 Node 自带的 `node:sqlite`）。单进程运行，空闲时不占 CPU。语言服务和代码检查器按需启动，空闲 10 分钟后自动关闭。
- **为 AI 宿主设计。** 15 个工具按用途命名，全部默认可用；返回结构化且长度有上限；每个错误都带 `code`、`category` 和修复提示 `hint`；耗时操作以任务形式异步执行。

| 指标（M 系列 Mac，Node 24/26） | v1.0 | v0.4 |
| --- | --- | --- |
| MCP 握手 | 约 90 ms | 140–315 ms |
| 空闲 CPU | ≈0（无定时器、无轮询） | 长时间运行时实测 8–12% |
| 空闲内存（刚启动） | 约 65 MB | 约 120 MB（使用数小时后约 260 MB） |
| 构建本仓库 | 约 60 ms（esbuild） | 约 5 s（tsc，350 个文件） |
| 运行时依赖 | 3 | 16 |
| 源码行数（`src`） | 约 5.7k | 约 35k |
| 知识检索 | 3–20 ms | — |

## 安装

```sh
git clone https://github.com/like3213934360-lab/deveco_tool.git && cd deveco_tool
npm ci && npm run build
```

需要 Node 22.18 及以上，以及 DevEco Studio 或 Command Line Tools。设备不是必需的，只有 run、ui、device 相关功能需要真机或模拟器。

宿主启动入口固定为 `bin/deveco-mcp.mjs`。源码目录启动时会核对源码指纹和全部产物；更新源码后漏构建，会先自动完成本地构建，构建失败则拒绝启动旧代码。npm 包在打包前重建，安装后发现产物不完整或版本不符会明确报错。版本号在编译时固定，启动日志和 `doctor.server.build_id` 可确认实际构建身份。

构建通过不可变目录和原子切换发布新产物，保留已运行连接的分包；现有指向 `dist/cli.js` 的配置也会进入同一启动校验。已运行的连接继续使用原构建，重载宿主 MCP 后才采用新构建。旧产物不按时间自动删除；需要回收时，先关闭使用此目录的全部连接，再删除 `dist` 并运行 `npm run build`。npm 包仅包含当前构建。

用一条命令完成 MCP 配置并导出 Skill。支持 cursor、claude、codex、opencode、trae-cn、codebuddy、qoder、pi；已有同名配置不会被覆盖，除非加 `--force`：

```sh
node bin/deveco-mcp.mjs init --host cursor                 # 用户级配置（~/.cursor/mcp.json + ~/.cursor/skills）
node bin/deveco-mcp.mjs init --host codex --project .      # 项目级配置（.codex/config.toml + .agents/skills）
```

编辑器也可以直接使用 SDK 的语言服务：`node bin/deveco-mcp.mjs serve-lsp [--cpp] [--project <root>]`（stdio）。

也可以手动配置：

```json
{
  "mcpServers": {
    "deveco": {
      "command": "node",
      "args": ["/absolute/path/to/deveco_tool/bin/deveco-mcp.mjs", "mcp"],
      "env": {
        "DEVECO_CONFIG": "/absolute/path/to/deveco-mcp.json"
      }
    }
  }
}
```

`deveco-mcp.json` 是可选的；不提供时，使用 DevEco Studio 的默认安装位置。

```json
{ "studio": "/Applications/DevEco-Studio.app" }
```

其他配置项：

| 配置项 | 作用 |
| --- | --- |
| `clt` | Command Line Tools 路径，可以代替 `studio` |
| `java_home` | 使用的 JDK |
| `state_dir` | 状态目录，默认 `~/.deveco-mcp` |
| `retention_days` | 截图、录屏、日志、测试导出等运行产物的保留天数，默认 1（含 `save_path` / `test_export` 导出的副本） |
| `max_jobs` | 最多保留的任务数，默认 200 |
| `max_artifact_mb` | 制品总大小上限，默认 512 |
| `session_idle_minutes` | 语言服务等会话的空闲关闭时间，默认 10 |
| `auto_accept_ui_agreements` | UI 操作、批量操作、流程回放及部署/测试断言自动处理协议与权限弹窗，默认 `true`；按同一窗口中的文案和控件状态识别，结果记录 `agreements_accepted`。纯观察不触发同意 |
| `kb_package` | 知识包的 npm 包名 |
| `npm_registry` | 更新知识包时使用的 npm 源 |

用 `node bin/deveco-mcp.mjs doctor [project]` 或 `doctor` 工具检查环境。

## 工具

| 工具 | 功能 |
| --- | --- |
| `doctor` | 检查工具链、SDK、设备、工程、知识包和登录状态，以及 SDK 兼容性（工程的编译/兼容 SDK、已安装 SDK、设备 API 级别）；每项失败都附带修复方法 |
| `project` | `info` / `create`（基于模板，不会覆盖已有文件）/ `sync` / `build`（先对上次以来改过的 .ets/.ts 做 ArkTS 预检，再调用 Hvigor；返回产物，或全部编译错误（错误码、文件、行号、原因，前 100 条逐条列出）和修复提示；`oh-package.json5` 改动后自动先装依赖；`modules` 支持 `模块@target`；`task=compileNative` 编译 C/C++，并生成供 clangd 使用的 `.idea/.deveco/cxx/compile_commands.json`）/ `clean` |
| `run` | 多设备工程（如手机 + 手表两个 entry）只构建和安装与目标设备 `deviceTypes` 匹配的模块，工程已有签名原样使用。连着多台设备又没指定 `target` 时不会自己挑，会列出每台设备（名称、真机/模拟器、是否匹配工程）让 AI 先问用户；`target` 可填序列号或设备名。`build_run`（构建、安装、启动，给出冒烟判定 `PASS` / `FAIL_CRASH` / `FAIL_BLANK`，可附带 UI 断言；启动就崩时附上崩溃诊断和工程内出错的源码位置；**从第二次部署起，只改了入口模块代码时自动热修复正在运行的应用并重启（实测 6–10 秒，完整部署 15–25 秒）**，其他改动自动完整部署并说明原因，没改动时只重启，`run_mode=full` 强制完整部署；`then_flow` 部署后自动走到保存的页面；`skip_build` 直接部署已有产物，`uninstall_first` 先卸载再安装）/ `deploy` / `launch` / `stop` / `uninstall` |
| `job` | `wait` / `status` / `list` / `cancel` / `resume` / `read`（按行分页读取日志，支持 `grep`） |
| `code` | `check`（常驻的 ArkTS 静态检查，`fix` 自动修复安全的问题）/ `lint`（`config_path`、`incremental` 只查未提交文件、`output_path`）/ `api_scan`（按文件或 `modules`，`output_path`）/ `api_versions` / `lsp`：hover、definition、declaration、implementation、references、symbols、workspace_symbols、diagnostics、completion、signature、call_hierarchy（`direction` 调用者/被调用者）。用 `symbol` 加行号提示定位代码，不需要精确列号 / `lsp_restart`（`language` 只重启 ArkTS 或 C++） |
| `device` | `list` / `info` / `log`（按应用、级别或正则过滤；`from`/`to` 取相对时间段，如 5 分钟前到 1 分钟前；`follow` 加游标持续获取新日志；`clear` 清空；带 `project` 时把报错行里的源码位置定位到工程文件）/ 只读 `shell` / `sqlite`（查询设备数据库或调试包的 RDB 数据库，返回 JSON；默认只读，传 `write` 才可写）/ `send` / `recv` |
| `ui` | `observe`（截图加精简控件列表）/ `screenshot`（`display` 多屏、`save_path` 另存）/ `tree`（`window`、`depth`（0 不限，1 只有根节点，与 devecocli 一致）、`all_windows` 全部窗口、`node` 单个组件子树）/ `windows` / `find` / `act`（点击；输入，支持中文和任意特殊字符，默认替换原内容；键入；滑动；滚动；按键和组合键；鼠标点击、移动、滚轮、拖拽；每次返回 `after`：新出现和消失的控件、是否换页，一般不必再 `observe`；`steps` 一次调用执行整条路径，每步自动等待控件出现，可带最终断言，`save_flow` 存成 flow；同一路径重启后又走一遍时会提示存起来）/ `assert` / `visual`（截图回归：按名称和机型保存基准，之后对比，返回变化比例、区域和红框标注图）/ `layout`（检查当前页面的布局问题：超出屏幕、可点区域重叠、文字被裁切或被挤没、点击区域过小；`forms` 在折叠屏、阔折叠、三折叠模拟器上逐个形态和折叠状态检查）/ `perf`（在当前页面滑动，按逐帧时间统计帧率、帧耗时 p50/p95/最大值、卡顿帧和内存变化） / 录屏 `record_start` / `record_stop`（`discard`、`external`、`save_path`）/ `record_status`。**UI 测试会话**由宿主 AI 驱动：`test_start` → `test_step`（执行操作或断言，记录操作前后截图、控件摘要和应用日志片段）→ `review`（宿主看截图做判断；控件断言失败时不能改判为通过）→ `test_finish`（生成 JSON 和 Markdown 报告）→ `test_log` / `test_export` |
| `ui_flow` | 用 `ui act` 录制可复用的操作流程，以一个最终断言收尾保存，回放时支持变量替换和自动修复，`snapshot` 回放后做截图回归。保存在 `.arkpilot/flows`，兼容 v0.x |
| `diagnose` | `crash`（读取 jscrash、cppcrash、appfreeze 日志，量产手机也支持；`since_minutes` 限定时间窗口；提取错误特征和应用调用栈，并匹配故障模式库；带 `project` 时解析已有 ArkTS 源码位置及前后代码。Native PC 保留在报告中，尚不提供 C++ 地址符号化）/ `build` |
| `knowledge` | 离线文档、ArkTS 规则、错误案例和运行时问题模式：`search` / `read`（按 `section` 读取）/ `catalog` / `status` / `update` / `rollback`；`source=cloud` 在线查询 CodeGenie，每段按正文与本地官方文档比对，标注官方 / 官方·非 ArkTS 平台 / 社区 / 未确认 |
| `skills` | 内置的鸿蒙 Skill：`list` / `read`；`export` 导出为宿主原生的 `SKILL.md`（`path` 指定任意目录）；`install_mcp` 把本服务写入宿主配置（cursor、claude、codex、opencode、trae-cn、codebuddy、qoder、pi；重复执行不会重复写入；atomcode、dsh、deveco 只导出技能）；`init` 一次完成两者；`search` / `install` / `uninstall` 使用 OpenHarmony Skill 市场 |
| `auth` | 华为账号浏览器登录：`codegenie`（云端知识）或 `developer`（签名），`region` 可选 cn / global；`teams`；`import` 导入 v0.x 的登录凭据 |
| `sign` | `auto`（工程已配置签名时拒绝执行、不做任何修改，`force` 时先准备并验证新材料，再原子切换配置；保留旧材料和证书，需要空闲证书名额；否则一键为真机生成调试签名：密钥库、证书、设备注册、Profile，ACL 权限从 `module.json5` 自动推导，并写入工程的 `signingConfigs`）/ `sign` / `verify` / AppGallery Connect 证书和设备管理 / 逐项操作 `keypair`、`csr`、`certificate_create`、`profile_create`、`profile_delete`。账号属于多个开发者团队时，会在 AGC 新建或删除东西的操作必须指定 `team`（否则列出团队让 AI 先问用户） |
| `emulator` | `list`（`details`）/ `start` / `stop`（`name` 或多个 `names`；启动会等待开机完成）/ `create`（`screen_profile` 或自定义 `screen`、`hot_boot`、`instance_path`、`image_root`、`force`）/ `delete` / `images`（按行返回设备类型和系统版本；默认已下载，`all` 全部）/ `install_image`（`force` 重新下载；返回路径、大小、耗时）/ `remove_image` / `license`（接受）/ `license_view`（只读查看）/ `scenario`（电量和充电状态、GPS、光照/湿度/温度/步数/心率传感器、旋转、折叠、运动场景等）。启动、创建、下载镜像时，如果许可协议还没同意，会自动同意并在结果中注明（`auto_accept_license=false` 可关闭） |
| `hot_reload` | `apply` 把 ArkTS 改动以 HQF 快速修复包推送到运行中的应用，约 5 秒生效（实测 4.4–4.7 秒），应用不重启（`files` 指定改动文件，`restart` 打完补丁后重启应用）；`reset` 撤销改动；`stop_daemon` 停止工程的 hvigor 守护进程 |

内置 3 个 Skill：

| Skill | 用途 |
| --- | --- |
| `hmos-arkui-develop-skill` | 写 ArkTS/ArkUI 前必读：26 条高频致命错误、组件 API 速查卡片（`quick-apis`）和约束规则（`quick-rules`）。来自上游 DevEco Code，MIT 许可 |
| `hmos-runtime-fix-skill` | 闪退、崩溃、白屏排查流程和 9 类崩溃模式库；已改为使用本服务的 `diagnose`、`device log`。来自上游 DevEco Code，MIT 许可 |
| `deveco-mcp-workflow` | 各种场景下该用哪个 deveco 工具、按什么顺序调用 |

项目级导出（`scope=project` 或 `init --project`）写入 `<project>/.agents/skills`，Codex、Claude Code、Cursor、Qoder、OpenCode、DevEco Code 都会读取这个目录，一份即可通用。

服务还提供 MCP **Resources**（`deveco://skills/<name>`）和 **Prompts**：`fix-build`、`debug-crash` 和 `upgrade-sdk`。需求规划交给宿主自带的 Plan 模式。

## 知识包

知识包是一个 `.tgz`，包含三个文件：

- `manifest.json`
- `index.db`：FTS5 全文索引，附带中文查询分词用的词表
- `docs.zip`

内容包括华为鸿蒙官方文档（开发指南、API 参考、最佳实践、FAQ、版本说明，约 1.47 万篇），以及本仓库 `knowledge/` 目录下的 ArkTS 规则、31 个编译错误案例和上述 Skill（含崩溃模式库和 ArkUI 速查）。

- **内置：** npm 包 `@deveco-mcp/kb` 是可选依赖；本地开发时也可以用 `kb-dist/current`。
- **更新：** `knowledge action=update` 以任务形式运行：从 npm 下载，校验 sha512，解压到临时目录，检查结构，原子切换版本，并保留上一版本以便 `rollback`。`file=<path.tgz>` 安装本地知识包；`file=upstream` 从华为最新的 `@deveco-test/deveco-cli-knowledgebase` 生成新知识包。
- **构建与发布：** `node bin/deveco-mcp.mjs kb-build <上游包目录> kb-dist --version x.y.z` 生成可以发布到 npm 的包。`doctor remote=true` 会提示是否有新版本，但不会自动下载。

## 架构

```text
src/
  cli.ts        入口：mcp | doctor | init --host <h> | serve-lsp [--cpp] | kb-build | kb-update
  mcp.ts        最小化的 MCP stdio JSON-RPC（tools、resources、prompts、取消）
  server.ts     工具注册；JSON Schema 在第一次 tools/list 时才生成
  jobs.ts       任务定义（build、build_run、deploy、流程回放、知识包更新、自动签名）
  tools/        15 个工具（zod schema；领域模块在首次调用时才加载）
  domains/      project、device、ui、uitest、flows、code、diagnose、knowledge、kb-build、skills、hostconfig、auth、sign、emulator、hotreload、doctor、resources
  core/         config、toolchain、proc（按进程树结束）、db（node:sqlite WAL）、jobs、artifacts、sessions、lsp-client、errors、files
knowledge/      规则、错误案例、Skill（崩溃模式库在 hmos-runtime-fix-skill/references；知识包和 resources 的来源）
templates/      工程模板
resources/      内置的 arkts-check.cjs、hypium uitest agent、许可证
tools/          build.mjs、bench.mjs（含性能预算检查）、upstream-sync.mjs + upstream/（全量抽取与决策表）、mcp-client.mjs
test/unit       离线测试（npm test）；test/e2e：真实 SDK 和设备（npm run test:e2e）
```

任务机制用一个小型的持久化步骤执行器代替了 LangGraph：

- 每一步的输出在下一步开始前保存。
- 有副作用的步骤（安装、签名）执行前先记录意图，完成后记录回执。
- 如果在两者之间崩溃，任务会进入 `needs_input`，不会盲目重做。
- 检查过现场后，通常可以用 `job resume force=true` 重新执行该步骤；自动签名的云端创建和配置提交必须先核对回执，`force` 不能跳过这个保护。
- 启动时，所属进程已经退出的任务会被标记为 `interrupted`。

保留策略按时间、任务数和总大小三个上限控制。清理在每个任务结束后执行，不使用定时器。

## 开发

```sh
npm run typecheck            # 只对 src/ 做增量 tsc 检查
npm run build                # esbuild 打包（约 60 ms）
npm test                     # 单元测试，不需要 SDK
DEVECO_CONFIG=... E2E_TARGET=127.0.0.1:5555 npm run test:e2e   # 真实 SDK 加设备或模拟器
npm run bench                # 握手、空闲 CPU/内存、tools/list 大小
node tools/upstream-sync.mjs # 全量上游对齐检查（有未决策、未对齐、过期决策或上游新提交时退出码为 1；--report 生成清单）
```

### 从 v0.x 迁移

v0.x 冻结在标签 `v0.4-final`，v1 不读取 v0.x 的状态目录。

- **流程：** `.arkpilot/flows` 下的文件可以直接使用。
- **登录：** 执行 `auth action=import`（默认从 `~/.deveco-tool` 导入）。
- **工具名：** 已改变，以上面的工具表为准。
- v0.4 独有功能的取舍见 [docs/v0-feature-review.md](docs/v0-feature-review.md)。

## 许可证

MIT。第三方声明：`NOTICE.deveco-cli`、`NOTICE.deveco-code`、`NOTICE.hypium`、`resources/licenses/`。

---

<a id="english"></a>

## English

A lean MCP server for HarmonyOS development. It lets any MCP host (Cursor, Claude Code, Codex, …) build, run, debug and verify HarmonyOS apps with the DevEco toolchain, and query HarmonyOS knowledge offline.

- **Covers upstream fully.** Every HarmonyOS tool in [deveco-code](https://gitcode.com/openharmony-sig/deveco-code) and every command in [deveco-cli](https://gitcode.com/openharmony-sig/deveco-cli) is verified exhaustively: a script extracts every tool, parameter, enum value, command, option and bundled MCP tool from upstream source (467 items) and each one has a verified mapping (355 full, 70 host-provided, 42 explicitly not needed with reasons), 0 gaps. See [docs/upstream-alignment.md](docs/upstream-alignment.md); CI re-runs it weekly and fails on new upstream commits or capabilities. It also adds asynchronous jobs with recovery, flow recording and replay, crash pattern matching, symbol-based LSP lookups, and knowledge packs that update independently of the server.
- **Light.** 3 runtime dependencies. No LangGraph, no native modules (uses the built-in `node:sqlite`). A single process with zero idle CPU. Language servers and the checker start on demand and shut down after 10 idle minutes.
- **Built for AI hosts.** 15 tools named by intent, all enabled by default. Responses are structured and bounded. Every error carries a `code`, a `category` and a fix `hint`. Long operations become jobs.

| Metric (M-series Mac, Node 24/26) | v1.0 | v0.4 |
| --- | --- | --- |
| MCP handshake | ~90 ms | 140–315 ms |
| Idle CPU | ≈0 (no timers or polling) | 8–12% observed in a long-running host |
| Idle RSS (fresh start) | ~65 MB | ~120 MB (≈260 MB after hours of use) |
| Build of this repo | ~60 ms (esbuild) | ~5 s (tsc, 350 files) |
| Runtime dependencies | 3 | 16 |
| Source lines (`src`) | ~5.7k | ~35k |
| Knowledge search | 3–20 ms | — |

### Install

```sh
git clone https://github.com/like3213934360-lab/deveco_tool.git && cd deveco_tool
npm ci && npm run build
```

Requires Node ≥ 22.18, plus DevEco Studio or the Command Line Tools. Devices are optional; they are needed for run/ui/device.

Hosts launch `bin/deveco-mcp.mjs`. In a source checkout it verifies the source fingerprint and all compiled outputs, builds stale/missing outputs locally before starting, and refuses to run old code if that build fails. npm packing rebuilds the package; an incomplete or mismatched installed package fails explicitly. The version is compiled into the code; startup logs and `doctor.server.build_id` identify the actual build.

Builds publish immutable directories through an atomic pointer and retain lazy chunks for existing connections. Existing `dist/cli.js` configurations enter the same startup gate. Running connections keep their original build until the host reloads MCP. Old outputs are never deleted by age; to reclaim them, close all connections using the checkout, delete `dist`, then run `npm run build`. npm archives contain only the active build.

Register the server and export the skills in one step (cursor, claude, codex, opencode, trae-cn, codebuddy, qoder, pi; existing entries are kept unless you pass `--force`):

```sh
node bin/deveco-mcp.mjs init --host cursor                 # user config (~/.cursor/mcp.json + ~/.cursor/skills)
node bin/deveco-mcp.mjs init --host codex --project .      # project config (.codex/config.toml + .agents/skills)
```

Editors can also use the SDK language servers directly: `node bin/deveco-mcp.mjs serve-lsp [--cpp] [--project <root>]` (stdio).

Or add it by hand:

```json
{
  "mcpServers": {
    "deveco": {
      "command": "node",
      "args": ["/absolute/path/to/deveco_tool/bin/deveco-mcp.mjs", "mcp"],
      "env": {
        "DEVECO_CONFIG": "/absolute/path/to/deveco-mcp.json"
      }
    }
  }
}
```

`deveco-mcp.json` is optional. If you omit it, the server uses the default DevEco Studio location.

```json
{ "studio": "/Applications/DevEco-Studio.app" }
```

Other config keys:

| Key | Purpose |
| --- | --- |
| `clt` | Command Line Tools path; use instead of `studio` |
| `java_home` | JDK to use |
| `state_dir` | State location; default `~/.deveco-mcp` |
| `retention_days` | Days to keep run output (screenshots, recordings, logs, test exports incl. `save_path` / `test_export` copies). Default 1 |
| `max_jobs` | Default 200 |
| `max_artifact_mb` | Default 512 |
| `session_idle_minutes` | Default 10 |
| `auto_accept_ui_agreements` | Automatically accept agreement and permission dialogs during UI actions, batches, replay and deploy/test assertions. Default `true`; uses text and control state within the same window, reports `agreements_accepted`. Observation alone does not accept |
| `kb_package` | npm package name of the knowledge pack |
| `npm_registry` | Registry used for knowledge pack updates |

Check the setup with `node bin/deveco-mcp.mjs doctor [project]`, or call the `doctor` tool.

### Tools

| Tool | What it does |
| --- | --- |
| `doctor` | Checks toolchain, SDK, devices, project, knowledge pack and logins, plus SDK compatibility (project compile/compatible SDK vs installed SDK vs device API); every failed check comes with a fix |
| `project` | `info` / `create` (template, never overwrites) / `sync` / `build` (ArkTS preflight of the .ets/.ts files changed since the last one, then Hvigor; returns packages, or every compile error (code, file, line, cause; first 100 listed) with hints; installs dependencies first when `oh-package.json5` changed; `modules` accept `module@target`; `task=compileNative` builds C/C++ and writes `.idea/.deveco/cxx/compile_commands.json` for clangd) / `clean` |
| `run` | Multi-device apps (e.g. phone + watch entries) build and install only the modules whose `deviceTypes` match the target device; existing project signing is used as-is. With several devices and no `target` it never picks one: it lists them (name, real device or emulator, matches the project) so the agent asks the user; `target` takes a serial or a device name. `build_run` (build, install, launch, smoke verdict `PASS` / `FAIL_CRASH` / `FAIL_BLANK`, optional UI assert; a startup crash comes with its diagnosis and the project source location; **from the second deploy on, code-only changes of the entry module are quick-fixed into the running app and relaunched (6-10 s measured, vs 15-25 s for a full deploy)**, anything else deploys fully with the reason, an unchanged project only relaunches, `run_mode=full` forces a full deploy; `then_flow` walks to a saved page after the deploy; `skip_build` deploys existing packages, `uninstall_first` reinstalls cleanly) / `deploy` / `launch` / `stop` / `uninstall` |
| `job` | `wait` / `status` / `list` / `cancel` / `resume` / `read` (line-paged logs with `grep`) |
| `code` | `check` (warm ArkTS static checker; `fix` applies safe auto-fixes) / `lint` (`config_path`, `incremental` for uncommitted files, `output_path`) / `api_scan` (files or `modules`, `output_path`) / `api_versions` / `lsp`: hover, definition, declaration, implementation, references, symbols, workspace_symbols, diagnostics, completion, signature, call_hierarchy (`direction` callers / callees). Locate code by `symbol` plus a line hint instead of exact columns / `lsp_restart` (`language` restarts only ArkTS or C++) |
| `device` | `list` / `info` / `log` (filter by bundle, level or regex; `from`/`to` relative time window such as 5 minutes ago to 1 minute ago; `follow` + cursor streams new lines across calls; `clear`; with `project`, source locations in error lines are resolved to project files) / read-only `shell` / `sqlite` (JSON rows from an on-device database or a debuggable app's RDB store; read-only unless `write`) / `send` / `recv` |
| `ui` | `observe` (screenshot plus compact element list) / `screenshot` (`display` for multi-screen, `save_path`) / `tree` (`window`, `depth` (0 = unlimited, 1 = root only, as in devecocli), `all_windows`, `node` for one component subtree) / `windows` / `find` / `act` (click, input with Chinese and any special characters and replace-by-default, type, swipe, scroll, key and key chords, mouse click/move/scroll/drag; every act returns `after`: elements that appeared/disappeared and whether the page changed, so observe is rarely needed; `steps` runs a whole path in one call, each step waiting for its element, with an optional final assert and `save_flow`; a path walked again after a relaunch is suggested for saving) / `assert` / `visual` (screenshot regression: baselines per name and device model, change ratio, regions and a red-boxed diff image) / `layout` (layout bugs on the current screen: off screen, overlapping tap targets, clipped or collapsed text, tiny targets; `forms` checks every fold state on foldable, widefold and triplefold emulators) / `perf` (scrolls the current screen and reports fps, frame time p50/p95/max, janky frames and memory from per-frame timestamps) / screen recording `record_start` / `record_stop` (`discard`, `external`, `save_path`) / `record_status`. **UI test sessions** driven by the host AI: `test_start` → `test_step` (actions and assertions with before/after screenshots, element summary and the app's log window) → `review` (host judges a screenshot; a failed control assertion is never overridden) → `test_finish` (JSON + Markdown report) → `test_log` / `test_export` |
| `ui_flow` | Record reusable flows through `ui act`, save them with a final assert, and replay with variables and self-repair; `snapshot` adds a screenshot regression check. Stored in `.arkpilot/flows`, compatible with v0.x |
| `diagnose` | `crash` (reads jscrash/cppcrash/appfreeze reports, also on production phones; `since_minutes` time window; extracts the signature and app frames, matches the fault-pattern library; with `project`, resolves existing ArkTS source locations and surrounding code. Native PCs are retained; C++ address symbolication is not implemented) / `build` |
| `knowledge` | Offline docs, ArkTS rules, error cases and runtime patterns: `search` / `read` (by `section`) / `catalog` / `status` / `update` / `rollback`; `source=cloud` queries CodeGenie online; each section is checked against the local official docs and labelled official / official for another platform / community / unverified |
| `skills` | Built-in HarmonyOS skills: `list` / `read`, `export` as native `SKILL.md` for your host (`path` for any directory), `install_mcp` registers this server in the host config (cursor, claude, codex, opencode, trae-cn, codebuddy, qoder, pi; idempotent merge; atomcode, dsh and deveco get skills only), `init` does both, `search` / `install` / `uninstall` from the OpenHarmony skill market |
| `auth` | Huawei browser login for `codegenie` (cloud knowledge) or `developer` (signing), `region` cn / global; `teams`; `import` v0.x credentials |
| `sign` | `auto` (refuses and changes nothing when the project already has signing unless `force`; prepares and verifies a new chain before atomically switching config, keeps old material and certificates, and needs a free certificate slot; otherwise one-step debug signing for real devices: keystore, certificate, device registration, profile with ACL permissions derived from `module.json5`, and `signingConfigs` in the project) / `sign` / `verify` / AppGallery Connect certificates and devices / itemized `keypair`, `csr`, `certificate_create`, `profile_create`, `profile_delete`. For accounts in several developer teams, actions that create or delete in AGC require `team` (otherwise the teams are listed so the agent asks the user) |
| `emulator` | `list` (`details`) / `start` / `stop` (`name` or several `names`; start waits for boot) / `create` (`screen_profile` or custom `screen`, `hot_boot`, `instance_path`, `image_root`, `force`) / `delete` / `images` (rows of device type and OS version; downloaded, `all` for every image) / `install_image` (`force` re-downloads; returns path, size, duration) / `remove_image` / `license` (accept) / `license_view` (read-only) / `scenario` (battery level and charging status, GPS, light/humidity/temperature/steps/heart-rate sensors, rotation, fold, motion scenes, …). Start, create and image download accept the license agreements automatically when needed and say so in the result (`auto_accept_license=false` to opt out) |
| `hot_reload` | `apply` pushes ArkTS changes to the running app as an HQF quick fix in about 5 s (measured 4.4-4.7 s) with no restart (`files` limits it to given files, `restart` relaunches after patching); `reset` removes them; `stop_daemon` stops the project's hvigor daemon |

Three built-in skills:

| Skill | Purpose |
| --- | --- |
| `hmos-arkui-develop-skill` | Read before writing ArkTS/ArkUI: 26 high-frequency fatal mistakes, component API cards (`quick-apis`) and constraint rules (`quick-rules`). From upstream DevEco Code, MIT |
| `hmos-runtime-fix-skill` | Crash / white-screen diagnosis flow and a 9-category crash pattern library, adapted to this server's `diagnose` and `device log`. From upstream DevEco Code, MIT |
| `deveco-mcp-workflow` | Which deveco tool to use for each task, and in what order |

Project-scope export (`scope=project` or `init --project`) writes `<project>/.agents/skills`, which Codex, Claude Code, Cursor, Qoder, OpenCode and DevEco Code all read, so one copy serves every tool.

The server also exposes MCP **Resources** (`deveco://skills/<name>`) and **Prompts**: `fix-build`, `debug-crash`, and `upgrade-sdk`. Feature planning is left to the host's own plan mode.

### Knowledge packs

A knowledge pack is a `.tgz` containing three files:

- `manifest.json`
- `index.db` — an FTS5 index with a vocabulary table for Chinese query segmentation
- `docs.zip`

It combines Huawei's HarmonyOS docs (guides, API reference, best practices, FAQ, release notes; about 14.7k documents) with this repository's `knowledge/` directory (ArkTS rules, 31 compile-error cases, and the skills above, including the crash pattern library and ArkUI quick reference).

- **Built-in:** the npm package `@deveco-mcp/kb` is an optional dependency, and `kb-dist/current` works for local development.
- **Update:** `knowledge action=update` runs as a job. It downloads from npm, verifies the sha512 integrity, extracts to a temporary directory, checks the schema, switches versions atomically, and keeps the previous version for `rollback`. `file=<path.tgz>` installs a local pack. `file=upstream` builds a fresh pack from Huawei's latest `@deveco-test/deveco-cli-knowledgebase`.
- **Build and publish:** `node bin/deveco-mcp.mjs kb-build <upstream-package-dir> kb-dist --version x.y.z` writes an npm-publishable tarball. `doctor remote=true` shows whether a newer pack exists; packs are never downloaded automatically.

### Architecture

```text
src/
  cli.ts        entry: mcp | doctor | init --host <h> | serve-lsp [--cpp] | kb-build | kb-update
  mcp.ts        minimal MCP stdio JSON-RPC (tools, resources, prompts, cancellation)
  server.ts     tool registry wiring; JSON Schemas built lazily on first tools/list
  jobs.ts       job definitions (build, build_run, deploy, flow replay, kb update, auto sign)
  tools/        15 tools (zod schemas; domain code is imported lazily on first call)
  domains/      project, device, ui, uitest, flows, code, diagnose, knowledge, kb-build, skills, hostconfig, auth, sign, emulator, hotreload, doctor, resources
  core/         config, toolchain, proc (process-tree kill), db (node:sqlite WAL), jobs, artifacts, sessions, lsp-client, errors, files
knowledge/      rules, error cases, skills (crash patterns live in hmos-runtime-fix-skill/references; sources for knowledge packs and resources)
templates/      project template
resources/      vendored arkts-check.cjs, hypium uitest agents, licenses
tools/          build.mjs, bench.mjs (with performance budgets), upstream-sync.mjs + upstream/ (exhaustive extraction and decisions), mcp-client.mjs
test/unit       offline tests (npm test); test/e2e: real SDK and device (npm run test:e2e)
```

Jobs replace LangGraph with a small durable step runner:

- Each step's output is persisted before the next step starts.
- Steps with side effects (install, signing) record an intent before running and a receipt after.
- If a crash happens between the two, the job goes to `needs_input` and is never replayed blindly.
- `job resume force=true` normally re-runs such a step after inspection. Auto-sign cloud creation and configuration commit require receipt reconciliation; force cannot bypass this protection.
- Jobs owned by a process that died are marked `interrupted` on startup.

Retention is capped by age, job count and bytes, and cleanup runs after each job rather than on a timer.

### Development

```sh
npm run typecheck            # tsc on src/ only, incremental
npm run build                # esbuild bundle (~60 ms)
npm test                     # unit tests, no SDK needed
DEVECO_CONFIG=... E2E_TARGET=127.0.0.1:5555 npm run test:e2e   # real SDK + device/emulator
npm run bench                # handshake, idle CPU/RSS, tools/list size
node tools/upstream-sync.mjs # exhaustive upstream alignment (exit 1 on undecided/partial/stale items or new upstream commits; --report writes the list)
```

#### Migrating from v0.x

v0.x is frozen at tag `v0.4-final`, and v1 does not read its state directory.

- **Flows:** `.arkpilot/flows` files keep working unchanged.
- **Logins:** run `auth action=import` (defaults to `~/.deveco-tool`).
- **Tool names:** these changed; the tool table above is the reference.
- The keep/drop decisions for v0.4-only features are in [docs/v0-feature-review.md](docs/v0-feature-review.md).

### License

MIT. Third-party notices: `NOTICE.deveco-cli`, `NOTICE.deveco-code`, `NOTICE.hypium`, `resources/licenses/`.
