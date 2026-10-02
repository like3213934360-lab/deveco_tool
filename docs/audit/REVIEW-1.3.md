# deveco-mcp v1.3.0 全面审查报告

- 审查日期：2026-10-02
- 被审版本：v1.3.0，提交 `1fb7670`
- 设备：HUAWEI Mate 80（`6XE0225B06010966`，API 26）；模拟器 Pura 90（API 24）
- 工程：主要用 MyStarRing（`com.dream.toollist`）；LingDong 只做只读检查
- 本阶段**只审查、没有修改产品代码**。按修改时间核对，`src/` 和 SKILL 没有任何文件被改动或新增（F.clean.product-unchanged）。

结论规则与 v1.2.0 审计相同（VERIFIED / DEFECT / UNVERIFIED / INFERRED），每条结论都附原始证据。本次新增的结论以 `F.` 开头，原始证据在 `evidence/review-1.3/`，审查脚本是 `test/audit/review-*.mjs`，可以复跑。全部结论明细见 [FINDINGS.md](FINDINGS.md)。

## 总体结论

| 范围 | 结论 |
| --- | --- |
| 本次审查共 93 项 | VERIFIED 67，DEFECT 18（其中 2 项重复，实际 17 个问题），INFERRED 6，UNVERIFIED 2 |
| 对照 v1.2.0 的 428 项结论 | 没有发现代码退化。唯一一项从 VERIFIED 变为 DEFECT 的是 D.text.36，原因是这次对"约 3 秒"这个说法要求更严，不是代码出了问题 |
| 回归 | 类型检查通过；单元测试 70/70；上游对齐 467 项，0 缺口、0 新提交；模拟器端到端 20/20；Mate 80 端到端 13/13（另外 7 项需要给测试 app 签名，真机装不上，属于预期） |

**一句话总结**：v1.3.0 的核心目标"少走几步"达成了。opencode 用同一个免费模型完成一轮改代码并验证，只调用了 3 次 deveco 工具，走的是热修复，全程 85 秒；以前每轮要 7–9 次，模型思考就要约 213 秒。

但存在 **1 个高优先级的可用性问题**：部分同步调用可能超过宿主 60 秒的超时。另有 7 个中优先级问题，集中在三处：`after` 页面差异判断、批量操作效率、数据库损坏后的恢复。

## 一、高效率

| 编号 | 结论 | 数据 |
| --- | --- | --- |
| F.host.opencode | VERIFIED | opencode 实际任务：3 次 deveco 调用（`build_run` 走热修复 10.9 秒、`act steps`、`assert`），没有调 `code check` 和 `observe`，模型共走 9 步，耗时 85 秒 |
| F.hot.* | VERIFIED | 只改入口模块代码时热修复 9–10 秒，连续三次补丁都正确生效；其余情况完整部署 15–26 秒 |
| F.preflight.recheck-failing | VERIFIED | 增量预检只检查改动的文件，上次报错的文件下次一定重查，不改动时检查 0 个文件 |
| F.bench.handshake | VERIFIED | 握手中位数 93 毫秒，`tools/list` 4 毫秒返回，空闲时基本不占 CPU |
| F.perf.repeatability | VERIFIED | `perf` 连跑三次分别为 118.3、118.1、118.6 fps，偏差 0.5 fps |
| F.soak.* | VERIFIED | 连续 100 次 `act` 加 20 轮部署：内存先升后平稳，不再增长；子进程和文件句柄稳定；主机和设备上都没有新增临时文件 |
| F.perf.dump-floor | VERIFIED | 一次布局 dump 固定要 1.2–1.4 秒，上游 devecocli 用的是同一条命令，没有更快的接口可用，所以界面操作的耗时主要取决于 dump 的次数 |
| **F.batch.dump-per-step** | DEFECT 中 | `steps` 每做完一步都无条件 dump 一次（`uibatch.ts:179`），实测每步 2.08 秒；只有下一步要找控件时才需要 dump |
| **F.bench.tools-list-size** | DEFECT 中 | `tools/list` 共 45.4KB（v1.2 是 38.6KB），已超出 36KB 的预算；其中 `ui` 一个工具占 11.7KB，每个会话都会占用模型上下文 |
| **F.docs.prompts-stale** | DEFECT 中 | MCP 的 prompts 没有随 1.3 更新：`fix-build` 仍要求每轮先调 `code check`，`debug-crash` 不知道 `build_run` 已经附带 `crash.source` |
| F.after.latency | DEFECT 低 | 单次 `act`（默认返回页面差异）耗时 1.9–4.1 秒：前后各 dump 一次，再加 400 毫秒等待 |
| F.soak.memory-after-deploys | VERIFIED（低） | 第二次部署建立热修复基线后，内存从 66MB 升到约 120MB 并保持平稳；有上限，但超过了空闲 70MB 的预算 |

