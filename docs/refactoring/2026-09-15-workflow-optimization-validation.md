# 工作流优化最终验证

日期：2026-09-15。对象为当前工作区 0.4.0 / native-7 候选代码。[完整 TODO](2026-09-15-workflow-optimization-todo.md)、[逐项实施记录](2026-09-15-workflow-optimization-progress.md)、[三项架构评估](2026-09-15-workflow-optimization-evaluation.md)。

## 验证对象

本轮从已有未提交工作区继续。Git HEAD 仅是基础提交，最终源码用实际字节摘要标识，不能用 HEAD 或旧发布报告替代。

| 身份 | 值 |
| --- | --- |
| HEAD | `6ad95551a0edac9fb8f4a5a7fbe7d45d342a6519` |
| src/scripts/test 的 TS 内容摘要 | `28c816110cef9b4c157051887074b594b52f6c26916f85ef925e2990578f548e` |
| dist/src 运行时文件摘要 | `e9c7046c97cf1701848f19a033d4722f1075341da74c9999a983647715095591` |
| 所有 dist JS 摘要 | `4787d51f1438e601f7b8594654bc95b8f4731c85ed055d21faea1eda0ea871a2` |
| 本地环境 | macOS arm64，Studio Node v24.14.1 |
| 真实工具链 | Studio 26.0.0.821，SDK 26.0.0.105，Hvigor 6.26.4 |

证据根目录：`/Users/dreamlike/Library/Application Support/DevEcoMCP/acceptance/workflow-optimization-20260915-1`。其中 JSON 保存完整文件清单、运行时间、结果和身份；以下路径均相对此目录。

## 已验证

| 检查 | 结果 | 原始证据 |
| --- | --- | --- |
| 实施前冻结工作区回归 | 585/585 | `baseline-regression-2/evidence.json` |
| 最终编译与 typecheck | 348 个 TS 文件编译，typecheck 通过 | `final-typecheck.txt`，最终回归的 compiled 清单 |
| 最终完整本地回归 | 632/632；100 个测试文件；无失败、取消或跳过 | `final-regression-2/evidence.json` |
| 隔离安装与真实本地 MCP | 12/12；干净依赖安装、stdio/Worker、SQLite、资源与任务跨进程重启 | `installation-check/evidence.json` |
| 真实 Studio SDK | 26 项观察通过；关闭完成，执行前后候选身份一致 | `final-sdk-1/evidence.json` |
| 文档调用示例 | 17 个 JSON 块；14 个工具调用同时通过公开 schema 与运行时解析 | `doc-examples.json` |
| 真实预检/同步成本 | 四次构建成功，未替换 SDK 行为 | `preflight-cost/evidence.json` |
| LangGraph/SQLite 开销 | 三类各 1000 次，生产检查点读写断言通过 | `orchestration-final.json` |
| 模块导入成本 | 两种条件各五个新进程，记录耗时与 RSS 快照 | `module-cost.json` |
| 十类工作流对照 | 80/80 完成控制边界合同；实际 MCP，SDK/设备使用适配器 | `comparison-3/evidence.json` |
| 最终身份复核 | 与最终全量回归及正式对照的源码/运行时/编译/锁/资源完全一致 | `final-identity.json` |

对照的详细条件、完整十类结果和流量代价见 [对照测量](2026-09-15-workflow-optimization-comparison.md)。每组工具调用 47 → 22，但工具目录更大，计时范围的双向流量仅减少约 0.6%；不能宣称所有路径都更快或 token 更省。

真实 SDK 检查覆盖工程创建、实际 HAP 构建与 API 身份、ArkTS 预检、Linter、LSP、C++ 构建/clangd、API 兼容扫描，以及本地密钥与 CSR。模拟器只读取清单。普通未配置签名的 SDK 构建不等于已签名应用安装成功。

隔离安装位于证据目录中的 `candidate-installation`；验证归档 `candidate-validation.zip` 的 SHA-256 为 `66ccd7eaf98e2bad34d4c4171a735c868a13f03c22741e4f84718deeb9abce83`。该归档用于本地安装校验，未替换用户正在运行的安装，也不是通过全部发布门槛的正式版本。

## 失败记录与修正

- 基线首轮缺少 NOTICE 文件，在测试前退出；补齐冻结副本后通过，原记录保留。
- 最终回归首轮 620/632：12 项旧夹具对多产品工程隐式选 default。改为显式 product 并保留原失败/恢复断言；针对组 15/15，随后最终全量 632/632。
- 其他实现中暴露的目录发布 FFI、截图经过 Worker 丢失、夹具身份和清理依赖问题，逐项记录在实施记录；旧失败日志均保留。
- 对照脚本调试轮 `comparison-1`、`comparison-2` 保留：基线空目录创建的 PROJECT_EXISTS 被旧任务机制表示成 needs_input，且旧取消不能直接解除待核实操作。正式对照必须记录这个真实限制及宿主绕行，不能删掉失败后只比较成功路径。

## 验证边界

- 本轮没有对用户设备执行安装、UI 操作或故障复现；UI、截图和恢复测试中的设备边界使用夹具。真实设备的画面、生命周期、安装和新交互行为仍待用户验证。
- 本轮没有实跑 Windows/Linux 或 Node 22；相关源码编译及本机测试不能证明这些平台的目录句柄、原生依赖和进程行为。
- 本轮没有新增长时间混合负载/内存稳定性验证，不能由短期测试宣称无内存泄漏，也未重跑全部历史发布、外部账号签名及升级矩阵。
- 耗时、调用次数和字节比较限定于记录的脚本和条件；没有测量模型 token、自然语言路由成功率或上游 CLI 端到端速度。
- 当前上游调查 commit 与资源接受锁分别记录；未推进接受锁，未提交或推送当前工作区。
