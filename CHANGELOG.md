# Changelog / 更新日志

## v1.4.4 (2026-10-10)

**中文**

- 修复 hot_reload.reset 的命令语义：经用户明确选择，改为覆盖安装预存的原始 HAP/HSP，保留应用数据，不编译当前源码、不卸载、不切换方案。校验设备、bundle、安装标识及包哈希，设备确认补丁版本为 0 后才返回成功并清理基线。旧基线缺少归档时明确要求新建，不伪造恢复。
- 录屏启动需要 ACTIVE 服务证据；持久化启动/停止意图与服务身份，防止误停其他录制和取消后重复切换。媒体条目必须唯一，导出错误保留原始原因和待取回会话，不把打开源文件失败一律误判为能力缺失；同时报告导出与清理失败。
- 补齐离线负例与严格设备 E2E：reset 必须恢复原页面行为，录屏必须有实际视频帧并可严格解码。按用户要求，本轮设备/宿主实测等待 Codex 重启通知；旧 API 26 的 0 字节录像成因与新版真实取回仍待验证，不宣称已完全解决。见 [验收与 TODO](docs/UPGRADE-1.4.4.md)。

**English**

- Reset now explicitly restores archived baseline HAP/HSP packages by replacement install, as authorized by the user. It preserves app data, verifies package hashes and installation identity, and requires patch version zero before success. No rebuild, uninstall or alternate recovery path; legacy baselines require a new deployment.
- Confirm an ACTIVE recorder service after start, persist toggle intent and service identity, reject ambiguous media, and retain failed exports. Unreadable media is no longer mislabeled as unsupported capability; cleanup failures remain visible.
- Add negative regressions and strict reset-behavior/video-decoding E2E checks. Device and host acceptance is deferred until the user confirms a Codex restart. The original API 26 zero-byte recording's cause and successful retrieval remain unverified; see [acceptance and TODO](docs/UPGRADE-1.4.4.md).

## v1.4.3 (2026-10-10)

**中文**

- 为 14 个 action 工具统一补明必填操作入口，doctor 明确没有 action；补齐日志/SQLite、LSP、协议阅读与接受、视觉评审两阶段、Skill 导出/作用域、签名字段、知识包离线状态的参数说明。保留全部公共能力索引、参数校验和原有大小/性能门禁。
- 保留完整 `$ref`，在顶层参数重复声明引用定义的同值 type，修复部分免费模型把 selector 对象编码成字符串的兼容性问题；不猜测类型、不自动解析模型字符串、不改变输入校验。两种模型、各两轮原生调用及 provider 原始响应对照通过。
- 修复 OpenCode 退出时模拟器被宿主清理的问题：独立程序通过短暂启动进程观察启动，再退出父进程，完成进程脱离后才返回；保留启动失败、日志和实际开机检查，不重试或替换启动选项。
- 修正 UI 测试会话返回提示：断言步骤使用公开参数 visible/hidden，避免模型按旧提示传入不被接受的 assert；保留严格校验并补充真实 SDK 回归。
- 扩展为覆盖 102 个协议入口的 103 项拟调用场景，以及独立的真实调用验收。记录宿主事件、原始 MCP 请求/响应、模型与构建身份，核对异步任务终态；免费模型多轮试验保留所有失败，不修补模型答案、不把计划计作执行；按输入模态区分文字控件操作与视觉验收。范围、证据和未验证项见 [升级 TODO](docs/UPGRADE-1.4.3.md)。

**English**

- Explicit required-action guidance for 14 tools, with doctor exempt. Clarified conditional parameters and defaults for logs, SQLite, LSP, license acceptance, visual reviews, skills, signing and offline knowledge status without changing validation constraints or existing budgets.
- Preserve complete `$ref` definitions and repeat their declared type at top-level arguments for provider interoperability. Two models passed two native-call rounds each, with raw provider/MCP argument equality; no string coercion or relaxed validation.
- Keep independently launched emulators alive after OpenCode exits by releasing their short-lived startup parent before reporting success. Startup diagnostics and boot checks remain intact; no option retry or downgrade.
- Correct UI test continuation hints to use the public visible/hidden fields instead of the rejected assert field, retaining strict validation and adding real-SDK regression coverage.
- Added 103 planning scenarios covering all 102 protocol entries and separate transport-verified execution trials. Multi-round free-model results retain failures, model/build identities and asynchronous terminal states. See [acceptance and remaining work](docs/UPGRADE-1.4.3.md).

## v1.4.2 (2026-10-10)

**中文**

- 修正过度压缩：公共说明恢复全部 15 个工具的任务索引，以及 SDK 依据、UI 引导、批量操作、回放、断言和完整产物读取规则。工具描述保留独立调用所需的条件，补充自动签名的设备范围、模拟器端口限制、注销和滚动流畅度用途。
- 同时考虑 Codex、OpenCode 和 Claude 的不同加载方式；移除上一版过紧的公共说明/重复展开字节门禁，改查默认截断边界，继续报告开销。参数校验、执行逻辑、原 tools/list 和运行性能预算不变，不增加宿主特例或降级路径。
- 新增覆盖 15 个工具的 29 项真实模型发现试验、独立只读执行试验及评分器测试。保留失败、接口/余额阻塞和构建身份；不将方案输出等同于执行成功。Codex App 已在重载后完成实际调用。逐宿主证据及未完成项见 [升级 TODO](docs/UPGRADE-1.4.2.md)。

**English**

- Restored a discoverable index of all 15 tools and shared SDK, UI onboarding, batching, replay, assertion and artifact guidance. Standalone descriptions clarify automatic signing scope, emulator port restrictions, logout and scroll performance.
- Accounted for Codex, OpenCode and Claude loading behavior. Replaced overly tight shared/repeated instruction byte gates with truncation checks while retaining size reports, tools/list and runtime budgets. Validation and handlers are unchanged; no host-specific fallback was added.
- Added 29 real-model planning scenarios, separate read-only execution trials and grader tests. Failed trials, provider blockers and build identities remain recorded; proposed calls are not execution evidence. Reloaded Codex App calls were verified. Host-specific results and remaining work: [upgrade TODO](docs/UPGRADE-1.4.2.md).

## v1.4.1 (2026-10-10)

**中文**

- 查明公共说明重复来自宿主工具展开层：MCP 握手发送一次，原始工具清单没有重复前缀。将操作专属规则保留在对应工具，公共说明从 442 缩至 121 tokens；按现有宿主格式推算全量展开从 13,899 降至 9,008 tokens（-35.2%，o200k_base），不等同于宿主重载实测或每轮计费。
- 保留全部 15 个工具、参数 Schema、校验及执行逻辑；保留知识来源优先级、任务续等、UI 引导与断言、设备/团队选择和完整 artifact 读取约束。
- 新增独立提示词审计命令、UTF-8 字节计数及公共说明/重复展开体积门禁，防止只检查 tools/list 而遗漏宿主放大效应。验收与发布状态见 [升级 TODO](docs/UPGRADE-1.4.1.md)。

**English**

- Traced instruction repetition to host tool expansion, not MCP tools/list. Scoped operational guidance to its tool and reduced shared instructions from 442 to 121 tokens. Projecting the verified host format gives 13,899 -> 9,008 tokens (-35.2%, o200k_base); this is not a reloaded-host measurement or per-request billing.
- All 15 tools, input schemas, validation and handlers remain unchanged. Source precedence, job continuation, UI onboarding/assertions, ambiguity handling and full-artifact access remain documented.
- Added a prompt audit command, UTF-8 byte accounting and budgets for shared instructions and repeated-prefix expansion. Acceptance: [upgrade TODO](docs/UPGRADE-1.4.1.md).

