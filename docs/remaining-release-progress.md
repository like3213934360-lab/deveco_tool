# 下一正式版剩余能力实现进度

任务：`01a08e63-b5e3-73e2-98d7-44f91893d6d4`。开始于 2026-09-11。
持续目标已创建；完成条件包含实现、真实适用验收、合入、正式发布及发布包安装/升级核验。

工作区：`/Users/dreamlike/.codex/worktrees/5ab5/deveco_tool`。
分支：`codex/remaining-capabilities-release`，起点 `713734c8eaf40d52013ff88982306aef0d0c563f`。
起点与 v0.3.0 (`39e3c5664557071231650aca7dce9adbfc1c6d29`) 的源码树相同。
宿主实际加载版本已重新检查为 `0.3.0 / native-7`，Node 24.14.1、Studio 26.0.0.821、SDK 26.0.0.105。
本轮候选版本为 **0.4.0 / native-7**，schema revision 2、flow version 2 保留受验证的旧格式兼容路径。最新远端仍为 v0.3.0，尚未发布 0.4.0。

完整交接提示词：`/Users/dreamlike/.codex/visualizations/2026/09/10/01a0893f-964c-7ea0-852c-f22c85bab554/next-release-implementation-prompt-20260911.md`。
审计目录：同目录下 `remaining-work-audit-20260911.md` 与 `lsp-compatibility-audit-20260911/`。

| 项目 | 类型 | 当前状态 | 关闭条件 |
| --- | --- | --- | --- |
| A：ArkTS 五项 LSP、路径及调用位置 | 已确认缺陷 | 扩展真实验收通过；同时修复拉取诊断与 worker 取消分类，最终发布身份待复验 | 真实公共 MCP 正例及坐标/空结果/取消/重启验证，既有能力无回归 |
| B：部署/Apply 启动后检查 | 上游新增待实现 | 可控故障公共 MCP 模拟器整轮通过；最终发布身份待复验 | 延迟崩溃、白屏与不确定状态语义正确，真实启动及资源回收验证 |
| C：能力矩阵与门禁 | 已确认误判 | 当前 50 项 format 2 公共 MCP 凭证已严格核验并发布到仓库；上游锁更新后的最终凭证仍待复验 | required native 不可由 unsupported、本地拒绝或语言错配冒充成功 |
| D：完整 UI 动作录制重放 | 组合能力待实现 | flow v2 已实现；焦点输入、全部七种鼠标、双向 fling、密码与异常隐私验收通过；最终身份待复验 | 鼠标/焦点文本/组合键/方向 fling 可保存并跨重启重放，旧流程与隐私兼容 |
| E：连续 UI 日志 | 组合能力待实现 | 6000 行压力及真实应用重启、模拟器断连、MCP 重启、步骤归属、取消/导出通过；配额和 ENOSPC 确定性测试通过，最终身份待复验 | 有界采集、进程变化、断连/重启和真实完整度，压力与恢复证据 |
| F：兼容状态升级 | 维护能力待实现 | 公共 CLI 旧安装 → 候选 → 重启 → 回滚实测通过；18 项维护测试通过，实际发布包验收待补 | 兼容状态/有效认证/历史保留，一致迁移、中断恢复与回滚 |
| G：效果与剩余验收 | 验收与组合能力 | 模拟器场景与热补丁连续更新、错误恢复和完整部署回退的真实验收通过，其余矩阵和长跑待补 | 模拟器/热补丁真实效果、旧台账核销、适用性能/长跑及平台矩阵 |
| H：文档和正式发布 | 收尾交付 | 0.4.0 版本、当前证据门禁与资源说明已更新；提交、CI 与发布待完成 | 文档一致，正式 tag/Release/附件/SHA 及实际包安装升级核实 |

真实外部条件另列，不能从“未验证”改成“已豁免”来关闭目标。客户端承担及用户明确排除的 Skill 安装/卸载与 required native 分开；MCP 保持内置知识交付与原生 TypeScript/LangGraph/SQLite 架构。

## 当前下一步

混合负载短预检已通过，完整一小时与 19 项性能尚未完成。上游 CLI 38 项变化已按 32 项适配和 6 项排除逐条评审，17 个实际文件的适配计划已应用；72 规则基线已刷新并完整归档旧凭证，候选与基线均尚未接受、上游锁尚未前进。SDK/LSP/Skill 凭证的 SDK 范围现采用具体 package_version（26.0.0.105），创建工程仍使用 platform_version（26.0.0）。新发现的签名配置准备失败分类已修复，需统一使用该次编译后的证据。下一步完成公共 MCP 复验、全部适用当前验收和迁移矩阵，再完成性能、长稳、平台 CI、正式发布及发布包安装/升级/回滚。

