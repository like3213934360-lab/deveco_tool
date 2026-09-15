# 2026-09-12 上游与内容专项验证

本报告只记录本轮当前工作区的实际观察，不重用历史审计的 verified 标志或回执。测量时间：`2026-09-12T06:16:32.075Z`；Node：`v24.14.1`，执行文件为 DevEco Studio 随附的 Node 24.14.1。验证开始前统一构建成功（321 个 TypeScript 文件）；专项测试与测量没有修改源码、资源、已有审计或验收回执。

后续 323 文件统一构建的实际复测单列在文末：34 项再次通过；schema 精简后的默认 `tools/list` 为 **103,841 B，比已安装 0.3.0 降低 14.57%**；隔离复制安装升级、重启和回滚验收通过。前文保留较早测量点，避免把不同字节身份的数据混为一次验证。

## 实际通过的专项

以下命令以 Node 24.14.1 运行：

```sh
node --test dist/test/native-upstream*.test.js dist/test/native-domain-content.test.js dist/test/native-resources.test.js dist/test/native-cloud-knowledge.test.js
```

结果：**34 项通过，0 失败，0 跳过，3.47 秒**。首次误用本机默认 Node 26 时，3 项 SQLite 相关检查因 ABI 147 与已安装模块 ABI 137 不符失败；随后使用项目 Node 24 重跑全部通过，没有重装或调整依赖。

- 固定官方 Git 源 fixture 验证新增工具 ID、参数/schema 操作、schema 展开字段、SDD/host 新资产、Unicode 路径及脚本传递依赖。源脚本含主动抛错语句，发现过程只解析 Git blob，不执行源脚本。
- 新增操作、未知资源目录、新增宿主路径、删除的清单项、动态 registry/schema、缺失相对导入以及未经解释的正文缺链都不能借旧 prefix exclude 或旧摘要通过。
- `required-native` 不能用 `not_applicable` 或 `unsupported` 冒充成功；职责分类、实现状态、运行环境和证据状态独立。
- 四类内容目录的分页、返回正文与目录 SHA-256 一致；目录边界、路径穿越、符号链接、目录文件、超限文件和变化字节的拒绝行为通过。
- 全部 79 条知识的工具 ID、URI 与 Resource 正文逐字一致。原始源内容通过相同有界读后端；只读上游脚本以 `.source.txt` 保存，源路径和源 SHA-256 保留，未注册为可执行 Skill/runtime。

## G02/G03：固定来源与发现闭环

| 范围 | 本轮实测 |
| --- | --- |
| Code 固定提交 | `aeb4536e56d1bfe8b5a0ff3bb02acb99f3523f2a` |
| Code registry | 28 个真实工具 ID、38 个源 schema 操作 |
| 本地行为映射 | 50 项：28 required-native、20 host-delegated、2 intentional-boundary |
| 源资产 | 775 项：126 项可按需读取原文，649 项只跟踪路径、来源和摘要 |
| Source 引用 | 4,467 条，3,236 条解析到本地固定源；外部包引用独立保留 |
| 明确解释的缺链/示例 | 9 项：上游 LICENSE/状态迁移文档缺链、plan 示例路径、6 个测试 fixture 引用 |
| 发现摘要 | `91ee5d00dfdb0fd62bb865dadbd137aff828312e04b501af0bc4cffc13958460` |

Code candidate `7b9b68c2f65e25d6a91f13d47d5b75622aacfe20` 相对上述固定提交只有 **1 个路径变化**（daily 发布流程）。CLI 独立固定协议提交为 `a71f93d73941aaa0dbf581918cbd5828014e6e88`，candidate 为 `87c360b05848132c06c6ea120e078619b9ef4634`，有 **38 个路径变化**。两者在本地官方临时克隆中逐项比对，所有 before/after blob 摘要与当前身份清单匹配。

CLI candidate 的独立发现清单重新生成后与库存相等：**221 个源文件、197 项静态命令/参数 contract**，摘要 `d609ae259004eb2eec3596569c0a0b6575788cb2b1751420686f8103961d4702`。Code 声明的 CLI 依赖版本 `1.3.2` 与本包独立知识/文档 assets `1.3.1` 没有混作同一个更新身份，也没有将 candidate 的静态审阅写成 CLI runtime acceptance。

## G07/G08：产品方法、原文与知识

