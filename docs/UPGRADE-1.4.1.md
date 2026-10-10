# v1.4.1 提示词优化 TODO 与验收

用户要求先定位公共说明重复的责任层，再在不影响能力与使用约束的前提下压缩 token，保留代码风格，完成测试、GitHub 推送、Release/Latest 核验。本轮仅修改模型可见说明、版本、审计与回归工具，不改变参数、执行逻辑或测试环境，不增加兜底降级或运行时依赖。

| 状态 | 工作 | 证据 |
| --- | --- | --- |
| [x] | 定位重复来源 | 同一 v1.4.0 构建的 MCP 原始响应与宿主 15 个工具定义逐项对比，见下文 |
| [x] | 压缩公共说明及整理工具描述 | 442 -> 121 tokens；操作专属规则位于相关工具；完整规则审阅表如下 |
| [x] | 保留能力与接口 | 15 个工具的 name/title/inputSchema/annotations 与 v1.4.0 深度比较完全一致；handlers/params 未修改 |
| [x] | 防止体积回退 | 公共说明 ≤640 B、重复前缀的 JSON 工具清单 ≤44 KiB；原 tools/list ≤36 KiB 门禁保留；按 UTF-8 计数 |
| [x] | 本地测试与性能 | typecheck、155 项单测零失败/跳过；协议 102 个入口回归；握手 81 ms、空闲 RSS 68 MB、10 秒 CPU 不变 |
| [x] | 新进程实际 SDK 检查 | doctor 1.4.1、构建 ID 一致、环境 7 项检查通过 |
| [x] | 上游在线核对 | 475 项：362 full / 70 host / 43 skip；缺口、过期决策及新提交均为 0 |
| [ ] | GitHub 交付 | 推送后等待精确提交 CI 7/7、release、tag/Latest 和发布回执复核 |

## 重复发生在哪一层

基线 main：`8bff211a59fbe391bbaba73f482b3bbca10063bb`，工作区干净；实际宿主 doctor 为 v1.4.0，构建 `6d37706a8675e6b0a38e85a5431d74b907a25b4c6f2cb4a4be3a482df56c784d`。

1. `src/mcp.ts` 仅在 initialize 响应中发送 `instructions`；`src/server.ts` 的 tools/list 直接发送各自工具描述，不拼接公共说明。
2. 对该构建的原始握手和 tools/list 抓取验证：instructions 为 2,120 B，15 个工具的 description 都不包含它。
3. 本会话宿主提供的 15 个工具定义逐项匹配 `instructions + 两个换行 + 原始工具描述 + 声明`，全部前缀匹配通过。因此重复属于 MCP 响应之后的宿主适配/展开层；未声称定位到未公开的内部函数。