用户已在浏览器完成独立开发者认证；CodeGenie 独立回调也已成功，两个服务的云端读取和重启验收通过。个人团队创建新测试证书被云端明确拒绝：`SIGN_CLOUD_REJECTED / 205389872 / certificate number exceeds limit`。用户回复“暂时无法释放”，因此不删除其已有证书，不改用公司团队；现有 `MCPValidationd98b7ba2` 仍用于隔离测试。2026-09-12 已复用该证书完成新的云端调试 Profile、显式及工程配置签名和验签；额度仍阻止新建证书及其真实中断恢复，不能将复用路径记作新建路径通过或豁免。旧安装和宿主未被修改。使用 Node 24.14.1，不用系统 Node 26 重编共享 SQLite 依赖。真机最近一次启动的锁屏失败 `10106102` 仍不是已通过的效果证据。

## 当前证据（均为候选工作区，尚非发布包）

- G：`acceptance/native-7-remaining-existing-certificate-20260912-1/evidence.private.json` 为本轮新执行的公共 MCP 签名复用验收，completed/closed/unchanged/passed 均为 true。重新读取个人团队证书/已登记设备清单，核对原证书远程 ID、下载摘要、CSR 公钥及有效期；为本轮独立 bundle 新建 `test` Profile 并下载，再分别使用显式材料和新建 `ReusedCanary` 工程配置签名。两份 HAP 均通过 SDK 验签和包身份校验，提取 Profile 摘要与本轮云端下载一致。原证书、密钥、描述文件及原工程哈希保持；未访问设备或删除现有证书。云端临时 Profile 未返回可删除 ID，明确记录 `remote_deletion_available:false`，未虚构删除。私有驱动不冒充 `native-signing-acceptance.ts` 执行凭证，未据此接受上游映射或关闭新证书/中断恢复门槛。
- 2026-09-12 当前编译完整回归：`acceptance/native-7-remaining-final-regression-20260912-1/evidence.json` 为 544/544、零跳过。它包含真实认证兼容升级驱动改动后的完整源码与编译身份。
- F/G：`acceptance/native-7-remaining-natural-auth-refresh-20260912-1/evidence.private.json` 验证两个独立登录状态的缓存自然经过约 19.44/19.34 小时后，由公共 MCP 的真实云端查询触发刷新；未修改凭据或时间，没有注入响应。两个 provider 的 Access Token 均改变，JWT、账号、有效期及密钥保持原值，刷新保存时间推进；随后重启与 provider 隔离验证通过。伴随的当前标准报告分别为 `...native-7-remaining-final-auth-developer-20260912-1/evidence.json` 和 `...auth-codegenie-20260912-1/evidence.json`。该证据证明有效 JWT 下的真实缓存刷新，不声称服务端 401 或 JWT 失效恢复。
- 上游：2026-09-12 复核 CLI develop 未变，Code develop 前进到 `7b9b68c2f65e25d6a91f13d47d5b75622aacfe20`。逐行评审唯一新增的每日发布配置，未发现新的工具或 Skill 行为，沿用现有仓库发布设施排除规则；详见 [Code 每日发布评审](upstream-code-daily-review.md)。私有候选与评审计划已生成，尚未应用或接受，上游锁未改动。
- F：`acceptance/native-7-remaining-compatible-real-auth-20260911-1/evidence.json` 完整通过真实认证的兼容升级验收。将两个已登录且静止的独立状态中的原始凭据仅在内存中解密，并原样重加密到拥有的旧安装测试状态；不改有效期，原状态 DB、密钥及 WAL 哈希不变。旧版 0.3.0、升级到候选 0.4.0、worker 重启、MCP 进程重启及回滚到 0.3.0 五个阶段，两个 provider 均保持同一账号，团队读取和 CodeGenie 云知识查询均成功；历史工作流及产物哈希一致，回滚恢复 schema 1，所有 MCP 关闭。此项不声称在旧版重新完成浏览器登录，不覆盖真实过期 Token，也不代替最终发布包验收。新增驱动逻辑后的编译及 18 项兼容升级/维护测试通过；它改变源码和全量编译身份，因此下列早期报告保留原件，最终统一验收不能重新标记旧报告身份。
- 性能准备：`acceptance/native-7-remaining-full-benchmark-owner-20260911-4/orchestration.private.json` 的全部语义预检通过：19 项候选与 18 项基线能力，使用真实 SDK 构建生成 C++ 编译数据库、拥有的签名应用和独立模拟器；UI 输入、点击和电量变化均带实际页面断言，最终停止/删除与原件复核完成。前 3 次失败保留：分别是部署包参数包含不接受的 bytes 字段、复制的 C++ 数据库路径陈旧，以及预检误读实时查询的 matchCount/基线首轮截图尺寸和电量异步显示。第 4 轮使用两边一致的原生截图尺寸，电量操作后显式刷新页面并断言。以上仅证明用例能执行，尚未采集 1000 次性能样本，不能当成性能门槛通过。
- 长稳：`acceptance/native-7-remaining-final-mixed-soak-mcp-20260911-1/` 在 2026-09-12 恢复工作时确认原执行句柄已不存在，进程清单也没有该驱动或 soak 子进程。原报告只记录到临时模拟器启动，没有进入负载测量，不能计为一小时通过。保留原报告，先通过其独立状态核实遗留实例和工作流，再清理并以新目录重新执行。
- 签名配置修复后的完整回归：`acceptance/native-7-remaining-final-regression-20260911-3/evidence.json` 为 544/544、零跳过。当前真实认证复验分别为 `...native-7-remaining-final-auth-developer-20260911-2/evidence.json` 与 `...auth-codegenie-20260911-2/evidence.json`；沿用各自独立登录状态，云端查询、重启及 provider 隔离均通过。
- C：`...native-7-remaining-final-skills-mcp-20260911-3/capabilities.json`、`...native-7-remaining-final-lsp-mcp-20260911-3/capabilities.json`、`...native-7-remaining-final-capability-ui-mcp-20260911-3/capabilities.json` 分别提供 12/9/29 项当前凭证，伴随验收报告的完成、关闭、原件不变及六项身份均通过。UI 本轮截图已实际审阅：三处中文和 emoji、输入框及确认按钮完整可见，匹配本轮 read_token 的视觉回填成功；临时模拟器已清理。发布器严格核验 SDK package_version 26.0.0.105、私有原始观察摘要及逐项事实后，发布到 `provenance/capability-evidence/native-7-remaining-20260911-1/`。矩阵现为 36 项 required verified、14 项 boundary_verified；该结果不代替其余发布验收，上游锁更新后必须重新生成最终凭证。
- G：`...native-7-remaining-final-hot-readonly-owner-20260911-2/orchestration.private.json` 通过拥有的签名配置、热补丁和只读设备验收编排：同名配置真实失败为 `SIGN_CONFIG_EXISTS / failed` 且没有发布写入，新配置成功；`...native-7-remaining-final-hot-device-20260911-1/evidence.json` 与 `...native-7-remaining-final-device-readonly-20260911-1/evidence.json` 均通过。两次 HQF 与独立 UI 断言、watch 停止、原源码和签名描述哈希不变、临时模拟器停止删除及实例清单恢复均有证据。
- B：`...native-7-remaining-final-startup-fault-mcp-20260911-1/evidence.json` 通过当前身份复验，覆盖正常和慢首帧、持续白黑屏与明确纯色契约、延迟退出、无效显示器、已启动后取消、MCP 重启及再次部署；清理与原工程保持不变。
- 回归：`acceptance/native-7-remaining-capability-regression-20260911-2/evidence.json` 完整 543/543、零跳过。SDK、Checker、Lint、多模块分别在 `...native-7-remaining-final-{sdk,checker,lint,multimodule}-20260911-1/evidence.json` 通过真实验收；多模块只涵盖无签名构建，不能代替签名包集合部署。这些均早于随后签名配置修复，保留原件并待最终身份复验。
- F/G：`acceptance/native-7-remaining-final-auth-developer-20260911-1/evidence.json` 和 `...auth-codegenie-20260911-1/evidence.json` 通过真实公共 MCP 登录、云端查询、worker/MCP 重启与 provider 隔离。CodeGenie 验证了大结果分页和重启后的制品哈希。认证凭据保存在各自独立状态中，不写入公开证据。
- G：`acceptance/native-7-remaining-final-signing-prepared-20260911-1/` 已创建本轮独立 unsigned HAP、密钥与 CSR；`...native-7-remaining-final-signing-20260911-1/` 保留实际 preflight 成功和 certificate 创建被额度拒绝的失败。持久 run `c81faad5-6795-495a-9331-4105cffbe0a3` 已查询确认 `failed`，未创建新的云端资产，未盲目重试。
- 新发现：`acceptance/native-7-remaining-final-hot-readonly-owner-20260911-1/orchestration.private.json` 记录签名配置重名时错误进入 `needs_input / EFFECT_UNCERTAIN`；此时没有目标文件写入。现 SignatureService 在签名配置发布准备开始前的失败生成已确认失败回执，准备完成后的不确定写入仍使用原有哈希恢复。新增真实 WorkflowEngine/SignatureService 回归同时验证重名拒绝无写入、恢复失败任务不重做，以及实际文件发布后丢失回执的精确恢复；8 项针对性测试通过。该轮临时模拟器已停止删除，原工程、描述文件和实例清单复核未变。
- C：上一轮完整 Skill/LSP/UI 公共 MCP 凭证分别生成 12/9/29 项，但发布器在修改矩阵前严格拒绝 SDK 作用域 `26.0.0` 与要求 `26.0.0.105` 不符。已修正验收脚本从 doctor 读取 package_version；未修改原报告或放宽作用域。当时矩阵保持 50 项 pending；随后本轮新凭证完整通过，见上方当前记录。

