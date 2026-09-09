# 编译产物安装与升级验证

分发工具生成的安装验收候选包使用 `private: true`（仓库根 package.json 为 `private: false`，仅正式发布流水线允许发布）；迁移、设备及性能发布门槛仍须完成，不能将此包当成正式 Release。包中只包含编译后的原生运行模块、已核对出处的资源、生产依赖锁、许可证和本说明。不会携带 TypeScript 编译器、官方 CLI、CodeGenie 子 MCP、Skill 安装程序、开发测试或旧启动入口。

## 生成候选包

在原生验证目录执行以下步骤（每个输出目录必须不存在）：

1. `npm run build`
2. `node dist/scripts/native-distribution.js prepare /absolute/candidate`
3. 在 candidate 内运行 `npm install --package-lock-only --ignore-scripts`，将复制的依赖锁归一化为生产依赖图。
4. 返回验证目录，运行 `node dist/scripts/native-distribution.js seal /absolute/candidate /absolute/candidate.zip`。
5. 用 `node dist/scripts/native-distribution.js extract /absolute/clean-install /absolute/candidate.zip` 校验并解压至新目录。
6. 在 clean-install 内运行 `npm ci --omit=dev`。安装原生依赖时必须允许其安装脚本；无需运行 TypeScript 构建，也无需安装官方 Skill。
7. 在验证目录运行 `node dist/scripts/native-installation-check.js /absolute/clean-install /absolute/new-evidence`。

ZIP 包含 package-lock.json（npm pack 默认会排除这个文件）。封装前必须排除旧依赖及开发依赖记录，核对所有直接依赖的确切版本与完整性。每个文件的大小和 SHA-256 写入 distribution.json，ZIP 另附 .sha256。校验和用于确认字节一致性，不是发布者签名。解压器拒绝路径穿越、符号链接、大小写冲突和超出 256 MiB / 10000 文件预算的输入。

运行基线为 Node 22.18+ 的 22 系列和 Node 24。每个操作系统、架构和 Node 主版本都在本机安装对应原生依赖，不复制别的机器的 node_modules。实际 SDK/设备支持证据与基础安装验收分别记录。

安装时也须将选定 Node 的目录放在 `PATH` 首位，确认 `node --version` 后再运行 npm。仅用 Node 22/24 的绝对路径启动 `npm-cli.js` 不足以固定安装脚本的 Node：脚本仍可能从 `PATH` 找到系统 Node 26，生成与实际宿主 ABI 不匹配的 SQLite 模块。遇到这种情况，在正确的 `PATH` 下重新执行该独立安装目录的 `npm ci --omit=dev`，再完成 `native-installation-check`。

## 用户切换步骤

1. 在旧版中结束或取消任务，停止热重载与 LSP 会话。
2. 保留前一个完整安装目录和本次安装的版本、ZIP SHA-256、Node 版本及启动配置记录。将新版解压到另一个目录，校验后执行 `npm ci --omit=dev`。
3. 使用新版配置 JSON 设置非默认工具链位置，通过 `DEVECO_CONFIG` 指向该文件；状态目录可使用 `DEVECO_STATE_DIR`。清除旧环境变量配置。
4. 将宿主 command 设为该机器的 Node 绝对路径，args 设为新版 `/absolute/installation/dist/src/cli.js`。没有旧路径转发。
5. 新版认证需重新登录，不导入旧凭据格式。保留用户 UI 流程文件并通过新版校验；不加载旧任务引擎或旧内存任务。
6. 运行 `node dist/src/cli.js doctor`，再执行创建、构建、设备及既有 UI 流程验收。安装检查只证明基础运行、资源和持久化可用，不代替这些专项验证。
7. 依据可核对的本项目安装记录清理其安装的官方 Skill；用户自行维护的 Skill 不属于自动删除范围。

回退时先结束新版任务和会话，再将宿主切回前一个完整安装目录及对应配置；按其 Node 版本重新安装依赖。执行协议不同的版本使用独立状态目录，历史报告导出为静态文件，不用旧引擎解码新版任务。软件回退不会撤销工程修改、签名、安装或设备输入。维护命令可以在固定计划和摘要核对后改写所选宿主配置；Skill 清理由独立计划明确列出删除及保留项。它们不会发布 Release。


## 持久化切换命令

先完成新目录的生产依赖安装和 `native-installation-check`，再使用该目录的 Node 22.18+ / 24 与 `dist/src/cli.js maintenance`。不要用系统 Node 26 安装的原生模块充当新安装。维护计划固定运行文件、实际 node_modules 字节、依赖锁、Node 可执行文件、宿主配置和用户流程摘要。

```sh
/absolute/node24 /absolute/new-install/dist/src/cli.js maintenance plan /private/spec.json /private/plan.json
/absolute/node24 /absolute/new-install/dist/src/cli.js maintenance apply /private/plan.json /private/new-upgrade-journal --sessions-ended
/absolute/node24 /absolute/new-install/dist/src/cli.js maintenance rollback /private/new-upgrade-journal --sessions-ended
```

spec 包含 `host_config`、`host_format`（`codex-toml` 或 `mcp-json`）、`server`、`installation`、`node`、新的 `state_dir`、`configuration`、`flow_files` 和旧状态目录 `previous_state_dirs`。两个完整安装目录必须互不包含。`--sessions-ended` 是操作者已经结束会话的声明；命令仍只读检查进程和指定状态库，发现未终结任务或未关闭外部会话会拒绝。不会替用户强杀不明进程。

Codex TOML 保留所选 MCP 的超时、启用和工具权限字段，也保留其他 MCP 配置，仅替换启动字段及环境；不支持无损处理的启动字段语法明确拒绝。[Codex MCP 配置字段](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)定义了这些启动和权限设置。全配置回退记录加密存储在私有 journal，不复制到仓库。认证重新登录，旧状态库不导入新执行协议；计划中的用户流程文件逐个核对并原位保留。

### 当前旧入口缺失的修复

当宿主记录的 `src/server.mjs` 已不存在，使用 `mode: "repair_missing_entry"`。该模式只允许旧入口确实缺失、有可识别的旧安装根目录、新目录完整且会话检查通过的情况。它不要求虚假的 `--sessions-ended` 声明，返回 `rollback_available:false`。记录旧配置用于审计，但拒绝将恢复损坏入口称为软件回退。普通升级仍要求保留前一个完整安装。

### 已安装 Skill 的精确清理

```sh
/absolute/node24 /absolute/new-install/dist/src/cli.js maintenance skills-plan /absolute/host/skills /absolute/old-install /private/skills-plan.json
/absolute/node24 /absolute/new-install/dist/src/cli.js maintenance skills-apply /private/skills-plan.json
```

只识别 `.deveco-tool-host.json` 声明属于指定旧安装、且匹配 `provenance/installed-skill-fingerprints.json` 的副本或链接。修改过的文件、额外空目录、链接目标变化及未知来源均保留。断开的原有链接只删除链接本身。执行前再次核对文件身份与摘要；中断记录支持同一计划继续，第三种内容拒绝，用户维护的 Skill 不受影响。
