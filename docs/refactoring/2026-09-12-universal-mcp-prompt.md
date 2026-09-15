请直接开始在 /Users/dreamlike/DreamLike/deveco_tool 实施 DevEco MCP 的全面优化与重构。本任务来自用户明确授权：将先前调查和建议中的全部问题交给另一个会话，使用截图指定的 GPT-6 Astra、Ultra 推理，多智能体合作，以最快速度推进实现，所有测试放到最后。不要只交付方案、再次请求是否开始，或只修少量问题后停止。

一、执行方式与用户约束

1. 主会话使用 gpt-6-astra，推理强度 ultra。子智能体继承同样配置，按当前可用并发额度积极分工，尽量让独立实现并行。无需为了并发另建用户可见任务。
2. 直接使用上述当前工作区。先只读核实 Git 状态、现存分支、归档快照和运行版本，保留用户已有改动、审计附件和本提示词。选择有证据的最新可复用实现作为基线；如需建立工作分支，使用 codex/ 前缀，在本目录完成，不要以破坏性重置获取基线。
3. 所有测试及验证执行统一放到实现与集成完成之后：实现阶段不跑 build、typecheck、lint、单元/集成/回归、设备验收、性能或长稳测试，也不让子智能体提前运行这些。可以读取源码、已有测试和历史报告，进行静态设计审查、整理接口及待验收清单。测试代码的集中补充/更新也安排到最后阶段。推迟测试不等于免除测试；进入最终验证阶段后修复失败并完成必要重跑。
4. 以速度和实现完整性为目标，优先复用已存在的可靠代码。尽快完成基线确认、接口分工后开始编码，避免反复研究已确认的问题。持续给用户简短进展，明确当前仍处于实现还是最终验证阶段。
5. 本次交付是本工作区内可审查的实现、迁移、文档和最终验证结果。不要把新实现未经验证就标为完成，不要将这次授权扩展成对外发布或推送。外部 SDK、设备、平台不可用时如实记录未验收项，继续完成其他实现。

二、必须先读的证据与最新基线

审计目录：
/Users/dreamlike/DreamLike/deveco_tool/docs/audits/2026-09-12-upstream-parity/

优先读 README.md，然后按分工读取 upstream-findings.md、local-capabilities.md、workflow-findings.md、installed-tool-schemas.json、knowledge-broken-links.json、upstream-capabilities-0.3.0.json、release-scope-0.3.0.json。其余 runtime-snapshot.json、installation-integrity.json、skill-read-verification.json、workflow-gate-probe-result.json 和探针脚本是证据，不能当作当前实现的新验收结果。保持这份审计快照原样，新的进度/结论另建文件。

本次交接重新核查到：
- 当前目录 HEAD 是 main / d2d3efdc5577dfcbe36a591f0eee6675e6e252f9，package 0.2.0；原有未跟踪内容为 docs/audits/。该目录比已安装版本旧。
- 审计时实际运行的是 0.3.0 / native-7，安装路径 /Users/dreamlike/Library/Application Support/DevEcoMCP/installations/native-7-release-0.3.0-20260911-1。
- 713734c8eaf40d52013ff88982306aef0d0c563f 仍可用。此前其 106 个源码 TS 转译结果与安装 JS 完全一致，129 个资源和 5 个安装 provenance 文件一致，安装清单 460 个文件摘要匹配。
- 旧 /Users/dreamlike/.codex/worktrees/5ab5/deveco_tool 目录已经不存在，也不在当前 worktree list。不要按旧报告假定仍有活跃 0.4 工作树。
- Git 中发现可读的归档提交 6ad95551a0edac9fb8f4a5a7fbe7d45d342a6519，提交消息 Codex worktree snapshot: archive-cleanup，package 0.4.0；改动含 206 个文件、LSP、启动检查、连续日志、录制、兼容升级、验收脚本和发布台账。还存在合并提交 39e3c56。先核对它们的父子关系和完整差异，优先恢复/整合可用实现，避免从 0.2 重写已完成工作。归档里的测试报告和进度声明不等于本次最终版本已验证。