- C/H：`acceptance/native-7-remaining-release-policy-20260911-1.tap` 为 29/29、零跳过的发布范围、性能门禁、Skills/资源、上游和能力门禁检查；这是当前门禁实现测试，不代表未执行的发布验收通过。
- C：新增逐操作验收凭证：Skill/LSP/UI 公共 MCP 驱动分别覆盖 12/9/15 个必需项，UI 驱动另记录 12 个客户端承担项与 2 个内置 Skill 产品排除项。凭证发布器只接受完整清理且六项身份一致的成功报告，校验私有原始观察摘要后仅发布明确断言的事实；50 项未齐全不更新能力矩阵。视觉步骤必须由宿主实际读取 MCP 交付图片并提交匹配 read_token 的观察，脚本不自动选择视觉结论。
- C：`acceptance/native-7-remaining-capability-skills-mcp-20260911-1/evidence.json` 完整通过，生成 12 项凭证；六个正文与三个引用读取、真实编译错误/修复、HAP 构建、文档/任务修订、陈旧写入拒绝和 MCP 重启验证通过。随后 UI 夹具改动会改变最终来源身份，因此保留为本轮预验收。
- C：`...capability-ui-mcp-20260911-1/evidence.json` 保留首轮失败：模拟器、构建、部署、项目选择、日志与取消均执行，验收脚本误把精简取消回执按完整状态解析。实例已停止删除，原清单恢复；脚本按实际契约修正。`...capability-lsp-mcp-20260911-1/evidence.json` 的 ArkTS 正例已通过，但选择了没有 C++ canary 的工程，后续 C++ 阶段失败；整轮不通过，改用已有 CMake 专用工程重跑。

