# v0.2.1 维护与发布核对

当前发布准备：2026-09-10，仓库负责人要求持续推进到正式发布。版本已更新为 0.2.1，新增同范围的 release-scope-0.2.1.json，原 0.2.0 范围文件保持不变。新发布仍须取得最终版本的六矩阵 CI、完整证据以及远端传递验收。以下为版本准备之前的本地维护核对记录；其中“尚未”“未配置”指记录时状态。

核对日期：2026-09-10。基线为 `d2d3efdc5577dfcbe36a591f0eee6675e6e252f9`，本地分支为 `codex/post-v0.2.0-maintenance`。

**本地维护改动可以进入 v0.2.1 候选评审，尚不具备正式发布条件。** macOS arm64 的 Node 22/24 回归、干净安装和本机 SDK 专项通过；缺少本次最终版本的六矩阵 CI、完整发布证据和新传递流程的远端验收。包版本及运行常量仍为 `0.2.0`，没有新建 v0.2.1 发布范围豁免。此次生成的 ZIP 仅为 `installation-validation`。

本轮没有 push、PR、合并、tag、Release、npm 发布、远端环境配置或工作流派发；没有操作真机、启停模拟器、使用生产云凭据或切换用户 MCP 安装。

## 改动及原因

| 问题                                                             | 修改                                                                                              | 证据与边界                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Hono 锁定在存在公告的 4.13.1                                     | 仅将 `package-lock.json` 的 Hono 更新到 4.13.7                                                    | 仍满足 MCP SDK 的依赖范围；没有新增 override、依赖副本或无关主版本升级                                                                    |
| ZIP 声明大小不足以限制实际解压内存，后续写入失败可能留下部分目录 | 新增 `scripts/lib/archive-safety.ts`；加固 `distribution.ts` 和 `release-evidence.ts`             | 有界 inflate、长度与 CRC、全部内容 hash 先验、独占新目录和文件、中途失败清理；既有目录和链接保留                                          |
| 发布证据依赖临时公开 Release 中转，跨作业身份约束不足            | 重写两个 release workflow，新增 `release-transfer.ts`、`release-artifact.ts`、`verify-publish.ts` | AES-GCM 密文使用官方不可变 artifact；精确绑定运行、attempt、提交、仓库、artifact ID 和三层摘要；写权限 job 再核对文件集合及 gate 输出摘要 |
| 五个工作流使用触发 Node 20 警告的旧 Action                       | 更新五个 workflow 的官方 Action SHA，补充 `.github/actionlint.yaml`                               | 保留六矩阵 Node 22/24；关闭 setup-node 自动缓存；发布写权限限定在最后一个 job                                                             |
| 缺少可本地复现的失败路径验证                                     | 补充 API、工具链、LSP、认证、云知识和云 profile 测试                                              | 六组限定场景有真实自动测试；云端响应和凭据均为 fixture                                                                                    |
| 依赖锁及测试变化令上游接收凭证过期                               | 用新回归及 SDK 报告刷新两个 baseline                                                              | 历史凭证原字节归档；8 项历史检查保留原始执行身份；没有把重新接收冒充重新执行                                                              |

本地实现提交为 `aea38d7`（安全）、`362e294`（发布传递与 Actions）、`848eaa9`（补测与 provenance）。最后的文档提交保存本报告与证据摘要。大量 provenance JSON 是接收凭证及原件归档，不是构建产物或本机配置。

## 依赖审计及调用可达性

`npm audit --omit=dev --json` 从 **2 个中危包、4 条公告**降为 **1 个中危包、1 条公告**；前后均无高危或严重项。修复后 audit 仍返回退出码 1，不能描述为零漏洞。

