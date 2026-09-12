# 原生 UI 工作流

这些接口由 `dist/src/cli.js mcp` 提供。0.3.0 已正式发布；本文新增的 flow v2 和默认启动检查属于下一版本候选，发布与当前验收状态见[剩余能力进度](remaining-release-progress.md)。专用应用的中文输入、录制和 MCP 重启后重放有分项真机证据，见[个人签名与设备证据](native-signing.md)。历史 `bc68e0c` 快照的 MCP 对十份既有用户流程完成过 `list/read/validate`：原字段、坐标、私密变量声明、全部步骤与最终断言保持，文件 SHA-256 前后不变。原始报告为本机 `20260909-main-saved-flow-read-bc68e0c-1/evidence.json`；这证明该快照对既存文件的读取兼容性，不代表这些业务路径已在当前设备上重放。

## 默认启动检查

部署、导航、录制重新启动和热重载基线安装在启动命令被接受后继续检查进程与应用画面；热补丁确认后检查原进程集合是否保持。`app.startup_check` 默认使用 `mode:"ui"`、`stable_ms:1500`、`timeout_ms:10000`、`allow_uniform:false`。总预算必须比稳定窗口至少长 1 秒；支持稳定窗口 500–5000 ms、总预算 2000–30000 ms。日志起点采集单独限制为最多 1 秒且不超过总预算的四分之一，诊断采集不可占满进程观察时间。

UI 检查根据当前应用的可见窗口确定显示器；无法唯一确定时需显式 `display_id`。它只分析应用窗口内的基础像素结构，最多保留三次画面观察。纯白、纯黑和其他纯色页面均属于需确认的状态；确知启动页面可以纯色时显式设置 `allow_uniform:true`。无 UI 的 Ability 可声明 `mode:"process_only"`，此时不会宣称界面通过。

结果分别表示 `commandAccepted`、`processVerified`、`startupVerified` 与 `outcomeVerified`。进程退出或被替换会失败；查询失败、预算耗尽或未获授权的持续纯色画面保持未验证。报告包含时间、进程样本、截图摘要、原因和可取得的有界诊断日志。默认启动检查不是业务页面断言，仍需 `build_deploy_verify.assert`、流程最终断言或客户端视觉审阅。检查失败不能盲目重复已接受的启动或补丁；取消也不撤销已经发生的设备效果。

启动回执已持久化后，即使取消发生在第一条进程样本之前，也保留 `commandAccepted:true`、`startupVerified:false` 的取消报告。工作流会等原生节点及其进程清理结束，再释放资源并写入取消终态；无法确认外部效果或退出的任务仍保持待核实状态，不以取消请求本身证明安全结束。

## 目标导航

先用 `ui_flow` 的 `routes` 查询所选工程、产品公开的 Ability、Action、URI 和 MIME 声明。

```json
{"action":"routes","project_path":"/absolute/project","product":"default"}
```

直接入口需要显式最终断言。Want 参数支持布尔值、无符号整数、字符串和空字符串。

```json
{
  "action":"navigate",
  "project_path":"/absolute/project",
  "route":{"module":"entry","ability":"EntryAbility"},
  "parameters":{"source":"navigation-test"},
  "assert":{"visible":{"key":"home-title"},"timeoutMs":5000},
  "request_key":"navigate-home-001"
}
```

也可使用 `goal` 匹配公开入口或已保存流程，或使用 `id` 指定保存流程。`route`、`goal`、`id` 只能提供一个。已保存流程保留自身断言，不接受新的 `assert` 或 Want 参数；其输入使用 `variables`。

```json
{"action":"navigate","project_path":"/absolute/project","goal":"打开设置","variables":{},"request_key":"settings-001"}
```

入口优先于保存流程。入口歧义、两个得分相近的流程、私有 Ability 启动，以及不匹配的显式 URI 或路由会明确失败。目标匹配只考虑当前产品和应用内的流程。

