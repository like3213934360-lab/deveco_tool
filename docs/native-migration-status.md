# 原生 TypeScript 迁移执行记录

更新日期：2026-09-08。当前处于开发与验收阶段，尚未切换默认入口或发布重构版本。开发分支用于跨平台 CI，最终发布仍受下列门槛约束。

基线提交：`aab1405b51e00e4036bdc8f18ae4229835de77b0`。开发分支：`codex/native-typescript-runtime`。

## 已落地的运行结构

`src/cli.ts` → `src/server.ts` → `src/worker.ts` → `src/services/runtime.ts`。

MCP 主进程提供静态工具目录和参数校验；Worker 持有领域服务，按需加载 LangGraph。运行状态、操作回执、资源租约、制品和过程观测使用 SQLite。工作流采用官方 SQLite Checkpointer，`run_id` 对应 `thread_id`。

- TypeScript 6.0.3、严格模式、NodeNext、ESM；`allowJs: false`。新增的自有运行代码、测试和开发脚本均为 TypeScript。
- LangGraph 1.4.14、SQLite Checkpointer 1.0.4、MCP SDK 1.30.0、Zod 4.4.3 已锁定。
- 新运行代码不启动官方 CLI 或 CodeGenie 子 MCP。Hvigor watch 直接使用所选 SDK 的 worker 协议，拥有自己的进程组，不启动或终止共享 SDK master/Java 守护进程。
- 25 个公开 MCP 工具、8 个工作流已注册；这表示接口与实现已存在，不等于每项能力已完成真实环境验收。
- 项目、产品、设备和输入在任务提交时固定。重复请求键会去重，不同输入会冲突。默认工程选择与产品选择分别处理，doctor 与业务请求共享当前工程，切换不改变在途任务；见 `docs/native-project-context.md`。
- 工具链身份包含 SDK/组件包版本摘要和可执行入口的文件标识。同一 Studio 路径内更新 SDK 会阻止旧任务继续恢复，也会使 LSP 新请求使用新的会话缓存身份；入口文件标识不是对整个 SDK 的密码学签名验证。
- 已发生但未获得可靠回执的副作用进入 `needs_input`，只允许声明的 `recheck` 输入。安装与启动已拆为两个检查点，启动结果不明时不重复安装。
- 已保存的 `.arkpilot/flows` 继续由新 UI 服务读取。替代选择器必须通过原有最终断言后才能保存。
- `ui_flow.routes/navigate` 直接读取所选产品的模块与公开 Ability，支持 Action、URI/MIME 和类型明确的 Want 参数。导航与保存流程执行持久化为内部任务，通过 `workflow_run` 查询、恢复和取消；公开工作流目录仍为 8 个。流程内容与应用配置在提交时固定。
- 目标导航支持中文流程名称匹配，并在公开入口、同名流程、产品/模块不匹配时明确处理歧义；未知目标自动进入录制尚未实现。
- `ui_flow.record_start/status/stop/cancel` 使用内部 LangGraph 任务和加密 SQLite 草稿，记录回执与输入占位变量；最终断言固定后验证，通过才保存。取消传递给在途操作，关闭运行时会等待录制操作退出。未完成录制不被历史任务清理。详见 `docs/native-ui-workflows.md`。
- 热重载基线安装和补丁应用在设备租约内重新核对持久化录制，拒绝打断同一设备的未完成录制；跨 Node 进程的构建期间竞争、拒绝后清理和其他设备隔离已通过回归。该约束适用于共享状态目录的原生 MCP，不控制手工操作或其他软件。
- UI 快照复用按需构造的索引；录制、流程定位与点击使用同一份操作前快照，避免二次 dump，操作后失效。动作与断言备选选择器的歧义判断不受 `limit:1` 绕过。显示器与窗口共同决定可见范围，截图仍不作为业务成功证据。
- `hdc_log` 支持收集、整行字面量筛选、清空默认 app/core buffer、故障记录探测及按原名读取。筛选使用设备端管道，分别核对生产进程退出结果；故障时间筛选使用设备时钟和时区，不回退到其他应用或过期记录。
- 崩溃解析按事件和进程组织证据，区分普通日志、其他进程错误、截断和无法归属的记录。文件、制品或内联证据在提交时转为任务拥有的制品，和任务创建一起绑定；检查点及任务输入只保留引用。Hilog 崩溃采集不要求应用进程仍存活。
- 制品分页读取与清理使用同一套 SQLite 写事务协调；短读继续读取，长度不匹配明确失败。清理先提交引用删除，再通过持久化删除记录清除文件，失败后重试。
- UI/崩溃/Linter/静态诊断大文本使用按需启动的 CPU Worker 池：最多 2 个 Worker、16 个排队任务、64 MiB 输入记账预算，空闲 30 秒释放；取消与超时等待 Worker 退出后才完成。普通小查询仍在运行服务中执行。VM 堆限制不是进程 RSS 硬上限。
- UI 快照缓存最多 8 份、64 MiB 估算预算，有实际到期定时器。批量选择器在同一份树上查询，真实匹配总数不被输出 `limit` 改写；父节点和深度参与结构摘要，层级变化不再被漏报。窗口、显示器、深度与分页检查使用完整快照的父节点索引。
- 部署提交时把 HAP/HSP 复制为任务拥有的只读制品，固定大小和 SHA-256，等待设备租约后再次核对。普通工程重建不会替换已提交的安装输入；多个包通过一次设备端安装提交，捕获失败和并发重复提交释放未绑定副本。详见 `docs/native-deployment.md`。
- ArkTS LSP 增加查找实现，检查初始化能力声明和 UTF-16 编码，校验真实发送内容的行列范围。文件读取、摘要和通知使用同一批字节；无结果、能力不可用、非法响应有不同处理。详见 `docs/native-language-service.md`。
- TypeScript 编译使用完整临时输出目录；错误不覆盖上一次完整构建，成功后整体替换并删除失效输出。`native-stage.ts` 可在安装依赖前准备只含原生架构的私有验证目录。
- `ui_snapshot` 默认只截图，支持 JPEG/PNG、宽度、显示器和画面变化比较；树用 `mode:tree/both` 显式获取。传输前预留额度，按块校验，未变化的画面不保存重复制品。详见 `docs/native-screenshots.md`。
- 执行协议更新为 `native-3`，部署状态保存包集合、进程记录保存 Windows Job 身份；不读取旧开发状态。Windows 取消等待受管进程同步句柄和 Job 活动数，失败启动会话也确认后代清理；Windows Node 22/24 各连续 20 轮压力验收通过；实际 Windows SDK 仍需单独验证。详见 `docs/native-process-ownership.md`。

