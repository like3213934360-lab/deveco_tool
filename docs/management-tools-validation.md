# 项目、脚本和服务管理工具验证

验证日期：2026-09-05。范围是 `deveco_script_catalog`、`deveco_script`、
`switch_cwd`、`init_project_path`、`deveco_doctor`、`deveco_restart`、`document_validate`，
以及这些入口实际调用的脚本、项目上下文和后台进程。

## 修复内容

| 工具 | 已处理的问题 |
| --- | --- |
| `deveco_script_catalog` | 对外文件路径统一使用 `/`；保留 7 个白名单脚本及其官方来源。 |
| `deveco_script` | 模板创建移除全局 CLI 和 shell 路径依赖；SDK/HDC 共用 Studio、CLT 和显式路径配置；脚本运行期间固定项目路径。 |
| `switch_cwd` / `init_project_path` | 启动时读取 `PROJECT_PATH`；排队调用保留调用时选择的项目；后台项目绑定失败时阻止后续业务调用，并使下次绑定重新执行。 |
| `deveco_doctor` | 探测当前后台，避免重启后继续报告旧的成功状态；保留后台错误信息；认证文件不可读时仍返回其余诊断。CLI 诊断结束前清理后台进程。 |
| `deveco_restart` | 按进程树清理 CodeGenie 包装进程和原生后台；旧握手或超时清理不得覆盖新实例状态；项目绑定超时也触发恢复。 |
| `document_validate` | 支持 UTF-8 BOM、Windows 换行、合法的 ATX 缩进和结尾标记，以及中文任务阶段标题。 |

设备脚本另外修复了以下可导致误诊的问题：

- HDC 返回退出码 0、但输出失败信息时，不能报告成功。
- Faultlogger 探测严格匹配包名和时间窗口，不再退回其他应用或过期记录。
- 使用带毫秒后缀的 Faultlogger 列表参数，避免列表名称和实际文件名不一致。
- 区分日历时间与 epoch 时间；使用设备时钟、时区进行时间筛选。
- 下载先写独立临时目录，确认成功后再替换目标文件，避免把旧文件当成本次下载结果。
- 日志采集超时、不完整时返回失败，避免据此断言没有崩溃。

官方 `skills/` 镜像未修改，适配层及来源说明位于 `src/script-adapters/` 和 `provenance/SOURCES.md`。

## 已执行验证

- macOS：运行全量 `npm test`，包括官方 Skill 摘要、既有 LSP/进程恢复和管理工具回归。
- Node 24：单独运行管理工具和文档校验回归。
- 当前仓库源码启动独立 MCP：七个工具均可调用；完成项目切换、兼容别名、文档校验、后台重启和重新探测。
- 已连接真机：完成 HILOG 采集、Faultlogger 探测、真实日志下载、两种解析入口分析；成功识别设备中的 `TypeError` 日志。
- 新项目模板：在中文、空格和 shell 特殊字符目录中成功创建；在 Hvigor 支持的含空格目录中构建成功。模板未配置签名，未安装这个测试应用。
- 回归覆盖 CLT、显式 HDC 路径、项目切换并发、绑定拒绝/超时、后台进程不响应终止、失效诊断缓存、旧下载文件和故障返回码。

复现自动化检查：

```bash
npm test
node --test --test-concurrency=1 test/management.test.mjs test/document-validate.test.mjs
```

## 兼容性边界

1. 无外部依赖的目录和文档工具使用 Node 跨平台 API。SDK、设备、语言服务功能仍要求目标系统有对应的 DevEco SDK、HDC 和官方后台二进制。
2. 工程切换不要求模块名为 `entry`；它按现有 Harmony 工程标记识别目录。新建模板仍使用官方模板本身的工程结构。
3. Hvigor 实测拒绝中文和 `&` 路径，错误码为 `00306003`。MCP 能创建该目录，并不意味着官方构建器接受它；需要构建时请使用 Hvigor 支持的路径。
4. 设备权限不足、HDC 不可用或多个设备未指定目标时，返回可诊断错误。不能把这些情况解释为工具已经成功工作。
5. 已配置 Linux 全量测试、macOS/Windows 管理工具测试的 Node 22/24 CI 矩阵。此次本地执行环境为 macOS；没有实际执行 Windows/Linux 主机或其真机链路。Windows CI 中 POSIX 模拟 HDC 用例会跳过，不能据此宣称 Windows 真机已验证。
6. 这是本次范围内的修复和验证结果，不是“任意操作系统、任意工程都无缺陷”的保证。更新仓库后需要重新连接 MCP，才能加载新的网关代码；`deveco_restart` 只重置子服务。