## v1.4.0 (2026-10-10)

**中文**

- 建项支持六种 `device_types` 及组合，默认 phone、去重并返回实际配置；类型、SDK 映射和文件冲突在写入前验证，修复 Windows 模板路径匹配。
- 模拟器支持显式 `coldboot` / `snapshot` / `reset`、单实例固定 `hdc_port`，保留 `cold` 和 `window`。参数冲突、端口占用及已运行实例的设置变更明确报错，不换模式或端口重试。
- 启动核验实例身份、实际端口和真正开机完成；并发启动隔离，取消和超时不再误报成功，失败保留独立诊断日志。
- 针对 SDK 无快照时静默冷启动的行为，启动前只读检查 Quick Boot 快照索引，并验证本次恢复日志；历史日志、缺失快照或 SDK 降级不能作为成功依据。
- 自动处理扩展为通用引导链：首次设置、欢迎页及功能介绍按语义和控件状态识别，保留已选默认项；操作、批量、回放和测试共用，单独记录 `onboarding_completed`，页面不变或循环明确失败。新增独立开关 `auto_complete_ui_onboarding`。
- 补齐 GitHub 自动发布：新版 main 的全部 CI 通过后创建 Release，回读核验 tag、提交和 Latest，生成发布回执；仓库规范明确交付终点，避免只推送代码而遗漏发布。
- 按用户确认，空闲 RSS 预算允许相对原 70 MB 上限增长 20%（84 MB）；其余性能门禁及测试环境保持不变。
- 保持独立 MCP 实现；按用户要求排除 Skill 自动分发/版本同步和 Windows NTLM 代理。逐项验收与交付记录见 [升级 TODO](docs/UPGRADE-1.4.0.md)。

**English**

- Six project device types and combinations, validated before writing and reflected in the generated module; portable template path matching on Windows.
- Explicit emulator boot modes and fixed single-instance HDC ports, with legacy cold/window support and strict conflict checks. No alternate-mode or alternate-port retry.
- Startup succeeds only after identity, actual port and boot completion checks. Bounded waits, cancellation, concurrent-start protection and isolated failure diagnostics.
- Saved Quick Boot metadata and current-attempt restore evidence prevent the SDK's silent snapshot-to-coldboot substitution from being reported as success.
- Generic first-run setup and feature-tour handling preserves selected defaults across actions, batches, replay and tests. Separate onboarding evidence and configuration, bounded transitions and unchanged-page detection.
- Successful main CI automatically publishes new stable versions and verifies the release, commit, immutable tag and Latest status, with an auditable receipt and repository delivery rules.
- User-approved idle RSS headroom: 20% over the prior 70 MB budget (84 MB); other performance gates and the test environment remain unchanged.
- No upstream CLI runtime dependency, automatic Skill distribution/synchronization or Windows NTLM proxy. Acceptance details: [upgrade TODO](docs/UPGRADE-1.4.0.md).

## v1.3.3 (2026-10-04)

**中文**

- 协议与权限弹窗自动处理通用化：根据同一窗口的文案、按钮及勾选状态识别，不绑定应用名称或控件 ID；普通 UI 操作、批量操作、流程回放、部署及测试断言共用同一逻辑。默认开启，可用 `auto_accept_ui_agreements=false` 关闭；结果保留自动同意记录。
- 自动签名改为分阶段持久化任务：新材料通过校验后才原子切换工程配置，失败保留旧签名；只补偿本次明确创建的资源，中断且结果未知时先核对回执，强制恢复不能重复云端创建。
- MCP 严格验证 JSON-RPC 请求、通知、初始化和取消；畸形输入不再终止进程，必填 prompt 参数不再插入 undefined。
- 知识包取消传到底层下载；流式下载校验和原子切换保护已安装包，同版本替换失败可恢复，未发布的默认包给出上游/本地安装路径。
- forms 布局不再解析无关设备，模拟器使用专属实例并等待真正停止后清理；已有实例的 force 覆盖明确报告当前 SDK 不支持。
- 修复 UI agent 首次连接及分片 UTF-8 响应；发送后的副作用不盲目重试。录像导出失败保留可恢复会话并清理本次临时文件；流程草稿可重连查询且按工程隔离。
- 新增协议、持久化故障、签名补偿/进程中断、下载故障、通用弹窗及宿主写入回归。当前验收与外部限制见 `docs/audit/REPAIR-1.3.3.md`。

**English**

- Generic agreement and permission handling shared by UI actions, batches, replay and deploy/test assertions; text and control state replace app-specific IDs. Enabled by default, configurable with `auto_accept_ui_agreements=false`, with an acceptance record in results.
- Durable staged auto-signing validates new material before switching configuration and preserves the old chain. Compensation is limited to attempt-owned resources; uncertain effects require reconciliation even with force.
- Strict JSON-RPC validation, live cancellation propagation, atomic knowledge updates, owned layout emulators, truthful force capability errors, agent connection/frame cleanup, recoverable recording exports and project-isolated flow drafts.
- Regression and acceptance evidence, including external limits, is recorded in `docs/audit/REPAIR-1.3.3.md`.

## v1.3.2 (2026-10-02)

**中文**

- **告诉宿主 AI 完整内容在哪里**：工具返回的都是摘要，完整内容（构建日志、崩溃报告、hilog、shell 输出、云端答案）存在 artifact 里。以前只有构建失败和云端知识库会提示怎么读，崩溃报告、设备日志等只给一个 id。现在由服务器统一处理：任何返回（包括错误、嵌套在 `reports[]` 或 `details` 里的）只要带有 artifact，都会附上 `read_full`，写明 `job action=read artifact_id=<id>`；服务器给宿主的总说明和 `deveco-mcp-workflow` SKILL 里也加了这条。真机上验证了构建失败、`diagnose crash`、`device log` 三种返回。

**English**

- **The host is told where the complete content is**: every response carrying an artifact (build log, crash report, hilog, shell output, cloud answer; also inside errors and nested results) now gets a `read_full` line with the exact `job action=read artifact_id=<id>` call, added centrally by the server. The server instructions and the deveco-mcp-workflow skill say the same.

## v1.3.1 (2026-10-02)

**中文**

修复 v1.3.0 全面审查（`docs/audit/REVIEW-1.3.md`）发现的问题。每项都在 Mate 80 + MyStarRing 上用对应的审查脚本复测过。

