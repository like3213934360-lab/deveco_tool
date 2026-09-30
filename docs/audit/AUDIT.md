# deveco-mcp 全项目证据化审计报告

- 审计日期：2026-09-30
- 被审版本：v1.1.3 + 未提交改动（`fadfb50` 之后，含 `src/domains/syscap.ts`）
- 上游对照：deveco-cli `4a5730f`、deveco-code `a7ae14c24`（审计期间拉取的最新提交）
- 设备：真机 HUAWEI Pura 80 Pro（`4VF0225613017854`，API 26）；模拟器 Pura 90（`127.0.0.1:5555`，API 24）
- 工程：本机 7 个鸿蒙工程（只读）+ 临时工程
- 本阶段**只审计，没有修改任何产品代码**。`src/`、`knowledge/`、`README.md` 在审计期间没有任何文件被改动（按修改时间核对）。

## 结论规则

每一项结论只能是以下四种之一，并附原始证据：

| 结论 | 含义 |
| --- | --- |
| VERIFIED | 原始证据与预期一致 |
| DEFECT | 发现问题，附复现方式 |
| UNVERIFIED | 无法验证，写明原因 |
| INFERRED | 只能推断，写明依据 |

全部 381 项结论见 [FINDINGS.md](FINDINGS.md)（由 `node test/audit/report.mjs` 生成）；原始数据在 [findings.jsonl](findings.jsonl) 和 [evidence/](evidence/)。所有审计脚本在 `test/audit/`，可以复跑。

## 总数

| 结论 | 数量 |
| --- | --- |
| VERIFIED | 371（修复前 313）|
| DEFECT | 0（修复前 50，见第八节）|
| UNVERIFIED | 4 |
| INFERRED | 6 |

## 一、此前对你说过的话，哪些被推翻了

| 当时的说法 | 审计结果 | 证据 |
| --- | --- | --- |
| 云端结果的"官方/社区"标签是准的 | **错**。679 段、8 个查询，可判定的 549 段里准确率 90.5%：47 段其实是官方文档原文却被标成社区，5 段反过来；另有 10 段标"官方"的是 Android/Java（HMS Core）或仓颉文档，不是 ArkTS | C.cloud-labels、B.knowledge.cloud.official-other-platform |
| 126 个动作全部测过 | **数字错**。实际是 15 个工具、93 个动作（另有 11 个 LSP 查询、16 种 UI 操作）。这次全部用真实服务跑过（不再用模拟服务） | C.all-actions-tested、B.action.* |
| 上游 467 项全部对齐、0 缺口 | **只在"名字"层面成立**。按行为对照，在标为"完全对齐"的项里又找出 11 处行为差异（见第三节 A 组） | C.upstream-467 |
| 各工具的技能/MCP 配置路径与上游一致 | **不完整**。上游有 11 个工具，我们缺 atomcode 和 dsh（deepseek harness） | C.skills-paths |
| 静态检查误报已经解决 | **对 LingDong 成立，对别的工程不成立**。LingDong、MyStarRing 都是 0 误报；myTestAPP 有 81 条误报（资源放在嵌套目录的模块里时，资源名检查全部误报） | B.code.check.* |

以下旧结论经过复核**成立**：多设备只装手机模块、项目已有签名时 `sign auto` 拒绝且不改任何文件、BuildProfile.ets 构建后还原、HMS Kit 悬停返回真实签名、本地文档能完整翻页读完（16 万字、14 页）、编译器两个设备兼容 bug（`[since N]` 后缀、`default` 别名）、`canIUse` 只认外层 if、未防护调用在不支持的设备上真的崩溃（模拟器上复现到 TypeError）、30 个无法解析的模块分类、Push `client_id` 的结论、崩溃后任务可以恢复、检查进程被杀后能自动重建、输入框引号和特殊字符原样输入、1 天自动清理、性能数字（握手中位数 85 ms，空闲内存 64 MB）。

## 二、审计过程中对你的账号/环境造成的改动（需要你知道）

