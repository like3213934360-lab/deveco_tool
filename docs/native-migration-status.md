# 原生 TypeScript 迁移状态

更新日期：2026-09-09。架构切换已完成，当前正在统一验收、补齐逐项复核发现的遗漏并修复问题，尚未发布正式版。开发分支为 `codex/native-typescript-runtime`，远程 `main` 尚未合并重构。

本页只描述当前实现和验收边界。各轮失败、修复及历史编译身份见 [完成清单](native-completion.md)；原始报告继续保留，不用历史成功覆盖当前缺口。

## 当前架构

唯一入口为 `dist/src/cli.js`，调用链为 CLI → MCP Server → Runtime Worker → 领域服务/持久化工作流。仓库、CI 和本机宿主已经切换原生入口；宿主安装版本仍须与最终候选版统一。

- 自有运行源码、测试和开发脚本为严格 TypeScript；`allowJs: false`。生产执行编译产物。
- TypeScript 6.0.3、LangGraph 1.4.14、SQLite Checkpointer 1.0.4、MCP SDK 1.30.0、Zod 4.4.3 已锁定。运行矩阵为 Node 22/24。
- 当前执行协议为 `native-6`。SQLite 保存检查点、操作记录、资源租约及制品引用；`run_id` 对应 LangGraph `thread_id`，不加载旧执行引擎或旧格式解码器。
- 注册 25 个公开工具、8 个工作流。工具目录不依赖 SDK 探测，运行服务、LangGraph 和重型解析按需启动。
- 已删除旧自有 JavaScript 运行源码、官方 CLI/CodeGenie 子 MCP 依赖、代理、运行时补丁、Skill 安装体系及旧入口。用户无须安装官方 Skill。
- SDK、OHPM、Hvigor、HDC、语言服务器、签名和模拟器由领域服务直接调用。长期 LSP/watch 会话复用并有容量和空闲回收限制。

接口和调用示例见 [README](../README.md)。有接口和实现并不表示全部设备、SDK 版本及恢复场景均已验收。

## 已实现的行为约束

任务提交时固定工程、产品、模块、SDK、设备及输入。切换默认工程不改变在途任务；同一请求键与相同输入去重，不同输入冲突。只读目录和会话查询使用当前校验后的工程选择，构建与 LSP 仍捕获完整工程摘要。

同步、构建、部署、UI 操作、热补丁、云端变更和模拟器变更都有各自的操作记录和核对路径。已经执行但缺少可靠完成回执的任务保持 `needs_input`，仅接受声明的 `recheck` 输入；不以同名应用、已有文件或旧 PID 推测本次操作成功。详见 [命令恢复](native-command-recovery.md)、[包集合部署](native-deployment.md) 和 [进程归属](native-process-ownership.md)。

UI 使用同一份快照执行定位、索引和操作前校验，操作后失效。中文输入、公开入口、未知目标录制、保存流程、手势和显示器路由均接入新服务。选择器修复通过原有最终断言才保存；截图与外观审阅不能自动等同于业务验证通过。未完成录制会阻止同一设备的热重载应用操作。

开发者签名认证与云知识认证分开存储。个人/团队选择显式执行；密钥、CSR、云端签名资产和工程配置有各自的持久化边界。上游流程、规则和模板转换为工作流、校验及按需查询资源，保留出处和版本；运行时不下载执行最新上游代码。

进程输出、CPU Worker、UI 缓存、日志和制品有明确上限。普通请求日志按 20 ms/128 条/64 KiB 批次持久化，失败时阻止后续请求；关键检查点和副作用回执仍同步保存。普通日志的强杀丢失窗口及外部 SDK 写入边界见 [存储](native-storage.md)。

## 当前验收进展

最新 dev22 运行摘要 `0adac632b689bf66af02e807119dcdc70e71dee617cd00df25cb969f9f8372a1`、编译摘要 `5e3a48daa0881876eea7c35a1aabf9858d660d0d1e06028ee6402abce004b69e`，227 个严格 TypeScript 文件。本机 Node24/macOS 全量回归 354、多模块热补丁 18、preview 热补丁 11、SDK 24、静态检查 13、Linter 6 项通过。三轮联合 HQF 保持 PID，并验证后续改动保留旧补丁、撤回 HAR 改动和 watch 无源码变动重启；跨进程竞争被拒绝后，原会话可继续应用补丁。个人签名包重新验签、模拟器只读及生命周期、实际 MCP/Worker 认证读取也已通过。

`hot_reload` 已凭当前报告关闭所列行为缺口；已有 17 行迁移接收记录全部刷新到上述 dev22 身份，包括 `detect_sdk`、`apply_changes`、登录及图片/制品协议。30 行仍为 pending，未借刷新凭证缩减其场景要求；旧凭证保留用于追溯。dev22 的 80 条上游映射规则已复核，code/CLI 的 13/34 项当前检查已接收。

