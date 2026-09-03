# 来源与许可记录

## DevEco Code Skills

- 来源：`https://gitcode.com/openharmony-sig/deveco-code.git`
- **提取来源**：`v0.1.5` → `537543c5732d03b7ba9bbe6082e3380677a520fb`（见 `deveco-code-v0.1.5.commit`）
- **核对基线**：`v0.1.6` → `ab476cafd27e6418cca35257a456baa1b8cba391`（见 `deveco-code-v0.1.6.commit`），npm 上 `@deveco/deveco-code` 的 latest
- 提取路径：`packages/opencode/resources/skills`
- 提取范围：`arkts-error-fixes`、`arkts-grammar-standards`、`arkts-runtime-fix`、`deveco-create-project`
- 文件数量：129（排除 `customize-deveco` 环境自定义配置 Skill）

**两个版本号各有分工，不要混为一谈。** 文件字节取自 `v0.1.5`；`v0.1.6` 是发布线上的核对基线。二者对本包提取过的内容**没有任何差异**，这一点是逐提交验证过的而非抽样：`v0.1.5...v0.1.6` 共 20 个提交、140 个文件变更（compare 结果 `truncated: false`），其中落在 `packages/opencode/resources/skills/**`、`packages/opencode/src/agent/prompt/**`、`src/tool/arkts-check.cjs`、`src/tool/hdc_log.ts` 的**为 0 个**；`resources/` 下唯一的变更是 `models.dev.json`，与本包无关。因此 `v0.1.5` 的提取内容与 `v0.1.6` 发布线一致，两处标注都成立。

`arkts-runtime-fix` 的 HDC 共享调用及四个调用脚本在本仓库增加了失败文本识别，修复 HDC 返回退出码 0 但输出 `[Fail]` 时的误报；共享调用还增加了官方 Studio/CLT 环境变量及 Linux CLT 目录解析。

`arkts-runtime-fix` 的 `scripts/shared/jscrash-parse.mjs` 修正了 `detectErrorMessage`：上游返回整行且 `CRASH_SIGNAL_RE` 含裸词 `error`，导致 `Error name:TypeError` 抢在真实的 `Error message:` 之前命中；无崩溃信号时又回落到日志最后一行，把无关日志当成崩溃消息。现在优先解析显式的 `Error message:` 并只取负载，无信号时返回 `(not found)`。

`deveco-create-project` 的 `scripts/detect-sdk.mjs` 增加了 CLI 入口和 Studio/CLT 工具链探测。上游只 export 函数，而本仓库的脚本注册表把 `detect_sdk` 登记为可执行脚本，直接运行会 stdout 全空且退出 0，与成功无法区分。现有 export 未改动。

以上改动均在文件内以 `LOCAL PATCH` 注释标注；原许可证文件头和其余上游内容保持不变。

DevEco Code 仓库主体采用 MIT；其中 Huawei 工具和脚本文件保留各自的 Apache-2.0 文件头。复制和分发时必须保留原文件头，并继续维护第三方声明。

`customize-deveco` 未纳入包体，完整内容保留在 `docs/customize-deveco/SKILL.md`，仅作写适配层时的参考。

### 第二提取源：0.2.0-release

- 来源：`https://gitcode.com/openharmony-sig/deveco-code`
- 分支：`0.2.0-release`，提交 `9535f0f5d1a5603a3a9a61a1207278c2b064aae6`（2026-08-01 16:58:33 +0800）
- 提取范围：`arkui-component-best-practices`、`arkts-logic-completer`、`repo-understand-skill`、`solution-design`、`responsive-layout-generator`、`arkui2hds`、`deveco-cli` 共 7 个 Skill、131 个文件，逐字节与上游一致（唯一例外是不取 `solution-design/SKILL.bak`，那是上游未清理的备份文件）

**已有的 4 个 Skill 不从这个分支取。** 理由已在 2026-08-02 修正，原记录作废：

> 原文记的是「`0.2.0-release` 的 `deveco-create-project` 只剩 4 个文件，31 个工程模板文件不存在（`copy-template.mjs` 期望的 `application/` 目录整个消失），照搬会让建工程能力不可用」。**这个判断不成立。** 0.2.0 的 `copy-template.mjs` 根本不再期待模板目录——它改成了调用 `devecocli create` 由 CLI 生成工程，模板文件是因此被删的，不是缺失。

