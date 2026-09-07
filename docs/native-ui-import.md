# 保存的 UI 树查询

`ui_find` 支持离线查询原生 UiTest JSON 文件，以及本 MCP 的 `ui_snapshot` / `ui_inspect` 导出的节点制品。无需选择设备、发现 SDK 或重新获取 UI。新参数替代旧 `dumpPath`，不保留旧名称别名。

原生 dumpLayout 文件：

```json
{"tree_file":"/absolute/layout.json","tree_format":"uitest","selector":{"text":"设置"}}
```

本 MCP 导出的 `tree` 带有 `format:"nodes"`，将其制品 ID 交给离线查询：

```json
{"tree_artifact_id":"返回的 tree.artifact_id","tree_format":"nodes","selectors":[{"id":"enabled","selector":{"type":"Button","enabled":true}},{"id":"checked","selector":{"checked":true}}]}
```

`tree_file` 必须是绝对路径；`tree_file` 和 `tree_artifact_id` 只能选择一个，不能与 `target` 或 `snapshot_id` 混用。`tree_format` 仅适用于离线来源，省略时按原生 `uitest` 格式解析。制品必须为 application/json。没有设备来源时不会自动回退到当前设备。

文件与制品上限 32 MiB，节点上限 100000；UTF-8 必须有效，规范化节点需满足父节点、深度、先序排列及坐标边界。读取校验文件状态、完整处理短读，取消在读取和解析阶段传播。同一运行服务最多并发执行两个离线读取/解析请求，超出时返回可重试的 UI_TREE_QUERY_BUSY，避免在解析排队前分配无限输入缓冲区。较大输入使用同一个有界 CPU Worker 池。

每次查询仍读取当前文件或制品的全部字节，并计算 SHA-256。只有格式和内容摘要均一致时才复用解析结果、树签名与索引，不根据文件名、mtime 或制品 ID 猜测内容未变。同长度修改并恢复 mtime 仍会失效；文件或制品丢失不能通过缓存继续查询。文件读前后的大小、纳秒级 mtime/ctime 必须一致。缓存最多两份、32 MiB 估算预算，包含节点、字符串与索引的记账；超过预算的树可以查询但不缓存，60 秒无命中或写入后释放，关闭运行服务立即释放。估算预算不是进程 RSS 的硬上限。`deveco_doctor.saved_ui_cache` 提供数量、预算、命中、未命中及淘汰统计。

结果提供 `source:saved_tree`、`device_state_verified:false`、输入摘要、树签名、节点数量及完整匹配数量。单查询返回 `match_count/matches/truncated`，批量查询返回 `queries`。不发放可用于设备操作的 snapshot_id。节点预览的字符串最多 1024 个 UTF-16 单元，全部匹配预览共用 24 KiB 预算；被截短的字段列入 truncated_fields，容量或字段截断时返回完整树的制品引用。`limit:1` 只缩短预览，不消除匹配歧义。

离线树是历史证据，不能通过它验证当前设备状态、点击结果或业务验收。需要当前状态时使用实时 `ui_observe` 或明确的 `verify_ui` 断言。

`test/native-ui-import.test.ts` 覆盖文件与制品一致性、中文与显示器筛选、真实匹配数量、文件修改失效、冲突参数、非法编码、节点关系、超限、取消、有界 CPU 解析、响应预览预算，以及 Runtime 不调用设备发现。`scripts/native-device-readonly.ts` 将真实设备导出树分别从文件和制品导入，核对签名与结果；此检查不执行设备输入。

2026-09-08，离线查询首次实现的 [CI 34165175036](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34165175036) 六组 Node 22/24 × macOS/Windows/Linux 均通过：每组 199 项回归、10 项编译包干净安装检查，Windows 各 20 轮进程压力检查。

加入内容缓存后，本机 Node 22/24/26 各 201 项回归通过、0 跳过：`/private/tmp/deveco-native-regression-node22-20260908-9/evidence.json`、`/private/tmp/deveco-native-regression-node24-20260908-9/evidence.json`、`/private/tmp/deveco-native-regression-node26-20260908-30/evidence.json`。缓存更改的跨平台 CI 仍需单独核对。新旧版完整 MCP 离线精确查询的 Node 22/24 三轮实测见 [UI 查询性能记录](native-ui-performance.md)，此结果不代表实时设备或全部选择器的性能验收。

同一原生快照在 Node 24 的真实设备只读复验 13 项通过：`/private/tmp/deveco-native-device-readonly-20260908-7/evidence.json`，保存树分别通过文件与制品导入，结果及签名一致。没有安装、启动、点击或输入；故障目录权限不足仍明确返回未完成的采集范围。
