# v1.4.4 基线恢复与录屏状态核验

本轮修正 v1.4.3 Codex App 原生验收发现的 reset 假成功，以及录屏启动/停止/导出判断缺陷。用户明确同意 reset 使用保存的原始基线包覆盖安装；保留应用数据，不重新编译，不调用卸载，不在失败后切换方案。用户要求重启 Codex 并再次通知后才运行设备/宿主测试，因此本轮不执行 SDK E2E、Codex 或 OpenCode 设备调用，也不改变设备镜像、宿主配置或既有待取回会话。

**边界：代码与本地回归完成不等于真实设备验收完成。旧 API 26 录像的源文件为 0 字节，本轮没有恢复出视频，也尚未取得其生成失败时刻的有效日志，不能声称这段录像的产生原因已完全查清。**

## TODO 与证据

| 状态 | 工作 | 证据 |
| --- | --- | --- |
| [x] | reset 命令语义根因 | `bm quickfix -r` 调用 DeleteQuickFix，只删除未启用补丁；已部署补丁另存于应用信息。原实现不查询设备状态便删除基线并返回成功 |
| [x] | reset 明确恢复原始安装包 | 安装前记录包 SHA-256，基线保存原始 HAP/HSP 副本；设备、bundle、安装标识、归档路径、包哈希不匹配时拒绝；覆盖安装后要求设备报告该 bundle 的 patch version code 为 0 才清理基线 |
| [x] | 不编译当前源码、不卸载、不切换恢复方案 | 单测保留当前源码和后来改写的构建包，验证安装的仍为原始字节；安装失败/补丁仍在/查询异常均保留基线。旧版基线没有安装包，不伪造迁移，须重新建立基线 |
| [x] | 录屏命令回执与真实服务状态分离 | 启动前持久化意图，只发送一次启动；必须查询到具备 ID、启动时间的 ACTIVE 服务才返回 recording；空/错误/残缺 dump 不当作 idle |
| [x] | 停止、归属与失败会话保护 | 记录服务身份和停止意图；不停止其他实例，不在取消后重复切换；失败保留原会话，不自动 discard。并发导出使用独立暂存路径，删除回执只匹配原文件名 |
| [x] | 导出校验与准确错误 | 媒体查询必须唯一；命令状态、stdout/stderr 和有效 MP4 均校验。open source media file failed 不再无依据归为 CAPABILITY_UNAVAILABLE；导出和清理同时失败时同时报告 |
| [x] | 加强待执行 E2E | reset 在源码仍保留补丁时检查设备 patch=0、启动后原文字可见、点击后原行为恢复、补丁文字隐藏；录屏检查真实视频帧、时长及 ffmpeg 严格解码，失败保留调用与日志，不丢弃会话 |
| [x] | 最终版本本地单元测试、类型检查与性能门禁 | v1.4.4 最终构建 183/183 单测通过，失败/跳过均为 0；typecheck、diff --check 通过。握手中位数 88 ms（86–96 ms）、空闲 RSS 68 MB、10 秒空闲 CPU 不变；15 个工具共 36,848 字节，公共说明 1,737 字节，既有门禁未修改 |
| [x] | 上游对齐 | 491 项：374 full、74 host、43 skip；partial/undecided/invalid/stale 均为 0，无新上游提交。skip 是既有明确范围决策，不是测试跳过 |
| [x] | GitHub 提交、全部 CI、Release、tag、Latest | 发布提交 2606007d93c477385a33ae02d25395f635285bfb；CI 38043365893 的 7 项任务全部通过，release 38043440071 成功；工作流回执及本地只读核验一致，v1.4.4 为 Latest、tag 指向发布提交。详见下方交付记录 |
| [ ] | Codex 实际重载 v1.4.4 | 等用户确认重启后，原生 doctor 核对版本与 build_id；GitHub 发布不证明宿主重载 |
| [ ] | reset 真实 SDK 与应用数据保留验收 | 等重启通知后运行加强的 E2E，再以 Codex 原生调用独立复核；现有 v1.4.3 完整部署恢复证据不是新版 reset 验收 |
| [ ] | API 26 原录屏失败的设备根因 | 保留原始 0 字节文件及待取回会话；需当次 recorder/media/codec 日志区分权限/引导、编码器、服务生命周期和媒体写入失败。不可用另一个环境的成功覆盖失败 |
| [ ] | 新版录屏真实取回、视频帧和播放/解码 | 等重启通知；本地 MP4 结构夹具不计真实录屏或播放通过，不以仅服务 ACTIVE 代替此项 |
| [ ] | OpenCode 与 Codex 多轮真实模型复验 | 继续区分拟调用、MCP 实际调用、设备效果；本轮未测试 Claude，范围仍仅 Codex/OpenCode |