- 原生 SDK 临时目录与 LSP 日志通过 SQLite 预留统一预算，关联受管进程所有权；超额取消后确认进程退出才清理。外部 SDK 的突发写入不是 OS 硬配额，详见 `docs/native-storage.md`。

## 能力与验收缺口

| 能力 | 新实现 | 当前证据与待补项 |
| --- | --- | --- |
| 工具链探测、工程模板 | `core/toolchain.ts`、`services/project.ts`、`resources/templates` | 本机 Studio/API 26 创建与构建通过；其他平台、CLT 布局及更广版本范围待验收 |
| OHPM、同步、Hvigor 构建 | `services/project.ts` | 真实同步、ArkTS/C++ 构建、输出模型通过；四模块、双产品、HAR/HSP、默认任务筛选和实际包依赖补全共 15 项通过；更多历史制品场景待验收 |
| ArkTS LSP、clangd、静态预检 | `services/lsp.ts`、`checker.ts`、`compilation-database.ts` | 真实悬停、引用、错误诊断、C++ 检查通过；静态预检不作为编译通过的替代证明 |
| Linter、API 扫描 | `services/diagnostics.ts` | 真实 Linter 指定文件/配置、发现缺陷、增量、显式修复后复查和拒绝坏配置 6 项通过；API 兼容性问题和无差异扫描通过。Linter 空报告不证明全部规则执行，详见 `docs/native-linter.md` |
| HDC、部署、启动 | `services/device.ts`、`package.ts` | HAP 元数据在真实构建产物上通过；丢失启动回执的恢复回归通过。专用个人签名包真实安装/启动通过；多包签名部署及可核实的外部恢复证据仍未齐全 |
| UI、中文输入、保存流程与录制 | `services/device.ts`、`text.ts`、`flow.ts`、`recording.ts` | 重启恢复、原断言约束、丢失回执、取消、关闭、保留期限与设备竞争回归通过；真实设备 UI 读取和窗口断言通过，专用应用中文输入、最终断言及 MCP 重启后的完整录制/重放 16 项通过，见 `docs/native-signing.md` |
| 公开入口、目标导航与 Want | `services/routes.ts`、`navigation.ts`、`runtime.ts` | 产品/模块/公开性、URI/MIME、中文目标匹配、歧义、Want 类型和任务恢复回归通过；实际设备导航与未匹配目标自动录制待完成 |
| 日志与崩溃 | `services/logs.ts`、`crash.ts` | 命名故障记录、设备时间筛选、整行过滤、权限、截断、多进程事件和提交时证据保存的回归通过；真实设备 tail/无匹配字面量筛选、故障查询的部分权限失败已验证；实际故障文件读取、过滤性能门槛与应用栈帧排序待验收 |
| 热重载 | `services/hotreload.ts`、`services/hvigor` | SDK watch 基线、同一 worker 两次生成不同 ABC、停止与配置恢复通过；个人签名基线及两次 HQF 真机应用通过，PID 不变、两次按钮文字断言通过，停止和源码恢复通过；更多模块/设备场景待验收 |
| 本地和云端签名 | `services/signature.ts`、`auth.ts` | 真实密钥/CSR、Chrome 开发者认证、团队及证书/设备清单、两种重启后的认证保持通过；POST 回调、浏览器结果页和设备总数字段修复后复验。个人团队云端证书、调试 Profile、签名安装及原生工程配置生成通过；过期刷新、更多签名类型与外部恢复待验收，见 `docs/native-signing.md` |
| 模拟器与场景 | `services/emulator.ts` | 本机创建、启动、保持运行、场景命令、停止、删除通过；场景命令接受不等于应用感知结果已验证 |
| 文档与知识 | `services/knowledge.ts`、`resources/knowledge.json` | 119 个资源、79 条知识、4 个来源的摘要与许可证校验通过；本地查询直接打开发布资源数据库，无每版本状态目录解压副本；六目录筛选、中文检索与稳定分页通过，详见 `docs/native-knowledge.md` |
| 上游更新 | `scripts/upstream.ts`、`provenance/upstream-*` | 检测、分类、报告摘要核对、草稿 PR 幂等创建、CI 调度、候选评审阻断和框架/官方升级分离已实现；模拟 GitHub 故障恢复测试通过，真实草稿 PR #1、重复调用去重和候选评审阻断通过；定时身份权限、人工适配与正式发布门禁待验收 |

