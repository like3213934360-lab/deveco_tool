# 合入 main 后的验收证据核对

核对日期：2026-09-09；基准提交 `943fb3d`。初次逐项核对只读取迁移矩阵、它引用的 19 份凭证、两份上游接收凭证和历史记录，未签发新凭证。后续已恢复非真机测试，并下载核对 main 六组 CI 原始报告；新增结果见[完成清单](native-completion.md)末尾。下表专项结果仍为历史复核线索，未读取全部私有报告，不据此关闭剩余范围。

## 清单与凭证身份

[迁移矩阵](../provenance/migration-matrix.json) 共 47 行（40 个旧工具、7 个旧脚本）：28 行 pending、19 行 verified。330 个参数与 95 个动作已有迁移归类；归类与接口存在不等于行为验收通过。

19 行现有凭证全部绑定历史快照。下面列出每一行及当前引用的凭证；不得把 verified 数量解释为最终 main 已验收数量。

| 迁移项 | 凭证快照 | 当前凭证 |
| --- | --- | --- |
| `tools:apply_changes` | dev22 | [凭证](../provenance/migration-acceptance/e47982e4c533399eac33188e2194273fe1b2d1f2968a3931708182ef605d3f8a.json) |
| `tools:arkts_check` | dev27 | [凭证](../provenance/migration-acceptance/df98fe013b434bd34e59f3761e03c97f96349d1de73b6ec0f1f7ab6824378015.json) |
| `tools:build_project` | dev27 | [凭证](../provenance/migration-acceptance/906b6ff7dd0b526d81d4db2a5a8d4ea40cb56b99440c12b3ca480a71cd09c231.json) |
| `tools:check_cpp_files` | dev27 | [凭证](../provenance/migration-acceptance/ae22c16cdf1c7a02c985df58d5240ef270a06947b55de864f9b6293a39594aae.json) |
| `tools:check_ets_files` | dev27 | [凭证](../provenance/migration-acceptance/a57be19b76ad0597682de35ff7fc629dca3163c8d8b68f08b3040f25b51f70ef.json) |
| `tools:deveco_login` | dev27 | [凭证](../provenance/migration-acceptance/860ad897e59e3d2f2678563ea26ce677e0fbf7f9d9b6cd87dbe4c04ecd25eadd.json) |
| `tools:deveco_logout` | dev27 | [凭证](../provenance/migration-acceptance/a449ac46d77413dc7809bac2330565c5ba09be4c284025e351e85a9953ef526d.json) |
| `tools:deveco_restart` | dev27 | [凭证](../provenance/migration-acceptance/e166ef18ef66bb8fc768225b33c24a685c5f123114f3cb9c6dbb58c04b05a4aa.json) |
| `tools:go_to_definition` | dev27 | [凭证](../provenance/migration-acceptance/deac1a3b03a95261bb3196411f9dcc4cf4587b3298136a51e08debe3162c0ddc.json) |
| `tools:harmony_docs` | dev27 | [凭证](../provenance/migration-acceptance/676cd206ef7da5c1108bda8db751497b4a974aca3f947f50bc49b34d1bcdc6cf.json) |
| `tools:hot_reload` | dev22 | [凭证](../provenance/migration-acceptance/c11fe42aaf1385d5e691cc2c94a6cdc12ca9c210309a4551e7802efee3328cb2.json) |
| `tools:project_sync` | dev27 | [凭证](../provenance/migration-acceptance/b23a9ee8d6bd09f1252473a81c79901546d73572d7cee1c586933e2b7b6f69b7.json) |
| `tools:start_app` | dev22 | [凭证](../provenance/migration-acceptance/fee244830b8e1ba1c78ad2649279d882348f88f3e874a3891f92657526901218.json) |
| `tools:switch_cwd` | dev27 | [凭证](../provenance/migration-acceptance/9cb000300c144e20cff1b53eddfd4340e63bb6f1c757432a4bc4589580ab6662.json) |
| `tools:verify_ui` | dev27 | [凭证](../provenance/migration-acceptance/4742e7ca3862745ac5b052c0fe535301936cce4e631bbab7dd22f215268e46ed.json) |
| `scripts:copy_template` | dev27 | [凭证](../provenance/migration-acceptance/5f3cc0241f85d0b129a7c1f8616888c5556bf0288f9c28553259d6ee2ab5f730.json) |
| `scripts:detect_sdk` | dev27 | [凭证](../provenance/migration-acceptance/6e7e4a3ad558401b34b3ae5fec5addabd75bb5d255dc12d9ce2ff8fb905faf78.json) |
| `scripts:jscrash_report` | dev27 | [凭证](../provenance/migration-acceptance/b7bbe0093a5844dc1af95cb49c029600987e6648e94d8db2690e585b3a8ad41a.json) |
| `scripts:parse_jscrash_log` | dev27 | [凭证](../provenance/migration-acceptance/1f2ea759bfaa589f6ee68e3fe48dd4c4baf37a0d956b78dd54c00e96622ca246.json) |

