# deveco-tool

`deveco-tool` 是面向 HarmonyOS / OpenHarmony 开发的统一 stdio MCP 服务。它把 DevEco CLI、ArkTS 语言服务、CodeGenie、HDC 真机控制和仓库内的诊断脚本统一成 **42 个 MCP 工具**，AI 客户端只需连接一个进程。

这个仓库还包含可选的 Skill、SDD 命令和模板；它们不是运行 MCP 的必要条件。机器可读清单见 [`manifest.json`](./manifest.json)，能力包接入和来源细节见 [`PACK.md`](./PACK.md)，UI 自动化的分层、生成时机和性能边界见 [`docs/arkpilot-architecture.md`](./docs/arkpilot-architecture.md)。

## 自主研发的 ArkPilot UI 录制与回放

ArkPilot 是本仓库自主研发的通用 HarmonyOS UI 自动化能力。它把 AI 首次进入页面时反复执行的“截图、识别、点击”过程录制成语义化流程，后续通过一次 `ui_flow` 调用直接回放。它不修改应用代码，也不要求项目预先维护路由 JSON。

首次导航时调用 `ui_flow action=navigate`：ArkPilot 会先尝试从标准工程清单中发现可直接启动的 Ability、App Link 或 Want；无法直达时查找已有流程；仍未命中才进入探索录制。录制期间，成功的 `ui_tap` 操作会自动写入内存草稿，最终断言通过后才原子保存到项目的 `.arkpilot/flows/`。保存后的流程是项目资产，只有明确调用 `ui_flow action=delete` 才会删除。

回放优先使用组件 `key`，并保留严格的语义备用选择器。控件只改变屏幕位置时会在最新 UI 树中重新定位，不依赖旧坐标；主选择器失效时，只有唯一候选且整个流程最终验证成功才会更新流程。成功路径不截图，失败诊断截图保存在系统临时目录并自动清理。完整设计和边界见 [`docs/arkpilot-architecture.md`](./docs/arkpilot-architecture.md)。

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

`npm install` 会安装 MCP 依赖和官方 `devecocli` 桥接器，不需要再全局安装 `devecocli` 或 CodeGenie MCP。ArkTS 语言服务本体不再使用 npm 第三方实现，而是从本机 DevEco Studio/CLT 中发现官方 `ace-server`：

| npm 依赖 | 作用 |
|---|---|
| `@modelcontextprotocol/sdk`、`zod`、`ajv` | MCP 通信和工具参数校验 |
| `@deveco/deveco-cli` | 构建、部署、Linter、文档、设备、UI、模拟器和签名，以及 `serve lsp --arkts` 官方语言服务桥接 |
| `@deveco-codegenie/mcp` | C/C++ 检查及 CodeGenie UI 树代理能力 |
| `vscode-jsonrpc`、`vscode-uri` | 与官方 `ace-server` 通信所需的标准 LSP/URI 支持 |

到这里已经可以启动 MCP、列出 42 个工具，以及使用不依赖鸿蒙工具链的工具。

### 使用鸿蒙工程能力

下列依赖按实际调用的工具安装，不是 MCP 进程启动的前置条件。

| 能力 | 必需依赖 |
|---|---|
| 构建、同步、官方 Linter、API 兼容、热重载、官方文档 | DevEco Studio，或 DevEco Command Line Tools（CLT），并安装对应 HarmonyOS/OpenHarmony SDK |
| ArkTS 检查 | HarmonyOS/OpenHarmony SDK |
| ArkTS 语言服务 | 带官方 `ace-server` 的 DevEco Studio，或带 `arkts-lsp` 的官方 CLT；Linux 使用 CLT 并配置 `DEVECO_CLI_CLT_PATH` |
| 真机安装、日志、截图、UI 树、手势、`ui_flow` 导航和 `verify_ui` | 工具链中的 `hdc`；真机已连接、已授权调试且能被 `hdc list targets` 识别 |
| 模拟器管理和场景模拟 | DevEco 模拟器组件、系统镜像及已接受的许可证 |
| `arkts_knowledge_search` | 可访问华为 DevEco CodeGenie 服务的网络，以及通过 `deveco_login` 建立的会话 |
| 自动签名和团队列表 | 华为开发者账号，以及通过 `deveco_cli_auth` 建立的官方 CLI 会话 |

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

高级覆盖项包括 `DEVECO_CLI_ENTRY`、`DEVECO_CODEGENIE_ENTRY`、`OHOS_SDK_PATH` 和 `TSDK_PATH`。它们主要用于非标准安装或调试；常规安装不要设置。ArkTS LSP 后端固定由官方 DevEco CLI 和工具链发现，不接受第三方语言服务入口覆盖。

安装后先运行环境诊断：

```bash
npm run doctor
```

