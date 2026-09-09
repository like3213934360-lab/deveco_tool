# 合入 main 后的验收证据核对

核对日期：2026-09-09；基准提交 `943fb3d`。初次逐项核对只读取迁移矩阵、它引用的 19 份凭证、两份上游接收凭证和历史记录。后续已恢复非真机测试，下载核对 main 六组 CI 原始报告，并刷新 16 项凭证；新增结果见[完成清单](native-completion.md)末尾。下表专项结果仍为历史复核线索，未读取全部私有报告，不据此关闭剩余范围。

## 清单与凭证身份

[迁移矩阵](../provenance/migration-matrix.json) 共 47 行（40 个旧工具、7 个旧脚本）：28 行 pending、19 行 verified。330 个参数与 95 个动作已有迁移归类；归类与接口存在不等于行为验收通过。

19 行现有凭证中，16 行已刷新到 main `bc68e0c` 的当前运行/编译身份，其余 3 行仍为 dev22。下面列出每一行及当前引用的凭证；28 行 pending 不代表缺少 28 项实现。

| 迁移项 | 凭证快照 | 当前凭证 |
| --- | --- | --- |
| `tools:apply_changes` | dev22 | [凭证](../provenance/migration-acceptance/e47982e4c533399eac33188e2194273fe1b2d1f2968a3931708182ef605d3f8a.json) |
| `tools:arkts_check` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/e3e5405980513ce1c4670b513286d7713aadd41a04228426885f4558b51fbca6.json) |
| `tools:build_project` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/68cdd09bbd924453c7085f61f7b944041d0887974fed5a9b2e7e38701aed0234.json) |
| `tools:check_cpp_files` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/63a458511ce6999ee6a78f2270d9f67f2878c30f659664ee49457d868227f13e.json) |
| `tools:check_ets_files` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/55cacf2c960909249203a88cea295bf538064087a37957cc89583d7fb92ade3b.json) |
| `tools:deveco_login` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/08800a138f58bf667ac3179f392a54e67872ab570a5f2c182a8022a4606d1226.json) |
| `tools:deveco_logout` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/e2028dba4d1fc843b80cb8a76adf47075d85c5f2f0632ec6bf2a4ab589477fb3.json) |
| `tools:deveco_restart` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/a1d9ba030fd21fa9d8059d4ac16dafffa1ab2e1981a2aad999a4698f68043409.json) |
| `tools:go_to_definition` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/fee576f7d59bf4e42583395a8712afc1b533920042e8223aacad653f4cff5b97.json) |
| `tools:harmony_docs` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/017ecefa115e88a86574caad1113a6766ea6c934635f9bf9792490711dfd6e50.json) |
| `tools:hot_reload` | dev22 | [凭证](../provenance/migration-acceptance/c11fe42aaf1385d5e691cc2c94a6cdc12ca9c210309a4551e7802efee3328cb2.json) |
| `tools:project_sync` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/ff63f7a7b5485bdc45f52c73be549ad5f872bac80e132160af92a41f6edbc00c.json) |
| `tools:start_app` | dev22 | [凭证](../provenance/migration-acceptance/fee244830b8e1ba1c78ad2649279d882348f88f3e874a3891f92657526901218.json) |
| `tools:switch_cwd` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/c37a7deb13cbfcf3c3b65b3a7339c35a75a8d2c750c0381e44d5b042d1255a0e.json) |
| `tools:verify_ui` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/0bc84db932625386294b35ca072e356e9e8cdf745a0acc2d76c373012b05385a.json) |
| `scripts:copy_template` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/ab93fef0b1986a30ba55dc942678470fb4665b25b4eeb6e804e229ee4da61015.json) |
| `scripts:detect_sdk` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/23e7749b44918522d3a7599f8992c423b95dac9e98c245755181eadb6451ecb6.json) |
| `scripts:jscrash_report` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/6e8181654567a6f8f8df097c5501ed6fc23884de50a78c15762e75ac17965689.json) |
| `scripts:parse_jscrash_log` | main `bc68e0c` | [凭证](../provenance/migration-acceptance/5bb235252ad4472759afd2661273866aedc433ecd4de29738764884b7b135413.json) |

