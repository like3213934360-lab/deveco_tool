# 构建目标选择

`product`、`module_targets` 和 `target` 分别表示工程产品、模块构建目标和 HDC 设备。例如：

```json
{
  "action": "start",
  "workflow": "project_build",
  "request_key": "preview-build-1",
  "input": {
    "project_path": "/absolute/application",
    "product": "default",
    "modules": ["entry"],
    "module_targets": { "entry": "preview", "shared": "preview" }
  }
}
```

映射键必须是工程模块名，目标必须适用于所选产品。未指定的模块优先使用 default，否则使用唯一适用目标；存在歧义时报错，避免猜选。无效模块或目标在启动 SDK 前拒绝。已选择的依赖模块目标同样用于 HSP 闭包构建，产物路径来自真实同步模型。

提交工作流时保存全部实际选择，包括隐式默认值。重启恢复读取原任务，重新核对工程、产品、目标和工具链。切换默认工程不会改变任务；同一请求键改用其他目标会报冲突。LSP 的工程摘要和热重载会话键包含目标组合，不混用不同目标的会话或待应用补丁。同一工程的冲突写操作仍串行。

`assembleApp` 是产品打包。现代 SDK 的 `PreBuildApp.checkConfigModuleStatus` 不允许通过 module 参数指定非 HAR 模块。本 MCP 对 `assembleApp` 的 `modules` 或非空 `module_targets` 明确拒绝，目标选择使用 `assembleHap`、`assembleHar` 或 `assembleHsp`。`app_deploy` 安装明确给定的制品集合，制品已经确定构建目标。

旧 `start_app.target` 和 `apply_changes.target` 原本指模块构建目标，替代字段是 `module_targets[module]`；旧 `hvd` 才对应当前设备 `target`。不保留旧工具别名。

2026-09-09 的冻结版本已通过 336 项回归、49 项真实多产品/目标/模块验收，以及 11 项指定 `preview` 目标的热补丁验收。运行摘要为 `a9c81e90ac50fe48f75bee7d52d6d46f27951a56ed1eaa8be345d9d04f54437b`，全部编译摘要为 `d30313300b8d569e4b7f0b043a1e1b0621d6920152c7c9ee09d3b18746ad5a8c`。

恢复回归包含目标捕获、重建 Runtime、默认工程切换及请求键冲突。真实 SDK 验收覆盖 default/tablet 产品各自的 default/preview 目标、跨模块 ArkTS 定义、目标静态预检，以及双 ABI C++。四组个人签名三包部署均安装一次，完成回执后注入响应丢失，重建 Runtime 恢复并通过最终 UI 断言。此范围已通过迁移接收程序接受 `start_app` 行，不代表所有 SDK 执行窗口强杀均已验证。

热补丁验收使用新建的双目标专用工程和已有个人签名资产，实际配置 `preview` 签名；两次 HQF 应用均保持 PID 并通过最终文字断言，随后恢复源文件并停止 watch。目标会话不会出现在隐式 default 查询中。这轮真机测试发现并修复了签名配置复核、静态检查子进程遗漏目标传递的问题。

私有原始报告位于本机 `~/Library/Application Support/DevEcoMCP/acceptance/`：`20260909-native6-module-targets-regression-dev3-1`、`20260909-native6-multimodule-module-targets-dev3-1`、`20260909-native6-hot-device-module-targets-dev3-1`。上游 80 条规则经当前报告重新接收，code/CLI 分别覆盖 13/32 项映射检查。完整平台、直接能力性能和最终同版长稳仍单独验收；本机结果不扩展为其他平台的真实 SDK 支持结论。