快照身份：

- dev22：运行摘要 `0adac632b689bf66af02e807119dcdc70e71dee617cd00df25cb969f9f8372a1`，编译摘要 `5e3a48daa0881876eea7c35a1aabf9858d660d0d1e06028ee6402abce004b69e`，共 3 行。
- dev27：运行摘要 `b26deea68ae317436aafee4d904b410a415c8719ba1cdede068b627b92fbb24b`，编译摘要 `8ad78c9793841d8379cdbaa44876aeaa129ee54539ea5c5a6d554b6bb79df296`，共 16 行。

[deveco-code](../provenance/upstream-baselines/deveco-code/accepted.json) 与 [deveco-cli](../provenance/upstream-baselines/deveco-cli/accepted.json) 的现有上游接收凭证也绑定上述 dev27 身份，需在最终冻结后按正式流程刷新。

## 28 行 pending 的逐项范围

“矩阵剩余要求”保留当前矩阵原文；历史记录可能已覆盖其中一部分，但本次不据此删减要求。专项线索来自[完成清单](native-completion.md)的 dev22/dev27、电脑端验收段落及[UI 性能记录](native-ui-performance.md)。

| 迁移项 | 矩阵剩余要求 | 已有记录与需要核对的边界 |
| --- | --- | --- |
| `tools:api_compat_check` | 更多 SDK/API 版本数据组合与扫描范围验收 | dev28 记录了 13 项 API 范围检查；不能推及更多 SDK/API 组合。 |
| `tools:app_signature` | 真实云端变更中断后的外部状态核对、过期认证刷新和更多签名类型；原 force 与自动签名选择策略对照 | dev22/dev27 有个人签名与验签记录；真实过期、云端中断和更多签名类型仍缺。 |
| `tools:arkts_knowledge_search` | 云端过期认证重试与异常响应回归 | dev22/dev27 有实际 MCP 认证及云知识读取记录；未覆盖真实过期认证。 |
| `tools:code_lint` | 更多 SDK/CLT 实机规则执行范围验收；原生空报告不证明全部配置规则已生效，返回 ruleCoverageVerified:false | dev28 有 6 项 Linter 检查；空报告不能证明所有配置规则生效。 |
| `tools:deveco_cli_auth` | 实际过期凭据刷新及云端拒绝/登出验收；不同操作系统浏览器支持范围 | 历史双提供方回调生命周期有 7 项记录；真实过期 JWT、401 与其他系统浏览器仍缺。 |
| `tools:deveco_doctor` | 三操作系统与 CLT 布局验收 | 本次未发现足以关闭所列范围的专项记录；保留 pending。 |
| `tools:deveco_script` | 见 scripts 七项验收记录 | 汇总项；依赖 scripts 七行，其中四行已有旧凭证、三行仍 pending。 |
| `tools:deveco_script_catalog` | 见 scripts 七项验收记录 | 汇总项；依赖 scripts 七行，其中四行已有旧凭证、三行仍 pending。 |
| `tools:deveco_status` | 真实过期 Token 与离线行为 | main `fa5ed60` 已通过 macOS 进程级断网下的生产 MCP 状态读取、云端刷新失败后凭据保留，以及联网重启后实际刷新；JWT 未过期，真实过期和其他系统仍缺。 |
| `tools:device_info` | 新设备属性与清单契约的 Node 22/24 三平台 CI；真实多设备及跨平台 HDC/SDK 验收 | dev27 有 14 项手机只读记录及六组基础 CI；多设备与其他平台真实 HDC/SDK 仍缺。 |
| `tools:emulator_manage` | 真实镜像下载/卸载、协议接受及组件异常/取消恢复验收；三平台真实模拟器及与目标设备 UI 共同资源协调验收 | 历史有实例生命周期 7 项；不覆盖所有镜像、组件异常或三平台。 |
| `tools:emulator_scenario` | 应用实际感知传感器/场景结果及原生命令取消结果验收；与目标设备 UI 共同资源协调验收 | dev22/dev27 有电量效果及 UI 竞争/取消 12 项、光照 5 项记录；湿度、温度不可用未计通过。需核对当前所需场景及映射检查。 |
| `tools:find_references` | 跨平台和最终性能验证；相对路径、未同步文件和去声明回归已通过 | dev27 有连续多产品/模块 LSP 专项记录；不能替代本行全部范围和最终性能。 |
| `tools:get_app_ui_tree` | 真实多显示器与多窗口属性完整对照；简化树和父子层级已实现 | 本次未发现足以关闭所列范围的专项记录；保留 pending。 |
| `tools:get_hover` | 跨平台和最终性能验证；合法空结果及位置边界已通过 | main 查询诊断 LSP P95 比值 2.392；`fa5ed60` 的真实 SDK 与连续多模块 LSP 已复验，正式性能未通过。 |
| `tools:hdc_log` | 真实设备 Hilog、整行筛选性能、默认 app/core buffer 清空和 faultlog 读取验收 | dev22/dev27 有实际 MCP Hilog 14 项记录；物理手机清空、超大 faultlog 截断及性能仍缺。 |
| `tools:lsp` | 跨平台与更广 SDK 组合的语言会话验收、最终性能门槛 | dev27 有 45 项连续多产品/模块正反例记录；更广平台和最终性能仍缺。 |
| `tools:perform_ui_action` | 真实设备中文输入及多显示器路由验收；原生滚动采样的实际设备结果验证 | 历史有中文输入和手势 25 项记录；需核对滚动路径及真实多显示器。 |
| `tools:ui_control` | 所有手势路径与真实多显示器验收；专用应用中文输入、窗口定位和点击已通过 | dev22/dev27 有手势 25 项记录；单显示器不能关闭多显示器要求。 |
| `tools:ui_find` | 真实多显示器、实时获取及其他选择器的完整直接能力性能门槛；固定文件精确 key 查询已在本机 Node 22/24 各三轮通过 | 历史九组离线精确 key 的 P95 通过；不含实时获取、其他选择器及完整性能。 |
| `tools:ui_flow` | 未知目标自动录制的真实设备验收；入口选择、并发去重、重启、最终断言回归及提交 1ecafae 六组跨平台 CI 已通过；原生 driver 诊断的最终跨平台快照复验；本机 Node26/24 回归和真机只读探测已通过；既有用户保存流程迁移验收；专用应用录制、MCP 重启和重放已通过；录制期间热重载等长期会话对 UI 状态的干扰协调 | 历史录制/重放 17 项、选择器修复 9 项；dev28 记录十份既有流程读取校验后字节不变。需复核迁移范围、最终平台与录制/热重载协调。 |
| `tools:ui_inspect` | 真实多显示器与更复杂窗口/浮层布局验收；单设备层级和批量读取已通过 | 历史单显示器旋转不证明多显示器或复杂浮层布局。 |
| `tools:ui_observe` | 实际多显示器与旋转验收；图像和树联合获取的固定输入性能门槛 | 历史旋转及图片/树坐标 8 项仅覆盖 display 0；联合获取完整性能仍缺。 |
| `tools:ui_snapshot` | 实际多显示器与旋转验收；图像和树联合获取的固定输入性能门槛 | 历史旋转及图片/树坐标 8 项仅覆盖 display 0；联合获取完整性能仍缺。 |
| `tools:ui_tap` | 真实多显示器手势与最终性能门槛；专用应用中文输入、点击、录制和重放已通过 | 历史中文输入、录制/重放及手势已有专项记录；真实多显示器和最终性能仍缺。 |
| `scripts:collect_hilog` | 真实设备日志采集及直接能力性能验收 | 历史实际 MCP Hilog 14 项可供复核；直接能力性能仍缺。 |
| `scripts:fetch_faultlog` | 真实设备命名 faultlog、时间范围、权限与截断边界验收 | 历史真实命名 faultlog 及时间范围已有专项记录；更多权限/截断边界仍缺。 |
| `scripts:probe_faultlogger` | 真实设备命名 faultlog、时间范围、权限与截断边界验收 | 历史真实命名 faultlog 及时间范围已有专项记录；更多权限/截断边界仍缺。 |