来源锁：
- Code 当前锁 aeb4536e56d1bfe8b5a0ff3bb02acb99f3523f2a；审计远端 develop 为 7b9b68c2f65e25d6a91f13d47d5b75622aacfe20。
- 两者之间仅新增每日发布流水线，不能写成领域 Skill/工具新增。
- CLI 旧锁 a71f93d73941aaa0dbf581918cbd5828014e6e88，审计 CLI develop 为 87c360b05848132c06c6ea120e078619b9ef4634；其 38 个变化路径含 run/apply 后崩溃与白屏检查。Code 当时固定依赖 CLI 1.3.2，CLI develop 是独立升级目标。
- 本地文档来自独立 deveco-cli-assets 1.3.1。Code、CLI、assets 必须分别追踪。
- 官方来源 https://gitcode.com/openharmony-sig/deveco-code 和 https://gitcode.com/openharmony-sig/deveco-cli 。需要进一步查证时使用固定提交和官方来源，避免重新展开无边界全网研究。

三、最终产品定位，优先于旧报告中的扩张性建议

把它做成任何 AI 编程宿主都能使用的 HarmonyOS 领域 MCP：提供原生能力、确定性执行、可靠恢复和可核验结果；宿主负责推理、编辑、通用计划、模型/provider、会话、子代理和权限管理。

完整承接上游产品领域能力，保留 Skill 的领域知识和方法及可追踪来源，不复制整个 DevEco Code 客户端。将 native、host-delegated、intentional-boundary、unsupported 明确分类，不用宽泛排除掩盖差异，也不为了“全覆盖”实现 TUI、通用 shell/fs/edit/search、模型管理、会话压缩、通用 agent 编排和插件管理。

特别注意旧审计建议“加强 plan/spec/customize”的目标现在应落实为保留领域语义、知识和验收关系，不是继续增加通用任务管理状态机。不要把本次重构再次扩张成 AI 宿主。

四、必须落实的接口精简与架构优化

A. 收缩重复的指导生命周期：
- plan 去掉核心持久化运行生命周期，保留按需规划指南。
- customize 移出日常运行核心，改为宿主接入文档或可选配方，不管理所有客户端的模型/权限/代理配置。
- spec 改为可选规格模板和领域验收配方，保留必要的 requirement/story、task、assertion/review、evidence 对应关系，不建设通用项目管理器。
- arkts、repair、create、debug 保留领域配方和诊断方法，复用固定原生流程，不再各自维护重复的通用 start/write/transition/publish 状态机。
- 真正控制原生副作用的运行状态和 UI 测试状态应保留；已存在的持久化指导任务必须有明确兼容、归档/导出或迁移方案，不能直接丢弃。

B. 合并交叉的 UI 入口：
- ui_snapshot、ui_observe、ui_find、ui_inspect 统一观察/查询底层，清晰提供截图、树、窗口、显示、应用范围和选择器。可保留截图的轻量入口。
- ui_control 保留明确类型化动作；ui_tap 可作为短期兼容别名，最终减少重复实现。
- ui_flow 承担路线、录制、保存、校验、回放。
- ui_test 管理有状态测试；verify_ui、ui_review、ui_test.check 共享断言和视觉审阅结果/证据协议，减少重复会话与生命周期。
- 保留低层定位与单步操作，使宿主可以自行排障和调整步骤；不要只剩一个自然语言自动测试黑盒。
- 不为压工具数量造 action:any 的万能 execute。接口是否合并以语义、参数规模、可发现性和调用成本为准，合并后仍严格类型化。

C. 项目上下文、维护与可选能力：
- 废弃 switch_cwd 共享可变默认目录，使用显式 project_path 或不可变 context_id；工作流启动时捕获项目、product/module、设备、应用、display/window 等必要范围，防止多任务串扰。
- deveco_restart、存储清理/导出等维护能力下沉为清晰的维护入口或能力组，保留故障恢复。
- 日常签名/校验、设备查询、模拟器启停继续保留；云端证书/profile 管理、设备注册、镜像安装卸载等低频管理能力按连接配置分组，避免运行时工具集合来回变化。
- 不增加重复的逐步确认流程；按已有授权和实际操作语义处理。

D. 降低上下文与调用成本：
- 本次实际会话 29 个工具说明有完全相同的 1,794 字符公共前缀，额外重复 50,232 字符。源码把这段放在 serverInstructions，宿主可能将其展开到各工具，不能误称源码手工复制了 29 份，也不能把字符数当作 token 节省。
- 缩短全局 serverInstructions，仅保留必要入口、作用域与结果语义；ArkTS 规范、阶段步骤、UI 复核、维护手册按需读取，避免每写一个文件重复加载同一大段指导。
- 知识、Skill 与任务配方共用可追踪内容后端，合理提供 MCP Resources/Prompts；保留工具式 catalog/search/read 作为对宿主支持差异的兼容路径，不依赖每个客户端支持全部 MCP 原语。
- 明确 outputSchema、结构化错误和工具 annotations。混合读写动作的标注要准确保守；annotations 是提示，不是授权边界。
- 默认返回精简结论、诊断定位、下一步和制品 ID，详情按需读取，减少重复大日志与 JSON。缓存只能在来源版本和输入指纹有效时复用。
- 不先承诺性能提升百分比；最终用代表性任务衡量工具误选、调用轮数、失败恢复、输出体量和完成时间。