快照身份：

- main `bc68e0c`：运行摘要 `85a5e037aced7c71722bacd370dbcd727f990d623d39efff0d07e01c2d97caa7`，编译摘要 `c9fc32c404153e7094aa879bbd4d5d67e4517b476824fbac66209cca19dd9a48`，共 16 行。
- dev22：运行摘要 `0adac632b689bf66af02e807119dcdc70e71dee617cd00df25cb969f9f8372a1`，编译摘要 `5e3a48daa0881876eea7c35a1aabf9858d660d0d1e06028ee6402abce004b69e`，共 3 行。
- dev27：运行摘要 `b26deea68ae317436aafee4d904b410a415c8719ba1cdede068b627b92fbb24b`，编译摘要 `8ad78c9793841d8379cdbaa44876aeaa129ee54539ea5c5a6d554b6bb79df296`；仅两份上游凭证仍使用此身份，迁移凭证中已无此快照。

[deveco-code](../provenance/upstream-baselines/deveco-code/accepted.json) 与 [deveco-cli](../provenance/upstream-baselines/deveco-cli/accepted.json) 的现有上游接收凭证也绑定上述 dev27 身份，需在最终冻结后按正式流程刷新。

## 28 行 pending 的逐项范围

“矩阵剩余要求”与当前矩阵同步。设备属性和 UI driver 的六组当前 CI 已核对，已从 remaining 移除这两条已完成子项，原记录保留在历史提交和完成清单；其中“最终性能门槛”指旧清单措辞，5% 相对耗时阈值现已改为观察项，不再单独阻止接收或发布。原始采样、语义验证和其他行为范围仍需逐项核对。历史记录可能已覆盖其中一部分，但本次不据此删减行为要求。专项线索来自[完成清单](native-completion.md)的 dev22/dev27、电脑端验收段落及[UI 性能记录](native-ui-performance.md)。

