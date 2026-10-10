# v1.4.3 明确 action、OpenCode 多轮验收与独立进程生命周期

优先保证模型能发现并正确使用功能。适配范围为 OpenCode、Codex；按用户要求，本轮不测试 Claude，Codex 必须等用户再次确认重启后才开始。免费模型按每轮显式选择，不改变持久宿主配置、认证、SDK 或设备环境，不新增 Skill 自动分发和 Windows NTLM 代理。

## TODO 与证据

| 状态 | 工作 | 证据 |
| --- | --- | --- |
| [x] | 补明所有 action 工具入口并审查同类说明 | 14 个工具明确 `Required: action=<operation>`，doctor 没有 action；103 项发现夹具覆盖全部 102 个协议入口；15 个工具名称/title/annotations 保留，schema 仅改说明并补明引用的同值 type，不改执行校验 |
| [x] | 补齐条件参数与默认行为 | log/sqlite、lsp 的 op、license/license_view、review 两阶段、skills.names/scope、sign.keypair/profile_create、knowledge.status 的 check 默认值；catalog 仅 action、diagnose.build 仅 diagnostics |
| [x] | 拟调用和执行分开判定 | discovery 禁止实际工具调用；live 核对 OpenCode tool_use 与透明代理 tools/call/response，并要求正确输出和同 job_id 成功终态 |
| [x] | 真实进程生命周期根因修复 | 原候选模拟器在 OpenCode 退出时被终止；修复后原生启动会话退出，模拟器父进程已脱离宿主且设备继续在线；启动错误/非零退出仍失败 |
| [x] | 本地单测与类型检查 | typecheck；171/171 单测，零失败/跳过；真实 OS 进程、UTF-8 分片、大响应导出和评分器负例均覆盖 |
| [x] | 最终构建真实 SDK E2E 与性能 | 主流程 22/22，通用引导专项 1/1，均零失败/跳过且构建 ID 一致。最终性能：握手中位 97 ms、清单 4 ms、空闲 RSS 64 MB（门禁 84 MB）、10 秒 CPU 不变 |
| [x] | OpenCode 免费模型多轮试验与失败归档 | 11 个免费模型，共 223 个候选/专项尝试；逐项保留构建身份、计划评分、原生调用、服务错误与中断，不将不同构建合并为发布版通过 |
| [ ] | 最终构建模型复验 | 最后补明 test_step 后，Muse/MiMo 两个首轮均被免费 provider 限流；后续轮次与视觉流程未开始，不计通过 |
| [ ] | 所有免费模型、所有 action 的原生执行全通过 | 未达到；计划覆盖不等于执行覆盖，不因发布而勾选 |
| [ ] | Codex App 重载与模型验收 | 等用户再次确认重启；没有在本轮擅自开始 Codex 模型测试 |
| [ ] | GitHub 提交、全部 CI、Release、tag、Latest | 发布后记录 SHA、工作流与核验回执 |

## 修正依据与边界

上次两个失败是模型在拟调用文本中省略 `device.action`。OpenCode 发往模型的 schema 保留 `required` 和 action 枚举，原始模型回答与宿主显示一致；原生 tools/call 的 log/sqlite 能成功。普通回答 JSON 并不等于 schema 约束的工具调用。本次补明操作入口，保留 schema 和执行校验，不猜测或补全缺少的 action。

扩展检查还发现跨模型重复的条件参数误用：`skills.export` 使用单数 name、项目配置缺少 scope、keypair 错用 keystore/key_password、profile_create 不知道 id 是证书 ID。它们有明确的说明缺口，已修正。离线 status 必须 `check=false`，默认 true 会联网，因此明确默认值；不把实际联网当作离线成功。

原生调用继续发现可修正问题：多个模型把 search 的过滤参数传给 knowledge.catalog，或把 crash 的 project 传给 diagnose.build，故明确这两种 action 的参数边界。UI test_start 的返回值和 test_step 的错误提示则错误建议了 assert，公开接口实际使用顶层 visible/hidden；已修正返回说明，不改变 schema 或放宽验证，并补充真实 SDK 的提示与非法调用回归。最后的规划批次仍有模型将 test_step 理解成仅记录文字，故在工具描述中也补明 test_id、op/selector 或 visible/hidden；这一步模型复验被 provider 限流阻塞，不能声称已经验证改善效果。

