# UI 测试连续日志

下一版本候选在 `ui_test` 初始化、恢复与操作期间，为测试指定的应用持续读取 Hilog。日志跟随 `test_id` 保存，MCP 重启后仍可读取；分块清单、关键字搜索、分页和导出均使用公开工具。当前交付与验收状态见[剩余能力进度](remaining-release-progress.md)。

## 开始与就绪

先使用 `ui_test.start` 捕获测试计划、应用和设备，再调用 `ui_test.resume` 初始化应用及采集。创建测试记录本身不代表采集已经就绪。

```json
{"action":"resume","test_id":"测试返回的 UUID"}
```

`ui_test.status.continuous_logs` 返回采集状态、累计字节/行数/分块数、首末设备时间和 gap。只有收到完整的目标应用日志行、再次确认 UID 与 PID 起始时间并保存分块后，才会设置 `current_ready_at`。它表示本次采集的就绪时间；`ready_at` 保留首次历史就绪时间。MCP 重启后恢复会清除 `current_ready_at`，重新验证，不能只看历史字段判断当前是否就绪。应用没有产生日志时，不会因为 HDC 进程存在就标记就绪。

`resume` 不重复已接受或结果不明的 UI 操作。`status` 和 `logs` 是只读查询，不自动恢复已停止的采集。连续采集在 120 秒没有测试操作续期后停止；需要继续测试时显式 `resume`，恢复区间会记录 gap。

## 分块、搜索与分页

先获取分块清单。旧版本的区间采样与新连续采集分别标注来源，不应拼接后宣称无重复、无遗漏。

```json
{"action":"logs","test_id":"测试返回的 UUID","chunk_offset":0,"chunk_limit":20}
```

根据响应的 `next_chunk_offset` 继续请求，直到它为 `null`。`chunk_limit` 为 1–100；清单包括每个分块的 `artifact_id`，连续分块还包括 `sha256`、`line_count`、设备纳秒时间范围、PID 起始时间以及接收时的步骤和阶段。步骤字段描述接收上下文，不能证明某条日志一定由该步骤导致。

读取或搜索某个分块时，使用清单实际返回的 `id`：

```json
{"action":"logs","test_id":"测试返回的 UUID","chunk_id":500,"search_keywords":["示例关键字"],"offset":0,"limit":4096}
```

`offset` 按匹配日志行计数，`limit` 按 UTF-8 响应字节计数，范围为 1–65536。沿响应 `next_offset` 翻页直到 `null`，不要用字符串长度自行计算下一页。最多提供 8 个关键字，每个最多 256 字符。不需要搜索时省略 `search_keywords`。分块 ID 是当前测试的持久标识，不是页码。

## 完整度与边界

连续采集以包管理器确认的非系统应用 UID 枚举进程，并核对 `/proc/PID/stat` 起始时间，最多同时覆盖五个进程。会捕获能在采样中观察到的同 UID 子进程；完全落在两次身份观察之间的短进程，以及使用其他 UID 的隔离进程，不能证明已覆盖。

接收内容先进入有界内存，重新验证进程身份和时间范围后才持久化。时间校验前暂停管道读取，避免设备取样后新到的数据被误认为时钟跳变；验证完成后恢复读取。已知私密输入在写入分块和计算哈希之前脱敏。不会清除系统日志、修改全局日志流控或读取其他应用的日志正文。

`received_range_verified:true` 只表示该分块的已接收数据通过归属与时间边界检查。`complete:false`、`system_delivery:"unknown"` 仍然保留：应用输出、系统 Hilog 投递和 MCP 接收不是同一件事，分块哈希也不能证明系统从未丢日志。

| 记录 | 含义 |
| --- | --- |
| `capture_registration_boundary` / `capture_resumed` | 注册前或重连之间的内容没有连续性保证 |
| `step_delivery_boundary` | 测试步骤或阶段改变，记录接收上下文边界 |
| `application_not_running` / `UI_LOG_PROCESS_CHANGED` | 应用未运行或 PID 起始时间变化，待验证尾部不能继续归属 |
| `UI_LOG_CLOCK_CHANGED` | 设备时钟或日志时间范围无法证明连续 |
| `UI_LOG_STREAM_ENDED` / 传输错误码 | HDC 日志流中断，后续采集重新建立身份边界 |
| `unverified_tail_discarded` | 未经再次身份校验的尾部被丢弃，含已知丢弃字节数 |
| `runtime_interrupted` / `pending_gap` | 上次运行未正常结束，无法证明中断区间完整 |
| 配额、存储错误与 `idle_timeout` | 采集停止原因；之前保存的分块仍可查询 |

每个测试最多保存 64 MiB、8192 个连续分块；待校验内存最多 512 KiB，单行最多 64 KiB。背压在 128 KiB 开始。身份轮询目标间隔为 1 秒，设备命令延迟会延长实际观察间隔。gap 清单最多 256 项，相邻同类记录合并，超出部分以 `omitted_gap_events` 计数；不能把该计数当成丢失的日志行数。

## 结束、取消与导出

`finish`、`cancel`、测试操作失败、空闲超时和运行时关闭会停止拥有的采集进程并释放租约。取消不能保证尚未校验的尾部被保留；这种尾部丢弃会记录。其他运行时仍持有采集租约时，不会强行接管或并行启动第二个读取者。

```json
{"action":"finish","test_id":"测试返回的 UUID"}
```

完成测试仍要求所有计划断言和必要视觉审阅通过。日志采集成功不自动让测试通过。

```json
{"action":"export","test_id":"测试返回的 UUID","directory":"/absolute/new-export-directory"}
```

导出前先停止并收束该测试的采集，再生成稳定制品清单与哈希。不要在另一进程仍采集时绕过维护门禁复制活跃状态。导出物可能包含应用画面、断言与非私密输入相关的日志，应按测试数据保管；输入脱敏并不等于截图内容已自动脱敏。