- 六个产品 Skill 源合计 100 个文件，保留历史 **85 已映射 + 15 原先未直接入包** 的逐项来源。85 是历史映射数量；本轮修复知识正文链接后不再声称历史原样字节数仍成立。
- 其中 11 个脚本的日志/faultlog、crash 解析与报告、HDC 公共工具、SDK 发现和模板复制行为有逐项原生目标/宿主职责映射，原文均可按来源 URI 读取。源映射与脚本行为的真实 SDK/设备验收分开。
- 5 条 SDD 命令、3 个模板、11 个内建 agent 定义、3 条内建 command 有固定来源和领域配方引用。11 个 agent 定义与 11 个 prompt 文件不是同一个集合：`general` 没有独立 prompt 文件，`generate` prompt 不能冒充 `general`。
- 仓库开发 2 个 Skill 与测试 fixture 2 个 Skill 明确分类，不计入六个产品 Skill 的 100 文件覆盖。
- 资源来源校验通过：**214 个资源、5 个来源、79 条知识**；文档索引实际查询为 **14,683**。
- 知识引用图实测 **79 个节点、60 条正文内部链接、42 条 related-ID 边、0 条悬空链接**。其中 **50 条旧 `../assets/*.ets` 引用**已迁移到稳定 `deveco://knowledge/` URI。
- 固定上游缺少 `state_migration.md`，本轮明确解释这一缺项，没有伪造文档或把现有规则当成该文档原文。

## 当前门禁结果与未闭合的证据

| 门禁 | 本轮结果 | 原因 |
| --- | --- | --- |
| Source mapping review | ready=true | 775 项固定来源及已解释引用覆盖完整；仅表示来源映射审查通过 |
| `upstreamAcceptanceGate` | **失败：UPSTREAM_BASELINE_CHANGED** | 现有 baseline 没有覆盖当前 source mapping 和 future-path guards；历史回执保留原身份 |
| `upstreamCapabilityGate` | **失败：CAPABILITY_ACCEPTANCE_PENDING** | 50 项本地行为均仍 pending，当前 evidence 均为空 |

`verified_operations=0`、`verified_boundaries=0`。required-native 的 28 项需要针对当前 source/resource/compiled-runtime 身份、目标语言/SDK/平台以及公共 MCP 实际行为的当前成功证据；20 项宿主委托需要当前 host contract 的明确边界证据；2 项 intentional-boundary 需要当前范围/排除合同。原生服务不可用时需要记录环境/支持证据，不能把 unsupported 当作 executed。CLI candidate 的运行、Code/CLI source baseline 回执及更广的性能/设备/soak 验收由本轮总验收单独闭合。

本次 34 项专项检查不覆盖全部产品实机行为，不写入或继承任何历史 verified/evidence，也不据此声称完整上游 runtime parity 或可正式发布。

## 初始上下文与按需读取测量

额外使用 Node 24 在新隔离状态目录启动已安装 0.3.0 和工作区 0.4.0，通过真正的 stdio MCP 读取默认分组的 `tools/list`。没有连接既有用户状态，也没有修改已安装版本。以下是序列化 UTF-8 JSON 字节和字符计数，不是 tokenizer 消耗、模型认知质量或延迟基准。

| 指标 | 已安装 0.3.0 | 本轮 0.4.0 |
| --- | ---: | ---: |
| tools/list 工具数 | 29 | 28 |
| tools/list JSON 字节 | 121,555 | 142,846 |
| 描述字符 | 10,177 | 9,721 |
| input schema JSON 字节总和 | 94,259 | 103,798 |
| `skill_manage catalog(limit=2)` 响应字节 | 3,478 | 3,478 |
| `skill_manage read(deveco-arkts-standards)` 响应字节 | 5,620 | 5,734 |

每个进程用 1 次工具发现请求；同一 Skill 的目录/正文取得各用 2 次工具调用。0.4 另测 `domain_recipe catalog`（3,932 B）、`domain_recipe read(arkts)`（5,006 B）和 `domain_content catalog(knowledge,limit=2)`（2,160 B），各 1 次调用，均成功。

虽然默认工具数量和描述长度下降，这一测量点的完整 `tools/list` 字节数**增加了 17.52%**。因此不能声称初始上下文成本已降低。按需 Skill/recipe/source 内容有效，也不意味着 schema 初始成本已经优化；后续若修改 schema，须重新构建并单列新的测量身份和数字。

## 本轮原始记录

原始命令输出位于本机临时目录，用于本轮复核；这些文件不是已接受的 release receipt：

- `/tmp/deveco-upstream-specialist-node24-tests.log`
- `/tmp/deveco-upstream-final-measurement.json`
- `/tmp/deveco-context-measurement.json`

报告生成时记录的文件 SHA-256：

- `deveco-upstream-specialist-node24-tests.log`：`9a2991361d891e459cccb48535a073cd799cc39dab974328ca2b05b065524f48`
- `deveco-upstream-final-measurement.json`：`71db401c1f730a5c7d332570f8e3c69713c34467ac1dcb60b12a26d842f48508`
- `deveco-context-measurement.json`：`f158cf2911950256860e1246175e0049abf1b8a08c2036b677665a391722980c`

