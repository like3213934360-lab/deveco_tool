# CLI 启动检查适配评审（2026-09-11）

本轮比较官方 [deveco-cli](https://gitcode.com/openharmony-sig/deveco-cli) 的 `a71f93d73941aaa0dbf581918cbd5828014e6e88` → `87c360b05848132c06c6ea120e078619b9ef4634`。官方 Git 镜像的 origin、基线 tree 与提交对象均已核对；2026-09-11 再查 develop 仍为该候选。Code develop 仍为 `aeb4536e56d1bfe8b5a0ff3bb02acb99f3523f2a`。

候选有 38 个变化路径。本文件记录源代码评审，不是已接受的新锁或正式发布回执；最终接受必须执行映射检查并通过 provenance 记录，原始失败证据保留。

## 行为对应

| 上游变化 | 本地实现与明确差异 | 必需验证 |
| --- | --- | --- |
| `src/commands/run.ts` 在普通 Ability 启动和成功 Apply 后调用 smoke；smoke 在 Apply 回退捕获之外，避免失败后二次部署 | `DeviceService.launch/checkStartup` 与 `HotReloadService.apply` 在已接受效果后检查；安装、启动、检查、业务断言分别有回执。检查失败保留已发生的效果，不自动重放。热补丁也做进程集合保持与默认检查，这是本轮明确要求的扩展 | 启动故障公共 MCP、热补丁公共 MCP、部署恢复与热补丁准备回归 |
| `src/apply/apply-manager.ts` 将启动失败由警告改为抛错 | 原生启动错误不能写为成功；准备阶段的 `COLD_DEPLOY_REQUIRED` 是已终结错误，恢复时失去原操作回执仍保留不确定性 | `native-hot-preparation`、真实错误源码／新增文件／冷部署恢复 |
| `src/smoke/{index,types,smoke-inspector,smoke-judge,smoke-verifier,smoke-formatter}.ts` | 有界重复存活观察，默认稳定 1500 ms、总预算 10000 ms。只检查所选应用的可见窗口。分为 passed/failed/inconclusive/cancelled，不以业务页面正确作为默认结论 | 正常页、4 秒首帧、2.5 秒退出、白／黑页、错误显示器、取消和重启 |
| `screen-phash.ts` 及其测试 | 不复制 pHash 黑／白哈希阈值。原生在有界 JPEG 解码及应用窗口中采样量化颜色；99.5% 主色只构成纯色信号。合法纯色需显式 `allow_uniform`，默认持续纯色为 inconclusive | 有颜色／纯色像素测试、真实纯色与显式契约；仍需独立业务断言或客户端读图 |
| `smoke-artifacts.ts`、`smoke-run-store.ts` 及测试 | 上游成功删除截图、失败结束后保留 24 小时，运行目录标记避免并发清理。本地沿用 SQLite 制品、运行关系、租约和容量／保留策略，不在用户工程创建第二套 `.hvigor/smoke`。保留检查报告、截图摘要、进程样本和可取得的有界 Hilog；公共 `hdc_log` 另有精确 faultlog 检索 | 制品／回收回归、取消时报告留存、真实故障清理；Hilog 不冒充已取得 crash 文件 |
| `smoke-inspector.test.ts`、`smoke-judge.test.ts` | 上游查询失败设置 processCheckSkipped，截图失败令 phashBlank=null；judge 对 null 仍 PASS。本地保持未验证，不复制这种成功降级 | 查询失败／超时不可通过，纯色不可证明业务失败，取消不重放 |
| `src/utils/cmd.ts` | 上游用 `??` 保留空 stderr，以识别 pidof 的 exit 1／无输出。本地原生进程结果保留 exitCode/stdout/stderr，启动检查单独分类 | 原生进程和启动检查回归 |
| `hdc-adapter.ts`、`hdc-param.ts` 及测试 | 只查询完整 bundle，避免同尾名应用掩盖退出。原生只接受完整数字 PID 列表、可靠退出码及空 stderr；传输／异常输出保持不可用 | 精确 PID、退出、查询失败及公共故障验收 |
| `hilog-adapter.ts` | 上游区分无 crash 文件和查询失败。本地 faultlog probe/fetch 已保留可用来源、警告、截断与精确文件名；启动报告中 Hilog 不可用有单独状态，不能作为未崩溃证据 | 日志单测、启动故障的真实进程与日志报告 |
| `src/ui/index.ts`、`src/commands/ui-screenshot.ts`、`src/ui/screenshot/{hdc-snapshot,hdc-snapshot.test,screenshot-capturer,types}.ts` | 上游将现有截图逻辑提取为共享类。本地已有共享截图服务、显示器范围、格式校验、拥有的临时文件回收和制品导出；不引入第二套截图执行器 | screenshot/storage 回归与真实错误显示器／正常截图验收 |
| `README.md`、根 `SKILL.md` | 内置工具 Skill 与 UI 工作流说明补充默认启动检查、分层结果和恢复要求。上游热重载跳过 smoke；本地热补丁检查扩展明确说明 | 内置资源读取／摘要检查、Skill 公共 MCP 验收 |
| `src/config/skills.ts`、`src/commands/init.ts` | dsh Skill 路径、dsh/Qoder MCP 安装过滤属于客户端安装分发。本产品按用户既定方向由 MCP 内置知识和 Skill，不增加客户端 Skill 安装／卸载；本地宿主配置保留由维护 CLI 负责 | 内置 Skill 与兼容升级回归 |
| `AGENTS.md`、`.agents/skills/deveco-{check-changes,code-review,docs-and-prose,find-simplifications,test-reliability}/SKILL.md` | 上游 AGENTS 明确这些是仓库维护工作流，根 SKILL 才是发布给用户的入口。没有新增产品工具，仅排除上述 6 个已读路径；未来未知路径仍阻断 | 候选路径完整分类，不执行上游维护指令 |

## 证据与限制

候选真实启动故障验收第四轮及热补丁效果第二轮均已通过；详见[工作记录](remaining-release-progress.md)。记录包含此前失败的原因与修正，不用最后一轮成功抹去失败。当前环境为 macOS arm64、Node 24.14.1、Studio 26.0.0.821、SDK 26.0.0.105/API 26，使用拥有的独立签名应用和模拟器。

本评审不证明任意设备、任意 UI 都可由基础画面检测判断正确，也不证明故障时系统必定投递完整 Hilog 或 crash 文件。截图／传输不可用保持不确定；持续纯色页面由显式契约或客户端审阅处理。最终发布身份的检查和适配接受仍须单独完成。
