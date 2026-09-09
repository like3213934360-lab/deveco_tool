# 原生编译包验收记录

`scripts/native-distribution.ts` 从唯一原生编译入口生成独立 ZIP 安装候选。`provenance/native-dependencies.json` 是验证目录和编译包共用的依赖名单；版本仍来自包声明和 npm 锁。原生模块只打包 dist/src，资源完整性继续由 provenance/resources.json 校验。

## 当前跨平台验证

提交 `caf97cc` 的 [CI 34231914954](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34231914954) 在 macOS / Windows / Linux × Node22/24 六组全部通过。macOS/Linux 每组 312 项、Windows 每组 301 项适用回归通过，零失败、取消、跳过；Windows 每组另通过 20 轮进程压力检查。六组从 ZIP 解压并只安装生产依赖，各 10 项安装检查通过。

六组分发清单完全一致：401 个文件、90,543,290 字节，清单 SHA-256 为 `d31d71c83144ca76a20a7c684b6dac323beb93efa794f6526c38fbeb0bdc41dd`。回归编译摘要为 `90b34d88`，上游锁为 `bf3cc411`；原始制品保存在本机验收目录 `20260908-native6-platform-ci-5`。清单摘要不是 ZIP 压缩文件摘要。对应构建仍是安装验证候选，尚未作为正式 Release 发布；后续文件变化须重新核对分发身份。

## 历史本机验证

以下保留早期版本证据，不证明当前版本通过。

2026-09-08，macOS arm64：

- 完整编译回归 194 项通过、0 跳过：`/private/tmp/deveco-native-regression-node26-20260908-27/evidence.json`。
- ZIP `/private/tmp/deveco-native-distribution-20260908-1.zip`：48,249,258 字节，SHA-256 `6c84b70cf261159a1f231486d233304112d216b75271014d5ceae2c683a1a944`。
- 封装清单包括 327 个文件、90,074,611 字节、119 项有出处的资源。生产锁有 176 个依赖记录；本机安装 159 个适用包，其余包含其他平台的可选包。
- 两个独立目录由同一个 ZIP 解压，各自用 Node 22 / 24 执行 `npm ci --omit=dev`，均未运行 TypeScript 构建，也未安装官方 CLI、CodeGenie 子 MCP 或 Skill。
- Node 22 安装验收 10 项通过：`/private/tmp/deveco-native-installation-node22-20260908-1/evidence.json`。
- Node 24 安装验收 10 项通过：`/private/tmp/deveco-native-installation-node24-20260908-1/evidence.json`。

验收包括 MCP 握手、25 项结构化工具、8 个工作流、静态目录不启动数据库、Worker / SQLite 初始化、本地文档索引和 ZIP 读取、LangGraph 执行、整个 MCP 进程重启后结果持久化及请求去重、关闭后安装文件摘要不变。状态写入独立证据目录，不改动用户 MCP 状态或项目。

## 历史 CI 与发布边界

当前候选包 private=true，类型为 installation-validation。[CI 34164299338](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34164299338) 在提交 `33a6a72ae9ed4c57b6b5614701d30818340198f1` 上的 Node 22 / 24、macOS / Windows / Linux 六组全部通过；已逐组核对日志，每组均为完整回归 194 项通过、0 跳过、ZIP 干净安装检查 10 项通过，两个 Windows 作业还完成各 20 轮进程压力检查。日志保留于 `/private/tmp/deveco-ci-34164299338.log`。这证明对应平台的基础编译包安装与运行，不证明这些平台的实际 SDK 或设备能力。

封装测试还覆盖未归一化锁、旧依赖、开发依赖、软链接、本地链接依赖、版本偏移、缺少完整性、资源篡改、路径穿越、Windows 保留名、大小写冲突和虚报解压大小。校验和不是发布者签名；仍须在正式发布时绑定受信任的发布记录。完整迁移、专项能力、升级回退及性能门槛没有因此完成。用户步骤见 [编译产物安装与升级验证](native-installation.md)。