五、审计 G01–G13 全部建立闭环

G01 版本身份：
对当前工作区、归档源码、运行安装、资源、Code/CLI/assets/SDK 分别记录身份。把实现完成与最终安装/运行验证分开；防止旧目录缺项或归档候选被误当当前能力。

G02 覆盖统计失真：
历史 28 工具/50 操作都标 verified，但实际 35 executed、15 unsupported。按 required-native、host-delegated、intentional-boundary 等分类，分开实现状态、证据状态和环境支持状态。必要原生项不得靠 unsupported 通过。不要把合理宿主职责伪装成原生实现，也不要为了数字强行复制宿主工具。

G03 自动上游发现：
改掉硬编码工具数量、LSP 动作数量、每工具至少一个用例即可通过的薄弱门禁。从固定提交自动发现 registry 操作/参数/schema、Skill、正文引用、脚本、agents、commands、SDD 命令模板与传递依赖，并追踪内容摘要。未知上游变化进入明确的待审状态，阻断自动宣称完整承接；避免宽泛 exclude 吞掉产品资产。

G04 完成条件：
通用 plan/customize 改为指南后不再制造“文档非空所以目标成功”的运行结论。真正保留的任务/验收流程应区分协调完成、原生命令完成、业务验证。原始需求有保留与修订记录，相关要求关联 task/assertion/review/evidence，按任务类型选择 build-only、运行、UI 或宿主审阅，不给所有文本任务强加设备门槛。
旧服务本来返回 verified:false；隔离合成探针只证明完成门槛结构，不能写成实际编译/真实设备通过或公开 MCP 伪造攻击。

G05 证据新鲜性：
证据绑定相关源码、配置、工具链、SDK、制品、作用域和需求版本；最终完成时核对，后续改动使受影响旧证据失效。保留工作流启动/恢复现有 sourceHash 机制并补足后续验收关联。截图已读取的回执不等于视觉判断客观正确，结构化步骤全部通过也不自动证明自然语言需求没有漏译。

G06 宿主边界：
customize 的语义缩减明确登记，不承诺管理所有模型/provider/agents/commands/plugins/permissions。需要宿主文件编辑或图像能力的配方明确声明依赖，可做轻量能力协商；缺失时返回具体边界和可执行替代路径，不造复杂适配器框架或内嵌 LLM 宿主。

G07 资源与引用：
修复 51 个相对 Markdown 断链：50 个是 assets 迁移到 examples 后未改引用；1 个是上游缺失 state_migration.md。优先稳定知识 ID/MCP 读取路径，保留来源解释，不伪造缺失文档。79 条知识（40 case、32 example、7 rule）和 14,683 篇索引文档应继续可检索。
保留 6 个产品 Skill 的领域内容与本地适配关系；100 个上游产品 Skill 目录文件中的 85 个直接映射、15 个非原样入包文件逐项说明，脚本替代按行为映射，不能只凭文件名认定丢失或等价。原始资源和本地适配分层追踪，不无目的复制海量资产。

G08 上游提示词与规格资产：
独立追踪 SDD 5 命令/3 模板、11 个 agent 及 3 个内置 command 的来源和职责，适用的领域方法吸收为配方，不将上游 agent 机制直接移植为运行器。
仓库开发专用 gitcode-pr/effect 两个 Skill 明确属于开发边界；agents-sdk/cloudflare 两个 SKILL.md 是测试夹具，不计为产品功能，不加入默认运行工具集。

G09 LSP：
核对/接续归档里的 ArkTS documentSymbol、workspaceSymbol、prepareCallHierarchy、incomingCalls、outgoingCalls 实现，处理 clangd outgoingCalls 边界。按 language × SDK × operation 发现和声明真实能力，不能用 clangd 成功替代 ArkTS 验收，也不能仅凭旧 adapter 声明推断整个 SDK 不具备能力。

