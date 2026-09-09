# 合入 main 后的验收证据核对

核对日期：2026-09-09；基准提交 `943fb3d`。初次逐项核对只读取迁移矩阵、它引用的 19 份凭证、两份上游接收凭证和历史记录。后续已恢复非真机测试，下载核对 main 六组 CI 原始报告，并刷新 16 项凭证；新增结果见[完成清单](native-completion.md)末尾。下表专项结果仍为历史复核线索，未读取全部私有报告，不据此关闭剩余范围。

## 清单与凭证身份

[迁移矩阵](../provenance/migration-matrix.json) 共 47 行（40 个旧工具、7 个旧脚本）：28 行 pending、19 行 verified。330 个参数与 95 个动作已有迁移归类；归类与接口存在不等于行为验收通过。

19 项已有凭证中，6 项绑定 `579449e` 的 `cc3cdfd1` / `a3763ec3` 身份，10 项仍绑定相同运行源码、较早测试构建的 `cc3cdfd1` / `680bf03b`，3 项绑定 dev22。构建、同步、两项崩溃解析、认证回调和模拟器图片协议已按各自范围完成本轮复验；没有将历史凭证自动沿用。下面列出每一行及当前引用的凭证；28 行 pending 不代表缺少 28 项实现。

| 迁移项 | 凭证快照 | 当前凭证 |
| --- | --- | --- |
| `tools:apply_changes` | dev22 | [凭证](../provenance/migration-acceptance/e47982e4c533399eac33188e2194273fe1b2d1f2968a3931708182ef605d3f8a.json) |
| `tools:arkts_check` | main `ddec5d8` | [凭证](../provenance/migration-acceptance/fdcea7f5b3b331fb411c2b0e19ddd4e83fa5565c9f4b630d8dbf13d2c88372f6.json) |
| `tools:build_project` | main `579449e` | [凭证](../provenance/migration-acceptance/1718a5735476756ee876892f1e188f14c55dcb80b1342926ace3bcde3143272d.json) |
| `tools:check_cpp_files` | main `ddec5d8` | [凭证](../provenance/migration-acceptance/9a1050f1f70adcac4cb2b49f876ce3c89106e116c6b7d4b4faac0cdbbf29d370.json) |
| `tools:check_ets_files` | main `ddec5d8` | [凭证](../provenance/migration-acceptance/55420e83516d3181ec3510041cfc2defafc9616c816b66b68df4c43717c98f60.json) |
| `tools:deveco_login` | main `579449e` | [凭证](../provenance/migration-acceptance/268b8ca6c0d8422ecf4ea06d0c22f25d06a140c92095c9ae148a6d9cea0bc59d.json) |
| `tools:deveco_logout` | main `ddec5d8` | [凭证](../provenance/migration-acceptance/ffdbe53836bbadcaabdc6c58a7f23cae1e23e508a43400c845eb6e6a3560a0ac.json) |
| `tools:deveco_restart` | main `ddec5d8` | [凭证](../provenance/migration-acceptance/9cc52efe7598cae4e643368ef0f60f5918807d45c15e5b77aefd7f1f2b046fbb.json) |
| `tools:go_to_definition` | main `ddec5d8` | [凭证](../provenance/migration-acceptance/d98756a2e102542b8949c79c071daae26952dcd5cfe37c1265bd10b7bb00f01b.json) |
| `tools:harmony_docs` | main `ddec5d8` | [凭证](../provenance/migration-acceptance/2cf47cee3c1c9a0432f6074dfcabd7f5beee857ad94270672acdb791089fd608.json) |
| `tools:hot_reload` | dev22 | [凭证](../provenance/migration-acceptance/c11fe42aaf1385d5e691cc2c94a6cdc12ca9c210309a4551e7802efee3328cb2.json) |
| `tools:project_sync` | main `579449e` | [凭证](../provenance/migration-acceptance/3f7239d98a2b041d80d464ec427de0ab4f0e0c0b82544a62b573f40601696f9c.json) |
| `tools:start_app` | dev22 | [凭证](../provenance/migration-acceptance/fee244830b8e1ba1c78ad2649279d882348f88f3e874a3891f92657526901218.json) |
| `tools:switch_cwd` | main `ddec5d8` | [凭证](../provenance/migration-acceptance/ee76dbb6824dd101de1f0df78fb474849cda893acdaba463e68544e2ecc8920d.json) |
| `tools:verify_ui` | main `579449e` | [凭证](../provenance/migration-acceptance/122bbdacd58f3470d5dd7960f8384b25c19706ec70845e143ffc29e76d56c14a.json) |
| `scripts:copy_template` | main `ddec5d8` | [凭证](../provenance/migration-acceptance/a94e53ed23f803cd4c03c1656aeb5a68c7270c19f08b67ab37595a3047fdf2ce.json) |
| `scripts:detect_sdk` | main `ddec5d8` | [凭证](../provenance/migration-acceptance/f720d609454b764b0715c7907cd17c1289e4e78f9ff9b6c1ca625bd628ae649d.json) |
| `scripts:jscrash_report` | main `579449e` | [凭证](../provenance/migration-acceptance/626cfdf158929a467179a2aae1f71e8b42b276bca21da0cdd5ca007359947dad.json) |
| `scripts:parse_jscrash_log` | main `579449e` | [凭证](../provenance/migration-acceptance/c073cfdc77db3ddf60fb007deebf18487030dbb5344bcf78055d3381b2e398c7.json) |

