# 原生编译包验收记录

`scripts/native-distribution.ts` 生成独立 ZIP 安装候选，不改变当前仓库默认入口。`provenance/native-dependencies.json` 是验证目录和编译包共用的依赖名单；版本仍来自包声明和 npm 锁。原生模块只打包 dist/src，资源完整性继续由 provenance/resources.json 校验。

## 本机已验证

2026-09-08，macOS arm64：

- 完整编译回归 194 项通过、0 跳过：`/private/tmp/deveco-native-regression-node26-20260908-27/evidence.json`。
- ZIP `/private/tmp/deveco-native-distribution-20260908-1.zip`：48,249,258 字节，SHA-256 `6c84b70cf261159a1f231486d233304112d216b75271014d5ceae2c683a1a944`。
- 封装清单包括 327 个文件、90,074,611 字节、119 项有出处的资源。生产锁有 176 个依赖记录；本机安装 159 个适用包，其余包含其他平台的可选包。
- 两个独立目录由同一个 ZIP 解压，各自用 Node 22 / 24 执行 `npm ci --omit=dev`，均未运行 TypeScript 构建，也未安装官方 CLI、CodeGenie 子 MCP 或 Skill。
- Node 22 安装验收 10 项通过：`/private/tmp/deveco-native-installation-node22-20260908-1/evidence.json`。
- Node 24 安装验收 10 项通过：`/private/tmp/deveco-native-installation-node24-20260908-1/evidence.json`。

验收包括 MCP 握手、25 项结构化工具、8 个工作流、静态目录不启动数据库、Worker / SQLite 初始化、本地文档索引和 ZIP 读取、LangGraph 执行、整个 MCP 进程重启后结果持久化及请求去重、关闭后安装文件摘要不变。状态写入独立证据目录，不改动用户 MCP 状态或项目。

## 边界与后续门槛

当前候选包 private=true，类型为 installation-validation。基础安装检查已经加入 Node 22 / 24、macOS / Windows / Linux 六组 CI，新增步骤的远程结果仍待核对。当前本机证据不证明另外两个操作系统的 SDK 或设备能力。

封装测试还覆盖未归一化锁、旧依赖、开发依赖、软链接、本地链接依赖、版本偏移、缺少完整性、资源篡改、路径穿越、Windows 保留名、大小写冲突和虚报解压大小。校验和不是发布者签名；仍须在正式发布时绑定受信任的发布记录。完整迁移、专项能力、升级回退及性能门槛没有因此完成。用户步骤见 [编译产物安装与升级验证](native-installation.md)。
