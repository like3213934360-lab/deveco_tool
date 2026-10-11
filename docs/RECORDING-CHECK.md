# 录屏文件严格验收

录屏 E2E 与 USB 真机验收统一调用 `tools/recording-check.mjs`。FFmpeg / ffprobe 只用于独立验收，需在验收机器上已有；脚本不安装、升级工具或修改环境，MCP 运行与 npm 包不依赖它们。

## 使用

在仓库根目录检查已取回的原始录屏，明确指定一个尚不存在的回执路径：

```sh
node tools/recording-check.mjs /absolute/recording.mp4 /absolute/new-check.json
```

回执目录必须已存在。回执独占创建，既不覆盖旧证据，也不允许把原视频或其链接用作输出。失败会非零退出；工具版本、参数、退出码、信号、stdout、stderr、探测结果和失败原因保存在回执中。视频只作为输入，解码结果交给 null 输出，不写媒体文件。

`test/e2e/recording.test.mjs` 自动保存 `recording-check.json`；`test/audit/physical.mjs lifecycle` 自动保存 `<录屏文件>.check.json`。两者在设备操作前检查工具可用性，保持原帧数、时长、文件大小及 MCP 状态断言。无需在验收结束后临时补命令。

## 检查规则

- ffprobe 实际解码计数，必须存在视频，各视频/音频流必须有可解码帧，视频尺寸有效。
- FFmpeg 保留 `-v error -xerror`，加入 `-err_detect explode`，解码全部视频及所有已有音轨；没有音轨是录屏允许的情况，有音轨则必须通过。空输出流也失败。
- 视频输出采用 `-enc_time_base:v demux -fps_mode passthrough`：保留源时间基及帧时间戳，避免默认输出时间基按平均帧率取整引起 DTS 冲突。不重编码原文件、不补帧丢帧、不生成时间戳或过滤错误日志。
- 除退出码为 0 外，error 级别 stderr 必须为空；退出码为 0 但仍有诊断信息也失败。每个进程限时 120 秒；工具缺失、参数不支持、超时、信号终止及输出缓冲区溢出均直接失败，不重试或切换方案。

参数依据：[FFmpeg time base 与帧同步选项](https://ffmpeg.org/ffmpeg.html#Advanced-options)、[null muxer](https://ffmpeg.org/ffmpeg-formats.html#null)。本次真实验证版本为 FFmpeg / ffprobe 8.1.2；其他版本需支持上述参数，未在本轮逐版验证。

这证明文件含可解码媒体，不证明页面操作符合需求、画面无视觉缺陷、音画同步或麦克风内容正确。这些仍需独立实际检查。

## 脚本回归

```sh
# 随 npm test 执行：进程/诊断契约、原文件与回执保护，不需要 FFmpeg
node --test test/unit/recording-check.test.mjs

# 使用现有真实 FFmpeg：固定/可变帧率、音轨、损坏负例，无安装或跳过
node --test test/media/recording.test.mjs
```

真实解码回归在独立临时目录生成小型合成素材与损坏副本，绝不改设备原视频；这些素材只能证明检查器的行为，不当作真机录屏或 MCP 调用成功。普通 CI 的依赖和测试环境保持原样，进程契约回归随六组系统/Node 单测运行；真实 FFmpeg 回归与真机原视频检查单独记录。
