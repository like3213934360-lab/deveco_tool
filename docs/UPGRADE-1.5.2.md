# v1.5.2 多设备中指定仪器测试目标

原 Instrument Test 实现虽然接受 target，却因 SDK onDeviceTest 未提供目标参数而要求只连接一台设备。这是 MCP 的能力缺口，不是模拟器不支持的证据。用户要求本轮只操作专用模拟器，真机继续在线供用户使用。

## 实现与范围

沿用现有 target 解析和资源锁。每个仪器测试任务创建独立 loopback HDC 通道，仅向 hvigor 子进程传 OHOS_HDC_SERVER_PORT，将 SDK 的 any connect-key 改为已解析目标；服务器握手、版本、命令结果及二进制传输保持原样。设备仍连接到原 HDC server，不执行 spawn-sub、kill 或 disconnect，不修改 SDK、全局环境或设备安全设置。

根据 [OpenHarmony HDC ChannelHandShake](https://github.com/openharmony/developtools_hdc/blob/master/src/common/channel.h) 校验 44/108 字节握手，并拒绝不同显式目标、全局服务器操作、未知协议及异常帧。握手超时明确失败；任务结束、取消关闭连接与端口。支持 SDK 当前使用的 shell/install/uninstall/file send/recv，不把未知新协议静默透传。该通道是目标路由，不是安全沙箱。

多设备必须选 target；单设备仍可解析唯一目标。目标失联不回退，其他参与同机锁的 MCP 任务不能抢占所选设备。测试仍需专用应用、allow_data_reset=true 和真实签名；严格保留测试数、scope、Ignore、失败/错误、新报告和覆盖率判定。doctor 的 ready_for_attempt 只证明前置条件可尝试。

## 验收

- 类型检查与离线回归 286/286 通过，18.939 s；新增 10 项协议测试覆盖并发目标、分包/粘包、192 KiB 二进制数据、错误目标/全局命令、异常握手、真实握手超时、上游不可用与取消端口释放。协议夹具不代表真实 SDK 通过。
- 真机与模拟器同时连接，在 API 26 模拟器上真实 SDK Instrument 正例 1 pass，故意失败例 1 failure（SDK exit 0，MCP verdict=failed）。每次记录 9 条目标通道命令。连接列表前后相同；未在真机上安装、卸载、运行测试或操作 UI。
- 多设备未指定目标和不存在目标分别失败 DEVICE_AMBIGUOUS/DEVICE_UNAVAILABLE；显式模拟器的 doctor Instrument 项为 ready_for_attempt。
- 模拟器场景 6/6：入口与 Want、数据库发现及独占夹具冲突/清理、grant/revoke、保留安装清数据、官方 trace、前后台。
- 最终候选 verify 八项检查通过：clean build、Local、无覆盖率 Instrument、deploy、UI assert、严格五分钟 crash、entries、source-integrity；永久证据包 11 文件。基线/判定契约 5/5：构建/包体积/warning/静态诊断/启动、视觉比较通过；不完整 UI checklist 保持 inconclusive。
- 桌面 2×2、2×4 卡片各 1/1：原生 MCP 添加，候选独立 MCP 验证刷新、配置页、移除；不推定锁屏/负一屏或周期调度通过。

本轮首次失败均保留：测试夹具缺 ohosTest module、缺签名、签名密码需加密、错误证书链，以及新增测试错误地读取 devices 结构/未等待异步 job。只修正任务拥有的工程与测试，未修改 SDK、个人签名或设备环境来制造通过。

## 未通过与证据边界

Instrument 覆盖率仍失败：1 个用例确实通过，但 SDK 00507008 在 getInitCoverageData 解析 init_coverage.json 时发现对象结尾后的额外内容（position 64823），没有新覆盖率报告。原始文件及日志留存，MCP 返回 TEST_REPORT_MISSING。不是完整验收通过，也没有证据把它归因为模拟器不支持。

性能三轮及显式 Rows 滚动复核均无有效数据；已观察列表从 row 0 移动至 row 20，采集命令 exit 0，但 compositor 时间戳和 profiler FPS 全零。保留 inconclusive；疑似模拟器采集限制，未断言平台不支持，也未报告虚假 FPS 或流畅性。

Codex App 本轮已真实重载 1.5.1 / 7647cd93c31b；候选 1.5.2 的测试通过独立 MCP 进程执行，不代表原生宿主已加载 1.5.2。本轮现有 Codex CLI 模型评测仍 2 项实际完成、8 项审批拒绝，不修改宿主审批策略。npm 未发布。

候选构建 95efd9431634，完整身份及结果见 [脱敏证据](evidence/v1.5.2-acceptance.json)。私有证据保留全部首错、截图、SDK 原报告及 77 份引用 artifact，无缺失。专用应用/卡片、临时工程与本地签名材料已清理；本次启动的模拟器已停止，既有实例及真机连接保留。最终资源清单中另一进程持有的真机锁未触碰。

没有删除有效测试或新增运行依赖。离线用例从 276 到 286，耗时 16.153→18.939 s；协议回归增加真实 10 秒超时验证。既有验收复用显式设备类型参数，新增一个多设备仪器测试入口并登记 package/test README；上游 503 项门禁、原性能预算及 npm pack dry-run 通过。

GitHub CI/Release、模拟器验收和宿主实际构建身份分别核验；后续回执不改写上述未通过项。

## GitHub 交付

发布提交 `4dc382a147ba9f1e03a249ffecb0a4e3ec168ded` 的 [CI 38713489277](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38713489277) 七项首次全部通过，[release 38713690465](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38713690465) 成功。[v1.5.2](https://github.com/like3213934360-lab/deveco_tool/releases/tag/v1.5.2) 为稳定 Latest，tag 精确指向发布提交。下载回执与本地只读核验逐字节相同，见 [回执](evidence/v1.5.2-release.json)。后续同版本文档提交不改变发布产物与 tag，独立核验其 CI 和既有 Release。