现在的理由是：`arkts-error-fixes`、`arkts-grammar-standards`、`arkts-runtime-fix` 三个在 v0.1.6 与 0.2.0-release 之间的 diff 本身为空，重取没有收益，反而会丢掉本仓的 `LOCAL PATCH`；`deveco-create-project` 的 0.2.0 路线本包**已经跟进**（见下），保留发布线基线的是它的 `detect-sdk.mjs` CLI/CLT 补丁。四者的原始字节取自 `v0.1.5`，并已按上文的 compare 结果确认与 `v0.1.6` 发布线无差异；本地差异均在文件内以 `LOCAL PATCH` 标记并在本页列明。

`deveco-create-project` 的建工程实现已按 0.2.0 的方向改写：`copy-template.mjs` 不再拷贝模板，改为调用本机 DevEco CLI 的 `create` 子命令。与上游的差别是它不复制那句写死的 `spawnSync('devecocli')`——上游靠 PATH 上的 shim，本包不提供，改为 `DEVECO_CLI_ENTRY` → `require.resolve("@deveco/deveco-cli/dist/cli.js")` → PATH 三级解析，全部失败时返回结构化的 `DEVECO_CLI_NOT_FOUND`。脚本对外的 CLI 契约（`--project-path` / `--app-name` / `--bundle-name` / `--api-level`）保持不变。原来的 31 个模板文件移到 `test/fixtures/harmony-app/`，只作 ArkTS 检查器的测试夹具，不随包分发（`scripts/install.mjs` 的 `ASSETS` 不含 `test/`）。

未取的 4 个 0.2.0 Skill 及原因见 `INVENTORY.md`。

`0.2.0-release` 截至提取时尚未发版（npm 上 `@deveco/deveco-code` 仍是 0.1.6），这批内容后续可能变动，故来源精确记录到提交号。

#### 该分支的后续漂移（2026-08-03 复查）

分支已从锁定的 `9535f0f5` 前进到 `31ae19dd`，中间 5 个提交：`build_project output improve`、`use devecocli docs search`、`fix build project output`、`optimize start_app output format`、`upgrade devecocli version`。

**基线保持不动**，理由不变：这是未发版的移动分支，跟踪它拿到的是不稳定内容。逐文件核对后，5 个提交里**只有 1 个触及 `resources/skills`**，即 `deveco-cli/SKILL.md`（46 行 → 50 行）。它的两处变化本包分别处理：

| 上游变化 | 本包处置 | 理由 |
| --- | --- | --- |
| 新增 `devecocli signature generate` 小节 | **已选择性同步** | 捆绑的 `@deveco/deveco-cli@1.2.1` 确实有 `signature` 命令；缺了它，debug 构建只会以 `Will skip sign 'hos_hap'. No signingConfigs profile is configured` 结束而没有任何后续指引 |
| 删除 `devecocli docs` 小节、改写命令清单 | **不同步** | 1.2.1 仍然提供 `docs` 子命令，跟着删会让本包的文档比实际能力更窄 |

同步处在文件内以 `LOCAL PATCH` 注明来源提交与取舍。其余 4 个提交只动 `src/`，与本包提取范围无关。

#### 第二次同步（2026-08-09）

这一次**取了上游的变更**，不再只做复查。基线从 `9535f0f5` 推进到当时的 `0.2.0-release` HEAD，
中间 52 个提交、166 个文件变更（`truncated: false`，`merge_base == base_commit`，直线比较）。
落在 `resources/skills/**` 的 19 个文件，扣掉本包不取的 `d2c/*` 与 `agents/openai.yaml` 后，
实际影响 4 个文件，逐一三方合并而非覆盖：

