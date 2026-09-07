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
- 项目、产品、设备和输入在任务提交时固定。重复请求键会去重，不同输入会冲突。
- 工具链身份包含 SDK/组件包版本摘要和可执行入口的文件标识。同一 Studio 路径内更新 SDK 会阻止旧任务继续恢复，也会使 LSP 新请求使用新的会话缓存身份；入口文件标识不是对整个 SDK 的密码学签名验证。
- 已发生但未获得可靠回执的副作用进入 `needs_input`，只允许声明的 `recheck` 输入。安装与启动已拆为两个检查点，启动结果不明时不重复安装。
- 已保存的 `.arkpilot/flows` 继续由新 UI 服务读取。替代选择器必须通过原有最终断言后才能保存。
- `ui_flow.routes/navigate` 直接读取所选产品的模块与公开 Ability，支持 Action、URI/MIME 和类型明确的 Want 参数。导航与保存流程执行持久化为内部任务，通过 `workflow_run` 查询、恢复和取消；公开工作流目录仍为 8 个。流程内容与应用配置在提交时固定。
- 目标导航支持中文流程名称匹配，并在公开入口、同名流程、产品/模块不匹配时明确处理歧义；未知目标自动进入录制尚未实现。
- `ui_flow.record_start/status/stop/cancel` 使用内部 LangGraph 任务和加密 SQLite 草稿，记录回执与输入占位变量；最终断言固定后验证，通过才保存。取消传递给在途操作，关闭运行时会等待录制操作退出。未完成录制不被历史任务清理。详见 `docs/native-ui-workflows.md`。
- UI 快照复用按需构造的索引；录制、流程定位与点击使用同一份操作前快照，避免二次 dump，操作后失效。动作与断言备选选择器的歧义判断不受 `limit:1` 绕过。显示器与窗口共同决定可见范围，截图仍不作为业务成功证据。
- `hdc_log` 支持收集、整行字面量筛选、清空默认 app/core buffer、故障记录探测及按原名读取。筛选使用设备端管道，分别核对生产进程退出结果；故障时间筛选使用设备时钟和时区，不回退到其他应用或过期记录。
- 崩溃解析按事件和进程组织证据，区分普通日志、其他进程错误、截断和无法归属的记录。文件、制品或内联证据在提交时转为任务拥有的制品，和任务创建一起绑定；检查点及任务输入只保留引用。Hilog 崩溃采集不要求应用进程仍存活。
- 制品分页读取与清理使用同一套 SQLite 写事务协调；短读继续读取，长度不匹配明确失败。清理先提交引用删除，再通过持久化删除记录清除文件，失败后重试。
- UI/崩溃大文本使用按需启动的 CPU Worker 池：最多 2 个 Worker、16 个排队任务、64 MiB 输入记账预算，空闲 30 秒释放；取消与超时等待 Worker 退出后才完成。普通小查询仍在运行服务中执行。VM 堆限制不是进程 RSS 硬上限。
- UI 快照缓存最多 8 份、64 MiB 估算预算，有实际到期定时器。批量选择器在同一份树上查询，真实匹配总数不被输出 `limit` 改写；父节点和深度参与结构摘要，层级变化不再被漏报。窗口、显示器、深度与分页检查使用完整快照的父节点索引。
- 部署提交时把 HAP/HSP 复制为任务拥有的只读制品，固定大小和 SHA-256，等待设备租约后再次核对。普通工程重建不会替换已提交的安装输入；多个包通过一次设备端安装提交，捕获失败和并发重复提交释放未绑定副本。详见 `docs/native-deployment.md`。
- ArkTS LSP 增加查找实现，检查初始化能力声明和 UTF-16 编码，校验真实发送内容的行列范围。文件读取、摘要和通知使用同一批字节；无结果、能力不可用、非法响应有不同处理。详见 `docs/native-language-service.md`。
- TypeScript 编译使用完整临时输出目录；错误不覆盖上一次完整构建，成功后整体替换并删除失效输出。`native-stage.ts` 可在安装依赖前准备只含原生架构的私有验证目录。
- `ui_snapshot` 默认只截图，支持 JPEG/PNG、宽度、显示器和画面变化比较；树用 `mode:tree/both` 显式获取。传输前预留额度，按块校验，未变化的画面不保存重复制品。详见 `docs/native-screenshots.md`。
- 执行协议更新为 `native-3`，部署状态保存包集合、进程记录保存 Windows Job 身份；不读取旧开发状态。Windows 取消等待受管进程同步句柄和 Job 活动数，失败启动会话也确认后代清理；持续压力验收仍在进行。详见 `docs/native-process-ownership.md`。

## 能力与验收缺口

