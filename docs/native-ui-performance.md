# UI 查询性能记录

本页既有数值属于各自历史快照，不是当前 native-6 的验收。新的采集器已实现；本批已开始长稳采集，首轮因会话数量变化中止，后续诊断发现工具链时间戳身份变化；第二轮因 UiTest 非法 JSON 中止，失败证据保留，完整一小时与统一性能报告仍待通过。

## 当前统一采集入口

全部实现冻结并宣布进入统一测试后，用同一支持的 Node 与机器运行，输出文件或目录必须是新的：

```sh
node dist/scripts/native-benchmark.js /private/benchmark-plan.json /absolute/new-direct-evidence
node dist/scripts/native-ui-benchmark.js /absolute/frozen-baseline /absolute/new-ui.json
node dist/scripts/native-orchestration-benchmark.js /absolute/new-orchestration.json
node dist/scripts/native-performance-report.js /absolute/new-direct-evidence/direct.json /absolute/new-ui.json /absolute/new-orchestration.json /absolute/new-performance.json
node dist/scripts/native-sdk-soak.js /absolute/new-soak-directory 3600 TARGET
```

长稳脚本在新证据目录内创建专用工程，时长参数单位为秒；运行前选择当前获准使用的设备。benchmark plan 使用 `format: 3`，固定旧版 Git 提交、入口、工具链环境、不可变输入文件摘要及 19 个直接能力。已有能力声明 `comparison: "paired"` 及两版调用映射；新增的只读签名检查按下方规则独立采样。每个 step 要声明结果 JSON Pointer 与预期值；异步写操作使用 `await_run: { "run_id_pointer": "/data/run_id" }`，计时包含直到成功终态的等待，断言针对最终状态的结果。不可用能力明确失败，不以工具目录代替。计划仅保留在私有证据目录，公共报告只记录其摘要。

冷启动两版各 30 次交替测量，分别记录初始化、工具目录与总时长。已有直接能力每版各 1000 次，交替 100 次一组，保留逐次样本及 5% 的 P95 退化门槛；新增签名检查也必须完成 1000 次原生采样。UI 微基准针对 101 / 1001 / 10001 节点，六个独立进程分别测量两版解析和四种选择器；每次延迟、CPU 和 RSS 保留原始值。编排基准单独记录官方 LangGraph 单节点、SQLite 检查点写入/待提交写入/读回，以及启用检查点的图调用，不混入 SDK 时间。

长稳持续执行真实 SDK 增量构建、LSP、UI 树获取及 watch，之后自然空闲至少六分钟。MCP 与当前 SDK 子进程树分别记录 CPU/RSS、受管进程启动次数和可用的磁盘写入字节；不支持的指标用 `value:null` 和理由，不能用文件系统调用次数代替写入字节。SDK 进程树 RSS 可能重复计入共享页，已退出 SDK 的 CPU 不伪装成完整累计值。空闲末尾和关闭后，受管任务、监听器、连接、进程、缓存和 Worker 必须归零；不接受报告自行放宽容量。真实效果、旧/新语义一致性与跨平台范围仍需实际环境验证。


冻结旧版 `aab1405` 的公开 `app_signature` 只执行官方 `signature generate`，没有只读 `inspect` 动作。已实际启动该版本读取公开目录，并与源码核对：其封闭输入 Schema 没有 `action` 字段，摘要为 `124a1f18235f92083b33c3163c8542a334f24df4b80eaa01626d2d42115be68d`。此前要求该新增查询提供旧版同功能样本，是采集门禁的设计错误。

现仅允许 `app_signature.inspect` 声明 `comparison: "new"`，省略旧版执行步骤。采集器在计时前重新读取旧版目录，核对唯一工具、上述完整 Schema 摘要和确切提交，再保存原始目录。新版仍执行 1000 次带语义断言的真实查询；报告使用 `format: 3`，不填入虚构的旧版耗时，也不计算该项提速比例。其余 18 项不能使用此声明，失败能力不能转为“新增”绕过门槛。使用已经有 inspect 的其他基线时必须正常成对测量。完整采样仍待执行，此修正本身不是性能通过结果。

