# 原生截图与画面查询

`ui_snapshot` 默认使用 `snapshot_display` 获取 JPEG 图像，返回尺寸、SHA-256、画面摘要和制品引用。此模式不调用 UI 树查询。`mode: "tree"` 只读树，`mode: "both"` 在同一设备租约内获取树和图像；两者是先后采样，并非同一时刻的原子快照。

```json
{"target":"device-id","capture":{"format":"jpeg","width":640}}
```

`capture.width` 范围为 64–4096，按设备报告尺寸保持宽高比。JPEG 默认长边最多 2576；PNG 默认原始尺寸。显示器未指定时由设备选择，可用 `capture.display_id` 指定。第一次尚不知道尺寸时可能采集两次；后续复用有上限的尺寸缓存，每次仍核对设备报告，旋转或折叠后重新计算。最多三次采集，尺寸持续不稳定则明确失败。

返回的 `coordinate_scale.x/y` 分别表示图像坐标到设备坐标的比例；因像素取整，两轴比例可能略有不同。控件定位优先使用 UI 树中的设备坐标。

下一次查询可传入 `capture.if_changed_from`，值为先前返回的 `frame_signature`。每次仍实际采集，比较编码字节及设备/显示器/尺寸信息；完全相同则返回 `unchanged:true` 且不保留重复制品。编码字节不同并不一定表示可感知的业务状态变化。

`ui_observe` 支持显式 `capture`，在查询控件后追加图像；`ui_inspect` 支持可选截图。`workflow_run.read_artifact` 默认以 Base64 分页读取；显式指定 `as: "image"` 后，PNG/JPEG 通过 MCP `ImageContent` 返回，宿主可以直接显示和审阅。JSON 只保留制品 ID、大小、尺寸及 SHA-256，不重复整张图像。新接口没有任意输出路径或覆盖文件的参数。

```json
{"action":"read_artifact","artifact_id":"返回的制品 UUID","as":"image"}
```

图片呈现最多读取 8 MiB，不接受分页参数。更大的截图可以重新指定较小 `capture.width`，或通过默认分页模式导出。读取在 Worker 内完成，和保留期清理使用同一事务协调；读取前后检查文件大小及修改时间，并验证 MIME、头部和结束标记，不进行像素解码。图片读取不加载工作流引擎或启动 SDK。

单张图像最多 32 MiB。接收前读取设备文件大小并预留存储额度，接收后每次读取最多 64 KiB，核对实际大小、头部尺寸、结束标记、SHA-256 和文件稳定性。这里没有完整像素解码，也不能仅凭截图宣告业务验证成功。失败会释放预留额度和部分文件。

本机 JPEG 缩放、PNG 原始尺寸和画面比较已在真实设备验证；多显示器、真实旋转与固定环境性能仍需单独验收。参考原生组件：[OpenHarmony Window Manager](https://github.com/openharmony/window_window_manager/tree/master/snapshot)。

外观审阅要求、断言结果和持久化报告的使用方式见 [UI 验收证据](native-visual-review.md)。