| 能力 | 新实现 | 当前证据与待补项 |
| --- | --- | --- |
| 工具链探测、工程模板 | `core/toolchain.ts`、`services/project.ts`、`resources/templates` | 本机 Studio/API 26 创建与构建通过；其他平台、CLT 布局及更广版本范围待验收 |
| OHPM、同步、Hvigor 构建 | `services/project.ts` | 真实同步、ArkTS/C++ 构建、输出模型通过；四模块、双产品、HAR/HSP、默认任务筛选和实际包依赖补全共 15 项通过；更多历史制品场景待验收 |
| ArkTS LSP、clangd、静态预检 | `services/lsp.ts`、`checker.ts`、`compilation-database.ts` | 真实悬停、引用、错误诊断、C++ 检查通过；静态预检不作为编译通过的替代证明 |
| Linter、API 扫描 | `services/diagnostics.ts` | 真实空报告、兼容性问题和无差异扫描通过；更多 API/组件组合待验证 |
| HDC、部署、启动 | `services/device.ts`、`package.ts` | HAP 元数据在真实构建产物上通过；丢失启动回执的恢复回归通过。真实签名安装/启动及可核实的外部恢复证据未齐全 |
| UI、中文输入、保存流程与录制 | `services/device.ts`、`text.ts`、`flow.ts`、`recording.ts` | 重启恢复、原断言约束、丢失回执、取消、关闭、保留期限与设备竞争回归通过；真实设备 UI 读取和窗口断言通过，中文输入与完整录制/重放待验收 |
| 公开入口、目标导航与 Want | `services/routes.ts`、`navigation.ts`、`runtime.ts` | 产品/模块/公开性、URI/MIME、中文目标匹配、歧义、Want 类型和任务恢复回归通过；实际设备导航与未匹配目标自动录制待完成 |
| 日志与崩溃 | `services/logs.ts`、`crash.ts` | 命名故障记录、设备时间筛选、整行过滤、权限、截断、多进程事件和提交时证据保存的回归通过；真实设备 tail/无匹配字面量筛选、故障查询的部分权限失败已验证；实际故障文件读取、过滤性能门槛与应用栈帧排序待验收 |
| 热重载 | `services/hotreload.ts`、`services/hvigor` | SDK watch 基线、同一 worker 两次生成不同 ABC、停止与配置恢复通过；签名 HQF、设备应用及运行效果未通过完整验收 |
| 本地和云端签名 | `services/signature.ts`、`auth.ts` | 真实密钥与 CSR 生成通过；证书/Profile/团队、云端认证和完整签名安装待验收 |
| 模拟器与场景 | `services/emulator.ts` | 本机创建、启动、保持运行、场景命令、停止、删除通过；场景命令接受不等于应用感知结果已验证 |
| 文档与知识 | `services/knowledge.ts`、`resources/knowledge.json` | 119 个资源、79 条知识、4 个来源的摘要与许可证校验通过；本地查询直接打开发布资源数据库，无每版本状态目录解压副本 |
| 上游更新 | `scripts/upstream.ts`、`provenance/upstream-*` | 检测、分类、报告摘要核对、草稿 PR 幂等创建、CI 调度、候选评审阻断和框架/官方升级分离已实现；模拟 GitHub 故障恢复测试通过，真实远程候选集成与正式发布门禁待验收 |

## 本机验证记录

以下路径是开发机原始证据位置，不会随 Release 提供。较早证据未记录源码摘要，不能用于证明后来修改过的实现。新的验收脚本在开始执行前记录编译文件、锁文件、资源与上游锁摘要；资源摘要会逐文件验证。