## 历史测量

2026-09-08，在同一 macOS arm64 开发机比较冻结基线 `aab1405b51e00e4036bdc8f18ae4229835de77b0` 与原生编译入口。原生运行文件摘要为 `6473b9c693ff3f80db3d42ec5015b6bfbbad7bbdd0fcf257321b97867384e028`，原始证据保存逐次测量和全部编译文件、依赖锁、资源摘要。Node 22/24 分别在不含官方 CLI、子 MCP 或 Skill 的独立原生验证目录安装相应 ABI 的依赖。

`scripts/native-ui-mcp-benchmark.ts` 使用完整 stdio MCP 调用。每轮分别启动新旧服务器，轮换测量顺序；每种大小先预热 20 次，再重复 1000 次固定精确 key 查询，连续三轮。两版读取相同的不可变 UiTest JSON，逐次核对节点总数、真实匹配数量和命中 key。保留默认日志写入，新版测量包含文件读取、摘要、缓存或解析、Worker 通信及完整响应传输。两版公开结果结构不同，按各自正常输出计时；不在 SDK 设备操作中加入模拟延迟。

| Node | 节点数 | 基线 P95 范围 / ms | 原生 P95 范围 / ms | 三轮逐对变化 |
| --- | ---: | ---: | ---: | ---: |
| 22.23.2 | 101 | 0.641–0.665 | 0.493–0.554 | -23.1% 至 -16.7% |
| 22.23.2 | 1001 | 1.241–1.319 | 0.424–0.545 | -66.7% 至 -58.7% |
| 22.23.2 | 10001 | 9.503–9.654 | 1.057–1.087 | -88.9% 至 -88.7% |
| 24.14.1 | 101 | 0.475–0.523 | 0.392–0.430 | -22.5% 至 -17.2% |
| 24.14.1 | 1001 | 1.118–1.145 | 0.341–0.357 | -70.1% 至 -68.1% |
| 24.14.1 | 10001 | 8.473–8.679 | 1.488–1.718 | -82.9% 至 -80.2% |

三轮中每一对的原生 P95 均未超过基线的 105%。原始文件：

- `/private/tmp/deveco-native-ui-mcp-node22-20260908-1/evidence.json`
- `/private/tmp/deveco-native-ui-mcp-node24-20260908-1/evidence.json`

此前 Node 26 的未缓存原生实现在 1001/10001 节点的 P95 为 1.919/36.800 ms，基线为 1.193/8.703 ms，已明确失败并保留在 `/private/tmp/deveco-native-ui-mcp-node26-20260908-1/evidence.json`。内容缓存解决了反复读取同一树时重复解析、校验和跨线程复制的开销；每次仍实际读取并核对内容，不用文件时间代替内容身份。

首次请求不计入上述热路径，单独保存在 first_query_ms。Node 24 新服务器的首次小树请求约 87–89 ms，基线约 4 ms；首次大树请求约 80–81 ms，基线约 9–10 ms。原生首次请求包含懒加载运行服务、SQLite 或 CPU Worker 的成本，仍有优化空间，不能用热缓存结果宣称首次解析同样提速。

这些测量只证明保存树的固定精确 key 查询。实时 HDC 获取、文本/类型/批量查询、跨显示器操作、服务器与 SDK 子进程的 CPU/RSS、实际磁盘写入量及长时间资源回落仍属于独立验收。算法微基准记录不替代完整调用；本项通过也不解除正式版的其他性能门槛。

复现时使用对应 Node 版本先安装和编译原生验证目录，保持代码及设备环境不变，在空闲机器上串行执行：

```sh
node dist/scripts/native-ui-mcp-benchmark.js /absolute/frozen-baseline /absolute/new-evidence-directory 3
```

