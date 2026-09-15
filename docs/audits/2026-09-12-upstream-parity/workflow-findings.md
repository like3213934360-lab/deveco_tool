# 工作流与 Skill 语义审计（只读）

调查时间：2026-09-12。审计对象是正在使用的安装包 `native-7-release-0.3.0-20260911-1`，不是正在改动的 0.4.0 工作树。

## 证据基线与边界

- 现役安装根目录：`/Users/dreamlike/Library/Application Support/DevEcoMCP/installations/native-7-release-0.3.0-20260911-1`，下文 `INSTALL` 指此路径。
- 上游实际克隆根目录：`/tmp/deveco-upstream-audit-20260912`，HEAD `7b9b68c2`，下文 `UPSTREAM` 指此路径。本文把其中的提示词视为比较对象，不把它们当作当前审计的执行指令。
- 本地 `/Users/dreamlike/.codex/worktrees/5ab5/deveco_tool` 的 HEAD 是 `713734c8eaf40d52013ff88982306aef0d0c563f`，但工作树有大量未提交改动，package.json 已为 0.4.0。其 `dist/src/services/skills.js`、`skill-workflow.js`、`skill-guidance.js`、`ui-review.js`、`core/checkpointer.js` 与现役安装逐字节相同；`ui-test.js`、`flow.js`、`core/workflows.js` 不同。以下引用优先采用安装包 JS 行号，避免将开发态功能算入现役。
- 实际做了一个隔离状态库探针：使用 `/Applications/DevEco-Studio.app/Contents/tools/node/bin/node` v24.14.1，直接导入现役 SkillWorkflowService 和 StateStore，仅在临时目录创建 SQLite，完成后删除。没有调用生产 MCP start，没有操作设备、真实构建、运行态配置或生产状态。
- 探针脚本：`/tmp/deveco-workflow-gate-probe.mjs`；结果：`/tmp/deveco-workflow-gate-probe-result.json`。

## 核心结论

现役已经具备实质性的工作流编排优化：确定性 native 执行、持久化状态、恢复时副作用对账、项目/设备范围绑定、截图证据绑定、不可删减的 UI 步骤和防无效重复操作。它远超简单转发 CLI 的 MCP。

但“六个上游 Skill 都有对应名称”和“全部 Skill 及功能语义已完整覆盖”不是同一结论。这里是六个重新编写的 MCP 适配 Skill、八种由宿主推动的指导式工作流和八个公开固定原生工作流。上游 plan/goal/spec 的完整计划契约、用户故事到验收证据的关系、最终源码的一致性、DevEco 自身的 agent/command/plugin 配置能力，没有被等价地托管进现役 MCP。

最值得先补的是需求级验收闭环，不是继续堆工具名。现役 `skill_workflow` 的完成表示“阶段门槛已通过”，其代码一直返回 `verified:false`；不应包装为任意原始目标已得到证明。

## 已落地的 6 个 Skill

| 本地 Skill | 上游源入口 | 现役适配方式 | 语义判断 |
|---|---|---|---|
| deveco-arkts-standards | arkts-grammar-standards/SKILL.md | 指向 harmony_knowledge、先查 SDK 规则、编辑后 arkts_check、构建前再检查 | 核心知识与开发规则已适配；不是原入口逐字复制 |
| deveco-arkts-errors | arkts-error-fixes/SKILL.md | 诊断→关联案例→修根因→静态检查→构建 | 核心修复指导已适配；修复补丁仍由宿主编辑 |
| deveco-runtime-debug | arkts-runtime-fix/SKILL.md | debug 状态、日志/崩溃证据、UI 复现、原生结果完成门槛 | 核心调查能力已适配；上游 sticky debug agent 模式未迁移 |
| deveco-project-create | deveco-create-project/SKILL.md | SDK 匹配模板、原子创建、入口可达性、检查/构建/设备验证 | 核心创建流程适配；项目生成不等于业务实现完成 |
| deveco-native-tools | deveco-cli/SKILL.md | 所有 native typed tools、持久化恢复、UI 测试和证据处理 | 平台工具导航与恢复指南，有真实执行组件支撑 |
| deveco-customize-host | customize-deveco/SKILL.md | 选定 AI 客户端 MCP 配置及项目说明；不复制 Skill 到客户端 | 目标发生收缩/重定义，上游 DevEco agents/commands/plugins/model/permissions 全面定制不是等价实现 |

