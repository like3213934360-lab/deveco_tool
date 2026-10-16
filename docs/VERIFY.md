# 工程验收与证据

`project action=verify` 和 `deveco-mcp verify` 执行同一份有限 JSON 计划。job 的 `succeeded` 只表示执行器完成；验收看 `result.verdict`。必选检查的 failed、blocked、inconclusive、not_run 或 recorded 均不能合成 passed。计划至少包含一个必选检查；可选检查的失败保留在报告中。

```json
{
  "schema": 1,
  "checks": [
    {"id":"build","type":"build","options":{"clean":true},"affects":["*"]},
    {"id":"local","type":"test","options":{"kind":"local","scope":["Acceptance#addition"],"expected_tests":1}},
    {"id":"deploy","type":"deploy"},
    {"id":"screen","type":"assert","options":{"visible":{"key":"HelloWorld"}}},
    {"id":"crash","type":"crash","options":{"since_minutes":5}}
  ]
}
```

```sh
deveco-mcp verify --project /absolute/project --plan verify.json --target SERIAL --out /absolute/new-evidence
```

CLI 仅 passed 返回 0，包括基线录制在内的其他结果均非零。MCP 用 `project {action:"verify",project,plan,output,target,wait:0}`，持续 `job wait` 到终态，再读 verdict。`output` 必须是新目录，位于工程源码外或 `.arkpilot/` 下，并在 `DEVECO_STATE_DIR` 外；不会覆盖原报告。JSON、JUnit、离线 HTML、原始 artifact 和 SHA-256 manifest 不参与短期 retention。请自行保管证据目录，其中可含工程路径、设备标识、截图和应用日志。

计划支持 build、deploy、test、flow、assert、visual、layout、perf、crash、diagnostics、launch、command、entries、form。options 使用对应现有动作的参数；不能覆盖 project/product/target/action/request_key/wait。所有工具参数在准备动作前检查。不开放循环、表达式或任意工具名。未运行项目如实列出；source-integrity 检查包括未提交/未跟踪源码，不自动 `git reset` 或覆盖用户文件。

## 测试、变更范围与基线