新增的 UI 原生试验发现 MiMo 把 selector/visible 对象反复编码成 JSON 字符串。可选观测插件只克隆读取真实 fetch 响应，不改请求、Response、模型或持久配置；基线首轮 15 个原始 provider 调用全部把 selector 输出为字符串，与 MCP 参数逐项一致。因超时缺少末尾 provider 回执的轮次另标为证据不完整，不宣称整轮对应成功。原始 schema 的 `$ref` 指向完整对象定义，仅补充 prose 对象示例仍可复现。现在保留引用及全部属性，同时在顶层参数上重复声明其已定义的 type，让读取直接类型的工具解析器也能正确识别；不内联删减属性，不自动解析字符串，不改变校验规则。同一定位夹具中，MiMo、Muse 各两轮均一次成功，4/4 原生调用通过；每轮原始 provider 参数与 MCP 参数完全一致、selector 均为对象。此前仅增加对象示例仍失败。证据定位到 provider/model 对引用类型的兼容性，不能臆测不可见的服务端解析实现；该专项只验证对象参数，不代表完整 UI 或视觉验收。

OpenCode 1.18.35 的 [MCP 清理源码](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/mcp/index.ts) 在退出时遍历并终止后代进程。原先 `detached=true` 只建立独立进程组，程序仍在宿主后代树内。实测 SDK 日志中的模拟器退出时刻与宿主退出吻合。现在由短暂 Node 启动进程保留启动期的 PID/退出码/日志，开机和 HDC 核验后释放父进程；等待父进程退出才返回。没有改宿主清理策略、SDK、启动选项或失败判断。

与已发布 v1.4.2 元数据逐项比较：仅忽略 description 和与引用定义完全相等的冗余 type，其余工具名称、title、annotations、schema 约束全部相同；公共 instructions 字节相同。

公共 instructions 仍为 1,737 bytes，15 个工具的任务索引与关键约束保留；最终 tools/list 36,862 bytes，仍在原 36 KiB 门禁内。最长工具描述 1,594 字符。不因 tokens 指标删除必要能力，也不声称所有模型用相同 tokenizer。

## 发布前上游新增审查

上游 CLI 在本轮验收期间新增了 `verify` / `verify init` / `verify log` / `verify screenshot`（`ea2e5c1`，合并至 `372879f`）。已审查全部生产文件：CLI 启动独立的 ui-verification-mcp 并注入视觉模型配置，查询并缓存日志与截图；附带认证存储目录规范化。

本 MCP 现有 test_start/test_step/review/test_finish、test_log/test_export 覆盖测试会话和产物能力，由宿主模型执行计划、判断图像；不宣称与上游嵌套模型自动执行相同。模型 URL、名称和密钥归宿主管理；纯文本模型的图像判断不适用。没有引入嵌套模型依赖、忽略导出错误或上游 CLI 的缺配置停止指令。

更新逐项决策后，上游门禁 491 项：374 映射、74 宿主职责、43 有依据排除；partial/undecided/invalid/stale 均为 0，无未审查提交。该静态能力映射不替代模型或 SDK 实际验收。

## 可复现验收

- `tools/model-eval.mjs`：固定不可变编译入口；保存实际元数据、prompt、宿主事件、会话导出、MCP 请求/响应和 SHA-256。只在子进程覆盖被测 MCP 路径，保留用户的其余宿主与 provider 设置。
- `tools/model-capture.mjs`：使用 `--capture-provider true` 只在当前 OpenCode 子进程加载观测插件，保存请求正文与原始 SSE，不保存认证头；公开摘要仅给出类型、对应关系和哈希。
- `tools/model-matrix.mjs`：运行前核对 OpenCode 目录中的 toolcall 能力及 input/output/cache 免费价格；每个模型和轮次独立留档，失败不切换模型重试，不覆盖旧记录。目录免费不代表服务端当前可用。
- `tools/model-live-cases.mjs`：只读环境、设备、SDK/LSP、知识库、Skills、鉴权状态与任务查询。
- `tools/model-workflow-cases.mjs`：只对明确给定的临时工程和测试模拟器操作，包含构建/任务/LSP/文件传输/本地密钥/CSR，以及部署/截图/路径重放/测试报告/录屏/布局对比；`ui-text` 专项只使用控件树、定位、点击与断言。

