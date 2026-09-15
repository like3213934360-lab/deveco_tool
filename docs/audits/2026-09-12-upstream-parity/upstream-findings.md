# 上游 deveco-code 差异独立审计（2026-09-12）

## 核对对象与结论边界

- 上游只读 clone：`/tmp/deveco-upstream-audit-20260912`，未执行安装脚本、未安装依赖。默认分支 `develop`，当前 HEAD `7b9b68c2f65e25d6a91f13d47d5b75622aacfe20`，提交时间 2026-09-11 14:44:57 +08:00。
- 最高版本 tag `v0.1.12` → `4f6825973d45cdb304803dbadc291ee016b65626`；`v0.1.11` → `b5911d2ad6daa66d4ca1bd673a9be260da19e1db`。release notes 将 v0.1.12 日期写为 2026-09-04，tag目标提交时间为 2026-09-05，二者不同。
- 实际 MCP 安装：`/Users/dreamlike/Library/Application Support/DevEcoMCP/installations/native-7-release-0.3.0-20260911-1`。安装 `provenance/upstream-lock.json:8` 锁 Code `aeb4536e56d1bfe8b5a0ff3bb02acb99f3523f2a`（2026-09-09 15:56:51 +08:00），不是旧工作目录中的 325aff0，也不是知识资源原始导入的 v0.1.11。
- 现役源码参照固定提交 `713734c8eaf40d52013ff88982306aef0d0c563f` 的只读归档 `/tmp/deveco-local-audit-head-713734c`；其与安装字节一致已由主审计核实。未提交 0.4.0 资料只用于候选工作说明。以下能力清单的 `verified` 是台账声明，本次没有重新执行设备操作；历史验收不冒充本次实测。
- 核心结论：6 个**产品内置 Skill**均有改写后的 MCP 入口，79 个参考/例子文件存在，Code 当前 HEAD 没有未纳入的新领域能力。不能据此声称“所有上游 Skill/全部宿主功能原样包含”：还有2个仓库开发 Skill、8个 SDD 产品资源、宿主与扩展功能；部分能力由客户端供给，存在知识正文断链和上游变化监控范围漏洞。

## 版本差异

| 区间 | 可见变化 | 对当前领域功能的含义 |
|---|---|---|
| v0.1.11 → v0.1.12 | 18文件；安装器/遥测、云模型配置及Ctrl+T推理档位、标题生成修复、CLI依赖升级1.3.2 | 六个内置Skill零变化；工具变化仅 `src/tool/lib/deveco-cli.ts` 的打包CLI路径解析，不是新增工具。证据 CHANGELOG.md:3-14，packages/opencode/package.json:84 |
| v0.1.12 → 安装锁aeb4536 | 65文件；跨平台测试/CI、插件与provider、依赖、Bun/PTY补丁等 | Skills、agent prompts、spec资源、注册表无变化 |
| 安装锁aeb4536 → HEAD7b9b68c | 唯一新增 `.gitcode/workflows/publish-daily.yml` | 无新增Skill/领域工具；属于宿主日构建发布流程 |

`git diff --name-only v0.1.11..HEAD -- packages/opencode/resources/skills packages/opencode/src/tool packages/opencode/src/skill packages/opencode/src/agent specs` 仅列 `packages/opencode/src/tool/lib/deveco-cli.ts`。当前六个Skill和领域工具源无需仅为HEAD追平而改动。

## 六个产品Skill映射与所有Skill文件范围

上游 `packages/opencode/resources/skills/*/SKILL.md` 由 `src/skill/defaults.ts:16-31,113-122` 纳入内置资源并解包。当前 `resources/skills.json` 明确记录六个对应上游的路径/hash。

| 上游 | 安装中Skill | 等价方式/限制 |
|---|---|---|
| arkts-grammar-standards | deveco-arkts-standards | 本地规则/例子按需读取、选定SDK约束和静态检查；原SKILL长正文没有原样保留 |
| arkts-error-fixes | deveco-arkts-errors | compiler/linter诊断→case/example→修复→静态检查→构建；32例子+31错误case全部有资源 |
| arkts-runtime-fix | deveco-runtime-debug | 原9个Node脚本改为typed日志/崩溃服务及debug状态机；9个case完整；evals不在安装资源中 |
| deveco-create-project | deveco-project-create | 原2个脚本改为原生project_create，SDK匹配模板、路径/命名/覆盖检查、构建部署验证 |
| deveco-cli | deveco-native-tools | 通过typed设备/模拟器/签名/UI/知识工具与工作流执行；不运行官方CLI；安装/卸载客户端Skill明确排除 |
| customize-deveco | deveco-customize-host | 上游专门配置DevEco Code agents/commands/plugins/providers/permissions；当前改为配置选定客户端的MCP接入与项目指令。是范围重定向，不能宣称全量等价 |

