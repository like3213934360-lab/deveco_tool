# v1.4.9 知识库、录屏回执与 FPS 修复

2026-10-13。基线提交为 `38b9e0fe83ca704f5abf1db6284c5bab4cdab419`，沿用独立 MCP 实现。package 与 lock 统一为 1.4.9，没有新增运行依赖、自动 Skill 分发或 NTLM 代理。当前测试入口见 [测试指南](../test/README.md)，发布按 [RELEASING](RELEASING.md)。

## 功能与覆盖

| 能力 | 最终行为 | 回归与真实验收 |
| --- | --- | --- |
| 知识库来源 | 默认官方 upstream/latest；daily 显式选择；自定义私有 kb_package 保留 pack 模式 | `integration/kb-source.test.mjs`：默认、私有包、来源覆盖、固定版本与降级 |
| 兼容性与完整性 | 检查/安装共用解析；验证 API、SHA512、包身份与版本；不兼容 latest 明确报告所选历史兼容版本，不能追随更高 daily | 同套件：不兼容、缺失/无效元数据、401/404/断网、归档版本不符等负例 |
| 本地增强 | 官方版本和路径/正文指纹分开；同内容无操作；旧指纹 unknown；force 显式重建；原子切换与回滚 | `kb-source` / `kb-atomic`；真实官方下载、检索、阅读、回滚及原文件哈希复核 |
| 录屏身份 | 绑定设备连接标识或模拟器 UUID；拒绝旧未知身份和复用端口，启动回写拒绝覆盖已变化回执 | `integration/lifecycle.test.mjs` 的 UUID、端口复用、旧回执和冲突场景；USB 真机验证新身份 |
| 离线回执 | 新增 record_receipts / record_archive / record_restore；完整原始记录事务归档，只恢复空槽 | `lifecycle` / `server`；真实录制期间归档后仍 busy，恢复后仍 recording，完整 raw 不变 |
| FPS | composer/profiler 并发覆盖同一轮手势；保留命令 stdout/stderr/退出码；无数据 inconclusive，逐秒样本 fps_only | `integration/perf.test.mjs`：正常帧、零数据、权限/命令错误、截断、清零失败、手势失败与取消；真机采集并回读原始诊断 |

新增两份 integration 专项，扩展既有生命周期、MCP 协议与 E2E；没有删除旧场景、修改断言预算或新增测试运行依赖。模型场景清单增加三个录屏 action，仅表示测试输入已经登记。

## 本轮本地结果

环境：macOS、Node v26.0.0，DevEco Studio 26.0.0.821 / SDK 26.0.0.105（API 26）。用户明确选择当前 USB Pura 80 Pro；SDK 复用原专用 FullProbe 工程及签名，没有替换设备、镜像或签名配置。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| typecheck / build | 通过 | 产品、公共支持模块及最终构建 |
| npm test | 235/235，失败/取消/跳过均 0，16.121 s | 全部离线 unit/integration；历史 204 项不作为本轮重测证据 |
| 真实 FFmpeg | 4/4，0.863 s | 完整解码及损坏/VFR/截断负例，原视频不变 |
| SDK 工程及 LSP/C++ | 50/50，52.842 s | 模板、Kit、增量依赖、原工程构建、语言服务、30 模块 × 6 设备类型；临时 C++ 源码恢复 |
| USB 新录屏 | 1/1，14.769 s | 身份、回执归档恢复、取回、严格解码及最终 idle |
| 官方知识库 | 检查与默认更新、force 重建/检索/阅读/回滚通过 | 原包目录与文件哈希恢复；最终同内容为 unchanged |
| 真实 FPS 诊断 | composer 403 帧、98.8 FPS、p95 16.67 ms，minor_jank | 桌面一次上下手势（2 次），不是专用应用流畅性达标；profiler 7 个有效样本；原始诊断完整回读 |
| 性能预算 | 通过 | 握手中位 82 ms；空闲 RSS 69 MB，10 秒 CPU 不变；门限未改 |
| 提示说明 | 通过 | 15 个工具，instructions 1,737 字节，tools/list 36,829 字节，最长描述 1,612 字符；不冒充 token 数 |
| npm pack dry-run | 通过 | 295 项、1,449,604 压缩字节；未执行 npm 发布 |
| 上游门禁 | 491 项通过 | 374 full / 74 host / 43 skip；partial、undecided、invalid、stale、新提交均 0 |

新视频为 438,404 字节：H.264 862×1920、90 个实际解码帧，AAC 180 帧，容器 3.840 秒。原视频 SHA-256 为 `004bc672050e90109e88a69c8be1bf0964597d9dc33be989f0a6c0d0b14bfb47`，严格检查前后相同。私有日志、原视频与诊断保留在本次 `.scratch/release-1.4.9-20261013/`，不公开上传；脱敏摘要见 [本地证据](evidence/v1.4.9-local.json)。

最终运行指纹为 `1f14cb94a6b0dc2d2061252a2ac34e7cf81b8e5e2a74736fabe8b57e1ae9aae2`。本轮独立 stdio 和 Codex App 原生 doctor 均实际返回 1.4.9 及该指纹。App 在本轮检查开始时已加载此构建；没有由发布触发宿主重启，也未执行其他宿主重载。

## 上游审查与保留记录

初次上游门禁因未审查的新提交失败，能力映射本身没有缺失。逐项审查 Code 的 3 个提交（至 `74a8dcd63025c0c26dfb546518af5879ecf8163b`）及 CLI 的 24 个提交（至 `1b2389be7df657d7749b9d4294f2bba487200eb3`）：宿主统计、真实视觉模型标识、cwd 独立代理、CLI 多平台分发、Codebuddy 配置、嵌套视觉校验取消与录屏终端提示等。处置及边界写入 `tools/upstream/decisions.json`；没有把宿主行为引入独立 MCP，也没有禁用上游门禁。

真机 FPS 临时采集脚本先误写 verdict 枚举而失败。修正后只校验已采集的同一结果、回读原始诊断，没有重放手势或将 minor_jank 改成 smooth。原失败日志保留。

## 未验证范围

- 本轮未重跑真实模拟器端口复用/同名 UUID 重建；离线负例不能替代该设备验收。原模拟器无有效录屏编码的历史限制仍保留。
- 本轮未进行完整模型自主调用矩阵、其他宿主重载、Windows/Linux 真实 SDK/FFmpeg、长录制、音画同步与麦克风内容验收。
- [TODO](../TODO.md) 中既有热重载/UI 延迟、云端来源判定、云配额、镜像生命周期和 Windows 原子写入首次失败等问题不因本轮测试或发布被关闭。

## GitHub 交付

按发布流程检查该提交的七项 CI、自动 release、verified-release 回执、不可变 tag 及 Latest。核验完成后回填本节与 TODO；最终文档提交及其独立 CI/release 核验链接在交付回复中单列，避免自引用 SHA 产生循环提交。
