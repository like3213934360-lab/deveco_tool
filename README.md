# deveco-tool

`deveco-tool` 是面向 HarmonyOS / OpenHarmony 开发的统一 stdio MCP 服务。它把 DevEco CLI、ArkTS 语言服务、CodeGenie、HDC 真机控制和仓库内的诊断脚本统一成 **44 个 MCP 工具**，AI 客户端只需连接一个进程。

这个仓库还包含可选的 Skill、SDD 命令和模板；它们不是运行 MCP 的必要条件。机器可读清单见 [`manifest.json`](./manifest.json)，能力包接入和来源细节见 [`PACK.md`](./PACK.md)。

## 必须依赖

### 仅启动 MCP

| 依赖 | 要求 | 用途 |
|---|---:|---|
| Node.js | `>= 22` | 运行 MCP 服务、Node 脚本和随包安装的 CLI/LSP 子进程 |
| npm | 与 Node.js 配套 | 按 `package-lock.json` 安装固定版本依赖 |

安装依赖：

```bash
cd /absolute/path/to/deveco_tool
npm install
```

`npm install` 会安装下面的运行时组件，不需要再全局安装 `devecocli`、ArkTS LSP 或 CodeGenie MCP：

| npm 依赖 | 作用 |
|---|---|
| `@modelcontextprotocol/sdk`、`zod`、`ajv` | MCP 通信和工具参数校验 |
| `@deveco/deveco-cli` | 构建、部署、Linter、文档、设备、UI、模拟器和签名等官方 CLI 能力 |
| `@arkts/language-server` | ArkTS/TypeScript 定义、引用、悬停、符号和调用层级 |
| `@deveco-codegenie/mcp` | C/C++ 检查及 CodeGenie UI 代理能力 |
| `vscode-jsonrpc`、`vscode-languageserver-protocol`、`vscode-uri` | ArkTS LSP 协议与 URI 支持 |

到这里已经可以启动 MCP、列出 44 个工具，以及使用不依赖鸿蒙工具链的工具。

### 使用鸿蒙工程能力

下列依赖按实际调用的工具安装，不是 MCP 进程启动的前置条件。

| 能力 | 必需依赖 |
|---|---|
| 构建、同步、官方 Linter、API 兼容、热重载、官方文档 | DevEco Studio，或 DevEco Command Line Tools（CLT），并安装对应 HarmonyOS/OpenHarmony SDK |
| ArkTS 检查和语言服务 | HarmonyOS/OpenHarmony SDK；建议配置完整 DevEco Studio/CLT 工具链 |
| 真机安装、日志、截图、UI 树、手势和 `ui_flow` 回放 | 工具链中的 `hdc`；真机已连接、已授权调试且能被 `hdc list targets` 识别 |
| 模拟器管理和场景模拟 | DevEco 模拟器组件、系统镜像及已接受的许可证 |
| `arkts_knowledge_search` | 可访问华为 DevEco CodeGenie 服务的网络，以及通过 `deveco_login` 建立的会话 |
| 自动签名和团队列表 | 华为开发者账号，以及通过 `deveco_cli_auth` 建立的官方 CLI 会话 |
| Python 类注册脚本 | Python 3；只有 `ui_score` 额外强制要求 Pillow |

工程类工具还需要一个有效的 HarmonyOS 工程根目录。可以先调用 `switch_cwd`，也可以在单次工具调用中传 `project_path`。

## 工具链配置

服务会自动识别 macOS 默认安装位置 `/Applications/DevEco-Studio.app`。其他位置、Windows 或纯 CLT/Linux 环境应显式配置：

| 环境变量 | 用途 |
|---|---|
| `DEVECO_CLI_STUDIO_PATH` | DevEco Studio 安装根目录；macOS 可指向 `.app` |
| `DEVECO_CLI_CLT_PATH` | DevEco Command Line Tools 根目录；纯 CLT/Linux 优先使用它 |
| `DEVECO_HOME` / `DEVECO_PATH` | Studio 路径的兼容配置，优先级低于上面两项 |
| `PROJECT_PATH` | MCP 启动后的默认 HarmonyOS 工程根目录 |
| `HDC_PATH` | 自定义 `hdc` 可执行文件；通常无需设置 |
| `PYTHON` | Python 注册脚本使用的解释器；未设置时依次尝试 `python3`、`python` |

