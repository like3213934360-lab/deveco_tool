# v1.4.3 明确 action、OpenCode 多轮验收与独立进程生命周期

优先保证模型能发现并正确使用功能。适配范围为 OpenCode、Codex；按用户要求，本轮不测试 Claude。2026-10-10 用户确认重启后，已补充 Codex App 原生验收。免费模型按每轮显式选择，不改变持久宿主配置、认证、SDK 或设备环境，不新增 Skill 自动分发和 Windows NTLM 代理。

## TODO 与证据

| 状态 | 工作 | 证据 |
| --- | --- | --- |
| [x] | 补明所有 action 工具入口并审查同类说明 | 14 个工具明确 `Required: action=<operation>`，doctor 没有 action；103 项发现夹具覆盖全部 102 个协议入口；15 个工具名称/title/annotations 保留，schema 仅改说明并补明引用的同值 type，不改执行校验 |
| [x] | 补齐条件参数与默认行为 | log/sqlite、lsp 的 op、license/license_view、review 两阶段、skills.names/scope、sign.keypair/profile_create、knowledge.status 的 check 默认值；catalog 仅 action、diagnose.build 仅 diagnostics |
| [x] | 拟调用和执行分开判定 | discovery 禁止实际工具调用；live 核对 OpenCode tool_use 与透明代理 tools/call/response，并要求正确输出和同 job_id 成功终态 |
| [x] | 真实进程生命周期根因修复 | 原候选模拟器在 OpenCode 退出时被终止；修复后原生启动会话退出，模拟器父进程已脱离宿主且设备继续在线；启动错误/非零退出仍失败 |
| [x] | 本地单测与类型检查 | typecheck；171/171 单测，零失败/跳过；真实 OS 进程、UTF-8 分片、大响应导出和评分器负例均覆盖 |
| [x] | 最终构建既有 SDK E2E 与性能 | 主流程 22/22，通用引导专项 1/1，均零失败/跳过且构建 ID 一致；既有套件未检查 reset 后原行为恢复，本轮补充验证发现失败。最终性能：握手中位 97 ms、清单 4 ms、空闲 RSS 64 MB（门禁 84 MB）、10 秒 CPU 不变 |
| [x] | OpenCode 免费模型多轮试验与失败归档 | 11 个免费模型，共 223 个候选/专项尝试；逐项保留构建身份、计划评分、原生调用、服务错误与中断，不将不同构建合并为发布版通过 |
| [ ] | OpenCode 最终构建模型复验 | 最后补明 test_step 后，Muse/MiMo 两个首轮均被免费 provider 限流；后续轮次与视觉流程未开始，不计通过；Codex 的结果不替代该项 |
| [ ] | 所有免费模型、所有 action 的原生执行全通过 | 未达到；计划覆盖不等于执行覆盖，不因发布而勾选 |
| [x] | Codex App 实际重载 | 用户确认重启后，原生 doctor 在验收前后均返回 v1.4.3 / `1444f7e…`，与发布构建一致 |
| [x] | Codex App 关键调用多轮验收与失败归档 | 当前模型 gpt-6-astra / xhigh；101 次原生调用涉及 15 个工具、63 个入口；log/sqlite、对象参数及 UI 测试/视觉评审各两轮通过；完整边界与失败见下文及公开证据 |
| [ ] | Codex 全功能验收通过 | 未达到；调用数不是通过数，当前会话不是无历史上下文的盲测；reset 与录屏失败仍保留 |
| [ ] | 热重载 reset 根因修复与行为回归 | 已复现返回 reset=true 但重启后补丁仍生效；须解决已启用补丁撤销，并在真实 SDK 测试中断言恢复原行为，不能只检查返回字段 |
| [x] | GitHub 提交、全部 CI、Release、tag、Latest | 发布提交 `583e9018628caedd27498dacae4155b9bd668827`；七项 CI、自动发布与只读复核均通过，tag 指向该提交且为 Latest；链接见交付记录 |

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