诊断会检查 Node.js、DevEco/CLT、SDK、HDC、当前工程、Skill 和 CodeGenie 子进程状态；兼容性字段还会报告本机可选的 Python/Pillow 环境，但当前官方 Skill 不依赖它们。

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

## 42 个 MCP 工具

表格中的“依赖”是在 Node.js 和 `npm install` 之外的条件。

### 项目、脚本和服务管理（7）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `deveco_script_catalog` | 列出允许通过 MCP 执行的 7 个官方 Skill 脚本、运行时和说明 | 无 |
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

### 代码检查和语言服务（9）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `arkts_check` | 对整个工程或指定 `.ets` 文件运行 ArkTS 静态检查 | 工程、SDK |
| `check_ets_files` | 对明确给出的 `.ets` / `.ts` 文件运行本地 ArkTS 检查 | 活动工程、SDK |
| `code_lint` | 官方工程级 Code Linter；支持增量检查、JSON、报告文件和自动修复 | 工程、DevEco Studio/CLT |
| `api_compat_check` | 扫描文件/模块的 API 版本兼容性，或列出支持的 API 版本 | 工程、DevEco Studio/CLT |
| `lsp` | 官方 ArkTS LSP 原始入口，仅支持定义、引用、悬停和实现四类请求 | 工程、官方 `ace-server` |
| `find_references` | 通过官方服务查询符号引用 | 工程、官方 `ace-server` |
| `go_to_definition` | 通过官方服务跳转到符号定义 | 工程、官方 `ace-server` |
| `get_hover` | 通过官方服务获取位置上的类型和文档 | 工程、官方 `ace-server` |
| `check_cpp_files` | 通过 CodeGenie 子进程检查 C/C++ 文件 | 工程、DevEco Studio、CodeGenie 子进程 |

`arkts_check` 是静态预检，不能代替真实编译；是否可以产出 HAP/HAR 应以 `build_project` 为准。

ArkTS LSP 只封装当前官方服务真实声明的 `definitionProvider`、`referencesProvider`、`hoverProvider` 和 `implementationProvider`。`lsp` 的 `operation` 分别为 `goToDefinition`、`findReferences`、`hover`、`goToImplementation`；四种请求都必须提供 `.ets` 文件和从 1 开始的行列位置。专用工具返回便于阅读的 1-based 路径和源码行，`lsp` 保留官方原始响应中的 0-based 位置。

语言服务按工程延迟启动并复用同一个官方进程，连续查询不会重复索引或重复读取未修改的源文件。文档状态最多保留 32 个文件、合计 16 MiB，空闲 60 秒后会关闭 `devecocli` 与 `ace-server` 进程树，以释放官方索引器占用的内存；可用 `DEVECO_LSP_IDLE_MS` 在 30000～1800000 毫秒范围内调整。首次初始化尚未完成时返回可重试的 `LSP_INITIALIZING`，请求或初始化达到硬超时会终止对应进程树。

### 构建、部署和签名（6）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `project_sync` | 执行 `ohpm install --all` 并同步 Hvigor 工程模型 | 工程、DevEco Studio/CLT、SDK；安装依赖时需要网络 |
| `build_project` | 构建整个产品或指定模块；支持启动、查询、取消和同步运行 | 工程、DevEco Studio/CLT、SDK |
| `start_app` | 安装已构建的单个 Entry HAP 并启动 Ability；不会隐式构建 | 工程、已构建产物、HDC 设备 |
| `apply_changes` | 冷增量构建并安装修改文件，精确部署一个 Entry 模块 | 工程、DevEco Studio/CLT、HDC 设备 |
| `hot_reload` | 管理常驻热重载：启动、应用 `.ets` 改动、查询和停止；启动单次最多等待 20 秒，尚未就绪时用 `status` 继续查询 | 工程、DevEco Studio/CLT、支持热重载的 HDC 设备 |
| `app_signature` | 通过官方 CLI 生成或更新工程签名配置 | 工程、DevEco Studio/CLT、官方 CLI 登录和团队/设备信息 |

`build_project` 默认 `action: "start"`，会立即返回 `job_id`。之后用 `action: "status"` 查询，或用 `action: "cancel"` 终止。只有确认 MCP 客户端允许长请求时才使用 `action: "run"`；工具参数中的 `timeoutMs` 无法提高客户端自身固定的 30 秒外层超时。

### 设备和日志（2）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `device_info` | 返回设备名称、序列号、设备类型和系统版本等官方信息 | DevEco Studio/CLT、HDC 设备或已启动模拟器 |
| `hdc_log` | 列出设备、采集/过滤/清理 Hilog | HDC、已连接设备 |

只有一个设备在线时，多数工具可自动选择；多个设备在线时应显式传 `hvd` 或 `target`，避免操作错误设备。

