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

## 当前版本的证据

本轮运行摘要为 `23758f48efc3dc011a5c858a0dee6b666d3483883ae6b5c131906e6962a2ad93`，全部编译摘要为 `25b0b62cb294440fe60ee39b1bd88e8abc78cb59a6f7ba8a786c51d1f854b0bb`。报告目录位于本机 `~/Library/Application Support/DevEcoMCP/acceptance/`，以 `20260908-native6-` 开头；这些私有原始报告不会直接进入发布包。

| 项目 | 当前结果与范围 |
| --- | --- |
| 严格编译、回归 | 225 个 TypeScript 文件；本机 Node 24/macOS arm64 的 330 项全量回归通过，无失败、取消或跳过 |
| SDK 和诊断 | SDK 22 项、静态检查 13 项、Linter 6 项通过；包括编译 API 26、目标 API 24、最低 API 22 的实际构建 |
| 多产品、多模块 | 23 项通过，覆盖 default/tablet、HAR/HSP/HAP、跨模块 ArkTS 定义，以及 arm64-v8a/x86_64 两模块 C++ 正常与错误诊断 |
| 个人签名及部署 | 真实 SDK 验签通过；两产品各三包安装后注入响应丢失，重建 Runtime 后读取回执恢复，每次安装只派发一次并通过最终 UI 断言。复用已有个人资产，不是新云端资产创建或 OS 强杀证据 |
| 热补丁 | 10 项通过；两次真实 HQF、文字断言和 PID 保持，watch 停止、源文件恢复及服务关闭均完成 |
| 设备与 UI | 只读检查 14 项、中文输入及录制/保存/MCP 重启后重放 16 项通过；不扩展为所有手势和多显示器已通过 |
| 崩溃与恢复 | 指定真实 faultlog、原始证据核对及重连后读取 6 项通过；真实 SDK 宿主 SIGKILL 的三种边界复验通过，有回执恢复、缺回执暂停，不重复执行命令 |
| 模拟器 | 只读及生命周期各 7 项通过，测试实例清理后库存不变；命令成功不等于全部场景已被应用感知 |
| 认证 | 开发者 9 项、云知识 10 项通过，包括重启后保持、服务隔离和云知识制品分页读取；复用已有登录状态，不作为真实过期 Token 刷新证据 |
| 六组平台 CI | macOS/Linux × Node 22/24 各 330 项、Windows × Node 22/24 各 319 项适用回归通过；零失败、取消或跳过。Windows 两组各 20 轮进程压力检查通过，六组干净安装各 10 项通过 |
| 上游验收 | 80 条规则重新核对；deveco-code 的 10 项、deveco-cli 的 28 项映射检查接收，本地上游门禁通过，旧凭证归档 |
| 性能 | 三规模离线精确 key 查询共 18,000 次，九组 P95 对比通过；LSP 悬停、热重载状态、流程目录短查询仍未通过原定门槛，见 [性能记录](native-ui-performance.md) |

提交 `46df984` 的 [六组 CI 34248473227](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34248473227) 全部成功，下载的原始报告已经独立核对。六份分发清单均为 404 个文件、90,568,645 字节，清单摘要一致为 `4f4d934acbb579b242fe4ee7a76c24b46bb37b9a7a2219619237ac9cf75acaea`。此后的文档及验收清单变更会改变分发内容，最终候选仍须核对最终包。当前版本的一小时 SDK/LSP/UI/watch 活动及六分钟空闲回收正在执行，结束前不计为通过。上述局部验收不表示最终发布就绪。

逐项复核发现旧 `start_app.target`、`apply_changes.target` 是构建目标，原迁移清单却误写为 HDC 设备。当前实现只选择产品下的 default 或唯一适用目标，显式构建目标选择还未实现。这两个参数已恢复为 pending，默认目标的双产品验收不能覆盖这一缺口。

## 仍需完成的验收与交付

1. 补齐显式构建目标选择，并按迁移矩阵逐行完成全部剩余场景，再接收绑定当前编译身份的证据。330 参数中 328 项已有映射或删除归类、2 项重新列为 pending，95 动作已归类；47 行中的其他 pending 主要表示行为验收未结束，不能用映射位置代替通过结论。
2. 补齐安装准备、UI 逐步操作、热补丁、云端签名、模拟器变更的真实中断/核对边界；不要求没有外部查询协议的操作凭空恢复成功。
3. 验证更多 SDK/API/CLT 组合、多模块热补丁、过期认证、保存流程与未知目标录制、手势及真实显示器/窗口场景，按实际设备和平台分别记录支持范围。
4. 完成最终六组平台回归和干净安装，复核包内容；三平台基础 CI 不代表三平台真实 SDK 和设备已验证。
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
node --expose-gc dist/scripts/native-sdk-soak.js /absolute/new-soak-evidence 3600 DEVICE_ID
node dist/scripts/native-benchmark.js /private/benchmark-plan.json /absolute/new-direct-evidence
```

`node dist/scripts/migration-accept.js PLAN.json` 接收一行已完成的迁移验收。计划包含 `format: 1`、`source`（`tools:旧工具名` 或 `scripts:旧脚本ID`）、`reviewer`、具体 `reason`、该行全部 `remaining` 对应的 `completed_scenarios`，以及 `checks: [{check, report, sha256}]`。

接收程序验证报告实际执行了映射检查、全部通过且编译/依赖/资源/上游锁摘要一致，再发布不含原始路径和凭据的白名单凭证。它不会自动证明人工声明的场景；评审者须核实原始证据的真实覆盖范围。历史报告或手动修改 verified 标记不能替代当前验收。
