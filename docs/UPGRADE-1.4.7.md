# v1.4.7 action 说明与测试计划修复

2026-10-11，修复版本号被错误分句、补齐各 action 参数说明，并拒绝此前可能被忽略的断言组合。保持现有 tools/domains/core 分层、延迟加载和作业语义；没有增加降级、放宽断言或修改测试工程、SDK、宿主配置。此次只验收 Codex，按用户要求不运行 OpenCode 或 Claude。

## 修复与验证来源

- `uitest.checklist` 区分句末句点与版本号、小数、文件名、URL 内部句点；编号匹配不再吞掉行首数字版本。保留原中英文句子、编号和项目符号边界，不声称实现任意 URL 的完整语法解析。
- 审查 15 个工具的 102 个入口定义，明确 action 字段适用范围、wait/request_key、测试步骤顶层 visible/hidden、review 取图后判定、会话设备、流程必填变量、签名参数以及先回放后断言的顺序。源码说明审查不等于 102 项真实操作验收。
- 空断言、visible/hidden 同时给出、单动作携带仅 steps 支持的 assert/save_flow，均在设备操作或创建作业前拒绝。真实 stdio 单测和 Codex 原生负例均验证；协议/引导集成测试另断言非法请求不点击同意、不产生 tap。
- 公共说明仍为 1,737 字节；tools/list 为 36,854 字节，最长描述 1,666 字符。原 36 KiB 门限未提高。宿主逐工具重复公共说明的对照体积为 62,969 字节；这些是协议字节/字符测量，不是模型 token 数。

最终运行构建 ID：`6dc15c8d525de1c1a4a4e2afa4694aa8d471f9169e59c253b2bb7d1b0e630dad`。用户重启后，本轮原生验收开始、结束以及发布准备时的 `doctor` 均确认 v1.4.7 和该构建；发布准备重建的源码指纹相同。GitHub 发布与宿主重载分别确认，本轮不需要再次重启。

## Codex App 实际调用

沿用用户指定的 USB Pura 80 Pro（LMR-AL00、API 26）、个人签名团队、FullProbe 工程和 DevEco 26.0.0.821 / SDK 26.0.0.105。当前对话中由模型实际选择并执行 **102 次原生 MCP 调用，覆盖 15 个工具、42 个不同入口**，包括 82 次正常返回、18 次计划内 INVALID_INPUT 负例和 2 次操作顺序导致的前置条件拒绝。发布准备的只读 doctor 不计入这 102 次。详见[脱敏调用索引](evidence/v1.4.7-codex-native.json)：保留请求、错误和部分关键结果，不是完整原始响应或独立盲测。

| 范围 | 实际结果与边界 |
| --- | --- |
| 三轮自然语言计划 | 中文 `v1.4.7`、英文版本/`Index.ets`/小数/URL、行首 `26.0.0.105` 各生成完整的 2 项清单。每轮重新启动应用，检查 Hello World、点击后检查 Welcome，三个会话均 finish passed；没有改写失败输入或断言 |
| 参数拒绝 | 18 个跨 action / 断言组合均返回 INVALID_INPUT；前后 job 清单一致，未保存 `never-saved` 流程。ui_flow.stop 仅验证了非法空断言，不能列作该 action 保存流程的成功路径 |
| 正向断言及视觉 | 单元素 steps + assert 成功；hidden 断言成功。review 先取图，模型实际查看后用返回的 review_id 和具体理由提交；会话结束 failed_reviews=0、unresolved_reviews=0 |
| 构建、安装、签名 | 完整 build_run 成功，已签名 HAP 安装、启动及页面断言通过，保存热重载基线；sign.verify 验证签名链、debug profile 和包名。构建保留 1 条原有警告，不声称零警告 |
| 输入与流程 | 中文输入及 Echo 精确断言通过；保存、show 确认必填 input1 后 replay 成功，repaired=false。deploy + then_flow + 最终断言成功，事件顺序证明先回放后断言。测试使用与保存时相同的变量文本，不证明固定断言随任意变量自动改写 |
| SDK 与知识 | code.check files 无问题；LSP diagnostics 无错误/警告，TextInput hover 与 workspace_symbols 返回真实 SDK 结果；本地知识搜索/读取、离线状态、云端查询及按返回 artifact 分页读取成功 |
| 只读管理与诊断 | project.info、auth.status/teams、skills.list、emulator.list 正常返回。diagnose.build 对本次诊断文本返回空 hints，仅证明入口执行，不证明诊断建议准确率 |
| UI 查询及性能 | 原 tree/find/assert 顺序 3 轮、9 次调用均成功；本轮没有复现历史 HDC 30 秒超时。真实 List 两次滑动，267 帧、平均 117.4 FPS、120 Hz、卡顿率 1.13%，verdict=smooth；不是其他页面或机型的性能保证 |
| reset | 重新建立当前安装对应的基线后，原始包覆盖安装成功，method=restore_baseline_packages、patch_version=0；独立 quickfix 查询及重新启动页面断言通过。本轮没有新启用补丁，也没有单独写入数据标记，因此不计作新的补丁撤销/数据保留完整验收 |
| 录屏 | 真机 MP4 实际取回 305,198 字节，H.264 862×1920、84 帧，容器时长 10.752 秒，另有 AAC 音轨。实际查看末帧，点击、双击、长按计数均为 1，中文输入可见。MCP seconds=20 是会话经过时间，不当作媒体时长 |
| 清理 | 删除本轮 `codex-147-final` 流程，原 `batch-audit` 保留；卸载专用应用，record_status=idle。未修改其他应用、模拟器、登录或宿主配置 |

