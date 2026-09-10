# 原生 ArkTS 静态预检

`arkts_check` 和 `code_diagnose` 的 ArkTS 预检使用同一实现，直接启动所选 SDK 的 Node 和 standalone checker。内置 `skill_workflow` 可调用该检查器指导修复，再执行新鲜检查和构建；无需官方 CLI、子 MCP 或客户端 Skill 安装。结果始终标记 `checkKind:static-precheck`、`compilationVerified:false`；没有错误不等于构建或 UI 验证通过。

## 输入、SDK 与扫描范围

工程、产品和实际模块来自 `build-profile.json5`。默认检查选中模块的 `src/main/ets` 中 `.ets/.ts` 源文件及模块根目录的源码导出文件，排除声明文件、`hvigorfile.ts`、测试目录和依赖/构建输出。不假设模块名为 `entry`。显式 `files` 支持相对工程路径和绝对路径，但必须位于选定工程内，按真实路径去重。空选择、缺失文件、目录、声明文件、非法扩展名以及通过软链接等方式越出工程的文件，在 SDK 派发前明确拒绝。

最多 100000 个源文件，每文件 8 MiB、合计 64 MiB；SDK 读取的传递依赖不属于这个输入预算。报告声明实际文件数、来源根目录、源文件字节数和执行范围。

项目规则的跨文件符号绑定仅使用经过上述预算检查的应用 AST，不读取额外外部库声明。相对导入、模块包入口与重导出用于识别实际组件和类型；无法解析的外部组件保持未知。SDK 本身的类型检查与这部分项目规则分别保留各自范围。

SDK 的 `compileMode` 与 HMS `externalApiPaths` 必须在加载 SDK 模块前设置，因为模块初始化会读取环境变量。HMS 路径使用平台路径解析，避免 Windows 路径分隔符导致遗漏。配置发生在受管检查子进程内。工具链版本与工程目标版本分别处理，保留旧 API 工程的真实可用性警告。

每次检查使用状态目录下独立、登记在 SQLite 中的临时目录，缓存不再写入工程 `.cache`。整个目录预留 16 MiB，日志捕获另设 8 MiB 上限；超过预算取消，确认受管进程退出后清理。并发请求不共用 SDK 缓存。该额度属于观测和清理机制，不是操作系统磁盘硬配额。

## 诊断与报告

- SDK 诊断只保留选中源码范围，不把 SDK 传递声明的错误混入工程结论。合法绑定误报过滤保留未知 `$name` 的真实错误。
- 系统资源规则检查 AST 中实际的 `$r` 调用，忽略注释和字符串中的示例；缺失资源数据标记 `unavailable`。
- 路由使用模块声明的自定义 `$profile` 资源。缺失或格式错误的声明报告 `page-profile-invalid`，不存在的页面报告 `page-file-exists`；页面按模块路径定位，接受 `.ets/.ts`，目录不能充当页面。
- 模型版本不一致单独报告 `model-version-consistency`。
- 应用资源、权限与动态路由按实际模块配置和当前 SDK 定义校验；ArkUI 装饰器、Entry、UI 构建体、ObservedV2 字段/存储及 Navigation 注册由 SDK AST 和符号绑定检查。调用链使用当前 SDK 的 ArkUI 解析配置，注册 Builder 的每个分支分别校验。完整规则和上游配置差异见[检查器适配记录](upstream-cli-checker-review.md)。
- 检查子进程退出失败、没有报告、报告格式/计数/成功标志不一致均为执行失败，不返回检查通过。
- 全部诊断保存在 JSON 制品中；直接响应保留完整错误/警告计数、最多 50 条及 24 KiB 的诊断预览，字段裁剪保持有效 Unicode，`truncated` 明示裁剪。大于 256 Ki 字符的报告交给有界 CPU Worker 池解析，完整检查所有记录后才生成预览。使用 `workflow_run.read_artifact` 分页读取完整报告。

## 0.3.0 候选复验与历史边界

当前本机 Node 24 / SDK 26 候选完成 21 项检查器验收，持久化目录为 `native-7-checker-final-lock-20260910-4`，对应运行时 `5e5aa855…`、编译摘要 `4c6668ee…`。覆盖文件边界、元数据、权限、资源及跨文件/导航规则的错误→修复样例；API 12/23/当前版本警告分别复验。正式发布状态见[下一版本执行记录](next-release-progress.md)。