| 检查 | 结果 | 范围与原始证据 |
| --- | --- | --- |
| 编译及回归 | 158 项通过，0 跳过 | `/private/tmp/deveco-native-regression-node26-20260908-12/evidence.json`；Node 26.0.0，120 个 TypeScript 文件，包含单包/多包部署、并发去重副本释放和 Windows 失败会话退出路径修复；本机不能证明 Windows 行为 |
| Node 22/24 干净原生验证目录 | 最近 CI 六组全量回归通过，Windows 压力门槛尚未全部通过 | [CI 34154538553](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34154538553)，提交 `8dd3239`；Windows Node 24 为 20/20 轮通过，Node 22 第 16 轮失败会话登记未释放。后续修复在本机验证后推送重查；此 CI 早于包集合改动 |
| 迁移清单 | 40 工具、7 脚本、330 参数、95 动作覆盖检查通过 | `provenance/baseline-capabilities.json`、`provenance/migration-matrix.json`；47 项完整行为验收仍为 pending，`native-migration-audit --release` 会阻止发布 |
| 真实 SDK | 19 项通过 | `/private/tmp/deveco-native-sdk-20260908-4/evidence.json`；Studio 26.0.0.821、SDK 26.0.0.105；创建/构建、HAP、静态预检、Linter、ArkTS 四种查询及空结果/位置边界、C++、API 版本和扫描、本地密钥/CSR、模拟器列表通过，不包含签名安装/热补丁 |
| 真实多模块 SDK | 15 项通过 | `/private/tmp/deveco-native-multimodule-20260908-3/evidence.json`；entry/feature/HAR/HSP、default/tablet 两产品，含默认构建模块筛选与编译元数据驱动的 HSP 依赖构建；未签名、未安装设备 |
| 真实设备只读验证 | 12 项通过 | `/private/tmp/deveco-native-device-readonly-20260908-4/evidence.json`；新增批量查询、缓存 ID 复用、窗口/层级分页，其余包括设备属性、UI 断言、Hilog、故障查询及关闭。故障目录权限不足，返回 `complete:false`，不能计为完整故障采集证明；没有点击、安装或业务路径验证 |
| 真实 Hvigor watch | 7 项通过 | `/private/tmp/deveco-native-hvigor-20260907-4/evidence.json`；未验证签名和设备热补丁 |
| 真实模拟器 | 6 项通过 | `/private/tmp/deveco-native-emulator-20260907-1/evidence.json`；早期代码快照，未记录源码摘要 |
| 一小时基础设施运行 | 通过 | `/private/tmp/deveco-native-soak-20260907-2/evidence.json`；352 轮、2816 个子进程；最终活动任务/子进程/租约为 0，RSS 95,600,640 字节。只使用合成子进程，且早于最新制品与会话修改，不能算最终版本或 SDK 会话长稳验收 |
| MCP 目录性能 | 30 次冷启动、1000 次热查询 | `/tmp/deveco-native-benchmark-20260907-optimized.json`；基线/新版冷 P95 为 153.48/101.92 ms，热 P95 为 0.346/0.263 ms。只测目录，不代表其他工具性能；早期快照 |
| UI 树算法性能 | 已有小/中/大树测量，完整门槛未通过 | `/private/tmp/deveco-native-ui-benchmark-20260908-1.json`；100/1000/10000 个控件，每种查询 1000 次，晚于文本/矩形优化，早于父子层级字段。精确定位、类型查询改善；部分包含文本查询仍有开销。结果形式不同，不能充当直接能力 P95 发布门槛 |

## 尚未通过的发布门槛

Windows 压力测试已暴露并保留三类失败证据：SQLite 初始化失败未关闭句柄、进程退出确认早于文件映射释放、失败会话留下进程登记。当前代码分别修复初始化清理、等待同步句柄和失败会话强制清理，仍须新一轮重复测试证明。任何失败轮次都阻止门槛通过，不能用随后成功的诊断重跑覆盖。

1. 完成冻结清单中逐个旧工具、参数、动作和历史缺陷的行为验收。覆盖审计会拦截漏项、重复项及没有证据的 verified 标记；当前的代码和测试位置映射不等于完整验收。
2. 完成签名部署、设备热补丁、云端签名、真实 UI 输入/流程；已完成多产品、多模块、HAR/HSP 构建，继续完成签名包集合的设备验收。
3. 完成副作用外部状态核对。当前无法证明已执行结果时会停在 `needs_input`；不得把这种保守停止写成恢复能力全部完成。
4. 完成新的 Windows Job Object 进程所有权与退出确认的真实 CI、SDK 和性能验证。`taskkill` 已从原生实现删除；macOS 通过不能代替 Windows 证明。
5. 将临时文件、LSP 日志等剩余状态写入纳入容量控制；目前官方 Checkpointer 的序列化边界、制品/流/数据库已有预算控制，但不能宣称所有磁盘写入都满足统一上限。
6. CPU UI/崩溃解析池已通过边界回归；继续完成其他大报告路径、会话协调与最终性能优化，在固定工程和空闲机器上执行完整直接能力对比，以及最终代码的一小时 SDK/LSP/UI/watch 会话验收。
7. 完成 Node 22/24 × macOS/Windows/Linux 的基础运行矩阵，逐项记录 SDK/设备支持范围。
8. 上游候选、草稿 PR 和 CI 门禁的代码与模拟验证已完成；继续完成远程端到端验证、人工适配证据和正式发布门禁。
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
node dist/scripts/native-multimodule-acceptance.js /absolute/new-module-evidence
node dist/scripts/native-hvigor-acceptance.js /absolute/new-watch-evidence
node dist/scripts/native-emulator-acceptance.js /absolute/new-emulator-evidence
node --expose-gc dist/scripts/native-soak.js /absolute/new-soak-evidence 3600
node --expose-gc dist/scripts/native-ui-benchmark.js /absolute/baseline-checkout /absolute/new-ui-report.json
node dist/scripts/native-benchmark.js /absolute/baseline-checkout /absolute/new-catalog-report.json
```

使用 Node 22/24 时必须在对应环境安装 SQLite 原生依赖，不能直接使用另一 Node ABI 编译的 `node_modules`。验收必须记录实际 SDK、设备、源码与锁文件，不以语言迁移本身证明性能改善。

日志协议对照：[OpenHarmony Hilog 文档](https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/dfx/hilog.md)。`-e` 仅筛选消息内容，整行 `contains` 使用 `grep -F`；`-r` 的默认范围是 app/core buffer。新实现未继承旧组件参数回退分支。