| 文件 | 处置 |
| --- | --- |
| `ui-reconstruction-score/references/analysis_workflow.md` | 本地零改动，取上游全部改进（对比要点、问题上限 2→3） |
| `ui-reconstruction-score/SKILL.md` | 取上游改进，保留本地的 Pillow 前置说明与 vlm 非门禁说明；上游删除的 JSON 结构示例本包保留 |
| `arkui-scoring-workflow/SKILL.md` | 取上游的多轮视觉校准流程（round/status 状态机、invoked→completed、blocked 档、轮次间允许改代码），保留本包的「工具绑定」表；上游把工具层退回泛指「MCP 工具」，**不跟** |
| `deveco-cli/SKILL.md` | 取 9 条 emulator 场景控制、`ui` 段、命令清单（15 个，与 1.2.1 实测一致）；上游删除 `docs` 与 `skills` 两节，**均不跟** |

**`compare_images` 是这次同步的主要摩擦点。** 上游 0.2.0 新增了 `src/tool/image-compare`，新版文本
多处引用 `compare_images`。本包不提供该工具，若照搬会让这几个 Skill 指向不存在的东西——与当初排除
`verify_ui` 是同一类错误。处置：凡引用处一律改写为本包等价能力（看图观察 + `ui_score.py` 的确定性
指标），改写点均以 `LOCAL PATCH` 标注。

> **订正（2026-08-09，读源码后）。** 上面原本写的是「若将来移植 `image-compare`，这几处改写应当
> 回退」，该判断不成立，已作废。`src/tool/image-compare/image-compare-tool.ts` 有两处硬依赖：
> 它 `import { resolveUIVerifyParams } from "../ui-verification/ui-verification-tool"` 取端点配置，
> 并把两张图 POST 给一个 OpenAI 兼容的 chat completion 端点，缺 `baseURL`/`apiKey`/`modelName`
> 时直接返回「图片对比功能不可用：未配置多模态模型。请登录 DevEco 账号」。**它不是本地图像算法，
> 而是 UI 验证链的第四环**，移植它等于把整条链连同 DevEco 账号依赖一起引进来，与本包宿主中立的
> 定位冲突。且对本包冗余：上游 SKILL.md 自己把它限定在「模型不支持多模态」的场景，而 Claude Code
> 与 Codex 的模型本身就能看图。因此改写是终局处置，不是过渡措施。`manifest.json` 的
> `excluded.uiVerification` 已相应改为「四个工具」并记录共同根因。

上游删除 `docs` / `skills` 两节一事，已用 `devecocli --help` 实测 1.2.1 复核：两个命令都还在，
连同 `ui`、`check`、`signature`、`auth` 共 15 个，与上游新版的命令清单逐字吻合——上游删的只是详细
小节而非命令本身。`ui` 段上游只写了 `screenshot`，本包补了实测存在的另外 10 个子命令。

同期 `d2c-fast` 随上游退场，详见 `INVENTORY.md`。

## SDD 命令与模板

- 来源：本机物化目录 `~/.local/share/deveco/specs/`
- 版本：`~/.local/share/deveco/specs/.version` 内容为 `0.1.5`，与全局安装的 `@deveco/deveco-code@0.1.5` 一致
- 上游对应位置：编译进 `bin/deveco.exe` 的资源对象 `Ue = {templates:{...}, commands:{...}}`
- 提取范围：`commands/` 5 个、`templates/` 3 个，全部纳入

改动记录见 `INVENTORY.md`「SDD 命令与模板」一节；每个文件头部也有 HTML 注释说明本地改了什么、为什么改。

## 提取的方法论 Skill

- 来源：`/opt/homebrew/lib/node_modules/@deveco/deveco-code/bin/deveco.exe`（`@deveco/deveco-code@0.1.5` 的 darwin-arm64 单文件可执行）
- 提取对象：内置 agent 的 system prompt。`build`（`var Nt`）、`debug`（`var at`）、`plan`（`var Ct`）取自二进制常量；`goal` 取自源码仓明文 `packages/opencode/src/agent/prompt/goal.txt`（165 行）
- 提取范围：只取各 prompt 尾部的 HarmonyOS 方法论章节，通用 CLI 行为样板（tone/style、输出长度、通用工具使用政策、安全红线）不取
- 产物：`skills/harmony-build-loop/`、`skills/harmony-debug-instrumentation/`、`skills/harmony-plan-doc/`、`skills/harmony-sdd-workflow/`

这四个 Skill 是**衍生作品**，不是上游原文件的复制。上游 `LICENSE` 在 `v0.1.5`、`v0.1.6`、`0.2.0-release` 三处均为 MIT（已联网核对原始文件），衍生内容随本仓库一并按 MIT 分发，来源已在各 SKILL.md 正文首段注明。

