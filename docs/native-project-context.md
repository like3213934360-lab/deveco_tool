# 默认工程与任务上下文

`switch_cwd` 校验工程配置并保存规范化后的真实目录，仅选择当前运行服务的默认工程。它不改变宿主进程的工作目录，也不为多产品工程猜选产品。多个产品都没有 `default` 时，切换仍然成功，后续构建/诊断等请求需要显式给出 `product`。

选择缺失目录、文件或无工程配置的目录会失败，之前的默认工程保持有效。后续每个请求重新校验工程，已选择的目录被删除或配置失效时明确报错，不悄悄回退到其他工程。明确提供 `project_path` 的请求优先使用指定工程。

`deveco_doctor` 使用与业务请求相同的工程解析服务，能看到本次会话通过 `switch_cwd` 选中的工程。未选择工程时 `project:null`；选中的工程失效或产品不明确时，返回对应工程诊断。运行服务重启后从新配置重新初始化默认工程，已持久化任务继续使用自己的上下文。

业务任务在提交时保存工程真实路径、产品、配置/源码摘要和工具链身份。切换默认工程不修改已提交任务。恢复时仍需重新验证这些身份和输入，不能因为目录名相同而忽略工程变化。

2026-09-08 验证：`test/native-project.test.ts` 覆盖真实路径/别名、Windows 临时短路径、多个无默认产品、失败切换保留旧默认、目录删除和显式工程覆盖。`test/native-context.test.ts` 使用两个专用工程、真实 LangGraph/SQLite、受控诊断服务，验证 `doctor`、切换、持久化上下文及原任务完成。

本机 Node 26 完整回归 212 项通过，0 跳过；原始证据 `/private/tmp/deveco-native-regression-node26-20260908-33/evidence.json`。这些上下文用例不需要真实 SDK、设备或登录，也不代替构建/部署验收。此前六组 CI 已覆盖旧有路径规范化，本次新增行为在新的 Node 22/24 三平台 CI 单独验证。

后续 [CI 34168044469](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34168044469)：macOS/Linux 四组通过；Windows Node 24 全量回归通过，但恢复压力第 9 轮超时；Windows Node 22 本用例在 `switch_cwd` 解析刚创建的目录 junction 时出现 `ENOENT`。已加入失败阶段、链接目标、原生/JavaScript 路径解析及目录内容诊断，并将本用例纳入 20 轮压力检查。

[CI 34168822000](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34168822000) 的诊断确认 Windows Node 22.23.2 在更早的 `fs.cpSync` 阶段没有创建中文目标目录：两个目标目录均不存在，链接本身及其指向正确。失败证据保留在 `/private/tmp/deveco-ci-34168822000-win22/native-evidence/tests.tap` 与 `native-process-evidence/round-1.tap`。Node 上游的 [非 ASCII 路径复制修复](https://github.com/nodejs/node/pull/61950/files) 也涉及 `cpSync` 使用原始字符串构造 Windows 文件系统路径；这里不假设其他 Node 版本均已包含该修复。

工程模板创建与测试工程准备统一使用异步 `fs.promises.cp`，避免该同步实现的路径问题，也避免在运行服务中同步复制整棵模板树。生产创建仍先独占认领新目录，再逐个复制顶层条目；不覆盖已有目录或文件。每个复制条目检查取消，取消后留下未完成操作记录，不报告成功或允许盲目重放。新增真实文件检查覆盖中文、空格、表情、嵌套源码、源模板不变及取消后的核对。

这只验证文件系统创建能力；本机 Hvigor 26 对中文工程根路径的拒绝仍是独立的 SDK 限制，不能据此宣布中文路径工程可构建。新一轮三平台 CI 用于验证异步复制改动。