确切的非产品Skill：`.agents/skills/gitcode-pr/SKILL.md:1-14`（GitCode PR/Issue/CI维护）；`.opencode/skills/effect/SKILL.md:1-17`（本仓库Effect v4开发）。如果“所有上游Skill”按真实非测试文件理解，则是8个、当前6个，另外2个明确未入包。`packages/opencode/test/fixture/skills/agents-sdk/SKILL.md` 与 `.../cloudflare/SKILL.md` 是测试夹具，另列而不计成产品能力。全仓库实际上10个SKILL.md。

`.agents/`、`.opencode/` 当前整体exclude，见本地 `provenance/upstream-mapping.json:242-260`；不得把这些排除静默算进100%覆盖。

## 100个内置Skill文件的逐文件资源完整性

直接按安装 provenance/resources.json 的source_path映射核对上游HEAD，而非假设相同目录布局：

- 上游内置Skill目录100个文件。
- 78文件与上游**字节一致**：错误31case+32例子=63；运行时9case；语法6reference。
- 7文件改写：6个SKILL.md；语法 `references/arkts-rules.md` 只把2处SKILL交叉引用改为已入包recipes-core.md。见安装manifest transformation字段与实际diff。
- 15文件没有直接入包映射，完整列表见后文。9运行时脚本、2创建脚本有原生行为替代；README/FILES是维护材料；中文SKILL译本与eval用例没有原始资源保留。不能简单称15个功能缺失，也不能说100文件原样包含。
- `resources/knowledge.json` 79条=40case+32example+7rule；全部对应文件存在且SHA-256与索引一致。知识原始来源写b5911d2(v0.1.11)，不代表当前锁停在该版本；六Skill资源在此后版本未变化。

### 实际断链缺陷

79知识文件含61个相对Markdown链接；按安装文件布局解析，51处不存在。其中50处上游原本有效，是迁移将assets改放examples而正文保留`../assets/*.ets`造成；1处上游原本就坏：`arkts-error-fixes/reference/decorator_state_errors.md:108` 的 `./state_migration.md`。详细证据 `/tmp/deveco-upstream-broken-links.json`。

实例：安装 `resources/knowledge/arkts-error-fixes/any_type_errors.md:432` 链接 `../assets/AnyTypeError.ets`，实际例子在 `resources/knowledge/arkts-error-fixes/examples/AnyTypeError.ets`。`src/services/knowledge.ts:333-348` 原样返回正文，未解析/重写链接；`source.related_ids`提供可读例子ID，所以例子内容没有丢失，但正文导航并不自洽。建议生成阶段重写为稳定knowledge-ID引用，或在read结果返回解析后的链接映射，并检查全部相对链接；上游本身无目标的引用明确标记。

### 文档库完整性

这些来自独立deveco-cli-assets 1.3.1，不能错误称deveco-code仓库内全部文档：

- 安装 `resources/docs.zip` 31,467 ZIP条目；其中14,685文件、14,683 Markdown。ZIP CRC全量检测通过。
- `resources/docs/search.db` SQLite `quick_check=ok`；14,683文档、23,535 segments，无孤儿segment。
- 所有14,683 document_id 均在ZIP中有准确对应 `<document_id>.md`，缺失0。
- 安装中不存在 `resources/knowledge/search.db`；语法/案例规则以79文件直接读/搜索，文档才用docs/search.db只读FTS。实现 `src/services/knowledge.ts:62-83,160-179,308-352`。
- 此核对证明锁定包的内部完整性，不证明当前HarmonyOS在线文档或最新CLI资产无更新。

## 上游工具完整注册表

`packages/opencode/src/tool/registry.ts:220-280` 初始化28个工具。并非每次会话同时可见：question条件启用，LSP experimental标志，plan工具仅CLI客户端，debug_exit仅debug agent；gpt模型采用apply_patch并隐藏edit/write，其他模型相反；websearch按provider/flags启用（312-324）。