## 本机验证记录

以下路径是开发机原始证据位置，不会随 Release 提供。较早证据未记录源码摘要，不能用于证明后来修改过的实现。新的验收脚本在开始执行前记录编译文件、锁文件、资源与上游锁摘要；资源摘要会逐文件验证。

| 检查 | 结果 | 范围与原始证据 |
| --- | --- | --- |
| 编译及回归 | 217 项通过，0 跳过 | `/private/tmp/deveco-native-regression-node26-20260908-36/evidence.json`；154 个 TypeScript 文件，含默认工程/产品、在途任务隔离、服务制品归属、状态库初始化事务、Unicode 路径模板复制及复制取消验证。含工程切换的本机压力检查 20 轮通过，见 `docs/native-storage.md`；本机证据不代替 Windows 验证 |
| Node 22/24 干净原生验证目录 | 六组全部通过 | [CI 34169432690](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34169432690)，提交 `2ac0811`，macOS/Windows/Linux × Node 22/24 各 217 项通过、0 跳过，Windows 各 20 轮压力通过，六组安装检查通过。Windows Node 22 的中文路径复制修复已复验；原始证据及失败定位见 `docs/native-project-context.md`。历史恢复压力超时证据仍保留，本次成功不构成全部性能门槛证明 |
| 迁移清单 | 40 工具、7 脚本、330 参数、95 动作覆盖检查通过 | `provenance/baseline-capabilities.json`、`provenance/migration-matrix.json`；文档、重启、默认工程切换和 ArkTS 静态预检 4 项完成行为验收，43 项仍为 pending，`native-migration-audit --release` 会阻止发布 |
| 真实 SDK | 19 项通过 | `/private/tmp/deveco-native-sdk-node24-20260908-1/evidence.json`；Node 24 干净原生目录、Studio 26.0.0.821、SDK 26.0.0.105，包含最新异步模板复制；创建/构建、HAP、静态预检、Linter、ArkTS 四种查询及空结果/位置边界、C++、API 版本和扫描、本地密钥/CSR、模拟器列表通过，不包含签名安装/热补丁 |
| 真实 ArkTS 静态预检 | 13 项通过 | `/private/tmp/deveco-native-checker-node24-20260908-2/evidence.json`；Node 24 无旧依赖独立目录在最新代码上复查，包含制品归属改动；扫描范围、HMS、路由、资源 AST、API 版本、并发缓存、模型版本、绑定、700 条完整报告和中文模块；边界与保留的历史证据见 `docs/native-static-checker.md` |
| 真实 Linter | 6 项通过 | `/private/tmp/deveco-native-lint-20260908-4/evidence.json`；独立 canary 工程，没有构建、签名或设备操作。前两轮失败记录保留，范围及原因见 Linter 文档 |
| 真实多模块 SDK | 15 项通过 | `/private/tmp/deveco-native-multimodule-20260908-3/evidence.json`；entry/feature/HAR/HSP、default/tablet 两产品，含默认构建模块筛选与编译元数据驱动的 HSP 依赖构建；未签名、未安装设备 |
| 真实设备只读验证 | 13 项通过 | `/private/tmp/deveco-native-device-readonly-20260908-7/evidence.json`；Node 24 原生独立目录，新增保存树文件/制品查询，包含批量查询、缓存 ID 复用、窗口/层级分页、设备属性、UI 断言、Hilog、故障查询及关闭。故障目录权限不足，返回 `complete:false`，不能计为完整故障采集证明；没有点击、安装或业务路径验证 |
| 真实 Hvigor watch | 7 项通过 | `/private/tmp/deveco-native-hvigor-20260907-4/evidence.json`；未验证签名和设备热补丁 |
| 真实模拟器只读协议 | 7 项通过 | `/private/tmp/deveco-native-emulator-readonly-20260908-1/evidence.json`；当前组件清单、镜像、两份协议全文/摘要、旧摘要拒绝及原生配置字节/mtime 不变；没有接受协议或操作实例，副作用探测记录见 `docs/native-emulator.md` |
| Chrome 双 provider 认证 | 开发者、知识服务各 9 项通过；另一次已有凭据复查 9 项通过 | 通过真实 MCP 接口执行，开发者读取三个团队清单，CodeGenie 执行云端查询，两种重启后复查成功；同一最终运行摘要在 Node 24/26 各 220 项回归通过，见 `docs/native-authentication.md`。本次模拟器只读 7 项复查证据保存在持久目录 `~/Library/Application Support/DevEcoMCP/acceptance/20260908-emulator-readonly-1`；以前临时目录目前不可用，不据此补造历史证据 |
| 认证修复三平台 CI | 六组各 220 项通过、0 跳过 | [CI 34176653392](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34176653392)，提交 `8ec532b`；各 10 项干净编译包安装检查通过，Windows Node 22/24 各 20 轮压力通过。六组原始证据已下载核对，运行文件摘要与本机浏览器通过版本相同，见 `docs/native-authentication.md` |
| 云端知识完整制品 | 10 项通过 | 已保存凭据、真实查询、完整字节分页、两种重启后读取原制品并核对摘要；见 `docs/native-knowledge.md`。未把两次独立查询的不同内容误判为持久化失败 |
| 个人签名与真机操作 | 云端签名部署、UI 16 项、热补丁 10 项通过 | 专用个人团队材料、直接 SDK/HDC、原生加密工程签名配置、MCP 重启后流程重放、连续两次 HQF 和 PID 保持；本轮回归 226 项通过。具体源码摘要、失败记录、清理边界和待验收项见 `docs/native-signing.md` |
| 独立签名工程准备 | 6 项通过 | 创建、构建、未签名 HAP 身份、密钥、CSR 与关闭；未操作云端或设备，详见 `docs/native-signing.md` |
| 真实模拟器 | 6 项通过 | `/private/tmp/deveco-native-emulator-20260907-1/evidence.json`；早期代码快照，未记录源码摘要 |
| 一小时基础设施运行 | 通过 | `/private/tmp/deveco-native-soak-20260907-2/evidence.json`；352 轮、2816 个子进程；最终活动任务/子进程/租约为 0，RSS 95,600,640 字节。只使用合成子进程，且早于最新制品与会话修改，不能算最终版本或 SDK 会话长稳验收 |
| 一小时真实 SDK 会话 | 通过 | `/private/tmp/deveco-native-sdk-soak-node24-20260908-1/evidence.json`；Node 24 原生独立验证目录、717 次 LSP 查询、60 次不同 ABC 补丁，同一 watch worker，最终会话/临时目录为 0，配置恢复成功，运行时 RSS 107,511,808 字节。基于记录的较早编译摘要，未包含后续 Linter/文档修改；未测 SDK 子进程 CPU/RSS、设备 HQF/UI 或空闲会话过期，不能当作完整最终性能验收 |
| MCP 目录性能 | 30 次冷启动、1000 次热查询 | `/tmp/deveco-native-benchmark-20260907-optimized.json`；基线/新版冷 P95 为 153.48/101.92 ms，热 P95 为 0.346/0.263 ms。只测目录，不代表其他工具性能；早期快照 |
| UI 树算法性能 | 已有小/中/大树测量，完整门槛未通过 | `/private/tmp/deveco-native-ui-benchmark-20260908-1.json`；100/1000/10000 个控件，每种查询 1000 次，晚于文本/矩形优化，早于父子层级字段。精确定位、类型查询改善；部分包含文本查询仍有开销。结果形式不同，不能充当直接能力 P95 发布门槛 |
| 保存树完整 MCP 精确查询 | 本机 Node 22/24 各三轮通过 5% 门槛 | 每种树规模每轮 1000 次固定查询；修复重复解析导致的退化，保留首次请求成本与原始失败证据。仅覆盖离线精确 key 查询，详见 `docs/native-ui-performance.md`，不代表实时设备、其他选择器或服务器/SDK CPU/RSS 已验收 |