本仓库不能改变宿主内部的拼接方式。本次保留标准 MCP 协议，把公共部分限制为跨工具规则，其余规则放回对应工具，无需依赖宿主特例。[OpenAI 官方说明](https://developers.openai.com/plugins/build/mcp-server)同样建议 instructions 用于跨工具指导，避免重复所有工具描述；该文档未承诺每种宿主的具体拼接格式。

## 用法约束审阅

| 原有约束 | 优化后的可见位置 |
| --- | --- |
| 环境未知/失败先 doctor，工程路径为绝对路径 | 公共说明，project/target 共享字段 |
| 回答 ArkTS/ArkUI/@kit 前查知识；精确签名查项目 SDK | 公共说明，code |
| 项目 SDK 与成功构建 > 官方文档 > 社区提示 | knowledge；code 保留编译器最终裁定 |
| 构建已检查改动文件，避免先单独 code check | project、run、code |
| 长任务等待而非重复发起；needs_input 先检查 | 公共说明、job |
| 多设备/团队必须询问用户；不静默忽略错参 | 公共说明、target 字段、sign |
| UI 批量步骤、after、save_flow/then_flow、52 秒续接 | ui、run、ui_flow |
| 用 UI assert 证明结果；不能只凭截图 | ui，run 的 assert |
| 通用协议/引导按控件识别、保留默认项、记录结果；阻塞先观察，不盲重试 | ui、ui_flow |
| 摘要对应完整 artifact，分页/过滤与过期时间 | 公共说明、job；原 read_full 响应提示逻辑保留 |

新增回归检查这些模型可见约束，并检查单独加载相关工具时仍能看到操作专属说明。类型、枚举、默认值、参数注释、边界与所有 Schema 引用逐项保持一致，没有删除能力来换取体积下降。此验收证明接口和说明约束保留，不宣称已经完成不同模型的统计性正确率评估。

## Token 与字节口径

`tiktoken 0.14.0`，主表使用 `o200k_base`；无联网模型调用，不把字符数除以常数当作 token。输入来自真实 stdio 握手和工具清单，紧凑 JSON 序列化；公共说明与清单之间加两个换行。

| 范围 | v1.4.0 | v1.4.1 | 降幅 |
| --- | ---: | ---: | ---: |
| 公共说明 tokens | 442 | 121 | 72.62% |
| 原始 tools/list tokens | 8,713 | 8,636 | 0.88% |
| 原始公共说明 + 工具清单 tokens | 9,155 | 8,757 | 4.35% |
| 每个工具重复公共说明的 JSON 清单 tokens | 15,374 | 10,482 | 31.82% |
| 宿主工具声明文本 tokens | 13,899（已抓取） | 9,008（按相同格式推算） | 35.19% |
| 公共说明 UTF-8 bytes | 2,120 | 554 | 73.87% |
| tools/list UTF-8 bytes | 36,818 | 36,641 | 0.48% |
| 重复前缀 JSON 清单 UTF-8 bytes | 68,678 | 45,011 | 34.46% |

交叉验证 `cl100k_base`：原始总量 8,870 -> 8,469（-4.52%）；宿主相同格式推算 13,870 -> 8,962（-35.39%）。宿主 Schema/声明未改变，推算仅替换已捕获定义中的公共说明和工具描述；不重写声明格式。

宿主实际按需加载、包装及模型分词会影响最终请求，表格不是账单，也不含返回数据、Skill 正文或会话历史。当前已连接宿主仍使用 v1.4.0；新版宿主 token 实测需要重载后的新会话，不能用推算代替。

复测协议体积与导出原文：

```sh
node tools/prompt-audit.mjs
node tools/prompt-audit.mjs --snapshot /tmp/deveco-prompts.json
npm run bench
```

对导出原文使用指定 tokenizer 复算（tiktoken 仅用于本地审计，未加入项目依赖）：

```python
import json, tiktoken
p = json.load(open('/tmp/deveco-prompts.json'))
enc = tiktoken.get_encoding('o200k_base')
raw = json.dumps({'tools': p['tools']}, ensure_ascii=False, separators=(',', ':'))
print(len(enc.encode(p['instructions'] + '\n\n' + raw)))
```

## 测试与交付记录

本地 `npm run typecheck`、`npm test` 155/155、`npm run bench` 通过；新增 2 项提示约束/UTF-8 测试，保留原 153 项测试。测试包含真实 stdio 握手、102 个已审计入口、非法参数零执行、artifact 完整读取提示、版本构建一致性及打包后的独立运行；没有改测试环境或放宽原门禁。

本轮只改元数据，SDK/设备执行逻辑及参数完全未动，未重复创建模拟器执行设备 E2E，也未将 v1.4.0 的 23 项 E2E 计作本版新实测。新进程 doctor 检查实际 SDK/设备环境通过，构建 ID 为 `cec1cb32384f1d122fc790b73d41c72a60927e16a081428ed426c56e8ae129a6`。性能：握手中位数 81 ms，tools/list 4 ms，空闲 RSS 68 MB，10 秒 CPU 从 0:00.13 到 0:00.13；均通过既有预算。

GitHub 精确 SHA、CI、Release 和 Latest 将在实际通过后补充。未执行 npm 发布、宿主重启或 Skill 自动分发。