```sh
npm run build
node tools/model-matrix.mjs --out /absolute/new-discovery --rounds 2 --cases test/fixtures/model-scenarios.json
node tools/model-matrix.mjs --out /absolute/new-actions --rounds 3 --batch-size 26 --models opencode/muse-spark-1.3-contributor-free
node tools/model-live-cases.mjs /absolute/disposable-project emulator-target /absolute/new-cases.json
node tools/model-eval.mjs --host opencode --model opencode/muse-spark-1.3-contributor-free --suite live --cases /absolute/new-cases.json --out /absolute/new-live
```

真实模型验收不伪造设备或 SDK 回复；转发前阻断夹具明确禁止的操作、不同目标设备和工程，记录 blocked 后结束连接，不编造 MCP 返回；被阻断的轮次仍失败。评分器的单元测试使用固定正反例，与真实模型证据分开。OpenCode 大会话导出必须写常规文件，避免其进程退出前管道未完全刷新造成 64 KiB 截断；观察代理用 StringDecoder 保留跨 chunk 的 UTF-8，转发字节原样不变。模型自身返回不合法 JSON 则记为失败，不修补答案。

静态评分仍严格保留完整参数期望。例如参考相对文件路径与模型给出的等价绝对路径、完整树省略默认 depth=0，会留下不匹配记录；没有改夹具使其通过，也不将这些差异直接归为 MCP 功能故障。原生成功调用另有传输证据。生成的工程/API/deviceTypes、文件传输哈希、CSR 签名与主体、PNG 文件签名另做独立核验；`.png` 后缀的 JPEG 不算 PNG 成功。

拟调用评分检查公开 JSON Schema 和场景要求，不执行服务端每个 action 的参数白名单。因此拟调用通过只说明满足这两层检查，不能证明所有参数组合会被执行器接受；额外跨 action 参数由原生调用验收记录，不能以规划得分抵消执行错误。

模型能力与 MCP 功能分开验收。以本次 OpenCode 目录为准，Big Pickle、两种 Ling、两种 Nemotron 不支持 image 输入；它们可以验收控件树、控件断言与一般工具调用，但不能证明截图视觉判断。视觉评审夹具标注 requires=image，批次执行前校验能力，不切换模型兜底。已运行视觉流程的 Muse、MiMo、LongCat 均声明支持 image；能力声明只证明适用性，实际图片理解仍需模型调用证据，不因目录声明自动通过。

原始记录在本地 `.scratch/v143/`，含路径、设备与账号信息，不上传。公开摘要仅包含去标识结果与哈希。已中止的候选批次、服务端不可用、测试编排中断和最终构建分别记录；不能挑选好的一轮代表全部通过。

公开证据：[223 次模型试验逐项摘要](evidence/v1.4.3-models.json)、[最终构建测试与独立产物检查](evidence/v1.4.3-acceptance.json)。跨候选共请求过 74 个协议入口，其中 70 个有成功响应或已结束的成功任务；该数量包含不完整流程中的成功调用，不等于 70 个功能均已完整验收。

## 多轮结果的解释

29 项能力发现场景、103 项全入口拟调用场景、原生 tools/call 流程分别计分。拟调用回答若缺场景或 JSON 无法解析，该批不算通过；成功规划不证明 SDK 执行。原生整轮通过还要求没有错误调用、没有越界工具、没有未完成任务，即使模型后续纠正，也保留最初错误。

较早的 `8ff4841…` 候选进行了 11 个免费模型 × 两轮发现、11 个模型 × 两轮只读调用，以及 Muse/MiMo/LongCat 各三轮全入口拟调用。发现试验中 Muse 58/58；全入口拟调用分别为 Muse 274/309、MiMo 193/309、LongCat 191/309。无法解析或服务失败的批次计零，不只统计有答案的样本。只读流程仅 Space Bunny 第二轮整轮通过，其余仍有遗漏、额外参数、服务错误或越界使用宿主工具；这些结果不能转记为最终构建验收。

`3e60d57…` 候选另做两种模型各两轮全入口拟调用、对象参数对照，以及纯文本控件流程。视觉流程单列，目录声明 image 只是适用条件；实际图像判断必须来自完成的 review 调用。录屏失败专项独立保留，不被不含录屏的流程替代。逐轮结果以公开摘要为准。