高级覆盖项包括 `DEVECO_CLI_ENTRY`、`ARKTS_LSP_ENTRY`、`DEVECO_CODEGENIE_ENTRY`、`OHOS_SDK_PATH` 和 `TSDK_PATH`。它们主要用于非标准安装或调试；常规安装不要设置。

安装后先运行环境诊断：

```bash
npm run doctor
```

诊断会检查 Node.js、DevEco/CLT、SDK、HDC、Python/Pillow、当前工程、Skill 和 CodeGenie 子进程状态。

## 启动和接入

直接启动：

```bash
npm run mcp
```

MCP 客户端配置示例：

```json
{
  "mcpServers": {
    "deveco": {
      "command": "node",
      "args": ["/absolute/path/to/deveco_tool/src/server.mjs"],
      "env": {
        "DEVECO_CLI_STUDIO_PATH": "/Applications/DevEco-Studio.app",
        "PROJECT_PATH": "/absolute/path/to/HarmonyProject"
      }
    }
  }
}
```

也可以让安装器输出配置片段：

```bash
node scripts/install.mjs --print-mcp
```

## 44 个 MCP 工具

表格中的“依赖”是在 Node.js 和 `npm install` 之外的条件。

### 项目、脚本和服务管理（7）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `deveco_script_catalog` | 列出允许通过 MCP 执行的 19 个仓库脚本、运行时和说明 | 无 |
| `deveco_script` | 通过 `args` 或原始 `argv` 执行一个白名单脚本 | 取决于所选脚本 |
| `switch_cwd` | 设置后续调用使用的活动 HarmonyOS 工程根目录 | 有效工程目录 |
| `init_project_path` | `switch_cwd` 的兼容别名 | 有效工程目录 |
| `deveco_doctor` | 检查工具链、SDK、HDC、Python、工程、Skill 和 CodeGenie 状态 | 无；缺失项会作为诊断结果返回 |
| `deveco_restart` | 就地重置 ArkTS LSP、CodeGenie 子进程或两者，不断开 MCP | 对应子进程在下次调用时按需启动 |
| `document_validate` | 检查 `spec.md`、`plan.md`、`tasks.md` 的必需章节和标题结构 | 无 |

### 登录、知识和文档（6）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `deveco_login` | 启动或查询 CodeGenie 中国站浏览器登录任务；采用异步状态查询避免客户端 30 秒超时 | 浏览器、网络、华为账号 |
| `deveco_logout` | 清除本地 CodeGenie 登录会话 | 无 |
| `deveco_status` | 查询 CodeGenie 登录状态，不返回访问令牌 | 无 |
| `arkts_knowledge_search` | 搜索官方 ArkTS、ArkUI、HarmonyOS 和 OpenHarmony 知识库 | 网络、`deveco_login` 会话 |
| `deveco_cli_auth` | 官方 CLI 登录、登出、状态查询和签名团队列表 | DevEco Studio/CLT；登录及团队操作需要网络和华为账号 |
| `harmony_docs` | 列出官方本地文档目录、关键词搜索、按文档 ID 阅读 | DevEco Studio/CLT |

`deveco_login` 与 `deveco_cli_auth` 是两套独立会话：前者服务于 CodeGenie 知识检索，后者服务于官方 CLI、团队和签名能力。

### 代码检查和语言服务（12）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `arkts_check` | 对整个工程或指定 `.ets` 文件运行 ArkTS 静态检查 | 工程、SDK |
| `check_ets_files` | 对明确给出的 `.ets` / `.ts` 文件运行本地 ArkTS 检查 | 活动工程、SDK |
| `code_lint` | 官方工程级 Code Linter；支持增量检查、JSON、报告文件和自动修复 | 工程、DevEco Studio/CLT |
| `api_compat_check` | 扫描文件/模块的 API 版本兼容性，或列出支持的 API 版本 | 工程、DevEco Studio/CLT |
| `lsp` | 通用 ArkTS LSP 入口，支持定义、声明、引用、悬停、符号、实现和调用层级 | 工程、SDK |
| `find_references` | 查询符号引用 | 工程、SDK |
| `go_to_definition` | 跳转到符号定义 | 工程、SDK |
| `go_to_declaration` | 跳转到声明；服务端不支持时安全回退到定义 | 工程、SDK |
| `get_hover` | 获取位置上的类型和文档 | 工程、SDK |
| `list_symbols` | 列出文件内函数、类、变量等符号 | 工程、SDK |
| `find_call_hierarchy` | 查询符号的调用方或被调用方 | 工程、SDK |
| `check_cpp_files` | 通过 CodeGenie 子进程检查 C/C++ 文件 | 工程、DevEco Studio、CodeGenie 子进程 |