快照身份：

- main `579449e`：运行摘要 `cc3cdfd12b284fc5e85e657dac863a6cde184b18369844d9bf52336b3f903310`，编译摘要 `a3763ec3934982b406594372e5e5469b0b7f9e6d22848f3962e2621eccdb364b`，共 6 行；与下项的运行源码相同，仅新增测试改变完整编译身份。
- main `ddec5d8`：运行摘要 `cc3cdfd12b284fc5e85e657dac863a6cde184b18369844d9bf52336b3f903310`，编译摘要 `680bf03b1d0f8d0c9403861be551d4d9bd8d8e727d44cb4df68f75d9517d27b6`，共 10 行。
- dev22：运行摘要 `0adac632b689bf66af02e807119dcdc70e71dee617cd00df25cb969f9f8372a1`，编译摘要 `5e3a48daa0881876eea7c35a1aabf9858d660d0d1e06028ee6402abce004b69e`，共 3 行。
- dev27：运行摘要 `b26deea68ae317436aafee4d904b410a415c8719ba1cdede068b627b92fbb24b`，编译摘要 `8ad78c9793841d8379cdbaa44876aeaa129ee54539ea5c5a6d554b6bb79df296`；仅两份上游凭证仍使用此身份，迁移凭证中已无此快照。

[deveco-code](../provenance/upstream-baselines/deveco-code/accepted.json) 与 [deveco-cli](../provenance/upstream-baselines/deveco-cli/accepted.json) 的现有上游接收凭证也绑定上述 dev27 身份，需在最终冻结后按正式流程刷新。

## 28 行 pending 的逐项范围

“矩阵剩余要求”与当前矩阵同步。设备属性和 UI driver 的六组当前 CI 已核对，已从 remaining 移除这两条已完成子项，原记录保留在历史提交和完成清单；其中“最终性能门槛”指旧清单措辞，5% 相对耗时阈值现已改为观察项，不再单独阻止接收或发布。原始采样、语义验证和其他行为范围仍需逐项核对。历史记录可能已覆盖其中一部分，但本次不据此删减行为要求。专项线索来自[完成清单](native-completion.md)的 dev22/dev27、电脑端验收段落及[UI 性能记录](native-ui-performance.md)。

