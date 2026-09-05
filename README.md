# deveco-tool

面向 HarmonyOS / OpenHarmony 项目开发的本地 stdio MCP 服务。让 AI 客户端通过一个连接完成工程检查、构建部署、设备操作、崩溃诊断和 UI 流程回放。

固定提供 **40 个 MCP 工具**。官方 Skill 可单独安装，不是启动 MCP 的前置条件。

## 这个项目解决什么问题

DevEco CLI、官方 ArkTS 语言服务、CodeGenie 和 HDC 提供底层开发能力；本仓库把这些能力接入同一个 MCP 服务，并负责工程上下文、参数校验、任务状态、超时处理和后台恢复。

| 层次 | 来源与职责 |
|---|---|
| 官方开发能力 | 通过固定版本的 npm 依赖接入 DevEco CLI 和 CodeGenie；从本机工具链发现官方 ArkTS `ace-server`；通过 HDC 操作设备 |
| MCP 适配与管理 | 统一工具入口、工程切换、环境诊断、后台重启，以及白名单脚本的参数发现和校验 |
| ArkPilot | 本仓库实现的 UI 导航、语义流程录制与回放、选择器修复和最终验收 |
| 可选能力包 | 从 DevEco Code 固定版本同步的 5 个官方 Skill |

本项目依赖官方工具链执行编译、签名和设备操作。官方 Skill 保持原始文件内容；本地修复位于 MCP 适配层。同步版本及历史来源见 [来源记录](./provenance/SOURCES.md)。

## 快速接入

### 1. 安装依赖

需要 Node.js **22 或更新版本**及配套 npm。克隆仓库并安装：

```bash
git clone https://github.com/like3213934360-lab/deveco_tool.git
cd deveco_tool
npm ci
npm run doctor
```

`npm ci` 按锁文件安装依赖，包括官方 CLI 和 CodeGenie MCP 包，无需全局安装它们。仅启动 MCP、查询脚本目录或解析已有崩溃文本，不需要先安装 DevEco Studio。

`doctor` 默认检查本地环境。要同时启动并探测 CodeGenie 后台，执行：

```bash
npm run doctor -- --probe-codegenie
```

### 2. 注册 MCP

支持 `mcpServers` JSON 格式的客户端可使用以下配置，将路径换成实际的仓库位置：

```json
{
  "mcpServers": {
    "deveco": {
      "command": "node",
      "args": ["/absolute/path/to/deveco_tool/src/server.mjs"]
    }
  }
}
```

Windows 的 JSON 路径需要转义反斜杠，例如 `C:\\dev\\deveco_tool\\src\\server.mjs`。如果宿主找不到 `node`，将 `command` 改为 Node 可执行文件的绝对路径。

安装器可以按本机仓库位置输出配置，不会自动改写客户端的 MCP 配置文件：

```bash
node scripts/install.mjs --print-mcp
node scripts/install-host.mjs --host claude --print-mcp
node scripts/install-host.mjs --host codex --print-mcp
```

第一条输出单个服务的 JSON 配置项；后两条输出对应宿主的配置片段。客户端连接后先调用 `deveco_doctor`，再用 `switch_cwd` 选择 HarmonyOS 工程。也可在支持的单次调用中传 `project_path`。

调试时可用 `npm run mcp` 启动服务；它通过标准输入输出与 MCP 客户端通信，不提供网页界面。

### 3. 配置工具链

macOS 默认安装位置 `/Applications/DevEco-Studio.app` 会自动发现。非默认安装、Windows 或纯 CLT 环境应在 MCP 的 `env` 中配置相应路径。

| 环境变量 | 用途 |
|---|---|
| `DEVECO_CLI_STUDIO_PATH` | DevEco Studio 根目录；macOS 可指向 `.app` |
| `DEVECO_CLI_CLT_PATH` | DevEco Command Line Tools 根目录；纯 CLT 环境使用此项 |
| `PROJECT_PATH` | 启动后的默认工程根目录；也可通过 `switch_cwd` 设置 |
| `HDC_PATH` | 可选的 HDC 可执行文件覆盖路径 |
| `DEVECO_HOME` / `DEVECO_PATH` | Studio 路径的兼容配置，优先级低于上述 Studio/CLT 配置 |

按实际安装选择 Studio 或 CLT 配置。高级覆盖项 `DEVECO_CLI_ENTRY`、`DEVECO_CODEGENIE_ENTRY`、`OHOS_SDK_PATH`、`TSDK_PATH` 用于非标准环境和调试，常规安装无需设置。