证据：`INSTALL/resources/skills.json:1-149`；六个入口文件均为 10–14 行左右的适配规则，并另带 3 个参考文件。`INSTALL/dist/src/services/skills.js:38-50` 的公开操作只有 catalog/read；`:63-67` 限制为说明类文件；`:100-123` 标明 `reviewed_native_adaptation`、校验 SHA256、返回 MCP 读取路由。没有通用的客户端 Skill 安装执行机制，这是现有架构的明确设计，不应误算成客户端已获得上游 Skill loader。

知识目录实查 79 个条目，只含 `arkts-error-fixes`、`arkts-grammar-standards`、`arkts-runtime-fix` 三个前缀。不能从这个数字推导 spec 命令模板也已收录。

## 两层编排具体是什么

### 指导式 skill_workflow：8 种

所有种类共用 `planning → implementing → verifying → completed`，支持回退和 cancelled。状态、文档、阶段、版本在 MCP；实际需求分析、补丁、视觉解读由宿主负责。

| kind | 指导载荷 | 完成时要求的原生工作流（任一个） |
|---|---|---|
| plan | native-tools，通用工程计划 | 无 |
| debug | runtime-debug + native-tools | build_deploy_verify / ui_test / ui_flow |
| spec | arkts-standards + native-tools + recipes-core | project_build / build_deploy_verify / ui_test |
| customize | customize-host | 无 |
| arkts | arkts-standards + recipes-core | project_build / build_deploy_verify |
| repair | arkts-errors + arkts-standards + recipes-core | project_build |
| create | project-create + arkts-standards + recipes-core | project_build / build_deploy_verify |
| ui_test | native-tools + runtime-debug | ui_test |

证据：`INSTALL/dist/src/services/skill-guidance.js:8-135`。`:189-226` 明确声明宿主所需能力；`:171-175` 超过 8192 字符的 knowledge 需客户端继续读取。此服务没有自行运行模型，也没有自行调用下一步 workflow；`next_action` 是交给宿主的执行建议。

### 固定原生工作流：8 个公开入口

| workflow | 完成定义 |
|---|---|
| project_create | 生成项目模型和应用身份有效 |
| project_sync | OHPM/Hvigor 同步完成且模型存在 |
| project_build | 编译完成，产物存在且摘要匹配 |
| app_deploy | 安装确认且请求的应用进程运行 |
| build_deploy_verify | 在锁定设备上明确的最终 UI 断言通过 |
| code_diagnose | 请求的检查完成，诊断已分类；不保证没有诊断 |
| crash_diagnose | 返回采集证据和解析结论，允许 insufficient-evidence |
| api_compatibility | API 扫描完成，有报告或明确 no-change |

证据：`INSTALL/dist/src/core/catalog.js:6-46`。其中 app_deploy 现役没有 0.4.0 开发树新增的延迟启动稳定性/应用帧契约，不能混算。内部另有 native_operation、ui_flow、ui_record 等固定任务；公开八条不等于只能执行八类业务动作。

原生定义在 `INSTALL/dist/src/services/runtime.js:202-402`，包含固定的步骤、项目和设备锁、模板/产物验证、恢复入口。`INSTALL/dist/src/core/workflows.js:157-164` 按软件包固定步骤连成图，不接受客户端自定义工作流 DSL。此方案强化确定性和可恢复性，但不存在通用子工作流依赖图/自动调度需求任务的能力。

## 已有的真实优化

