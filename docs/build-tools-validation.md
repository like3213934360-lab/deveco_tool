本次修复覆盖 `project_sync`、`build_project`、`start_app`、`apply_changes`、`hot_reload`、`app_signature` 这一组工具的审查结果，重点修复 5 个已复现的包装层缺陷。官方 CLI 版本保持为 1.3.1，没有新增运行时依赖或工具入口。

| 已复现问题 | 修复后行为 | 回归依据 |
| --- | --- | --- |
| 单模块工程的模块发现调用 `run --skip-build`，先部署后报无模块 | 从工程配置和模块类型读取候选，发现过程不调用 CLI；三个入口都能省略唯一模块 | 单模块、HAR 排除、共享模块、多模块拒绝、无效 manifest；记录 CLI 次数，确认没有额外部署 |
| `App installed successfully` 掩盖 Ability 启动失败 | 要求明确的启动完成输出，或官方“没有 Ability 需要启动”的完成输出；冷增量回退与恢复启动也遵循此规则 | 安装后失败、只有安装输出、无 Ability、长日志保留最终启动证据 |
| 热重载 apply 没有传递产品 | 沿用启动会话的 product、build_mode、ability 和 module | 非默认产品的启动/apply 参数及清单去重断言 |
| 信号退出后仍为 active 并阻止重启 | 检查信号退出和 close 状态，保留退出原因，拒绝对死亡会话 apply，并允许重启 | SIGTERM 退出、重新启动、启动超时后的恢复 |
| 两个并发 start 创建两个进程且 stop 遗留一个 | 首次异步操作前占用会话；并发 stop 共用停止过程，等待进程关闭；启动未完成时也可取消 | 直接 API 和真实 MCP 并发调用、stop 后 PID 消失、启动取消、失败释放占用 |

`test/build-tools.test.mjs` 提供 13 项回归，包括上述故障、签名成功/失败的参数与错误契约、CLT 同步以及 MCP 构建完成与取消。它运行在 CI 的 Linux、macOS、Windows 和 Node 22/24 矩阵中。测试 CLI 用当前 Node 运行，不依赖 POSIX shell；CLT 测试复制当前平台 Node 可执行文件，验证含中文和空格的包装层路径传递。该模拟路径测试不代表官方 Hvigor 接受中文工程目录。

本地验证命令：

```sh
node --test --test-concurrency=1 test/build-tools.test.mjs
node --test --test-concurrency=1 test/*.test.mjs
```

2026-09-05 在 macOS arm64 上，新增回归在 Node 22.23.2、24.14.1 下均为 13/13 通过，整仓测试均为 242 项通过、8 项按环境条件跳过、0 失败；原有构建相关专项为 15/15 通过。DevEco Studio 26.0.0.821 的真实 SDK 在独立临时工程上完成 `arkts_check`、`project_sync` 和 `build_project`，最终 Hvigor 日志为 `BUILD SUCCESSFUL`。

另外以未修改的官方 CLI 1.3.1、真实构建产物和受控 HDC 重测了省略 module 的安装启动：成功路径仅有一次安装、一次启动；安装成功后启动返回 `16000001` 时，MCP 返回 `isError: true` / `DEVECO_CLI_RUN_FAILED`。受控 HDC 不连接真实设备，该验证不等同于真机安装成功。

真实连接的设备被正确识别，但测试工程未配置签名，`start_app` 明确返回未签名产物无法安装；没有将其计为成功，也没有自动创建云端签名资源。签名生成成功、真实 HQF 安装和界面热更新效果仍需具备有效签名的工程及支持设备进行验证。

平台边界仍然存在：官方 Hvigor 拒绝中文工程根目录；SDK/CLT、签名和设备支持也由上游决定。此修复证明列出的包装层故障被回归覆盖，不承诺任意操作系统或任意工程均可完成全部真机操作。