| 要使用的能力 | 额外条件 |
|---|---|
| 构建、同步、Linter、API 兼容检查 | DevEco Studio/CLT、对应 SDK 和有效工程 |
| ArkTS 语言服务 | 当前系统可运行的官方 `ace-server` 或 CLT `arkts-lsp` 组件 |
| 真机部署、日志和 UI 操作 | HDC、已连接并授权调试的设备 |
| 模拟器 | 官方模拟器组件、镜像和已接受的许可证 |
| CodeGenie 知识检索 | 网络、华为账号及 `deveco_login` 会话 |
| 自动签名与团队操作 | 官方 CLI 环境、网络、华为账号及 `deveco_cli_auth` 会话 |

## 工具接口

MCP 固定提供 40 个工具，其中项目、脚本和服务管理入口为 5 个。工程切换使用 `switch_cwd`。

更新服务代码后，需要由宿主重新连接 MCP。`deveco_restart` 只重置后台子服务，不会加载新的网关代码。

工具数量不直接决定 AI 是否正确选择工具或遵循流程。本项目减少重复入口、按需提供脚本参数，并在服务端校验实际调用；工具说明不能代替执行校验。管理工具定义的 JSON 字符数较优化前减少约 24%，完整工具列表减少约 1.7%；这不是 token 节省或模型准确率提升的测量。方法见 [验证记录](./docs/management-tools-validation.md)。

## 工具清单

下列依赖均不包含启动服务所需的 Node.js 与 npm 依赖。机器可读清单见 [manifest.json](./manifest.json)，具体参数以客户端发现的工具 Schema 为准。

### 项目、脚本和服务管理

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `deveco_script_catalog` | 列出 7 个脚本摘要；传 `script` 获取单个脚本的参数 Schema、flags 和示例 | 无 |
| `deveco_script` | 执行白名单脚本；命名参数与原始 argv 均受校验 | 取决于脚本 |
| `switch_cwd` | 切换后续调用使用的活动工程根目录 | 有效工程 |
| `deveco_doctor` | 诊断工具链、SDK、HDC、工程、Skill 和 CodeGenie 状态 | 无；缺失项作为诊断返回 |
| `deveco_restart` | 重置 ArkTS LSP、CodeGenie 或两者；后续调用按需启动，无需断开 MCP | 无 |

### 登录、知识和文档

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `deveco_login` | 启动或查询 CodeGenie 中国站浏览器登录任务 | 浏览器、网络、华为账号 |
| `deveco_logout` | 取消未完成的 CodeGenie 登录和令牌刷新，再清除本地会话 | 无 |
| `deveco_status` | 查询 CodeGenie 登录状态，不返回访问令牌 | 无 |
| `arkts_knowledge_search` | 搜索官方 ArkTS、ArkUI、HarmonyOS 和 OpenHarmony 知识库 | 网络、CodeGenie 会话 |
| `deveco_cli_auth` | 官方 CLI 登录、登出、状态和签名团队列表 | DevEco Studio/CLT；在线操作需要账号和网络 |
| `harmony_docs` | 列出、搜索和阅读官方本地文档 | DevEco Studio/CLT |

`deveco_login` 与 `deveco_cli_auth` 使用两套独立会话，分别服务于 CodeGenie 知识检索和官方 CLI 认证能力。

`deveco_login` 启动后返回 `login_id`，用 `action=status` 查询进度。等待期间会提供 `login_url`；若 `browser_status=manual_required`，请在运行 MCP 的机器上手动打开该地址，回调服务仍会等待到五分钟超时。退出登录会取消该任务，旧回调或未完成的令牌刷新不能恢复会话；这一规则同样适用于本机多个 MCP 进程共享同一账号存储的情况。重新登录须再次调用 `deveco_login`。

本地文档正文中的报错示例不会被当作工具执行失败。`deveco_cli_auth` 则按所请求操作的完成结果判断成功；未登录或令牌失效导致无法列出签名团队时，MCP 返回 `isError=true`。