未提取的部分：agent 定义的 harness 侧——permission 表、mode/hidden/temperature 配置、`plan_enter`/`plan_exit`/`debug_exit` 轮次协议，以及 UI 自动校验链路。

上游 `agent.ts` 的 `Info` schema **没有 tools 白名单字段**，工具可见性完全由 `permission` 规则集表达，这是 opencode 特有的机制，能力包无法表达。11 个 agent 里可移植的只有 prompt 内容：`build` / `plan` / `debug` / `goal` 四个已提取（见上表），其余 7 个是 OpenCode 通用会话 agent，鸿蒙关键词密度实测为 0。`spec-implementation` 与 `spec-verify` 的行为边界靠 permission 机械强制，已改写成 `harmony-sdd-workflow/references/delegation-contracts.md` 里的显式委派约束。

## 统一 MCP 适配层依赖

- `@modelcontextprotocol/sdk@1.30.0`：统一 stdio MCP 协议服务和 CodeGenie 子进程客户端。1.29.0 → 1.30.0 是为消掉 GHSA-frvp-7c67-39w9（它把 `@hono/node-server` 放宽到 `^1.19.9 || ^2.0.5`）。另有两条 `overrides` 强制 `axios@1.18.1` 和 `adm-zip@0.6.0`，理由与回归见 `PACK.md`「装依赖」。
- `@deveco-codegenie/mcp@1.1.11`：固定版本的 CodeGenie MCP 子进程；其平台包由 npm 按当前平台安装。
- `@arkts/language-server@1.3.10`：本地 ArkTS LSP；通过 `vscode-jsonrpc` 和 `vscode-uri` 连接。
- `@deveco/deveco-cli@1.3.1`：官方 CLI npm 包。新增命令包装逐项用已安装包的 `--help` 和实际 argv 核对；实现细节再对照 `https://gitcode.com/openharmony-sig/deveco-cli.git` 提交 `0082a92b3b3967a90517b17a285982cf6805022b`（2026-08-27）。`src/deveco-official.mjs` 覆盖 lint、docs、device、UI、emulator、signature、auth；`src/hotreload.mjs` 按源码真实行为持有 `--hotreload` 的常驻 socket 进程。Studio/CLT 的环境变量优先级与目录布局对照同提交的 `src/toolchain/tool-provider.ts`。
- `src/upstream/arkts-check.cjs`：从 DevEco Code v0.1.5 `packages/opencode/src/tool/arkts-check.cjs` 提取。本仓库打了六处补丁（空文件集、内部异常、SDK 校验器路径、stdout 截断、诊断范围和 CLT SDK 探测），每处都有 `LOCAL PATCH` 注释，详见 `PACK.md`「与上游的差异」第 5 条。文件发现逻辑没有改在这里，而是上移到 `src/arkts-check.mjs`。
- `src/upstream/arkts-check.txt`、`src/upstream/hdc-log.txt`、`src/upstream/lsp.txt`、`src/upstream/switch-cwd.txt`：对应官方工具说明原文。
- `src/hdc-log.mjs`：按 DevEco Code v0.1.5 `packages/opencode/src/tool/hdc_log.ts` 的公开行为实现 Node 适配层。
- `src/lsp.mjs`：新的统一 LSP 适配层；操作格式参考本机旧 `deveco-arkts-lsp` 项目，但没有复制旧 MCP 入口或客户端配置。

完整的 npm 锁定版本见 `package-lock.json`；各依赖的许可证和版权文件位于 `node_modules` 安装包内。

## 参考项目

`/Users/dreamlike/DreamLike/deveco-knowledge-mcp` 仅作为认证和知识检索实现参考，不复制其旧 MCP 入口，也不自动修改任何现有客户端配置。

## 第四提取源：HarmonyOS Agent Skills（华为官方云端 Skill 仓库）

