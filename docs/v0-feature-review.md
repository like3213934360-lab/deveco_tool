# v0.4 独有功能评估

评估对象：`v0.4-final` 标签里 v1.0 没有的能力（对照 `src/core/contracts.ts` 的 37 个工具和 `src/services/*`）。
评估时间：第一阶段（上游补齐）完成后。当前对齐结果：上游 81 项里，60 项完整覆盖，3 项由 CLI 子命令提供，18 项由宿主自身提供，`partial` 和 `unmapped` 都是 0。

## 评估标准

三条都满足才接入：

| 代号 | 标准 |
| --- | --- |
| A | **宿主做不到**：宿主 AI 只靠通用能力（读写文件、shell、看图）没法可靠完成，或者成本高很多 |
| B | **实际常用**：鸿蒙应用日常开发、调试、测试里会反复用到 |
| C | **维护成本低**：复用现有通道（hdc / uitest agent / hvigor / AGC API），不引入新依赖、常驻进程或定时器，代码量可控 |

## 结论

| v0.4 能力 | A | B | C | 结论 | v1.0 落点 |
| --- | :-: | :-: | :-: | --- | --- |
| 鼠标操作（点击/双击/长按/移动/滚轮/拖拽，`Driver.mouse*`） | ✅ | ✅（2in1、平板） | ✅ 复用 uitest agent RPC | **加入** | `ui act op=mouse_*` |
| 组合键（最多 3 键，`uiInput keyEvent`） | ✅ | ✅（复制粘贴、全选、快捷键） | ✅ 一条命令 | **加入** | `ui act op=key keys=[...]` |
| 操作前后进度证据（`ui-progress`：比较前后界面判断是否变化） | ✅ 宿主要自己截两次图对比，成本高、容易误判“点击没生效” | ✅ | ✅ 比较控件树摘要，不需要解码 JPEG | **加入**（改用控件树签名，不引入 jpeg-js） | `ui act verify_change=true` |
| 崩溃时间窗补采（按时间窗读 faultlog、生产设备读取） | ✅ | ✅ | ✅ 现有 `faultlog` 通道加时间过滤 | **加入** | `diagnose crash since_minutes` |
| 启动后白屏/黑屏判定（`startup-check`，上游 `run` 也有 `FAIL_BLANK`） | ✅ | ✅ 每次部署都会用 | ✅ 128px PNG + 内置解码，不依赖第三方库 | **已加入**（第一阶段审计时发现） | `run` 结果里的 `launch.smoke` |
| 证书/Profile 逐项管理（`certificate_create`、`profile_create/delete`） | ✅ | △ 团队签名场景才用 | ✅ 复用 AGC 客户端 | **加入** | `sign` |
| 单独生成密钥对和 CSR（`keypair`、`csr`） | △ 宿主可以直接调 hap-sign-tool，但参数多 | △ 发布签名才用 | ✅ 调用 SDK 自带的签名工具 | **加入** | `sign action=keypair/csr` |
| 签名配置写入（`configure`） | — | — | — | 已由 `sign auto` 覆盖 | — |
| 应用路由与 URI 跳转（`routes`、`navigation`：解析 module.json5 skills，用 `aa start -U` 跳转） | △ 宿主能读 manifest，也能用 `device shell` 以外的方式启动 | △ 深链测试时才用 | ✅ | **暂不加入**，有需求时并入 `run launch uri=` | — |
| 结构化 UI 日志流（`ui-log-stream`、`ui-test-continuous-log`） | — | — | — | 已由 `ui test_step` 按步骤截取日志覆盖 | `ui test_log` |
| `ui_review` / `ui_test` / `verify_ui` | — | — | — | 已由第一阶段的测试会话覆盖（宿主驱动） | `ui test_*` / `review` |
| `domain_acceptance`、release gate、provenance 证据链 | ✖ | ✖ 个人或小团队用不上 | ✖ 维护成本高 | **不加入** | — |
| `workflow_catalog`、`domain_recipe`、`skill_workflow` | ✖ 工具描述 + Prompts + Skills 已覆盖 | — | ✖ | **不加入** | MCP prompts / skills |
| Worker 线程、CPU 池（`cpu-pool`、`cpu-worker`） | ✖ | — | ✖ 与单进程、零空闲开销冲突 | **不加入** | — |
| LangGraph / checkpointer / `maintenance restart` / upgrade / quiescence | ✖ | — | ✖ | **不加入**，由 `core/jobs` 的意图/回执模型替代 | `job` |
| `storage` 生命周期、request-log、runtime-samples、trace | ✖ | ✖ | ✖ | **不加入**，制品有上限并自动清理 | — |
| 旧版 UI 代理、`ui_tap`、兼容别名、`switch_cwd` | ✖ 已允许不兼容升级 | — | — | **不加入** | `ui` / 显式传 `project` |
| Windows 专用引导（`windows-bootstrap`、`windows-job`） | — | — | — | v1.0 的跨平台进程管理已覆盖 | `core/proc` |

图例：✅ 满足，△ 部分满足，✖ 不满足，— 不适用。

## 实施约束

- 全部并入已有工具的 action 或参数，不新增顶层工具（v1.0.1 起 15 个工具全部默认开启）。
- 鼠标和组合键复用已有的 uitest agent 连接（`Driver.*` RPC）以及 `uiInput keyEvent`，不增加新进程。
- `verify_change` 比较的是操作前后控件树摘要（类型、文本、位置）的哈希，并按页面稳定性等待，不解码截图。
- 崩溃补采只在 `diagnose` 调用时执行，不做后台轮询。
- 签名相关代码只在第一次调用 `sign` 时加载。