### 代码检查和语言服务

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `arkts_check` | 静态预检整个工程或指定 `.ets` / `.ts` 源码 | 工程、SDK |
| `check_ets_files` | 检查非空列表明确给出的 `.ets` / `.ts` 文件 | 活动工程、SDK |
| `code_lint` | 官方工程级 Linter，支持增量检查、报告和自动修复 | 工程、DevEco Studio/CLT |
| `api_compat_check` | 检查文件或模块的 API 兼容性，或列出支持的版本 | 工程、DevEco Studio/CLT |
| `lsp` | 官方 ArkTS 定义、引用、悬停和实现查询的原始入口 | 工程、官方语言服务 |
| `find_references` | 查询符号引用 | 工程、官方语言服务 |
| `go_to_definition` | 跳转到符号定义 | 工程、官方语言服务 |
| `get_hover` | 获取位置上的类型和文档 | 工程、官方语言服务 |
| `check_cpp_files` | 通过 CodeGenie 检查 C/C++ 文件 | 工程、DevEco Studio、CodeGenie 后台 |

`arkts_check` 是静态预检，产物能否构建仍以 `build_project` 为准。LSP 请求输入使用从 1 开始的行列位置；专用工具返回可读的 1-based 位置，`lsp` 保留官方响应中的 0-based 位置。原始入口的 `operation` 支持 `goToDefinition`、`findReferences`、`hover`、`goToImplementation`。

整工程预检按 `build-profile.json5` 的模块路径发现源码，包含模块根目录的源码入口，排除声明文件、依赖目录、构建产物及 `hvigorfile.ts`。Stage 页面检查使用各模块 `module.json5` 的 `$profile:` 配置，支持模块改名和自定义页面清单；`check_ets_files` 的空数组会报参数错误。资源存在性检查使用 SDK 的语法树，注释和字符串示例不会触发资源调用检查。

`code_lint` 仅在 `fix:true` 时请求自动修复，路径按字面处理；增量检查需要 Git 工作树，未执行的检查会返回错误。`api_compat_check` 区分扫描失败与明确的无 API 变更结果；空结果也支持 JSON/CSV 报告。当前官方 Hvigor 会拒绝中文工程根目录，依赖 `compileNative` 的 API 兼容扫描仍受此限制。LSP 在查询前同步已打开文件的磁盘改动，并在 `includeDeclaration:false` 时根据定义位置排除声明。

### 构建、部署和签名

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `project_sync` | 安装工程依赖并同步 Hvigor 模型 | 工程、DevEco Studio/CLT、SDK；下载依赖时需要网络 |
| `build_project` | 构建产品或模块，支持启动、查询、取消和同步运行 | 工程、DevEco Studio/CLT、SDK |
| `start_app` | 安装已构建的单个 Entry HAP 并启动 Ability | 工程、产物、HDC 设备 |
| `apply_changes` | 冷增量构建并安装修改文件 | 工程、DevEco Studio/CLT、HDC 设备 |
| `hot_reload` | 启动、应用、查询或停止常驻热重载 | 工程、DevEco Studio/CLT、支持热重载的设备 |
| `app_signature` | 通过官方 CLI 生成或更新签名配置 | 工程、工具链、CLI 会话及团队/设备信息 |

`build_project` 默认以 `action: "start"` 返回 `job_id`，随后用 `status` 查询或 `cancel` 取消。`start_app` 不会隐式构建。服务端 `timeoutMs` 无法延长客户端自身的请求时限，长任务应使用启动和查询方式。

### 设备、日志和模拟器

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `device_info` | 查询设备名称、序列号、类型和系统版本 | DevEco Studio/CLT、设备或模拟器 |
| `hdc_log` | 列出设备、采集、过滤或清理 Hilog | HDC；日志操作需要设备 |
| `emulator_manage` | 管理模拟器实例、镜像和许可证 | 官方模拟器组件 |
| `emulator_scenario` | 模拟电源、旋转、折叠、位置、运动、传感器等场景 | 已启动的官方模拟器 |

### UI 检查和控制

| 工具 | 用途 | 额外依赖 |
|---|---|---|
| `ui_snapshot` | 截图、缩放、选择显示屏和检测画面变化 | HDC 设备 |
| `ui_find` | 按文本、key、类型等条件查询 UI 树节点 | HDC 设备 |
| `ui_observe` | 一次获取截图、UI 树和节点坐标 | HDC 设备 |
| `ui_tap` | 语义定位、点击、手势、文本和按键操作 | HDC 设备 |
| `ui_flow` | 导航决策、流程录制与回放、选择器修复及异步任务 | HDC 设备、工程 |
| `verify_ui` | 最终截图、语义断言和短期画面比较 | HDC 设备 |
| `ui_inspect` | 官方窗口列表和布局树查询 | DevEco Studio/CLT、设备或模拟器 |
| `ui_control` | 官方坐标手势及 node-id/window 控制 | DevEco Studio/CLT、设备或模拟器 |
| `get_app_ui_tree` | 通过 CodeGenie 获取前台调试应用的 UI 树 | DevEco Studio、CodeGenie 后台、设备 |
| `perform_ui_action` | 兼容旧 UI 调用；本地 HDC 快速路径，部分文本操作回退 CodeGenie | HDC 设备；回退时需要 CodeGenie |