## 二、高可用

| 编号 | 结论 | 数据 |
| --- | --- | --- |
| **F.avail.sync-timeouts** | **DEFECT 高** | `ui assert` 的 `timeout_ms` 最大可设 120000 毫秒（实测设 70000 时 70.1 秒才返回），`test_step` 同样如此，`steps` 单步等待最多 60 秒，30 步也没有总时长上限。这些都会超过宿主 60 秒超时，宿主拿到空结果。这正是 1.2.x 已经为任务类调用修过的同一类问题 |
| F.dev.ambiguous-* | VERIFIED | 同时连两台设备又没传 `target` 时，1.3 新增的 7 个动作以及 `build_run` 都拒绝执行并列出两台设备 |
| F.dev.gone-mid-call / next-call | VERIFIED | 设备在调用中途断开，5.8 秒内返回，不会卡住；下一次调用明确返回 `DEVICE_UNAVAILABLE` |
| F.avail.locked-screen | VERIFIED | 审查中手机真的锁屏了：7.9 秒内返回 `LAUNCH_FAILED`，并提示"请用户解锁" |
| F.dialog.batch-covered | VERIFIED | 系统授权弹框挡住 app 时，`steps` 失败，返回的可见控件里能看到弹框的"允许/不允许"按钮 |
| F.thenflow.stale / vars | VERIFIED | flow 和当前界面对不上时部署照样成功，并附提示；缺少变量时 4 毫秒内拒绝，不会开始构建 |
| F.proc.kill-mcp-mid-build | VERIFIED | 构建过程中强杀 MCP 进程：重启后任务显示为"已中断"，可以恢复并完成，没有遗留孤儿进程 |
| F.proc.checker-lsp-recover | VERIFIED | 杀掉 ArkTS 检查进程和语言服务进程后，下一次调用自动恢复 |
| F.fault.two-instances | VERIFIED | 两个 MCP 实例共用一个状态目录并发执行 20 次调用，没有错误 |
| **F.fault.db-corrupt** | DEFECT 中 | 状态数据库 `state.db` 损坏时，服务能启动，但所有任务类调用都报 `INTERNAL: file is not a database`，没有任何提示，也不会自动重建 |
| F.fault.flow-corrupt-message | DEFECT 低 | flow 文件损坏时返回 `INTERNAL`，内容是原始的 JSON 解析报错，没有指出是哪个文件、怎么修 |
| F.dev.gone-mid-call-message | DEFECT 低 | 设备中途断开时报的是"布局文件传输失败"，没有告诉宿主是设备断开了 |

## 三、高可靠

| 编号 | 结论 | 数据 |
| --- | --- | --- |
| F.hot.*（12 项） | VERIFIED | 热修复的每条判定都按预期执行：只改入口代码时热修复；改了 HAR 模块、资源、`module.json5`、新增文件、app 没在运行、app 被别人重装过时完整部署；release 模式和 `run_mode=full` 不走热修复；编译错误正常报出 |
| F.crash.har-source / appfreeze | VERIFIED | HAR 模块里的崩溃能通过 source map 定位到 `features/tools/...ets` 的具体行；appfreeze 能解析出应用自己的调用栈 |
| F.visual.stability / sensitivity / corrupt | VERIFIED | 同一页面三轮各对比 5 次，变化比例都是 0；滑动 200 像素能检测到；基准文件损坏时报错并提示用 `update=true` 重建 |
| F.layout.real-pages | VERIFIED | 在 4 个真实页面上运行，只报出"点击区域过小"7 处（是否算问题需要人看），没有其他误报 |
| **F.after.navigated-detection** | DEFECT 中 | 打开全屏页面、返回、切换页签都被判为 `updated`，从来没有判为 `navigated`，这个字段起不到告诉宿主"已经换页"的作用 |
| **F.after.system-noise** | DEFECT 中 | 页面差异里混进了状态栏、系统窗口的节点（返回时被移除的条目里有 30 多个是状态栏），没有只看 app 自己的控件 |
| **F.visual.global-brightness** | DEFECT 中 | 出现过一次：页面没变，却报变化比例 100%，复跑和复现都没有再出现。比较算法是逐块比较绝对灰度，整屏变暗、深色模式或遮罩都会被判成"整页都变了"，而且不会提示这是整体变化 |
| F.act.ambiguity-consistency | DEFECT 低 | 同一个选择器，在 `steps` 里会取最上面的那个并执行成功，在单次 `act` 里却报"匹配到多个" |
| F.preflight.dependents | DEFECT 低 | 改了 A 文件的导出签名后，增量预检只检查 A，没有检查引用 A 的 B，因此漏报 2 个错误（构建时 hvigor 仍会报出） |
| F.crash.cppcrash-parse | DEFECT 低 | cppcrash 日志常见的"Fault thread info:"格式下，调用栈里会混进下一个线程的帧 |
| F.rel.nonatomic-state | DEFECT 低 | 热修复状态、热修复基线、截图基准都是直接写文件、不是原子写；进程在写入中途被杀会留下残缺文件 |