`arkts_check` 是静态预检，不能代替真实编译；是否可以产出 HAP/HAR 应以 `build_project` 为准。

### 构建、部署和签名（6）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `project_sync` | 执行 `ohpm install --all` 并同步 Hvigor 工程模型 | 工程、DevEco Studio/CLT、SDK；安装依赖时需要网络 |
| `build_project` | 构建整个产品或指定模块；支持启动、查询、取消和同步运行 | 工程、DevEco Studio/CLT、SDK |
| `start_app` | 安装已构建的单个 Entry HAP 并启动 Ability；不会隐式构建 | 工程、已构建产物、HDC 设备 |
| `apply_changes` | 冷增量构建并安装修改文件，精确部署一个 Entry 模块 | 工程、DevEco Studio/CLT、HDC 设备 |
| `hot_reload` | 管理常驻热重载：启动、应用 `.ets` 改动、查询和停止 | 工程、DevEco Studio/CLT、支持热重载的 HDC 设备 |
| `app_signature` | 通过官方 CLI 生成或更新工程签名配置 | 工程、DevEco Studio/CLT、官方 CLI 登录和团队/设备信息 |

`build_project` 默认 `action: "start"`，会立即返回 `job_id`。之后用 `action: "status"` 查询，或用 `action: "cancel"` 终止。只有确认 MCP 客户端允许长请求时才使用 `action: "run"`；工具参数中的 `timeoutMs` 无法提高客户端自身固定的 30 秒外层超时。

### 设备和日志（2）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `device_info` | 返回设备名称、序列号、设备类型和系统版本等官方信息 | DevEco Studio/CLT、HDC 设备或已启动模拟器 |
| `hdc_log` | 列出设备、采集/过滤/清理 Hilog | HDC、已连接设备 |

只有一个设备在线时，多数工具可自动选择；多个设备在线时应显式传 `hvd` 或 `target`，避免操作错误设备。

### UI 检查和控制（9）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `ui_snapshot` | 通过 HDC 截图，可内联返回、缩放、选择显示屏和检测画面是否变化 | HDC 设备 |
| `ui_find` | 解析 UI 布局树，按文本、key、类型和可点击状态返回可操作坐标 | HDC 设备 |
| `ui_observe` | 并行获取截图和布局树，一次返回画面、节点和坐标 | HDC 设备 |
| `ui_tap` | 点击、双击、长按、滑动、fling、drag、方向 fling、文本和按键；支持节点百分比及屏幕百分比定位 | HDC 设备 |
| `ui_flow` | 自动录制 `ui_tap` 成项目内 ArkPilot 流程，并直接启动、等待、断言和一键回放 | HDC 设备、HarmonyOS 工程 |
| `ui_inspect` | 官方窗口列表和布局树；支持窗口/显示选择、全窗口、深度过滤及精简/完整输出 | DevEco Studio/CLT、设备或模拟器 |
| `ui_control` | 官方 UI 控制器；支持坐标手势和 node-id/window 定位 | DevEco Studio/CLT、设备或模拟器 |
| `get_app_ui_tree` | 通过 CodeGenie 获取前台调试应用的 UI 树 | DevEco Studio、CodeGenie 子进程、设备 |
| `perform_ui_action` | 通过 CodeGenie 执行应用 UI 操作 | DevEco Studio、CodeGenie 子进程、设备 |

优先使用 `ui_tap` 的 `key`、`text` 或 `type` 选择器。自绘控件没有出现在 UI 树中时，使用 `from_x_percent`、`from_y_percent`、`to_x_percent`、`to_y_percent` 按当前屏幕比例生成手势；不要长期保存某台设备的绝对像素坐标。返回“手势发送成功”只代表设备接受了事件，不代表界面一定发生变化，可配合 `ui_observe` 或 `verify` 验证。