新 UI 调用优先使用 `ui_flow`、`ui_observe` 和 `ui_tap`。手势发送成功只代表设备接受事件，必要时用 `verify_ui` 检查最终界面。多设备同时在线时，按所选工具的 Schema 显式指定 `hvd`、`target` 或 `deviceId`。

## 白名单脚本

`deveco_script` 只执行注册表中的 7 个脚本，不接受任意脚本路径或 Shell 命令。

| 脚本 ID | 用途 | 额外依赖 |
|---|---|---|
| `copy_template` | 展开内置 ArkTS 工程模板并补全 SDK 元数据 | DevEco Studio/CLT |
| `detect_sdk` | 检测 API Level 和 SDK 元数据 | DevEco Studio/CLT |
| `collect_hilog` | 采集有界 Hilog 快照 | HDC 设备 |
| `fetch_faultlog` | 下载指定 faultlogger 文件 | HDC 设备 |
| `jscrash_report` | 采集或分析 JS crash，生成结构化诊断 | 采集模式需要 HDC 设备 |
| `parse_jscrash_log` | 分析本地文件或内联崩溃文本 | 无 |
| `probe_faultlogger` | 查找设备 faultlogger 条目 | HDC 设备 |

先调用 `deveco_script_catalog`，参数为 `{"script":"parse_jscrash_log"}`，获取该脚本的 `argsSchema`、`argvFlags` 和 `example`。省略 `script` 只返回摘要。也可在终端查询：

```bash
npm run scripts
npm run scripts -- parse_jscrash_log
```

随后通过 MCP 调用，例如：

```json
{
  "name": "deveco_script",
  "arguments": {
    "script": "parse_jscrash_log",
    "args": {
      "logText": "Error name: TypeError\nError message: Example crash\nStacktrace:\nat run (pages/Index.ets:12:5)"
    }
  }
}
```

`args` 使用 camelCase 字段；可替换为 `argv` 的 `--kebab-case` flag/value 数组，两者不能同时传入。未知字段、重复 flag、缺失必填项、类型或范围错误、冲突的日志来源会在启动脚本前拒绝。不接受位置参数或 `--key=value` 写法。脚本参数错误返回 `SCRIPT_ARGS_INVALID` 和目录查询提示，外层结构错误返回 `SCHEMA_VALIDATION_FAILED`。

相对路径以活动工程为基准；未选择工程时以本仓库根目录为基准。`copy_template` 的 `projectPath` 是父目录，`appName` 是新建应用目录名。设备脚本共用工具链和 `HDC_PATH` 配置；多设备场景须明确指定 `deviceId`。`probe_faultlogger` 的 `maxAgeMinutes: 0` 表示查询全部历史记录，无匹配返回 `not_found`，探测失败返回 `probe_failed`。

## 常用工作流

工程检查、构建与启动：

```text
switch_cwd → deveco_doctor → project_sync → arkts_check / code_lint
           → build_project(start/status) → start_app
```

后续代码改动可使用 `apply_changes`；工程与设备支持时，可使用常驻 `hot_reload`。这些操作仍需符合目标工程的构建和签名要求。

ArkPilot 页面导航：

```text
ui_flow(navigate, goal=目标页面)
  ├─ 精确匹配清单中的公开入口 → 直接启动
  ├─ 匹配已保存流程 → 回放
  └─ 没有可用入口或流程 → 返回 explore
       → AI 使用 ui_observe / ui_tap 探索
       → 最终断言通过后保存流程
```

公开入口从标准工程清单中发现，不要求项目预先维护路由 JSON。内部页面依靠已有流程或探索；动态 URI、业务 Want 参数和自定义路由协议需要明确提供。

录制草稿保存在内存中，最终验证成功后才写入 `.arkpilot/flows/`。回放优先使用语义选择器；只有候选唯一且最终断言成功时才持久化修复结果。Canvas、XComponent 等未出现在标准 UI 树中的控件只能使用标记为 `fragile` 的屏幕百分比步骤。流程是可复用项目资产，可通过 `ui_flow action=delete` 删除。