## 根因依据

- [Huawei bm 文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/bm-tool-V5)：`quickfix -r` 用于卸载未使能补丁。
- [OpenHarmony bundle_command.cpp](https://github.com/openharmony/bundlemanager_bundle_tool/blob/master/frameworks/src/bundle_command.cpp) 的 RunAsQuickFixCommand 将 remove 路由至 DeleteQuickFix；[quick_fix_deleter.cpp](https://github.com/openharmony/bundlemanager_bundle_framework/blob/master/services/bundlemgr/src/quick_fix/quick_fix_deleter.cpp) 删除 deploying 信息，不等于撤销 deployed 补丁。[revokeQuickFix 系统接口](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-ability-kit/js-apis-app-ability-quickFixManager-sys.md) 是系统 API；不为普通 HDC 伪造系统权限。
- 本地 DevEco Studio 26.0.0.821 的 OpenHarmonyDevice.checkSupportScreenRecord 明确排除 serial 以 `127.0.0.1` 开头的设备。这是 IDE 对该接口的支持边界，**不是旧文件为何为 0 字节的充分证据**，本 MCP 不据此把所有模拟器一律改判不支持。
- 旧证据 `.scratch/v143/record-query-detail.txt` 和 `record-file-stat.txt` 对应同一媒体条目，源文件 0 字节。旧 hilog 采集时段晚于录制，不能用于断定当时的编码器故障。原生失败入口见 [v1.4.3 证据](evidence/v1.4.3-codex-app.json)。私有原始日志不上传。

## 后续验收顺序

1. 用户确认重启后，Codex 原生 doctor 核对 v1.4.4 及最终构建 ID；先保全旧待导出会话及媒体状态。
2. 在原来指定的 API 26 测试模拟器运行 `E2E_TARGET=<原设备> node --test --test-concurrency=1 test/e2e/smoke.test.mjs`，并验证测试应用的数据标记在 reset 后保留。
3. 用 `test/e2e/recording.test.mjs` 验证新录制。现有 ffprobe/ffmpeg 缺失时明确失败，不自动安装或替换环境；失败保留 `.scratch/recording-<时间>/` 的状态、调用与日志，不使用 discard。该程序化 E2E 不替代 Codex/OpenCode 的真实模型调用。
4. Codex/OpenCode 各做多轮独立实际调用。设备能力失败、模型参数错误和 MCP 实现错误分别记录；未通过项继续保留 TODO。

## 交付记录

本地环境为 macOS arm64 / Node v26.0.0，最终构建 ID：`9fd198d4954f7bec17f6d1e60866cd5a13bc200154d497994f9d1be887463eda`。单测与性能检查通过 stdio 子进程完成，只证明新构建的本地行为，不证明 Codex 已重载。设备 E2E 仅完成语法检查，尚未执行。

- 发布提交：[2606007d93c477385a33ae02d25395f635285bfb](https://github.com/like3213934360-lab/deveco_tool/commit/2606007d93c477385a33ae02d25395f635285bfb)。
- [CI 38043365893](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38043365893)：Windows/macOS/Linux × Node 22/24 六项测试及上游门禁全部通过，无跳过任务。
- [Release 工作流 38043440071](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38043440071) 成功，已下载 `verified-release`；本地 `node tools/release.mjs --run 38043365893 --check` 再次确认 [v1.4.4](https://github.com/like3213934360-lab/deveco_tool/releases/tag/v1.4.4) 为 Latest，tag 精确指向发布提交。[公开核验回执](evidence/v1.4.4-release.json)。
- 本次交付回填只修改文档，不移动或重建已发布 tag；回填提交仍须经过全部 CI 和既有 Release 核验。

实际 MCP 是否运行新版仍待用户重启通知后核验，本轮没有重启宿主或执行设备测试，也没有运行 npm 发布。GitHub 发布不能替代这些证据。