### 模拟器（2）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `emulator_manage` | 列出、启动、停止、创建和删除模拟器；管理镜像和许可证 | DevEco Studio/CLT 的模拟器组件 |
| `emulator_scenario` | 模拟摇晃、电源、旋转、音量、折叠、电池、位置、运动/导航和传感器 | 已启动的 DevEco 模拟器 |

## `deveco_script` 的 19 个脚本

所有脚本只能从静态白名单调用，不能用它执行任意路径或 Shell 命令。先调用 `deveco_script_catalog` 可以得到当前注册表。

| 脚本 ID | 用途 | 额外依赖 |
|---|---|---|
| `copy_template` | 复制内置 ArkTS 工程模板并补全 SDK 元数据 | DevEco Studio/CLT |
| `detect_sdk` | 检测工具链中的 API Level 和 SDK 元数据 | DevEco Studio/CLT |
| `collect_hilog` | 采集有界 Hilog 快照 | HDC 设备 |
| `fetch_faultlog` | 拉取指定 faultlogger 文件 | HDC 设备 |
| `jscrash_report` | 采集或分析 JS crash 并生成结构化诊断 | 采集模式需要 HDC 设备 |
| `parse_jscrash_log` | 分析本地文件或内联 JS crash 文本 | 无 |
| `probe_faultlogger` | 探测设备最近的 faultlogger 条目 | HDC 设备 |
| `search_practices` | 按组件名或关键词搜索 ArkUI 最佳实践 | 无 |
| `ui_score` | 比较参考图与候选图的 UI 还原度 | Python 3、Pillow |
| `apifault_collect_hilog` | 采集并过滤 API 故障 Hilog | Python 3、HDC 设备 |
| `apifault_analyze_media` | 分析媒体容器和编解码信息 | Python 3 |
| `appfreeze_analyze` | 分析 AppFreeze 日志、Binder 链和堆栈 | Python 3 |
| `appfreeze_sample_stack` | 分析卡死期间采样的堆栈 | Python 3 |
| `arkts_docs_search` | 搜索随 Skill 提供的 ArkTS 本地文档索引 | Python 3、相应 Skill 数据 |
| `arkui_docs_search` | 查询 ArkUI 本地知识库 | Python 3、相应 Skill 数据 |
| `arkui_docs_rebuild_index` | 文档变化后重建 ArkUI 索引 | Python 3、相应 Skill 数据 |
| `instrument_test_run` | 运行 HarmonyOS 真机仪器测试 | Python 3、工程、工具链、HDC 设备 |
| `local_test_run` | 运行 HarmonyOS 主机侧单元测试 | Python 3、工程、工具链 |
| `memleak_analyze` | 分析 ArkTS heap snapshot 的泄漏嫌疑和保留路径 | Python 3 |

示例：

```json
{
  "name": "deveco_script",
  "arguments": {
    "script": "parse_jscrash_log",
    "args": {
      "logFile": "/tmp/jscrash.log",
      "source": "file"
    }
  }
}
```

需要位置参数的脚本使用 `argv`，例如：

```json
{
  "name": "deveco_script",
  "arguments": {
    "script": "search_practices",
    "argv": ["Swiper", "--limit=5", "--json"]
  }
}
```

## 推荐工作流

构建并安装：

```text
switch_cwd → deveco_doctor → project_sync → arkts_check/code_lint
           → build_project(start/status) → start_app
```

真机 UI 操作：

```text
hdc_log(list_devices) → ui_observe → ui_tap → ui_observe/ui_snapshot
```

重复页面路径建议先录制再一键回放：

```text
ui_flow(record_start) → ui_observe/ui_tap... → ui_flow(record_stop)
ui_flow(run) → 必要时 ui_flow(status)
```

