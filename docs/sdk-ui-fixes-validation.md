# 工程 SDK 配置与 UI 树采集修复验证

日期：2026-09-06。范围：双工程验收中发现的 SDK 兼容性误报，以及设备并发采集测试对失败形式的错误假设。

## 修复与证据

| 问题 | 修复 | 回归证据 |
| --- | --- | --- |
| ArkTS 预检固定使用 OpenHarmony / API 12，导致 API 23 工程的 `setTabBarTranslate` 被误报为不兼容 | 从 `build-profile.json5` 读取所选产品的 SDK 和 runtimeOS，保留 HarmonyOS 版本原文传给官方比较器；按有效 SDK 配置隔离缓存 | 两个 MCP 入口都验证 API 12 保留警告、API 23 消除该警告；同一 MCP 内切换产品、修改配置、采用 `26.0.0` 格式均通过 |
| 并发 UiTest 用例只接受订阅超时，但实际设备也会返回 `Get window nodes failed`；工具未区分无法读取窗口节点的情况 | 增加 `UI_TREE_UNAVAILABLE` 分类并保留原始错误；设备用例先验证串行采集，再校验并发至少一方成功及已观察到的失败形式 | 普通 dump、独立截图/树采集和融合归档路径均覆盖已知错误；未知失败仍报错；真实模拟器设备用例 8/8 通过 |

SDK 配置默认选择名为 `default` 的产品或唯一产品，其他多产品工程必须显式指定 `product`。缺失、无效、歧义配置返回 `ARKTS_SDK_CONFIG_INVALID`，不会回退到猜测的 API。产品 SDK 字段覆盖旧版 app 层字段。

`UI_DEVICE_BUSY` 保留给既有的订阅回复超时。`Get window nodes failed` 曾在并发采集时出现，但不能仅凭此消息认定设备被其他客户端占用，因此单独返回 `UI_TREE_UNAVAILABLE`。未知错误仍返回 `UI_DUMP_FAILED`；没有屏蔽失败或增加自动重试。

## 本机验证

环境：macOS arm64、Node 26.0.0、DevEco Studio 26.0.0.821、SDK 26.0.0.105、官方 CLI 1.3.1。设备用例使用本次创建的 HarmonyOS 6.1.1(24) 模拟器，完成后已停止并删除；未操作用户真机，原有模拟器保持停止。

| 检查 | 结果 |
| --- | --- |
| `npm test` | 279 项：271 通过、8 项需设备用例按条件跳过、0 失败；包含真实 SDK/LSP 集成 |
| 显式指定临时模拟器运行 `npm run test:device` | 上述 8 项设备用例全部通过、0 跳过 |
| `npm audit --audit-level=moderate` | 0 个漏洞 |
| 新启动 stdio MCP 的双工程与 UI 复查 | 10 次调用均未返回 MCP 错误；两工程各执行单文件预检和整工程预检；UI 串行基线和 3 个并发请求均成功 |

双工程预检的实际诊断如下，不能将工具执行成功解读为没有警告：

| 工程 | 单文件预检 | 整工程预检 |
| --- | --- | --- |
| LingDong | `products/default/src/main/ets/pages/Index.ets`：0 错误、1 条 `animateTo` 弃用警告；`setTabBarTranslate` 误报消失 | 0 错误、2114 条警告 |
| MyStarRing | `products/phone/src/main/ets/pages/Index.ets`：0 错误、0 警告 | 0 错误、314 条警告 |

两工程均实际采用 HarmonyOS / `6.1.0(23)` / API 23。其他 SDK 诊断原样保留，包括 MyStarRing 使用较新 API 的兼容性提示。本次未修改业务源码或工程 SDK 配置。

## 验证边界

- 本次执行针对两项修复的回归、整仓自动化测试与相关 MCP 实测，没有重新逐项调用全部 40 个工具。
- 预检结果仍标记 `compilationVerified:false`，不能代替 Hvigor 构建；项目中的其余警告未在本次逐条排查。
- Windows/Linux 的可移植适配测试由对应提交的 CI 验证，不能据此宣称这些平台的原生 SDK、真机或任意工程已通过验收。
- 验证使用新启动的 MCP 进程；已运行的 MCP 需要重启才能加载代码及新增的 `product` 参数。
