# v1.4.2 能力发现、正确调用与模型验收 TODO

本版修正 v1.4.1 对公共说明的过度压缩。验收顺序是能力能被发现、参数与约束能被正确理解、真实调用可核对，最后才比较 token 开销。保留独立实现、现有代码风格和执行逻辑，不改变 SDK、设备、模型、认证或持久宿主配置，不新增 Skill 分发或 Windows NTLM 代理。

## TODO 与证据

| 状态 | 工作 | 证据 |
| --- | --- | --- |
| [x] | 恢复跨工具能力索引和必要规则 | 首 512 字符列出全部 15 个工具；SDK 来源优先级、UI 引导/批量/回放/断言、任务续等、产物分页仍明确可见 |
| [x] | 独立工具描述完整性 | 每个 action 枚举都有描述入口；补齐 same-device 条件、滚动流畅度、logout、签名设备范围和无效端口处理 |
| [x] | 保留接口与实现 | 与 v1.4.1 的 15 个工具深度比较，除 description 外 name/title/inputSchema/annotations 全部一致；handlers/params 未改 |
| [x] | 本地回归与性能 | typecheck；160/160 单测，零失败/跳过；102 个协议入口回归；握手 84 ms、清单 4 ms、空闲 RSS 70 MB、10 秒 CPU 不变 |
| [x] | 真实 SDK 验收 | 未设置 E2E_TARGET，原 E2E 11 项非设备测试通过，包括真实 HAP 构建、ArkTS 检查、SDK LSP 和任务；12 项设备测试跳过，未计作通过 |
| [x] | 上游在线核对 | 475 项：362 full / 70 host / 43 skip；缺口、过期决策和新提交均为 0 |
| [x] | 可复现真实模型试验与失败记录 | 29 项发现方案覆盖 15 个工具；使用实际宿主与其原有模型；独立记录只读调用。见下文分层证据 |
| [x] | Codex App 重载及实际调用 | 用户重启后 doctor 为 1.4.2，构建 ID 匹配；15 个实际工具定义全部匹配；5 次只读 MCP 调用成功 |
| [x] | OpenCode 最终构建的实际只读调用 | 宿主事件逐条核对 8 次 MCP 调用及成功结果，含最终 build_id；发现方案的失败另列，不混为通过 |
| [ ] | OpenCode 发现方案首轮全部正确 | 最终 27/29；device log/sqlite 漏 action。这两项操作未在只读闭环中执行，不能用其他成功调用替代；不放宽评分 |
| [ ] | Claude 最终构建及完整读取闭环 | 候选 29/29 发现方案和 4 次调用成功；现有服务端余额不足中断，最后描述调整后的构建未重测；不更换服务或模型制造通过 |
| [ ] | Claude Tool Search 延迟发现模式实测 | 当前 Claude 代理配置未启用该模式；只完成官方文档/现有宿主行为分析，未声称实测 |
| [ ] | 本版设备 UI/安装/签名等写入操作的模型实测 | 本版不改执行逻辑；真实模型只读场景不能证明所有写入操作已执行，设备 E2E 也未重跑 |
| [x] | GitHub 提交、全部 CI、Release、tag、Latest | `322db17` 的 CI 7/7、release 成功；工作流回执与本地 --check 一致，稳定版 tag/Latest 指向正确，链接见下文 |

## 为什么这样放说明

