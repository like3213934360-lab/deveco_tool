# 本包对 d2c-fast 的改动逐条对照

上游来源：DevEco Code `0.2.0-release`（提交 `9535f0f5`）`packages/opencode/resources/skills/d2c-fast/`。

`scripts/pixso-arkts/call-pixso-arkts.mjs` 和 `scripts/pixso-arkts/pixso-arkts.js` 逐字节照搬，
未做任何修改。生成器只依赖 Node 内置模块，不联网、不需要 npm 依赖。

改动只发生在 `SKILL.md` 与 `references/workflow.md`，分四类。

## 一、宿主绑定改写

| # | 上游 | 本包 | 为什么 |
|---|---|---|---|
| R1 | `DevEco Code TodoList 标题` | `执行计划标题` | 标题文本本身是阶段契约，逐字保留；承载它的工具不是 |
| R1 | 「DevEco Code 当前可用的 ArkTS/HarmonyOS 代码质量 skill」+「无可用时暂停询问」 | 绑定到 `arkts-grammar-standards` + `arkts-error-fixes` + `arkts_check` | 本包一定具备这三项，门禁失去意义 |
| R2 | TodoList 由宿主工具承载，且要求「不得改写」 | 宿主的任务跟踪能力；没有时把 10 行状态表输出到回复 | 逐字要求约束的是标题文本，不是工具 |
| R3 | `task` 工具委托 `general` 子 agent，4 处 yaml 块 + 2 条全局规则 + 4 处散文 | 「宿主有委派能力就委派，没有就主 agent 按同一模板顺序执行」 | 委派能力是宿主特性。第 16 章四个模板逐字保留——它们是产物契约，不是宿主绑定 |
| R4 | 「DevEco 手机模拟器」+ 只说「运行截图」不给获取方式 | 新增第 13.0 节，给出 `hdc_log` → `build_project` → `start_app` → `perform_ui_action` 截图 → `get_app_ui_tree` 的完整配方；真机与模拟器一视同仁 | 上游面向自己的工具集，本包必须落到实物 |
| R5 | 三种输入方式并列 | 显式分成 Mode A（需 Pixso MCP）与 Mode B（全离线），并声明两者对等 | 只有开发者提供 DSL 那条不依赖 Pixso MCP；上游规则里已半承认这点，这里挑明 |
| R6 | 产物根写死 `.deveco/d2c-fast/`（73 处） | `{D2C_OUT_ROOT}`，默认值不变 | 让调用方可改写 |

R4 还补了一条上游没有的能力：`get_app_ui_tree` 提供组件 bounds，所以顶部重叠可以数值判定，
而不只是观察截图像素带。有结构证据时优先采信它。

`ui-reconstruction-score` 的 `ui_score.py` 被列为第 13.6 节 edge-band 审计的数值后盾——它能
确定性算出上下边带差异，不需要任何模型。

## 二、补齐上游缺失的门禁 fallback

上游有六处需要向用户提问的门禁，**没有一处配了「宿主无法提问时怎么办」**。这与同一仓库的
`goal.txt` 形成对比——后者每个门禁都写了 fallback。逐条补齐如下：

| 门禁 | 补的 fallback | 默认方向 |
|---|---|---|
| 本地资源路径确认 | 未解析的 `imageId -> 期望路径` 清单写入 `<runDir>/asset-resolution-required.md`，停止 | **停** |
| 阶段所需 skill 缺失 | 记入 `skill-invocation-ledger.json`，停在当前阶段并在最终报告列出 | **停** |
| 委派能力不可用 | 主 agent 按同一模板执行 | 继续 |
| 非沉浸实现确认 | 默认沉浸；确实无法沉浸则判 `major` 并记录，不停止 | 继续 |
| 阶段 4 功能规格确认 | 按系统 UI 策略默认值推进，推断不出的写进「待确认」小节并在总结里列出。`drawStatusBar` 恒为 `false`（第 2 章已明令不得画假系统栏，无可选空间） | 继续 |
| HDS 降级批准 | 拿不到批准**不得降级**；证据写入 `<runDir>/hds-fallback-evidence.md`，判 `major`，允许进阶段 10 但列为未完成 | 继续但标 major |

分界线是：**安全类门禁默认停，实现取舍类门禁默认继续并留痕。** 前两条一旦默认继续，工作流会
在缺资源或缺 skill 的情况下产出看似成功的结果。

另有两处宿主能力缺失的处置：

- **宿主无法读图** —— 13.4 / 13.5 / 13.6 / 13.8 判 `INCONCLUSIVE`，**不得判 PASS**。源码审计可以
  单独判定失败，但不能单独判定通过。这是上游「不得用代码审查替代运行截图」的直接推论。

## 三、修上游文档缺陷

| 位置 | 缺陷 | 处置 |
|---|---|---|
| 首帧稳定补全一句 | 两个工具名被清洗后留下空缺：「、截图和　　前」 | 补为「运行截图和结构快照采集前」 |
| edge-band 审计一句 | 句尾被清洗：「审计不得依赖阶段 10 。」 | 补为「阶段 10 的总结结论」 |
| 阶段 10 总结清单一项 | 整条只剩「- 　结果。」 | 补为「系统 UI 沉浸、视口边界 edge-band、顶部重叠、安全区单位和坐标归一化审计结果」 |
| `inputs-manifest.json` 示例、阶段 2 命令示例 | 硬编码 `.deveco/d2c-fast/source/...` 等非 run 路径，与同文件规定的 `<d2cFastRunDir>/...` 冲突 | 统一改为 `<d2cFastRunDir>/...` |

三处清洗残留的补法都是按上下文推断的，不是上游原文。

## 四、未改动的部分

- 第 16 章四个子 agent prompt 模板 —— 逐字保留。
- 10 个执行计划标题 —— 逐字保留（后文按这些标题指代阶段）。
- 所有安全规则：50MB DSL 上限、10MB 图片上限、prompt 注入校验、DSL 文本视为不可信输入、
  阶段 7 前复核、禁止占位图替代。
- 全部系统 UI 契约：背景/前景分层、`expandSafeArea(TOP)` 的真实语义、安全区单位契约、
  单一消费者规则、坐标归一化。这些是这条工作流最有价值的部分，一字未动。

## 依赖闭合

阶段 3/5/6/8/9 依赖的六个 sibling skill —— `repo-understand-skill`、
`arkui-component-best-practices`、`solution-design`、`responsive-layout-generator`、
`arkts-logic-completer`、`arkui2hds` —— **本包全部具备**。加上 R1 把「未命名质量 skill」绑定到
实物，这条工作流的 skill 依赖 100% 闭合，不存在指向包外的引用。