## 四、文档与说明

| 编号 | 结论 |
| --- | --- |
| F.docs.hot-reload-3s / D.text.36（同一问题） | DEFECT 低：README 和 `hot_reload` 工具描述写"约 3 秒"，实测 4.4–4.7 秒（热修复自动路径为 5–10 秒） |
| F.docs.wait-default | DEFECT 低：`wait` 参数说明写"默认 1500"，实际各工具默认值是 3000、5000 或 20000 |
| F.hot.latency | INFERRED：CHANGELOG 写的"约 6 秒"是较好情况下的数字，本次实测 9–10 秒 |
| F.docs.skill-copies | VERIFIED：本机三份 SKILL 内容完全一致 |
| F.host.single-tap-as-steps | INFERRED：宿主把"点一下再断言"拆成了两次调用；`steps` 本身支持带断言，一次调用就够 |

## 五、未能验证

- **F.host.cursor**：同一任务没有在 Cursor 里另做一遍。按你的选择跳过，因为审查者本身就运行在 Cursor 里，自己测自己不客观。
- **E.cross-platform.untested**：仍然没有在 Windows 或 Linux 上实际跑过工具链（CI 只覆盖了不依赖设备和工具链的纯逻辑部分）。

## 六、问题清单（建议的修复顺序）

| 优先级 | 问题 | 建议 |
| --- | --- | --- |
| 高 | F.avail.sync-timeouts | 所有同步等待（`assert` / `test_step` 的 `timeout_ms`、`steps` 单步等待、`steps` 的总时长）都限制在 `MAX_WAIT_MS` 以内；超时就返回已完成的部分和"继续"提示 |
| 中 | F.after.navigated-detection + F.after.system-noise | 页面差异只统计 app 自己、当前在屏幕上的控件；用顶层页面或弹层容器是否变化来判断"换页" |
| 中 | F.batch.dump-per-step | 只有下一步需要找控件时才 dump；最后一步没有断言就不再 dump |
| 中 | F.fault.db-corrupt | 数据库打不开时，把损坏的文件改名备份、重建一个新库，并在 `doctor` 里给出提示 |
| 中 | F.visual.global-brightness | 识别整屏一致偏移的情况，报告为"亮度变化或遮罩"而不是"整页都变了"；对比失败时保留当时的截图作为证据 |
| 中 | F.bench.tools-list-size | 精简 `ui` 工具的说明和参数结构（例如把 `steps` 的结构复用已有定义），目标 36KB 以内 |
| 中 | F.docs.prompts-stale | 按 1.3 的做法更新 `fix-build` 和 `debug-crash` 两个 prompt |
| 低 | F.after.latency、F.act.ambiguity-consistency、F.preflight.dependents、F.crash.cppcrash-parse、F.rel.nonatomic-state、F.fault.flow-corrupt-message、F.dev.gone-mid-call-message、文档里的数字（3 秒、默认 wait、6 秒） | 逐项小修 |
| 工具 | F.audit.scripts-stale | 更新 4 个已经过期的 v1.2 审计脚本，让以后的回归能自动判断 |

## 七、审查对环境的影响

| 改动 | 状态 |
| --- | --- |
| Mate 80 上的 MyStarRing 卸载重装 1 次（为测试系统弹框，经你同意） | app 在手机上的数据被清空；当前装的是原版源码构建的包，启动正常（smoke PASS） |
| MyStarRing 源码 | 多次临时修改，每次都已还原；源码相对审查开始前没有差异（只剩审查前就存在的 21 处改动） |
| flow 和截图基准 | 测试用的都已删除；工程里仍是原来的 22 个 flow，没有残留基准截图 |
| 模拟器 | Pura 90 启动后已关闭；本次没有新建模拟器 |
| AGC | 只读查询了证书和设备列表，没有新建或删除任何东西 |
| 临时文件 | 设备上没有新增 `deveco-*` 文件；主机上有 1 个过期 v1.2 脚本崩溃后留下的临时目录，已手动删除 |
| 手机自动锁屏 | 审查中途自动锁屏了一次，你把自动锁屏时间调长了；受影响的 7 个用例已全部重跑 |