- 来源：`https://gitcode.com/HarmonyOS_Skills/harmonyos-agent-skills`
- 版本：tag `v0.0.2`，提交 `37f8f380ea9ac840ff1e43dd9a608ab320edffc6`（2026-07-29 17:55:45 +0800，同时是 `release` 分支 HEAD）
- 提取提交：见 `harmonyos-agent-skills-v0.0.2.commit`
- 取材方式：`GIT_LFS_SKIP_SMUDGE=1` clone 后 checkout 到该提交，不拉取 LFS 二进制
- 提取范围：46 个主 Skill 中的 35 个，加上 `hmos-push-kit` 拍平出的 4 个子 Skill，共 **39 个目录**

**这不是 DevEco Code 仓库的内容。** 它是另一个独立仓库，由 `@deveco/deveco-cli` 的 `skills` 子命令从云端分发（`devecocli skills list` 返回 34 个，与本仓库 `v0.0.2` 的主 Skill 集合不完全一致）。之所以纳入，是因为它与本包已有的 18 个 Skill 名称零碰撞、职责互补。**必须锁定到上面的提交号**：该仓库只有 4.5 个月历史，版本停在 `v0.0.2`，无 CHANGELOG，`main` 与 `release` 双向 merge 而非单向发布，跟踪分支会拿到不稳定内容。

### 许可现状（如实记录，未作美化）

在 `v0.0.2` 上逐项核实：

| 检查项 | 结果 |
| --- | --- |
| 仓库根目录 LICENSE / NOTICE / COPYING | **不存在** |
| README 中的许可章节 | **不存在**，全文无 license / 许可 / 开源协议 / copyright 字样 |
| 全仓 86 个 `SKILL.md` 中 frontmatter 声明 `license:` 的 | **14 个**，全部为 MIT |
| 本包纳入的 39 个中声明 `license: MIT` 的 | **9 个**（`hmos-memleak-analysis`、`hmos-ability-insight-intent-generator`、`hmos-ascf-assistant`、`hmos-ascf-convert-taro`、`hmos-ascf-convert-uniapp`、`hmos-atomicservice-assistant`、`deveco-studio-codelinter`、`deveco-studio-emulator`、`deveco-studio-verify`） |
| 本包纳入部分带 Apache-2.0 + Huawei 版权头的文件 | **26 个**（`hmos-scan-kit-customscan` 的 14 个 ArkTS 样例：12 个 `.ets` + 2 个 `.ts`；`hmos-appfreeze-analysis` 的 10 个 Python；`hmos-apifault-analysis` 的 2 个 Python） |

**上游没有提供仓库级许可声明，这一事实本身是记录的一部分。** 30/39 个纳入的 Skill 既没有 frontmatter 声明也没有文件头，处于「保留所有权利」的默认状态。本包的处置是：

- 保留所有原始文件头，一字不改；
- 在 `NOTICE.harmonyos-agent-skills` 中逐 Skill 记录其许可声明状态；
- 不把这批内容与 DevEco Code 的 MIT 内容混为一谈，`manifest.json` 里给它们独立的 `origin` 值 `harmonyos-agent-skills-v0.0.2` 和独立的 `tier: "extended"`；
- 再分发本包前，使用方需要自行评估这一层的许可风险。core 层（17 个，MIT）不受影响，`scripts/install.mjs --profile core` 可以只装 core 层。

### 排除的 11 个主 Skill 及理由

| Skill | 排除理由 |
| --- | --- |
| `hmos-multidevice-scenario-entry` | `scripts/remote_load.sh` 在运行期从 `matrix.openharmony.cn` 下载 zip 解压，随后 `rm -rf "$HOME/.claude/skills/<name>"` 再建 symlink。即便它有名单校验，「运行期拉取未版本化远程代码 + 对宿主 Skill 目录做破坏性写入」这个组合不可接受 |
| `hmos-jsleak-analysis`（444MB）、`hmos-cppcrash-analysis`（164MB）、`hmos-native-memleak-analysis`（45MB） | 三者的核心是 LFS 预编译二进制（`heap_cluster`、`llvm-objdump`、`trace_streamer` 等），零许可、零校验和；其中 LLVM 衍生物按 Apache-2.0-with-LLVM-exception 再分发时必须附 NOTICE，上游没有 |
| `hmos-arkts-syntax-checker` | 与 `harmony-build-loop` 完全重复（同一条 检查→修复→构建 循环），且其工具名硬编码为 CodeGenie 前缀，与本包 MCP 不匹配 |
| `deveco-studio-hvigor` | 与 `deveco-cli` / `harmony-build-loop` 重复，是 hvigorw 命令手册，本包已有 `build_project` 封装 |
| `deveco-studio-hilog` | 与 `harmony-debug-instrumentation` / `arkts-runtime-fix` 重复，本包已有 `hdc_log` 工具 |
| `deveco-requirement-development` | 与 `solution-design` + `harmony-plan-doc` 重复 |
| `deveco-autobugfix` | 与 `harmony-debug-instrumentation` 重复，且依赖本包禁用的 `verify_ui` |
| `deveco-native-flow` | 70 个文件里含 36 个嵌套子 Skill，职责覆盖本包 4-5 个 Skill，并带 Android/iOS 分支；整体纳入会淹没 Skill 索引并造成触发冲突 |
| `.hmos-skill-reviewer` | 上游仓库自用的 frontmatter 校验工具，不是能力 |

