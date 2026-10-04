# v1.3.3 审计修复验收

基线：v1.3.2，`473943e6e17603e03143525d1049c26c0252906b`。验证日期：2026-10-04。原始审计报告保持不变：1541 行、511837 字节、879 次 custom 调用，SHA-256 `7f45b19f293605674ee09b55bcd5176d8f4c5d9e0fb6ab4b77277fa0e76255a1`。原报告留在私有目录，调用索引仅在本轮私有验证中使用，未把账号、设备身份、云端 URL、签名材料或原始 UI 数据提交到仓库。

历史通过、当前版本通过、模拟故障、能力缺失和外部阻塞分别登记；协议拒绝测试不替代实际 SDK 或云端成功证据。

## 修复与剩余边界

| ID | 原问题 / 原因 | 当前修复与永久回归 | 本轮证据与剩余边界 | 资源归属 / 清理 |
| --- | --- | --- | --- | --- |
| F1 | force 先删旧签名，随后配额失败；单个 effect 无法区分云端阶段 | 独立 prepare/certificate/devices/profile/material/commit/release；每个不可重放 effect 有 intent/receipt；材料校验后比较旧配置 hash 并原子切换；只补偿本次已确认归属的证书 | `sign-auto.test.mjs`：配额、Profile 拒绝、下载、损坏材料、错误 key/bundle/device、SDK 校验、配置冲突、篡改、响应丢失、取消、SIGKILL、rename 后进程退出及 force 恢复；旧链逐字节保留。真实 auto 未调用；证书配额仍阻塞真实签名生命周期 | 旧文件/证书不撤销；不确定结果保留恢复证据。IDE Profile 端点仅返回文件 URL，无法确认云端删除，明确记录该限制 |
| F2 | null 在校验前解构并使进程退出 | 在分派前校验 envelope；非法 JSON / null / 标量 / batch 后仍可握手与列工具 | `protocol.test.mjs` 实际 dist 子进程通过 | 独立进程与状态目录 |
| F3 | 非法版本/ID/params 与 notification 行为不完整 | JSON-RPC 2.0 envelope、非空 method、MCP string/integer ID、object params；重复在途 ID 拒绝；取消传播；同步异常转协议错误 | 三版协议、并发、0/字符串 ID、重复 ID、未知方法、notifications 静默、取消与重连永久回归通过 | 测试 socket、timer、子进程清理 |
| F4 | 必填 Prompt project 缺失时插入 undefined | 通用 required/type/nonblank/unknown 校验；resource URI 类型校验 | 三个 Prompt 有效与缺参/空白/错误类型/未知项回归通过 | 只读 |
| F5 | forms 在专属实例编排前解析普通 target | 先路由 forms job；每个 job 使用专属名字/目录；finally 独立超时清理；折叠未生效不能计通过 | 路由/业务实例保护回归；真实 foldable 2、widefold 2、triplefold 3，共 7 状态通过 | 只停止删除 job 创建的实例；旧实例与共享镜像未修改 |
| F6 | KB metadata/download 遗漏取消 signal | tool/domain/HTTP/stream/extract/activation 全链传 signal；流式下载；唯一 staging 与原子 pointer 切换 | 慢 HTTP 取消后连接关闭 <1500 ms，并发 ping 仍响应；同版本替换失败、指针故障、取消、危险版本名、用户输入包保留回归通过 | 自建 HTTP、owned staging 清理；不删除用户提供的包 |
| F7 | SDK -force 并不覆盖实例配置，返回了假成功 | 已存在实例的强制覆盖返回 CAPABILITY_UNAVAILABLE；运行中删除拒绝；停止后连续两次确认再返回 | mock SDK 文件逐字节保留、延迟停止、运行中删除回归通过；真实专属实例停止删除完成 | 不覆盖/删除既有实例 |
| T1 | 首次 mouse ECONNRESET，动作结果不明确 | agent 等待 TCP ready；分片 UTF-8 解码；socket/listener/timer/abort/fport 生命周期清理；发出动作后从不自动重放 | 100 次分片应答、断开只发一次、取消回归；真实鼠标操作效果通过。一次真实 HDC target 暂时断连单列失败，没有计成通过 | 仅 owned agent/forward/session |
| T2 | 首次输入法协议/布局向导遮挡，历史 Echo 标签误用 | 共享 agreements 模块按同一窗口中语义和控件状态处理中英文协议、权限、勾选后继续、连续提示；操作后短暂重读覆盖延迟出现；默认开启且返回 agreements_accepted | 模拟多供应商协议/相机/定位/照片/录音权限、拒绝/付费/删除/跨窗口/disabled 负例通过；真实 IME 协议自动接受；布局沿现有默认项完成；22 项 SDK 回归中精确标点/中文/聚焦输入/追加通过 | 无固定输入法名字或控件 ID。任意语言、图片提示、未知语义不保证自动识别；纯观察不点击 |
| B1 | 新证书配额不足 | 私有凭据副本刷新及现有资源读取；独立 keypair/CSR 后单独 certificate_create 验证配额 | 当前云端返回 205389872 配额拒绝；前后证书 ID 集合相同。真实签名、Profile、真机安装未形成成功证据 | 原凭据 DB/key 未改；未创建/删除云端证书，真实 sign auto 未调用 |
| B2 | 默认知识包 registry 404 | 明确提示 upstream/local 可选来源；默认源失败保留 active pack | 当前默认源仍 404；真实 upstream 下载/构建/激活、检索、read、catalog、rollback 通过 | 独立 KB 状态；未 npm 发布 |
| E1 | clangd outgoing hierarchy 缺失 | 保留 SDK 支持/不支持的结构化 capability 结果 | ArkTS 双向 hierarchy、declaration、implementation 及 SDK kit hover 真实通过；C++ outgoing 无当前正向证据，不把历史 capability 缺失算通过 | 只关闭本轮 LSP |
| E2 | 录屏文件未 flush 或导出失败 | bounded flush；失败/取消保留 receipt，阻止覆盖未导出会话，允许显式重试/丢弃；校验 MP4 ftyp/mdat/moov/video | mock 生命周期/失败/取消/重试/丢弃与容器回归通过。实际可播放视频本轮未验证；容器校验不等于播放器验收 | owned local/remote staging；保留有意待恢复的会话 |
| G1 | 断连后草稿存在但 show NOT_FOUND | list/show 查持久草稿；按 project/target 隔离；显式 stop/discard；metadata 不返回已存输入值 | 持久草稿重连、错 project 拒绝、stop/discard 永久回归；真实 record/replay 通过 | 只处理匹配工程/目标的草稿 |
| G2 | 无变化 relaunch、依赖回退未证明 | 增加实际 SDK 固定回归：无变化不构建不安装且 PID 改变、bm updateTime 不变；新增本地 OHPM 依赖后完整部署 | 本轮真实 relaunch 与 dependency fallback、实际依赖目录、安装时间变化全部通过；patch/reset/stop_daemon 也通过 | 专属工程/包随测试删除 |
| G3 | native PC 行号与实际冻结未证明 | README 明确 ArkTS 行号解析与 native PC 保留边界 | 解析夹具不能替代真实冻结；native C++ 地址符号化尚未实现，实际冻结本轮未验证 | 不制造业务 app 故障 |
| G4 | 11 场景命令接受不等于 subscriber 收到数值 | 原报告的命令与应用效果分开登记 | 本轮未做 11 类订阅应用恢复断言，继续标未验证；7 个折叠画布尺寸通过只证明该布局测试 | 不把历史场景命令算当前效果 |
| G5 | 全部鼠标键/方向、多物理屏、视觉质量样本缺失 | 真实 gesture 效果与负例独立；保持 selector/window/display 范围 | click/double/long/swipe/fling/drag、mouse click/double/long/drag/scroll/move、verify_change、精确输入通过；右/中键、所有方向组合、多物理屏正例及误报漏报率仍未验证 | 专属 app；不虚构质量百分比 |
| G6 | 生成配置不等于真实宿主启动；新登录只有 mock | 11 宿主×user/project 实际隔离 writer，8 MCP 配置宿主合并/force/幂等保留 peers；developer/codegenie×cn/global callback 回归 | writer 和四种 OAuth 流程 mock 通过；未启动 11 个真实宿主，未完成四种全新浏览器登录 | 测试 HOME；仅私有凭据副本读取真实账号 |
| G7 | 102 入口、字段、paging、CLI 的证据层混合 | 仅提取入口名的公共 fixture；对 102 入口执行发现性/未知字段拒绝回归，校验不创建 job；保留下面逐行当前状态 | 102 负向契约全部通过，不算 102 SDK 正向通过；历史 LSP/CLI/全字段组合未全面重跑。分页 EOF/取消/限额已有永久回归 | 不复制带身份的历史调用明细 |
| G8 | 缺 Windows/Linux 实际 SDK | 原六矩阵 CI 必跑且 fail-fast=false；新增离线回归不添加平台 skip | Windows/Linux/macOS × Node22/24 及 upstream：以 PR 最终提交的 check 为准。Windows/Linux 实际 DevEco SDK 本地仍无环境 | 不把离线 CI 算实际 SDK |