本轮三个测试会话为 `t_mv2lvmj35697`、`t_mv2lwbok7833`、`t_mv2lwnape439`。完整构建、独立回放、部署回放和重建基线的作业分别为 `j_mv2lutdvc61112`、`j_mv2lye721642ac`、`j_mv2lyvkb17e501`、`j_mv2m28ao2c61e2`，均 succeeded。会话/作业 ID 只定位本地证据，MCP 产物有保留期限，不保证长期可读取。

## 保留的拒绝与检查警告

两次额外拒绝均来自此次验证的调用顺序，不是新修复的 MCP 缺陷：

1. 部署作业尚未完成时按 bundle 读取日志，应用还未运行，返回 NOT_FOUND。等待作业完成后相同日志参数成功；不把第一次拒绝删除。
2. 单独重新部署后使用旧基线 reset，安装标记不一致，返回 CONFLICT。保持原保护条件，按既定流程重新 build_run 保存基线后 reset 成功；没有放宽安装标记检查。

原录屏检查 `ffmpeg -v error -xerror -i <mp4> -map 0:v:0 -f null -` 退出码为 0，但 stderr 有 20 行（含重复行摘要）的 DTS 警告，不能记为无警告通过。独立检查确认 84 个视频包及解码帧时间戳严格递增；verbose 显示源时间基 1/90000 转为 null 输出的 7.93 tbn 时发生取整冲突，84 帧解码错误为 0。仅用于定位的 `-enc_time_base demux -fps_mode passthrough` 保留源时间基后警告消失，AAC 独立严格解码也无错误。没有替换原验收命令、重编码文件或据此宣称麦克风内容符合预期。

设备 E 级日志仍有系统/框架信息，例如参数监听、Ace 组件和输入法监听日志；启动崩溃检查与页面断言通过，不声称设备日志全干净，也不将这些日志全部归因为 MCP。

## 本地发布前检查

- `npm run typecheck` 通过；`npm test` 189/189，失败、取消、跳过均 0，包含真实 stdio 参数负例和引导处理无副作用断言。
- `npm run bench` 通过：握手中位 81 ms（80–86 ms），tools/list 4 ms，空闲 RSS 69 MB，10 秒 CPU 读数不变；未提高性能或说明体积门限。
- 上游对齐 491 项：374 full / 74 host / 43 skip；partial、undecided、invalid、stale 均 0，无新增未处理上游提交。这些 skip 是既定能力归属决定，不是 GitHub CI 跳过任务。
- package.json、package-lock.json 和锁文件根包版本均为 1.4.7；重建指纹与 Codex 当前运行指纹相同。GitHub 跨系统 CI 按实际发布提交单独核验，见下方回执。

## TODO

- [x] 版本号、小数及内部句点分句修复；单测和 Codex 三轮真实计划验证。
- [x] 102 个入口定义的说明审查、关键 action 参数补充、非法组合明确拒绝；原说明及性能门限保持。
- [x] 最终构建的 Codex 102 次原生调用完成；正向、计划内负例、顺序失误及未验证边界分别记录。
- [x] 用户重启后的实际 MCP 构建确认；本轮运行代码此后未修改，无需再次重启。
- [x] 本地 189 项单测、类型、性能、上游对齐及版本一致性检查通过。
- [x] 发布提交 `5e9226591b8aa47e726111a2c8cd158e2b4f0697` 已推送；七项 CI 全部通过，release 工作流及 verified-release 回执、Release、tag 和 Latest 核验一致，见下方链接。
- [x] 统一录屏脚本的 USB Mate 80 新录制、取回和严格解码全链路补验通过：1/1 用例、5 次真实 stdio MCP 调用，结束状态 idle；细节及证据见下方补验记录。
- [ ] OpenCode 本版本复验：用户明确暂不运行；此前失败不能由本轮 Codex 成功替代。Claude 不在适配名单。
- [ ] 全入口、多模型首次调用可靠性：本轮是带已有对话上下文的代表性流程，并非 102 个入口全部成功或严格同条件模型对照。
- [ ] 新启用补丁后的 reset 与独立数据标记保留，本轮未重测；保留以往证据，不追加本轮通过声明。
- [ ] 有效旧凭据迁移；云端配额具备后的 sign.auto / certificate_create，以及本轮专用云端证书/profile 删除。旧库无有效数据、历史配额错误 205389872、无可安全删除对象的限制未在本轮解除。
- [ ] 历史 HDC 超时设备侧根因；本轮未复现不能将其关闭。SDK clangd didChange 后即时 implementation 的索引时序边界仍保留。
- [ ] Pura 80 Pro、Mate 80 之外的真机；Mate 80 其他 MCP 入口、Windows/Linux 真实 SDK、录屏音画同步及音频/麦克风内容、首次 license 接受。Mate 80 的单次录屏成功不扩大为全工具验收；模拟器缺少视频编码器按用户决定属于正常环境限制。