### UI 检查和控制（10）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `ui_snapshot` | 通过 HDC 截图，可内联返回、缩放、选择显示屏和检测画面是否变化；默认使用临时会话目录 | HDC 设备 |
| `ui_find` | 解析 UI 布局树，按文本、key、类型和可点击状态返回可操作坐标 | HDC 设备 |
| `ui_observe` | 并行获取截图和布局树，一次返回画面、节点和坐标 | HDC 设备 |
| `ui_tap` | 点击、双击、长按、滑动、fling、drag、方向 fling、文本和按键；支持节点百分比及屏幕百分比定位 | HDC 设备 |
| `ui_flow` | 统一导航决策：优先使用清单声明的 Ability/App Link/Want 直达，其次匹配流程回放，否则自动开始探索录制；支持安全选择器自愈和异步任务 | HDC 设备、HarmonyOS 工程 |
| `verify_ui` | 最终视觉验收：临时截图、语义断言和短期帧签名比较；不用于普通点击定位 | HDC 设备 |
| `ui_inspect` | 官方窗口列表和布局树；支持窗口/显示选择、全窗口、深度过滤及精简/完整输出 | DevEco Studio/CLT、设备或模拟器 |
| `ui_control` | 官方 UI 控制器；支持坐标手势和 node-id/window 定位 | DevEco Studio/CLT、设备或模拟器 |
| `get_app_ui_tree` | 通过 CodeGenie 获取前台调试应用的 UI 树 | DevEco Studio、CodeGenie 子进程、设备 |
| `perform_ui_action` | 兼容旧 UI 调用；点击、截图和可安全转义的文本走本地 HDC 快速路径，只有 HDC 无法安全引用的文本才回退 CodeGenie；新调用优先使用 `ui_flow` / `ui_tap` | HDC 设备；特殊文本回退还需 CodeGenie 子进程 |

优先使用 `ui_tap` 的 `key`、`text` 或 `type` 选择器。自绘控件没有出现在 UI 树中时，使用 `from_x_percent`、`from_y_percent`、`to_x_percent`、`to_y_percent` 按当前屏幕比例生成手势；不要长期保存某台设备的绝对像素坐标。返回“手势发送成功”只代表设备接受了事件，不代表界面一定发生变化，可配合 `ui_observe` 或 `verify_ui` 验证。

### 模拟器（2）

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `emulator_manage` | 列出、启动、停止、创建和删除模拟器；管理镜像和许可证 | DevEco Studio/CLT 的模拟器组件 |
| `emulator_scenario` | 模拟摇晃、电源、旋转、音量、折叠、电池、位置、运动/导航和传感器 | 已启动的 DevEco 模拟器 |

## `deveco_script` 的 7 个脚本

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

MCP 通过 `src/script-adapters/` 适配执行，官方 Skill 文件保持原始校验值。
`copy_template` 直接展开依赖包自带模板，支持含中文、空格的目标目录，无需全局安装 `devecocli`。
创建成功不代表构建器支持该目录：Hvigor 会拒绝中文、`&` 等路径字符；需要构建时请使用其允许的目录名称。
设备脚本共用网关的 `HDC_PATH` 和 Studio/CLT 解析；同时连接多个设备时须指定 `deviceId`。
`probe_faultlogger` 严格按包名、设备时钟与时间窗口筛选；无匹配时返回 `not_found`，
设备或探测命令失败时返回 `probe_failed`。`maxAgeMinutes: 0` 表示查询全部历史记录。

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

## 推荐工作流

构建并安装：

```text
switch_cwd → deveco_doctor → project_sync → arkts_check/code_lint
           → build_project(start/status) → start_app
```

首次或重复的多步骤页面导航：

```text
ui_flow(navigate, goal=目标页面)
  ├─ 清单存在精确 Ability/App Link/Action → 直接 aa start
  ├─ 已有流程 → 一次回放
  └─ 没有流程 → 返回 explore，AI 用 ui_observe/ui_tap 探索，成功后再次 navigate 保存
```

单步操作或探索过程：

```text
ui_observe → ui_tap → 必要时 verify_ui
```

流程默认保存在项目的 `.arkpilot/flows/*.json`，项目驱动配置保存在 `.arkpilot/config.json`。安装和启动 MCP 不会生成它们；首次使用 `navigate`、`run`、`list` 等项目级流程仓库能力时才按需创建。显式录制开始时只保留内存草稿，直到 `record_stop` 验证成功才落盘，因此取消录制不会留下流程文件。成功保存的流程是可复用的项目资产，不是测试临时文件；除非用户明确调用 `ui_flow action=delete`，清理验证产物时不得删除。新配置会写入 `hdc-shell`、自动录制、安全自愈和 Hypium 性能门禁的显式默认值。录制只接收成功的本地 `ui_tap` 操作；输入值会保存为运行变量而不是明文。回放使用 `aa force-stop` / `aa start` 直接启动已安装应用，不构建也不重新安装，成功路径不截图，失败时才返回截图路径和精简 UI 树。选择器 key 失效时，只允许唯一、精确且指向同一节点的录制备用选择器接管，并且必须等最终断言成功后才原子更新流程；候选歧义时停止，不猜测点击。

