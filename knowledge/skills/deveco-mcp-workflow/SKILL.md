---
name: deveco-mcp-workflow
description: How to drive HarmonyOS development with the deveco MCP tools (build, run, UI testing, crash diagnosis, signing, emulator, hot reload, knowledge). Load at the start of HarmonyOS/ArkTS work in a session, or when unsure which deveco tool to call.
---

# deveco MCP 工作流

deveco MCP 提供 15 个工具。按下面的顺序使用，避免自己拼 `hdc` / `hvigorw` 命令。

## 基本约定

- 所有 `project` 参数都传**工程根目录的绝对路径**（包含 `build-profile.json5`）。
- 构建、部署等耗时操作会返回 `job_id`：用 `job action=wait job_id=...` 等待，不要重复发起同一个操作。
- 失败结果都带 `code`、`category` 和 `hint`，先按 `hint` 处理。状态为 `needs_input` 的任务，先 `job action=status` 看清楚再决定是否 `resume force=true`。
- 连接多台设备时（返回 `DEVICE_AMBIGUOUS`，里面列出每台设备的名称、真机/模拟器、是否匹配工程），**先问用户部署到哪台**，不要自己挑；得到答复后传 `target=<序列号或设备名>`。
- 账号有多个开发者团队时（返回 `TEAM_AMBIGUOUS`），同样先问用户用哪个团队，再传 `team=<团队 id>`。
- 参数名写错或传给了不使用它的动作，会直接报错且不执行；按错误里的参数名改正后再调用。`wait` 超过 55000 会自动按 55000 处理（低于宿主常见的 60 秒请求超时），任务没完成就继续 `job action=wait`。

## 常用流程

| 场景 | 调用顺序 |
| --- | --- |
| 环境不明 | `doctor project=<root>`：工具链、SDK、设备、兼容性、登录状态 |
| 写/改 ArkTS | 先加载 `hmos-arkui-develop-skill` → 修改 → 直接 `run action=build_run`（或 `project action=build`）。构建前会自动静态检查上次以来改动的文件，**不要再单独调 `code action=check`**；只想检查、不构建时才用它 |
| 编译报错 | `project action=build` 返回全部编译错误（错误码、文件、行号、原因）→ 按错误码查 `knowledge action=search` 或 `diagnose action=build` → 修复 → 重新 check/build。改了 `oh-package.json5` 后，构建会自动先装依赖 |
| 部署运行 | `run action=build_run project=<root>`：构建、安装、启动，返回 `smoke: PASS / FAIL_CRASH / FAIL_BLANK` |
| 改代码反复调 | 每次改完直接 `run action=build_run`。从第二次部署起，只改了入口模块的 .ets/.ts 时会自动热修复正在运行的应用并重启（约 6–10 秒，`path=hot_reload`），其他改动自动走完整部署（`path=full`，`fallback_reason` 写明原因）；什么都没改时只重启（`path=relaunch`）。需要强制完整部署时传 `run_mode=full` |
| 部署后进到正在改的页面 | 路径存成 flow 后，`run action=build_run then_flow=<id>`，部署完自动走到该页面 |
| 界面回归 | `ui action=visual project=<root> name=<名称>`：第一次保存基准截图，之后对比，返回变化比例、变化区域和红框标注图（`diff_artifact`）；`ui_flow action=replay snapshot=true` 在回放到页面后自动对比 |
| 一多布局 | `ui action=layout` 检查当前页面（超出屏幕、可点区域重叠、文字被裁切或被挤没、点击区域过小）；`ui action=layout project=<root> forms=["foldable","widefold","triplefold"]` 在三种折叠形态模拟器上逐个折叠状态检查（任务，模拟器自动创建、用完关闭；先构建好） |
| 滑动性能 | `ui action=perf bundle=<包名>`：在当前页面上下滑动并逐帧统计，返回平均帧率、帧耗时 p50/p95/最大值、卡顿帧数、结论（smooth/minor_jank/janky）和内存变化 |
| 验证界面 | `ui act` 的返回里自带 `after`（新出现/消失的控件、是否换页），一般不用再 `observe`；需要看图时才 `ui observe`；用 `ui assert` 判定结果 |
| 走多步路径 | **一次调用**：`ui act steps=[{op:"click",selector:{text:"工具"}},{op:"click",selector:{text:"动态锁屏"}}] assert={visible:{text:"选择壁纸"}}`。每步自动等待控件出现，失败时返回失败的那一步和当前可见控件 |
| 多步 UI 测试 | `ui test_start plan=...` → 每步 `ui test_step` → 需要看图时 `ui review` → `ui test_finish` → `ui test_export` |
| 可复用的操作路径 | 同一条路径要反复走（每次部署后都要进同一个页面）时，在上面的 `steps` 调用里加 `save_flow={project,id}` 存下来（从应用首页开始走），以后用 `ui_flow action=replay`；也可以 `ui_flow action=record` → `ui act` … → `ui_flow action=stop` 并附最终断言 |
| 闪退/崩溃/白屏 | `run build_run` 启动就崩时，返回的 `crash` 里已有错误类型、工程内出错的文件和行（`source`，附前后几行代码）和可能原因，直接按它改；其他情况加载 `hmos-runtime-fix-skill`，`diagnose action=crash bundle=... project=<root> since_minutes=10`（带 `project` 才会定位到源码） |
| 查 API/文档 | `knowledge action=search`（离线官方文档）；精确签名用 `code action=lsp op=hover symbol=...`；需要最新云端答案用 `knowledge source=cloud`（需 `auth provider=codegenie`，结果分段标注官方/社区）；有冲突见下文“资料冲突时以谁为准” |
| 真机签名 | `auth action=login provider=developer` → `sign action=auto project=<root>`（账号有多个团队时先问用户用哪个，传 `team`）→ `run action=build_run` |
| 模拟器 | `emulator action=list` / `start` / `stop`；`scenario` 模拟电量、GPS、旋转、折叠等 |
| 数据库/文件 | `device action=sqlite bundle=... db=<name>`（调试包 RDB，默认只读）；`device send/recv` |
| C/C++ | `project action=build task=compileNative` 生成编译数据库 → `code action=lsp language=cpp` |

