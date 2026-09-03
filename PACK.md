# HarmonyOS Capability Pack

一个宿主无关的鸿蒙开发能力包。内容提取自 DevEco Code v0.1.5（MIT），重新组织成任何 AI agent 都能自己接入的形态：
不含任何宿主适配层，不改任何宿主配置文件。机器可读清单在 [`manifest.json`](./manifest.json)。

## 三层能力

| 层 | 目录 | 是什么 |
|---|---|---|
| 知识 | `skills/` | 56 个 Skill，分两层。**core 17 个**（DevEco Code 提取，MIT）：ArkTS 语法规则、编译错误库、崩溃诊断、工程脚手架、构建循环、插桩调试、计划文档、SDD 编排，以及 ArkUI 组件最佳实践、逻辑补全、工程理解、方案设计、响应式布局、HDS 迁移、设备管理、设计稿转代码、UI 还原度评分。**extended 39 个**（华为官方 Skill 仓库 `v0.0.2`）：多设备适配、崩溃与冻屏诊断、Kit 接入、状态管理迁移、MVVM、测试、上架审查等。路由索引见 [`skills/INDEX.md`](./skills/INDEX.md) |
| 工作流 | `commands/` + `templates/` | SDD 五阶段命令 + 三份产物模板 |
| 工具 | `src/server.mjs` | 一个 stdio MCP，44 个工具（官方 Linter、冷热更新、Studio/CLT、文档、设备/UI、ArkPilot 流程、模拟器、签名、LSP） |

三层可以独立使用。只要 Skill 也行；只要 MCP 也行。但方法论 Skill（`harmony-build-loop` 等）里的指令会引用
MCP 工具名，缺了 MCP 就只剩流程说明。

## 接入

### 1. 装依赖

```bash
cd <PACK_ROOT>
npm install
npm run doctor     # 检查 DevEco Studio/CLT / HDC / ArkTS checker / Python+Pillow / LSP / 登录态
npm run doctor -- --probe-codegenie   # 额外启动 CodeGenie 子进程并报告握手耗时
```

`doctor` 与 MCP 的 `deveco_doctor` 渲染的是同一份报告（`src/doctor.mjs`），有测试守护两端一致。
默认不启动 CodeGenie 子进程（省一次 spawn）；加 `--probe-codegenie` 才探测，并会报 `handshakeMs`——
上游握手会间歇性卡死，正常约 100ms，超过 1 秒会附一条说明，这本身就是诊断信息。

需要 Node >= 22。可用 `DEVECO_CLI_STUDIO_PATH` 指向 DevEco Studio，或用 `DEVECO_CLI_CLT_PATH` 指向纯 Command Line Tools；后者覆盖 Linux/无 IDE 环境。

本包锁定 `@deveco/deveco-cli@1.3.1`；该版本要求 Node 22，并已不需要本包此前为旧 CLI 添加的
运行依赖由锁文件固定；已对存在公告的传递依赖使用 npm `overrides` 收口。依赖升级后以 `npm audit` 0 漏洞和完整测试作为门禁。

### 2. 装资产

```bash
node scripts/install.mjs --dest <目标目录>                     # 默认软链，装 core 层 17 个 Skill
node scripts/install.mjs --dest <目标目录> --profile full      # 加装 extended 层，共 56 个
node scripts/install.mjs --dest <目标目录> --copy              # 拷贝
node scripts/install.mjs --dest <目标目录> --dry-run           # 预演
node scripts/install.mjs --dest <目标目录> --uninstall
```

装完目标目录里是 `skills/` `commands/` `templates/` `manifest.json`。这个目录就是各命令里说的 `PACK_ROOT`。

**默认 profile 是 `core`**，只链 `tier: "core"` 的 17 个 Skill。两种 profile 下 `manifest.json` 都是完整的
56 条，`skills/INDEX.md` 也总会安装——宿主据此知道还有哪些没装。默认取 `core` 的两个理由：Skill 索引小
4 倍，以及 extended 层的上游**没有任何仓库级许可声明**，其中 30 个自身也没有声明，默认处于保留所有
权利状态（见「许可与来源」和 `NOTICE.harmonyos-agent-skills`）。