| 迁移项 | 矩阵剩余要求 | 已有记录与需要核对的边界 |
| --- | --- | --- |
| `tools:api_compat_check` | 更多 SDK/API 版本数据组合与扫描范围验收 | 当前 main `bc68e0c` 已重验 13 项：已安装数据目录、24→26 与最早/最近→最新版本组合、文件/模块/工程及混合语言范围、四类拒绝边界；仍只覆盖本机同一 Studio 扫描器。 |
| `tools:app_signature` | 真实云端变更中断后的外部状态核对、过期认证刷新和更多签名类型；原 force 与自动签名选择策略对照 | dev22/dev27 有个人签名与验签记录；真实过期、云端中断和更多签名类型仍缺。 |
| `tools:arkts_knowledge_search` | 云端过期认证重试与异常响应回归 | dev22/dev27 有实际 MCP 认证及云知识读取记录；未覆盖真实过期认证。 |
| `tools:code_lint` | 更多 SDK/CLT 实机规则执行范围验收；原生空报告不证明全部配置规则已生效，返回 ruleCoverageVerified:false | 当前 main `bc68e0c` 已重验本机 Linter 6 项，包括规则缺陷、显式修复、报告截断、非法配置及 Git 增量；空报告不能证明所有配置规则生效，其他 SDK/CLT 仍缺。 |
| `tools:deveco_cli_auth` | 实际过期凭据刷新及云端拒绝/登出验收；不同操作系统浏览器支持范围 | 历史双提供方回调生命周期有 7 项记录；真实过期 JWT、401 与其他系统浏览器仍缺。 |
| `tools:deveco_doctor` | 三操作系统与 CLT 布局验收 | 本次未发现足以关闭所列范围的专项记录；保留 pending。 |
| `tools:deveco_script` | 见 scripts 七项验收记录 | 汇总项；依赖 scripts 七行，其中四行已有旧凭证、三行仍 pending。 |
| `tools:deveco_script_catalog` | 见 scripts 七项验收记录 | 汇总项；依赖 scripts 七行，其中四行已有旧凭证、三行仍 pending。 |
| `tools:deveco_status` | 真实过期 Token 与离线行为 | main `fa5ed60` 已通过 macOS 进程级断网下的生产 MCP 状态读取、云端刷新失败后凭据保留，以及联网重启后实际刷新；JWT 未过期，真实过期和其他系统仍缺。 |
| `tools:device_info` | 真实多设备及跨平台 HDC/SDK 验收 | main `bc68e0c` 六组当前 CI 已执行设备属性/清单回归；dev27 的 14 项手机只读仍是历史记录。真实多设备与其他平台 HDC/SDK 仍缺。 |
| `tools:emulator_manage` | 真实镜像下载/卸载、协议接受及组件异常/取消恢复验收；三平台真实模拟器及与目标设备 UI 共同资源协调验收 | 历史有实例生命周期 7 项；不覆盖所有镜像、组件异常或三平台。 |
| `tools:emulator_scenario` | 应用实际感知传感器/场景结果及原生命令取消结果验收；与目标设备 UI 共同资源协调验收 | dev22/dev27 有电量效果及 UI 竞争/取消 12 项、光照 5 项记录；湿度、温度不可用未计通过。需核对当前所需场景及映射检查。 |
| `tools:find_references` | 跨平台和最终性能验证；相对路径、未同步文件和去声明回归已通过 | main `bc68e0c` 有连续多产品/目标/模块 LSP 专项记录；更广实际平台和完整性能采样仍缺。 |
| `tools:get_app_ui_tree` | 真实多显示器与多窗口属性完整对照；简化树和父子层级已实现 | 本次未发现足以关闭所列范围的专项记录；保留 pending。 |
| `tools:get_hover` | 跨平台和最终性能验证；合法空结果及位置边界已通过 | main 查询诊断 LSP P95 为旧版 1.075 / 新版 2.572 ms；`bc68e0c` 的真实 SDK 与连续多模块 LSP 已复验，完整采样仍缺，5% 比值不再作为硬性门槛。 |
| `tools:hdc_log` | 真实设备 Hilog、整行筛选性能、默认 app/core buffer 清空和 faultlog 读取验收 | dev22/dev27 有实际 MCP Hilog 14 项记录；物理手机清空、超大 faultlog 截断及性能仍缺。 |
| `tools:lsp` | 跨平台与更广 SDK 组合的语言会话验收、最终性能门槛 | main `bc68e0c` 有 45 项连续多产品/目标/模块正反例记录；更广实际 SDK/平台和完整性能采样仍缺。 |
| `tools:perform_ui_action` | 真实设备中文输入及多显示器路由验收；原生滚动采样的实际设备结果验证 | 历史有中文输入和手势 25 项记录；需核对滚动路径及真实多显示器。 |
| `tools:ui_control` | 所有手势路径与真实多显示器验收；专用应用中文输入、窗口定位和点击已通过 | dev22/dev27 有手势 25 项记录；单显示器不能关闭多显示器要求。 |
| `tools:ui_find` | 真实多显示器、实时获取及其他选择器的完整直接能力性能门槛；固定文件精确 key 查询已在本机 Node 22/24 各三轮通过 | 历史九组离线精确 key 的 P95 通过；不含实时获取、其他选择器及完整性能。 |
| `tools:ui_flow` | 未知目标自动录制的真实设备验收；入口选择、并发去重、重启、最终断言回归及提交 1ecafae 六组跨平台 CI 已通过；录制期间热重载等长期会话对 UI 状态的干扰协调 | 历史录制/重放 17 项、选择器修复 9 项；main `bc68e0c` 的 MCP 已读取并校验十份既有流程，原字段和文件字节不变，现存文件迁移子项已完成。当前设备重放、未知目标录制及录制/热重载协调仍需对应场景证据。 |
| `tools:ui_inspect` | 真实多显示器与更复杂窗口/浮层布局验收；单设备层级和批量读取已通过 | 历史单显示器旋转不证明多显示器或复杂浮层布局。 |
| `tools:ui_observe` | 实际多显示器与旋转验收；图像和树联合获取的固定输入性能门槛 | 历史旋转及图片/树坐标 8 项仅覆盖 display 0；联合获取完整性能仍缺。 |
| `tools:ui_snapshot` | 实际多显示器与旋转验收；图像和树联合获取的固定输入性能门槛 | 历史旋转及图片/树坐标 8 项仅覆盖 display 0；联合获取完整性能仍缺。 |
| `tools:ui_tap` | 真实多显示器手势与最终性能门槛；专用应用中文输入、点击、录制和重放已通过 | 历史中文输入、录制/重放及手势已有专项记录；真实多显示器和最终性能仍缺。 |
| `scripts:collect_hilog` | 真实设备日志采集及直接能力性能验收 | 历史实际 MCP Hilog 14 项可供复核；直接能力性能仍缺。 |
| `scripts:fetch_faultlog` | 真实设备命名 faultlog、时间范围、权限与截断边界验收 | 历史真实命名 faultlog 及时间范围已有专项记录；更多权限/截断边界仍缺。 |
| `scripts:probe_faultlogger` | 真实设备命名 faultlog、时间范围、权限与截断边界验收 | 历史真实命名 faultlog 及时间范围已有专项记录；更多权限/截断边界仍缺。 |