| 改动 | 状态 |
| --- | --- |
| 审计时通过 IDE 签名接口建了 2 个调试 Profile（包名 `com.devecomcp.auditsign`） | **更正**：这里原先写"留在你的 AGC 里、需要手动删除"是错的。你在 AGC 控制台核对过：Profile 列表只有你自己的 6 个，没有 `audit_` 开头的。IDE 签名接口（`ide/test/provision/add`，DevEco Studio 自动签名用的也是它）建的调试 Profile 不出现在控制台列表里，接口也只返回 Profile 文件，不返回 id，所以不存在需要你处理的东西 |
| 删除证书 `MCPValidationd98b7ba2`（修复阶段，经你同意） | 这是之前的会话验证 MCP 时建的调试证书。已删除，只删了这一个；证书 6 → 5，其余 5 个（his、ice、StarRing、StarRingRelease、auto_debug_<personal team id>.cer）未动 |
| 知识库的"回滚一步"记录被用掉 1 次 | 知识库内容没变（前后是同一个版本 1.3.5-20260929），只是 `current.json` 里的上一版本记录被清空。原因是我给 `rollback` 传了一个它不认识的参数，工具没有报错就执行了（见 B.schema.unknown-params） |
| 模拟器手表镜像（约 954 MB）下载后已删除 | 已恢复原状 |
| MyStarRing 的 `commons/card_widgets/BuildProfile.ets` | hvigor 构建时生成的文件，该模块的 .gitignore 已忽略它；`products/phone/.test/` 构建缓存被 clean 清掉（也是被忽略的构建产物） |
| LingDong 有 52 个文件变化 | 是你在审计期间的提交和壁纸分类相关的修改（10:01 的提交、10:32–10:35 的文件），不是 MCP 改的；所有模块的 BuildProfile.ets 前后逐字节一致 |

## 三、缺陷清单（按影响排序）

### 高：会让 AI 拿到错误或残缺的信息

| 编号 | 问题 | 复现 |
| --- | --- | --- |
| B.project.build.parser-drops-arkts-errors | 构建失败时，hvigor 报了 209 个 ArkTS 编译错误，AI 只收到 1 条（多条错误的块格式没有解析） | myTestAPP 副本 `project build task=assembleHar` |
| B.project.build.parser-drops-error-message | 非编译类错误只保留标题行，真正原因那一行被丢掉（例：只看到 `00306003 Specification Limit Violation`，看不到"工程路径含非 ASCII 字符"） | myTestAPP 原路径 `project build` |
| A.upstream.build.ohpm-install | 第一次构建后再加依赖，下次构建直接编译失败，也不提示去 sync；上游每次构建前都会 `ohpm install` | test/audit/build-sync.mjs |
| C.cloud-labels / B.knowledge.cloud.* | 云端"官方/社区"标签有约 10% 错判，"官方"里混有 Android/仓颉文档；6 段官方内容指向了同名但不同的本地文档，97 段没有对应本地文档 | test/audit/cloud-labels.mjs |
| B.code.check.rule.app-resource-name-check | 资源名检查只扫描一层目录，放在嵌套目录（如 `casesfeature/xxx`）里的模块资源全部被误报成"不存在"；注释和字符串里的 `$r(...)` 也会被误报 | test/audit/check-rules-legal.mjs |
| B.code.lsp.empty-syscap-message | 导入没有 @syscap 标注的模块（如 `@ohos.arkui.layoutAlgorithm`）时，LSP 报一个空能力名的错误，hvigor 实际能正常编译 | evidence/syscap/empty-syscap.json |
| B.knowledge.local.snippet-readability | 本地搜索结果的摘要来自分词索引，文字重复、带空格（如 `[client] [Client] [id] [ID]`） | evidence/claims/push-client-id.json |

### 高：签名相关

| 编号 | 问题 |
| --- | --- |
| B.real-sign.profile-id | AGC 创建 Profile 的真实返回里没有 id，代码却按有 id 去读：`profile_create` 返回 `profile:null`，`sign auto` 里"下载后删掉云端 Profile"那段代码从来不会执行。**更正**：原先说"每次自动签名都会在你的 AGC 列表里多留一个 Profile"是错的，这类 Profile 不出现在控制台列表里（见第二节） |
| B.real-sign.delete-nonexistent / B.real-sign.failures | 删除不存在的证书/Profile 也返回"已删除"；CSR 文件不存在时报 INTERNAL 而不是参数错误 |
| A.agc.error-mapping | 证书数量到上限（205389872）、账号不是鸿蒙开发者（205389904）这两种情况上游有明确提示，我们只给错误码。**更正**：审计时撞上证书上限，是因为我用一个新名字建证书；调试证书"一直能生成"是因为 DevEco 自动签名先删掉同名的 `auto_debug_<团队>.cer` 再新建，数量不增加，你的实测是对的 |
| （新增）多团队 | 你的账号属于 3 个开发者团队，原来的做法是不传 `team` 就默认个人团队，AI 不会问你 |

### 中：和上游行为不一致（名字对齐了，行为没对齐）

