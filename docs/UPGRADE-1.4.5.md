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
| [ ] | 支持录屏的真机取回、视频帧与严格解码 | 尚未验证；本轮不切换到其他连接设备。此项是后续能力验证，不是当前模拟器的待修复缺陷 |
| [x] | v1.4.5 推送、全部 CI、Release、tag、Latest | 发布提交 ed0649aa03183c9824d3a38f49bd56cb30f116c2；CI 38044962560 的 7 项任务全部通过，release 38045019299 成功；工作流回执及本地只读核验一致，tag 指向该提交且 v1.4.5 为 Latest |
| [ ] | Codex 实际重载 v1.4.5 | 当前原生连接仍为 v1.4.4；新构建的 stdio/SDK 结果不替代宿主重载 |
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

发布后再用原生 doctor 复核：Codex 仍运行 v1.4.4（原 build ID 不变），原录屏待取回会话仍在。没有执行宿主重启或 npm 发布；GitHub 发布不能替代这些证据。