| 上游工具 | 当前源码分工 | 审计解释 |
|---|---|---|
| invalid | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| shell | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| read | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| glob | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| grep | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| edit | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| write | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| task | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| webfetch | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| todowrite | mcp_guided | MCP持久状态/文档/阶段，客户端执行推理编辑 |
| websearch | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| skill | mcp_guided | MCP持久状态/文档/阶段，客户端执行推理编辑 |
| apply_patch | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| question | client_required | 由宿主供给；宿主边界验证不是MCP原生执行通过 |
| lsp | native | typed原生服务/工作流；须核对当前版本执行证据 |
| plan_exit | mcp_guided | MCP持久状态/文档/阶段，客户端执行推理编辑 |
| plan_write | mcp_guided | MCP持久状态/文档/阶段，客户端执行推理编辑 |
| plan_enter | mcp_guided | MCP持久状态/文档/阶段，客户端执行推理编辑 |
| spec_write | mcp_guided | MCP持久状态/文档/阶段，客户端执行推理编辑 |
| hdc_log | native | typed原生服务/工作流；须核对当前版本执行证据 |
| switch_cwd | native | typed原生服务/工作流；须核对当前版本执行证据 |
| arkts_check | native | typed原生服务/工作流；须核对当前版本执行证据 |
| build_project | native | typed原生服务/工作流；须核对当前版本执行证据 |
| start_app | native | typed原生服务/工作流；须核对当前版本执行证据 |
| verify_ui | native | typed原生服务/工作流；须核对当前版本执行证据 |
| get_ui_verification_log | native | typed原生服务/工作流；须核对当前版本执行证据 |
| save_ui_screenshot | native | typed原生服务/工作流；须核对当前版本执行证据 |
| debug_exit | mcp_guided | MCP持久状态/文档/阶段，客户端执行推理编辑 |

LSP包含goToDefinition、findReferences、hover、documentSymbol、workspaceSymbol、goToImplementation、prepareCallHierarchy、incomingCalls、outgoingCalls9操作。UI包含自然语言testPlan、freshStart、执行、visual review、resume/cancel、日志read/search和每步截图导出。`verify_ui`上游实现通过附属MCP+多模态模型执行（`src/tool/ui-verification/ui-verification-tool.ts:60-115`）；本地通过客户端读图与MCP回执协作，是架构替代。仅统计28工具不足以统计commands/agents/Skill scripts/CLI等全部行为。

## Agents、SDD与commands的额外能力面

上游 `src/agent/agent.ts:155-365` 声明11个内置agent：build、debug、goal、spec-implementation、spec-verify、plan、general、explore、compaction、title、summary。前四种主模式及两个spec子agent与本地guided工作流存在对应，但宿主模式切换、内置代理调用、压缩/标题/摘要由客户端完成，不在MCP内原样运行。ui_verification在README.md:187-221作为可配置多模态agent入口，不能误计为agent.ts的第12个默认agent。

上游Goal五阶段：需求、方案、任务、实现、验证；前3阶段review/回退、Phase3验证选择门禁、Phase4委派实现、Phase5一次委派验证。证据 `src/agent/prompt/goal.txt:1-36,66-151`。下游不得仅凭同名phase便认定所有约束等价；用户当前授权可改交互，但需记录差异。

**监控范围漏洞**：以下是产品能力源，但当前mapping没有专门规则，落入`code-host-packages`排除（本地upstream-mapping.json:182-190）：

- `packages/opencode/resources/spec/commands/{spec-specify,spec-plan,spec-tasks,spec-implement,spec-verify}.md` 5文件。
- `packages/opencode/resources/spec/templates/{spec-template,plan-template,tasks-template}.md` 3文件。
- `packages/opencode/src/spec/{defaults,index}.ts`，其中defaults.ts:29-55,58-105处理产品SDD资源解包。
- `packages/opencode/src/agent/agent.ts`、`src/agent/prompt/{build,debug,goal,plan,spec-implementation,spec-verify}.txt`。
- `packages/opencode/src/command/index.ts`、`src/command/template/{debug,initialize,review}.txt`。

28工具实施文件有精确adapt映射，但以上新增行为/自然语言约束变动可以继续自动归类exclude，因此当前“上游门禁通过”无法证明所有工作流语义已跟踪。

`src/command/index.ts:55-109` 3内置模型命令：/debug（clear/status、粘性debug）、/init（AGENTS.md向导）、/review（commit/branch/PR/uncommitted评审）。111-165还将自定义command、MCP prompts、Skills转成commands。MCP当前本身不实现相同slash/模板解析宿主系统。

仓库维护commands `.opencode/command/` 8个：ai-deps、changelog、commit、issues、learn、rmslop、spellcheck、translate。维护agents `.opencode/agent/` 2个：triage、duplicate-pr；custom tools `.opencode/tool/` 2个：github-triage、github-pr-search。均被整体exclude，字面全功能范围须单独列入待适配/明确范围。

## 宿主功能与原生MCP边界

上游是完整AI coding host，不是仅有HarmonyOS工具的MCP包。其下列行为在本地由连接客户端提供或未提供：

