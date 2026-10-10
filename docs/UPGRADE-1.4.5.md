# v1.4.5 reset 真实验收与录屏根因

本轮接用户“继续”后，先用 Codex 原生 doctor 确认实际连接运行 v1.4.4、build ID `9fd198d4954f7bec17f6d1e60866cd5a13bc200154d497994f9d1be887463eda`，再在原 API 26 模拟器 `127.0.0.1:5555` 验收。没有重启宿主、改镜像、调整内存、替换设备或删除原待取回录屏。

**reset 已取得原生实际调用、页面效果和 SQLite 数据保留证据。按用户明确决定，当前模拟器不支持录屏属于正常环境能力边界，不归类为 MCP 缺陷：同一设备的公开编码器查询仅返回 AAC 音频编码器，没有视频编码器；同步日志显示系统录屏在 H.264 编码器初始化时失败。不能将服务 ACTIVE 或导出错误处理通过等同于真实视频成功。**

## 改动与根因

- 首次完整 SDK smoke 为 20/22：两项 reset 已恢复包并返回 patch=0，但独立检查 `bm quickfix -q -b <bundle>` 被 device shell 白名单拦截，后续页面断言没有执行。修正为仅允许该精确只读参数形式；删除、应用补丁和追加参数仍拒绝，不修改原断言来避开问题。
- 补充 SQLite 回归：通过 MCP 单独插入应用启动代码不会创建的记录，在真实补丁生效、源码仍保留补丁时 reset，再核验原页面行为和该记录。不会用启动时重新创建的数据伪装保留成功。
- 录屏 start/status 明确说明其状态证据仅是服务，视频编码仍未验证；只有 stop 成功导出并验证 MP4 才算取回。失败保留原会话和源文件，不自动 discard、不改走截图拼接或其他录制方式。

## TODO 与验收

| 状态 | 工作 | 证据 |
| --- | --- | --- |
| [x] | Codex 原生重载 v1.4.4 | doctor 版本与构建 ID 一致；实际 MCP 调用，不是拟调用方案 |
| [x] | reset 原生页面效果与数据保留 | apply 后显示 Reset Probe Patched；reset 后 HDC 独立查询 patch=0，原进程停止；launch 后 Hello World 可见、点击显示 Welcome、补丁文字隐藏；SQLite 外部插入标记仍在 |
| [x] | 修正独立补丁查询入口 | 精确允许 `bm quickfix -q -b <bundle>`，负例覆盖变更命令、缺参、追加参数、命令拼接；原 E2E 的 patch 查询断言保留 |
| [x] | 最终 v1.4.5 本地与 SDK 回归 | typecheck、184/184 单测、22/22 SDK smoke 通过，失败/跳过均为 0；包括三条 reset 场景和外部 SQLite 标记保留。最终构建及日志摘要见本地验收证据 |
| [x] | 性能与上游门禁 | 握手中位数 101 ms（95–119），空闲 RSS 44 MB，10 秒 CPU 不变；15 个工具 36,848 字节、公共说明 1,737 字节，门禁未改。上游 491 项（374 full / 74 host / 43 skip），未决/失效均为 0 |
| [x] | 模拟器录屏能力边界（正常行为） | 同步 hilog 显示 video/avc 初始化 63569932 → PrepareVideoEncoder 失败 → AVRecorder 5400103；同设备应用调用 getAvailableEncoder 仅返回 audio/mp4a-latm。没有可用视频编码器，源视频无法生成 |
| [x] | 保留原录屏与明确失败 | 原 0 字节媒体及待导出回执仍在，原生 record_stop 返回 UI_RECORD_FAILED；没有将其清理或当作通过 |
| [x] | 模拟器录屏验收分类 | v1.4.4 严格视频 E2E 实际未通过，原始结果保留；按用户决定归为预期不支持，不计为 MCP 缺陷或发布阻塞，也不改写成视频成功 |
| [x] | 支持录屏的真机取回、视频帧与严格解码 | 用户指定 USB Pura 80 Pro 后，Codex 原生录屏与原严格录屏 E2E 均通过；分别为 248,222 / 153,191 字节，78 / 67 帧 H.264，FFmpeg 严格解码无错误，最终 idle 且无待取回文件 |
| [x] | 真机两轮 reset 页面恢复与数据保留 | 同一 USB 真机，普通 apply 与显式 files+restart 均先断言补丁实际生效；源码仍带补丁时 reset，独立查询 patch=0、进程停止；重启后原页面和点击行为恢复，应用初始化不会创建的 SQLite 标记两轮均保留 |
| [x] | v1.4.5 推送、全部 CI、Release、tag、Latest | 发布提交 ed0649aa03183c9824d3a38f49bd56cb30f116c2；CI 38044962560 的 7 项任务全部通过，release 38045019299 成功；工作流回执及本地只读核验一致，tag 指向该提交且 v1.4.5 为 Latest |
| [x] | Codex 实际重载 v1.4.5 | 用户再次重启后，原生 doctor 返回 v1.4.5，build ID 与最终发布构建完全一致；下方记录两轮原生效果验收 |
| [x] | v1.4.5 Codex 两轮实际调用 | 不重启补丁与显式 files+restart 补丁均先验证生效；源码仍保留补丁时 reset，MCP 独立查询 patch=0，原进程停止，原页面/点击行为恢复，旧、新 SQLite 标记均保留 |
| [ ] | OpenCode 新版真实模型复验 | 本轮未重新运行 OpenCode；此前结果不自动延续为 v1.4.5 通过。Claude 不在适配范围 |

