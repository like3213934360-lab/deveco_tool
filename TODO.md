# 当前待办

只保留未完成事项；完成后移除。功能范围遵循 [协作规范](AGENTS.md#功能定位与判断边界)，测试入口见 [测试指南](test/README.md)。

## 对齐 DevEco CLI 和 DevEco Code

当前对齐的 DevEco CLI 和 DevEco Code 提交见[上游映射基线](tools/upstream/decisions.json)。

- [ ] 在官方 DevEcoTestingCli 上实测独立安装和更新服务，用操作前后的服务清单确认版本。当前 macOS 安装只提供 DevEcoTestingConsole。
- [ ] 在允许 HDC 调用 `ohos-avsession-manager` 的设备验收媒体会话列举、播放暂停、切歌、快进快退和跳转进度。
- [ ] 验收 AppAnalyzer 前台功耗。需要在真机上分别验收提供 `powerAnalyze` 的手动模式和 `autoAnalyze -h` 列出 D04 的自动模式。
- [ ] 按发布流程核验 v1.7.6 的 GitHub CI、Release、tag 和 Latest。