## 迁移诊断与性能基线准备

当前 `native-migration-audit` 可正常运行，报告固定基线 `aab1405b51e00e4036bdc8f18ae4229835de77b0` 的 **40 个工具、7 个脚本、330 个参数和 95 个 action**，`release_ready=false`，28 个来源条目仍有范围或验收事项未闭合。该结果存于 `/tmp/deveco-current-migration-audit.json`，没有将历史验收文字转换为本轮成功证据。迁移目标中的旧别名虽然不在默认工具目录展示，`parseConnectionInput` 仍明确允许调用，不能仅凭目录隐藏判定兼容失效。

兼容升级驱动静态检查没有依赖旧 guidance 阶段循环。驱动将前一安装与当前候选都复制到新的独立目录，通过公共 MCP 建立历史任务和 artifact，再验证升级、worker/process restart 及回滚；`deveco_restart` 的调用同时验证隐藏别名兼容。后续实跑仅使用脚本内生成的加密 synthetic valid/expired 凭据，不传真实 credential inputs；这不能证明真实云端登录或 token 刷新。

性能 frozen baseline 在本机仍有干净检出：`/Users/dreamlike/Library/Caches/DevEcoMCP/baselines/aab1405-20260908`，HEAD 为上述完整提交，`src/server.mjs` 与 `node_modules` 均存在。最新完整历史计划位于 acceptance 目录的 `native-7-remaining-full-benchmark-owner-20260911-4/plan.private.json`；计划 schema 有效，**19 项 = 18 paired + 1 项 app_signature.inspect 新能力**，73 个输入文件全部存在且 SHA-256 匹配，38 个 native step 的参数通过当前已编译连接合同。驱动要求每版本 30 次冷启动，每项 1,000 次有效样本；新能力没有虚构 baseline 样本。

该历史计划还不能直接执行：所有设备参数绑定旧 `127.0.0.1:5555`，旧实例名为 `NativeMcpef29f65f`。UI 两项会清空、输入和确认专用表单；emulator scenario 会循环设置电量 37/64 并读取应用显示。现有地址不证明本轮设备所有权。本轮性能执行应使用新建 API 26 实例和任务自有 fixture，并复制计划、替换 target/实例/项目/绑定身份及重新计算受影响输入摘要。旧 SDK/UI fixture 都声明 API 26，且所有 73 个输入均在旧自建 acceptance root；这里只验证其存在与摘要，不复用其历史运行结论。

## 323 文件构建后的当前复测

时间：`2026-09-12T06:26Z`，Node 24.14.1。`runtime_sha256=ea54844031a63fe158a2e20f29256e35c6d43eec26c84cb7ddeba3faad703500`，`compiled_sha256=3018955abe2b36067a116e8324b32d940b58b742507217be2cff9bd662384287`，`resource_manifest_sha256=bb7dfc6dd3ecfc598203c5db9b6f6d174b116f235151507e3fb3fbb57e586284`。

- 相同上游/资源/知识专项 **34 通过、0 失败、0 跳过，13.03 秒**。日志 `/tmp/deveco-upstream-final323-tests.log`，SHA-256 `0bc06990c2207dd4f6253f26129bf6ddbb914f242de78a4b0f14b8a3f860346d`。
- 两个全新隔离 stdio MCP 的 `tools/list`：已安装 0.3.0 仍为 **121,555 B / 29 工具**；当前 0.4.0 为 **103,841 B / 28 工具**，降低 **14.57%**。当前 input schema 总计 **64,793 B**，描述 **9,721 字符**；代表性 Skill/recipe/knowledge 调用均成功，正文响应大小与前次相同。这里只量化 JSON 字节，不将其等同 token 数或任务质量。原始记录 `/tmp/deveco-context-final323-measurement.json`，SHA-256 `b6b90ba88debbaef0aede1c75c0c9bb14fd4741162ee79300165f7ef05140633`。
- `upgrade-final-1/evidence.json` 的 `completed/closed/unchanged/passed` 均为 true。真实旧 0.3.0 安装副本的状态 schema **1 → 2 → 1**；历史 workflow/artifact、synthetic valid/expired 凭据、配置、flow 及 credential key 在升级、worker/process restart 和回滚各阶段符合断言；原安装 `identity_unchanged=true`。旧 alias `deveco_restart` 实际调用成功。证据文件位于本轮外部 acceptance root，SHA-256 `a2295f35115c10e88d38c4ba3baa28b83c9951bdae237b9fd8ddebab3d983e3e`。该验收没有输入真实 credential 文件，也没有声称真实云端认证或最终发行包验收。