提交 `7ae2039` 的 [六组平台 CI](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34281071925) 已下载原始报告并核对身份：macOS/Linux × Node22/24 各 354 项、Windows × Node22/24 各 343 项适用回归通过，六组干净安装各 10 项通过，Windows 两组各 20 轮强杀压力检查通过。六份分发清单摘要一致。本机最终候选目录的干净安装 10 项和隔离宿主升级/回退 10 项通过，包含活跃旧/新会话阻止切换、加密回退记录、重试及十份既有流程文件字节保留。维护 CLI 在隔离宿主内验证精确归属 Skill 的清理、用户修改内容保留和幂等重试；这些结果不代表当前宿主已经切换到最终候选。

同版实际 MCP/Worker 在隔离模拟器上通过手势 25 项、旋转及图片/树坐标对齐 8 项、未知目标录制/重放 17 项、选择器修复 9 项、真实 Hilog 14 项和新增实际崩溃分析 6 项。电量场景及与 UI 的设备租约竞争/取消 12 项、光照回调及原值恢复 5 项通过。湿度、环境温度订阅在当前镜像返回不可用，未计作通过；单显示器旋转不能替代真实多显示器验证。日志清空仅操作隔离模拟器，物理手机日志未清空。

真实 SDK/OHPM 完成回执前后的五个 SIGKILL 场景已按当前身份复验。开发者认证自然超过本地检查期限后，三次并发请求合并成一次真实云端刷新，后续新鲜缓存不再刷新，共 4 项通过；当时 JWT 尚未过期，仍不能关闭真实过期凭据/服务端 401 场景。

当前 stdio MCP/Worker 真机长稳已通过生产门禁校验：活动 3,601,530 ms、110 个样本，实际应用 46 次 HQF，LSP/UI 各 545 次，记录 1,362 次请求。随后空闲 360,018 ms、13 个样本，任务、监听器、连接、进程、缓存和 Worker 全部归零；watch 及运行时取消均确认完成，传输和进程已退出，隔离应用已停止。双提供方实际回调生命周期 7 项及图片/制品协议 8 项也已通过；回调使用真实五分钟超时，没有修改时钟。

三规模 UI 树解析、每规模四类选择器各 1,000 次的延迟、CPU 和 RSS 已采集，解析及查询 P95 均低于同输入旧版；编排、检查点、持久化图各 1,000 次已采集。LSP、hot status、flow catalog 的隔离性能对比尚未达标。针对文件读取、工具链发现和 SDK 输出目录核对的优化仅在私有副本试验，尚未纳入当前运行源码或作为正式性能验收。完整性能、真实跨平台 SDK 及其他剩余场景仍需完成；后续运行源码若变化，须重做对应最终验收及长稳。

## 历史 dev11 冻结版本证据

历史本地冻结版本 `native-6-browser-manual-dev-11` 的运行摘要为 `ef6aaeffb850969e11bf99f25c743342f94e05de350928b3408d6ee6056f552d`，全部编译摘要为 `1ecc3a3261a293b974be0858ad70f4363e84e96713872010843215d26cce7145`。以下结果来自本机 Node24/macOS，原始私有报告保存在 `~/Library/Application Support/DevEcoMCP/acceptance/20260909-native6-browser-manual-*`，按摘要接收的公开凭证不包含原始路径、凭据或设备信息。

| 项目 | 当前结果与范围 |
| --- | --- |
| 严格编译、回归 | 干净安装 166 个依赖，226 个 TypeScript 文件编译通过；350 项全量回归通过，零失败、取消、跳过 |
| SDK 和诊断 | SDK 23 项、静态检查 13 项、Linter 6 项；实际 SDK 声明定义、编译 API/目标 API/最低 API 分离验证通过，规则全覆盖仍未证明 |
| 多产品/目标/模块 | 49 项通过，default/tablet 与 default/preview 四种选择，HAR/HSP/HAP、跨模块 ArkTS、两 ABI 两模块 C++ 正反例 |
| 个人签名及部署 | 复用个人资产的真实 SDK 验签通过；四组各三包安装后丢失响应，重开运行时核对回执恢复，每次仅一次安装并验证控件 |
| 热补丁和 UI | preview 目标热补丁 11 项、中文输入/录制/重启重放 16 项、图片/制品协议 8 项、设备只读 14 项通过；两次 HQF 保持 PID、最终文字断言通过 |
| 崩溃与恢复 | 指定真实日志 6 项；真实 SDK 子命令完成回执前后 SIGKILL 3 种边界、OHPM 2 种边界通过。缺回执保持 needs_input，不重复执行 |
| 模拟器 | 只读及生命周期各 7 项通过，专用测试实例删除后库存不变；仍需更多场景效果、取消及平台验证 |
| 认证 | 开发者 9 项、CodeGenie 10 项；真实 MCP 并发登录合并、浏览器启动失败保留手动 URL、生产五分钟超时和取消清理通过。真实云端过期凭据仍待验收 |
| 迁移、上游 | 47 行中 14 行凭当前身份接收，33 行 pending；80 条上游规则已评审，code/CLI 的 13/34 项映射检查接收 |
| 性能 | 三规模离线精确 key 查询共 18,000 次，九组 P95 对比通过；解析/选择器 CPU/RSS、编排/检查点各 1,000 次已采集。完整对比在 LSP 未达标后停止，保留原始失败样本；最终版本仍需全部重测 |

