**2026-09-14 日常运行日志检查（北京时间）**

本次读取事件 `14278–14603`，共 326 条，运行日志覆盖 16:37:24–17:38:24。宿主日志检查覆盖本次 Codex 启动的 16:26:56 至 17:38:44。检查期间仍有后续业务活动；这些活动留到下次增量读取，不混入本次固定窗口。

当前 Codex 配置和实际 CLI 进程均指向 `native-7-candidate-0.4.0-20260914-2`，窗口内事件版本全部为 `0.4.0`。状态目录沿用旧名称以保留历史路径，不代表运行版本。该窗口的业务请求和内存样本来自同一个运行实例，未跨进程拼接趋势。

| 检查项 | 结果 |
| --- | --- |
| MCP 请求 | 41 次开始、41 次正常返回，0 次 request_failed；41 次均有耗时 |
| 子进程 | 38 次退出，退出码均为 0，无信号终止 |
| 构建工作流 | 7 次 project_build 均 succeeded，编译验证通过；完整工作流耗时 42.9–46.6 秒 |
| 预检 | 7 次 arkts_check，errorCount 均为 0，包含工程警告 |
| 资源等待 | 租约排队最大 0.760 毫秒；解析排队最大 0.522 毫秒 |
| 日志附件 | 71 个全部存在，文件大小与元数据一致；38 份原始进程日志字节数均与 outputBytes 一致 |
| 性能采样 | 62 条，覆盖约 61 分钟，无序号缺口，累计写入失败数为 0 |

`request_finish` 仅表示工具返回。构建成功另经工作流状态和构建结果核实。`workflow_run status` 最长约 22 秒的调用处于等待构建期间，对应工作流最终成功。7 份构建结果中的 `truncated=true` 表示返回文本缓冲区被截短；完整原始日志已落盘，本次核对了这些原始附件。

**内存观察**

RSS 起始 166.38 MiB，窗口末尾 366.72 MiB，峰值 375.09 MiB。仅比较起止值会漏掉期间多次回落：

| 时间 | RSS（MiB） | 工作线程已用堆（MiB） | 工作线程总堆（MiB） |
| --- | ---: | ---: | ---: |
| 17:02:24 | 358.98 | 41.95 | 182.61 |
| 17:04:24 | 186.52 | 42.02 | 45.11 |
| 17:12:24 | 371.78 | 42.32 | 183.61 |
| 17:16:24 | 186.33 | 42.09 | 45.36 |
| 17:24:24 | 375.09 | 42.55 | 186.86 |
| 17:28:24 | 185.91 | 42.44 | 45.61 |
| 17:38:24 | 366.72 | 43.09 | 184.86 |

RSS 高峰与构建时段重合，随后有多次回落；无已跟踪活动时的已用堆约 41–43 MiB。当前未见持续累积的明确迹象，不能据此排除更长期或其他负载下的泄漏。RSS 覆盖整个 Node 进程，堆和 external 等指标只覆盖采样的运行工作线程，独立 SDK 子进程不在其中。

窗口最后一个样本的请求、进程、连接、解析队列、解析工作线程、LSP 和 UI 缓存计数均为 0。检查时数据库中的 64 KiB `request-log-buffer` 预留属于仍存活的运行实例，是请求日志的有界缓冲预留。

**工程和设备日志中的问题**

- 灵动工程的 7 次构建均包含警告。每次构建的诊断摘要识别出 1282 条废弃 API、43 条 SDK 兼容性、6 条 source map 警告；这些是匹配日志行数量，可能重复，不代表同样数量的独立缺陷。原始日志还包含本地模块信息缺失提示。
- SDK 兼容性示例：`FingerGuessingComponents.ets` 使用的 `fill`、`stroke` 被编译器提示需要 SDK 26，而工程兼容版本为 23。这是优先值得核对的工程兼容性问题。
- 每次全工程静态预检均返回 2166 条警告；局部 `arkts_check` 的警告数依次为 9、3、3、25、3、3、3。最新局部预检提示蓝牙、日历权限缺少 `usedScene`。这些预检警告与构建器警告可能交叠，不应相加作为独立问题总数。
- 16:51–16:52 采集的设备日志包含发生于 16:47–16:50 的应用错误：`PixForgeInteractiveCardHost` 的 `@Monitor onMusicDataChanged` 找不到 `musicPreviewViewModel.dataRevision` 初始化；另有 `ResultSet is empty or pointer index is out of bounds`、rawfile 读取失败和 NAPI 清理钩子重复注册记录。它们属于被调试应用/设备日志，尚不能凭这些历史片段判断后续修改是否已修复。

设备证据包括状态目录 `artifacts/06c2c145-2110-414f-a4a7-9be2eba1871b` 第 7–9 行的 Monitor 错误，以及 `artifacts/c6613137-515f-46bb-927e-4f0ba08cd249` 第 552、623、637 行附近的资源、NAPI 和数据库错误。本次未重复计算同一次采集的进程附件和整理后的日志附件。

**宿主日志**

固定窗口内未发现 `deveco-tool` 启动失败或 `runtime_sample_failed`；宿主中的该 MCP 状态记录均无 error/failureReason。

Codex 桌面自身有 837 条重复的 `ResizeObserver loop completed with undelivered notifications`，以及 Chromium 扩展检测、内置 sites 插件安装、通知音目录权限等警告。这些日志来自宿主界面和插件组件，未见对应的 DevEco MCP 请求或传输失败。本次记录这些现象，没有修改 Codex、其他插件或灵动工程。

**UI_flow 采用情况**

本窗口 `ui_flow`、`ui_query`、`ui_control`、`ui_test` 均为 0 次；也没有间接启动 ui_flow/ui_record 工作流。实际调用为预检、构建、设备信息及日志读取。这段工具记录不足以评估回放采用情况，也不能作为漏用回放的证据。

本次只读运行库和已有日志，没有调用设备操作、启动多智能体或重跑完整性能长测。下次增量游标为 `14603`。

详细机器可读证据保存在 [本次检查目录](</Users/dreamlike/Library/Application Support/DevEcoMCP/preparation/patch-040-20260914-2/reviews/20260914-173844>)：`incremental-log-review.json`、`window-events.json`、`artifact-review.json`、`build-diagnostics-review.json`、`supplementary-findings.json` 和 `host-log-bounded-review.json`。