1. **可恢复的确定性执行。** LangGraph + SQLite 承担任务状态，sync durability；request_key 去重、最多 32 个活跃/排队执行，project/device lease。只读 retry 最多 3 次；外部 effect 不进行盲目自动重试，EFFECT_UNCERTAIN 中断并要求 recheck/reconcile。证据：`INSTALL/dist/src/core/workflows.js:50-58,79-141,196-224,256-264`。
2. **恢复输入一致性。** 在执行/恢复时比对已捕获输入文件、toolchain、project fingerprint、sourceHash、flow hash；捕获配置和默认项目切换不会重定向已有 run。证据：`INSTALL/dist/src/services/runtime.js:170-200`。注意这个原生 run 验证，并没有覆盖其后的 skill_workflow 完成时源码重新核验。
3. **检查点存储受控。** 使用官方 SqliteSaver，仅追加配额预留；单次序列化不超过 512 KiB，序列化后再提交前为 DB/WAL 字节预留配额，异常会回收。证据：`INSTALL/dist/src/core/checkpointer.js:5-22,33-74`。
4. **Skill 定义与文档并发安全。** expected_revision 防止覆盖并发修改；definition_sha256 包括配方、Skill package 和 knowledge；升级改变指导定义后旧工作流被阻断，需要新建。文档加密保存、每次版本生成摘要/产物；引用的 native 证据有 run_dependencies，防清理破坏。证据：`INSTALL/dist/src/services/skill-workflow.js:111-125,189-200,211-244,330-348`、`skill-guidance.js:178-186`。
5. **UI 命令和业务结果区分。** act 只记 accepted；check 执行断言；带 review 的步骤还需精确图片读取和宿主评估；finish 要求全部已捕获步骤通过。证据：`INSTALL/dist/src/services/ui-test.js:127-147,500-521,623-639`。
6. **防无效重试且跨重启持久化。** attempt_id 去重，未知结果不重放；三次 UI 结构和帧都没改变则阻断，replan 要新截图和评估，同一策略/定位器与相同状态不可再次执行；原始结构化步骤冻结。证据：`INSTALL/dist/src/services/ui-test.js:435-511,616-627,655-687`。
7. **图像证据不是一个口头 passed。** review 必须绑定同一 run 的 PNG/JPEG；完成须 artifact_id、sha256、read_token 和实际读图时间匹配，再重新读文件验证摘要。原生断言失败不能被视觉 passed 覆盖。证据：`INSTALL/dist/src/services/ui-review.js:37-62,66-81,90-128`。

## 真实缺口及优先级

### P1：Spec 未保留上游需求—任务—验收的完整语义

上游 goal 是五阶段 SDD：spec、plan、tasks、implementation subagent、verification subagent。tasks 要求映射用户故事、依赖及并行机会；验证明确分 build-only/build+ui，逐故事验证/修复，修改后可触发全部故事最后一次不修复验收。

现役 spec 把前三阶段合并为 planning，仅验证 spec 的三个标题、plan 的两个标题、tasks 有 checkbox。完成时，只要全部 checkbox 已勾选，加上同项目任一成功 project_build 就可完成；没有 verification_scope 的结构字段、story_id、requirement_id、task dependency、每故事 evidence links、最终无修复轮次等。build+ui 原始目标也不会令原生 gate 自动改为必须 UI 成功。

证据：`UPSTREAM/packages/opencode/src/agent/prompt/goal.txt:1-37,117-151`；`UPSTREAM/packages/opencode/resources/spec/commands/spec-tasks.md:31-46`；`UPSTREAM/packages/opencode/resources/spec/commands/spec-verify.md:10-21,65-82`；`INSTALL/dist/src/services/skill-workflow.js:136-157,258-262,320-328`。

隔离复現：含“保存设置跨重启持久化”和“空值提示”两个用户故事、明确要求 build+UI 的 objective，写标题合格文档并勾选任务，提供一个合成 project_build 成功记录，仍可 completed/succeeded。合成记录只测试服务门槛；不代表实际编译器或设备已通过。