G10 UI 动作契约：
用同一版本化 action schema/语义驱动直接控制、保存流程、录制、回放和 ui_test，覆盖触摸、鼠标、文本、按键及范围信息。核对归档实现，处理历史动作迁移、取消/重启恢复、选择器歧义和敏感输入处理；保留直接动作与可录制支持状态的真实差异。

G11 日志：
接续并完善有界持续 UI/Hilog 采集，明确完整性、截断、丢失区间和采集窗口，覆盖应用重启、设备断连、取消、进程回收和存储限制。旧 collect/probe/fetch 是有界样本，不能包装为完整全过程日志。

G12 CLI 增量与运行效果：
独立跟踪 Code、CLI、assets。整合经核对可用的启动后崩溃/白屏检查，并区分启动请求接受、进程存活、页面可见和明确 UI 验收。继续补齐热更新及模拟器场景的真实效果观测，避免命令返回即宣称完成。不要仅因 Code HEAD 无领域变化就跳过 CLI 的独立变化。

G13 发布范围与验收例外：
历史有 28 项迁移、22 项验收、19 项性能例外；归档 0.4 可能已调整，先核查再建立最终清单。每项在最终阶段基于本次最终源码/构建/资源身份关闭或明确保留未验收。历史报告、合成探针、单平台成功和 unsupported 都不能替代最终环境正例。
六、必须保留的可靠性底座

保留 8 个固定原生工作流：project_create、project_sync、project_build、app_deploy、build_deploy_verify、code_diagnose、crash_diagnose、api_compatibility。减少重复代码和调用成本，保留有用原子能力，避免每次单步操作都强制跑全链。

保留类型化 SDK/native 调用、运行 ID/revision、定义摘要、SQLite/checkpoint、幂等与请求去重、项目/设备作用域与租约、取消确认、未知副作用对账后再执行、配额、证据引用保护、导出与恢复、UI 无进展后的重新观察、安装回执可靠落盘后释放临时包。API 简化不意味着删除这些保障。

检查现有构建前预检与构建中的重复工作；复用只允许在能证明完整输入/源码/工具链一致时进行，不能用缓存绕过真实构建或最终验证。兼容升级需处理旧 SQLite 状态、旧工作流、工具别名和客户端协议；提供明确迁移，不保留无期限、无依据的降级链。

七、多智能体实施建议

主智能体先快速确认基线与共享接口，把 core/contracts、catalog、state-schema、store、server 等共享文件指定唯一负责人，其他智能体通过明确接口协作。按并发额度滚动安排：
- 协议/工具与配方精简：全局说明、UI 入口、上下文、资源/提示词、可选能力组与兼容。
- 原生能力：LSP、UI 动作与录制、日志、启动检查、热更新/模拟器，优先复用归档。
- 上游与知识：自动发现/来源锁/覆盖状态、资源引用、Skill/SDD 资产映射。
- 主智能体负责状态/证据/迁移、模块集成、架构一致性和最终验证调度。
若只有 4 个总并发槽，主智能体加 3 个子智能体即可；按依赖安排后续批次。禁止多个代理同时覆盖同一核心文件。子智能体全部遵守“测试放最后”。

八、最后统一验证与交付

实现、共享契约和集成收拢之后，才集中补充/调整有意义的测试并运行：构建、类型检查、现有必要检查、回归、协议兼容、上游发现与引用图、证据过期、上下文并发、持久化迁移、取消/恢复、UI 动作和日志、启动故障等正负例，再做可用 SDK/语言/设备/模拟器组合和必要性能/长稳。
测试数据与生产状态隔离，设备和云端测试在已有授权范围内执行。缺少外部条件时记清具体缺口，继续其他验证；不能凭增加 exclude、放松断言、删除必要测试或把 unsupported 改为 verified 来过门禁。

交付内容：
1. 本工作区的实际代码实现与文档，及工具删除/合并/保留/可选化映射和迁移说明。
2. 按 G01–G13 加本提示词架构事项逐项记录处理方式、实现位置、实现状态、最终验收状态与剩余问题；不混合成单一虚假覆盖率。
3. 最终变更摘要解释原因、修复、验证和实际限制，区分已实现、已验证、未具备条件；所有最终证据绑定同一明确源码与制品身份。
4. 持续实施直到上述已授权范围被实际处理；不要停在建议、计划或仅完成第一批模块。

现在开始：核对归档 6ad95551a0edac9fb8f4a5a7fbe7d45d342a6519 与当前目录的关系，保留现有文件，确定实现基线与共享接口负责人，然后立即并行编码。