| 候选专项 | 实际结果 | 边界 |
| --- | --- | --- |
| 全入口拟调用，Muse 两轮 | 74/103、50/103 | 漏场景、无效 JSON、服务失败的批次计零；两轮整体均未通过 |
| 全入口拟调用，MiMo 两轮 | 50/103、74/103 | 包含无效 JSON、超时和参数错误；两轮整体均未通过 |
| selector 对象参数，Muse/MiMo 各两轮 | 4/4 整轮通过 | 每轮一次成功调用，provider 原始参数和 MCP 参数一致；不代表全部 UI |
| 纯文本 UI | 8 次已启动，0 次整轮通过 | 其中 Big Pickle、Nemotron 首轮有真实点击及前后断言；仍有漏步骤、错误参数或越界工具，不能抵消 |
| 最终 `1444f7e…` 工具说明 | 元数据加载成功，模型复验受阻 | 两个首轮均收到 provider 限流，无实际工具调用；停止后续队列 |

后期 OpenCode 日志明确记录 Muse/MiMo 的 `Rate limit exceeded` 与 Ling 的 `Model is unavailable`；宿主仍在重试，部分 CLI 事件文件尚无错误输出。因此同时保存宿主日志证据，区分服务阻塞与模型参数错误。停止时 Ling 3.1 第二轮已启动但尚无工具调用，记为编排中断；两个 Nemotron 第二轮、两个模型的最终规划第二轮、四个最终视觉轮次未执行。没有切换付费模型、重置额度、改变 provider 或修改测试标准。

## 尚未完成的验收

- [ ] 所有 102 个入口在全部免费模型上的原生成功执行；103 项规划夹具不能替代。账号登录/注销/迁移、云端创建与删除、镜像安装/删除、知识包安装与回滚等不改变持久环境的限制内无法完整执行，不能从只读检查推断成功。
- [ ] 解决录屏系统服务产出空文件的问题，并重新验收真实 MP4 导出。
- [ ] 继续处理多传跨 action 参数、遗漏步骤、错误格式和超时；目前没有证据保证任意模型每轮都正确。
- [ ] 免费服务恢复后，补跑最终构建的 test_step 等专项、剩余纯文本轮次及视觉流程；保留本轮受阻记录。
- [ ] Codex App 用户确认重启后的实际构建 ID 与模型验收；Windows OpenCode 原生生命周期尚无实机证据，跨平台进程单测与该验收分开。

## 已发现的真实失败

- 初始完整 UI 压测发现指定模拟器端口有此前遗留的待导出录屏记录；模型先尝试取回，失败后擅自调用 discard=true，违反“不丢弃录像”的任务约束。这清除了该会话的待导出标记，工具声明媒体文件仍留在设备图库；未删除媒体文件。原始违规调用和中断记录保留，不计通过。随后增加转发前禁止动作检查，后续命中同类行为会在执行前结束试验。
- 新录屏尝试返回 `CAPABILITY_UNAVAILABLE`：SDK 的 mediatool 报 open source media file failed。只读查询确认媒体库存在记录，但对应 MP4 文件为 0 字节；尚未查明系统录制器生成空文件的更深层原因。没有切换设备、重置模拟器、改 SDK 或生成替代 MP4。录屏导出仍未通过，保留会话；另建的 UI 专项不包含录屏，不能替代该失败项。
- 纯文本 Lightning 首轮擅自使用 OpenCode task/explore 读取工程，违反只用 MCP 的任务约束；子会话导出确认仍为同一个免费模型，但该轮属于外部上下文污染，整体失败，不能证明仅凭工具说明完成任务。
- 目录中的 exo-free 返回 HTTP 410，ling-3.0-flash-fin-free 返回模型不可用；部分模型会超时或生成无效 JSON。服务可用性与模型输出问题分别记录，不切换付费模型兜底。

## 交付

最终运行构建 ID：`1444f7e71f76a5368079e3055ca0b88395e32a55dcfe5776833bbed324c64843`。

GitHub 发布、npm 发布和宿主重载各自独立。未运行 npm 发布；Codex App 是否运行新版，等待用户重启后的 doctor.server.build_id 证明。