## 当前验证记录

- `npm run typecheck`、构建、`git diff --check` 通过；113 项单元测试通过，0 失败、0 跳过。
- 真实 DevEco Studio / HarmonyOS API26：22 项 SDK 回归通过，0 失败、0 跳过，277.907 秒；专属 phone app 安装后卸载。早期 IME/布局前置失败及新增 relaunch 夹具把 null 错断言为 undefined 的失败保留在私有日志，修正后完整重跑。
- 真实 forms：7 状态通过；未提供 target，编排自建实例且清理成功。正常 UI 多设备歧义保护保留。
- 性能预算未改：握手 <150 ms、tools/list ≤36 KiB、RSS ≤70 MB、10 秒空闲 CPU ≤0.011秒。Node24：98 ms / 10 ms / 36168字节 / 67 MB / 0 CPU 增量；Node26：77 ms / 4 ms / 36168字节 / 70 MB / 0 CPU 增量。bench 的空闲窗口改为启动恢复（2秒）、清理（5秒）及后台启动工作稳定后开始；原来的 1.5秒窗口混入启动 CPU。此前 RSS/CPU 超预算样本留存，没有降低阈值。
- 上游源码检查：467 项，full355 / host70 / skip42，partial/undecided/invalid/stale 均0，未出现新 upstream commit。
- 最后一轮稳定性：100 次 UI（50 mouse / 50 touch）逐次断言通过，20 次部署断言通过。31 次采样 active RSS 72368–76336 KiB，FD 均为17；这是操作期采样，独立空闲预算见上面的 bench。专属应用卸载、实例停止/删除成功，HDC forward 列表为空。脱敏汇总见 [EVIDENCE-1.3.3.json](EVIDENCE-1.3.3.json)。
- CI：首轮 Windows 夹具 importer 以反斜杠表示，四个 transport/home mock 没有生效而意外尝试读取真实 SDK；已统一 importer 分隔符，保留全部断言和矩阵。提交后检查最终 SHA 的全部七个 check，结果在 PR 中可核对。