| 编号 | 问题 |
| --- | --- |
| A.upstream.device-by-name | 上游 `--device` 可以填设备名或序列号，我们只认序列号 |
| A.upstream.build.module-target | 上游支持 `模块@target`，我们不支持；多 target 的模块只能构建第一个 |
| A.upstream.build.build-mode | 上游先校验构建模式名并列出可选值，我们直接交给 hvigor，报错信息不清楚 |
| A.upstream.ui.layout-depth | 界面树 depth：上游 0 表示不限制，我们 0 只返回根节点（差一层） |
| A.upstream.run.uninstall | 卸载：上游区分"没装"和"卸载失败"，我们都返回 `uninstalled:false` |
| A.upstream.skills.agents | 缺 atomcode、dsh 两个工具的技能目录 |
| A.upstream.new.proxy-env | 上游最新提交让华为登录走 HTTPS_PROXY 代理，我们的请求会忽略代理（需要 `NODE_USE_ENV_PROXY=1`） |

### 中：工具行为问题

| 编号 | 问题 |
| --- | --- |
| B.schema.unknown-params | 传入工具不认识的参数（拼错、传给了不用它的动作）不报错，按默认值执行。本次因此误触发了一次知识库回滚 |
| B.action.job.resume.stale-status | `job resume` 返回的是恢复前的状态 `interrupted`，还提示"再调用 resume"，再调用就报冲突 |
| B.action.ui_flow.stop.project-ignored | `ui_flow stop` 把流程存进录制时的工程，忽略这次传入的 project；录制草稿跨重启保留，忘记停止会一直挡住新录制 |
| B.code.check.rule.resource-name-check | 系统资源检查只看 `sys.media` / `sys.symbol`，`sys.color` 等写错了查不出来 |
| B.code.check.rule.resource-dir-name | 资源目录名检查只看 entry 模块、只看第二层，非法的限定词目录查不出来 |
| B.code.check.rule.object-link-observed-type | 这条规则写好了但从未被调用（上游也一样）；而且 hvigor 实际允许这种写法，直接启用会变成误报 |

### 低

| 编号 | 问题 |
| --- | --- |
| B.real-emulator.install-output | 下载镜像成功后返回约 2000 字符的进度条噪音 |
| B.emulator.images-empty | 没有匹配镜像时返回一句英文，而不是空列表 |
| E.tmp.emulator-log | 每个模拟器名在临时目录留一个很小的日志文件，不在自动清理范围内 |

## 四、无法验证的部分（UNVERIFIED）

| 编号 | 原因 |
| --- | --- |
| B.real-sign.lifecycle | 用新名字建证书会碰到数量上限；为不改动你的账号，修复阶段没有再建证书（删掉 MCPValidation 后有一个空位，未使用）。创建 Profile、下载、设备登记已真实验证 |
| E.cross-platform.untested | Windows 默认安装路径、.exe 查找、taskkill、Windows 下模拟器许可目录等，只在 CI 的单元测试里跑过，没有在真实 Windows + DevEco 环境跑过；Linux 同理 |
| B.code.check.project.mytestapp | 原路径含中文，hvigor 拒绝构建；已改用 ASCII 路径副本完成对照（B.code.check.project.mytestapp_copy） |
| B.code.check.project.settings_fixture | 不是可构建的工程（没有 products、没有 .ets） |
| C.syscap-classify.e2e_acceptance | 该工程没有设备兼容类警告，无可核对内容 |

## 五、推断（INFERRED）

| 编号 | 依据 |
| --- | --- |
| A.upstream.semantic-method | 行为对照覆盖了高风险命令组（运行/安装/卸载/启动检查、构建、日志、界面输入/布局/截图/窗口、设备选择、模拟器、创建、数据库），其余"完全对齐"的选项只核对了存在和默认值，没有逐个执行 |
| E.no-modify.lingdong | 52 个文件变化的时间、提交人和内容都指向你本人的修改，没有任何 MCP 代码路径会写这些文件 |
| C.syscap-hvigor-bugs.note | LingDong 数字从 192/106 变为 191/105，是因为工程在两次统计之间被修改 |
| D.text.22 | `.agents/skills` 目录写入已验证；各宿主是否真的读取该目录没有逐个验证 |
| E.cross-platform.linux-default | Linux 没有默认工具链路径，需要用户配置；属于设计取舍，未在 Linux 上验证 |

## 六、各分区覆盖情况

