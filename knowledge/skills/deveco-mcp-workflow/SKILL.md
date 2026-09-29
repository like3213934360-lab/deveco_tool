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
- 连接多台设备时，给设备相关工具传 `target=<序列号>`（`device action=list` 查看）。

## 常用流程

| 场景 | 调用顺序 |
| --- | --- |
| 环境不明 | `doctor project=<root>`：工具链、SDK、设备、兼容性、登录状态 |
| 写/改 ArkTS | 先加载 `hmos-arkui-develop-skill` → 修改 → `code action=check files=[...]` → `project action=build` |
| 编译报错 | `project action=build` 返回结构化错误 → 按错误码查 `knowledge action=search` 或 `diagnose action=build` → 修复 → 重新 check/build |
| 部署运行 | `run action=build_run project=<root>`：构建、安装、启动，返回 `smoke: PASS / FAIL_CRASH / FAIL_BLANK` |
| 改 UI 细节反复调 | `hot_reload action=apply`：约 3 秒生效，应用不重启；结束后 `hot_reload action=reset` |
| 验证界面 | `ui observe` 看屏幕 → `ui act`（`verify_change=true` 确认操作生效）→ `ui assert` 判定结果 |
| 多步 UI 测试 | `ui test_start plan=...` → 每步 `ui test_step` → 需要看图时 `ui review` → `ui test_finish` → `ui test_export` |
| 可复用的操作路径 | `ui_flow action=record` → `ui act` … → `ui_flow action=stop` 并附最终断言 → 以后 `ui_flow action=replay` |
| 闪退/崩溃/白屏 | 加载 `hmos-runtime-fix-skill`；`diagnose action=crash bundle=... since_minutes=10` |
| 查 API/文档 | `knowledge action=search`（离线官方文档）；精确签名用 `code action=lsp op=hover symbol=...`；需要最新云端答案用 `knowledge source=cloud`（需 `auth provider=codegenie`，结果分段标注官方/社区）；有冲突见下文“资料冲突时以谁为准” |
| 真机签名 | `auth action=login provider=developer` → `sign action=auto project=<root>` → `run action=build_run` |
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
2. **官方文档**：本地知识库结果（`origin=official`）和云端结果中标为【官方文档】的段落。两者不一致时，选与工程 API 级别对应、更新的那份；云端官方段落带 `local_doc` 时，用 `knowledge action=read id=<local_doc>` 读本地全文核对。
3. **社区文章**：云端结果中标为【社区文章】的段落。只能作为思路参考，不能作为 API 规范；其中的接口写法必须先按第 1 条核实。

发现冲突时，在回答中说明采用了哪个来源、为什么。