| 迁移项 | 矩阵剩余要求 | 已有记录与需要核对的边界 |
| --- | --- | --- |
| `tools:api_compat_check` | 更多 SDK/API 版本数据组合与扫描范围验收 | main `bc68e0c` 快照 已重验 13 项：已安装数据目录、24→26 与最早/最近→最新版本组合、文件/模块/工程及混合语言范围、四类拒绝边界；仍只覆盖本机同一 Studio 扫描器。 |
| `tools:app_signature` | 真实云端变更中断后的外部状态核对、过期认证刷新和更多签名类型；原 force 与自动签名选择策略对照 | 当前真实证书创建被个人团队配额拒绝，未进入中断窗口；实际拒绝、同请求去重、重启后失败状态和清单保留 4 项通过，见完成清单。dev22/dev27 签名与验签仍是历史记录；真实过期、变更中断和更多类型仍缺。 |
| `tools:arkts_knowledge_search` | 云端过期认证重试与异常响应回归 | dev22/dev27 有实际 MCP 认证及云知识读取记录；未覆盖真实过期认证。 |
| `tools:code_lint` | 更多 SDK/CLT 实机规则执行范围验收；原生空报告不证明全部配置规则已生效，返回 ruleCoverageVerified:false | 当前 `ddec5d8` 的 Studio 和 Mac/Windows/Linux CLT 各 6 项通过，包括规则缺陷、显式修复、报告截断、非法配置及 Git 增量；仍不把空报告扩大为所有配置规则已生效。详见工具链记录。 |
| `tools:deveco_cli_auth` | 实际过期凭据刷新及云端拒绝/登出验收；不同操作系统浏览器支持范围 | 历史双提供方回调生命周期有 7 项记录；真实过期 JWT、401 与其他系统浏览器仍缺。 |
| `tools:deveco_doctor` | 三操作系统与 CLT 布局验收 | 当前已有三平台 CLT 包布局、组件入口及 SDK 检查报告；综合 SDK 的 LSP/API 组件缺口仍保留，尚未以完整 doctor 场景接收此行。 |
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

当前补充：构建、同步、两项崩溃解析、登录和图片协议的 6 份凭证已通过正式接收器刷新至 `cc3cdfd1` / `a3763ec3`，计划和专项核对在 `preparation/migration-refresh-579449e-1`。此前 10 份 `cc3cdfd1` / `680bf03b` 凭证保留其测试身份；剩余 3 份 dev22 凭证仍待真机阶段刷新。矩阵仍为 19 行 verified、28 行 pending；不表示最终验收完成。

本轮补充：main `bc68e0c` 的六组 CI 原始报告、本机 SDK 24 项、静态检查 13 项、连续多产品/目标/模块 45 项及真实 SDK/OHPM 中断恢复 5 项均已核对。12 项迁移凭证已通过正式接收器刷新；两项 pending 中已完成的 CI 子项已移除，28 行 pending 数量不变。私有中断驱动和原始报告的摘要已核对并单独保存，未冒充仓库映射入口；其中构建和同步凭证注明了补充报告摘要。此前离线 6 项报告仍绑定其原编译身份。 随后当前 MCP/Worker 完成历史交错 Hilog 原文重放、6 项栈帧对照与 1 项历史命名 faultlog 本地重放、9 份完整知识及 45 项模式检查，刷新两项崩溃解析凭证，累计 14 项。历史采集字节与本轮解析执行分别记录，不声明重新从设备获取日志；手机和模拟器均未访问。双提供方真实回调生命周期 7 项（含 300.75 秒自然超时）及 Developer 实际 MCP 认证/云端只读清单 9 项随后通过，登录凭证刷新后累计 15 项；真实过期认证仍未验证。随后专用模拟器的图片/报告协议 8 项通过，`verify_ui` 凭证刷新后累计 16 项；外层驱动关闭后再次查询数据库的失败单独保留，新的只读实例已确认模拟器停止。

1. 冻结候选源码及编译身份，优先处理功能故障、数据正确性、资源泄漏及安装交付。hot status、LSP、flow catalog 的延迟保留为观察项，不再为达到未经用户认可的 1.05 比值而持续修改运行代码。
2. main `579449e` 的六组基础回归及各 10 项干净安装通过，Windows Node22/24 原生进程检查各 20 轮通过；整轮 CI 仍受上游门禁阻止。需核对候选身份的非真机矩阵并汇报，之后执行真机签名包集合部署、跨模块热补丁、录制与热重载协调、一小时活动及六分钟空闲回收。
3. 按上表定位私有原始报告，逐项核实实际覆盖、通过状态、映射检查入口及编译/依赖/资源/上游锁身份。更多 SDK/CLT、真实过期认证、云端中断、多设备/多显示器及模拟器异常仍按实际环境验收。
4. 只有该行全部场景具备最终同版证据时才通过 `migration-accept` 接收；剩余 3 行旧凭证和两份上游凭证也按此原则刷新。原始失败和历史通过报告保留。
5. 较早 `bc68e0c` 候选的真实宿主安装与 Codex 应用内重连已确认，双提供方重新登录及云端只读复验分别通过 9/10 项。仍需将宿主统一到最终版本，补齐其余同版发布证据后交付正式发布包及 Release；当前安装成功不解除以上条件。