| 分区 | 做了什么 | 证据目录 |
| --- | --- | --- |
| C 历史声明 | 28 条声明逐条复核（test/audit/claims.json） | evidence/claims |
| B 云端标签 | 8 个查询、679 段，用本地官方文档原文重合度判定真伪；另查非 ArkTS 平台混入 | evidence/cloud-labels |
| B 静态检查 | 26 条自定义规则各 1 个违规用例 + 16 个合法易误报用例，全部用 hvigor 编译对照；需要运行时才能判定的 4 条规则在模拟器上实测；6 个可构建工程全量对照（含 myTestAPP 209 个编译错误逐行对照，召回 100%） | evidence/check-rules |
| B 设备兼容 | 用最小工程做对照实验证实两个编译器 bug 和 canIUse 规则；模拟器复现崩溃；LingDong 191 条警告独立重算，与工具结果完全一致；30 个模块在 6 种设备类型上逐个解析 | evidence/syscap |
| A 上游对齐 | 拉取上游最新提交并审阅全部改动；高风险命令组逐项对照上游源码行和设备实际行为；112 个 host/skip 逐项复核理由（全部成立） | evidence/upstream |
| B 工具动作 | 93 个动作的成功+失败路径，全部真实设备/真实服务 | evidence/actions |
| B 签名 | 真实 AGC：密钥、CSR、Profile 创建与下载、设备登记；证书创建因配额满未能执行 | evidence/real-sign |
| B 模拟器 | 真实下载手表镜像（954 MB，81 秒）→ 确认已下载 → 删除 → 确认已删除；错误版本号、重复删除都被正确判定为失败 | evidence/real-emulator |
| D 说明文字 | 38 句工具说明/提示/技能文档逐句对照证据 | evidence/agent-text |
| E 横向风险 | 7 个工程前后哈希对比；平台分支清单；性能、子进程、临时文件、1 天清理实测 | evidence/cross-risk |

## 七、复跑

```bash
node test/audit/snapshot.mjs before       # 审计前记录所有工程的文件哈希
node test/audit/cloud-labels.mjs          # 以及 test/audit/ 下其他脚本，各自独立
node test/audit/snapshot.mjs after        # 审计后对比
node test/audit/report.mjs                # 重新生成 FINDINGS.md
```

需要：DevEco Studio、真机 + 模拟器、`auth` 已登录（developer + codegenie）、`/tmp/up2` 下有上游仓库。`real-sign*.mjs` 和 `real-emulator.mjs` 会改动 AGC 和本机镜像，只在需要时手动运行。

## 八、修复结果（2026-09-30，按你确认的方案）

第三节的缺陷已全部修复，每项都用 `test/audit/` 里对应的脚本在真实设备/真实服务上复跑，结论已由 DEFECT 改为 VERIFIED（见 [FINDINGS.md](FINDINGS.md)）。你确认的几项做法：

| 问题 | 修复后的行为 | 复核 |
| --- | --- | --- |
| opencode 传 `wait=600000` 被拒 | 超过 60000 自动按 60000 处理，结果里注明；任务没完成就继续 `job wait` | 同样的调用现在构建成功 |
| 部署到哪台设备 | 连着多台设备又没传 `target` 时，报 `DEVICE_AMBIGUOUS`，列出每台设备的名称、型号、真机/模拟器、是否匹配工程，并要求 AI 先问你；`target` 也可以填设备名 | 真机 + 模拟器同时连接时实测 |
| 参数写错 | 不认识的参数、或传给不使用它的动作，直接报错且不执行，给出正确参数名 | `wiat` → 提示 `wait`；`rollback` + `version` 被拒 |
| 多个开发者团队 | 会在 AGC 新建/删除东西的操作不传 `team` 时报 `TEAM_AMBIGUOUS`，列出你的 3 个团队，要求 AI 先问你；只读查询仍默认个人团队 | 真实账号实测 |
| 构建错误 | 209 个编译错误全部计数，前 100 条逐条给出（错误码、文件、行号、原因），其余在日志里；非编译类错误带上原因行和提示 | myTestAPP 副本 |
| 依赖变更 | `oh-package.json5` / `build-profile.json5` 变了，构建前自动装依赖 | 加依赖后直接构建成功 |
| 静态检查 | 嵌套目录模块的资源、AppScope 资源、未在 build-profile 声明的本地库资源都能识别；注释和字符串里的 `$r(...)` 不再报；`sys.*` 各类资源都检查；资源目录名检查覆盖所有模块和限定词目录；删掉了从未启用的 `@ObjectLink` 规则 | 7 个工程：LingDong、MyStarRing、LingDong 副本 0 误报；myTestAPP 209 个编译错误全部命中，只多 2 条（hvigor 在下两行报同一句） |
| 云端标签 | 改为按正文与本地官方文档比对：官方 / 官方·非 ArkTS 平台 / 社区 / 未确认；官方被标成社区 47 → 0，社区被标成官方 5 → 0 | 679 段复测；单次云端查询约 3.6–4.3 秒（原约 2 秒） |
| 其余 | 设备名、`模块@target`、构建模式校验、界面树 depth 与上游一致、卸载区分"没装"、atomcode/dsh、HTTPS_PROXY 代理、resume 返回 running、`ui_flow stop` 校验工程、镜像列表按行返回、下载镜像返回摘要、LSP 空能力名误报过滤、搜索摘要改用原文 | 各自的 test/audit 脚本 |
