# v0.4.0 发布推进记录（2026-09-15）

## 已完成

- 全部工作区代码与审计资料已汇入并推送 main；原分支提交保存为 Git bundle。
- 11 个其他远程分支、4 个其他本地分支已删除，9 个草稿 PR 已关闭；候选提案原始内容归档于 [分支清理记录](audits/2026-09-15-branch-consolidation/README.md)。
- 用户明确取消一小时混合稳定性及空闲回收证据的发布硬门槛；日志打点和按需稳定性工具保留。发布清单允许省略 soak，公共验收记录必须明确 cancelled_by_user。
- 修复两项热重载回归依赖本机 Studio 的问题，使用独立工具链元数据并继续执行真实的准备检查及恢复断言。
- 本机完整回归 633/633；隔离生产依赖安装及 MCP 验证 12/12；不覆盖真实设备行为。

## 尚需完成的正式发布条件

这些是当前仓库发布校验中的实际条件，不是新增要求。稳定性取消不自动取消以下条件。

- [ ] 当前 main 在 macOS、Linux、Windows × Node 22/24 的六组回归及干净安装凭证。
- [ ] 刷新并接受当前上游基线：目前 deveco-code 基线映射身份已过期，deveco-cli 基线仍缺 accepted.json；不能将存档候选提案算成已接受升级。
- [ ] 完成当前代码的迁移接受凭证，下面的剩余场景需逐项核对；历史凭证不能直接改写为当前通过。
- [ ] 完成 release-scope 中全部专项验收及 19 项性能能力的当前证据。
- [ ] 将完整证据送入既有 release-evidence / release 发布流程。当前 GitHub 仓库没有已注册自托管执行器，本机 Docker daemon 也未运行；证据导入阶段尚无可用执行环境。
- [ ] 发布门禁通过后生成正式 ZIP、SHA-256、acceptance.json 及 v0.4.0 Release。现在的 installation-validation ZIP 仅用于安装检查。

## 迁移表当前待验收场景

| 来源 | 尚未完成的验收范围 |
|---|---|
| `tools:api_compat_check` | 更多 SDK/API 版本数据组合与扫描范围验收 |
| `tools:app_signature` | 真实云端变更中断后的外部状态核对、过期认证刷新和更多签名类型；原 force 与自动签名选择策略对照 |
| `tools:arkts_knowledge_search` | 云端过期认证重试与异常响应回归 |
| `tools:code_lint` | 更多 SDK/CLT 实机规则执行范围验收；原生空报告不证明全部配置规则已生效，返回 ruleCoverageVerified:false |
| `tools:deveco_cli_auth` | 实际过期凭据刷新及云端拒绝/登出验收；不同操作系统浏览器支持范围 |
| `tools:deveco_doctor` | 三操作系统与 CLT 布局验收 |
| `tools:deveco_script` | 见 scripts 七项验收记录 |
| `tools:deveco_script_catalog` | 见 scripts 七项验收记录 |
| `tools:deveco_status` | 真实过期 Token 与离线行为 |
| `tools:device_info` | 真实多设备及跨平台 HDC/SDK 验收 |
| `tools:emulator_manage` | 真实镜像下载/卸载、协议接受及组件异常/取消恢复验收；三平台真实模拟器及与目标设备 UI 共同资源协调验收 |
| `tools:emulator_scenario` | 应用实际感知传感器/场景结果及原生命令取消结果验收；与目标设备 UI 共同资源协调验收 |
| `tools:find_references` | 跨平台和最终性能验证；相对路径、未同步文件和去声明回归已通过 |
| `tools:get_app_ui_tree` | 真实多显示器与多窗口属性完整对照；简化树和父子层级已实现 |
| `tools:get_hover` | 跨平台和最终性能验证；合法空结果及位置边界已通过 |
| `tools:hdc_log` | 真实设备 Hilog、整行筛选性能、默认 app/core buffer 清空和 faultlog 读取验收 |
| `tools:lsp` | 跨平台与更广 SDK 组合的语言会话验收、最终性能门槛 |
| `tools:perform_ui_action` | 真实设备中文输入及多显示器路由验收；原生滚动采样的实际设备结果验证 |
| `tools:ui_control` | 所有手势路径与真实多显示器验收；专用应用中文输入、窗口定位和点击已通过 |
| `tools:ui_find` | 真实多显示器、实时获取及其他选择器的完整直接能力性能门槛；固定文件精确 key 查询已在本机 Node 22/24 各三轮通过 |
| `tools:ui_flow` | 未知目标自动录制的真实设备验收；入口选择、并发去重、重启、最终断言回归及提交 1ecafae 六组跨平台 CI 已通过；录制期间热重载等长期会话对 UI 状态的干扰协调 |
| `tools:ui_inspect` | 真实多显示器与更复杂窗口/浮层布局验收；单设备层级和批量读取已通过 |
| `tools:ui_observe` | 实际多显示器与旋转验收；图像和树联合获取的固定输入性能门槛 |
| `tools:ui_snapshot` | 实际多显示器与旋转验收；图像和树联合获取的固定输入性能门槛 |
| `tools:ui_tap` | 真实多显示器手势与最终性能门槛；专用应用中文输入、点击、录制和重放已通过 |
| `scripts:collect_hilog` | 真实设备日志采集及直接能力性能验收 |
| `scripts:fetch_faultlog` | 真实设备命名 faultlog、时间范围、权限与截断边界验收 |
| `scripts:probe_faultlogger` | 真实设备命名 faultlog、时间范围、权限与截断边界验收 |

共 28 项迁移行、48 个专项验收案例、19 项性能能力。此清单记录证据缺口，不把尚未验证的能力判定为代码故障。
