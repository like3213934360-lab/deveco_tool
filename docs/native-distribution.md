# 原生编译包验收记录

`scripts/native-distribution.ts` 从唯一原生编译入口生成独立 ZIP 安装候选。`provenance/native-dependencies.json` 是验证目录和编译包共用的依赖名单；版本仍来自包声明和 npm 锁。原生模块只打包 dist/src，资源完整性继续由 provenance/resources.json 校验。

## 当前 main 与已安装候选的区别

当前运行/开发编译身份为 `cc3cdfd1` / `680bf03b`。对应 [CI 34319011003](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34319011003) 的 14 份报告已逐份核对：macOS/Linux × Node22/24 各 363 项回归、Windows × Node22/24 各 352 项回归通过，六组干净安装各 10 项、Windows 两组进程检查各 20 轮通过。CI 整体仍因上游凭证校验失败。原始报告及摘要核对位于本机 `preparation/ci-34319011003-review-1`。

实际 Codex 宿主仍为下述 `bc68e0c` 候选，尚未包含后续 CLT 空模拟器清单解析修复。该安装的应用内重连已有证据，不需要为旧候选重复重启；最终版本仍需完成宿主更新与对应验证。

## 已安装 bc68e0c 候选的验证

main `bc68e0c` 的 [CI 34304363980](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34304363980) 已逐组核对原始报告。macOS/Linux × Node22/24 各通过 362 项回归，Windows × Node22/24 各通过 351 项适用回归，失败、取消、跳过和 todo 均为零；六组干净安装各 10 项通过并正常关闭，Windows 两组各 20 轮原生进程退出检查通过。整轮 CI 结论仍为失败，六组唯一失败步骤均为上游凭证检查，不能描述为整轮通过。三平台基础运行不证明其他平台实际 SDK 或设备能力。

本机候选 ZIP 的 SHA-256 为 `5d431fb091cdb0fef574b20ee996192651bc5ea82e22e999c6f9b07d0e021ab9`，分发清单 SHA-256 为 `f341a7548da0ea67771726c7fe548a3b770cd6b02ba3e9c11b337091dfda8c65`；清单含 407 个文件、90,618,384 字节。两种摘要分别对应压缩文件与清单，不能互换。macOS arm64 的 Node22.23.2 和 Node24.14.1 在两个新目录各通过 10 项干净安装检查。本轮重新核对了 ZIP 及两份原始报告的摘要。

候选位于本机 preparation 目录 `main-delivery-bc68e0c-1`；报告位于 acceptance 目录 `20260909-main-install-bc68e0c-node22-1`、`20260909-main-install-bc68e0c-node24-1` 和 `20260909-main-ci-34304363980`。该版本的运行摘要为 `85a5e037`，完整开发编译摘要为 `c9fc32c4`。实际安装只含 92 个生产 JS 文件，其运行摘要和编译摘要均为 `85a5e037`；不能用包含开发脚本和测试的 `c9fc32c4` 代替安装目录摘要。安装使用的生产依赖锁摘要为 `3aca8a6e`，也与开发依赖锁区分。该包仍是 installation-validation 候选；其 Codex 应用内重连已确认，正式 Release 尚未完成。验收剩余范围见[当前核对清单](native-acceptance-review.md)。

该候选另通过 10 项隔离升级/回退检查：旧版与新版实际 MCP 可运行，活跃会话阻止切换或回退，加密回退记录、策略保留、幂等重试和十份既有流程文件字节保留均已核对。报告为 `20260909-main-upgrade-rollback-bc68e0c-1`。

真实宿主切换记录位于 preparation 下的 `main-host-upgrade-bc68e0c-2`：先核对旧状态无未完成任务、受管进程或外部会话，再向 5 个已确认归属 Codex 的旧 MCP 实例发送 SIGTERM 并确认退出。当前 Node24 安装复制到 installations 下的 `native-6-main-20260909-1`，完整安装摘要保持一致；维护 CLI 已应用新计划，保留旧完整安装和加密回退记录，十份流程字节不变。按实际新配置独立启动 MCP 的 6 项检查通过并关闭；用户重启 Codex 后，应用内实际 `deveco_doctor` 调用成功，新安装进程、Node24、新状态目录及配置摘要均匹配。重连成功原始响应及复核分别保存在 `app-reconnect-success.private.json`、`app-reconnect-review.private.json`；先前 `Transport closed` 的失败记录保留。新状态未导入旧凭据，Developer 与 CodeGenie 已分别通过真实浏览器回调重新登录，当前生产 MCP/Worker 的云端只读查询及重启后保留验证分别通过 9/10 项，报告见[完成清单](native-completion.md)末尾。

## 历史跨平台验证（caf97cc）

以下保留对应旧版本证据，不代表当前 main 的整轮 CI 结论。

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