建议验收条件：每个原始 requirement/story 有稳定 ID，task 和 assert/review 有可追踪关系；scope=build+ui 时所有故事都必须有相应最终设备证据；改需求后下游文档/证据失效；宿主无法用一条 unrelated build 为整套业务需求盖章。保留宿主评估与机器事实分别记账。

### P1：完成证据新鲜度仅按实施阶段时间，不绑定最终源码

skill_workflow 完成检查 `run.created >= latest implementing.at`。只要证据晚于实施阶段开始，即使之后修改了源码或 spec，仍可用于完成。它只存 result_sha256，不读取 native input 中的 source_hash 验证当前目录，也不冻结最终交付快照。

证据：`INSTALL/dist/src/services/skill-workflow.js:264-318`。原生运行自身有 sourceHash 检查（runtime.js:177-180），但那发生于原生 run 的执行/恢复，不等于后来技能完成时仍为同一源码。隔离探针证实在成功夹具记录后写新的 Index.ets，技能完成门槛仍允许。

建议验收条件：完成证据须绑定实际交付源码/配置/构建产物指纹，以及要求的 application/device；文档或交付源码改变后正确失效。若任务修改了与验证无关的文件，应有明确、可解释的指纹范围，避免全目录误失效。

### P2：plan/customize 的 completed 只有极弱文档门槛

两者完成配方为空；仅要求存在至少一个文档。notes.md 没有内容结构验证，单字符 x 即通过。隔离探针两者都返回 completed/succeeded、evidence=[]、verified=false。

这不是代码偷偷宣称业务已经验证：它始终诚实地返回 verified=false。但若对外把 succeeded 当作“完整实现上游 Skill 且任务验证完成”，就会误导。上游 plan 有具体输出契约（Verification/Rollback、YAML todos、交给 build 的计划）和只读权限；现役 plan 是普通全任务生命周期。

证据：`INSTALL/dist/src/services/skill-guidance.js:31-46,80-89`；`skill-workflow.js:136-157,255-257,320-328,349-357`；`UPSTREAM/packages/opencode/src/agent/prompt/plan.txt:3-15,83-101`、`UPSTREAM/packages/opencode/src/agent/agent.ts:255-282`。

建议验收条件：区分“计划已写好”和“计划所述改动已完成”；计划最少有可执行步骤、验证和回退；customize 记录具体宿主目标、配置 diff、语法/schema 检验和实际加载验证。用户已经授权时无需机械复制上游多轮批准；应将确认策略交给用户/宿主契约，同时明确 MCP 不会改变宿主权限。

### P2：customize 是改写范围，不是所有上游定制能力等价覆盖

上游 customize-deveco 专门覆盖 deveco.json、.deveco/、全局配置、agent/subagent、commands、skills、plugins、MCP、permission rules，以及模型/provider、工具和资源引用。现役则指导任意选定宿主的 MCP 配置，且明确不安装 Skill 目录、不改变宿主的权限/模型/内部模式。

这个取舍有跨客户端的合理性，但“同样有一个 customize Skill”不能证明上游全部配置功能被包含。若目标是覆盖整个上游，应把 DevEco 专用定制知识保留成单独可检索适配资源，并为实际选定宿主做 adapter/capability negotiation，而不是将其从功能清单中消失。

证据：`UPSTREAM/packages/opencode/resources/skills/customize-deveco/SKILL.md:2-3,36-54,60-160,176-205`；`INSTALL/resources/skills/deveco-customize-host/SKILL.md:6-10` 和 `references/customization.md:3-7`。

### P2：UI 测试强约束只覆盖宿主翻译后的 steps

ui_test 的“原始步骤不可删”指 start/plan 里保存的结构化步骤。test_plan 仍是自然语言，没有机器检查 step 是否覆盖了其中全部需求。即使所有 steps 通过，也不能证明测试计划没有漏译。ui_review 确保读了精确截图并提交了足够长度的 observations，但不证明视觉判断事实正确；代码明确 `assessment_source: host_visual_assessment`。