`--profile full` 会在 stderr 打印许可警告，但**不拦截、不改退出码**——是否再分发由你判断。

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

### 4.（可选）让宿主自动发现 Skill

前三步只让宿主能用**工具层**。Skill 要被宿主自动路由，还得进它的发现目录——这是单独一层，不装不影响前三步：

```bash
node scripts/install-host.mjs --host claude   # → ~/.claude/skills，默认 core 17 个
node scripts/install-host.mjs --host codex    # → ~/.agents/skills，默认 core 17 个
node scripts/install-host.mjs --host all --profile full   # 加装 extended，打许可警告
node scripts/install-host.mjs --host codex --print-mcp    # Codex 的 TOML 片段
```

**两个宿主都默认 core**，依据是各自官方文档写明的列表预算。实测本包描述合计：56 个 17,947 字符，core 17 个 5,561 字符（口径：SKILL.md frontmatter 的 description 字段，空白归一后计长）。

| 宿主 | 目录 | 默认 | 依据 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/skills` | core（17） | 两条限制：单个 Skill 的 `description` + `when_to_use` ≤ 1536（56 个全部合格，最长 1076）；**整个列表预算 = 上下文的 1%**，超出后从最少使用的 Skill 开始删描述。1M 上下文约 10,000 字符预算，全量 17,947 必被削 |
| Codex | `~/.agents/skills` | core（17） | 初始列表预算为上下文的 2%、未知时 8000 字符，**且含每个 Skill 的路径**；全量约 20,200 会被压缩甚至省略 Skill，core 含路径约 6,200 才安全 |

被削掉的正是让 Skill 被正确匹配的关键词，而且两个宿主都不会报错，所以这不是"装多点更好"的取舍。要在 Claude 上装全量，先用宿主侧设置抬高预算（`skillListingBudgetFraction` / `SLASH_COMMAND_TOOL_CHAR_BUDGET`），或把低价值条目用 `skillOverrides` 设成 `name-only`；安装器不替你改宿主设置。

默认软链，改仓库即时生效。**隐式调用策略**集中在 `manifest.json` 的 `invocationPolicy`，安装器按宿主渲染：
Claude 写 frontmatter `disable-model-invocation: true`，Codex 写 `agents/openai.yaml` 的
`policy.allow_implicit_invocation: false`。命中策略的 Skill（建工程、批量写产物、起模拟器、真机跑测试、
上架审查）以打过补丁的**副本**安装——因为 `skills/` 下的文件要与上游逐字节一致，有测试守护，不能改。
Codex 侧还会为用到脚本的 Skill 生成 `dependencies.tools` 声明本 MCP。

适配层按 Skill 记录归属，能和目录里其他来源的 Skill 共存；`--uninstall` 只删自己装的。

## 工具名映射

命令和 Skill 里出现的工具名分两类。**本包提供的**直接对应 MCP 工具；**宿主自备的**需要接入方映射到自己的等价能力：

| 工具名 | 来源 | 说明 |
|---|---|---|
| `project_sync` / `build_project` / `start_app` / `apply_changes` / `hot_reload` / `app_signature` | 本包 MCP | 工程同步、构建、冷热增量部署与自动签名 |
| `arkts_check` / `check_ets_files` / `code_lint` / `api_compat_check` | 本包 MCP | ArkTS 检查、官方工程级 Linter 与 API 兼容检查 |
| `harmony_docs` / `device_info` | 本包 MCP | 官方文档中心与设备详细信息 |
| `emulator_manage` / `emulator_scenario` | 本包 MCP | 模拟器、镜像、许可证与设备场景模拟 |
| `arkts_knowledge_search` | 本包 MCP | 官方知识库检索，需华为账号登录（`deveco_login`） |
| `hdc_log` | 本包 MCP | 设备日志采集/清理/列设备 |
| `ui_observe` | 本包 MCP | 一次往返同时拿截图与控件树，常规 UI 循环的入口 |
| `ui_snapshot` / `ui_find` / `ui_tap` / `ui_inspect` / `ui_control` | 本包 MCP | 设备 UI 快速通道及官方窗口/控件树高级检查与控制 |
| `lsp` 及别名 | 本包 MCP | ArkTS 语言服务，1-based 行列 |
| `deveco_script` | 本包 MCP | 调用 Skill 私有脚本（崩溃解析、faultlog、模板拷贝等） |
| `document_validate` | 本包 MCP | SDD 产物的章节结构校验，写盘后调用；只报告不阻断 |
| `spec_write` | **宿主自备** | 上游有专用产物写入工具；本包命令已改为「用宿主的写文件工具」，其附带的章节校验由 `document_validate` 顶上 |
| `question` | **宿主自备** | 向用户提问。`spec-specify` 的澄清环节依赖它 |
| `read` / `edit` / `write` / `glob` / `grep` | **宿主自备** | 常规文件与检索工具 |
| `task` | **宿主自备（可选）** | 子 agent 委派，命令单线程也能跑。`harmony-sdd-workflow` 的 Phase 4/5 在有委派能力时用它，没有时由主 agent 按同一模板执行 |

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

1. **HDC `[Fail]` 与 CLT 补丁**：`arkts-runtime-fix` 的 HDC 调用会把退出码为 0 但输出含 `[Fail]` 的情况判为失败，修上游误报；共享 HDC 解析同时支持官方 Studio/CLT 环境变量和 Linux CLT 目录。改动在 `skills/arkts-runtime-fix/scripts/shared/hdc.mjs` 及四个调用脚本。
2. **`spec-verify` 锁定 build-only**：本包不移植 UI 自动校验，所以 `Verification_Scope` 固定为 `build-only`，UI 校验相关的 Phase 1 step 3/4 与 Phase 2 已移除。`build-only` 是上游自带分支，不是新造的。`spec-tasks` 与 `tasks-template.md` 同步只发 build-only。
3. **三个方法论 Skill 是提取产物**：`harmony-build-loop` / `harmony-debug-instrumentation` / `harmony-plan-doc` 的内容来自上游 `build` / `debug` / `plan` agent 的 system prompt 尾部，不是上游的 Skill 文件。只搬了 HarmonyOS 方法论，agent 机制（`plan_write` / `plan_exit` / `debug_exit` / permission 表）没有搬。
4. **命令去掉了宿主绑定**：`agent:` frontmatter、`CONFIG_ROOT`（原 `~/.local/share/deveco/`）、`goal.txt` 编排器引用、`spec_write` 专用工具，全部改成宿主中立表述。每个文件头部有注释说明改了什么。
5. **ArkTS 检查器六处修复**：`src/upstream/arkts-check.cjs` 打了六个本地补丁，每处都有 `LOCAL PATCH` 注释。
   (a) 空文件集原本输出 `success: true` 并退出 0，让"没找到文件"和"检查通过"无法区分；现在报错退出 1。
   (b) `etsStandaloneChecker` 抛出的异常原本只塞进 `captured`，而诊断解析器匹配不上就丢弃，检查器崩溃会呈现为干净结果；现在带 `internalError` 字段返回且 `success: false`。
   (c) SDK 的 `WhiteListValidator` 读 `projectConfig.globalModulePaths`，但 ets-loader 的 `main.js` 只维护自己的模块级同名变量、从不写到 projectConfig 上，未定义时任何走到 `@since` 抑制逻辑的文件都会让检查器崩；现在按 `main.js` 的口径补齐 `<sdk>/ets/{api,arkts,kits}` 及 HMS 侧路径。
   (d) `process.stdout.write` 后立刻 `process.exit()`，管道上是异步写，结果超过 64 KiB 就被截断成非法 JSON；现在在写入回调里退出。
   (e) 诊断结果只保留被请求检查的那批文件。检查器会连带报告它传递引入的声明文件，全项目扫描因此把 SDK 自己的 `ets/arkts/@arkts.lang.d.ets` 的解析错误算进来，让一个源码干净的工程判为失败。显式传入项目外的文件时不受影响，仍照常报错。
   (f) SDK 根目录探测支持 `DEVECO_CLI_CLT_PATH`，使检查器可在 Linux/纯 Command Line Tools 环境工作。
   文件发现逻辑没有留在上游文件里：`collectEtsFiles` 只认 `entry/src/main/ets` 单模块布局，多模块工程一个文件都扫不到，改由 `src/arkts-check.mjs` 的 `discoverProjectEtsFiles` 按 `build-profile.json5` 的 `modules[].srcPath` 解析后显式传 `--files`。
6. **`detect-sdk.mjs` 补了 CLI 入口和 CLT 探测**：上游只 export 函数，而本包的脚本注册表把 `detect_sdk` 登记为可执行脚本，直接跑会 stdout 全空、退出 0，看起来像成功。现在直接运行会打印 SDK 元数据 JSON，import 用法不变；工具链路径同时支持官方 Studio/CLT 环境变量及 Linux CLT 目录。
7. **崩溃日志 `error_message` 取值修正**：`shared/jscrash-parse.mjs` 的 `detectErrorMessage` 原本返回整行且优先命中 `Error name:`（`CRASH_SIGNAL_RE` 含裸词 `error`），真实的 `Error message:` 被盖掉；无崩溃时还会回落到日志最后一行。现在优先解析显式的 `Error message:` 并只取冒号后的负载，无信号时返回 `(not found)`。
8. **CodeGenie 子进程不再能拖死整个网关，也不再拖慢工具发现**：上游子进程的 MCP 握手会间歇性永久挂死（空闲机器 12 次复现 2 次）。现在 `tools/list` 完全由静态表回答，挂死场景下实测 1ms，44 个工具照常通告；只有 3 个代理工具在调用时会连接子进程。
9. **UI 自动校验链路已移除**：见下一节。
10. **知识层是混合来源**：`arkts-error-fixes` / `arkts-grammar-standards` / `arkts-runtime-fix` / `deveco-create-project` 以发布线 v0.1.6 为基线（逐文件核对一致），另外 10 个来自尚未发版的 `0.2.0-release`。这四个不从 0.2.0 重取的理由是它们带本仓的 `LOCAL PATCH`，重取只会丢补丁——前三个在 v0.1.6 与 0.2.0 之间的 diff 本身是空的。0.2.0 只剩 `d2c` 未取（它硬依赖 `verify_ui`），原因见 `provenance/INVENTORY.md`。
11. **`build_project` / `start_app` 改为原生实现**：跟进上游 0.2.0 的方向，从 CodeGenie 代理换成通过 `@deveco/deveco-cli` 调用。参数保持向后兼容（保留 `log_path`、`module` 单值、`clean` 先清后建），`enable_inspector_source_jump` 无对应能力时显式提示而非静默忽略。`build_project` 默认以 `start` 动作立即返回任务 ID，调用方用 `status`（可长轮询 20 秒）或 `cancel` 继续，绕过 MCP 宿主独立于内部 `timeoutMs` 的 30 秒固定超时；`action: "run"` 保留同步模式。`start_app` 与 DevEco Studio 保持一致，只把选中的一个可运行模块交给 CLI；CLI 会自动收集它的非 HAR 依赖。省略 `module` 时仅在候选唯一的情况下自动选择，多候选会要求调用方明确指定，避免把两个 Entry HAP 同时安装到真机。
12. **建工程改走 `devecocli create`**：跟进上游 0.2.0——它把建工程从「拷贝内置模板」改成调 DevEco CLI，31 个模板文件随之删除。本包同样不再分发工程模板，但不复制上游那句写死的 `spawnSync('devecocli')`（它依赖 PATH 上的 shim，本包不提供），改为 `DEVECO_CLI_ENTRY` 环境变量 → `require.resolve("@deveco/deveco-cli/dist/cli.js")` → PATH 三级解析，都失败时报 `DEVECO_CLI_NOT_FOUND`。原模板目录移到 `test/fixtures/harmony-app/` 只作 ArkTS 检查器的测试夹具，不随包分发；上游那 5 个被 UTF-8 写坏的 PNG 因此与本包彻底无关。
13. **`document_validate` 独立成工具**：上游在 `spec_write` 写完产物后自动追加章节校验报告。本包用宿主的写文件工具，这个链路断了，所以把校验逻辑提取成独立 MCP 工具，由三条 SDD 命令在写盘后显式调用。保留上游「只报告不阻断」的语义，另修了两处上游报告缺陷（缺失章节一律按一级标题渲染、level-2 上限那行打的是实测值而非上限），并把上游从不读取的 `ruleId` / `suggestion` 放进结构化返回。
14. **新增 `harmony-sdd-workflow` 编排层**：见「SDD 五阶段」一节。
15. **`d2c-fast` 已随上游退场**：该 Skill 曾按宿主中立化纳入本包（产物根参数化、委派能力化、六处门禁补 fallback 等）。**上游已在 `0.2.0-release` 上整目录删除**（锁定的 `9535f0f5` 尚在，当前 HEAD 返回 404），本包于同步时一并删除，宿主中立化对照文件 `host-mapping.md` 随之移除。设计稿转代码能力现由上游的 `d2c` 承担，但本包仍不取它——理由不变，它对 `verify_ui` 有 24 处强依赖。
16. **第四提取源**：`skills/` 里 `tier: "extended"` 的 39 个来自华为官方 Skill 仓库（独立于 DevEco Code），锁定 tag `v0.0.2`。**该仓库没有仓库级许可声明**，详见「许可与来源」与 `NOTICE.harmonyos-agent-skills`。
17. **DevEco CLI 升级到 1.3.1**：Node 基线同步升至 22，旧 CLI 所需的 `axios` / `adm-zip` 强制 override 已删除，实装依赖由上游直接给出且 `npm audit` 为 **0**。新增 `project_sync`、`api_compat_check`、`apply_changes`，并给 LSP 增加 `goToDeclaration` 与独立别名；冷增量只走官方 `run --apply`，不会把多个 Entry 模块塞进一次安装。
18. **`tools/list` 静态化**：见第 8 条。3 个 CodeGenie 代理工具的 schema 落在 `src/codegenie-tools.mjs`，与子进程逐字节一致，`test/unified.test.mjs` 有漂移测试；子进程可达时不一致就红。
19. **新增可选的宿主适配层**：`scripts/install-host.mjs`，把 Skill 装进 Claude 的 `~/.claude/skills` 和 Codex 的 `~/.agents/skills`。核心资产仍然宿主无关，这一层不装也不影响任何东西。隐式调用策略集中在 `manifest.json` 的 `invocationPolicy`，由安装器按宿主渲染，**不改 `skills/` 下的任何文件**。
20. **登录凭证改为加密存储**：token 以 AES-256-GCM 密文落盘，密钥优先保存在 macOS Keychain、Windows DPAPI 或 Linux Secret Service；旧明文 `auth.json` 首次读取时自动迁移。浏览器启动也改为参数数组调用，不再把登录 URL 拼进 shell 命令。
21. **对齐 DevEco CLI 1.3.1 完整能力**：新增官方 Code Linter、常驻 Hot Reload、文档中心、设备详情、高级 UI、模拟器完整管理/场景、签名及 CLI auth/team；工具链解析与官方源码保持同一优先级，并支持 `DEVECO_CLI_CLT_PATH` 和 Linux CLT 布局。
22. **通用 MCP 稳定性与安全收口**：44 个工具在分派前执行 JSON Schema 校验；耗时构建和浏览器登录提供短调用任务协议，避免宿主固定 30 秒超时；LSP、CLI、HDC、脚本、凭证提供程序和网络请求均有截止时间及进程树清理。CLI/脚本输出采用有界内存并将完整构建记录流式落盘，避免巨量输出拖垮网关。`apply_changes` 在停止应用前锁定唯一 Entry 模块，失败后尽力恢复同一应用。`ui_snapshot`/`ui_observe` 默认不覆盖已有路径；`ui_tap` 在 UI 树缺失自绘控件时支持屏幕百分比手势，并明确区分“命令已接收”和“界面结果已验证”。`ui_flow` 将成功的 UI 操作保存为项目内 `.arkpilot` 语义流程，回放时只在失败路径截图。npm 包用 `files` 白名单控制发布内容，当前审计为 0 漏洞。
23. **ArkPilot Flow 独立限界上下文**：`src/arkpilot/` 按领域、应用、基础设施和接口边界组织，保持既有工具的行为不变。流程仓库使用版本化 JSON、原子替换、写锁及路径/符号链接逃逸检查；执行器为每个任务设置单调用、单步骤和总截止时间，整段回放只持有一次跨进程设备租约。同设备并发立即返回 `UI_DEVICE_BUSY`，不同设备可独立执行。默认发布后端仍是实测的 HDC/uitest；Hypium 仅保留动态端口，在真机和模拟器正确率及延迟门禁通过前不会启用。

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
参数，不依赖任何校验任务 id，可以独立落盘。`arkui-scoring-workflow` 的评分流程用的就是它。

**另有一条不经子进程的快速通道。** `ui_snapshot` / `ui_find` / `ui_tap` 覆盖同一条「截图 → 找控件 →
点击」循环，由 `src/device-ui.mjs` 直接经 hdc 实现。上面那两个代理工具**未作任何改动**，两套并存，
按需选用。实测差异：截图 `snapshot_display` 出 JPEG 是 0.42s / 约 260KB，`uitest screenCap` 出 PNG 是
1.05s / 5.2MB；坐标由 `uitest dumpLayout` 的 `$rect` 直接给出，不必从截图上估（一次实测估值偏了 40px）。树结果被 `limit` 截断时仍返回屏幕内组件类型计数和继续查询提示；Slider 等矩形控件可由 `ui_tap` 按 `type` / `text` / `key` 定位，再用 `from_percent` / `to_percent` 生成节点内手势并默认复查值变化。自绘控件未进入 UI 树时，可改用 `from_x_percent` / `from_y_percent` / `to_x_percent` / `to_y_percent` 映射当前屏幕尺寸。纯坐标和屏幕百分比手势只报告设备接受了命令，不再暗示界面一定改变。
更关键的是这三个不经 CodeGenie 子进程，所以子进程挂死时整条循环依然可用——而代理的那两个不是。
取舍与实测数据见 `provenance/INVENTORY.md` 的「设备 UI 快速通道」。

`ui-reconstruction-score` 提供的是**另一种东西**：`scripts/ui_score.py` 只依赖 Pillow 和标准库，
零网络零模型调用，产出的是确定性像素指标（SSIM、边带差异、区域热力图）。它与被禁用的 `verify_ui`
不是同类——后者需要多模态模型判图，前者不需要。它需要的 Pillow 常常不在系统 python3 上，
`deveco_doctor` 会报告本机的 python 与 Pillow 状态。

要用 UI 自动校验就自己接一个多模态模型，并把 `DISABLED_CODEGENIE_TOOLS`（`src/server.mjs`）清空、
把 `UI_VERIFY_*` 的透传加回 `src/codegenie-client.mjs`。

## 许可与来源

**core 层（17 个 Skill、命令、模板、`src/`）**：上游 DevEco Code 为 MIT，其中华为工具与脚本文件保留各自的
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