## 收敛顺序与接收条件

本轮补充：main `bc68e0c` 的六组 CI 原始报告、本机 SDK 24 项、静态检查 13 项、连续多产品/目标/模块 45 项及真实 SDK/OHPM 中断恢复 5 项均已核对。12 项迁移凭证已通过正式接收器刷新；两项 pending 中已完成的 CI 子项已移除，28 行 pending 数量不变。私有中断驱动和原始报告的摘要已核对并单独保存，未冒充仓库映射入口；其中构建和同步凭证注明了补充报告摘要。此前离线 6 项报告仍绑定其原编译身份。 随后当前 MCP/Worker 完成历史交错 Hilog 原文重放、6 项栈帧对照与 1 项历史命名 faultlog 本地重放、9 份完整知识及 45 项模式检查，刷新两项崩溃解析凭证，累计 14 项。历史采集字节与本轮解析执行分别记录，不声明重新从设备获取日志；手机和模拟器均未访问。双提供方真实回调生命周期 7 项（含 300.75 秒自然超时）及 Developer 实际 MCP 认证/云端只读清单 9 项随后通过，登录凭证刷新后累计 15 项；真实过期认证仍未验证。随后专用模拟器的图片/报告协议 8 项通过，`verify_ui` 凭证刷新后累计 16 项；外层驱动关闭后再次查询数据库的失败单独保留，新的只读实例已确认模拟器停止。

1. 冻结候选源码及编译身份，优先处理功能故障、数据正确性、资源泄漏及安装交付。hot status、LSP、flow catalog 的延迟保留为观察项，不再为达到未经用户认可的 1.05 比值而持续修改运行代码。
2. main `bc68e0c` 的六组基础回归及各 10 项干净安装通过，Windows Node22/24 原生进程检查各 20 轮通过；整轮 CI 仍受上游门禁阻止。需核对候选身份的非真机矩阵并汇报，之后执行真机签名包集合部署、跨模块热补丁、录制与热重载协调、一小时活动及六分钟空闲回收。
3. 按上表定位私有原始报告，逐项核实实际覆盖、通过状态、映射检查入口及编译/依赖/资源/上游锁身份。更多 SDK/CLT、真实过期认证、云端中断、多设备/多显示器及模拟器异常仍按实际环境验收。
4. 只有该行全部场景具备最终同版证据时才通过 `migration-accept` 接收；剩余 3 行旧凭证和两份上游凭证也按此原则刷新。原始失败和历史通过报告保留。
5. 当前候选的真实宿主安装与 Codex 应用内重连已确认，双提供方重新登录及云端只读复验分别通过 9/10 项。补齐其余同版发布证据后交付正式发布包及 Release；当前安装成功不解除以上条件。
