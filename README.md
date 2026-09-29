# deveco-mcp

**中文** | [English](#english)

一个轻量的鸿蒙（HarmonyOS）开发 MCP 服务。任何 MCP 宿主（Cursor、Claude Code、Codex 等）都可以通过它调用 DevEco 工具链，完成鸿蒙应用的构建、运行、调试和验证，并离线查询鸿蒙开发知识。

- **完整覆盖上游。** 对照 [deveco-code](https://gitcode.com/openharmony-sig/deveco-code) 和 [deveco-cli](https://gitcode.com/openharmony-sig/deveco-cli) 做了能力级验收：上游共 81 项能力，60 项完整覆盖，3 项由命令行子命令提供，18 项由宿主 AI 自身提供，缺口为 0，见 `tools/upstream-sync.mjs`。在此之外，还提供可恢复的异步任务、UI 流程录制与回放、崩溃模式匹配、按符号名定位的 LSP 查询，以及可以独立于服务更新的知识包。
- **轻量。** 运行时依赖只有 3 个，不用 LangGraph，也没有原生模块（数据库用 Node 自带的 `node:sqlite`）。单进程运行，空闲时不占 CPU。语言服务和代码检查器按需启动，空闲 10 分钟后自动关闭。
- **为 AI 宿主设计。** 12 个核心工具按用途命名；返回结构化且长度有上限；每个错误都带 `code`、`category` 和修复提示 `hint`；耗时操作以任务形式异步执行。

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

用一条命令完成 MCP 配置并导出 Skill。支持 cursor、claude、codex、opencode、trae-cn、codebuddy、qoder、pi；已有同名配置不会被覆盖，除非加 `--force`：

```sh
node dist/cli.js init --host cursor                 # 用户级配置（~/.cursor/mcp.json + ~/.cursor/skills）
node dist/cli.js init --host codex --project .      # 项目级配置（.codex/config.toml）
```

编辑器也可以直接使用 SDK 的语言服务：`node dist/cli.js serve-lsp [--cpp] [--project <root>]`（stdio）。

也可以手动配置：

```json
{
  "mcpServers": {
    "deveco": {
      "command": "node",
      "args": ["/absolute/path/to/deveco_tool/dist/cli.js", "mcp"],
      "env": {
        "DEVECO_CONFIG": "/absolute/path/to/deveco-mcp.json",
        "DEVECO_TOOL_GROUPS": "core"
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
| `retention_days` | 保留天数，默认 7 |
| `max_jobs` | 最多保留的任务数，默认 200 |
| `max_artifact_mb` | 制品总大小上限，默认 512 |
| `session_idle_minutes` | 语言服务等会话的空闲关闭时间，默认 10 |
| `kb_package` | 知识包的 npm 包名 |
| `npm_registry` | 更新知识包时使用的 npm 源 |

`DEVECO_TOOL_GROUPS` 可选 `core`（默认）、`sign`、`emulator`、`hot_reload` 或 `all`。

用 `node dist/cli.js doctor [project]` 或 `doctor` 工具检查环境。

## 工具

| 工具 | 功能 |
| --- | --- |
| `doctor` | 检查工具链、SDK、设备、工程、知识包和登录状态，以及 SDK 兼容性（工程的编译/兼容 SDK、已安装 SDK、设备 API 级别）；每项失败都附带修复方法 |
| `project` | `info` / `create`（基于模板，不会覆盖已有文件）/ `sync` / `build`（先做 ArkTS 预检，再调用 Hvigor；返回产物，以及带修复提示的结构化错误；`task=compileNative` 编译 C/C++，并生成供 clangd 使用的 `.idea/.deveco/cxx/compile_commands.json`）/ `clean` |
| `run` | `build_run`（构建、安装、启动，给出冒烟判定 `PASS` / `FAIL_CRASH` / `FAIL_BLANK`，可附带 UI 断言）/ `deploy` / `launch` / `stop` / `uninstall` |
| `job` | `wait` / `status` / `list` / `cancel` / `resume` / `read`（按行分页读取日志，支持 `grep`） |
| `code` | `check`（常驻的 ArkTS 静态检查，`fix` 自动修复安全的问题）/ `lint` / `api_scan` / `api_versions` / `lsp`：hover、definition、implementation、references、symbols、workspace_symbols、diagnostics、completion、signature。用 `symbol` 加行号提示定位代码，不需要精确列号 |
| `device` | `list` / `info` / `log`（按应用、级别或正则过滤；`clear` 清空）/ 只读 `shell` / `sqlite`（查询设备数据库或调试包的 RDB 数据库，返回 JSON；默认只读，传 `write` 才可写）/ `send` / `recv` |
| `ui` | `observe`（截图加精简控件列表）/ `screenshot` / `tree`（支持 `window`、`depth`）/ `windows` / `find` / `act`（点击；输入，支持中文，默认替换原内容；键入；滑动；滚动；按键和组合键；鼠标点击、移动、滚轮、拖拽；`verify_change` 返回界面是否有变化）/ `assert` / 录屏 `record_start` / `record_stop`（`discard`、`external`）/ `record_status`。**UI 测试会话**由宿主 AI 驱动：`test_start` → `test_step`（执行操作或断言，记录操作前后截图、控件摘要和应用日志片段）→ `review`（宿主看截图做判断；控件断言失败时不能改判为通过）→ `test_finish`（生成 JSON 和 Markdown 报告）→ `test_log` / `test_export` |
| `ui_flow` | 用 `ui act` 录制可复用的操作流程，以一个最终断言收尾保存，回放时支持变量替换和自动修复。保存在 `.arkpilot/flows`，兼容 v0.x |
| `diagnose` | `crash`（读取 jscrash、cppcrash、appfreeze 日志，量产手机也支持；`since_minutes` 限定时间窗口；提取错误特征和应用调用栈，并匹配故障模式库）/ `build` |
| `knowledge` | 离线文档、ArkTS 规则、错误案例和运行时问题模式：`search` / `read`（按 `section` 读取）/ `catalog` / `status` / `update` / `rollback`；`source=cloud` 在线查询 CodeGenie |
| `skills` | 内置的鸿蒙 Skill：`list` / `read`；`export` 导出为宿主原生的 `SKILL.md`；`install_mcp` 把本服务写入宿主配置（cursor、claude、codex、opencode、trae-cn、codebuddy、qoder、pi；重复执行不会重复写入）；`init` 一次完成两者；`search` / `install` / `uninstall` 使用 OpenHarmony Skill 市场 |
| `auth` | 华为账号浏览器登录：`codegenie`（云端知识）或 `developer`（签名），`region` 可选 cn / global；`teams`；`import` 导入 v0.x 的登录凭据 |
| `sign` *（可选组）* | `auto`（一键为真机生成调试签名：密钥库、证书、设备注册、Profile，ACL 权限从 `module.json5` 自动推导，并写入工程的 `signingConfigs`）/ `sign` / `verify` / AppGallery Connect 证书和设备管理 / 逐项操作 `keypair`、`csr`、`certificate_create`、`profile_create`、`profile_delete` |
| `emulator` *（可选组）* | `list` / `start`（等待启动完成）/ `stop` / `create` / `delete` / 镜像 / 许可协议 / `scenario`（电量、GPS、传感器、旋转、折叠等） |
| `hot_reload` *（可选组）* | `apply` 把 ArkTS 改动以 HQF 快速修复包推送到运行中的应用，约 3 秒生效，应用不重启；`reset` 撤销改动 |

服务还提供 MCP **Resources**（`deveco://skills/<name>`）和 **Prompts**：`fix-build`、`debug-crash`、`implement-feature`（规格驱动：specify → plan → tasks → implement → verify）和 `upgrade-sdk`。

## 知识包

知识包是一个 `.tgz`，包含三个文件：

- `manifest.json`
- `index.db`：FTS5 全文索引，附带中文查询分词用的词表
- `docs.zip`

内容包括华为鸿蒙官方文档（开发指南、API 参考、最佳实践、FAQ、版本说明，约 1.47 万篇），以及本仓库 `knowledge/` 目录下的 ArkTS 规则、31 个编译错误案例、运行时崩溃模式和 Skill。

- **内置：** npm 包 `@deveco-mcp/kb` 是可选依赖；本地开发时也可以用 `kb-dist/current`。
- **更新：** `knowledge action=update` 以任务形式运行：从 npm 下载，校验 sha512，解压到临时目录，检查结构，原子切换版本，并保留上一版本以便 `rollback`。`file=<path.tgz>` 安装本地知识包；`file=upstream` 从华为最新的 `@deveco-test/deveco-cli-knowledgebase` 生成新知识包。
- **构建与发布：** `node dist/cli.js kb-build <上游包目录> kb-dist --version x.y.z` 生成可以发布到 npm 的包。`doctor remote=true` 会提示是否有新版本，但不会自动下载。

## 架构

```text
src/
  cli.ts        入口：mcp | doctor | init --host <h> | serve-lsp [--cpp] | kb-build | kb-update
  mcp.ts        最小化的 MCP stdio JSON-RPC（tools、resources、prompts、取消）
  server.ts     工具注册；JSON Schema 在第一次 tools/list 时才生成
  jobs.ts       任务定义（build、build_run、deploy、流程回放、知识包更新、自动签名）
  tools/        12 个核心工具加 3 个可选组（zod schema；领域模块按需加载）
  domains/      project、device、ui、uitest、flows、code、diagnose、knowledge、kb-build、skills、hostconfig、auth、sign、emulator、hotreload、doctor、resources
  core/         config、toolchain、proc（按进程树结束）、db（node:sqlite WAL）、jobs、artifacts、sessions、lsp-client、errors、files
knowledge/      规则、错误案例、运行时模式、Skill（知识包和 resources 的来源）
templates/      工程模板
resources/      内置的 arkts-check.cjs、hypium uitest agent、许可证
tools/          build.mjs、bench.mjs、upstream-sync.mjs、mcp-client.mjs
test/unit       离线测试（npm test）；test/e2e：真实 SDK 和设备（npm run test:e2e）
```

任务机制用一个小型的持久化步骤执行器代替了 LangGraph：

- 每一步的输出在下一步开始前保存。
- 有副作用的步骤（安装、签名）执行前先记录意图，完成后记录回执。
- 如果在两者之间崩溃，任务会进入 `needs_input`，不会盲目重做。
- 检查过现场后，可以用 `job resume force=true` 重新执行该步骤。
- 启动时，所属进程已经退出的任务会被标记为 `interrupted`。

保留策略按时间、任务数和总大小三个上限控制。清理在每个任务结束后执行，不使用定时器。

## 开发

```sh
npm run typecheck            # 只对 src/ 做增量 tsc 检查
npm run build                # esbuild 打包（约 60 ms）
npm test                     # 单元测试，不需要 SDK
DEVECO_CONFIG=... E2E_TARGET=127.0.0.1:5555 npm run test:e2e   # 真实 SDK 加设备或模拟器
npm run bench                # 握手、空闲 CPU/内存、tools/list 大小
node tools/upstream-sync.mjs # 能力级上游对齐检查（有 partial 或未映射项时退出码为 1）
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

- **Covers upstream fully.** Every HarmonyOS tool in [deveco-code](https://gitcode.com/openharmony-sig/deveco-code) and every command in [deveco-cli](https://gitcode.com/openharmony-sig/deveco-cli) is verified at capability level in `tools/upstream-sync.mjs` (81 upstream capabilities: 60 full, 3 CLI, 18 host-provided, 0 gaps). It also adds asynchronous jobs with recovery, flow recording and replay, crash pattern matching, symbol-based LSP lookups, and knowledge packs that update independently of the server.
- **Light.** 3 runtime dependencies. No LangGraph, no native modules (uses the built-in `node:sqlite`). A single process with zero idle CPU. Language servers and the checker start on demand and shut down after 10 idle minutes.
- **Built for AI hosts.** 12 core tools named by intent. Responses are structured and bounded. Every error carries a `code`, a `category` and a fix `hint`. Long operations become jobs.

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

Register the server and export the skills in one step (cursor, claude, codex, opencode, trae-cn, codebuddy, qoder, pi; existing entries are kept unless you pass `--force`):

```sh
node dist/cli.js init --host cursor                 # user config (~/.cursor/mcp.json + ~/.cursor/skills)
node dist/cli.js init --host codex --project .      # project config (.codex/config.toml)
```

Editors can also use the SDK language servers directly: `node dist/cli.js serve-lsp [--cpp] [--project <root>]` (stdio).

Or add it by hand:

```json
{
  "mcpServers": {
    "deveco": {
      "command": "node",
      "args": ["/absolute/path/to/deveco_tool/dist/cli.js", "mcp"],
      "env": {
        "DEVECO_CONFIG": "/absolute/path/to/deveco-mcp.json",
        "DEVECO_TOOL_GROUPS": "core"
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
| `retention_days` | Default 7 |
| `max_jobs` | Default 200 |
| `max_artifact_mb` | Default 512 |
| `session_idle_minutes` | Default 10 |
| `kb_package` | npm package name of the knowledge pack |
| `npm_registry` | Registry used for knowledge pack updates |

`DEVECO_TOOL_GROUPS` accepts `core` (default), `sign`, `emulator`, `hot_reload`, or `all`.

Check the setup with `node dist/cli.js doctor [project]`, or call the `doctor` tool.

### Tools

| Tool | What it does |
| --- | --- |
| `doctor` | Checks toolchain, SDK, devices, project, knowledge pack and logins, plus SDK compatibility (project compile/compatible SDK vs installed SDK vs device API); every failed check comes with a fix |
| `project` | `info` / `create` (template, never overwrites) / `sync` / `build` (ArkTS preflight, then Hvigor; returns packages and structured errors with hints; `task=compileNative` builds C/C++ and writes `.idea/.deveco/cxx/compile_commands.json` for clangd) / `clean` |
| `run` | `build_run` (build, install, launch, smoke verdict `PASS` / `FAIL_CRASH` / `FAIL_BLANK`, optional UI assert) / `deploy` / `launch` / `stop` / `uninstall` |
| `job` | `wait` / `status` / `list` / `cancel` / `resume` / `read` (line-paged logs with `grep`) |
| `code` | `check` (warm ArkTS static checker; `fix` applies safe auto-fixes) / `lint` / `api_scan` / `api_versions` / `lsp`: hover, definition, implementation, references, symbols, workspace_symbols, diagnostics, completion, signature. Locate code by `symbol` plus a line hint instead of exact columns |
| `device` | `list` / `info` / `log` (filter by bundle, level or regex; `clear`) / read-only `shell` / `sqlite` (JSON rows from an on-device database or a debuggable app's RDB store; read-only unless `write`) / `send` / `recv` |
| `ui` | `observe` (screenshot plus compact element list) / `screenshot` / `tree` (`window`, `depth`) / `windows` / `find` / `act` (click, input with Chinese text support and replace-by-default, type, swipe, scroll, key and key chords, mouse click/move/scroll/drag; `verify_change` reports whether the screen changed) / `assert` / screen recording `record_start` / `record_stop` (`discard`, `external`) / `record_status`. **UI test sessions** driven by the host AI: `test_start` → `test_step` (actions and assertions with before/after screenshots, element summary and the app's log window) → `review` (host judges a screenshot; a failed control assertion is never overridden) → `test_finish` (JSON + Markdown report) → `test_log` / `test_export` |
| `ui_flow` | Record reusable flows through `ui act`, save them with a final assert, and replay with variables and self-repair. Stored in `.arkpilot/flows`, compatible with v0.x |
| `diagnose` | `crash` (reads jscrash/cppcrash/appfreeze reports, also on production phones; `since_minutes` time window; extracts the signature and app frames, matches the fault-pattern library) / `build` |
| `knowledge` | Offline docs, ArkTS rules, error cases and runtime patterns: `search` / `read` (by `section`) / `catalog` / `status` / `update` / `rollback`; `source=cloud` queries CodeGenie online |
| `skills` | Built-in HarmonyOS skills: `list` / `read`, `export` as native `SKILL.md` for your host, `install_mcp` registers this server in the host config (cursor, claude, codex, opencode, trae-cn, codebuddy, qoder, pi; idempotent merge), `init` does both, `search` / `install` / `uninstall` from the OpenHarmony skill market |
| `auth` | Huawei browser login for `codegenie` (cloud knowledge) or `developer` (signing), `region` cn / global; `teams`; `import` v0.x credentials |
| `sign` *(group)* | `auto` (one-step debug signing for real devices: keystore, certificate, device registration, profile with ACL permissions derived from `module.json5`, and `signingConfigs` in the project) / `sign` / `verify` / AppGallery Connect certificates and devices / itemized `keypair`, `csr`, `certificate_create`, `profile_create`, `profile_delete` |
| `emulator` *(group)* | `list` / `start` (waits for boot) / `stop` / `create` / `delete` / images / license / `scenario` (battery, GPS, sensors, rotation, fold, …) |
| `hot_reload` *(group)* | `apply` pushes ArkTS changes to the running app as an HQF quick fix in about 3 s with no restart; `reset` removes them |

The server also exposes MCP **Resources** (`deveco://skills/<name>`) and **Prompts**: `fix-build`, `debug-crash`, `implement-feature` (spec-driven: specify → plan → tasks → implement → verify), and `upgrade-sdk`.

### Knowledge packs

A knowledge pack is a `.tgz` containing three files:

- `manifest.json`
- `index.db` — an FTS5 index with a vocabulary table for Chinese query segmentation
- `docs.zip`

It combines Huawei's HarmonyOS docs (guides, API reference, best practices, FAQ, release notes; about 14.7k documents) with this repository's `knowledge/` directory (ArkTS rules, 31 compile-error cases, runtime crash patterns, skills).

- **Built-in:** the npm package `@deveco-mcp/kb` is an optional dependency, and `kb-dist/current` works for local development.
- **Update:** `knowledge action=update` runs as a job. It downloads from npm, verifies the sha512 integrity, extracts to a temporary directory, checks the schema, switches versions atomically, and keeps the previous version for `rollback`. `file=<path.tgz>` installs a local pack. `file=upstream` builds a fresh pack from Huawei's latest `@deveco-test/deveco-cli-knowledgebase`.
- **Build and publish:** `node dist/cli.js kb-build <upstream-package-dir> kb-dist --version x.y.z` writes an npm-publishable tarball. `doctor remote=true` shows whether a newer pack exists; packs are never downloaded automatically.

### Architecture

```text
src/
  cli.ts        entry: mcp | doctor | init --host <h> | serve-lsp [--cpp] | kb-build | kb-update
  mcp.ts        minimal MCP stdio JSON-RPC (tools, resources, prompts, cancellation)
  server.ts     tool registry wiring; JSON Schemas built lazily on first tools/list
  jobs.ts       job definitions (build, build_run, deploy, flow replay, kb update, auto sign)
  tools/        12 core + 3 optional tools (zod schemas; domains are imported lazily)
  domains/      project, device, ui, uitest, flows, code, diagnose, knowledge, kb-build, skills, hostconfig, auth, sign, emulator, hotreload, doctor, resources
  core/         config, toolchain, proc (process-tree kill), db (node:sqlite WAL), jobs, artifacts, sessions, lsp-client, errors, files
knowledge/      rules, error cases, runtime patterns, skills (sources for knowledge packs and resources)
templates/      project template
resources/      vendored arkts-check.cjs, hypium uitest agents, licenses
tools/          build.mjs, bench.mjs, upstream-sync.mjs, mcp-client.mjs
test/unit       offline tests (npm test); test/e2e: real SDK and device (npm run test:e2e)
```

Jobs replace LangGraph with a small durable step runner:

- Each step's output is persisted before the next step starts.
- Steps with side effects (install, signing) record an intent before running and a receipt after.
- If a crash happens between the two, the job goes to `needs_input` and is never replayed blindly.
- `job resume force=true` re-runs such a step after you have inspected it.
- Jobs owned by a process that died are marked `interrupted` on startup.

Retention is capped by age, job count and bytes, and cleanup runs after each job rather than on a timer.

### Development

```sh
npm run typecheck            # tsc on src/ only, incremental
npm run build                # esbuild bundle (~60 ms)
npm test                     # unit tests, no SDK needed
DEVECO_CONFIG=... E2E_TARGET=127.0.0.1:5555 npm run test:e2e   # real SDK + device/emulator
npm run bench                # handshake, idle CPU/RSS, tools/list size
node tools/upstream-sync.mjs # capability-level upstream alignment (exit 1 on partial/unmapped)
```

#### Migrating from v0.x

v0.x is frozen at tag `v0.4-final`, and v1 does not read its state directory.

- **Flows:** `.arkpilot/flows` files keep working unchanged.
- **Logins:** run `auth action=import` (defaults to `~/.deveco-tool`).
- **Tool names:** these changed; the tool table above is the reference.
- The keep/drop decisions for v0.4-only features are in [docs/v0-feature-review.md](docs/v0-feature-review.md).

### License

MIT. Third-party notices: `NOTICE.deveco-cli`, `NOTICE.deveco-code`, `NOTICE.hypium`, `resources/licenses/`.