普通截图默认使用系统临时会话目录，内联返回后删除，未内联截图和失败诊断最长保留 10 分钟；显式提供 `localPath` 才会保留文件。成功的流程回放不截图，需要最终视觉验收时调用 `verify_ui`。更多行为、后端选择和性能边界见 [ArkPilot 架构说明](./docs/arkpilot-architecture.md)。

## 可选官方 Skill

仓库保留 DevEco Code `v0.1.11` 中的 5 个官方 Skill：`arkts-error-fixes`、`arkts-grammar-standards`、`arkts-runtime-fix`、`deveco-cli`、`deveco-create-project`。面向 DevEco Code 自身配置的 `customize-deveco` 不在分发范围内。

按用途选择安装方式：

| 安装方式 | 安装内容 |
|---|---|
| `node scripts/install.mjs --dest <目标目录>` | 官方 Skill 和清单 |
| `node scripts/install-host.mjs --host claude` | Claude 的 Skill 发现目录 |
| `node scripts/install-host.mjs --host codex` | Codex 的 Skill 发现目录 |

安装器支持 `--dry-run` 预览、`--copy` 使用副本、`--uninstall` 移除本安装器拥有的资产。默认采用符号链接，不支持创建链接的环境可选择 `--copy`。宿主安装器还接受 `--host all`。

`--profile core|full` 控制 Skill 安装范围，当前两种取值安装相同的官方 Skill 集合。

安装 Skill 不会自动注册 MCP；宿主接入约定见 [PACK.md](./PACK.md)。

## 运行和兼容性边界

- 工具列表使用本地静态表，不等待 CodeGenie 启动；后台故障不会让工具发现消失。调用仍需满足各工具的实际依赖。
- CLI、LSP、HDC、脚本和网络请求有各自的截止时间。构建、登录等长操作使用任务状态查询。
- 官方语言服务按工程延迟启动并复用。初始化中可能返回 `LSP_INITIALIZING`；空闲默认 60 秒后回收进程树，可用 `DEVECO_LSP_IDLE_MS` 在 30000～1800000 毫秒内调整。
- Node 适配层以 macOS、Windows、Linux 为兼容目标。实际功能取决于官方 SDK、HDC 和后台二进制是否支持该系统，不能据此承诺所有操作系统、所有工程都可执行全部能力。
- 工程识别不要求模块名为 `entry`；具体部署工具仍有单个 Entry HAP 等输入要求。不同工程的 SDK、产品、模块、签名和设备条件需要分别满足。
- 模板可以创建在中文或含特殊字符的目录中，但 Hvigor 实测拒绝中文及 `&` 路径。模板创建成功不等于官方构建器接受该路径。
- `verify_ui` 是本地实现；上游 `save_ui_screenshot`、`get_ui_verification_log` 未公开，不能使用本工具继续上游的持久验证会话。

## 开发和验证

```bash
npm test
npm run test:flow:unit
node --test --test-concurrency=1 test/management.test.mjs test/management-contracts.test.mjs
node --test --test-concurrency=1 test/code-tools.test.mjs test/code-tools.integration.test.mjs
```

CI 配置在 Linux 运行全量测试，在 macOS、Windows 运行管理、认证文档及代码工具专项，Node 版本矩阵为 22/24。代码工具集成测试需要官方 SDK 和 LSP 后端，未安装时明确跳过；部分模拟 HDC 用例只适用于 POSIX。CI 通过不等于对应平台真机链路通过。验证范围及限制见 [管理工具验证记录](./docs/management-tools-validation.md) 和 [代码工具修复记录](./docs/code-tools-validation.md)。

连接测试设备后可运行设备 canary；已有确定性流程时可运行指定设备的连续回放和基准：

```bash
npm run test:device
npm run test:flow:device -- --project /absolute/path/to/project --flow <flow-id> --device <device-id> --iterations 30
npm run bench:ui-flow -- --project /absolute/path/to/project --flow <flow-id> --device <device-id> --iterations 50
```

这些检查会操作测试设备。流程需要输入变量时，使用 `--variables-file /absolute/path/to/variables.json`；变量不会写回流程文件。

## 来源与许可

本仓库维护 MCP 网关、执行适配和 ArkPilot；官方组件及同步资产的来源、固定版本和许可边界分别记录在以下文件中：

- [来源与同步记录](./provenance/SOURCES.md)
- [资产清单](./provenance/INVENTORY.md)
- [DevEco Code 第三方声明](./NOTICE.deveco-code)
- [本仓库许可及适用范围](./LICENSE)

官方 Skill 的独立文件头和许可保留原样，不能将整个仓库的所有内容都视为本地原创。