## 收敛顺序与接收条件

本轮补充：`fa5ed60` 同一运行/编译身份的本机 SDK 24 项、无签名部署分支的连续多产品/目标/模块 45 项，以及 macOS 离线/联网恢复 6 项均通过，详见[完成清单](native-completion.md)末尾。离线探针及报告摘要另存私有复核记录，不冒充已映射验收脚本或正式迁移凭证。28 行 pending 数量不变。

1. 先完成 hot status、LSP、flow catalog 的性能改进，再冻结最终源码及编译身份；最新 main 查询诊断的 P95 比值 1.760、2.392、1.423 均未达到 1.05 门槛。
2. main `fa5ed60` 的六组基础回归及各 10 项干净安装通过，Windows Node22/24 原生进程检查各 20 轮通过；整轮 CI 仍受上游门禁阻止。完成性能修改后需核对最终身份的非真机矩阵并汇报，之后执行真机签名包集合部署、跨模块热补丁、录制与热重载协调、一小时活动及六分钟空闲回收。
3. 按上表定位私有原始报告，逐项核实实际覆盖、通过状态、映射检查入口及编译/依赖/资源/上游锁身份。更多 SDK/CLT、真实过期认证、云端中断、多设备/多显示器及模拟器异常仍按实际环境验收。
4. 只有该行全部场景具备最终同版证据时才通过 `migration-accept` 接收；19 行旧凭证和两份上游凭证也按此原则刷新。原始失败和历史通过报告保留。
5. 完成发布门槛、最终宿主安装与连接核对，再交付正式发布包及 Release。当前合入 main 不解除以上条件。
