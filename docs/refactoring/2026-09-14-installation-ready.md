# 0.4.0 本机安装与下次重启准备

2026-09-14，用户授权准备下次 Codex 重启使用 0.4.0。单代理执行，没有重跑完整性能长测。

- 已从封印安装包解压至 `/Users/dreamlike/Library/Application Support/DevEcoMCP/installations/native-7-candidate-0.4.0-20260914-1`。ZIP SHA-256：`3a949874c9951ee0db6130d41d9de77a2ef796aa14477a715c0237eb9e350e31`。
- 使用 DevEco 随附 Node 24 安装生产依赖；独立安装检查 12 项通过。
- 检查旧状态没有待完成工作流、原生操作、资源锁或外部会话，随后正常关闭 6 个旧 MCP 进程。通过产品 maintenance plan/apply 执行原目录状态复用和 schema 迁移。
- Codex 配置已指向新安装入口，显式固定 DEVECO_CONFIG 与 DEVECO_STATE_DIR。迁移工具校验其他配置语义不变，并将原配置、状态和密钥备份到加密 journal。0.3.0 完整安装保留。
- 按保存后的 Codex 配置实际启动 MCP：握手版本 **0.4.0**，工具目录 **28 项**，`deveco_doctor` 返回成功，连接正常关闭。
- 日志巡检脚本另存到 preparation 目录，实际读取已迁移数据库成功。新安装继续使用已有性能/错误打点，未加入持续内存采样。

状态目录保留原名称 `states/native-7-release-0.3.0-20260911-1`，用于保留历史绝对制品路径；目录名不代表当前程序版本。今后以入口、MCP 握手与事件 release 字段判定版本。

准备完成后需完整退出并重新打开 Codex，让宿主重新加载 MCP 配置；本次并未替用户重启 Codex。验证的是配置对应入口能实际启动，并非声称已观察未来重启。

证据与回退 journal：`/Users/dreamlike/Library/Application Support/DevEcoMCP/preparation/upgrade-040-20260914-1/`，含 `apply-result.json`、`launch-check.json`、`log-review-check.json`、`journal/` 和 `runtime-log-review.py`。回退需先结束新 MCP 的操作与会话，再使用新安装的 `maintenance rollback` 处理 journal，不能只把入口切回旧程序。

这是已验证范围内的本机候选安装，正式发布的剩余验收条件不因此视为通过。