- G：`acceptance/native-7-remaining-mixed-preflight-mcp-20260911-5/evidence.json` 通过短流程预检。独立拥有的模拟器运行 SDK watch 和一次 HQF；五步录制（tap、Ctrl+A、焦点文本、Back、确认）保存后重放成功；故意错误断言进入 `needs_input / EFFECT_UNCERTAIN`，实际原因 `VERIFICATION_FAILED`。修正画面后用 `resume_input:{action:"recheck"}` 恢复，已完成 UI 子操作回执不变。连续日志开始、结束、搜索、导出校验及 watch/模拟器清理通过。原工程哈希与原实例清单恢复；这是短预检，不能满足一小时长稳门禁。
- G：上述 `...-1`、`...-2`、`...-3`、`...-4` 失败证据均保留。前两轮真实截图显示全新模拟器的系统输入法隐私页，本工具正确拒绝把焦点输入送到其他应用；拥有的测试页面改用应用自带自定义键盘，未接受系统协议。第三轮补齐原生插入文本前的 Ctrl+A，第 4 轮补齐公共恢复契约必需的 `resume_input`。这些是验收夹具问题，没有放宽产品窗口校验或恢复规则。
- B/H：2026-09-11 再次核对官方 develop，Code `aeb4536…`、CLI `87c360b…` 未变。CLI 38 个变化路径已补全映射：启动检查、完整 bundle PID、查询失败、共享截图、文档，以及 6 个仓库维护说明的明确排除。具体语义差异见 [CLI 启动检查适配评审](upstream-cli-startup-review.md)。尚未接受候选或改写上游锁，仍需最终映射检查与接受回执。

