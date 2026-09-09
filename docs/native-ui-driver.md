# 原生 UI 驱动诊断

`deveco_doctor` 在明确提供 `target` 时返回 `ui_driver`：检查该设备的连接、架构、UiTest 版本，以及发布资源中的原生文字输入组件。未提供设备时返回 `not_probed`，不会自动选择或访问手机。

```json
{"target":"device-id"}
```

这替代旧 `ui_flow.driver_status` 的诊断用途。旧实现检查可选 Hypium 包、配置和性能开关；新实现直接读取设备组件，不保留代理后端、旧动作别名或可选包安装要求。

## 结果含义

- `status: detected`：固定设备上的 `uname -m` 和 `uitest --version` 返回完整且格式有效的结果。
- `text_input.status: component_detected`：架构和 UiTest 版本满足文字输入组件选择条件，且对应资源文件存在。实际输入和诊断共用选择函数；当前条件为 arm64/aarch64 或 x86_64，UiTest 6.0.2.2 及以上。
- `status: unavailable`：连接、命令、格式或探测期限失败，错误结构说明原因；不会回退到另一台设备。文字组件单独不可用时保留已读取的 UiTest 结果。
- `operation_verified: false`：这些读取没有验证点击或文字输入，也不证明所有版本、平台和设备均支持。

探测在同一设备租约内顺序执行，总期限为10秒，包含排队时间。取消会传给在途命令并等待退出；探测不会上传组件、建立端口映射、启动 UI 守护进程、注入输入或采集截图。

## 验证记录

2026-09-08，`test/native-ui-driver.test.ts` 覆盖默认不访问设备、显式目标与租约、arm64/x86_64 组件选择、最低版本与畸形版本、截断响应、不支持架构、断开设备不回退及取消后释放租约。既有 Unicode RPC 回归同时运行。

本机 Node26 的 `20260908-driver-regression-1` 与独立原生安装 Node24 的 `20260908-driver-node24-1` 各266项回归通过，0失败/取消/跳过。真实设备 `20260908-driver-device-1` 的驱动探测、属性、UI 树与截图、保存树查询、窗口断言、日志和关闭共14项通过；本轮没有安装、启动、点击或文字输入。

三份证据的运行摘要均为 `ff9751c6388609eb7fa0eb0f4f3a2370722cd59bfae38cc970c9e09bfb4b663d`，编译摘要均为 `87bb0d6ad1a1bcd224e717cad786355033df8c3a34eb34a8522b38a703ef69c9`。证据位于用户目录 `Library/Application Support/DevEcoMCP/acceptance/`，原生 Node24 安装目录为 `Library/Caches/DevEcoMCP/validation/20260908-driver-1`。当前改动的跨平台 CI 与最终发布验收仍待完成。