## 尚未通过的发布门槛

Windows 压力测试已暴露并保留三类失败证据：SQLite 初始化失败未关闭句柄、进程退出确认早于文件映射释放、失败会话留下进程登记。当前代码分别修复初始化清理、等待同步句柄和失败会话强制清理，提交 `7bed2ef` 的新一轮 Windows Node 22/24 各 20 轮全部通过，历史失败证据仍保留。该证据只覆盖受管测试进程，不代替真实 Windows SDK 验收。后续 CI `34160484334` 的 macOS/Linux 四组通过，Windows 两组因 8.3 短路径断言各失败两项；已统一生产与测试的原生路径规范化，后续 CI `34161610703` 六组全通过，Windows 两组也各通过 20 轮压力检查。

1. 完成冻结清单中逐个旧工具、参数、动作和历史缺陷的行为验收。覆盖审计会拦截漏项、重复项及没有证据的 verified 标记；当前的代码和测试位置映射不等于完整验收。
2. 专用个人团队签名部署、两次设备热补丁、中文输入和持久化录制/重放已通过。继续完成多产品、多模块的签名包集合设备验收及更广设备场景。
3. 完成副作用外部状态核对。当前无法证明已执行结果时会停在 `needs_input`；不得把这种保守停止写成恢复能力全部完成。
4. Windows Job Object 进程所有权与退出确认已通过六组 CI 和 Windows 连续压力检查；继续完成 SDK 和性能验证。`taskkill` 已从原生实现删除；macOS 通过不能代替 Windows 证明。
5. Checkpointer、制品、流、数据库、原生工具临时目录与 LSP 日志已有预算控制；继续完成真实长时间运行的容量验收。外部 SDK 的突发写入不是操作系统硬配额，不能宣称所有物理磁盘写入始终满足统一上限。
6. CPU UI/崩溃/Linter 解析池已通过边界回归；继续完成其他大报告路径、会话协调与最终性能优化，在固定工程和空闲机器上执行完整直接能力对比，以及最终代码的一小时 SDK/LSP/UI/watch 会话验收。
7. 完成 Node 22/24 × macOS/Windows/Linux 的基础运行矩阵，逐项记录 SDK/设备支持范围。
8. 上游候选、草稿 PR 和 CI 门禁的代码与模拟验证已完成；真实候选 PR #1 和去重已完成，继续完成定时身份权限、人工适配证据和正式发布门禁。
9. 最终切换 `package.json` 的 bin/scripts/files，删除 84 个旧 `.mjs/.cjs` 文件、官方 CLI/子 MCP 依赖、旧 Skill/安装器、代理、补丁、旧工具别名和旧 CI；同步重写 README/PACK/NOTICE。当前仍保留它们作迁移对照，默认启动入口仍是旧实现。
10. 完成干净 Release 安装、用户配置升级、凭据重新登录、用户流程校验、按安装记录清理本项目安装过的 Skill，以及完整版本回退验证。
11. 开发分支可提前推送以执行跨平台 CI；全部门槛通过后才合入最终切换并发布候选与正式版本。不得根据当前本机回归通过直接发布。

