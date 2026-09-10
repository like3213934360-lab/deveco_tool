# DevEco CLI ArkTS 检查器适配记录

审阅范围：CLI `08c2f57ffbe83c817d64a728a17971872dd9ddcf` → `a71f93d73941aaa0dbf581918cbd5828014e6e88`。候选检查器 `src/resources/arkts-check.cjs` 为 168370 字节，SHA-256 `9ca4518c5f0db2322b70bfd48f2858b8b7d4ac030d5c196422a5f197f66116fb`。本记录冻结于来源接受之前；实际接受状态以 `provenance/upstream-lock.json` 和来源接受回执为准。

## 实现和范围

原生 `arkts_check` 使用选定工程、产品和模块的真实 SDK 子进程，声明文件与项目外文件在派发前拒绝，报告有大小、数量、严重程度和退出状态校验。检查之后，内置 `skill_workflow` 提供修复指导，由连接 MCP 的 AI 修改源码，再执行新鲜检查和构建；没有客户端 Skill 安装，也不声称 `--fix` 已作为原生检查器自动改文件参数提供。

| 上游检查组 | 当前适配 | 验收范围 |
| --- | --- | --- |
| SDK 类型/规则及 API 版本 | 原生 SDK 子进程；保留产品原始版本字符串 | API 12/23/当前版本兼容性告警真实复验通过 |
| 系统资源、应用资源 | SDK 系统资源表和所选模块/AppScope 资源索引；AST 只判断实际 `$r()` 字面量调用 | 缺失资源、注释/字符串排除、修复后复检 |
| V1/V2 装饰器、Param/Require、函数类型字段 | SDK AST 装饰器及成员检查，BuilderParam/Watch 两版本均可用 | 可移植回归及真实 SDK struct 样例 |
| 内置组件重名、Entry 根节点、UI-only 语句 | 读取当前 SDK 组件目录；区分真实 UI 构建体与事件回调 | 回归；真实 SDK 验证单行回调中的普通变量不误报 |
| NavDestination 重复注册 | 加载 SDK ArkUI 解析配置，同一调用链检查，不合并独立 Navigation | 含组件内容块和多层属性链的真实 SDK 样例通过 |
| 页面登记与 Entry 数量 | 读取实际模块 pages profile；统计顶层 Entry struct | 自定义 profile、改名模块、Entry 删除后失败与恢复 |
| 动态路由 schema、页面文件、导出 Builder | 读取模块实际 routerMap profile；路径不得越界；Builder 由 AST 确认 | 错键、缺失页面/Builder、修复后真实 SDK 复检 |
| 资源目录、modelVersion | 所选模块实际目录和 JSON5，异常不会静默忽略 | 错误配置与修复样例 |
| 权限名称、reason、usedScene | 当前 SDK PermissionDefinitions，自定义权限，理由资源；usedScene 缺失为警告 | 无效权限、缺 reason、缺资源及修复；SDK 数据缺失明确 unavailable |
| ObservedV2 字段类型 | SDK 符号绑定解析跨文件导入、类型别名；匹配上游 State/Prop/Provide/Consume 范围 | 真实 SDK V1 错误→V2 修复通过；数组和无关同名类不据名称推断 |
| V2 普通字段和初始化参数 | 绑定实际组件声明，只检查参数对象顶层的普通字段和 Local 字段；保留 V1 回调能力 | 跨文件导入别名错误→Param 修复通过；可移植回归覆盖重导出、重名、嵌套对象和变量遮蔽 |
| hideNavBar 隐藏内容 | SDK EtsComponent AST 关联 Navigation 内容和属性链 | 隐藏非空内容报错，改 hideTitleBar、空内容、false 参数均通过 |
| NavDestination 分支根节点 | 检查实际注册的 Builder 各分支，解析本地或导入组件的 build 根节点 | 一个合法分支不会掩盖另一个错误分支；修复与重复注册真实 SDK 样例通过 |
| AppStorage 与 ObservedV2 混用 | SDK 绑定解析泛型与实例类型；识别变量、this 字段，排除被遮蔽的 AppStorage | 导入别名的真实实例报错→导入 Kit 并使用 AppStorageV2 修复通过 |

上述适配对应候选实际启用的 18 组项目检查。跨文件符号程序只读取已经过项目范围、单文件 8 MiB、合计 64 MiB 限制的应用 AST，不加载外部库声明或文件系统依赖。相对导入、项目模块包入口和重导出可解析；不能解析的外部组件根节点保持未知，不会把项目中另一个同名组件当作它。此范围不能扩展成所有第三方库语义均已验证的声明。

上游 `validateObjectLinkTypes` 本身未接入 `computeProjectDiagnostics`，注释明确记录了真实合法工程的误报。本次不把这个未启用规则计作上游已提供的检查，也不为了数量添加会误报的规则。

## 真实 SDK 发现的上游配置差异

候选把 `main.projectConfig.projectRootPath` 指向 SDK 的 ets 目录，并将 `originCompatibleSdkVersion` 改写为解析后的整数。本机 SDK 26 的真实样例发现：前者使 API 12 调用 API 13 的 `TabsController.setTabBarTranslate` 时告警消失；仅恢复项目根目录后，后者又让 API 23 工程产生不该有的告警。因此原生适配保留项目根目录与原始产品版本字符串，而不照搬这两处配置。

配置失败原始证据保存在持久化验收目录 `native-7-checker-a71-20260910-1` 和 `native-7-checker-a71-20260910-2`，不会覆盖成通过结果。第 4、5 轮发现验收修复样例自身缺少 Kit 导入和结构闭合，也保留失败记录。修正后第 6 轮 **21/21** 通过，同一身份的 SDK 集成 **26/26**、通用 stdio 内置工作流 **35/35** 通过；运行时摘要 `7777d47a…`、编译摘要 `077ef53f…`。这些是该候选的本机证据，正式来源接受和发布门禁尚未完成。

## 其余候选文件

README/SKILL 新增的检查时机和参数映射至 MCP 内置工作流；独立 CLI 的终端渲染、遥测和客户端 Skill 安装不成为 MCP 运行依赖。上游开发用 ESLint 忽略规则只作用于它自己的生成代码。旧子 MCP 的 LSP 退出环境变量属于已移除实现；原生 LSP 使用自己的有界关闭与进程回收。原生 CLI 已补充 `--version`、`-v`、`-V`，实测在配置文件不存在、未初始化 SDK/状态目录时输出正确版本，额外参数拒绝。模板新增 `.cache` 忽略的原因是上游在工程内存放检查器缓存；原生检查器缓存属于 MCP 状态目录中的受控子进程，并在结束后回收，因此无需把该工程目录约定复制到原生模板。

逐操作能力证据及来源门禁关闭前，不得宣称完全覆盖上游或发布正式版本。
