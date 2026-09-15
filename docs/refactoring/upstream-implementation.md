# 上游来源、内容与覆盖实现

本文件记录本轮实现，不继承归档或审计报告的验收结论。原审计目录、历史报告和接受回执保持原样。最新实现基线是归档 `6ad95551a0edac9fb8f4a5a7fbe7d45d342a6519`；工作区、构建和运行身份由本轮最终报告单列。

## 来源发现与覆盖口径

`upstream-discover` 从官方 Git origin 和完整固定提交读取对象，使用 TypeScript AST 解析 registry 注册关系、真实公开工具 ID、参数 schema、action/operation 枚举、11 个内置 agent 定义。随后发现 Skill、正文 Markdown 和代码引用、脚本、SDD 命令/模板、agent/command 文本以及传递导入，逐文件记录 SHA-256。不加载或执行上游代码。

当前 Code 清单为 `provenance/upstream-discovery.json`，逐文件职责映射为 `upstream-discovery-review.json`。不使用固定工具数或固定 LSP 动作数作门槛。未解析 schema、未知资产、变化摘要、重复或被删除清单项均进入待审。`upstream-capabilities.ts` 直接消费该发现清单；`upstream.ts` 防止历史宽泛 exclude 吞掉产品目录及已发现传递资产。新候选仍须重新生成发现、审阅未知变化和执行最终验收。

静态源发现纠正了旧台账的两个口径：registry 局部变量 `shell` 实际注册公开 ID `bash`；`skill` 的上游实际入参是 `name`，`spec_write` 的实际入参是 `filePath/content`。旧 50 条行为分解通过 `source_operations` 映射到实际 schema，不再伪装成上游不存在的 action。

矩阵保留三个独立维度：

- 职责：`required-native`、`host-delegated`、`intentional-boundary`。未知项 `pending` 阻断完整承接声明。
- 实现：`implemented/adapted/pending/not_applicable`，源码方法映射不等于运行成功。
- 证据/环境：当前真实执行、待验收、宿主合同；按语言、SDK、平台及服务支持单独记录。`unsupported` 不能满足必要原生项。

计划/待办/会话切换和通用文件编辑由宿主承担。上游 spec/debug 的领域方法由 `domain_recipe` 保留，不移植它们的 agent 状态机。历史本地指导任务由兼容接口读取、导出或归档，不再创建重复指导生命周期。

## 知识、Skill 与原文

79 条知识及独立 assets 1.3.1 的 14,683 篇文档保持原有检索范围。迁移后的 50 处 `../assets/*.ets` 链接和可解析的本地 Markdown 引用统一改为稳定 `deveco://knowledge/<id>` URI；`harmony_knowledge read` 同时接受 URI 和原 ID。缺失的 `state_migration.md` 明示为固定上游缺项，未伪造原文。逐链接迁移记录在 `knowledge-reference-migration.json`。

`upstream-product-assets.json` 逐文件保留上游 100 个产品 Skill 文件的历史 85 个直接映射和 15 个非原样入包文件。85 个是历史映射数；本轮修复正文链接和入口指导后不再沿用历史“78 个字节一致”。脚本按日志采集、faultlog 检索、crash 解析/报告、SDK 发现和模板复制逐行为映射到原生实现，其最终正例仍待本轮验收。中文 Skill、README、FILES 和 evals 都明确分类。

未直接复用的产品原文、5 个 SDD 命令、3 个模板、agent prompt 与3个内置 command 原文放在 `resources/upstream/deveco-code/<commit>/`；与本地适配分层。已有字节一致的内容直接复用，不重复复制整个上游仓库。11 个 agent 定义独立列出，未给没有独立 prompt 的 general agent 伪造 prompt 文件。两个仓库开发 Skill（gitcode-pr/effect）和两个测试夹具（agents-sdk/cloudflare）单列边界，不作为产品工具。

`DomainContentService` 提供统一的 `catalog/read`，资源、Prompt 和工具兼容路径共用该后端；`readContentFile` 对同一字节做限额、变更检测及摘要校验。可读取的 URI 为 `deveco://skill/...`、`deveco://knowledge/...`、`deveco://recipe/...`、`deveco://source/...`。所有客户端都可用 `domain_content` 工具读原始资产；文档全文检索保留 `harmony_knowledge` 工具路径，避免将14,683篇索引同时塞入Resources列表。

## Code、CLI 与 assets 独立推进

`upstream-source-identities.json` 独立记录 Code `aeb4536…`、Code候选 `7b9b68c…`、Code 固定 CLI 依赖 1.3.2、CLI 协议锁 `a71f93d…`、CLI候选 `87c360b…` 以及 assets 1.3.1。Code候选变化仅为每日发布工作流，不宣称新增领域能力。CLI 候选 38 个变化路径逐文件记录前后摘要；CLI独立发现清单追踪命令/参数源码和文件摘要。采用归档启动检查及本轮原生改进不自动把候选锁标为已运行验收。

开发使用：完成本地构建后运行 `node dist/scripts/upstream-discover.js <官方Code克隆> <完整提交> <新清单.json>`；CLI 添加 `--cli`。生成清单只做产品资产构造，不是通过验证。再静态审阅新差异，更新明确的行为映射，最后运行测试与发布门槛。不得通过删除未知项、扩大 exclude 或把不支持改为 verified 来关闭缺口。

## 本轮最终验证待办

集中验证应覆盖 AST registry/参数新增、引用与导入变化、未解析契约、恶意/越界内容 URI、摘要不匹配、源文件变化、知识引用图、原文与适配一致性、MCP Resources/Prompts 与工具读取同字节、六 Skill 和文档检索、职责口径及 required-native 拒绝 unsupported。设备/平台验收和最终源码/制品身份属于主验收清单；本文件不宣称这些已通过。