| 包                     | 实际调用与处置                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hono` 4.13.1 → 4.13.7 | 经 `@modelcontextprotocol/sdk` 1.30.0 引入。项目使用 SDK 的 stdio server/client；没有调用 Hono HTTP transport、`toSSG()` 或 `parseBody()`。仍更新到兼容补丁版，消除锁中三条公告。公告修复线为 4.13.5：[SSG 路径](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv)、[表单嵌套](https://github.com/advisories/GHSA-g6gw-c38x-mqfc)、[URL fragment 解析](https://github.com/advisories/GHSA-crvj-82cr-hjcx)。 |
| `adm-zip` 0.6.0        | 公告影响目标目录符号链接跟随写入；截至核对时没有补丁版。项目未使用 `extractAllTo`、`extractAllToAsync` 或 `extractEntryTo`，分发及证据解包走自有校验与写入。新增有界解压及回归；保留 audit 风险，不把 npm 建议的降级 0.5.8 当成已修复证明。[上游公告](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)                                                                                                     |

另一个 AdmZip 调用在 `src/services/knowledge.ts`：按已索引文档 ID 从随包 `docs.zip` 读取单个 Markdown 到内存，不执行成员路径落盘。已有 8 MiB 声明大小限制和分发资源完整性核对；这不证明任意遭本地篡改的 ZIP 都可安全处理，也不等于给这条读取路径新增了有界 inflate。

归档回归覆盖：相对穿越、绝对路径、盘符、反斜线、UNC、Windows 保留名、大小写/精确重复、文件父路径冲突、符号链接与设备/FIFO 类型、加密标记、不支持的压缩方法、虚报大小、实际 inflate 超限、CRC 与 SHA 错误、预先存在的目录/链接，以及第二次写入失败后的清理。

`npm ls --omit=dev --all --json` 前后依赖树和 `npm outdated --json` 快照均保留。outdated 另外列出 LangChain core、Node 类型、better-sqlite3、TypeScript、vscode-jsonrpc、vscode-uri、Zod 的新版；这些不属于本轮公告修复，未扩大升级范围。

## Action 与发布传递核对

只读获取的旧运行 annotations 共 12 条 Node 20 警告，来自五个工作流。原运行号为 `34429756565`、`34430544447`、`34430609014`、`34319010546`、`34336801371`。这组历史警告说明原问题；更新后的远端运行尚未派发。参见 [GitHub Node 20 退役说明](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)。

| Action            | 核对的官方版本                                                             | 固定提交                                   |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| checkout          | [v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)          | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| setup-node        | [v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0)        | `820762786026740c76f36085b0efc47a31fe5020` |
| upload-artifact   | [v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1)   | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| download-artifact | [v8.0.1](https://github.com/actions/download-artifact/releases/tag/v8.0.1) | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` |
| setup-java        | [v6.0.1](https://github.com/actions/setup-java/releases/tag/v6.0.1)        | `de7274f081f381c8f8158605e0321c36c376e2e6` |

公开仓库的 artifact 可由有读取权限的登录用户下载，所以证据必须先加密。专用临时 Linux runner 只导入一个摘要寻址的密文并用官方 Action 上传，不 checkout、不安装项目、不接触 SDK、设备或解密密钥。解密和重新 gate 在受保护的托管 runner job 执行。[权限依据](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)

| 结果                    | 本次设计的处理                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 成功                    | 输入证据先完整 gate；不可变密文 artifact 保留 7 天；下游核对六项精确选择值并重新 gate；最后仅发布软件 ZIP、摘要及白名单 receipt |
| 失败                    | 非成功 run、错误 attempt/提交/摘要、过期 artifact 均拒绝；解包部分写入清理；gate 失败阻止 publish                               |
| 取消                    | 正常取消执行 `always()` 明文清理；硬终止依靠托管 VM 或管理员配置的临时 runner 整体销毁；密文按期过期                            |
| 正式发布 API 响应不确定 | 先只读检查最终版本和资产；禁止盲目覆盖或删除。该步骤没有声称原子回滚                                                            |

三个摘要分别覆盖服务端 artifact ZIP、`evidence.enc` 和解密后的证据 ZIP。没有 latest 或模糊名称下载。整个中转不创建 Release/tag，因而不需要手工删除公开中转资产。失败后应重跑所有作业或重新 dispatch，不能复用旧 attempt 的导入文件。

本地已验证格式、加密失败、运行/artifact 元数据拒绝、最终发布字节约束和工作流静态边界。**尚未验证远端成功、失败、取消及强制销毁行为**；runner 生命周期、环境保护和 secret 是明确的外部前置条件。配置与完整执行步骤见[发布证据传递](release-evidence-transfer.md)。

## 本轮验证命令与结果

下列 `$E` 为本轮独立临时验收目录；Node 24 使用 v24.19.0，Node 22 使用官方 darwin-arm64 v22.23.2，原生依赖分别安装。Node 22 源码回归使用独立临时 worktree，避免共用不同 ABI 的 `node_modules`。原始报告和日志的相对文件名、SHA-256 见 [maintenance-validation-0.2.1.json](../provenance/maintenance-validation-0.2.1.json)。该索引是本地证据清单，不能替代 release manifest。

| 命令                                                                                                                               | 实际结果                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm audit --omit=dev --json`、`npm ls --omit=dev --all --json`、`npm outdated --json`                                             | 保存前后快照；audit 2 → 1 中危；audit/outdated 的非零退出码保留                              |
| `npm ci`                                                                                                                           | Node 24 和独立 Node 22 源目录均成功                                                          |
| `npm run typecheck`                                                                                                                | Node 22/24 均通过                                                                            |
| `npm run build`                                                                                                                    | Node 22/24 均通过                                                                            |
| `node --test dist/test/native-distribution.test.js dist/test/native-release-evidence.test.js`                                      | 安全专项 28/28 通过                                                                          |
| `node --test dist/test/native-release-transfer.test.js`                                                                            | 传递专项 4/4 通过                                                                            |
| `node dist/scripts/native-regression.js "$E/regression-node24"`                                                                    | 64 个测试文件，400/400 通过；失败、取消、跳过、todo 均为 0                                   |
| `node dist/scripts/native-regression.js "$E/regression-node22"`                                                                    | 同样 400/400 通过，零失败/取消/跳过/todo                                                     |
| `node dist/scripts/resources.js`                                                                                                   | 119 项资源、79 项知识、4 个来源通过                                                          |
| `node dist/scripts/native-migration-audit.js`                                                                                      | 40 工具、7 脚本、330 参数、95 动作覆盖有效；`release_ready: false`，28 pending 保留          |
| `node dist/scripts/upstream-scope.js "$PWD" d2d3efdc5577dfcbe36a591f0eee6675e6e252f9 main`                                         | 提交后核对：`framework_updates: []`、`official_files: []`、非初次迁移                        |
| `node dist/scripts/upstream-adapt.js baseline-refresh "$E/deveco-cli-baseline-plan.json"`，以及 code 对应文件                      | 两份逐目标 hash 评审计划接受；既有 baseline 原件归档                                         |
| `node dist/scripts/upstream-adapt.js baseline-accept deveco-cli "$E/deveco-cli-baseline-evidence.json"`，以及 deveco-code 对应命令 | 使用本轮报告接收成功；保留历史检查身份                                                       |
| `node dist/scripts/upstream-gate.js`                                                                                               | Node 22/24 均通过；2 baseline、0 candidate，`candidate_gate: passed`，`release_ready: false` |
| `node_modules/.bin/prettier --check` 加下列七个新增 TypeScript 文件                                                                | 通过；仓库没有独立 ESLint/lint npm 脚本，未把格式检查冒充 SDK Code Linter                    |
| `actionlint .github/workflows/*.yml`                                                                                               | 官方 actionlint 1.7.12，五份 YAML 通过                                                       |
| `git diff --check`、`git diff --check d2d3efdc5577dfcbe36a591f0eee6675e6e252f9 HEAD`                                               | 无空白错误                                                                                   |

Prettier 的七个文件为 `scripts/lib/archive-safety.ts`、`scripts/lib/release-transfer.ts`、`scripts/release-artifact.ts`、`scripts/verify-publish.ts`、`test/native-cloud-knowledge.test.ts`、`test/native-maintenance-scope.test.ts`、`test/native-release-transfer.test.ts`。

真实 SDK 专项均使用新建项目及状态目录，配置仅指向已安装 DevEco Studio 26.0.0.821 / SDK API 26。没有提供 target 或可选真机签名参数。

| 命令（均带 `DEVECO_CONFIG="$E/sdk-config.json"`）                                | 结果                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `node dist/scripts/native-sdk-acceptance.js "$E/acceptance-sdk"`                 | 24 项观察通过，正常关闭                         |
| `node dist/scripts/native-checker-acceptance.js "$E/acceptance-checker"`         | 13 项观察通过，正常关闭                         |
| `node dist/scripts/native-lint-acceptance.js "$E/acceptance-lint"`               | 6 项观察通过，正常关闭；自动修复仅作用于 canary |
| `node dist/scripts/native-multimodule-acceptance.js "$E/acceptance-multimodule"` | 45 项观察通过，正常关闭                         |

SDK 验证包括本地工程同步/未签名构建、静态检查、语言服务、API 扫描和本地测试密钥/CSR。模拟器仅执行 inventory 读取，没有安装组件、创建镜像或启动实例。这些结果不证明 CLT 三平台组合或设备行为。

分发按 CI 的实际过程执行：

```sh
node dist/scripts/native-distribution.js prepare "$E/distribution"
(cd "$E/distribution" && npm install --package-lock-only --ignore-scripts)
node dist/scripts/native-distribution.js seal "$E/distribution" "$E/candidate.zip"
node dist/scripts/native-distribution.js extract "$E/install-node24" "$E/candidate.zip"
(cd "$E/install-node24" && npm ci --omit=dev)
node dist/scripts/native-installation-check.js "$E/install-node24" "$E/installation-node24"
```

同一 ZIP 在 Node 22 新目录重复 extract、生产依赖安装及 installation-check。两组均 **10/10 通过并正常关闭**；没有在安装目录构建 TypeScript、安装旧 CLI 或修改宿主配置。

| 字节身份                           | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| Node 22/24 运行 JS（两组一致）     | `f329f7c7d52fa95e409696742f9feb3d5d200a9bb4c07ce8d367c302f3d657e5` |
| Node 22/24 全部编译 JS（两组一致） | `cae744885c4e78a18d070b83af795e8dd9ce738f68095d1c96f3a43c5174f75b` |
| 安装候选 ZIP                       | `c4d213eb30420b0d8a36d3d54a5fd0e2d0d636c32d67fdd6af13e9f23b44fa34` |
| 分发清单                           | `aec22b31484a3f4ad9dea0843d412c86235488ba89cc4151d20c0efef94f68aa` |

ZIP 为 48,600,860 字节，清单含 407 文件 / 90,620,049 字节。Node 24 报告采集于实现提交前，base commit 为 `d2d3efd`；Node 22 采集于 `848eaa9`。实际编译与依赖字节核对一致，原报告没有改写提交身份。

调试过程的失败也保留：首轮补测构建因 mock 参数缺类型、引用不存在的统计字段失败，已修正；补测最初 42 项中有 3 项把准备 memo 也算作远端副作用，改为检查 `status='started'` 后完整双 Node 回归通过；actionlint 首次不认识专用 runner 标签，声明标签后通过；upstream gate 首次准确报告 `UPSTREAM_EVIDENCE_STALE`，完成逐项复核与新报告接收后通过。没有用删除断言或豁免规则消除失败。

没有执行或声称通过本轮完整真实 `release-gate`；它要求完整六矩阵、专项、性能、长稳和精确版本范围。回归中的发布门禁/receipt 合约测试已经通过，不能代替真实发布验收。

## 验证债务处置

[maintenance-scope-0.2.1.json](../provenance/maintenance-scope-0.2.1.json) 对原有 91 个引用作完整、无重复的分类：本地 9、受控云端 7、模拟器 4、真机 34、历史 37。这 91 个引用来自 28 个迁移例外、43 个专项例外、19 个性能例外和 1 个长稳声明；它们不是 91 个新缺陷。

完成的六组限定子场景为 API 非法输入/范围冲突、CLT 可选组件丢失恢复、LSP 文件删除重建、双 provider 凭据过期与刷新失败、云知识响应及刷新上限、云 profile 派发后失联/错误响应/取消的持久化与禁止重放。每组都链接到自动测试及明确的结果范围。

迁移矩阵只增加云知识测试引用，原有 **28 pending / 19 已有凭证**不变；`release-scope-0.2.0.json` 字节保持不变。真实 provider、模拟器效果、设备 UI/部署/签名/热补丁、跨平台 SDK、性能配对及长稳范围继续保留。新 fixture 不把整行升级为验收通过。

## 维护核对时的发布前置条件

1. 评审上述本地提交。获得相应远端操作授权后，推送候选分支并核对 `native-ci.yml` 的六矩阵原始报告、干净安装和 Windows 进程检查；确认 Action 警告消失。新发布工作流只接受默认分支，候选分支 CI 通过仍需正常评审合入。
2. 管理员按传递文档配置三个 environment、隔离的临时导入 runner 和密钥。验证 runner 即使取消、失联也整体销毁；先做非发布的导入成功/失败/取消验收。未配置前不要把新流程描述为远端可用。
3. 确定准备正式 v0.2.1 后，同步修改 `package.json`、锁文件及 `src/core/config.ts` 的版本，逐项评审新的版本范围。原 v0.2.0 scope 不能直接冒充 v0.2.1 批准；本轮没有替负责人做新的例外决定。
4. 对最终版本/提交重新生成六矩阵、专项、性能、长稳及分发证据，刷新必要的 provenance；不能改写本轮报告的版本或摘要。真机继续延期，只有负责人明确调整范围或授权相应验证后才能改变该结论。
5. 完整 `release-gate` 通过后执行 prepare/encrypt，经管理通道将密文放到临时 runner 的完整 SHA 路径，派发 evidence 工作流。验证成功后使用其六项输入运行正式 release gate，最终发布仍由 `release` environment 审批。完整参数和清理规则见[操作文档](release-evidence-transfer.md)。

剩余 `adm-zip` 公告需要持续由维护者关注上游补丁或另行评审替换库；本报告没有创建自动监控，也没有把风险降级为已修复。


## 0.2.1 发布准备补充

版本常量、包版本与锁文件同步为 0.2.1。负责人要求推进正式发布后，逐项核对并保留 0.2.0 的全部限制，新增版本范围文件；没有关闭迁移 pending、追加新豁免类别或复用历史报告冒充当前执行。

连续维护暴露的上游凭证续期问题已修正：遇到上一轮 format-2 沿用记录时，继续查找已校验的原始 format-1 执行凭证；新增回归验证两轮续期仍保留原执行身份和摘要。公开 acceptance.json 增加 limited 字段，使有限范围发布可由程序识别。

导入 runner 使用 run/attempt 独占标签与一次性 JIT 注册，在无宿主文件挂载、无 SSH agent、无 SDK/设备/解密密钥的专用 Linux 容器内运行。采用官方 runner 2.337.0 固定镜像摘要及其 Node 24.19.0；外部生命周期在正常退出后销毁容器和 inbox，独立于工作流的 15 分钟计时器负责异常回收。三个发布环境限制 main 并启用负责人审批；密钥仅存在于本地私有保管文件和托管验证环境的 secret。