默认后端是 `hdc-shell`。可选 `hypium-driver` 适配器使用常驻连接、10 秒以内 RPC 截止时间和取消清理，但只有关闭其遥测且项目性能门禁通过时才允许配置为 `hypium`；未通过门禁不会静默切换后端。Ability、Action 和 App Link 从标准 `AppScope/app.json5`、`build-profile.json5`、`module.json5` 发现。动态 URI 和业务 Want 参数必须由调用方明确提供。

未指定 `localPath` 的截图不会写进工程目录：电脑端保存在系统 `tmp/deveco-ui/sessions/` 下的当前 MCP 会话目录，内联返回后立即删除，未内联的大图和失败诊断最长保留 10 分钟，并在 MCP 退出时统一删除；异常退出留下的会话目录会被下一个 MCP 进程回收。设备端截图只在 `/data/local/tmp` 短暂停留，拉取完成后立即删除。只有调用方显式传入 `localPath` 时才会保留文件。

ArkPilot Flow 是独立限界上下文，代码集中在 `src/arkpilot/`：领域层负责版本、步骤、选择器、变量和超时规则；应用层负责录制及执行任务状态机；基础设施层负责项目清单解析、原子 JSON 仓库、HDC 会话和可选驱动端口；`src/server.mjs` 只负责 MCP Schema 与错误转换。既有工具保持兼容。标准 UI 树无法识别 Canvas、XComponent 或游戏画面时，只能录制标记为 `fragile` 的屏幕百分比步骤。

代码改动后的快速验证：

```text
arkts_check → build_project(start/status) → apply_changes
```

如果工程和设备支持真正热重载，可将最后一步改为常驻的 `hot_reload(start/apply/status/stop)`。

## 官方 Skill 和宿主适配

MCP 之外，仓库从 DevEco Code `v0.1.11` 的 6 个官方内置 Skill 中保留 5 个；面向 DevEco Code 自身配置的 `customize-deveco` 按当前产品范围删除，其他非官方 Skill 也不再分发。

```bash
node scripts/install.mjs --dest <目标目录>
node scripts/install.mjs --dest <目标目录>

node scripts/install-host.mjs --host claude
node scripts/install-host.mjs --host codex
node scripts/install-host.mjs --host all
```

`install.mjs` 只写入指定目标目录；`install-host.mjs` 才负责 Claude/Codex 的 Skill 发现目录。为兼容旧命令，安装器仍接受 `--profile core|full`，两者在当前版本都会安装同一组 5 个官方 Skill。

## 运行约束

- 42 个工具的参数都会先按公开 JSON Schema 校验。
- `tools/list` 使用本地静态表，不等待 CodeGenie 子进程；CodeGenie 不可用只影响 C/C++ 检查和 UI 树两个代理工具。
- 构建和浏览器登录默认使用“启动任务 + 状态查询”，避免常见 MCP 客户端的 30 秒调用上限。
- CLI、LSP、HDC、脚本和网络请求均有截止时间。LSP 首次工程初始化超过单次调用时间时返回 `LSP_INITIALIZING` 并在后台继续，真实请求超时或 120 秒初始化硬超时会终止所启动的子进程树。
- `ui_snapshot` 和 `ui_observe` 默认不覆盖明确指定的已有文件，确需覆盖时传 `overwrite: true`。
- `verify_ui` 是本地受控实现；上游 `save_ui_screenshot`、`get_ui_verification_log` 仍未公开，因为本实现不持久化上游验证会话。

## 开发和验证

```bash
npm test
npm run test:flow:unit
```

项目、脚本和服务管理的回归检查：

```bash
node --test --test-concurrency=1 test/management.test.mjs test/document-validate.test.mjs
```

CI 在 Linux 上运行全量测试，在 macOS、Windows 上运行上述管理工具测试（Node 22/24）。
模拟 HDC 可执行文件的用例仅在 POSIX 主机运行；Windows 真机仍需对应 SDK 的 HDC。
跨平台支持以相应系统有可用的 DevEco SDK、HDC、官方后台二进制为前提。

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

- 保留的 5 个 Skill 均完整同步自 DevEco Code `v0.1.11`，具体提交、选用范围与校验方式见 [`provenance/`](./provenance/)。
- 完整包结构、宿主映射和接入约定见 [`PACK.md`](./PACK.md)。
- 本仓库许可范围见 [`LICENSE`](./LICENSE)。
