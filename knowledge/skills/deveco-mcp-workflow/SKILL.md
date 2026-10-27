---
name: deveco-mcp-workflow
description: 使用 DevEco MCP 进行鸿蒙开发、构建部署、测试和排错；选择工具、复用 UI 路径并核验结果。适用于鸿蒙开发任务或不确定工具调用顺序时。
---

# DevEco MCP 工作流

优先使用 MCP 已有能力；具体参数以当前工具定义为准，不重复拼装同一套 SDK／HDC 流程。

## 选工具

| 目标 | 路线 |
| --- | --- |
| 环境或入口不明 | `doctor project=<root>`；应用入口、卡片声明用 `project action=entries`，声明不等于运行验证 |
| 查阅专项指导 | 已知 Skill 名称直接 `skills action=read name=...`，不确定时先 `list`；只读取当前任务需要的指导和参考文件 |
| 修改 ArkTS／ArkUI | 读取 `hmos-arkui-develop-skill`；只需编译用 `project action=build`，需要设备验证用 `run action=build_run`。两者自带改动文件检查，无需先 `code check` |
| 反复部署 | 继续 `run build_run`，由工具判断热更新、完整部署或重启；查看 `path` 和原因，不承诺固定耗时。强制完整部署用 `run_mode=full` |
| 手动热更新 | 已有热更新基线时，用 `hot_reload action=apply` 打补丁，`reset` 重装基线包；日常部署仍用 `run build_run` 自动判断 |
| 工程测试 | 读取 `hmos-test-design` → `project action=test kind=local/instrument`。Instrument 会卸载应用并清数据，获得该范围授权后才传 `allow_data_reset=true` |
| UI 操作与检查 | 未知页面先 `ui observe`；已知路径用 `ui act steps=[...]`，按 `after` 决定是否继续观察，用 `ui assert` 检查目标。需要重复进入页面时，按下节复用 Flow |
| 多步验收 | 交互检查用 `ui test_start → test_step → review → test_finish`；工程已有验证计划用 `project action=verify plan=...`。`review` 先取图，实际审查后再提交结论 |
| 编译错误或崩溃 | 按诊断与 `hint` 修复后重跑；启动失败先看 `crash.source`，其他崩溃读取 `hmos-runtime-fix-skill`，用 `diagnose action=crash project=<root> bundle=...` 定位 |
| API 与文档 | `knowledge search/read`；精确签名用 `code action=lsp op=hover/definition` 查工程 SDK。C/C++ 先 `project build task=compileNative`；云端查询用 `knowledge source=cloud` |
| 专项检查 | `ui visual/layout/perf/form` 分别用于画面对比、布局、滑动性能、卡片宿主；`device` 处理日志、文件和数据库。缺签名用 `auth/sign`，模拟器用 `emulator` |

## 复用 UI 路径

重复进入同一页面、修复后重测或部署后返回目标页时，**先查已有 Flow，再决定是否手动走路径**，不必等用户说“录制”。

1. `ui_flow action=list project=<root>`，对匹配目标的路径 `show id=<id>`。核对应用、步骤、最终断言、变量及起点：`restart` 会重启应用，`attach` 从当前页面继续。已有名字不保证适合当前界面；只执行本次任务授权的操作。
2. 已有合适路径：单独进入用 `ui_flow action=replay project=<root> target=<device> id=<id>`；部署后返回用 `run action=build_run ... then_flow=<id>`，路径须适合应用启动后的页面。输入值按 `show` 的要求传 `variables` 或 `flow_variables`。
3. 没有可复用路径：首次执行已知步骤时，加最终断言和 `save_flow`；保存默认按应用启动页回放，应从该页开始记录完整路径。例子中的选择器须替换为实际观察到的控件：

   ```text
   ui action=act target=<device>
     steps=[{op:"click",selector:{key:"settings"}}]
     assert={visible:{key:"settings-page"}}
     save_flow={project:"<root>",id:"open-settings"}
   ```

   需要边探索边操作时，用 `ui_flow record → ui act → ui_flow stop(assert=...)`；这只记录通过 `ui act` 发出的可回放动作。检查返回的保存结果、变量和未保存动作；不完整的路径不能直接当作完整回归。
4. 等待回放任务完成并检查断言。`then_flow` 失败不会让部署失败，必须检查 `flow.passed`；失败后先观察当前页面，再修复路径。`snapshot=true` 首次保存基线，后续才做画面对比。

Flow 保存在工程 `.arkpilot/flows/`，一次性操作无需保存；不把输入明文写入 Flow。

## 执行与结论

- `project` 传工程根目录绝对路径；沿用用户已指定的设备、产品和团队。遇到歧义且没有既定选择时再询问，不自行换对象。
- 耗时调用返回 `job_id` 后用 `job action=wait` 等待（每次不超过 55000 ms），不重复发起。`needs_input` 先看 `job status`，核实已发生的操作后再决定是否恢复。
- 批量 UI 可能只完成一部分；按 `stopped_at`／`failed_step` 和当前页面继续，不从头盲目重放。
- 摘要不足时按返回的 `read_full`／制品 ID 用 `job action=read` 读取，`line/limit` 翻页、`grep` 过滤；本地文档按 `next.offset` 翻页。运行制品通常保留 24 小时。
- API 以工程 SDK 声明和匹配版本的官方文档为准，编译成功只证明编译通过。云端“官方”标签仅说明正文匹配本地文档，不证明发布者身份；其他平台接口和社区示例须核实。
- 构建、启动、控件断言、画面对比、工程测试分别报告。无崩溃或页面出现不能证明业务正确；零用例、跳过、缺数据和环境阻塞不能算通过。