## GitHub 交付

发布提交 [`5e9226591b8aa47e726111a2c8cd158e2b4f0697`](https://github.com/like3213934360-lab/deveco_tool/commit/5e9226591b8aa47e726111a2c8cd158e2b4f0697) 的 [CI](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38110095497) 七项全部成功，没有失败或跳过；[自动 release 工作流](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38110145044)成功。下载的 verified-release 制品与干净 checkout 中 `node tools/release.mjs --run 38110095497 --check` 输出逐字节相同，见[公开回执](evidence/v1.4.7-release.json)。

[v1.4.7 Release](https://github.com/like3213934360-lab/deveco_tool/releases/tag/v1.4.7) 为稳定发布且是 Latest，tag 实际提交等于上述 SHA，Release ID 为 `409398302`。回填本文和回执不改变运行代码、不移动 tag、不重发 Release；文档提交自身的 CI 和 release 核验另外执行。

Codex App 已通过原生 doctor 确认加载与本次发布一致的运行构建，见上文；这不是由 GitHub 状态推断，也无需再次重启。没有执行 npm 发布。

## FFmpeg 验收脚本统一（发布后补充）

2026-10-11，按用户要求将上述诊断确认的时间基处理固化到[共用验收入口](RECORDING-CHECK.md)，E2E 与 USB 真机脚本均调用它。保留原有门槛，增加全部音视频流解码、空输出拒绝及退出码为 0 时的 stderr 检查。工具版本、原始命令和诊断写入独占回执，错误不忽略、不降级。只修改工具、测试和文档；运行版本仍为 v1.4.7，不改 package/lock、CI 环境、原始视频或 MCP 运行依赖，不重发 Release 或移动 tag。

- [x] 两处录屏验收统一调用 `tools/recording-check.mjs`，独立检查已有 MP4 也使用同一入口。
- [x] 5 项进程契约回归通过：包括零退出码错误日志、非零退出、信号、缺失工具、超时、缓冲区溢出、无效媒体及覆盖原文件/旧证据拒绝。
- [x] 4 项真实 FFmpeg 8.1.2 回归通过，失败/跳过均 0：固定帧率无音轨、密集时间戳 VFR 加 AAC、分别损坏视频/音频有效载荷、截断容器。合成素材只验证检查器，不算设备验收。
- [x] 先前 Codex 真机原视频 `deveco-codex-147-final.mp4` 经统一 CLI 检查通过：305,198 字节，H.264 862×1920、84 帧，AAC 504 个解码帧，全部子进程退出码 0 且 error 级 stderr 为空。检查前后 SHA-256 均为 `9680475eda7d39a5d06e48a35dd370fbfcaebd39326f1d0f303c28c309b3aedb`；原视频未修改，私有完整回执保存在 `.scratch/recording-check/codex-147-original.json`。此前旧命令的警告记录仍保留，不改写为历史无警告通过。
- [x] 本次 `npm test` 194/194，失败/取消/跳过均 0；typecheck、脚本语法及 diff 检查通过。上游 491 项仍为 374 full / 74 host / 43 skip，无未决、失效或新增提交；package/lock 均为 1.4.7，重建运行指纹仍为 `6dc15c8d525de1c1a4a4e2afa4694aa8d471f9169e59c253b2bb7d1b0e630dad`。
- [x] 脚本提交 [`ae231b290797b89db4c9c5375e31552b7d2cb854`](https://github.com/like3213934360-lab/deveco_tool/commit/ae231b290797b89db4c9c5375e31552b7d2cb854) 已推送，[七项 CI](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38112154923)全部通过、无跳过；[release 工作流](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38112209317)成功，下载回执与本地只读核验逐字节相同，见[本次交付回执](evidence/v1.4.7-recording-check-release.json)。既有 v1.4.7 仍为 Latest，tag 保持 `5e9226591b8aa47e726111a2c8cd158e2b4f0697`。回填文档提交另核验自身 CI 和 release，不移动该 tag。

脚本交付阶段尚未重新录制真机视频或跑完整设备生命周期，已有 MP4 的再检查不计作新的 MCP 端到端调用；后续新录屏补验见下节。Windows/Linux 真实 FFmpeg、其他 FFmpeg 版本、麦克风内容和音画同步未验证。OpenCode / Claude 未运行。MCP 运行代码未改变，无需用户重启；宿主加载状态沿用上文已有原生 doctor 证据，脚本交付不追加已重载声明。

## USB Mate 80 新录屏全链路补验

2026-10-11 17:59（Asia/Shanghai），原 Pura 80 Pro 未连接，经用户明确指定，使用当前 USB HUAWEI Mate 80（VYG-AL00、API 26、系统 7.0.0.109）。原样执行 `E2E_TARGET=<用户指定的 USB Mate 80> node --test test/e2e/recording.test.mjs`，测试结果 **1/1 通过，失败、取消、跳过均 0**。

前置 Codex App 原生 doctor 与录屏脚本的独立 stdio doctor 均确认 v1.4.7、构建 `6dc15c8d525de1c1a4a4e2afa4694aa8d471f9169e59c253b2bb7d1b0e630dad`。环境沿用 DevEco 26.0.0.821、SDK 26.0.0.105、Node v26.0.0、FFmpeg / ffprobe 8.1.2。脚本源码对应 `fd9ff82463e0180a9d1934aeec83851a7e889d12`，其原有独立状态目录和输出目录未改；没有安装应用、修改设备设置或 SDK/FFmpeg/宿主配置，没有更换断言或重编码原视频。

本次由统一 E2E 脚本发起 **5 次真实 stdio MCP 调用**，全部 `isError=false`；Codex 原生工具用于前置环境与空闲状态检查。这 5 次不并入上文 102 次原生模型调用，也不作为新的模型选工具验收。

| 环节 | 原始证据与结果 |
| --- | --- |
| 开始与录制中状态 | `record_start.recording=true`；随后 `record_status.status=recording`，文件名与开始返回值相同 |
| 停止与取回 | `record_stop` 返回本次新 MP4、artifact_id 和 791,828 字节，独立读取文件大小一致 |
| 媒体内容 | H.264，868×1920，77 个解码帧，视频时长 3.504044 秒；AAC，170 个解码帧，音轨/容器时长 3.627 秒。MCP `seconds=13` 是录屏会话经过时间，不当作媒体时长 |
| 统一严格检查 | 同一流程直接调用 `tools/recording-check.mjs`；保留 `-xerror`、`-err_detect explode`、源视频时间基及帧时间戳，解码全部已有音视频流。4 个子进程退出码均为 0、signal=null、error 级 stderr 为空；回执 passed=true，没有临时追加解码命令 |
| 最终状态 | 再次 `record_status` 返回 idle，未保留待取回文件状态；用例正常结束、进程退出码 0 |

原视频 SHA-256 为 `0545412fed8be717143bd4e82aad75c4f9b7c94922c3cb94bce0203c64a0256a`。完整调用、媒体信息、检查回执和原视频保留在私有 `.scratch/recording-1791712751554/`；[公开脱敏证据](evidence/v1.4.7-mate80-recording.json)记录来源提交、脚本及原始文件哈希、实际调用、解码参数和结果。USB 序列号、绝对本地路径及账户信息不发布；原视频不上传 GitHub。此前 Pura 80 Pro 的旧命令警告和两次操作顺序失误仍按原记录保留。

- [x] 本次新录屏从开始、录制状态、停止取回、严格解码到最终 idle 全链路通过。
- [x] TODO、验收说明与公开证据已按本地原始日志逐项核对，保留原文件哈希和实际构建 ID。
- [ ] 本次证据提交推送、该 SHA 全部 CI、release 工作流回执及既有 Release/tag/Latest 核验。
- [ ] Mate 80 完整 `test/audit/physical.mjs lifecycle`、其他 MCP 操作、长时间/多轮录制、画面内容人工验收、音画同步及麦克风内容，本次未验证。
- [ ] Windows/Linux 真实 FFmpeg、其他 FFmpeg 版本与 OpenCode 模型验收，本次未运行；Claude 不在适配范围。其他历史未验证项按上方 TODO 保留。

本次回填只改文档与证据，不升级 v1.4.7、不移动已发布 tag、不重发 Release，也不执行 npm 发布或宿主重载。