- `project test kind=local|instrument`：模块、suite 或 suite#method、coverage、expected_tests、timeout_ms。timeout_ms 是后台任务期限（默认 10 分钟，最长 30 分钟），独立于单次调用的 wait；长任务通过 job wait 继续等待。SDK 原始逐用例结果与汇总交叉核对；退出 0、BUILD SUCCESSFUL 不代表用例通过。零用例、Ignore、数量/范围不符、缺失/旧报告不能通过。当前 SDK 只支持 default product；Local Test 在 macOS/Windows，Linux 明确不可用。
- Instrument Test 会卸载应用并清数据，必须 `allow_data_reset:true`。多设备并存时必须传 `target`；单设备可自动解析。MCP 将 SDK 子进程的 HDC 通道绑定到解析后的目标，不断开其他设备、不改 SDK 或全局环境。目标不可用、握手不兼容或 SDK 请求全局设备操作时失败，不切换目标。使用专用调试应用；原始测试与覆盖率报告仍须完整、新鲜且核算一致。
- `--changed-only --base <ref>` 按每项 affects 的相对文件/目录前缀选检查，`*` 覆盖全工程。未覆盖变更阻塞；结果 scope 为 changed-only。共享配置/依赖应映射到必选的全量检查；没有映射不会被跳过。这是工程声明的影响映射，不声称自动证明依赖闭包。
- 每项可设 baseline、tolerance_percent、max、repeats。数值取重复样本中位数；原样本完整保留。build 提供 build_ms、warnings、package_bytes；diagnostics 比较完整诊断集合；perf 提供 p95_ms、jank_rate、fps；launch 提供 launch_check_ms；command 可返回数值 metrics（默认越低越好）。max 是上界，不适合最低 FPS，应使用 higher 方向的 FPS 基线。
- `--baseline-mode record` 显式写 `.arkpilot/quality-baselines/`；结果 recorded，不能冒充回归通过。compare 是默认；缺失或 SDK/设备/方法/场景不匹配的基线阻塞。质量基线记录和比较没有自动容差重试；review 后由项目设容差。构建请显式 clean；性能和 launch 建议 repeats≥3，并固定工程、设备、电源、UI 起点及温控条件。
- perf 与 launch 若既未指定 baseline，也没有任何 max 阈值，返回 inconclusive；测得数值本身不是质量通过条件。
- launch_check_ms 是 force-stop 后启动及约 3 秒存活/崩溃/空白屏检查的端到端耗时，**不是**系统首帧时间。perf 在手势期间独立限频读取帧缓冲，结束后停止采样；原始证据包含各命令的起止时间及 sampling 窗口。相邻有效窗口必须有重叠；不重叠、采样失败、帧时间戳全零或 >200ms 的未归因间隔均不能判通过，长间隔保留为 excluded_intervals。动作带 selector 时只在唯一匹配区域内滚动，并记录该子树的前后变化及操作窗口；目标未动或丢失时返回 inconclusive。整个窗口的变化也不等于业务更新。原始 hitrace 不提供未经证实的 ArkTS 栈映射。
- visual 通过 name 引用图像基线；verify 禁止默认创建。sidecar 校验设备、OS/API、工程 SDK、比较方法、context 和图片哈希，旧无元数据基线须重新录制。通过 options.context 声明主题/语言/字体/业务场景；MCP 不会猜测这些设置。完整截图基线与采样进入证据包。
- layout 在 verify 内默认 48vp、tiny_target 作为失败项；节点数标为 checked_unit=nodes。无法取得真实 density 时为 inconclusive。独立 `ui layout` 保留原先 advisory tiny-target 默认，可显式 strict_targets/min_target_vp。
- crash 必须给 since_minutes；严格读取目录或 Faultlogger 的有效清单并验证设备时钟，读取失败不能被解释为“没有崩溃”。

## 场景、入口和归因

`device databases` 发现调试应用 user100 的实际 RDB 路径。`device fixture operation=prepare` 在指定现存数据库新建唯一测试表，接收 rows（字符串键值对象）；inspect 验证所有 id/value，cleanup 在写事务内复核所有行后只删除这张表。原表不改；夹具被其他写入者改变则拒绝清理，保留所有权回执。进程中断的 intent 不会盲目重放。

`device scenario` 支持 background、grant/revoke（需 bundle/permission；仅调试包）及 clear_data（需 allow_data_reset）。后台与权限命令回执不声称业务已经响应；用 ui assert/windows 或业务断言核实。前台由 `run launch` 完成。`device trace seconds/categories` 导出官方原始 hitrace，保留无事件/失败结果。

项目可显式声明 prepare/cleanup 和 command 检查，命令为 `{file,args,cwd,timeout_ms}`，不接受 shell 字符串；cwd 限工程内真实路径。prepare 必须配 cleanup。只在 `allow_commands:true`/`--allow-commands` 时运行；这是执行项目代码的明确授权，**不是安全沙箱**。命令需要输出 JSON `{verdict:"passed|failed|blocked|inconclusive",...}`，退出 0 不足以通过。prepare 失败或取消后仍用独立限时信号清理；清理失败验收失败。HTTP mock、错误响应、feature flag、测试账号由工程测试接口实现；不注入任意应用内存或安装全局代理。

`project entries` 列出声明的 Ability、Extension、skills/URI、静态快捷方式、form 尺寸和 formConfigAbility 及来源候选行。图谱沿 Extension 的 `ohos.extension.form` 和 Ability 的 `ohos.ability.shortcuts` metadata 解析 profile，只返回引用的配置及资源变体候选。缺失引用单独报告；未引用的配置不作为入口。`module` 是构建模块名，`module_name` 是安装模块名。`exported` 未填按 SDK 默认 false 处理，私有 Ability 不生成外部启动句柄；公开 Ability 不因缺少 skills 被排除。所有句柄均未运行验证，main 不保证启动成功。Extension 不伪装成可启动 UIAbility。`run launch want={uri,action,parameters}` 支持字符串/int32/boolean；参数整体引用。卡片配置检查不代替宿主添加、刷新、交互和移除；正式夹具与桌面用例见 test/README.md。