## 原则

- 用 `ui assert` 或 `ui test_*` 判定结果，截图只作辅助证据。
- 修复崩溃后必须在设备上复现一遍，确认 `diagnose` 没有新报告。
- 不确定的 ArkTS/ArkUI API 先查（`hmos-arkui-develop-skill` 的 quick-apis、`knowledge`、`code lsp`），不要凭记忆写。

## 资料冲突时以谁为准

本地知识库、云端（CodeGenie）和社区文章的说法可能互相矛盾。按下面的顺序取信：

1. **工程 SDK 与编译结果**：接口名、参数、返回值、`@since` 版本以 `code action=lsp op=hover/definition` 查到的 SDK 声明为准；能编译通过的写法就是对的。
2. **官方文档**：本地知识库结果（`origin=official`）和云端结果中标为【官方文档】的段落。云端段落是按正文和本地官方文档比对来判定的，`local_doc` 就是包含这段文字的那篇本地文档，可以用 `knowledge action=read id=<local_doc>` 读全文。两者不一致时，选与工程 API 级别对应、更新的那份。标为【官方文档·非 ArkTS 平台】的是华为给 Android/Java（HMS Core）或仓颉的官方文档，不能当作 ArkTS 接口依据。
3. **社区文章 / 未确认来源**：云端结果中标为【社区文章】或【未确认来源】的段落。只能作为思路参考，不能作为 API 规范；其中的接口写法必须先按第 1 条核实。

发现冲突时，在回答中说明采用了哪个来源、为什么。

云端结果的正文按"官方优先"排列，内容多时部分段落只给摘录或不在正文里（`sources[].shown` 为 `excerpt` / `omitted`），但**不会丢**：完整原文（全部段落、不截断）保存在 `full_artifact`，用 `job action=read artifact_id=<full_artifact> line=<sources[].line>` 读指定段落，或加 `grep=` 搜索。本地文档较长时用 `knowledge action=read` 的 `next.offset` 翻页读完。