## 八、修复结果（v1.3.1，2026-10-02）

所有问题都按第六节的顺序修复，并在 Mate 80 + MyStarRing 上用对应的审查脚本复测；`findings.jsonl` 里每条都追加了新结论，`FINDINGS.md` 已重新生成。目前没有任何一条的最新结论是 DEFECT。

| 问题 | 修复后实测 |
| --- | --- |
| F.avail.sync-timeouts | `ui assert timeout_ms=70000` 52.6 秒返回并附注截断说明；30 步、每步 `timeout_ms=60000` 都找不到控件，51.5 秒返回；30 步固定等待在 52.2 秒停下，返回 `stopped_at=20` 和"从第 20 步继续"提示 |
| F.after.navigated-detection / system-noise | 打开页面、返回、切换页签都判为 `navigated`，滚动判为 `updated`；`after` 里没有状态栏控件 |
| F.batch.dump-per-step | 同一条 10 步混合路径 20.8 秒 → 16.1 秒（减少 22%）。**没有达到计划的 30%**：其中 6 步是按选择器点击，每步都需要在上一步操作后重新读取界面（uitest 读一次约 1.3 秒，这是下限），两次滚动在 uitest 内部各要约 1.9 秒 |
| F.after.latency | 连续的单次 `act`（复用上一次留下的界面树）1.9–2.4 秒；启动后的第一次和滚动仍是 3.2–3.4 秒（原因同上） |
| F.fault.db-corrupt | 往状态库写垃圾后 `job list` 正常，返回里说明已重建、丢了什么、备份在哪；`doctor` 有 `state` 检查项 |
| F.visual.global-brightness | 单元测试：整屏暗 40 级判为 `global_shift`、变化比例 0；变暗同时卡片移动仍检出 2 个区域；不同的暗色页面仍判为变化。真机上同页 5 次均为 0，滚动 200 px 仍检出 |
| F.bench.tools-list-size | 45,303 → 36,054 字节；单元测试里 36 KB 硬上限（三个平台的 CI 都会跑）。`tools/bench.mjs` 本地保留同一预算，但没有放进 CI：它的空闲 CPU/内存预算在开发机上本来就贴着上限，放进 CI 会时好时坏 |
| F.docs.prompts-stale | 两个 prompt 已更新，单元测试检查文字 |
| 低优先级 7 项 | 都已修复并复测：歧义选择一致、预检带上引用方（LingDong 1831 个文件扫描 56 毫秒）、cppcrash 只取崩溃线程、原子写、`FLOW_INVALID`、模拟器中途关机报 `DEVICE_UNAVAILABLE`（5.8 秒） |
| 文档数字 | 热修复约 5 秒、自动热修复 6–10 秒、`wait` 默认值随动作不同 |
| F.audit.scripts-stale | 4 个脚本都能直接重跑：check-rules 22 条通过，另外 4 条需要真机验证的由 check-rules-2 在 Pura 90 模拟器上验证通过；modules30 通过；blank 自己临时 clone 上游、退出时删除，按标准答案判定通过；syscap-full 没有构建时自己构建，结果 83/291/3 与 MCP 一致 |
| 复测中新发现：F.soak.response-sizes | `device log` 的内联内容随日志行长度变化会到 12.6 KB；现在限制在约 7 KB（全文在 artifact 里） |

**整体复测**：单元测试 73/73；模拟器端到端测试 20/20；review-ui、review-ui2、review-hot、review-fault、review-build、review-device、review-soak（100 次操作 + 20 次部署）全部重跑，除 F.layout.findings-review（需要人看的布局提示）外均为 VERIFIED。

**opencode 宿主实测**（同一任务、同一免费模型）：deveco 调用从 3 次降到 2 次（`build_run` + `ui assert`，没有多余的 `act`）。这次总耗时 232 秒（上次 85 秒），原因是模型这次多做了 grep/glob 探索（15 个模型步骤），以及 app 刚被审查重装过，`build_run` 走了完整部署（26.4 秒，`fallback_reason` 为 "the app was reinstalled since the baseline"），不是工具变慢。

**对环境的影响**：MyStarRing 源码与复测前完全一致（opencode 改的 Index.ets 已还原）；工程里仍是 22 个 flow，没有基准截图；设备上没有 `deveco-*` 临时文件；主机上没有临时目录残留（发现 1 个 13:44 的 `audit-blank-*`，是修复 blank.mjs 时一次失败运行留下的，已删除）；Pura 90 模拟器已关闭；为 syscap-full 构建过一次 LingDong（只有构建产物，源码未动）。