[脱敏原生证据](evidence/v1.4.5-native-acceptance.json)区分已加载版本、调用、设备效果和失败边界。完整原始日志保存在私有 `.scratch/v144/`，不上传设备日志。

## 录屏证据边界

编码器错误文本中的“no memory”不能单独证明物理内存不足。[OpenHarmony CodecServer::InitByMime](https://gitee.com/openharmony/multimedia_av_codec/blob/master/services/services/codec/server/codec_server.cpp) 在没有编码器候选或创建失败时也可返回 AVCS_ERR_NO_MEMORY；公开源码版本不冒充设备二进制版本。本轮以设备实时日志加安装 SDK 声明的 `media.AVRecorder.getAvailableEncoder()` 实际返回相互印证：只有 AAC，没有 video 编码器。

原来那段 0 字节录像缺少产生时刻日志，不能把新复现日志冒充旧日志。旧源文件没有可恢复的视频内容；新复现确认的是当前同一环境的系统编码能力缺失。用户已明确将模拟器不支持录屏视为正常行为，不作为 MCP 问题继续修复。尝试的独立 native 能力探针因链接依赖失败，没有运行成功，不纳入能力结论；随后通过实际安装运行的测试应用完成公开 API 查询，未修改系统库或配置。

## 交付记录

最终本地构建 ID：`44db485182694c582ba2e60e94a09673edf6dfbe12b555810c8dbe3c4cab9193`。[本地与 SDK 验收证据](evidence/v1.4.5-local-acceptance.json)对应最终代码，完整 SDK smoke 214 秒，22 项全部通过；首次查询修正后的中间版本也完成 22/22，但不用于替代最终新增的数据保留断言。

- 发布提交：[ed0649aa03183c9824d3a38f49bd56cb30f116c2](https://github.com/like3213934360-lab/deveco_tool/commit/ed0649aa03183c9824d3a38f49bd56cb30f116c2)。
- [CI 38044962560](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38044962560)：Windows/macOS/Linux × Node 22/24 六项测试及上游门禁全部通过，没有跳过任务。
- [Release 工作流 38045019299](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38045019299) 成功；已下载 verified-release，并运行 `node tools/release.mjs --run 38044962560 --check` 独立核对。[v1.4.5](https://github.com/like3213934360-lab/deveco_tool/releases/tag/v1.4.5) 为 Latest，tag 指向发布提交，见[公开核验回执](evidence/v1.4.5-release.json)。
- 此次回填只修改文档，不移动或重建 tag；回填提交仍须经过全部 CI 与既有 Release 核验。

发布当时 Codex 仍运行 v1.4.4。用户随后再次重启，现已通过原生 doctor 核验 v1.4.5，详见下方；没有执行 npm 发布。GitHub 发布不能替代宿主证据。


## 用户重启后的 Codex 原生验收

2026-10-10 用户再次确认已重启 Codex。原生 doctor 返回 v1.4.5 与最终 build ID `44db485182694c582ba2e60e94a09673edf6dfbe12b555810c8dbe3c4cab9193`，完成实际宿主重载验证。初始无在线设备，通过原生 emulator start 冷启动原专用 `deveco_mcp_eval_143`，保留原数据，没有重置、更换镜像或切换到真机。

两轮均通过 Codex App 的原生 MCP 工具完成构建部署、apply、UI 断言、reset、独立补丁查询、启动及 SQLite 查询；文件工具仅修改验收工程源码。第一轮修改点击行为并保留原进程；第二轮显式传入 files 和 restart=true，修改启动文字并确认新进程。两轮都在源码仍带补丁时 reset，独立查询补丁版本分别从 3000006、3000008 变为 0，pidof 确认应用已停止；重新启动后 Hello World 可见、点击出现 Welcome、补丁文字隐藏。

上轮写入的 SQLite 标记 `reset-preserve-179162-v144` 和本轮由 MCP 单独插入的 `codex-v145-reload-preserved` 两轮后都仍在；应用初始化仅建表，不会重建标记。验收完成后恢复私有工程原源码。录屏只读取状态，旧待取回文件名保持不变，新说明明确视频尚未验证；本轮没有启动新录屏，模拟器不支持仍视为正常能力边界。

[本轮原生调用证据](evidence/v1.4.5-codex-reload.json)独立于先前 v1.4.4 的证据。本次仅回填文档，不改变运行产物、不升级版本、不移动 v1.4.5 tag；推送后仍核验当前提交全部 CI 和已有 Release/Latest。这次模拟器验收未覆盖 OpenCode 新版复验和真机录屏；后续真机结果见下节。

## 用户指定 USB 真机后的验收

2026-10-10 用户要求用真机验证，并选择 USB 连接的 HUAWEI Pura 80 Pro（LMR-AL00、API 26，系统 LMR-AL00 7.0.0.109(SP6C00E105R7P5)）。Codex 原生 doctor 仍返回 v1.4.5 与上述最终 build ID。本轮只操作新建的专用包 `com.devecomcp.physical145`，没有改手机系统、SDK 镜像、测试断言或产品运行代码。

真机需要调试签名。首次 auto 正确拒绝未指定的多团队；用户选定个人团队后，AGC 明确返回证书配额已满（205389872）。该 auto 调用没有被记为成功，也没有删除旧证书。随后复用该团队已有的有效证书与密钥，通过 MCP 确认手机已注册并为测试包创建 profile，核对证书、包名、有效期和设备范围后，只配置新测试工程。原项目和签名材料未修改。

- **录屏两条实际路径通过。** Codex 原生调用 start/status、点击测试页面、UI assert、stop，取回 248,222 字节 MP4；ffprobe 验证 862×1920 H.264、11.007 秒、78 帧，FFmpeg `-v error -xerror` 全帧解码通过。接着在同一测试页面执行现有 `test/e2e/recording.test.mjs`，1/1 通过、0 失败、0 跳过；独立取回 153,191 字节、3.609022 秒、67 帧视频，严格解码通过。两次最终状态均 idle，无待取回文件。录屏 MP4 和完整原始日志仅保存在私有目录，不上传 GitHub；没有把服务 ACTIVE 当作视频成功。
- **reset 两轮原生调用通过。** 第一轮补丁修改点击行为，PID 53039 保持不变，独立查询 patch=3000001；第二轮显式 files+restart 修改启动文字，PID 从 56591 变为 56622，patch=3000003。均先用 UI assert 确认补丁生效，再在源码仍带补丁时 reset；两轮都独立查询 patch=0，pidof 确认应用停止，launch 后 Hello World 可见、点击出现 Welcome、对应补丁文字隐藏。
- **数据保留独立验证。** 第一次部署后通过 MCP SQLite 单独插入 `(14501, physical-v145-preserved)`；应用启动只建表，不插入或重建标记。两轮 reset 后查询均保留这条记录。验收完成后恢复私有测试工程基线源码，保留测试应用和证据便于复核。

[脱敏真机证据](evidence/v1.4.5-physical-acceptance.json)记录原生实际调用、两段视频哈希、独立解码结果和证据范围。真机成功不改变原模拟器的“不支持录屏”结论。此次只回填文档，保持 v1.4.5 及既有不可变 Release/tag；当前文档提交仍须完成全部 CI 和 release 工作流核验。OpenCode v1.4.5 真实模型复验、其他机型及全部 MCP 工具的真机覆盖、麦克风/音频录制不在本轮已验证范围内。

## 继续扩展 USB 真机工具覆盖

同日按用户要求继续验证其他工具，仍使用同一 USB Pura 80 Pro、同一 v1.4.5 构建和原测试环境。新增可重复执行的 `test/audit/physical.mjs` 与独立 fixture recipe；完整结果见 [USB 真机 action 验收](PHYSICAL-AUDIT-1.4.5.md)及[脱敏证据](evidence/v1.4.5-usb-full-audit.json)。

实际 tools/list 的 15 个工具、102 个 action 已全部分类：80 项有成功证据（其中 apply/reset 引用上一轮同机原生结果），10 项受环境或测试对象限制，12 项未验证。11 个阶段的 72 个用例最终通过，含真实编译/启动错误等负例；保留首次脚本失败日志和查因记录，没有将未执行操作算成通过。Codex 原生调用和真实 stdio 批量调用分别记录，不能推导为 OpenCode 模型验收。

| 状态 | 工作 | 证据 |
| --- | --- | --- |
| [x] | 其他工具全量 action 清单与分级 | 102 项逐项对应成功、受限或未验证；知识库 check-only 与实际更新分开；签名配额和模拟器专用动作明确列出 |
| [x] | SDK、LSP、任务、UI、数据与诊断真实路径 | 72 项实际用例；编译失败后同 job 恢复、真实启动崩溃与 faultlog、SQLite 拒绝写入后数据未变、全套手势及鼠标 hover 效果 |
| [x] | 流程、引导、人工 review、性能和录屏 | 两轮流程回放；三步引导保留默认值且不误点业务；真实看图判定并核对导出；composer 两轮帧数据；最终 68 帧 MP4 严格解码通过 |
| [x] | 自动 relaunch 与收尾 | HAP 哈希/mtime、设备安装时间不变；测试源码恢复，新增测试应用卸载；原测试应用保留，原生录屏状态 idle |
| [x] | 本地回归与性能门禁 | typecheck、184/184 单测、bench、491 项上游对齐门禁通过，无放宽、失败或跳过单测 |
| [ ] | 本轮推送、全部 CI 与既有 Release/Latest 核验 | 仅测试/文档变化，保持 v1.4.5；发布流程完成后回填 |
| [ ] | 未覆盖环境及操作 | 保留报告中 12 项未验证与 10 项受限的待办；不声明全部参数、机型、音频或 OpenCode 真实模型通过 |