## 102 入口当前证据

以下各行共同拥有本版本的 discoverability + 未知参数拒绝证据。`SDK` 表示该入口至少一个当前真实 SDK 正例；`MOCK` 是实际实现配合隔离 provider/transport 的语义回归；`CLOUD-READ` 是账号副本读取；`BLOCKED` 是本轮外部拒绝；`NOT-RERUN` 表示未全面重跑正例。每行都不表示覆盖了全部可选字段或取值。

| # | 入口 | 本版本正向证据 | 剩余边界 |
| --- | --- | --- | --- |
| 1 | `doctor` | SDK | At least one current positive; not every parameter combination |
| 2 | `project.info` | SDK | At least one current positive; not every parameter combination |
| 3 | `project.create` | SDK | At least one current positive; not every parameter combination |
| 4 | `project.sync` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 5 | `project.build` | SDK | At least one current positive; not every parameter combination |
| 6 | `project.clean` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 7 | `run.build_run` | SDK | At least one current positive; not every parameter combination |
| 8 | `run.deploy` | SDK | At least one current positive; not every parameter combination |
| 9 | `run.launch` | SDK | At least one current positive; not every parameter combination |
| 10 | `run.stop` | SDK | At least one current positive; not every parameter combination |
| 11 | `run.uninstall` | SDK | At least one current positive; not every parameter combination |
| 12 | `job.wait` | SDK | At least one current positive; not every parameter combination |
| 13 | `job.status` | SDK | At least one current positive; not every parameter combination |
| 14 | `job.list` | SDK | At least one current positive; not every parameter combination |
| 15 | `job.cancel` | SDK | At least one current positive; not every parameter combination |
| 16 | `job.resume` | MOCK | Actual implementation with isolated transport/provider; see ID matrix |
| 17 | `job.read` | SDK | At least one current positive; not every parameter combination |
| 18 | `code.check` | SDK | At least one current positive; not every parameter combination |
| 19 | `code.lint` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 20 | `code.api_scan` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 21 | `code.api_versions` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 22 | `code.lsp` | SDK | At least one current positive; not every parameter combination |
| 23 | `code.lsp_restart` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 24 | `device.list` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 25 | `device.info` | SDK | At least one current positive; not every parameter combination |
| 26 | `device.log` | SDK | At least one current positive; not every parameter combination |
| 27 | `device.shell` | SDK | At least one current positive; not every parameter combination |
| 28 | `device.sqlite` | SDK | At least one current positive; not every parameter combination |
| 29 | `device.send` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 30 | `device.recv` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 31 | `ui.observe` | SDK | At least one current positive; not every parameter combination |
| 32 | `ui.screenshot` | SDK | At least one current positive; not every parameter combination |
| 33 | `ui.tree` | SDK | At least one current positive; not every parameter combination |
| 34 | `ui.find` | SDK | At least one current positive; not every parameter combination |
| 35 | `ui.act` | SDK | At least one current positive; not every parameter combination |
| 36 | `ui.assert` | SDK | At least one current positive; not every parameter combination |
| 37 | `ui.windows` | SDK | At least one current positive; not every parameter combination |
| 38 | `ui.perf` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 39 | `ui.visual` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 40 | `ui.layout` | SDK | At least one current positive; not every parameter combination |
| 41 | `ui.record_start` | MOCK | Actual implementation with isolated transport/provider; see ID matrix |
| 42 | `ui.record_stop` | MOCK | Actual implementation with isolated transport/provider; see ID matrix |
| 43 | `ui.record_status` | SDK | At least one current positive; not every parameter combination |
| 44 | `ui.test_start` | SDK | At least one current positive; not every parameter combination |
| 45 | `ui.test_step` | SDK | At least one current positive; not every parameter combination |
| 46 | `ui.review` | SDK | At least one current positive; not every parameter combination |
| 47 | `ui.test_finish` | SDK | At least one current positive; not every parameter combination |
| 48 | `ui.test_log` | SDK | At least one current positive; not every parameter combination |
| 49 | `ui.test_export` | SDK | At least one current positive; not every parameter combination |
| 50 | `ui_flow.list` | MOCK | Actual implementation with isolated transport/provider; see ID matrix |
| 51 | `ui_flow.show` | MOCK | Actual implementation with isolated transport/provider; see ID matrix |
| 52 | `ui_flow.record` | SDK | At least one current positive; not every parameter combination |
| 53 | `ui_flow.stop` | SDK | At least one current positive; not every parameter combination |
| 54 | `ui_flow.replay` | SDK | At least one current positive; not every parameter combination |
| 55 | `ui_flow.delete` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 56 | `diagnose.crash` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 57 | `diagnose.build` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 58 | `knowledge.search` | SDK | At least one current positive; not every parameter combination |
| 59 | `knowledge.read` | SDK | At least one current positive; not every parameter combination |
| 60 | `knowledge.catalog` | SDK | At least one current positive; not every parameter combination |
| 61 | `knowledge.status` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 62 | `knowledge.update` | MOCK | Actual implementation with isolated transport/provider; see ID matrix |
| 63 | `knowledge.rollback` | SDK | At least one current positive; not every parameter combination |
| 64 | `skills.list` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 65 | `skills.read` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 66 | `skills.export` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 67 | `skills.install_mcp` | MOCK | Actual implementation with isolated transport/provider; see ID matrix |
| 68 | `skills.init` | MOCK | Actual implementation with isolated transport/provider; see ID matrix |
| 69 | `skills.search` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 70 | `skills.install` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 71 | `skills.uninstall` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 72 | `auth.login` | MOCK | Actual implementation with isolated transport/provider; see ID matrix |
| 73 | `auth.status` | CLOUD-READ | Copied credentials; no new account login |
| 74 | `auth.logout` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 75 | `auth.teams` | CLOUD-READ | Copied credentials; no new account login |
| 76 | `auth.import` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 77 | `sign.auto` | MOCK | Actual implementation with isolated transport/provider; see ID matrix |
| 78 | `sign.sign` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 79 | `sign.verify` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 80 | `sign.certificates` | CLOUD-READ | Copied credentials; no new account login |
| 81 | `sign.devices` | CLOUD-READ | Copied credentials; no new account login |
| 82 | `sign.register_device` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 83 | `sign.delete_certificate` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 84 | `sign.keypair` | SDK | At least one current positive; not every parameter combination |
| 85 | `sign.csr` | SDK | At least one current positive; not every parameter combination |
| 86 | `sign.certificate_create` | BLOCKED | 205389872 quota; old resources retained |
| 87 | `sign.profile_create` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 88 | `sign.profile_delete` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 89 | `emulator.list` | SDK | At least one current positive; not every parameter combination |
| 90 | `emulator.start` | SDK | At least one current positive; not every parameter combination |
| 91 | `emulator.stop` | SDK | At least one current positive; not every parameter combination |
| 92 | `emulator.create` | SDK | At least one current positive; not every parameter combination |
| 93 | `emulator.delete` | SDK | At least one current positive; not every parameter combination |
| 94 | `emulator.images` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 95 | `emulator.install_image` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 96 | `emulator.remove_image` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 97 | `emulator.license` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 98 | `emulator.license_view` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 99 | `emulator.scenario` | NOT-RERUN | Historical evidence retained privately; current contract negative only |
| 100 | `hot_reload.apply` | SDK | At least one current positive; not every parameter combination |
| 101 | `hot_reload.reset` | SDK | At least one current positive; not every parameter combination |
| 102 | `hot_reload.stop_daemon` | SDK | At least one current positive; not every parameter combination |

## 归属与交付

本轮采用独立 worktree、HOME、state、TMP、emulator instance 目录。原仓库 dist、宿主配置、凭据/KB/签名材料及既有实例/共享镜像由基线 ledger 保护。最终复查：44 项原文件及109项既有实例/共享镜像基线，无内容变化、元数据变化或缺失；原仓库工作区干净，原审计报告 SHA 不变。仅清理本轮创建的工程、凭据副本、状态、签名材料和实例目录；共享 HDC 与其他工程的 daemon 保留；共享 HDC 仍使用的临时日志目录保留，不通过杀共享服务强行清空。私有凭据、云端原始日志和 UI 原始数据已清理，失败的 SDK/性能与单元日志仅保留在私有目录。仓库保持 TypeScript/ESM、3 个运行时依赖、15 个 lazy 工具；版本为 1.3.3。交付为 GitHub 分支与 PR，不直接改 main、不发布 npm、不执行真实 sign auto。