脚本拒绝覆盖旧证据，要求冻结基线提交及已跟踪文件不变；结束时再次核对编译文件、输入树、依赖锁和资源摘要。保留验证目录与原始证据，不在运行期间重新构建。

## 个人签名与录制协调修复后的复测

2026-09-08 使用 Node 24.14.1，在上述同一 macOS arm64 机器串行复测。冻结基线仍为 `aab1405b51e00e4036bdc8f18ae4229835de77b0`，从该提交新建独立 worktree 并安装锁定依赖。原生验证目录为 `~/Library/Caches/DevEcoMCP/validation/20260908-signing-16`，运行摘要为 `348c98d51d8593704d1b32bec8e7a4645d6071c9ad5bd2b4349c53894c3df7b4`，对应代码提交 `0fc8c2b`；该目录的 227 项回归已通过，测量期间没有修改或重建。

| MCP 目录调用 | 基线 P95 / ms | 原生 P95 / ms | 样本数 |
| --- | ---: | ---: | ---: |
| 冷启动初始化与工具目录 | 127.632 | 84.556 | 各 30 次 |
| 已连接后的工具目录查询 | 0.515 | 0.346 | 各 1000 次 |

目录证据为 `~/Library/Application Support/DevEcoMCP/acceptance/20260908-current-catalog-1/evidence.json`。冷启动 P95 低于一秒目标，但目录测量不包含运行服务首次启动或 SDK 执行。

完整 stdio MCP 离线 `ui_find` 仍使用三轮、每种大小各 20 次预热和 1000 次精确 key 查询，逐次验证命中内容：

| 节点数 | 基线 P95 范围 / ms | 原生 P95 范围 / ms | 三轮逐对变化 |
| --- | ---: | ---: | ---: |
| 101 | 0.647–0.658 | 0.423–0.464 | -35.8% 至 -28.3% |
| 1001 | 1.343–1.588 | 0.371–0.411 | -74.1% 至 -70.6% |
| 10001 | 10.146–12.124 | 1.783–1.863 | -85.3% 至 -81.8% |

九组逐对结果均通过 5% 退化门槛；证据 `~/Library/Application Support/DevEcoMCP/acceptance/20260908-current-ui-performance-1/evidence.json` 的 `completed:true`、`error:null`，并保存逐次数据和输入身份。

首次小树请求原生约 92–93 ms，基线约 4.5–4.7 ms；首次大树请求原生约 84–86 ms，基线约 9.7–10.2 ms。首次加载运行服务与 CPU Worker 的成本仍然存在。本次没有覆盖其他查询类型、实时设备、服务端与 SDK 的 CPU/RSS、磁盘写入或一小时会话运行，不解除相应发布门槛。历史失败和早期版本数据继续保留。


## native-6 当前采样

`20260908-native6-ui-mcp-performance-1` 在 Node24/source-8 中完成三轮、每版每规模1000次完整离线查询（共18000次）。101/1001/10001节点的每一轮P95均在5%预算内，逐对下降范围分别为9.3%–74.6%、52.4%–72.0%、58.3%–83.0%。该项只覆盖离线精确key查询，不能替代19项直接能力。

`20260908-native6-ui-performance-1.json` 保留三规模解析与四种选择器的延迟、CPU、RSS。中/大树首次解析P95分别为原生1.304/10.936ms、旧版0.983/9.075ms；索引查询较快不代表首次解析也较快。`20260908-native6-orchestration-performance-1.json` 各1000次独立采样，LangGraph无持久化、SQLite检查点往返及持久化图的P95分别为0.918/1.457/4.571ms。

第三次长稳 `sdk-soak-3` 在约22分钟、212轮时因设备不存在结束。原始HDC进程退出0、未截断且返回 `[Empty]`；前一轮和后续复查均能识别手机，具体USB或服务原因尚未证明。失败不计一小时通过。`device-readonly-2` 的14项复查通过后，启动独立第四次长稳。
