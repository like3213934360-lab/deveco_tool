# 原生崩溃诊断与故障日志

使用公开工作流 `crash_diagnose`。本地输入为 `log_file`、`log_text` 或已有 `log_artifact_id`，提交时固定证据；现场采集使用 `target`，可指定原始 `faultlog_name` 或按 `bundle_name`、时间范围采集。`hdc_log` 的 `probe` 和 `fetch` 分别用于发现与精确读取，不能根据猜测给文件添加 `.log` 扩展名。

## 固定分析步骤

1. 收集或读取任务拥有的日志制品，不把全文放入检查点。
2. 按文件边界、PID 和应用归属选择一个崩溃事件。故障文件的主异常优先于末尾 `HiLog:` 附带的历史日志；多个明确 `Source:` 文件段分别处理。不匹配的应用不作为替代结果。
3. 保留原始栈顺序，并另外提供 `ranked_frames` 与 `suspected_location`。应用源码候选优先于系统和依赖帧；现代 `bundle|module|version|file:line:column` 位置和 HybridStack 中的脚本帧保留其元数据。返回路径只是日志证据，不自动打开文件；`file_verified:false`。
4. 根据错误类型、错误信息和错误码匹配本地运行时规则。编译错误案例不参与此步骤，未匹配的类型与未收录子类分开返回；同一码对应多个案例时保留全部候选。
5. 输出诊断、候选分析与建议、知识条目的源提交/路径/摘要及具体表格行号。报告始终保留 `root_cause_verified:false` 和 `diagnosisComplete:false`，根因仍需结合业务代码核实。

已锁定上游的九份运行时参考表包含 45 条模式。组合的 AND/OR、字面错误码边界及受限通配模板由 TypeScript 执行，无须安装 Skill、注入完整 Skill 或启动第二个 Agent。新增表格格式、组合语法或未映射占位符会阻断导入和资源校验；上游其他语义变化仍须经过完整更新适配门禁。

输入日志上限 8 MiB；事件、PID、栈和摘要均有上限。类型、错误信息、栈或输入超过边界时，`selection_complete:false`。候选条目的 `evidence_complete` 仅沿用日志选择完整性，不表示根因已证明。缺少 SourceMap 时返回 `source_map_status:unavailable`。大日志经有界 CPU Worker 解析，Worker 输出 Schema 保留相同的错误码、栈位置和来源字段。

## 生产设备的读取路径

先用 shell `head` 读取最多 256 KiB 加一个探测字节。设备明确拒绝 shell 读取权限时，使用支持的 `hdc file recv` 读取同一个已验证名称，结果注明 `read_method:hdc_file_recv`。文件不存在或传输截断不伪装为有效日志。

HDC 接收使用私有受管临时目录、8 MiB 预留额度、写入监测和取消信号；接收完成后只保留前 256 KiB 的报告制品，超出则标记截断。退出确认后清除临时文件并释放额度。目录监测不是文件系统硬配额，外部写入可能在两次观测之间超过预留量；实际超额会记账并停止新增写入。

## 2026-09-08 历史验证证据

2026-09-08，本机 Node 26 全量 279 项回归通过，证据为用户目录 `Library/Application Support/DevEcoMCP/acceptance/20260908-crash-regression-1`。运行源码摘要：

`04f85282fedc2d3ae1811cbb3f92168b008608e46c915fe9f5c179f182d3f116`

真实 HarmonyOS 设备经 MCP 主进程、运行 Worker 和大日志 CPU Worker 完成六项检查，证据为同级 `20260908-crash-device-1`。173,513 字节的实际故障文件验证了：

- shell 目录读取被拒绝，HDC 文件服务可以读取同一原名文件；
- SourceMap 提示与现代打包栈格式保留，主异常不会被附带 HiLog 覆盖；
- 错误名称、信息、错误码和应用位置与原始文件相符，并匹配到一个本地故障候选；
- 重复请求返回原任务，关闭并重连 MCP 后，结果和原始制品摘要保持一致。

该证据为只读诊断，不证明业务代码根因已修复，也不覆盖所有系统、设备、崩溃类型或完整性能采样。原始文件、设备标识和报告只保存在本机私有证据目录，未进入 Git。当前凭证归属见[验收证据核对](native-acceptance-review.md)，5% 相对耗时阈值的撤销说明见[性能记录](native-ui-performance.md)。

复现命令要求新的证据目录、显式设备和 `probe` 已观察到的应用 JS 故障文件。所选文件应有可核对的应用栈与已收录模式：

~~~sh
node dist/scripts/native-crash-acceptance.js /absolute/new-evidence DEVICE_ID OBSERVED_FAULTLOG_NAME
~~~

`test/native-crash.test.ts` 与 `test/native-logs.test.ts` 还覆盖进程交错、Unicode/Windows 路径、位置与消息截断、错误码歧义、未匹配类型、上游格式变化、接收失败、取消、额度超出及临时目录清理。干净 Node 24、当前提交六组 CI 和最终性能复验须以随后记录为准。