## 复现命令

在仓库目录运行，使用全新的证据路径；真实 SDK 脚本会创建专用验收工程，模拟器脚本会创建并清理专用实例。

```sh
npm run build
npm run test:native
node dist/scripts/native-regression.js /absolute/new-regression-evidence
node dist/scripts/native-migration-audit.js
node dist/scripts/native-migration-audit.js --release
node dist/scripts/resources.js
node dist/scripts/native-device-readonly.js /absolute/new-device-evidence device-id
node dist/scripts/native-sdk-acceptance.js /absolute/new-sdk-evidence
node dist/scripts/native-lint-acceptance.js /absolute/new-lint-evidence
node dist/scripts/native-checker-acceptance.js /absolute/new-checker-evidence
node dist/scripts/native-multimodule-acceptance.js /absolute/new-module-evidence
node dist/scripts/native-hvigor-acceptance.js /absolute/new-watch-evidence
node dist/scripts/native-emulator-acceptance.js /absolute/new-emulator-evidence
node dist/scripts/native-emulator-readonly.js /absolute/new-emulator-readonly-evidence
node --expose-gc dist/scripts/native-sdk-soak.js /absolute/new-sdk-soak-evidence 3600
node --expose-gc dist/scripts/native-soak.js /absolute/new-soak-evidence 3600
node --expose-gc dist/scripts/native-ui-benchmark.js /absolute/baseline-checkout /absolute/new-ui-report.json
node dist/scripts/native-ui-mcp-benchmark.js /absolute/baseline-checkout /absolute/new-ui-mcp-evidence 3
node dist/scripts/native-benchmark.js /absolute/baseline-checkout /absolute/new-catalog-report.json
```

使用 Node 22/24 时必须在对应环境安装 SQLite 原生依赖，不能直接使用另一 Node ABI 编译的 `node_modules`。验收必须记录实际 SDK、设备、源码与锁文件，不以语言迁移本身证明性能改善。

日志协议对照：[OpenHarmony Hilog 文档](https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/dfx/hilog.md)。`-e` 仅筛选消息内容，整行 `contains` 使用 `grep -F`；`-r` 的默认范围是 app/core buffer。新实现未继承旧组件参数回退分支。