流程默认保存在项目的 `.arkpilot/flows/*.json`，项目驱动配置保存在 `.arkpilot/config.json`，首次访问时会生成 `{ "driver": "hdc-shell" }`。录制只接收成功的本地 `ui_tap` 操作；输入值会保存为运行变量而不是明文。回放使用 `aa force-stop` / `aa start` 直接启动已安装应用，不构建也不重新安装，成功路径不截图，失败时才返回截图路径和精简 UI 树。默认后端是 `hdc-shell`；`hypium-driver` 不是必需依赖，`hypium` 名称已预留，但在真机与模拟器性能门禁通过前会明确返回不可用，不会静默切换。

ArkPilot Flow 是独立限界上下文，代码集中在 `src/arkpilot/`：领域层负责版本、步骤、选择器、变量和超时规则；应用层负责录制及执行任务状态机；基础设施层负责项目清单解析、原子 JSON 仓库、HDC 会话和可选驱动端口；`src/server.mjs` 只负责 MCP Schema 与错误转换。它不会重构或改变既有工具，也没有任何 LingDong 专用路由。标准 UI 树无法识别 Canvas、XComponent 或游戏画面时，只能录制标记为 `fragile` 的屏幕百分比步骤。

代码改动后的快速验证：

```text
arkts_check → build_project(start/status) → apply_changes
```

如果工程和设备支持真正热重载，可将最后一步改为常驻的 `hot_reload(start/apply/status/stop)`。

## 可选 Skill 和宿主适配

MCP 之外，仓库包含 56 个 Skill：默认安装 `core` 17 个，`full` profile 再加入 `extended` 39 个。

```bash
node scripts/install.mjs --dest <目标目录>
node scripts/install.mjs --dest <目标目录> --profile full

node scripts/install-host.mjs --host claude
node scripts/install-host.mjs --host codex
node scripts/install-host.mjs --host all --profile full
```

`install.mjs` 只写入指定目标目录；`install-host.mjs` 才负责 Claude/Codex 的 Skill 发现目录。默认使用 `core` 是为了控制宿主的 Skill 描述上下文开销。

`extended` 层来自 `HarmonyOS_Skills/harmonyos-agent-skills`，上游缺少仓库级许可证，部分条目也没有独立许可声明。安装 `full` 前请阅读 [`LICENSE`](./LICENSE)、[`NOTICE.harmonyos-agent-skills`](./NOTICE.harmonyos-agent-skills) 和 [`provenance/`](./provenance/)。

## 运行约束

- 44 个工具的参数都会先按公开 JSON Schema 校验。
- `tools/list` 使用本地静态表，不等待 CodeGenie 子进程；CodeGenie 不可用只影响其 3 个代理工具。
- 构建和浏览器登录默认使用“启动任务 + 状态查询”，避免常见 MCP 客户端的 30 秒调用上限。
- CLI、LSP、HDC、脚本和网络请求均有截止时间；超时会终止所启动的子进程树。
- `ui_snapshot` 和 `ui_observe` 默认不覆盖明确指定的已有文件，确需覆盖时传 `overwrite: true`。
- 已禁用 `verify_ui`、`save_ui_screenshot`、`get_ui_verification_log`；它们不会出现在工具列表中，原因见 [`PACK.md`](./PACK.md)。

## 开发和验证

```bash
npm test
npm run test:flow:unit
```

连接测试设备后运行真机 canary：

```bash
npm run test:device
```

已有确定性流程后，可做指定设备的连续回放和性能基准：

```bash
npm run test:flow:device -- --project /absolute/path/to/project --flow <flow-id> --device <device-id> --iterations 30
npm run bench:ui-flow -- --project /absolute/path/to/project --flow <flow-id> --device <device-id> --iterations 50
```

流程含输入变量时，用 `--variables-file /absolute/path/to/variables.json` 传值，脚本不会把变量写入流程文件。真机与模拟器同时连接时必须传 `--device`。

列出注册脚本：

```bash
npm run scripts
```

## 来源与许可

- `core` Skill 主要提取自 DevEco Code，具体版本、提交和改动见 [`provenance/`](./provenance/)。
- `extended` Skill 的来源和不同许可边界见 [`NOTICE.harmonyos-agent-skills`](./NOTICE.harmonyos-agent-skills)。
- 完整包结构、宿主映射和接入约定见 [`PACK.md`](./PACK.md)。
- 本仓库许可范围见 [`LICENSE`](./LICENSE)。