最近已完成的六组基础 CI 对应历史提交 `146b2ab`，其 338/327 项适用回归、六组各 10 项干净安装和 Windows 两组各 20 轮压力检查通过；认证修复提交 `f094b4b` 的六组 CI 已完成，其中五组通过，Windows Node22 的缺失 SDK 错误码和 UI 歧义用例失败，尚未通过当前平台门槛。三平台基础 CI 不代表真实 Windows/Linux HarmonyOS SDK 或设备验收。

历史 dev-8 已通过一小时实际 stdio MCP/Worker 长稳、46 次 HQF 签名和设备应用，以及六分钟空闲回收；记录 1,362 次请求，最终受管资源全部归零。它早于认证修复，仅作历史对照；上述 dev22 长稳是独立重测。更早的 Runtime 直调长稳不计作 MCP Worker 证据。各轮完整身份与失败记录见 [完成清单](native-completion.md)。

旧 `start_app.target`、`apply_changes.target` 表示构建目标，新版通过独立 `module_targets` 固定产品和各模块目标，与 HDC `target` 分开。真实 SDK 验证覆盖 default/preview 两目标；`start_app` 已按当前报告刷新凭证，`apply_changes` 的冷增量、HQF 和构建目标行为已由后续 dev16 报告接收。旧 CodeGenie 登录 APP_ID=1008 的迁移已修正，旧等待参数明确删除；待登录状态保留手动 URL、浏览器状态和错误码。

## 仍需完成的验收与交付

1. 完成迁移矩阵各行的全部剩余场景，再接收绑定当前编译身份的证据。显式目标选择及两次真实热补丁已通过；330 参数已有映射或删除归类，95 动作已归类。47 行中的其他 pending 主要表示行为验收未结束，不能用映射位置代替通过结论。
2. 补齐安装准备、UI 逐步操作、热补丁、云端签名、模拟器变更的真实中断/核对边界；不要求没有外部查询协议的操作凭空恢复成功。
3. 验证更多 SDK/API/CLT 组合、过期认证、保存流程与未知目标录制、手势及真实显示器/窗口场景，按实际设备和平台分别记录支持范围。
4. 最终源码如继续修改，重新冻结并执行六组平台回归和干净安装，复核包内容；当前 dev22 六组已通过，三平台基础 CI 不代表三平台真实 SDK 和设备已验证。
5. 完成 30 次冷启动、19 项直接能力各至少 1000 次、旧版逐对 P95、三规模解析/选择器、编排/检查点和 MCP/SDK 分开计量；解决仍存在的稳定退化。完整长稳必须绑定最终代码。
6. 完成最终版本配置升级、重新认证、流程保留、已归属 Skill 清理、完整 Release 回退，以及上游候选适配和调度权限。已有候选安装的局部升级/回退结果保留其真实范围。
7. 所有门禁通过后准备候选及正式 Release，合并远程主分支并验证干净安装；当前没有发布完整重构正式版。

## 复现与证据接收

在对应 Node 22/24 环境安装锁定依赖，SQLite 原生模块不能跨 Node ABI 直接复用。运行验收必须选择全新证据目录，冻结源码、输入和工具链；性能采样期间不要重新构建或并行运行重型任务。

```sh
npm ci
npm run build
node dist/scripts/native-regression.js /absolute/new-regression-evidence
node dist/scripts/native-migration-audit.js
node dist/scripts/upstream-gate.js
node dist/scripts/native-sdk-acceptance.js /absolute/new-sdk-evidence
node dist/scripts/native-device-readonly.js /absolute/new-device-evidence DEVICE_ID
node dist/scripts/native-ui-mcp-benchmark.js /absolute/frozen-baseline /absolute/new-ui-evidence 3
node --expose-gc dist/scripts/native-sdk-soak.js /absolute/new-soak-evidence 3600 /absolute/personally-signed-canary-preparation
node dist/scripts/native-benchmark.js /private/benchmark-plan.json /absolute/new-direct-evidence
```

`node dist/scripts/migration-accept.js PLAN.json` 接收一行已完成的迁移验收。计划包含 `format: 1`、`source`（`tools:旧工具名` 或 `scripts:旧脚本ID`）、`reviewer`、具体 `reason`、该行全部 `remaining` 对应的 `completed_scenarios`，以及 `checks: [{check, report, sha256}]`。

接收程序验证报告实际执行了映射检查、全部通过且编译/依赖/资源/上游锁摘要一致，再发布不含原始路径和凭据的白名单凭证。它不会自动证明人工声明的场景；评审者须核实原始证据的真实覆盖范围。历史报告或手动修改 verified 标记不能替代当前验收。