- **单次调用不再超过宿主超时**：`timeout_ms` 超过 52 秒（`ui assert`、`test_step`、`steps` 里每一步）会被截断并附注说明；`ui act steps` 整次调用最多 52 秒，到时返回已完成的步骤和 `stopped_at`，从那一步继续调用即可。以前 `assert timeout_ms=70000` 会让宿主先超时、什么都拿不到。
- **`after` 更准**：只统计 app 自己、当前在屏幕上的控件（不再混入状态栏）；页面/弹层容器变化、一半以上内容被替换或窗口变化都判为 `navigated`，切换页签也能正确识别。
- **少读界面树**：`steps` 只在下一步要按选择器找控件时才重新读取界面；单次 `act` 复用上一次操作留下的界面树，滚动这类本身就慢的操作不再额外等 400 毫秒。10 步混合路径 20.8 秒 → 16.1 秒。
- **状态库损坏自动恢复**：`state.db` 损坏时改名备份为 `state.db.corrupt-<时间>` 并重建，第一次返回和 `doctor` 会说明丢了什么（任务记录、录制草稿、登录）。
- **截图对比识别整屏变暗**：整屏亮度一致变化（调暗、夜间模式、半透明遮罩）报告为 `global_shift`，扣除后再比较；变化超过一半时额外保存当时的截图（`current_artifact`）。
- **`tools/list` 从 45.3 KB 降到 36.1 KB**：去掉整数参数无意义的 ±2^53 边界、操作类型只定义一次、说明文字精简。单元测试设了 36 KB 硬上限。
- **prompts 更新**：`fix-build` 不再要求每轮先 `code check`；`debug-crash` 先用 `build_run` 返回的 `crash.source`。
- 其他：单次 `act` 和 `steps` 对同名控件的选择规则一致；增量预检会一并检查引用了被改文件的文件；cppcrash 只取崩溃线程的调用栈；热修复状态和截图基准改为原子写入；flow 文件损坏报 `FLOW_INVALID` 并给出文件路径；设备中途断开报 `DEVICE_UNAVAILABLE`；`device log` 内联内容限制在约 7 KB。
- 文档：热修复耗时改为实测值（`hot_reload` 约 5 秒，自动热修复 6–10 秒）；`wait` 默认值随动作不同。

**English**

Fixes for the issues found by the v1.3.0 review (`docs/audit/REVIEW-1.3.md`), each re-tested with its review script on a Mate 80 with MyStarRing.

- **No call outlives the host's request timeout**: `timeout_ms` above 52 s (ui assert, test_step, every step) is capped with a note; one `ui act steps` call lasts at most 52 s and then returns the finished steps and `stopped_at`.
- **Accurate `after`**: only the app's own on-screen elements (no status bar); a page/overlay container change, half the content replaced or a window change counts as `navigated` (tab switches included).
- **Fewer layout dumps**: steps re-dump only before a selector step; a single act reuses the tree the previous act left; no fixed 400 ms wait after slow actions. 10-step mixed path 20.8 s -> 16.1 s.
- **State database self-repair**: a corrupted `state.db` is moved aside and recreated, with a one-time note and a doctor check.
- **Visual check**: a uniform brightness change is reported as `global_shift` and removed before comparing; the plain screenshot is kept when more than half changed.
- **tools/list 45.3 KB -> 36.1 KB** with a 36 KB hard limit in the unit tests.
- Prompts, ambiguity rule shared by act and steps, preflight checks importers of edited files, cppcrash faulting thread only, atomic state writes, `FLOW_INVALID`, `DEVICE_UNAVAILABLE` on mid-call disconnects, `device log` inline output bounded, corrected timing numbers in the docs.

## v1.3.0 (2026-10-01)

**中文**

目标是让宿主 AI 少走几步。opencode 实际会话里，模型每一步要 15 到 150 秒，工具调用只要 1 到 3 秒，所以每少一次往返就省下一整步。这些功能都在真机（Mate 80、Pura 80 Pro，API 26）和真实工程上验收过（`test/audit/efficiency.mjs`）。

拿同一个任务对比（改页面代码 → 部署 → 进到目标页 → 验证）：以前每轮要调用 7–9 次工具，平均花在模型思考上的时间约 213 秒；现在只要 2 次，即 `run build_run then_flow=<id>` 加上 `ui assert`（部署超过 55 秒时再多一次 `job wait`）。

- **`ui act steps`**：一次调用走完整条路径，每步自动等待控件出现；失败时返回失败的那一步和当前可见控件；可以带最终断言，`save_flow` 存成 flow。
- **每次 `act` 都返回 `after`**：新出现和消失的控件、是否换页，一般不用再调 `observe`。
- **增量预检**：`build` / `build_run` 只检查上次以来内容真正改动过的 .ets/.ts（LingDong：0.4 秒，原来全量 4–22 秒）。hvigor 每次构建都会重写的 `BuildProfile.ets` 会被忽略。服务端说明和 SKILL 里不再要求先单独调用 `code check`。
- **自动热修复**（`run_mode=auto`，默认开启）：从第二次部署起，只改了入口模块代码时，直接给正在运行的应用打补丁并重启。MyStarRing 在 Mate 80 上实测 6–10 秒，完整部署要 15–25 秒。资源、配置、其他模块、新增或删除文件、补丁失败时，自动改走完整部署，并通过 `fallback_reason` 说明原因；没有改动时只重启。传 `run_mode=full` 可以强制完整部署。
- **`then_flow`**：部署完自动走到保存过的页面；flow 不存在时，在构建开始前就报错。重启后又走了一遍同样的路径时，会提示把它存成 flow。
- **启动崩溃自带诊断**：`build_run`、`launch` 和热修复后启动崩溃时，直接附上错误类型、可能原因，以及工程内出错的文件、行号和前后几行代码（`crash.source`）。`diagnose crash`、`device log` 带上 `project` 时也会这样定位。编译错误会附上出错位置的代码。
- **`ui visual`**：截图回归。按名称和机型保存基准截图，之后对比，返回变化比例、变化区域和红框标注图；状态栏和导航栏不参与对比。`ui_flow replay snapshot=true` 会在回放后做一次对比。
- **`ui perf`**：滑动性能体检。按逐帧时间戳统计帧率、帧耗时 p50/p95/最大值、卡顿帧、结论和内存变化。不用 `SP_daemon -f`，因为它在 API 26 上滑动时也报 0；刷新率从帧间隔推断，以适配 60/120 Hz 自适应屏。
- **`ui layout`**：布局检查，包括超出屏幕、可点区域重叠、文字被裁切或被挤没、点击区域过小。加 `forms` 时，会在折叠屏、阔折叠、三折叠模拟器上逐个形态、逐个折叠状态检查，模拟器按需创建，用完关闭。
- **签名失败说清原因**：构建失败时报出签名工具自己的错误码和原因（例如 11013002 证书过期）并给出续签提示，不再只有一句 "Tools execution failed"；安装时报 "sign info inconsistent" 会说明需要先卸载。

**English**

Fewer host round trips. In a real opencode session every model step took 15-150 s while tool calls took 1-3 s, so each avoided round trip saves a whole step. Everything below was accepted on real phones (Mate 80, Pura 80 Pro, API 26) and real projects (`test/audit/efficiency.mjs`).

Same task (edit page code -> deploy -> reach the page -> verify): 7-9 tool calls per round before (about 213 s of model steps on average), 2 now: `run build_run then_flow=<id>` + `ui assert` (one `job wait` more when the deploy exceeds 55 s).

