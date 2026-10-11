# 测试治理：退役与覆盖映射

来源固定为 [4b45c433925b50153dace95b167fee91dddd5fe6](https://github.com/like3213934360-lab/deveco_tool/tree/4b45c433925b50153dace95b167fee91dddd5fe6)。下列旧文件从当前树删除，历史代码在该提交可追溯，不建立副本或转发入口。覆盖去向表示场景保留，**不表示本轮实际运行通过**；当轮结果只见 [v1.4.8](UPGRADE-1.4.8.md)。当前命令只维护在 [测试指南](../test/README.md)。

旧脚本中不成立的成功判定不迁移：RPC error 不能当工具成功、空 issues 不能掩盖检查器崩溃、缺少 lsof 不能计 0、未看图不能批准 review、记录错误后不能以 0 退出。历史结论原样保留，这些修正不追溯改写旧记录。

## test/audit 的完整清单

| 删除文件 | 有效行为、失败条件与去向 / 退役理由 |
| --- | --- |
| actions.mjs | 15 工具/action schema、参数负例→integration/protocol、unit/prompt-guidance；真实动作→e2e 按能力套件。固定个人应用、自动视觉批准、接受多种成功形状的判定删除 |
| actions-flow.mjs | 流程记录/查询/重放/删除、断言必要性→integration/flows、e2e/device |
| actions-sqlite.mjs | 默认只读、显式写、真实数据效果→unit/domains、e2e/device、hotreload |
| agent-text.mjs | 历史说明逐句调查→unit/prompt-guidance、support/prompts、model 场景；某版本句号分句结果不再是活动清单 |
| agent-text.json | 历史逐句数据仅保留在来源提交；现行 tool-actions/model-scenarios/model-actions 是规范输入 |
| blank.mjs | 8 个独立真值图（含纯状态栏、灰屏、小字）→unit/domains；上游 pHash 对照不是预期值，停止克隆上游执行对照 |
| build-sync.mjs | 首次构建后加本地依赖，无手动 sync 仍需成功→e2e/project（HAR/HSP） |
| check-projects.mjs | 个人工程调查固定快照退役；检查器非零/崩溃不得变空结果，独立编译正反例→e2e/checker，现行项目检查→e2e/sdk |
| check-rules.mjs | 规则负例→fixtures/checker + e2e/checker；第一次实验误用/不生效的 runtime 形状由后续精确触发用例替代 |
| check-rules-2.mjs | 二次确认的编译/运行时边界→e2e/checker；ObjectLink 编译通过与运行判定分开 |
| check-rules-legal.mjs | 合法反例、嵌套 HAR→fixtures/checker + e2e/checker；不得只测拒绝、不测合法代码 |
| claims-check.mjs | 历史宣传文案核对→unit/prompt-guidance、model、sdk/device；保留历史结论而非句号索引 |
| claims.json | 历史清单仅 Git 保留；现行场景依照实际协议/action 维护 |
| cloud-artifact.mjs | 完整制品分页、段落数/索引/非截断→e2e/cloud |
| cloud-labels.mjs | 来源标签与独立文档重合核验→e2e/cloud；无法确认不计正确 |
| cloud-platform.mjs | official 域名和非官方来源边界→e2e/cloud、unit/domains |
| delete-mcpvalidation.mjs | 针对历史固定云证书的一次性删除，任务已结束，禁止转成周期清理；生命周期→e2e/sign-cloud |
| efficiency.mjs | 批量、热部署路径、增量预检、输出预算→unit/efficiency、e2e/device、hotreload、ui、soak；个人页面访问序列不作通用夹具 |
| hotreload-time.mjs | 三次实际补丁、屏幕效果和 ≤6000ms→e2e/hotreload；不默认换到旧硬编码模拟器 |
| kits-hover.mjs | 6 HMS + 2 OH 的真实非 any 签名、诊断→e2e/project |
| lib.mjs | 多套客户端/阶段日志/个人路径删除；稳定公共部分→support/mcp、acceptance，Node runner 负责结果与非零退出 |
| modules30.mjs | 30 模块 × 6 设备类型、唯一 privileged 例外→fixtures/sdk-modules + e2e/sdk |
| opencode-scenario.mjs | 旧脚本实际只调用 stdio、不是 OpenCode 模型验收；协议等待上限→integration/protocol，真实宿主→model，二者明确分开 |
| orphan.mjs | 真正 SIGKILL 构建进程、interrupted/resume/wait、重复 resume 拒绝→e2e/process；持久化边界→integration/jobs |
| perf.mjs | 重复启动/内存测量→tools/bench，原门限不变 |
| physical-fixture.mjs | 手势/数据库/C++/调用链专用 fixture→support/project.makeApp，无独立历史阶段入口 |
| physical.mjs | host/sdk/device/gestures/flows/review/signing/jobs/variants/lifecycle 分别归入 e2e 对应能力；录屏全链路→e2e/recording，保留更严格 >10 帧和 >10000 bytes |
| proxy.mjs | 旧审计采集代理→model/proxy + support/acceptance；实际通信不能修补或模拟 |
| real-emulator.mjs | 镜像安装/删除/再删除/错误版本/零退出码误报→e2e/emulator image lifecycle；专用授权、拒删既有镜像 |
| real-sign-cleanup.mjs | 固定历史对象一次性清理退役；只删除当轮返回 ID→e2e/sign-cloud |
| real-sign-profile.mjs | 复用历史证书绕配额的排查入口退役；正常证书/profile 生命周期→e2e/sign-cloud，无配额即失败 |
| real-sign-raw.mjs | 临时导出内部私有函数调查原始 AGC 格式，问题已落实→integration/cloud、sign-auto；不保留临时源码改写入口 |
| real-sign.mjs | 本地 keypair/CSR/校验→e2e/signing；云对象独立读回/删除→e2e/sign-cloud |
| remaining.mjs | skills/auth/knowledge/emulator/cpp/equivalence→对应 e2e；不再按“剩余阶段”维护第二运行器；OpenCode 改为显式单宿主选择 |
| report.mjs | 历史发现聚合生成器退役；历史 Markdown/JSON 不删除，当前 Node 结果和发布回执分别维护 |
| retention.mjs | 制品/导出清理、无关文件保留→integration/jobs；删除宽泛捕获 SQL 错误的旧实验 |
| review-build.mjs | 增量依赖/失败文件重检→unit/efficiency；cppcrash/appfreeze→unit/domains；source map→unit/efficiency + e2e/device 真崩溃 |
| review-device.mjs | 断连/选择歧义/无法启动→integration/start-create、layout-job、unit/ui-agent；关闭固定个人实例的环境实验退役，不操纵用户设备电源来造场景 |
| review-dialog.mjs | 旧“遇引导应阻塞”预期已被通用引导需求取代→unit/agreements、integration/agreements、e2e/device variants；不再卸载个人应用 |
| review-fault.mjs | 损坏 flow/DB、并发→integration/flows、jobs、unit/efficiency；旧“破坏热状态后仅查 project.info”不能证明热重载，删除该空判定 |
| review-hot.mjs | 源码/资源/清单/依赖/安装变化的路径决策→unit/efficiency；真实补丁/reset/依赖全量重部署→e2e/hotreload；不复制个人项目 HAR 名称 |
| review-proc.mjs | checker/LSP kill 后恢复、MCP kill 构建恢复、退出无孤儿→e2e/process；stdio 断连→integration/client |
| review-soak.mjs | 100 actions + 20 deploys，RSS增量<60MB、子进程+3、FD+20、tmp不增长、文本≤8000→e2e/soak；测量工具缺失不当0 |
| review-ui.mjs | 批量上限/互斥/断言/超时、after≤1KB/链式<2500ms、重复建议顺序→e2e/ui、unit/efficiency；具体导航分类→screenDiff 真值回归；个人导航路径退役 |
| review-ui2.mjs | 5次视觉稳定、变化敏感、坏基线、3次帧率差<10、静态非健康、失效then_flow/缺变量<3s→e2e/ui；个人4页面布局问卷无独立真值，保留历史且不标自动通过 |
| snapshot.mjs | 个人工程快照入口退役；夹具修改逐字恢复、全局配置/KB哈希→e2e/sdk、skills、knowledge，图片/视频哈希→support/acceptance |
| syscap.mjs | 对固定 SDK 版本缺陷的调查（必须出现 compiler bug 才“通过”）退役，保留历史原始分类；MCP syscap/since/default 语义→unit/domains，真实解析→e2e/sdk。PC 专属 API 导致手机崩溃是 SDK 事实，不作为 MCP 成功契约 |
| syscap-classify.mjs | 多个个人项目诊断统计的固定样本退役；版本区间/default alias/缺能力分类→unit/domains，真实模块解析矩阵→e2e/sdk |
| syscap-full.mjs | LingDong 某次所有警告复核是历史证据，不是稳定的项目夹具；有效分类规则同上，读取失败不再用空能力集代替 |
| upstream-behaviour.mjs | log tail/过滤、display负例、只读SQL、输入、模块设备选择→e2e/device、ui、unit/domains、integration/protocol；API12固定模板调查由真实SDK project覆盖，不以旧SDK输出作永久预期 |
| upstream-fixes.mjs | 深度0/相对绝对路径等价→e2e/device；单names/name→e2e/emulator；flow串工程拒绝→integration/flows；Skill路径→e2e/skills |

## 其他旧目录与入口

| 删除 / 移入 | 去向与合并 |
| --- | --- |
| test/smoke/real-projects.mjs | 有效 build/job/LSP/sign/device/flow/hotreload→e2e 能力套件；模块设备选择→unit/domains；独立 HAR/HSP 真实构建→e2e/project。固定个人项目页面、自动 review、复制签名的通用脚本退役 |
| test/e2e/smoke.test.mjs | 模板/错误定位→project；设备/手势/输入→device；补丁/reset/SQLite独立标记→hotreload；视觉复核→review，取消脚本自动批准；删除依赖存在时静默跳过 device 的旧入口 |
| test/e2e/onboarding.test.mjs | 完整断言合并 device variants，避免双份夹具与运行流程 |
| test/media/recording.test.mjs | integration/media/recording.test.mjs，独立外部工具入口；不改变严格解码与负例 |
| test/e2e/fixtures.mjs、两份 ETS | support/project、fixtures/gesture-page.ets、onboarding-page.ets |
| test/zip-fixture.mjs | support/zip |
| tools/mcp-client.mjs | support/mcp；增加 UTF-8分片、RPC错误、退出、超时取消回归 |
| tools/recording-check.mjs | support/recording；所有入口共用原 FFmpeg 参数和严格输出检查 |
| tools/prompt-audit.mjs | support/prompts；原提示/性能门限不变 |
| tools/model-{capture,eval,live-cases,matrix,proxy,report,workflow-cases}.mjs | model 对应模块；根路径、子进程入口、测试 imports 一并更新，评分不放宽 |
| test/fixtures/audit-entrypoints.json、audit-public-cert.pem | tool-actions.json、public-cert.pem，作为当前协议清单及签名夹具 |
| unit 中组件连接测试 | auth/cloud/flows/host-install/jobs/kb/layout/lifecycle/model/protocol/runtime/server/sign/start/create 等迁入 integration；原断言保留 |

`docs/audit/`、`docs/evidence/`、版本验收 Markdown、`.scratch/recording-1791712751554/` 原视频与检查回执保留；它们是证据，不是退役测试代码目录。新增数据只保留重复使用的 checker/API 模块输入，不另建旧脚本归档。