以下为旧版本历史记录。重启后早期 `/private/tmp` 原始验收文件已丢失，不能仅凭历史摘要作为当前发布证据。

冻结对照：提交 `aab1405b51e00e4036bdc8f18ae4229835de77b0` 的 `arkts-project.mjs`、`upstream/arkts-check.cjs` 及 `code-tools` 回归；新回归见 `test/native-checker.test.ts`，SDK 验收见 `scripts/native-checker-acceptance.ts`。

2026-09-08 本机 Node 26 运行服务、Studio 26.0.0.821 / SDK 26.0.0.105、SDK Node 24.14.1：13 项真实静态预检验收通过。证据 `/private/tmp/deveco-native-checker-20260908-4/evidence.json`，运行源码摘要 `90d007ec72aaa8989a84b6731d7787b2e4b10bddc8b0e5b44b38bf08494d89dd`。

覆盖干净工程、扫描排除、TS/模块根导出错误、HMS Kit、路由缺失/格式错误/修复、资源语法、API 12/23/260000 版本切换、并发缓存清理、模型版本、绑定误报、超 64 KiB 报告和中文模块。700 条错误的完整制品 111684 字节，直接响应预览 50 条、7286 字节；通过分页核对全部 700 条。完整回归 210 项通过、0 跳过，证据 `/private/tmp/deveco-native-regression-node26-20260908-32/evidence.json`。

两个干净验证目录只安装 14 项原生运行依赖：Node 22.23.2 与 Node 24.14.1 分别完成 210 项回归、0 跳过，证据 `/private/tmp/deveco-native-regression-node22-20260908-10/evidence.json`、`/private/tmp/deveco-native-regression-node24-20260908-10/evidence.json`。Node 24 独立运行服务再次通过 13 项真实 SDK 验收，证据 `/private/tmp/deveco-native-checker-node24-20260908-1/evidence.json`，运行源码摘要与上述相同；验证目录未安装官方 CLI、CodeGenie 子 MCP 或 Skill。

首轮 `/private/tmp/deveco-native-checker-20260908-1/evidence.json` 在同步准备阶段失败：Hvigor 26 不接受中文工程根路径。后续使用空格根路径同步，再单独验证中文模块；没有声称解决 Hvigor 自身的根路径限制。第二、三轮历史成功证据仍保留，第四轮覆盖最终有界报告实现。

这些是静态预检行为证据，不是跨平台 SDK、编译或性能门槛证明。Windows/Linux 的路径与报告回归走 Node 22/24 CI，实际 SDK 支持仍须分别验证。每次 SDK 检查在独立子进程执行，本记录中的单次耗时不构成固定机器、固定输入的 1000 次 P95 对比。

提交 `23c08ab` 的 [CI 34167674814](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34167674814) 已完成：macOS、Windows、Linux 的 Node 22/24 六组各 210 项通过、0 跳过，Windows 各 20 轮进程压力通过。此后复查修复了工作流中报告的制品归属，见 `docs/native-artifact-ownership.md`；后续修改的跨平台结果分别记录，不继承此前 CI 的成功状态。

提交 `2ac0811` 后的干净 Node 24.14.1 原生目录重新通过全部 13 项 SDK 静态预检，证据 `/private/tmp/deveco-native-checker-node24-20260908-2/evidence.json`；运行源码摘要 `a03c05b59eb0e0e32efdc279487ef2746aceca60f2b612b5309665cf7953d009`。这次包含最新制品归属和异步工程模板复制，没有使用旧运行依赖。

同一提交的 [CI 34169432690](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34169432690) 六组各 217 项通过、0 跳过，Windows 两组各 20 轮压力通过；六组运行源码摘要与最新 SDK 验收一致。静态预检迁移行为据此标记 verified，真实 SDK 范围仍限于上述本机组件，其他平台 SDK 与最终性能门槛独立保留。

```sh
npm run build
node dist/scripts/native-regression.js /absolute/new-regression-evidence
node dist/scripts/native-checker-acceptance.js /absolute/new-checker-evidence
```