### 纳入时剔除的内容

| Skill | 剔除 | 理由 |
| --- | --- | --- |
| `hmos-arkts-knowledge-retriever` | 整个 `linter-cli/`（566 个文件） | 其中 196 个是 vendored `node_modules`，**完整搬运了 TypeScript 却没有附带 Apache-2.0 许可副本**，这是明确的许可违规；另 370 个是 OpenHarmony 编译器 runtime 的搬运。剩余 202 个纯文档正常纳入 |
| `hmos-design-visual-mobile` | `assets/` 下 3 个 `.ttf`（`HMOSColorEmojiCompat.ttf`、`HMOSColorEmojiFlags.ttf`、`HMSymbolVF_1.ttf`） | 华为字体的再分发许可未确认 |

`hmos-push-kit` 的 4 个嵌套子 Skill 被拍平为顶层同级目录。它的 Master 路由是**按 Skill 名字**路由的（「路由到 `hmos-push-kit-token`」），名字全局唯一，拍平后路由天然成立；保持嵌套反而会让宿主的 Skill 选择器看不到子 Skill，使大路由失效。

## 宿主中立化改写（跨两个提取源）

上游内容为 DevEco Code / Claude 环境编写，有些地方直接点名了宿主专属工具。照抄会让 Codex、OpenCode 等宿主
去调一个并不存在的东西，所以逐处改写为**能力**表述，映射见 `manifest.json` 的 `hostToolMapping`。
每处都在原位留了 `LOCAL PATCH` 注释，`test/pack.test.mjs` 的「no skill instructs the model to call a
host-specific tool by name」会持续守护。

| 文件 | 上游写法 | 改为 |
| --- | --- | --- |
| `skills/deveco-create-project/SKILL.md`（description、`:27`、`:33`） | `AskUserQuestion` | 宿主的「向用户提问」能力；没有就在回复里列出选项并停下等答复 |
| `skills/hmos-ability-insight-intent-generator/SKILL.md:193` | `AskUserQuestion` | 同上 |
| `skills/hmos-ability-insight-intent-generator/references/write_file_guide.md:65` | `AskUserQuestion` | 同上，并明确「不要自行写盘」 |
| `skills/solution-design/SKILL.md`「工具使用指南」 | `Read` / `Write` / `Grep` / `Glob` / `TodoWrite` | 读文件 / 写文件 / 搜索内容 / 查找文件 / 任务跟踪；无任务列表能力时在设计文档顶部维护阶段清单 |
| `skills/solution-design/references/increment-design.md`「会话管理集成」「标准调用格式」 | `Task subagent_type="session-manager"`、`Task subagent_type="design-and-implementation"` | 这两个 agent 属 DevEco Code 自己的注册表，**本包不分发**，任何宿主上都不存在。改写为阶段化表述：会话状态落到设计文档的进度区块，委派改为「宿主有委派能力就委派，没有就主 agent 按同一模板执行」 |

`skills/harmony-sdd-workflow/SKILL.md` 里仍会出现 `subagent_type` 字样，那是在说明「上游的哪部分
harness 没有移植」，属于正文而非指令，守护测试对该文件放行。（原先一并放行的
`skills/d2c-fast/references/host-mapping.md` 已随 `d2c-fast` 退场删除。）