- 多模型provider、Huawei登录/配额/推理档位；TUI、Web UI、会话历史/分叉/分享/压缩/undo/redo/导入导出；通用编辑/搜索/委派/询问；agent/command/plugin/Skill扩展。
- 上游MCP **客户端**管理local/remote server、OAuth、connect/disconnect、tools/prompts/resources。`src/mcp/index.ts:159-185`给出完整接口。MCP作为被调用server不是该客户端的替代实现。
- 上游TUI有模型/登录/provider/用量/快捷键/主题/插件/会话UI功能；不能映射成MCP native完成率。
- 上游CLI `src/index.ts:84-107` 注册 completion + 23 command入口：acp、mcp、默认TUI(project)、attach、run、generate、debug、console、providers、agent、upgrade、uninstall、serve、web、models、stats、export、import、github、pr、session、plugin、db。provider/account等是宿主身份，与本地Harmony签名auth不可互换。

可行目标应分为“领域能力全覆盖、全部上游资产显式分类、宿主能力通过可验收客户端契约供给”，不要把排除项/客户端供给加到MCP原生100%里。

## 有限传递依赖调查：deveco-cli

Code HEAD的 `packages/opencode/package.json:84` 精确依赖 `@deveco/deveco-cli:1.3.2`，不是动态追CLI develop；`src/tool/lib/deveco-cli.ts:295-318`定位bundled入口后Bun.spawn；build_project.ts:77-85和start_app.ts:252-260经该路径执行。deveco-cli Skill:11,13-100还声明16类CLI命令及设备/模拟器/UI/签名/compat等操作。

独立CLI当前develop已实时核对为 `87c360b05848132c06c6ea120e078619b9ef4634`（2026-09-11 09:44:24 +08:00），只读clone `/tmp/deveco-cli-upstream-audit-20260912`；安装v0.3.0仍锁`a71f93d73941aaa0dbf581918cbd5828014e6e88`。区间38变化路径，其中`37b82a2cfbff0716fa59750682fc0bffb80178b6`合入run后崩溃/白屏smoke，随后还有dsh/DeepSeek配置。新增src/smoke，run/apply启动后调用检查，完整bundle PID识别，shared screenshot等。

这不是Code当前HEAD新增：Code在aeb→HEAD仅CI变化，且Code依赖固定1.3.2。下游0.4候选已原生实现启动检查且有部分公共MCP故障证据，当前0.3已安装包不能据源码候选而宣称包含。源码`docs/upstream-cli-startup-review.md:3-29`详细记录已适配但未接受新锁/最终发版；本子审计限定验证上游新功能与版本关系，不扩展为CLI全部38变化操作独立验收。

## 未原样入包的15文件

- `packages/opencode/resources/skills/arkts-error-fixes/README.md`
- `packages/opencode/resources/skills/arkts-runtime-fix/SKILL_CN.md`
- `packages/opencode/resources/skills/arkts-runtime-fix/evals/evals.json`
- `packages/opencode/resources/skills/arkts-runtime-fix/scripts/collect-hilog.mjs`
- `packages/opencode/resources/skills/arkts-runtime-fix/scripts/fetch-faultlog.mjs`
- `packages/opencode/resources/skills/arkts-runtime-fix/scripts/jscrash-report.mjs`
- `packages/opencode/resources/skills/arkts-runtime-fix/scripts/parse-jscrash-log.mjs`
- `packages/opencode/resources/skills/arkts-runtime-fix/scripts/probe-faultlogger.mjs`
- `packages/opencode/resources/skills/arkts-runtime-fix/scripts/shared/hdc.mjs`
- `packages/opencode/resources/skills/arkts-runtime-fix/scripts/shared/jscrash-faultlogger.mjs`
- `packages/opencode/resources/skills/arkts-runtime-fix/scripts/shared/jscrash-parse.mjs`
- `packages/opencode/resources/skills/arkts-runtime-fix/scripts/shared/utils.mjs`
- `packages/opencode/resources/skills/deveco-create-project/FILES.md`
- `packages/opencode/resources/skills/deveco-create-project/scripts/copy-template.mjs`
- `packages/opencode/resources/skills/deveco-create-project/scripts/detect-sdk.mjs`

## 优先处理建议

1. 将spec资源、agent prompts、commands/template和其装载器纳入精确adapt规则；新增未知产品能力应阻止自动接受，而非落入packages排除。
2. 修复知识正文50处迁移断链，并对1处上游原生断链给出明确说明或经核实替代；测试应验证目标可用/知识ID可读，不仅校验文件hash。
3. 把“6产品Skill、2维护Skill、2测试夹具、8SDD资源、11agents、commands与宿主扩展”的范围表纳入coverage manifest；明确客户端提供/原生/guided/未实现/不适用，不能仅列28工具。
4. 对customize-deveco的agents/commands/plugins/provider/permissions等需求做细粒度语义映射；当前MCP接入指导不足以声称完整上游自定义能力。
5. 0.4候选启动检查按最终发布身份验证并接收CLI候选；当前0.3的事实、候选源码及历史证据分列。