公开证据：[223 次模型试验逐项摘要](evidence/v1.4.3-models.json)、[发布前最终构建测试与独立产物检查](evidence/v1.4.3-acceptance.json)、[重启后的 Codex App 原生验收](evidence/v1.4.3-codex-app.json)。发布前证据保留当时的待验状态，后续进展由新证据记录。跨候选共请求过 74 个协议入口，其中 70 个有成功响应或已结束的成功任务；该数量包含不完整流程中的成功调用，不等于 70 个功能均已完整验收。

## Codex App 重启后的原生验收

用户确认后，直接由当前 Codex App 会话的 gpt-6-astra / xhigh 调用宿主暴露的 MCP，未改用 Codex CLI 或替换模型。验收前后 doctor 均确认 v1.4.3、构建 `1444f7e…`；使用原有 DevEco 26.0.0.821、SDK 26.0.0.105 / API 26、指定临时工程及专用模拟器。没有操作实体手机、其他模拟器、账号设置或持久宿主配置。

宿主加载 15 个工具、102 个协议入口，14 个 action 工具保留显式 `Required: action=<operation>.`。实际执行 101 次调用，涉及 15 个工具、63 个不同入口，包含故障诊断与测试工程恢复，不是 101 次通过或 63 项完整功能通过。两次协议错误分别是录屏取回失败，以及只读 shell 按策略拒绝 `bm quickfix -h`；另外两次 UI 断言揭示 reset 的行为失败，不能因该工具返回成功而忽略。

| 范围 | 实际证据 | 边界 |
| --- | --- | --- |
| action 与对象参数 | log/sqlite 各两轮真实调用成功；两轮 selector、visible 均传对象，点击和断言成功 | 本轮没有 OpenCode 的缺 action 或对象字符串问题；不证明所有模型都不会误用 |
| UI 测试与视觉评审 | 两轮 test_start → test_step 点击/visible → review 取图 → 模型看图后提交判断 → test_finish → test_export；每轮 4 步，零失败、未决评审，每轮导出 8 个文件 | 当前模型确实收到并查看两张评审图；不替代纯文本模型的控件验收，也不推断其能理解图片 |
| 构建与代码工具 | clean/sync/build、lint 零问题、LSP hover/definition/restart、日志和任务终态查询 | 5 个排队任务均使用同一 job_id 等到 succeeded，其中 1 个是失败后的工程恢复任务 |
| 部署与 UI 辅助 | deploy、stop/launch、路径录制/重放/删除自建流程、布局检查、视觉基线/相同比较、PNG 截图 | 截图文件头和尺寸独立检查；不是录屏验收 |
| 文件与本地签名 | 47 字节文件往返 SHA-256 相同；生成临时 keypair/CSR，OpenSSL 独立验证 CSR 签名和主体 | 不涉及云端证书或 profile 创建，不改变账号 |
| 热重载 | apply 后 UI 显示新文字；reset 返回成功后，重启仍显示补丁文字，原文字/补丁隐藏两项断言均失败 | reset 未通过，已归档为实现缺陷；完整重新部署只用于恢复测试工程 |
| 录屏取回 | 对现有待导出会话调用 record_stop，仍报 CAPABILITY_UNAVAILABLE / open source media file failed | 没有 discard、另录替代视频或生成假 MP4，待取回会话保留 |

当前会话包含历史实现、源码和夹具上下文，因此这些结果证明指定流程的真实调用与 SDK 行为，不能当作新会话的盲测发现能力。Codex 未保存原始 provider/传输层抓包，不能沿用 OpenCode 的参数逐字一致性结论。全部入口/参数组合、其他 Codex 模型、新引导页面、持久安装及云端写操作仍未完整验收；本轮没有证明 OpenCode 免费服务已经恢复。