`goal` 未匹配时自动建立空录制，返回 `navigation: "recording"` 和相同的 `recording_id` / `run_id`。启动入口按所选产品的工程清单选择：entry 模块内同时声明 home Action/Entity 的公开 Ability，其次是 entry 模块的公开 `mainElement`，最后是唯一公开 Ability。当前优先级存在多个候选，或根本没有公开入口时，返回候选 ID 或缺失错误，不操作设备；使用 `routes` 后显式 `record_start` 选择入口。

自动录制使用 `restart`，流程 ID 由规范化目标、产品和应用入口的摘要生成，名称保留完整目标。请求此路径时不提供 `assert`、`variables`、Want `parameters`、`flow` 或 `replace`；达到目标后用 `record_stop` 提交最终断言。返回录制任务不表示已经到达目标。

先等待任务进入 `needs_input`，再按下面的流程观察、操作和保存。同一 `request_key` 在并发请求、MCP 重启和流程保存之后仍返回原录制；相同键的新输入报冲突。保存完成后使用新的请求键，目标即可匹配保存的流程。已有文件不会被自动覆盖，未知目标也不会被转成自动生成的 UI 步骤。

请求持久化后返回 `run_id`。用 `workflow_run` 查询状态、恢复和取消。同一请求键与相同输入返回原任务，工程默认值或保存流程后来变化不会创建第二个任务。

## 录制与保存

1. 调用 `ui_flow.record_start`，提供新的流程 ID、名称和 Ability 入口。`mode` 默认为 `restart`，会停止并启动该应用；`attach` 保持当前应用状态。

```json
{
  "action":"record_start",
  "project_path":"/absolute/project",
  "id":"open-settings",
  "name":"打开设置",
  "route":{"module":"entry","ability":"EntryAbility"},
  "mode":"restart",
  "request_key":"record-settings-001"
}
```

2. 返回的 `recording_id` 等于 `run_id`。先通过 `workflow_run.status` 等待状态变为 `needs_input`；此时初始化已完成，设备租约已释放。`ui_flow.record_status` 同时提供录制步骤数、变量定义和不确定操作信息。

```json
{"action":"status","run_id":"返回的 run_id","wait_ms":1000}
```

3. 使用 `ui_observe`/`ui_find` 观察，再使用 `ui_tap` 或 `ui_control` 操作。成功操作自动记入该设备的录制。选择器必须唯一，`limit:1` 不能绕过歧义校验。录制与重放复用操作前已获取的 UI 快照；执行操作后快照失效。

```json
{"selector":{"key":"settings-button"}}
```

上例为 `ui_tap` 输入。`ui_control.inputText` 和焦点 `text` 的实际文字不会写入流程或录制草稿；它生成 `input1` 等必需的私密变量，步骤只保存 `${input1}`。输入框的当前文本和值也不作为选择器备选项。焦点输入记录为 v2 的 `focusInput`：保存唯一可编辑控件的稳定选择器，重放时重新取得应用窗口、恢复焦点、再次确认焦点后再输入。

百分比手势可相对于控件或明确的窗口，显示器编号随解析结果传给原生输入；录制保存实际执行位置和 fling 步长。参数、示例和多窗口限制见 [原生 UI 操作](native-ui-controls.md)。

4. 调用 `ui_flow.record_stop` 提交最终断言。提交后断言固定，任务重新进入 LangGraph，验证成功才保存 `.arkpilot/flows/<id>.json`。已有同名文件不会被覆盖。

```json
{"action":"record_stop","recording_id":"返回的 recording_id","assert":{"visible":{"key":"settings-title"},"timeoutMs":5000}}
```

断言未通过时保留录制数据，可在排查后重新检查原断言；不能降低断言来保存流程。截图本身不代表验证通过。录制结束、失败或重启后，用 `record_status`/`workflow_run.status` 查看结果。

5. 放弃录制使用 `ui_flow.record_cancel` 或 `workflow_run.cancel`。取消会传给正在执行的 UI 操作，确认停止后才释放录制状态；它不会撤销设备上已经完成的操作。

```json
{"action":"record_cancel","recording_id":"返回的 recording_id"}
```

## 恢复、限制与证据边界

