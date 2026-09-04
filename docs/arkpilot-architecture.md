# ArkPilot UI 自动化架构

ArkPilot 是 `deveco-tool` 中独立的 UI 自动化限界上下文，基于标准 HarmonyOS 清单和 ArkXTest/`uitest` 可识别的 UI 节点工作。

## 生成时机和文件边界

安装或启动 MCP 不会修改任何 HarmonyOS 项目。`.arkpilot/config.json` 和 `.arkpilot/flows/` 只在首次对某个项目调用需要流程仓库的 `ui_flow` action 时按需创建，例如 `navigate`、`run`、`list`、`get`、按 id 的 `validate`、`delete` 或 `driver_status`。显式 `record_start` 只保留内存草稿，取消录制不会落盘；直到 `record_stop` 验证成功才创建仓库并保存流程。只调用构建、部署、日志、设备列表和 `ui_flow routes` 不会生成它们。

项目内只持久化声明式流程和项目级驱动配置。截图不写入 `.arkpilot`：设备端临时文件位于 `/data/local/tmp`，拉取后立即删除；电脑端默认位于操作系统临时目录的单次 MCP 会话目录，内联返回后立即删除，未内联的失败证据最多保留十分钟，服务正常退出时统一删除，异常退出的旧会话由下个进程回收。调用方显式传入 `localPath` 是唯一的长期保留方式。

## DDD 与端口分层

```text
MCP Interface (src/server.mjs)
            │
            ▼
Application (flow-service.mjs)
  录制 / 导航决策 / 执行状态机 / 取消 / 自愈提交
            │
       Domain (domain.mjs)
  UiFlow / Step / Selector / Variable / 版本与不变量
            │
            ▼
Infrastructure
  JsonFlowRepository ── .arkpilot/*.json
  RouteResolver       ── app.json5 / build-profile.json5 / module.json5
  HdcAdapter          ── aa / uitest / snapshot_display
  HypiumAdapter       ── 可选常驻 RPC 驱动
```

领域层不读取文件、不调用 HDC，也不知道 MCP。应用层只编排端口并维护 `QUEUED → STARTING_APP → WAITING/ACTING → VERIFYING → SUCCEEDED/FAILED/CANCELLED`。基础设施层处理平台命令、路径、原子写入和设备会话。MCP 接口只做 Schema、稳定错误码和内容块转换。

## 通用导航决策

`ui_flow action=navigate` 使用固定顺序，工具描述同时把这条规则暴露给任何 MCP 宿主：

1. 从标准工程清单中寻找调用方明确指定的 Ability、Action 或 App Link。唯一匹配时直接执行 `aa start`，跳过首页 UI 导航。
2. 没有精确清单路由时，以 flow id 或自然语言目标匹配同 bundle 的已有流程；候选接近时拒绝猜测。
3. 没有流程时自动启动探索录制。AI 使用 `ui_observe` 和语义 `ui_tap` 完成首次导航；成功动作自动进入草稿，最终以语义成功断言验证并保存。

动态 App Link URI 和 Want 业务参数不能从通用工程结构可靠推断，因此必须由调用方明确传入。ArkPilot 不注入测试路由 SDK，也不修改应用内部页面栈。

## 位置变化与安全自愈

语义步骤不保存像素位置。节点仅移动而 `key` 不变时无需更新流程；执行时会从最新 UI 树重新定位。录制 `key` 时同时保留精确 `text + type + clickable` 备用选择器。主选择器失效后，所有候选在同一份 UI dump 上解析；只有唯一备用候选指向同一控件时才执行，并且必须等整个流程的最终断言成功后才原子提升为主选择器。

以下情况不会自动更新：多个候选、模糊文本、最终断言失败、Canvas/XComponent 没有语义节点。后两类坐标步骤只按屏幕百分比回放并标记 `fragile`，页面重排后应重新录制。

## 性能与防卡死

- 成功路径不截图；失败诊断才并行抓取一张临时 JPEG 和精简 UI 树。
- 一次流程只解析一次设备和应用目标，并在全流程内持有跨进程设备租约。
- 一个语义步骤的一组主/备用选择器共用一次 UI dump；动作发送后绝不自动重试。
- 单次 UI 树读取最多占用 3.5 秒，HDC/RPC、单步骤和总流程分别有截止时间；`run/status` 单次等待最多 20 秒，长任务以 `jobId` 轮询。
- 同一设备的第二个流程立即返回 `UI_DEVICE_BUSY`，不同设备可并行；取消会终止调用并释放租约。
- 默认 `hdc-shell`。`hypium-driver` 适配器提供常驻会话，但遥测未关闭或 `.arkpilot/config.json` 的性能门禁未通过时不能启用，也不会在动作发送后切换后端。

实现只用 Node.js 的 `path`、`os.tmpdir()`、argv 子进程和原子文件操作，不在宿主侧拼接 shell 命令，因此路径和临时目录语义覆盖 macOS、Windows 和 Linux。设备侧命令仍由 HarmonyOS HDC 提供。

## 验证层级

- `npm run test:flow:unit`：领域校验、仓库安全、清单路由、录制、执行、自愈、超时、临时截图和双后端契约。
- `npm test`：现有工具兼容性、45 工具静态列表、Schema、子进程截止时间和完整回归。
- `npm run test:device`：连接设备的 HDC/UI canary。
- `npm run test:flow:device -- ...`：确定性流程真机/模拟器连续回放。
- `npm run bench:ui-flow -- ...`：记录成功率、p50/p95/max、HDC 命令、UI dump、截图和进程内存。

Hypium 只有在同一真机和模拟器各 50 次回放全部正确、语义步骤 p95 比 HDC 至少低 40%、完整流程 p95 至少低 25%，并且没有进程、端口和设备会话泄漏后，才允许将 `hypiumPerformanceGate` 设为 `true`。

## 参考实现

- [OpenHarmony ArkXTest](https://gitcode.com/openharmony/testfwk_arkxtest/tree/master)：选择器、组件操作和 `uitest` 的权威实现参考。
- [hmdriver2](https://github.com/codematrixer/hmdriver2)：常驻设备代理和语义组件操作参考。
- [Appium HarmonyOS Driver](https://github.com/zhihu/appium-harmonyos-driver)：驱动适配层和选择器协议参考。
- [uiautomator2](https://github.com/openatx/uiautomator2)：持久会话、显式等待和断线清理参考。
- [Maestro](https://docs.maestro.dev/get-started/how-maestro-works)：声明式线性流程和自动等待参考。

这些项目仅作为协议和生命周期设计参考；默认执行链仍使用本机 DevEco/HDC，未引入 Appium 或 Maestro 服务。
