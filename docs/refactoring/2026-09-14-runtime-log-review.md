# 2026-09-14 运行日志巡检与长测取消

用户要求取消完整性能长测，改为正常使用、按需读取日志。本次由 root 单独执行，未启动多智能体，未替换安装版本，未启动定时任务。

## 实际安装日志

通过运行进程与打开的数据库确认，当前使用的是 `native-7-release-0.3.0-20260911-1`，不是工作区的 0.4.0 候选。

读取范围：北京时间 2026-09-11 00:54:11 至 2026-09-14 11:39:34；事件游标 13070。776 次请求开始，753 次返回、23 次抛错。返回只代表工具返回结果，不代表构建或业务验收成功。今天记录 146 次请求，141 次返回、5 次抛错。

| 请求错误 | 次数 | 含义 |
| --- | ---: | --- |
| UI_TARGET_AMBIGUOUS | 8 | UI 定位匹配多个对象 |
| KNOWLEDGE_NOT_FOUND / SKILL_NOT_FOUND | 3 / 2 | 指定知识或技能未找到，需要核对标识及目录 |
| DIAGNOSTICS_TIMEOUT | 2 | 9 月 12 日 LSP 诊断超时，值得继续观察 |
| INVALID_ARGUMENT | 2 | 参数校验未通过 |
| COMPILE_DATABASE_FILE_MISSING | 1 | C++ 编译数据库缺失 |
| UI_KEYS_INVALID / UI_TEST_APP_NOT_VISIBLE / DEVICE_AMBIGUOUS | 各 1 | 键值、应用前台或设备选择条件不满足 |
| VERIFICATION_FAILED / SOURCE_CHANGED | 各 1 | UI 验证未通过、恢复时源文件发生变化 |

3480 个子进程启动与结束事件数量一致；其中 3 次 node 构建退出码 255、2 次 hdc 收到 SIGTERM。SIGTERM 本身不能证明崩溃，尚未逐一确认调用方取消原因。未从上述事件发现未配对的请求或子进程数量，但这不是所有资源无泄漏的证明。

构建原始日志确实包含错误及警告：9 月 11 日有 ProcessLibs 失败及 C++ `std::clamp` 不可用；9 月 14 日 10:34 构建因两个 cardEditorComponent 文件的 `@Event $showBorderLine` 双向绑定赋值报错，末尾记录 `ERROR:3 WARN:2370`。警告还包括重复文件名、未使用的 gcc-toolchain 参数、历史构建缺少模块信息。这些是被调用工程/编译器的输出，不能合并成 MCP 自身故障数，也不能据历史日志断言当前源码仍有这些问题。

另查 Codex 9 月 11–14 日桌面日志：9 月 12 日 18:28 出现对 deveco-tool 的 resources/list 与 resources/templates/list 探测返回 `-32601 Method not found`，属于资源发现接口兼容性警告；未在所查 startup_status 记录发现该服务 failed 状态。9 月 14 日未发现相同警告。宿主可能重复转述同一事件，不按行数累计故障。

## 长测处置

本次检查时已无 benchmark、串行驱动或 caffeinate 进程，旧 execution.json 的 benchmark_running 为遗留状态。完整基准未通过：前三项各完成新旧版本 1000 次，code_lint 各 400 次，其余未完成。原始记录保留，不把取消算作通过。

专用模拟器 AaaMcpBench3e02a60b 已核实名称、UUID、停止状态后删除，复查其余实例身份与运行状态一致。处置回执：`acceptance/universal-domain-20260912-final/benchmark-cancellation-20260914.json`。后续不自动恢复完整长测。

## 后续按需读取

现有安装已经记录请求标识、版本、工具/动作、成功请求耗时、失败错误码、资源锁等待、子进程退出码及输出附件，因此当前无需新增产品打点或重装。只读脚本 `scripts/runtime-log-review.py` 已保存，使用以下命令读取本次之后的事件：

```sh
python3 scripts/runtime-log-review.py \
  --state '/Users/dreamlike/Library/Application Support/DevEcoMCP/states/native-7-release-0.3.0-20260911-1' \
  --after-event-id 13070
```

每次先复核运行版本与状态目录，读取增量错误、按工具/动作分组的耗时，再检查相关构建附件与宿主日志；记录新 through_event_id 供下一次使用。脚本通过只读 SQLite 事务取一致快照，不输出请求参数或凭据。已实际运行全量及空增量检查。

当前没有持续内存采样，错误事件也没有直接记录耗时。按需日志巡检可以用于日常运行排错，不能证明未调用功能正常、长期无内存泄漏或新旧版本性能优劣；0.3.0 的日志不能作为 0.4.0 候选验收。已完成的短测/长稳证据保留，完整性能对比结论留空。

原始机器可读巡检：`acceptance/universal-domain-20260912-final/runtime-log-review-20260914.json`（位于用户 Library/Application Support/DevEcoMCP 下）。