证据：`INSTALL/dist/src/services/ui-test.js:248-283,616-639`；`INSTALL/dist/src/services/ui-review.js:8-10,66-81,106-111`。这属于人/模型语义评估的必要边界，不应假装能靠 token/hash 自动解决。

建议验收条件：test_plan 的 requirement/story ID 映射到 steps，保留宿主覆盖性评估；视觉通过展示原图、评估来源和不确定性；条件允许时给机器可判断项补原生断言。报告应区分“已保存步骤全通过”和“原始需求覆盖已评估”。

### P2：上游 agents/commands 还有明显 host 边界

- 上游 /debug 是主会话 sticky agent，带 debug_exit；本地 debug 是一个可以 read/transition 的持久化调查，不切换宿主 agent。
- 上游 /init 研究仓库并生成 AGENTS.md；/review 可以审查未提交改动、commit、branch、PR，并借宿主文件/命令/网络工具收集上下文。现役八个 kind 没有同等独立 init/review 工作流。
- 上游 general/explore 是宿主子代理，goal 委派 spec-implementation/spec-verify；现役 skill_workflow 声明宿主 supplies reasoning/editing/image understanding，没有 native 子代理 runner。
- compaction/title/summary、providers/models、TUI/desktop/session/chat 等是完整 AI 客户端能力，不属于 native HarmonyOS 工具本体，但用户若字面要求“上游全部功能”，必须在矩阵中标为宿主承担/未迁移，不能因 path exclusion 当作已经覆盖。

证据：`UPSTREAM/packages/opencode/src/command/index.ts:55-59,80-109,111-165`；`src/command/template/initialize.txt:1-60`；`src/command/template/review.txt:9-39`；`src/agent/agent.ts:174-253,285-365`；`INSTALL/dist/src/services/skill-guidance.js:8-17,220-226`。

接受条件不是复制整套上游 UI：应建立“native MCP 实现 / portable workflow adaptation / host delegated / genuinely unsupported”的四类能力矩阵，对每个业务行为给具体入口、返回契约和验收证据。对于外部工具能力缺失，要让 workflow start 提前说明而不是跑到一半。

## 测试边界与后续高价值验证

本轮执行过的唯一新增测试是上述现役模块隔离探针，结果可重现。没有声称跑过整套回归或真实设备验收。工作树中已有测试覆盖版本冲突、无证据/错项目/错设备/陈旧证据拒绝、引用保留与导出、UI 步骤冻结、三次无进展、未知动作不重放、检查点容量、效果对账等；这些测试代码的存在不是本轮通过结果。

后续应优先验证：

1. 任一上游 Skill/参考资源/脚本改动，都能落到人工审核的能力项和操作契约，不能只更新 hash 或排除目录。
2. 对 spec 进行反例测试：遗漏第二个故事、build+ui 只给 build、最后一次修改后拿旧证据、验证范围被 notes 覆写，均不能认定业务验收完成。
3. 对计划/定制做真实输出验收：计划完整可执行、配置 diff 与实际宿主加载吻合；不将单个文本或 succeeded 当成功证明。
4. 对 UI 做“先验证故事 A，再修故事 B 导致 A 回归”的场景；最终报告应依据最终构建对所有受影响故事的证据，而非历史单步 passing。
5. 在现役版本、固定 Node/SDK 和隔离应用上跑正向工程闭环：create→edit→check→build→deploy→story assertions→image review→export；再做重启/丢响应/配额/取消故障注入。平台差异不能靠 macOS 一套结果推断全平台。

## 建议优先顺序

先冻结明确的上游版本和能力矩阵，再补语义契约/需求关联/最终快照门槛，最后扩大工具与宿主集成范围。继续保留现在已经有效的 typed tools、确定性图、effect 对账、资源锁、截图 token、未知动作不重放设计。原生执行层已经较扎实，最薄弱的一层是“原始自然语言目标如何被完整拆解，并凭最终证据判定实现完成”。