- D：`acceptance/native-7-remaining-recording-privacy-mcp-20260911-1/evidence.json` 通过。拥有的三密码框专用页面，无焦点、三匹配选择器、不存在窗口均明确拒绝且未录入动作；正常录制以 secret 输入变量保存稳定控件选择器，MCP 重启后使用新随机密码重放成功。故意错误断言产生 `VERIFICATION_FAILED`，随后取消和重启。三轮扫描分别覆盖 96/240/238 个状态、SQLite/WAL、日志与制品文件，UTF-8/JSON/UTF-16LE 均为 0 个完整测试密码明文匹配。独立 `visual-review.json` 记录三个留存截图的直接视觉审阅或相同 SHA-256 复用审阅：密码以圆点显示，仅有长度 40。范围仅限这些截图与测试密码，不能宣称任意应用截图自动脱敏；原工程及模拟器清理复核通过。
- 回归：`acceptance/native-7-remaining-log-lifecycle-regression-20260911-1/evidence.json` 为 Node 24.14.1/macOS 下 540/540、零跳过的完整回归，包含密码驱动与日志步骤/配额修复，早于随后发布门禁和长跑脚本改动。
- C/H：发布范围 format 1 历史豁免限制在已授权的 0.3.0；format 2 要求全部 19 项当前性能、当前长稳及五类新增能力和热补丁/模拟器效果独立验收。当前源码、运行时、编译、依赖、资源和上游锁六个哈希均纳入测量身份检查。31 项门禁及证据回归通过，不代表真实性能或长跑已执行。