- [MCP InitializeResult](https://modelcontextprotocol.io/specification/2025-11-25/schema#initializeresult) 中的 `instructions` 是可选指导；协议没有保证每个宿主都以同样方式注入。因此不能只依赖公共说明，也不能删掉发现工具之前需要的索引。
- [Claude Code 的 MCP Tool Search 指南](https://code.claude.com/docs/en/mcp#tool-search-for-mcp-server-authors) 要求服务端说明提供类别、何时搜索和关键能力；延迟加载时详细工具定义未必提前可见。按其当前默认规则，检查 instructions 与各 description 不超过 2,048 字符，防止截断。
- [Anthropic 工具定义指南](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) 与[工具设计建议](https://www.anthropic.com/engineering/writing-tools-for-agents) 强调清楚表达用途、何时使用、参数和限制，不支持为省 token 牺牲这些内容。
- [OpenAI MCP 插件指南](https://developers.openai.com/plugins/build/mcp-server) 建议把重要内容放在 instructions 前部。前 512 字符用于任务入口，不把 640 B 当成必须遵守的厂商标准。
- 安装的 OpenCode 1.18.35 对应源码 `53d1eabb61e21162157817bf677da0a4ad3332e3`：[system.ts](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/session/system.ts#L121)、[prompt.ts](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/session/prompt.ts#L1257)、[catalog.ts](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/mcp/catalog.ts#L42) 表明其系统提示加入服务端 instructions，工具描述和 schema 分别传递。这个判断限定于该版本。

本会话重载后捕获的 Codex App 15 个工具，仍是公共 instructions + 各工具描述 + 调用声明；原始 MCP tools/list 没有公共前缀。重复在宿主展开后出现，仓库没有增加按宿主判断的协议分支。

## 开销与语义保留

恢复了公共能力入口和关键约束，而非恢复旧文案的全部冗词。工具名、action、类型、校验范围与执行逻辑保留；签名 target 的字段描述明确它只用于 register_device，auto 原本就注册全部已连接设备。模拟器说明明确非法端口先询问，不能替换端口或发送已知非法请求。

| 范围 | v1.4.0 | v1.4.1 | v1.4.2 |
| --- | ---: | ---: | ---: |
| 公共说明 UTF-8 bytes | 2,120 | 554 | 1,737 |
| 原始 tools/list bytes | 36,818 | 36,641 | 36,850 |
| 公共说明 tokens | 442 | 121 | 357 |
| 原始说明 + tools/list tokens | 9,155 | 8,757 | 9,042 |
| 每工具重复公共说明的 JSON tokens | 15,374 | 10,482 | 14,071 |

`tiktoken 0.14.0 / o200k_base`，真实协议响应紧凑 JSON。同一字节数不代表不同模型的 token 相同；这些数值不是账单。重载后 Codex App 的实际工具描述文本（含调用声明，双换行连接）为 12,458 tokens；没有包含会话历史、其他工具、实际返回数据或宿主请求的未公开包装。`cl100k_base` 对同一批文本分别为公共 356、原始总量 8,753、重复 JSON 13,768、App 描述文本 12,410 tokens。

移除 v1.4.1 的 640 B / 44 KiB 限制；替换为默认截断边界检查。原 tools/list ≤36 KiB、握手 <150 ms、空闲 RSS ≤84 MB、10 秒 CPU 门禁全部保留。公共说明 1,737 字符，最长单工具描述 1,516 字符。

## 真实模型验收方法与边界

`tools/model-eval.mjs` 使用真实 CLI 和原有模型/认证；只在子进程指定被测的不可变 MCP 构建，不写宿主配置，不替换模型、代理、SDK 或设备。发现试验允许加载工具定义，禁止读仓库/终端/历史/网络来找答案；29 个自然语言任务的答案检查工具名、真实 JSON Schema、期望参数、禁止动作和必要说明。它不实际创建工程、签名、安装或操作设备，也不能代替全部 handler 的条件验证。

`live` 是另一轮实际只读调用，必须逐条检查宿主事件中的 tool call / tool result；脚本把通过状态留为 null，禁止仅凭模型最后一句“完成”自动通过。单次小样本不能证明所有模型的统计正确率。Codex App 在当前开发会话中调用，已拥有上下文，不能伪称独立盲测。

| 宿主/原有模型 | 发现方案 | 实际执行 |
| --- | --- | --- |
| Codex App | 最终 15 个工具定义逐项匹配；未做独立 29 项盲测 | 最终构建 5 次成功：doctor、device list、project info、knowledge search/read；doctor 含工程的 9 项检查全部通过 |
| OpenCode 1.18.35 / muse-spark-1.3-contributor-free | 同一 29 项：v1.4.1 为 23/29；初次候选为 28/29（非法端口仍列入 calls）；最终 27/29（device log/sqlite 漏 action，非法端口正确拒绝） | 最终构建 8 次 MCP 调用成功，覆盖环境、设备、工程、官方文档检索与读取；knowledge status 如实携带远程包 404，不影响本地读取，也未更新知识包 |
| Claude Code 2.1.281 / 配置的 claude-opus-5.5[1M] | 同一 29 项：v1.4.1 为 28/29（auto 签名误传 target）；候选构建 29/29 | 候选构建 4 次 MCP 调用返回成功，随后代理接口报余额不足，未完成文档读取和最终回答；最后两处描述调整后的最终构建未重新获得 Claude 验收 |

Claude 使用现有代理端点；记录的是宿主报告的模型名，不能据此保证后端权重身份，也不宣称 Anthropic 官方直连。其 Tool Search 模式没有实测。Codex CLI 0.156.1 的最终尝试被当前配置的 `gpt-6.1-sol` 账号接口拒绝；用户明确改用 Codex App，未偷偷替换为其他模型。

发现试验保留修正轨迹：最初题目把 5560 当成合法端口，这是夹具错误；现保留该需求作为“应拒绝无效端口”的负例，另加合法 15660 正例。早期评分器未识别 OpenCode 的 `default.deveco_` 前缀、过度限定 hover/definition，以及 Claude 命令行输入被可变参数吞掉，均修正后用相同 29 项重测旧版/候选；原失败文件未覆盖。App 重启中断的子进程另存新目录重跑，不冒充完整结果。发现模型误用后补充签名/端口说明，没有修改运行校验或 SDK。

原始 prompt、协议元数据、模型事件、stderr、答案、评分和 SHA-256 保存在本地 `.scratch/v142/models/`；其中有本机工程和设备信息，不上传原始会话。公开[试验摘要与哈希](evidence/v1.4.2-models.json)保留必要结果、构建身份及失败项。Claude 候选构建为 `22d8de8f57315e09352912b67cf0282f4fdfffac0592864d0521133210278305`，不与最终构建混用。

复测（使用新的输出目录，不覆盖旧试验）：

```sh
npm run build
node tools/prompt-audit.mjs --snapshot /tmp/deveco-prompts.json
node tools/model-eval.mjs --host opencode --suite discovery --out /tmp/deveco-discovery-new
node tools/model-eval.mjs --host claude --suite live --project /absolute/project --out /tmp/deveco-live-new
# 比较旧版：额外提供 --entry /absolute/dist/builds/<immutable-generation>/cli.js
```

## 构建与交付

最终构建 ID：`df5196999e620bf0297d999a85904d5d95e1b0d5d208b3b6abeb508a17067aa0`。用户重启后 Codex App 的 doctor 与该值一致，且实际 15 个工具说明匹配，已经完成该 App 的真实重载核验。未执行 npm 发布。

2026-10-10 已完成发布核验：

- 发布提交：[`322db17b67ca921f488c2bf512f04075f71111b7`](https://github.com/like3213934360-lab/deveco_tool/commit/322db17b67ca921f488c2bf512f04075f71111b7)。
- [CI 38031108675](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38031108675)：Linux/macOS/Windows × Node 22/24 六项测试和 upstream 共 7/7 成功，无跳过。
- [release 38031186672](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38031186672)：自动发布成功，已下载 `verified-release` 回执；head/released_commit 均为发布提交，`latest=true`。
- [v1.4.2 Release](https://github.com/like3213934360-lab/deveco_tool/releases/tag/v1.4.2)：稳定版、非草稿；不可变 tag 指向发布提交，GitHub Latest 与其一致。
- 本地 `node tools/release.mjs --run 38031108675 --check` 通过，结果与工作流回执一致。

本记录随后以纯文档提交补充；不移动 tag、不重发同版本 Release，后续 main 的 CI/release 仍独立核验。上述真实模型缺口保持未勾选，发布成功不替代模型或设备验收。