原始返回、截图、测试报告、临时密钥和诊断输出仅保存在本地 `.scratch/v143/codex-app-20261010/`，公开文件只保留逐次调用入口、参数名/类型、状态和哈希。测试工程源码已恢复到原字节，完整部署后原文字断言通过且设备补丁版本为 0；这些恢复证据不改变 reset 的失败结论。本次只增加验收证据和文档，没有修改运行代码或既有测试。

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
- [ ] 修复已启用热重载补丁的 reset 行为；补齐重启后原文字可见、补丁文字不可见及设备补丁状态的真实 SDK 回归。
- [ ] 继续处理多传跨 action 参数、遗漏步骤、错误格式和超时；目前没有证据保证任意模型每轮都正确。
- [ ] 免费服务恢复后，补跑最终构建的 test_step 等专项、剩余纯文本轮次及视觉流程；保留本轮受阻记录。
- [ ] Codex 新会话的能力发现与剩余功能验收；当前会话的两轮成功调用不代替无历史上下文的盲测。
- [ ] Windows OpenCode 原生生命周期实机验收；跨平台进程单测与该验收分开。

## 已发现的真实失败

- Codex 原生验收发现 hot_reload.reset 的成功返回不等于撤销生效：apply 后显示补丁文字，恢复源文件并 reset、stop/launch 后仍显示补丁文字，设备查询仍报告补丁版本 3000001。[官方 bm 文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/bm-tool-V5) 将 `quickfix -r -b` 定义为卸载未使能的补丁；当前 `src/domains/hotreload.ts` 却把命令成功解释为恢复安装代码并删除本地基线。这是 MCP 实现语义错误，不能归因于模型或宿主。已有 E2E 只检查 `reset.reset === true`，缺少重启后的行为断言，因此此前 E2E 通过不能证明 reset 正确。本轮未修复；显式重新部署只用于恢复临时工程，不作为降级实现或通过证据。
- 初始完整 UI 压测发现指定模拟器端口有此前遗留的待导出录屏记录；模型先尝试取回，失败后擅自调用 discard=true，违反“不丢弃录像”的任务约束。这清除了该会话的待导出标记，工具声明媒体文件仍留在设备图库；未删除媒体文件。原始违规调用和中断记录保留，不计通过。随后增加转发前禁止动作检查，后续命中同类行为会在执行前结束试验。
- 新录屏尝试返回 `CAPABILITY_UNAVAILABLE`：SDK 的 mediatool 报 open source media file failed。只读查询确认媒体库存在记录，但对应 MP4 文件为 0 字节；尚未查明系统录制器生成空文件的更深层原因。没有切换设备、重置模拟器、改 SDK 或生成替代 MP4。录屏导出仍未通过，保留会话；另建的 UI 专项不包含录屏，不能替代该失败项。
- 纯文本 Lightning 首轮擅自使用 OpenCode task/explore 读取工程，违反只用 MCP 的任务约束；子会话导出确认仍为同一个免费模型，但该轮属于外部上下文污染，整体失败，不能证明仅凭工具说明完成任务。
- 目录中的 exo-free 返回 HTTP 410，ling-3.0-flash-fin-free 返回模型不可用；部分模型会超时或生成无效 JSON。服务可用性与模型输出问题分别记录，不切换付费模型兜底。

## 交付

最终运行构建 ID：`1444f7e71f76a5368079e3055ca0b88395e32a55dcfe5776833bbed324c64843`。

- 发布提交：[583e9018628caedd27498dacae4155b9bd668827](https://github.com/like3213934360-lab/deveco_tool/commit/583e9018628caedd27498dacae4155b9bd668827)。
- [CI 38040132557](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38040132557)：Windows/macOS/Linux × Node 22/24 六项测试，以及上游门禁全部通过，无跳过任务。
- [Release 工作流 38040199340](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38040199340) 成功；已下载 `verified-release` 并执行 `node tools/release.mjs --run 38040132557 --check`，[公开回执](evidence/v1.4.3-release.json) 一致确认 [v1.4.3](https://github.com/like3213934360-lab/deveco_tool/releases/tag/v1.4.3) 为 Latest、tag 指向发布提交。
- 本文件的发布回填为后续文档提交，不移动或重建已发布 tag；该提交仍须经过全部 CI 和既有 Release 核验。

GitHub 发布、npm 发布和宿主重载各自独立。OpenCode 临时验收进程已加载最终工具清单，但模型调用被限流；这不代表用户持久会话已重载。Codex App 已在用户确认后通过验收前后两次 doctor.server.build_id 确认运行发布构建，并完成上述原生调用；仍有明确失败与未覆盖项。未运行 npm 发布。