- 录制数据加密保存于 SQLite，输入等待和执行节点使用官方 LangGraph 检查点。没有额外的录制任务 Map。进程内只保留有上限的取消句柄。
- 同一设备仅允许一个未完成录制；最多 32 个未完成录制，每个最多 200 步、256 KiB 草稿。未完成录制不会按历史任务保留期限删除。完成/取消的录制随任务清理，已保存的用户流程文件不参与任务清理。
- 已接受的点击如果无法持久化回执，工具仍报告设备操作已接受，并附上录制失败信息。草稿保留不确定标记，阻止继续操作或保存；确认操作停止后可丢弃录制。不能根据连接错误自动重放点击。
- 停止、启动或保存文件的外部结果不明时，工作流进入 `needs_input`。保存结果可以按内容摘要核对；不能证明的设备操作不自动重做。
- flow v1 保持原有读取与执行语义，不会自动改写用户文件。新录制需要扩展动作时使用 flow v2：支持 `focusInput`、`dircFling`、完整 `keys` 组合，以及 `mouseClick`、`mouseDoubleClick`、`mouseLongClick`、`mouseMoveTo`、`mouseScroll`、`mouseMoveWithTrack`、`mouseDrag`。保留按键、速度、方向、滚轮刻度与轨迹参数，复用直接操作的解析和派发。扩展字段写进 v1 会明确拒绝。
- v2 扩展动作保存 `scope` 的显示器、窗口类型和可取得的 Ability，不保存易失的窗口 ID；重放要求唯一匹配的当前应用窗口。坐标操作标记为 `fragile`，并相对于明确的应用窗口保存百分比坐标。SDK 未提供的鼠标参数仍由原生能力检查拒绝，格式支持不等于所有设备已验证。
- 新设备任务不能在未完成录制期间部署或重放其他 UI 路径。热重载也在取得设备租约后读取持久化录制状态：构建期间由另一个进程新建的录制会阻止基线安装，已有 watch 的补丁应用同样被拒绝。取消录制后可以继续；停止 watch 不受此限制。其他设备的录制不阻塞当前设备。此协调使用同一 `DEVECO_STATE_DIR`，不控制用户手工操作或其他软件。

- `record_status`、`record_stop`、`record_cancel` 使用已固定的工程、产品和设备，不接受重新指定目标。
- `verify_ui` 的超时包含获取 UI 树的时间。实际设备获取一棵树可能超过 1 秒，应按设备与任务选择合理的明确期限。

## 自动录制验证

2026-09-08 新增未知目标转录制路径。`test/native-routes.test.ts` 覆盖入口优先级、home 声明成对校验、歧义、私有入口、产品隔离、完整中文目标和稳定流程 ID；显式 URI/路由匹配失败及流程歧义不会转成录制。

`test/native-recording.test.ts` 使用真实 LangGraph/SQLite 和替代设备服务验证并发提交只启动一次、运行时重开后保留步骤、原请求在保存前后持续去重、断言失败不保存、通过后按目标重放、入口歧义不触碰设备，以及排队取消不启动。既有显式录制和路由回归同时运行。

本机 Node26 的 `20260908-navigation-regression-1` 和独立原生安装 Node24 的 `20260908-navigation-node24-1` 各263项回归全部通过，0失败/取消/跳过。运行摘要均为 `e9518fa013250056e14744a48f38c2ca1d929ed066105093ea52f500c8edff4f`，编译摘要均为 `c31ede7a1ba4a31c22a209bf87b50f4f633699c9c00601e9b98ba0d0bf02e2ef`。证据位于用户目录 `Library/Application Support/DevEcoMCP/acceptance/`；独立安装目录为 `Library/Caches/DevEcoMCP/validation/20260908-navigation-1`。[CI 34189579814](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34189579814) 对应 `1ecafae`，macOS/Windows/Linux × Node22/24 六组全部通过。本轮没有操作真实设备，新自动录制路径的真机验证仍待完成。

跨进程竞争回归使用真实 SQLite、设备租约和两个 Node 进程，模拟 SDK 编译和设备调用，验证拒绝发生在安装/补丁之前，并核对 watch 退出及配置恢复。这不是新的真机竞争验收；真实 UI 与两次热补丁证据记录的是之前的独立运行快照。
