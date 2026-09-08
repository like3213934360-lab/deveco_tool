# UI 验收证据与宿主外观审阅

`verify_ui` 支持控件断言、外观审阅要求，以及可选截图设置。只有控件断言时直接查询 UI 树，保持原有轻量路径。提供 `review.requirement` 后，服务采集截图并保存要求，宿主 AI 通过原生 MCP 图片读取进行审阅。MCP 内部没有第二个视觉模型或自主编程 Agent。

```json
{
  "target": "device-id",
  "assert": {"visible": {"text": "保存成功", "textMode": "exact"}},
  "review": {"requirement": "核对中文提示完整可读，没有被浮层遮挡。"},
  "capture": {"format": "jpeg", "width": 960}
}
```

控件断言通过时 `assertion.status` 为 `passed`；只要请求了外观审阅，`review.status` 始终为 `required`，整体 `verified` 为 `false`。宿主可以根据图片和需求向用户报告自己的判断，但不能任意改写已保存报告或工作流检查点。

没有可查询控件的 Canvas/XComponent 界面，可以只提供 `review.requirement`；这条路径不获取 UI 树，断言状态为 `not_requested`。要求必须非空且最多 4096 字符。只提供 `capture` 不属于验收，请使用 `ui_snapshot`。

提供 `capture` 或 `review` 时，响应包含：

- `assertion`：控件检查结果或原失败。
- `review`：是否需要宿主审阅及完整要求。
- `screenshot`：图像元数据、SHA-256 和制品引用；采集失败时为 `null`。
- `report_artifact`：保存上述结果与时间的 JSON 制品，重启后仍可读取。
- `sampling`：`assertion_then_screenshot` 或 `screenshot_only`。控件查询和截图在同一设备租约内先后执行，不是原子快照；应用自身仍可能改变画面。

控件断言失败时会继续采集请求的截图，MCP 仍返回原失败代码，报告位于错误的 `details`。截图失败也不会抹去已完成的控件断言；请求取消后不继续采集。SDK/连接错误不会被误归类为控件断言不通过。

通过 `workflow_run` 的 `read_artifact`、`as: "image"` 读取 `screenshot.artifact.artifact_id`，返回可供宿主审阅的 MCP 图片。报告使用默认分页读取。相关制品遵循统一保留期与容量，不写入工程目录。限制与格式校验见 [截图说明](native-screenshots.md)。

图像比较使用 `ui_snapshot.capture.if_changed_from`，传入前次 `frame_signature`，并保持相同目标、格式、宽度和显示器设置。结果 `unchanged` 表示编码字节及捕获元数据是否一致；调用方可核对希望画面改变或保持不变的条件。它不等于业务成功，也不判断动画、色差或布局质量。

## 迁移与验证

旧 `verify_ui.capture/assert/compare` 分别由 `ui_snapshot` 或带 `review` 的 `verify_ui`、`verify_ui.assert` 和 `ui_snapshot.capture.if_changed_from` 承担。`selector` / `success_state` 合并为 `assert.visible/hidden`；`visual_prompt` 转为 `review.requirement`；旧内存 `baseline_id` 转为调用方保存的 `frame_signature`；`inline` 转为独立且显式的 `read_artifact as=image`。不注册旧参数或动作别名。

`test/native-verification.test.ts` 覆盖输入约束、直接断言路径、外观报告持久化、组合结果、失败证据、取消、图片大小和内容边界，以及真实 MCP Client/Server 图片返回和 Worker 重启。`test/native-retention.test.ts` 同时检查完整二进制读取与分页读取的短读、文件变化和清理竞争。

真实设备首轮暴露了 Worker 通用响应压缩的问题：超过 64 KiB 的图片读取被再次保存为 JSON 制品，MCP 图片呈现收不到原始结果；默认最大 64 KiB 二进制分页编码为 Base64 后也会超过同一阈值。显式 `read_artifact` 现在使用自身已校验的分页/图片上限，不再经过通用摘要包装，也避免对整张图片额外序列化。大于普通响应阈值的有效 PNG 和完整 64 KiB 分页已加入真实 MCP 回归，其他工具的大响应仍转为制品。

真实设备验收使用 `scripts/native-visual-review-acceptance.ts`，在新的私有证据目录运行，只采集当前界面；通过随机且不存在的控件键验证断言成功/失败协议，不把它记录为应用业务验收。脚本核对 PNG/JPEG 字节摘要、原生图片块、Worker 与整个 MCP 重启后的报告和图片，并保存可打开的图像。该证据不覆盖真实多显示器、旋转或视觉模型判断准确性。

2026-09-08 的 `20260908-visual-review-device-2` 八项全部通过；独立 Node 24 安装仅含166个原生依赖，未安装旧 CLI、子 MCP 或 Skill。实际打开 MCP 返回字节保存的 JPEG 和 PNG，图像可正常显示，中文日期可读。本轮画面是锁屏，不构成业务页面的外观或功能验收。

同版 Node 26 `20260908-visual-review-regression-2` 和 Node 24 `20260908-visual-review-node24-2` 各259项回归通过，均为0失败/取消/跳过。三份证据的运行摘要均为 `2d87fca1e813f3c70eec3037578b346321f73f5e4635907c024eaadeef689aed`，完整编译摘要均为 `0e8f0c9f9f56628fad825b3cd4ddee2152a991d8f9847727bc3bb4374367ebb4`。首轮 `20260908-visual-review-device-1` 的失败和第一套安装目录保持原样。证据位于用户目录 `Library/Application Support/DevEcoMCP/acceptance/`；图片不进入 Git 或发布包。

提交 `331af6c` 的 [CI 34188722653](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34188722653) 六组 macOS/Windows/Linux × Node22/24 全部成功。结合上述独立安装、真实设备和图像呈现证据，迁移表中的 `verify_ui` 已完成本项行为验收；最终入口切换后的全仓发布验证仍需单独完成。