`ui action=form` 复用系统桌面的可识别控件；不提供独立卡片渲染器，也不宣称锁屏/负一屏可用。

- `form_action=inventory` 返回实例字符串 ID、bundle、所在页、边界和可见文本；默认最多 12 页，可设 max_pages（1–30），complete=false 表示不能确认清点完整。像素边界不换算成声明尺寸。
- `catalog` 需要 project（可选 product）或 bundle，返回系统卡片中心的 form_index。预览序号不是声明标识。`exercise` 添加指定预览，按前后差集定位唯一新实例，关联显式 formId 的日志并清理。应用日志仅作为原始证据，不按专有错误码推断业务根因；声明匹配缺字段或资源变体不明确时保留候选。
- `form_size="2*4"` 只操作宿主明确暴露的尺寸控件，找不到就报不支持，不换用别的尺寸。实际尺寸证据与请求参数分开返回。
- `then_flow` 可运行工程定义的交互、配置页和内容断言；flow 必须 start.mode=attach、无必填变量，且至少包含一个显式 visible/hidden 断言。MCP 不内置这些业务预期。verify 的 form check 使用同一 exercise，只有新增实例、旧实例保护、清理和工程断言都有证据时该检查才能 passed；未提供 then_flow 为 inconclusive。这个判定只覆盖该工程声明的断言。
- `matrix` 接受 form_cases，每项显式给 target 或 emulator={device_type,os_version}（二选一）以及 form_index，可选 form_size。真机/已有模拟器仅使用所选目标；一次性模拟器要求 project，并复用构建部署流程，仅使用已安装的匹配镜像，不下载或自动接受许可。按 case 查看 status/result/error；编排 job 完成不代表全部 case 通过。
- 清理只处理本次新增卡片或创建的模拟器，不删除已有实例。失败/取消使用独立限时信号清理一次，失败保留错误和定位信息，不无限重试。进程中断产生的不确定副作用不能强制重放。资源占用返回 RESOURCE_BUSY。

`device log` 先按查询条件过滤，再应用返回条数限制；普通、时间窗口与 follow 均有扫描上限并返回 scan。follow 游标包含同毫秒内的序号，消费未匹配行以避免重复轮询；它只覆盖仍存在于设备日志缓冲区且在扫描范围内的记录，possibly_truncated=true 时不能声称完整。

`code origin key|text|file,line` 给 literal-id/text 静态候选与 Git changed/blame 信息，明确 runtime_identity_verified=false。`knowledge search/read project/product` 保留编译、目标、最低兼容 SDK 的区别；知识包缺乏逐段 since/deprecated 元数据时报告 unknown，不按最低兼容 API 丢弃文档。精确签名仍以工程 SDK 声明为准。

## 占用、恢复与审计

跨进程工程/设备占用在默认 `~/.deveco-mcp/coordination`，独立 state_dir 不绕过它。显式 DEVECO_COORDINATION_DIR 选另一个协调域，所有共享设备的参与进程应一致。旧版本 MCP、外部 hdc/DevEco 不受此锁约束。冲突立即返回 RESOURCE_BUSY，无队列/自动抢占。`job resources` 查占用；死 owner 先检查副作用，再 `job release_resource resource owner_pid`；仍活着只能取消所属 job。签名补偿仍在锁内执行，嵌套验收沿用同一 owner。

操作审计在 state/audit/operations.jsonl，含会话、PID、工程/设备资源、job、build_id、阶段。DEVECO_CALLER 只是声明，不冒充认证身份；不记录 SQL/凭据参数。verify 只导出本次 owner 的审计快照，job 完成回执仍在任务日志中。新 UI test_step/review 使用 checklist_item（1 起），覆盖完整计划才可通过；有操作没有断言不能覆盖条目。