- **`ui act steps`**: a whole path in one call, each step waiting for its element; on failure the failing step and the visible controls; optional final assert; `save_flow` stores it as a flow.
- **Every `act` returns `after`**: elements that appeared/disappeared and whether the page changed, so observe is rarely needed.
- **Incremental preflight**: build/build_run check only the .ets/.ts whose content changed since the last preflight (LingDong: 0.4 s instead of 4-22 s; hvigor's rewritten `BuildProfile.ets` ignored). Instructions and SKILL no longer ask for a separate code check.
- **Automatic quick fix** (`run_mode=auto`, default): from the second deploy on, code-only changes of the entry module are patched into the running app and relaunched (MyStarRing on Mate 80: 6-10 s vs 15-25 s). Resources, manifests, other modules, added/deleted files or a failed patch deploy fully with `fallback_reason`; an unchanged project only relaunches. `run_mode=full` forces a full deploy.
- **`then_flow`**: lands on a saved page after the deploy (unknown flows fail before building). A path walked again after a relaunch is suggested for saving.
- **Startup crashes come diagnosed**: build_run, launch and quick-fix relaunches attach the error type, likely causes and the project file, line and surrounding code (`crash.source`); `diagnose crash` and `device log` do the same with `project`. Compile errors carry the code at the error.
- **`ui visual`**: screenshot regression with per-name, per-model baselines: change ratio, regions, red-boxed diff image; status/navigation bars ignored. `ui_flow replay snapshot=true`.
- **`ui perf`**: scroll smoothness from per-frame timestamps: fps, frame time p50/p95/max, janky frames, verdict, memory delta (not `SP_daemon -f`, which reports 0 while scrolling on API 26; refresh rate inferred from frame intervals for 60/120 Hz panels).
- **`ui layout`**: off-screen elements, overlapping tap targets, clipped or collapsed text, tiny targets; `forms` checks every fold state on foldable, widefold and triplefold emulators (created on demand, stopped afterwards).
- **Signing failures explained**: the signer's own code and cause (e.g. 11013002 certificate expired) with a renewal hint instead of "Tools execution failed"; install "sign info inconsistent" explains the reinstall.

## v1.2.0 (2026-09-30)

**中文**

对全部 15 个工具、93 个动作、上游 467 项对齐和此前所有结论做了一次带原始证据的审计（报告：`docs/audit/AUDIT.md`，逐条结论：`docs/audit/FINDINGS.md`，可复跑脚本：`test/audit/`），并修复了找出的全部问题。

行为变化（请留意）：
- **参数写错直接报错**：不认识的参数、或传给了不使用它的动作的参数，一律报 `INVALID_INPUT` 且不执行，并给出正确的参数名（例如 `wiat` → `wait`）。以前会被忽略、按默认值执行。
- **`wait` 超过 60000 不再报错**：自动按 60000 处理并在结果里注明，任务没完成就继续 `job wait`。
- **多台设备时先问用户**：连着多台设备又没传 `target`，返回 `DEVICE_AMBIGUOUS`，列出每台设备的名称、型号、真机/模拟器、是否匹配工程，要求 AI 先问用户；`target` 也可以填设备名。
- **多个开发者团队时先问用户**：会在 AGC 新建或删除东西的签名操作，账号有多个团队又没传 `team` 时返回 `TEAM_AMBIGUOUS` 并列出团队；只读查询仍默认个人团队。
- **云端知识标签**：按正文与本地官方文档比对，分为 `official`、`official_other_platform`（华为给 Android/Java 或仓颉的官方文档）、`community`、`unverified`。实测 679 段：官方被标成社区 47 → 0，社区被标成官方 5 → 0。
- **界面树 `depth`** 与 devecocli 一致：0 不限，1 只有根节点。
- **`emulator images`** 按行返回（设备类型、系统版本、是否已下载），没有时为空列表；`install_image` 返回路径、大小、耗时，不再返回进度条。

修复：
- 构建失败时只返回 1 条错误：现在全部计数，前 100 条逐条给出错误码、文件、行号、原因；hvigor 级错误保留原因行（如"工程路径含非 ASCII 字符"）并给出提示。
- 加依赖后构建失败：`oh-package.json5` / `build-profile.json5` 变化后，构建前自动 `ohpm install`。
- `modules` 支持 `模块@target`；构建模式先校验并列出可选值；构建时 hvigor 新生成的 `BuildProfile.ets` 会在构建后删除。
- 静态检查误报：嵌套目录模块、AppScope、未在 build-profile 声明的本地库的资源都能识别；注释和字符串里的 `$r(...)` 不再报；`sys.*` 全部种类都检查；资源目录名检查覆盖所有模块和限定词目录；删除从未启用且会误报的 `@ObjectLink` 规则。myTestAPP：编译器 209 个错误全部命中，资源误报 79 → 0。
- LSP 对无 `@syscap` 模块报的空能力名错误不再显示（编译器实际接受）。
- 本地搜索摘要改用原文，不再是分词后的索引文本。
- 签名：`profile_create` 不再返回无效的 `profile:null`；删除不存在的证书返回 `NOT_FOUND`（以前报成功）；CSR 不存在返回 `NOT_FOUND`；补齐证书上限、非鸿蒙开发者、Profile 重名的错误提示。
- 卸载区分"未安装"和失败；`job resume` 返回 `running` 并提示 `wait`；`ui_flow stop` 校验工程；锁屏时启动/录屏会提示"请先解锁"。
- 支持 atomcode、dsh 两个工具的技能目录；遵循 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`。

**English**

An evidence-based audit of all 15 tools (93 actions), the 467 upstream alignment items and every earlier claim (report `docs/audit/AUDIT.md`, per-item results `docs/audit/FINDINGS.md`, re-runnable scripts `test/audit/`), and fixes for everything it found.

Behaviour changes:
- **Unknown or misplaced parameters are rejected** with `INVALID_INPUT` and nothing runs; the error names the right parameter (`wiat` → `wait`). They used to be ignored silently.
- **`wait` above 60000 is capped**, not rejected, with a note; keep calling `job wait` while the job runs.
- **Several devices: ask the user.** Without `target`, `DEVICE_AMBIGUOUS` lists each device (name, model, emulator or real, matches the project) and tells the agent to ask. `target` also accepts a device name.
- **Several developer teams: ask the user.** Signing actions that create or delete in AGC return `TEAM_AMBIGUOUS` with the teams unless `team` is given; reads still default to the personal team.
- **Cloud knowledge labels** come from comparing each section's text with the local official docs: `official`, `official_other_platform` (Huawei docs for Android/Java or Cangjie), `community`, `unverified`. On 679 real sections, official-as-community went 47 → 0 and community-as-official 5 → 0.
- **UI tree `depth`** matches devecocli: 0 unlimited, 1 root only.
- **`emulator images`** returns rows (device type, OS version, downloaded), `[]` when none; `install_image` returns path, size and duration instead of the progress stream.

Fixes:
- Failed builds returned one error: every error is now counted and the first 100 are listed with code, file, line and cause; hvigor-level errors keep their cause line (e.g. non-ASCII project path) with a hint.
- Adding a dependency broke the next build: builds run `ohpm install` first when `oh-package.json5` / `build-profile.json5` changed.
- `modules` accept `module@target`; the build mode is validated with the valid choices listed; `BuildProfile.ets` files that hvigor generates during a build are removed afterwards.
- Static check false positives: resources of nested modules, AppScope and undeclared local libraries are indexed; `$r(...)` in comments and strings is ignored; every `sys.*` kind is checked; resource directory names are checked in all modules including qualifier directories; the never-enabled `@ObjectLink` rule (a false positive against hvigor) is removed. myTestAPP: all 209 compiler errors found, resource false positives 79 → 0.
- LSP errors with an empty capability name for modules without `@syscap` are dropped (the compiler accepts them).
- Local search snippets come from the original text, not the tokenised index.
- Signing: `profile_create` no longer returns a meaningless `profile:null`; deleting a certificate that does not exist is `NOT_FOUND` (it used to report success); a missing CSR is `NOT_FOUND`; hints for the certificate limit, non-HarmonyOS accounts and duplicate profile names.
- Uninstall tells "not installed" from failure; `job resume` answers `running` with `wait`; `ui_flow stop` checks the project; a locked screen is reported as such on launch and screen recording.
- Skill directories for atomcode and dsh; `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` are honoured.

## v1.1.3 (2026-09-29)

**中文**

资料冲突时以谁为准，现在有明确规则，并由工具直接落实：
- **取信顺序**：① 工程 SDK 的接口声明和编译结果 → ② 官方文档（本地知识库、云端结果中标为官方的段落）→ ③ 社区文章（只作线索，不能作为 API 依据）。这条规则写进了服务说明、`knowledge` 工具说明和 `deveco-mcp-workflow` 技能，所有宿主 AI 按同一规则判断。
- **云端结果逐段标注来源**：CodeGenie 返回的几十段内容原本不区分官方和社区，现在每段都标成【官方文档】或【社区文章】；官方段落附带本地知识库对应文档的 `local_doc`，可读全文核对。返回内容官方优先，同一官方页面只出现一次，社区文章只保留短摘录。以 Push Kit 查询为例：原先前 16000 字里大多是博客，现在前面都是官方页面，其中包括 `pushService` 接口参考。
- **本地结果标注 `origin`**：`official` 为官方文档，`rules` 为规则/案例库。
- **修复：LSP 解析不了 HMS Kit**（`@kit.PushKit`、`@kit.UIDesignKit` 等）。启动语言服务时同时传了 `--sdkPath`，服务端会用它重建工程模型，并把 HMS 路径拼成 `sdk/default/default/hms`，导致这些 Kit 的悬停结果都是 `any`，诊断报"找不到模块"，恰好让"查 SDK 核实"这一步失效。现在 MCP 自己发送工程模型时不再传 `--sdkPath`（`serve-lsp` 不变）。修复后，`pushService.getToken` 的悬停能给出真实签名 `getToken(): Promise<string>` 和 `@since 4.0.0(10)`；LingDong 首页的误报诊断从 7 个降为 0。
- **悬停结果更易读**：签名中的 `&lt;` 等 HTML 转义还原为 `<`；`@since`、`@deprecated`、`@syscap` 等版本信息不会再被长长的 `@throws` 列表挤掉。

**English**

When sources disagree, there is now one explicit rule, and the tools apply it:
- **Precedence**: 1) the project's SDK declarations and a successful build; 2) official docs (the local pack, and cloud sections marked official); 3) community articles (leads only, never the API contract). The rule is in the server instructions, the `knowledge` tool description and the `deveco-mcp-workflow` skill, so every host agent judges the same way.
- **Cloud answers labelled per section**: CodeGenie's dozens of sections did not say which were official and which were community posts. Each section is now marked official or community, and official ones carry `local_doc`, the id of the matching local doc to read in full. Official sections come first, each official page appears once, and community sections are shortened. On a Push Kit query, the first 16000 characters used to be mostly blog posts; they now start with official pages, including the `pushService` API reference.
- **Local results carry `origin`**: `official` for docs, `rules` for the rule and case library.
- **Fix: the LSP could not resolve HMS kits** (`@kit.PushKit`, `@kit.UIDesignKit`...). The ArkTS server was started with `--sdkPath` as well as the MCP's own project model, so it rebuilt the model and derived the HMS path as `sdk/default/default/hms`. Every HMS kit then hovered as `any` and was reported as "cannot find module", which broke exactly the step of checking the SDK. The MCP session no longer passes `--sdkPath` (`serve-lsp` is unchanged). Hover on `pushService.getToken` now returns the real signature `getToken(): Promise<string>` and `@since 4.0.0(10)`, and LingDong's home page went from 7 false diagnostics to 0.
- **Readable hovers**: HTML entities in signatures such as `&lt;` are decoded to `<`, and `@since`, `@deprecated`, `@syscap` and similar tags are kept even after a long `@throws` list.

## v1.1.2 (2026-09-29)

**中文**

每个工具的每个动作都做了实测（单元测试 44 项、模拟器端到端测试 19 项、LingDong 真机 62 项全部通过），并修复了测试中发现的问题：
- **代码静态检查的误报**（上游 `deveco-cli` 自带的 `arkts-check.cjs` 同样存在）：注释或字符串里的 `{`、`}` 被当成代码，导致 `@Builder` 之后的普通方法都被判为"界面代码里不能声明变量/写循环"；容器组件名单是写死的，不认识 `HdsNavigation` 等 HMS 组件。现在括号扫描会跳过注释和字符串，容器判断改为读取本机 SDK（OpenHarmony + HMS）的组件描述，与编译器一致；SDK 不认识的组件不再报错。LingDong 全项目检查由 119 个误报降为 0；8 个用例（4 个真错误 + 4 个易误报的合法写法）的结论与编译器完全一致。
- **构建成功时明确告诉 AI 预检报错是误报**：构建结果中的 `preflight` 会写明"编译器已接受这些代码，不要为此修改"，避免 AI 去改能正常编译的代码。
- **模拟器操作失败被当成成功**：Emulator 命令失败时也返回成功，现在按输出判断；运行中的模拟器拒绝删除；`list`/`stop` 支持 `instance_path`。
- **取消构建后代码检查一直卡住**：检查进程或语言服务退出后会自动换新进程，不再卡住。
- **MCP 服务崩溃后任务无法继续**：被中断的任务会显示为"已中断"，可以继续执行或取消。
- **输入框中的英文引号被改成中文弯引号**：现在原样输入。
- **签名校验**：未签名的包返回 `verified=false` 和原因，不再报工具错误；校验通过时给出 profile 摘要（包名、设备数、到期时间、ACL 权限）。签名密码错误时直接说明原因。
- **测试**：新增云端签名和登录的模拟服务测试、覆盖所有 UI 操作的手势测试页；真机冒烟测试只使用 LingDong。

**English**

Every action of every tool is now exercised by tests (44 unit, 19 emulator end-to-end and 62 real-device checks on LingDong, all passing). Fixes for the problems the tests found:
- **False positives in the ArkTS static check** (also present in upstream `deveco-cli`'s `arkts-check.cjs`): braces inside comments and strings were counted as code, so every method after a `@Builder` was reported as builder code; the container list was hard-coded and missed HMS components such as `HdsNavigation`. Brace scanning now skips comments and strings, and container detection reads the installed SDK's component descriptors (OpenHarmony and HMS), as the compiler does. Components the SDK does not know are no longer reported. LingDong's whole-project check went from 119 false errors to 0, and the verdict on 8 cases (4 real errors and 4 valid but easily misjudged patterns) now matches the compiler on all of them.
- **A successful build tells the agent that preflight errors were false positives**: the build result's `preflight` says the compiler accepted the code and that nothing should be changed for it.
- **Failed emulator operations were reported as successes**: the Emulator CLI exits 0 on failure, so failure is now detected from its output. Deleting a running emulator is refused, and `list`/`stop` accept `instance_path`.
- **Code checks hung after a cancelled build**: a checker or language server whose process died is replaced automatically.
- **Jobs could not continue after an MCP server crash**: interrupted jobs now show as interrupted and can be resumed or cancelled.
- **Straight quotes in text input became curly quotes**: text is now entered exactly as given.
- **Signature verification**: unsigned packages return `verified=false` with a reason instead of a tool error; verified packages include a profile summary (bundle, device count, expiry, ACL permissions). A wrong keystore password is now reported as such.
- **Tests**: mock-service tests for cloud signing and login, and a gesture page covering every UI action. The real-device smoke test uses LingDong only.

## v1.1.1 (2026-09-29)

**中文**

在真实项目上发现并修复的问题（全部已在真机实测通过）：
- **重新构建会打断正在运行的 MCP 服务**：之前每次构建都会清空 `dist/`，正在运行的 Codex/Cursor 里的服务再按需加载模块时就会报 `Cannot find module dist/chunks/...`，这正是 Codex 无法安装应用的原因。现在构建只新增文件，一天以上的旧文件才清理；已验证重新构建后，正在运行的服务仍能正常调用。
- **多设备工程只构建、安装匹配设备的模块**：像 LingDong 这样“手机 + 手表”两个 entry 的工程，`run` 会先识别目标设备类型，再只构建和安装 `deviceTypes` 匹配的模块（手机只装 `default`，手表只装 `watch`），不会再把两个包一起装。显式指定 `modules` 时，如果模块不适用于该设备，会在安装前直接拒绝并说明原因。`launch` 和 `hot_reload` 默认模块也按设备选择。
- **不改动工程已有的签名**：`sign auto` 检测到工程已配置签名（`build-profile.json5` 或 `hvigorfile.ts` 的 overrides）时拒绝执行，不做任何修改（`force=true` 才会替换）。热重载优先使用 hvigor 用工程签名生成的补丁包，不再自行签名。
- **ArkTS 预检不再阻断构建**：静态预检是近似检查，在真实工程上有误报（例如 `HdsNavigation` 作为根节点），之前会直接跳过构建。现在只作为提示随结果返回，以 hvigor 编译结果为准。问题文件路径也改为相对于工程根目录。

真机验证（手机 Pura 80 Pro，API 26）：
- LingDong：`build_run` 自动选择 `default` 模块，只构建和安装 `default-default-signed.hap`，启动冒烟判定 PASS；显式指定 `watch` 时在安装前返回 `DEVICE_MISMATCH`；`sign auto` 返回 `SIGN_CONFIGURED`，签名保持不变。
- MyStarRing：`build_run` 成功，冒烟判定 PASS。热重载在工程的一份副本上测试：使用 hvigorfile overrides 签名打出的补丁包在真机上生效（日志中出现补丁代码输出的标记），测试后已撤销补丁，并重新部署原版应用。
- 两个工程的源码均未修改（前后逐文件哈希对比）。唯一的变化是 hvigor 每次构建都会重新生成的 `BuildProfile.ets`，这与 DevEco Studio 自己构建时的行为相同。

**English**

Problems found on real projects and fixed (all verified on a physical phone):
- **Rebuilding broke running MCP servers**: every build wiped `dist/`, so a server already running in Codex or Cursor failed to load its next module (`Cannot find module dist/chunks/...`). That is why Codex could not install apps. Builds now only add files, and chunks older than a day are pruned. Verified: a running server keeps working after a rebuild.
- **Multi-device apps build and install only the matching modules**: for projects with one entry per device class (LingDong: phone + watch), `run` detects the target device type and builds and installs only the modules whose `deviceTypes` match (phone gets `default`, watch gets `watch`), so both packages are never installed together. An explicit `modules` choice that cannot run on the device is refused before anything is installed. `launch` and the `hot_reload` default module follow the same rule.
- **Existing project signing is never changed**: `sign auto` refuses and changes nothing when the project already has signing (`build-profile.json5` or `hvigorfile.ts` overrides); only `force=true` replaces it. Hot reload now uses the HQF that hvigor signed with the project's own signing instead of signing it itself.
- **The ArkTS preflight no longer blocks builds**: the static check is an approximation and had false positives on real projects (such as `HdsNavigation` as the root node), which previously skipped the build. Its findings are now reported with the result and hvigor decides. Issue paths are now relative to the project root.

Verified on a phone (Pura 80 Pro, API 26):
- LingDong: `build_run` picks the `default` module and builds and installs only `default-default-signed.hap`, with smoke verdict PASS. Explicitly choosing `watch` returns `DEVICE_MISMATCH` before installing, and `sign auto` returns `SIGN_CONFIGURED` with signing untouched.
- MyStarRing: `build_run` succeeds with smoke verdict PASS. Hot reload was tested on a copy of the project: the HQF signed through the hvigorfile overrides took effect on the phone (a marker from the patched code appeared in the log); the patch was then removed and the original app redeployed.
- Neither project's source changed (per-file hash comparison before and after). The only difference is `BuildProfile.ets`, which hvigor regenerates on every build, just as DevEco Studio does.

## v1.1.0 (2026-09-29)

**中文**

对齐方式重建：以前的对齐检查依据一张手写对照表，会漏。现在改为由脚本从上游源码**全量自动抽取**所有能力项（工具、参数、取值、命令、选项、选项取值、deveco-cli 自带 MCP 服务的工具、Skill），共 467 项。每一项都必须有明确决策：完整覆盖（写明对应的工具和参数，由脚本对照服务实际的 JSON Schema 核对）、由宿主提供、或明确不需要（写明理由）。没有决策、核对不通过、决策过期或上游有新提交，CI 都会失败；GitHub 上每周自动检查一次。完整清单见 `docs/upstream-alignment.md`。

按清单补齐的功能：
- 代码导航：`code lsp` 新增 `call_hierarchy`（`direction` 调用者/被调用者，C++ 仅支持调用者）和 `declaration`；`lsp_restart` 可只重启 ArkTS 或 C++。
- 代码检查：`lint` 新增 `config_path`、`incremental`（只查未提交文件）、`output_path`；`api_scan` 新增 `modules`、`output_path`。
- 日志：`device log` 新增 `from`/`to` 相对时间段（在设备上按分钟预过滤，繁忙真机也能取到半小时前的日志）；`follow` 加游标持续获取新日志，不常驻后台进程。
- 运行：`run build_run` 新增 `skip_build`、`uninstall_first`；`hot_reload` 新增 `files`（指定改动文件）、`restart`（打补丁后重启应用）和 `stop_daemon`。
- 模拟器：新增 `remove_image`、`license_view`（只读）；`create` 新增 `screen_profile`、`screen`、`hot_boot`、`instance_path`、`image_root`、`force`；`start`/`stop` 支持多个名称；`images` 默认只列已下载的，`all` 列出全部；`install_image` 支持 `force`；新增湿度、温度传感器和 `battery_status`。
- 模拟器许可协议：启动、创建、下载镜像时如果协议还没同意，会自动同意并在结果中注明（`auto_accept_license=false` 可关闭）；拒绝启动时立即返回原因，不再等待超时；模拟器进程不再随 MCP 服务退出而关闭。
- UI：`screenshot` 新增 `display`、`save_path`；`tree` 新增 `all_windows`、`node`（单个组件子树）；`record_stop` 新增 `save_path`；文本输入改为 base64 传输，空格、引号、`$` 等特殊字符都能原样输入。
- Skill：`export`/`install`/`uninstall`/`init` 新增 `path`（任意目录）；命令行 `serve-lsp` 新增 `--auto-detect`。

其他：
- 安装失败 9568297（设备 API 低于应用要求）给出明确提示。
- tools/list 中重复的选择器定义只输出一次，工具描述总大小控制在 36 KB 以内。`npm run bench` 增加性能预算检查（握手 < 150 ms、空闲内存 ≤ 70 MB、工具描述 ≤ 36 KB、空闲 CPU 不增长）。
- 经评估不做 spec 规格开发流程（宿主自带 Plan 模式已经覆盖），同时删除 `implement-feature` Prompt。
- 行为对照：白屏判定与上游的图像指纹算法在 7 组样本上结论一致；按组件 id 点击、向焦点控件输入文本与上游行为一致。

**English**

Alignment rebuilt: the previous check relied on a hand-written mapping and missed things. A script now **extracts every capability item from upstream source automatically** (tools, parameters, enum values, commands, options, choices, deveco-cli's bundled MCP tools, skills): 467 items. Each needs an explicit decision: full (with a target that the script verifies against the server's live JSON Schemas), host-provided, or not needed (with a reason). Undecided or unverifiable items, stale decisions and new upstream commits all fail CI, and GitHub re-checks weekly. The full list is in `docs/upstream-alignment.md`.

Gaps closed from the list:
- Code navigation: `code lsp` adds `call_hierarchy` (`direction` callers/callees; C++ supports callers only) and `declaration`; `lsp_restart` can restart only ArkTS or C++.
- Code checks: `lint` adds `config_path`, `incremental` (uncommitted files only) and `output_path`; `api_scan` adds `modules` and `output_path`.
- Logs: `device log` adds `from`/`to` relative windows (pre-filtered on the device by minute, so busy phones still return logs from half an hour ago) and `follow` with a cursor that streams new lines across calls without a background process.
- Run: `run build_run` adds `skip_build` and `uninstall_first`; `hot_reload` adds `files` (explicit changed files), `restart` (relaunch after patching) and `stop_daemon`.
- Emulator: adds `remove_image` and read-only `license_view`; `create` adds `screen_profile`, `screen`, `hot_boot`, `instance_path`, `image_root` and `force`; `start`/`stop` take several names; `images` lists downloaded images by default and every image with `all`; `install_image` supports `force`; adds humidity and temperature sensors and `battery_status`.
- Emulator license: start, create and image download accept the agreements automatically when needed and say so in the result (`auto_accept_license=false` opts out). A refused start now reports the reason at once instead of timing out, and emulators no longer exit when the MCP server does.
- UI: `screenshot` adds `display` and `save_path`; `tree` adds `all_windows` and `node` (one component subtree); `record_stop` adds `save_path`. Text input is now sent base64-encoded, so spaces, quotes, `$` and other special characters arrive exactly as typed.
- Skills: `export`/`install`/`uninstall`/`init` add `path` (any directory); the `serve-lsp` CLI command adds `--auto-detect`.

Also:
- Install error 9568297 (device API lower than the app requires) now comes with a clear hint.
- The selector schema is emitted once in tools/list, keeping all tool descriptions within 36 KB. `npm run bench` now enforces performance budgets (handshake < 150 ms, idle RSS ≤ 70 MB, tool descriptions ≤ 36 KB, no idle CPU growth).
- The spec-driven workflow was evaluated and dropped (the host's own plan mode covers it), and the `implement-feature` prompt was removed.
- Behaviour checks: blank-screen detection agrees with upstream's image-fingerprint algorithm on all 7 samples; clicking by component id and typing into the focused field match upstream behaviour.

## v1.0.2 (2026-09-29)

**中文**
- 内置 Skill 换成上游 DevEco Code 自带的两个（MIT 许可，保留署名），再加一个本服务的工作流 Skill：
  - `hmos-arkui-develop-skill`：ArkTS/ArkUI 高频致命错误清单，以及组件 API 速查（`quick-apis`）和约束规则（`quick-rules`），共 35 个参考文件。
  - `hmos-runtime-fix-skill`：崩溃排查流程和 9 类崩溃模式库；把原来的 `devecocli` 和私有脚本调用改成本服务的 `diagnose`、`device log`、`run`、`ui`。
  - `deveco-mcp-workflow`：各种场景下该用哪个 deveco 工具。
- 删除 v0.4 遗留的 6 个 Skill：它们引用的旧工具名在 v1 里已不存在。不提供上游的 `customize-deveco`（配置 DevEco Code 自身）和 `deveco-cli`（命令行用法）两个 Skill。
- `diagnose` 的崩溃模式匹配改为直接读取 `hmos-runtime-fix-skill/references`，Skill 文档和匹配规则只维护一份。
- 项目级导出改写到 `<project>/.agents/skills`，这是 Codex、Claude Code、Cursor、Qoder、OpenCode、DevEco Code 共同读取的目录。
- `skills read` 支持多级参考文件路径（如 `quick-apis/01-layout.md`），并拒绝越出 Skill 目录的路径。
- 服务版本号改为从 `package.json` 读取。
- 知识包重新生成：`skills` 目录收录 38 篇文档（包含 ArkUI 速查）。

**English**
- Built-in skills are now the two shipped with upstream DevEco Code (MIT, attribution kept) plus a workflow skill for this server:
  - `hmos-arkui-develop-skill`: a list of high-frequency fatal ArkTS/ArkUI mistakes, plus component API cards (`quick-apis`) and constraint rules (`quick-rules`), 35 reference files in total.
  - `hmos-runtime-fix-skill`: the crash-fix flow and a 9-category crash pattern library. Calls to `devecocli` and the private scripts are replaced with this server's `diagnose`, `device log`, `run` and `ui`.
  - `deveco-mcp-workflow`: which deveco tool to use for each task.
- Removed the 6 skills left over from v0.4, which referenced tool names that no longer exist in v1. Upstream's `customize-deveco` (configuring DevEco Code itself) and `deveco-cli` (CLI usage) skills are not included.
- `diagnose` now matches crash patterns directly from `hmos-runtime-fix-skill/references`, so the skill docs and the matcher share one source.
- Project-scope export now writes `<project>/.agents/skills`, the directory shared by Codex, Claude Code, Cursor, Qoder, OpenCode and DevEco Code.
- `skills read` accepts nested reference paths (e.g. `quick-apis/01-layout.md`) and rejects paths that escape the skill directory.
- The server version is now read from `package.json`.
- Rebuilt the knowledge pack: the `skills` catalog now holds 38 documents, including the ArkUI quick reference.

## v1.0.1 (2026-09-29)

**中文**
- 取消“可选组”：`sign`、`emulator`、`hot_reload` 默认可用，15 个工具全部对宿主 AI 可见，不再需要 `DEVECO_TOOL_GROUPS`（该变量已移除）。
- 启动时间和内存不变：这些工具的代码只在第一次调用时才加载；工具描述约增加 5 KB。

**English**
- Removed optional tool groups: `sign`, `emulator` and `hot_reload` are always enabled, so all 15 tools are visible to the host AI. `DEVECO_TOOL_GROUPS` is no longer needed and has been removed.
- No startup or memory cost: their code still loads lazily on first call; the tool list grows by about 5 KB.

## v1.0.0 (2026-09-29)

**中文** | [English](#english)

v1.0 是一次从零开始的重写，目标是**更轻、更快、和上游对齐更全**。这是不兼容升级，旧版 v0.x 的工具名和参数不再保留。

#### 亮点

- **轻量原生架构**：内置最小化的 MCP stdio 传输，去掉了 `@modelcontextprotocol/sdk` 和 LangGraph；运行时依赖只剩 3 个（json5、yauzl、zod）。
- **性能**：握手约 90 ms，空闲 CPU 约为 0（没有常驻定时器或轮询），空闲内存约 65 MB；esbuild 构建约 60 ms。
- **可靠的任务执行**：构建、部署等有副作用的操作都作为任务运行。执行前先记录意图、完成后记录回执，服务中断后不会盲目重做；任务数据存在 `node:sqlite`（WAL 模式）里。
- **可单独更新的知识包**：每个 `.tgz` 包含 FTS5 索引、中文分词词表和文档，下载时校验 sha512，原子切换，支持回滚；也可以直接用上游最新的知识库生成。
- **12 个核心工具加 3 个可选组**：`doctor`、`project`、`run`、`job`、`code`、`device`、`ui`、`ui_flow`、`diagnose`、`knowledge`、`skills`、`auth`；可选组：`sign`、`emulator`、`hot_reload`。

#### 和上游对齐（deveco-code / deveco-cli）

能力级验收：上游共 81 项，**60 项完整覆盖、3 项由命令行子命令提供、18 项由宿主 AI 自身提供，缺口为 0**。每次 CI 都会读取服务实际的工具 JSON Schema 做参数级比对。

- **UI 测试会话**（宿主驱动）：`test_start` → `test_step` → `review` → `test_finish` → `test_log` / `test_export`。每一步自动记录操作前后截图、控件摘要和应用日志片段。视觉判断由宿主 AI 完成；控件断言失败时，视觉判断不能改判为通过。
- **启动冒烟判定**：`build_run` 返回 `PASS` / `FAIL_CRASH` / `FAIL_BLANK`，其中 `FAIL_BLANK` 表示启动后白屏或黑屏。
- `device sqlite`：查询设备上的数据库，返回 JSON；默认只读，也可以按 bundle 直接访问调试包的 RDB 数据库。
- `ui windows`：列出窗口；`tree` / `observe` 支持按窗口和深度过滤。录屏新增 `record_status` / `discard` / `external`，录制状态持久化保存。
- `project build task=compileNative`：编译后合并 `compile_commands.json`，供 clangd 使用。
- `code api_versions`；`doctor` 新增 SDK 与设备的兼容性检查。
- `sign auto` 会从 `module.json5` 自动推导 ACL 权限；登录支持 `region` cn / global。
- 命令行：`init --host <宿主>` 一步完成 MCP 配置和 Skill 导出，支持 8 种宿主，重复执行不会重复写入；`serve-lsp [--cpp]` 把 ArkTS 或 C++ 语言服务透传给编辑器。

#### 从 v0.4 保留的功能

逐项评估见 [docs/v0-feature-review.md](docs/v0-feature-review.md)，最终保留：

- 鼠标操作（点击、双击、长按、移动、滚轮、拖拽）和组合键（最多 3 个键）。
- `ui act verify_change`：比较操作前后的界面，判断操作是否生效。
- `diagnose crash since_minutes`：按时间窗口补采崩溃日志；量产手机上也能读取故障日志。
- `sign` 可选组逐项操作：`keypair`、`csr`、`certificate_create`、`profile_create`、`profile_delete`。

#### 升级说明

- **不兼容升级**：工具名、参数和状态目录都变了。v0.x 的登录凭据可以用 `auth action=import` 迁移。
- 需要 Node 22.18 及以上，以及 DevEco Studio 或 Command Line Tools。
- 安装：`npm ci && npm run build`，然后执行 `node dist/cli.js init --host cursor`，或者参考 README 手动配置。

---

<a id="english"></a>

### English

v1.0 is a **from-scratch rewrite** focused on a smaller footprint, faster startup, and more complete upstream parity. It is a **breaking release**: v0.x tool names and parameters are not kept.

#### Highlights

- **Lean native architecture**: the built-in minimal MCP stdio transport replaces `@modelcontextprotocol/sdk` and LangGraph. Only 3 runtime dependencies remain (json5, yauzl, zod).
- **Performance**: about 90 ms handshake, near-zero idle CPU (no background timers or polling), about 65 MB idle RSS, and about 60 ms esbuild builds.
- **Durable jobs**: builds, deploys and other side effects run as jobs that record intent before running and a receipt after, so an interrupted server never blindly repeats work. Job state is stored in `node:sqlite` (WAL).
- **Independently updatable knowledge packs**: each `.tgz` holds an FTS5 index, a Chinese segmentation vocabulary and the docs. Downloads are sha512-verified, switched atomically and can be rolled back; a pack can also be built from the latest upstream knowledge base.
- **12 core tools plus 3 optional groups**: `doctor`, `project`, `run`, `job`, `code`, `device`, `ui`, `ui_flow`, `diagnose`, `knowledge`, `skills`, `auth`; optional groups: `sign`, `emulator`, `hot_reload`.

#### Upstream parity (deveco-code / deveco-cli)

Capability-level check: of 81 upstream capabilities, **60 are fully covered, 3 are CLI subcommands, 18 are provided by the host AI itself, and 0 are missing**. CI compares the server's live tool JSON Schemas parameter by parameter.

- **UI test sessions** (host-driven): `test_start` → `test_step` → `review` → `test_finish` → `test_log` / `test_export`. Every step records before/after screenshots, an element summary and a window of the app's logs. The host AI makes the visual judgement; it can never overturn a failed control assertion.
- **Launch smoke verdict**: `build_run` returns `PASS` / `FAIL_CRASH` / `FAIL_BLANK`, where `FAIL_BLANK` means the screen is blank (white or black) after launch.
- `device sqlite`: queries on-device databases and returns JSON rows. It is read-only by default, and a debuggable app's RDB store can be reached by bundle.
- `ui windows` lists windows; `tree` / `observe` can filter by window and depth. Screen recording adds `record_status`, `discard` and `external`, and the recording state survives server restarts.
- `project build task=compileNative` merges `compile_commands.json` for clangd.
- `code api_versions`; `doctor` now checks SDK and device compatibility.
- `sign auto` derives ACL permissions from `module.json5`; login supports `region` cn / global.
- CLI: `init --host <host>` sets up the MCP config and exports skills in one step for 8 hosts, and re-running it never duplicates entries. `serve-lsp [--cpp]` passes the ArkTS or C++ language server through to editors.

#### Kept from v0.4

Each feature was assessed in [docs/v0-feature-review.md](docs/v0-feature-review.md). The kept ones:

- Mouse actions (click, double click, long press, move, wheel, drag) and key chords of up to 3 keys.
- `ui act verify_change`: compares the screen before and after an action to show whether it took effect.
- `diagnose crash since_minutes`: collects crash logs from a time window, including fault logs on production phones.
- Itemized actions in the `sign` group: `keypair`, `csr`, `certificate_create`, `profile_create`, `profile_delete`.

#### Upgrading

- **Breaking**: tool names, parameters and the state directory have changed. Import v0.x credentials with `auth action=import`.
- Requires Node 22.18 or later, plus DevEco Studio or the Command Line Tools.
- Install with `npm ci && npm run build`, then run `node dist/cli.js init --host cursor`, or configure the host by hand as described in the README.