- A：`acceptance/native-7-remaining-lsp-mcp-20260911-7/evidence.json` 全链路通过。LF/CRLF 和 UTF-16 下，新增同文件函数、同文件/跨文件类方法、嵌套箭头函数的精确双向调用关系；definition/references/hover/implementation、真实类型错误 2322 的位置与修复后空诊断、合法空符号、公共取消到 worker 的 `CANCELLED` 事件、后续查询及 MCP 重启均通过，clangd 分项按实际服务结果记录。当前 22 项 LSP 与 5 项 worker/关闭测试通过。
- A：`...-3` 保留 SDK 嵌套箭头函数 range 不包含变量名 selectionRange 的失败；`...-4` 保留类方法出调用每处重复两次/坐标错误的失败。候选用同一 SDK 的精确变量符号声明确认包围范围，用反向调用者身份与总数/不同坐标数匹配确认调用点，原始范围不丢失。`...-5` 暴露 worker 默认 AbortError 被记成 INTERNAL_ERROR；现在取消和关闭使用私密原因隔离的 CANCELLED，MCP SDK 的本地取消回执与 worker 持久失败事件分别核对。
- A：`...-6` 保留 `DIAGNOSTICS_TIMEOUT` 失败。SDK 26 宣告拉取诊断、未发布推送通知，原始双握手实测可拉取“空 → 类型错 → 修复后空”。候选按 diagnosticProvider 选择完整拉取报告，否则保留推送诊断；不把服务错误、null 或没有 previousResultId 的 unchanged 转为空成功。原始报告为本任务可视化目录 `lsp-diagnostics-probe-20260911-1/probe-results.json`，公共 MCP 正例见 `...-7`。
- A：`acceptance/native-7-remaining-lsp-mcp-20260911-2/evidence.json`，真实公共 stdio MCP → worker → ArkTS SDK。五项操作、LF/CRLF、中文/emoji UTF-16、多次跨文件调用精确范围、合法空结果、MCP 重启通过。前一次 `...-1` 的 URI 失败证据保留。仍需嵌套/类方法与旧能力组合验收。
- B：`acceptance/native-7-remaining-startup-mcp-20260911-1/evidence.json`，专用 app `com.deveco.mcpacceptance.ad98b7ba2`、设备 `4VF0225613017854`。真实导航启动的延迟进程检查、应用窗口截图、独立控件断言、同状态 MCP 重启通过；不能代替可控崩溃/纯色等实机用例。
- D：`acceptance/native-7-remaining-recording-v2-mcp-20260911-1/evidence.json`，公共 MCP 完成 tap/focusInput/key/mouseClick 录制、保存、MCP 重启、重放和中文/emoji 最终控件断言；38 项录制/流程/控制回归通过。尚不能代表所有鼠标事件和方向 fling 都有实机效果证据。
- D：新增 `scripts/native-recording-mouse-mcp-acceptance.ts`。`acceptance/native-7-remaining-recording-mouse-mcp-20260911-2/evidence.json` 完整通过：拥有的签名工程副本及独立模拟器，右键加 Ctrl、左键双击、至少 500ms 长按、移动、带轨迹移动、拖动时左键保持、滚轮及上下方向 fling 均有真实应用事件/滚动回调断言。十步保存后的按钮/组合键/轨迹/速度/滚轮参数/方向/采样数一致；MCP 重启后原流程哈希一致，完整重放的最终八项事件状态通过，临时实例停止/删除及原工程哈希复核通过。这不是实体鼠标或多显示器实测。
- D：首轮 `...recording-mouse-mcp-20260911-1/evidence.json` 保留失败：七种鼠标效果已通过，测试在文档顶部发送原生方向 2 后期待滚动，最终断言失败。核对 OpenHarmony `ui_input.cpp` 后确认 CLI 2 从屏幕上部向中心移动，3 从下部向中心移动；第二轮按原生语义先滚向文档下方再上方，分别断言正/负滚动回调，没有改动产品方向映射或把接受回执算作效果。
- E：`acceptance/native-7-remaining-continuous-log-mcp-20260911-1/evidence.json` 保留首轮失败。拥有的日志压力工程构建、安装成功，启动因锁屏失败，未创建 UI 测试。手机现装的是该专用 bundle 的日志压力版本；基础工程未改动。后续使用新验收目录，保留失败原件。
- E：连续采集以应用 UID 枚举 PID 和进程起始时间，二次核验时间/身份后持久化；有界队列、背压、配额、密文 UI 输入脱敏、进程变化/断连 gap、跨进程历史读取、停止/导出/回收均有针对性测试。声明系统投递完整度 unknown；不能以已接收分块的哈希验证冒充操作系统没有丢日志。
- E：`acceptance/native-7-remaining-log-lifecycle-mcp-20260911-1/evidence.json` 保留失败：应用重启后的新 PID 日志已经捕获，但 `resume`/`check` 没有输入 `step_id`，产品错误地将它们统一标成 `test`。现按持久化计划的首个未完成步骤标记接收上下文，MCP 重启后沿用同一规则；未通过校验的 `act.step_id` 不能改变日志归属。这只是接收上下文，不声称步骤因果关系。
- E：`acceptance/native-7-remaining-log-lifecycle-mcp-20260911-2/evidence.json` 完整通过。专用应用强停/重启后 UID 一致、PID/starttime 改变，模拟器系统重启出现真实离线与 `UI_LOG_STREAM_ENDED`/`HDC_FAILED` gap，随后恢复采集；三个进程代际的日志保持可查询且序号没有重复。MCP 重启保留历史并恢复，最终取消为 `test_cancelled`，采集进程与日志/测试租约为空，33 个导出制品 SHA-256 全部核实。原工程哈希、停止/删除实例及原实例清单恢复均通过。故障注入只针对该轮拥有的模拟器及应用，不代表物理设备、短生命周期子进程或系统无损投递。
- E：23 项 UI 测试/连续日志/传输回归通过。新增配额测试使用明确标注的边界台账注入，验证超出 64 MiB 或 8192 分块前拒绝发布新制品，历史仍可读、重启后保持 exhausted 且不重复启动读取器；ENOSPC 注入验证只尝试一次失败写入、正确释放租约及读取器。没有把这些确定性故障测试写成真实磁盘填满或设备容量压力证据。
- E：`acceptance/native-7-remaining-emulator-log-mcp-20260911-1/continuous/evidence.json` 保留真实失败：6000 行中收到 5540 行，缺少 5461–5920，并记录 `UI_LOG_CLOCK_CHANGED`。代码存在时间观察竞态：在远程时钟已取样、响应尚未返回期间继续接收较晚日志，导致合法尾部被误判。现每次身份/时间校验前暂停读取，验证后恢复；针对性竞态测试保留两侧数据，并继续拒绝真实未来时间/时钟跳变，相关采集与持久化 10 项测试通过。
- E：修复后的 `acceptance/native-7-remaining-emulator-log-mcp-20260911-2/evidence.json` 与 `continuous/evidence.json` 均通过。真实签名专用 app 在拥有的独立模拟器输出 6000 行中文/emoji，编号 1–6000 全部且无重复；分页读取、MCP 重启后历史一致、显式恢复、结束、175 个导出制品哈希与临时模拟器停止/删除通过。运行时关闭时另有 105 字节未验证脉冲尾部丢弃，已如实记录 gap，不能宣称整个系统日志无损。原专用工程源码未改。公开说明见 [UI 测试连续日志](native-ui-logs.md)。
- F：维护计划升级到 format 2；已知 native-7 旧 schema 可原目录保留，经 schema revision 2 增量迁移。持久维护 fence、实例登记与 SQLite 互斥保护切换；journal 内按块加密完整状态快照，SQLite 快照包含 WAL，回滚恢复原目录并保留升级后状态副本。用户环境变量、cwd、env_vars、其他 MCP 设置语义保留；TOML 使用固定版本解析器。有效/过期凭据测试为拥有的受控夹具，不是用户真实云端登录验收。
- F：`acceptance/native-7-remaining-compatible-cli-20260911-1/evidence.json` 通过。复制真实 0.3.0 安装，由旧公共 MCP 创建工作流/制品，候选公共维护 CLI 检查活跃实例后原目录升级；候选公共 MCP、worker 重启、MCP 重启均能读取原历史/制品与凭据状态；回滚后旧公共 MCP 继续读取，并恢复 schema 1 和原宿主配置。最后补上“回滚完成记录已写入、维护 fence 未释放”中断窗口，重试仅完成锁清理、不再覆盖回滚后的新数据；18 项相关测试通过。
- B：日志 anchor 单独限制为最多 1 秒/总预算四分之一，避免诊断查询占满启动预算；首次进程观测前取消也保留未验证报告和制品。相关启动/恢复/场景组合共 28 项测试通过，取消详情不输出原始错误中的私密信息。
- B：新增 `scripts/native-startup-fault-mcp-acceptance.ts`，通过公共 MCP 在临时模拟器安装拥有的签名工程副本，覆盖正常页面、4 秒慢首帧、持续白屏/黑屏及显式纯色契约、2.5 秒后进程 abort、无效显示器、已确认启动后的取消、同状态 MCP 重启和恢复。原工程未改，模拟器清理后核对原清单。
- B：`acceptance/native-7-remaining-startup-fault-mcp-20260911-1/evidence.json` 保留首轮失败：正常/慢首帧/纯色契约/崩溃/显示器失败语义均符合预期，但已持久启动回执后的取消误留 `needs_input / CANCEL_UNCONFIRMED`。第一层原因是取消发生在进入启动检查的嵌套 lease 之前，缺失已确认效果的收尾报告；候选现在直接保留本地 cancelled 报告和制品，不执行新的设备查询。
- B：第二轮 `...-2/evidence.json` 保留更深层失败：启动节点已生成 cancelled 报告并写入 settled failure，但 LangGraph 的 signal race 在该节点结束前返回，工作流提前检查仍在清理的受管进程并写入 `CANCEL_UNCONFIRMED`。候选保留节点内取消信号及边界检查，让 graph.invoke 等待原生节点收尾，不再另设会提前返回的图级取消信号。取消与运行时关闭均验证清理前资源 lease 保持、清理后终态正确、下一节点不执行；44 项针对性测试通过。
- B：第三轮 `...-3/evidence.json` 的取消已正确终结为 `cancelled`。随后发现验收所有权错误：模拟器由被重启的同一个 MCP 启动，MCP 关闭正常回收模拟器，导致重启后部署报 `DEVICE_NOT_FOUND`。脚本现用独立公共 MCP 管理模拟器生命周期，被测 MCP 单独保存工作流并重启；没有修改产品的资源回收策略。
- B：第四轮 `acceptance/native-7-remaining-startup-fault-mcp-20260911-4/evidence.json` 完整通过。正常页面、4 秒慢首帧、持续白/黑屏的不确定结果与显式纯色契约、2.5 秒后进程退出、无效显示器、持久启动回执后取消、同状态 MCP 重启保持历史及正常再次部署全部验证；每项启动检查与业务断言分别记录。临时实例停止/删除和原清单、原工程源码哈希复核通过。无效显示器证明截图范围查询失败，不代替实际设备断连覆盖。
- 回归：`acceptance/native-7-remaining-cancel-regression-20260911-1/evidence.json` 为 Node 24.14.1/macOS 上 534/534、零跳过的完整回归，覆盖当前 LSP、连续日志、升级和工作流取消修复。它不是最终发布包或跨平台证据。
- G：`emulator_scenario.verify` 接收目标 bundle 与 UI assertion；`native_operation` 分别保存 `execute_native_operation` 的命令回执和 `verify_native_outcome` 的应用观察报告。断言失败后重启/恢复只重查画面，不重复已接受场景操作。跨应用选择器拒绝、失败恢复与取消已测试；观察范围是捕获应用 UI，不改写原生 `stateVerified:false` 为全局物理状态已验证。
- G：新增 `scripts/native-hot-outcome-mcp-acceptance.ts`。`acceptance/native-7-remaining-hot-outcome-mcp-20260911-1/evidence.json` 保留真实失败：连续两轮热补丁、无效源码拒绝后保留原进程/画面、修复后的第三轮热补丁均通过；新增文件的 `COLD_DEPLOY_REQUIRED` 被外层效果日志包装为 `EFFECT_UNCERTAIN / needs_input`。现将首次热补丁的只读准备失败写为已终结错误；恢复旧任务时仍保留原操作不确定性，不以新预检失败抹去丢失的 SDK 回执。公共完整部署和直接 Apply 两条工作流增加回归，后续新目录重跑，不能把首轮算作通过。
- G：`acceptance/native-7-remaining-hot-outcome-mcp-20260911-2/evidence.json` 完整通过。两轮 HQF 和修复后第三轮均确认应用 PID 保持、默认启动检查通过、独立 UI 断言通过；错误源码拒绝和新增文件 `COLD_DEPLOY_REQUIRED / failed` 均保留上一轮 PID/画面。显式停止 watch 后，完整部署成功、PID 改变、页面显示新内容，最终 UI 树/截图、临时模拟器停止/删除和原清单复核通过。直接 Apply 与组合部署的准备/恢复回归共 20 项通过；完整回归 `acceptance/native-7-remaining-hot-preparation-regression-20260911-1/evidence.json` 为 536/536、零跳过。仍非最终发布身份或跨平台证据。
- G：`acceptance/native-7-remaining-emulator-outcome-mcp-20260911-1/evidence.json` 保留验收脚本失败：拥有的临时模拟器创建、启动、同步、构建均成功，脚本误读 `build` 输出键，未部署/执行场景。临时实例已停止并删除，原清单恢复。脚本改为实际 `build_project` 键，以 `...-2` 新目录重跑。
- G：`...emulator-outcome-mcp-20260911-2/evidence.json` 的光照 1234.3/4321.2、电量 31/80 与故意错误断言分项均符合预期；末尾 `ui_inspect` 在 `uitest dumpLayout` 阶段 30 秒超时，未执行到截图，整轮保留为失败。临时实例清理成功。`...-3/evidence.json` 新实例完整通过，包括相同断言、原生湿度/温度拒绝、最终 UI 树与截图、停止/删除及原清单复核。没有修改产品查询代码或放宽断言；第二轮超时根因仍未确认，需在后续取消/长稳验收关注。第三轮断言刚结束时设备仍有一个 `uitest` 进程，随后查询正常，不能据此直接判定孤儿进程。
- 回归：`acceptance/native-7-remaining-compat-regression-20260911-1/evidence.json` 为 518/518、零跳过的首轮完整回归；它早于随后 CLI/启动/场景改动，不作为最终身份完整回归。
- A 的 18 项针对性测试、C 的 7 项门禁测试通过；B/热重载 19 项测试、路由 11 项、部署恢复及 UI 测试通过。每次源码改变后的最终身份验收仍待统一重跑。
- 以上 acceptance 相对路径位于 `/Users/dreamlike/Library/Application Support/DevEcoMCP/`；原文件不改写。
- SDK outgoingCalls 将 caller 的 fromSpans 用 callee 文档映射，导致跨文件偏移。现在用反向 incomingCalls 的调用者 URI/selectionRange/调用数一致性校正；无法证明的情形返回精确错误。
- 最新上游已复核：Code develop `aeb4536e56d1bfe8b5a0ff3bb02acb99f3523f2a`，CLI develop `87c360b05848132c06c6ea120e078619b9ef4634`。CLI 锁尚未更新，需与实现、文档和最终证据一起审查。
- format 2 矩阵在新凭证齐备前保留 50 项 acceptance=pending；未以旧证据或 unsupported 伪造当前功能通过。最新状态见上方当前记录。
