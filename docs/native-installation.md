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

0.4 的协议迁移同时改变日常入口：项目调用必须显式传入绝对 `project_path`；`project_context resolve` 只返回不可变描述，旧 `switch_cwd` 不再设置默认项目。新规划、规格和修复方法通过 `domain_recipe` 按需读取；旧指导任务仍能 read/export/archive，但 start/write/publish 等推进操作返回 `GUIDANCE_LIFECYCLE_RETIRED`。旧原生工作流与 UI 测试的持久化恢复继续保留。

默认连接只广告 core 工具。需要云端签名管理或模拟器镜像管理时，在宿主环境配置 `DEVECO_TOOL_GROUPS=core,signing-admin,emulator-admin` 并重连；工具集合在一次连接中固定。`compatibility` 可额外广告旧别名，隐藏别名在 0.4 迁移期仍可调用。日常项目、设备、签名校验及模拟器启停不需要开启管理组。旧配置中的 `default_project` 不再提供执行默认目录。

1. 在旧版中结束或取消任务，停止热重载与 LSP 会话。
2. 保留前一个完整安装目录和本次安装的版本、ZIP SHA-256、Node 版本及启动配置记录。将新版解压到另一个目录，校验后执行 `npm ci --omit=dev`。
3. 使用配置 JSON 设置非默认工具链位置，通过 `DEVECO_CONFIG` 指向该文件；状态目录可使用 `DEVECO_STATE_DIR`。维护命令只更新这两个本工具管理的环境键，保留用户其他环境变量和 MCP 设置。
4. 将宿主 command 设为该机器的 Node 绝对路径，args 设为新版 `/absolute/installation/dist/src/cli.js`。没有旧路径转发。
5. 兼容 native 状态可使用下面的 `reuse` 路径保留认证、历史和制品；凭据原有过期与刷新规则继续生效。未知 schema 或不同执行协议须先使用旧运行时导出历史，再明确选择独立的新状态目录。用户 UI 流程文件原位保留并通过新版校验。
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

spec 包含 `host_config`、`host_format`（`codex-toml` 或 `mcp-json`）、`server`、`installation`、`node`、`state_dir`、可选 `configuration`、`flow_files` 和旧状态目录 `previous_state_dirs`。两个完整安装目录必须互不包含，journal 必须在状态目录之外。`--sessions-ended` 是操作者已经结束会话的声明；命令仍检查进程、实例登记、租约、任务、连续日志、制品写入和未确认效果，尚未排空时拒绝。先在旧 MCP 正常停止或恢复并关闭有关操作；维护不会替用户强杀进程或假装结束任务。

`state_strategy` 默认为 `auto`。将 `state_dir` 指向所选 MCP 当前的原状态目录，可在已知协议和 SQL schema 均兼容时复用；也可显式设为 `reuse`。若旧路径通过宿主继承而不能从配置识别，使用 `source_state_dir` 明确声明，不能与宿主中已声明的路径冲突。复用时未提供 `configuration` 就保留旧配置值。若已有历史却选择了另一个新目录，必须显式设 `state_strategy: "fresh"`，不能无声丢弃登录和历史。`fresh` 路径保留原状态，但新状态需要登录；它不提供跨协议任务恢复。

原目录复用保持历史制品的绝对路径、加密凭据和本地密钥不变。维护验证 SQL 表、列、索引和 revision，拒绝未知触发器、未知 schema 与不同协议。当前支持已知 native-7 原始 schema 到 revision 2 的增量迁移。未结束或不兼容的任务不能因协议名称相同而继续执行；历史流程按当前公开契约校验后才可新建运行。

复用前用 SQLite 的一致快照读取包含已提交 WAL 页的数据库，并将数据库、密钥、配置和制品按块加密到私有 journal，逐块鉴别且核对完整哈希。备份限制为数据库 256 MiB、状态总量 1 GiB、20000 个条目、32 层目录；超限必须先按正常存储流程导出和清理，不能跳过备份。符号链接和特殊文件会被拒绝。升级 fence 位于状态目录的同级，跨崩溃保留；中断后用原计划和原 journal 重试 `apply` 或 `rollback`，不要手工删除 fence、journal 或其密钥。旧版不识别新版 fence，切换期间也必须保持旧宿主关闭。

回滚除切回原完整安装外，还恢复迁移前的 schema、数据库、密钥和状态文件；升级后产生的完整状态另存于同级 `.状态目录名.after-upgrade-摘要`，不会被覆盖。该副本用于恢复和核查；其历史绝对制品路径仍指向原目录，不能直接当作另一个可运行状态目录。回滚不会撤销设备安装、工程修改或云端效果。回滚完成后重复命令不再倒灌旧快照；再次升级需新计划和 journal。凭据若在外部过期或失效，恢复快照不会使它重新有效。

Codex TOML 和 MCP JSON 均保留所选 MCP 的超时、启用、工具权限、cwd、env_vars、用户环境变量及其他 MCP 的设置语义，仅更新 command、args、DEVECO_CONFIG 和 DEVECO_STATE_DIR。TOML 序列化可能调整格式和注释，所有值须通过重新解析的等值检查。全宿主配置与状态备份在私有 journal 中加密存储，不复制到仓库。计划中的外部用户流程文件逐个核对哈希并原位保留。format 1 的旧维护 journal 仍使用生成它的原版本维护命令；本版新计划为 format 2。

### 当前旧入口缺失的修复

当宿主记录的 `src/server.mjs` 已不存在，使用 `mode: "repair_missing_entry"`。该模式只允许旧入口确实缺失、有可识别的旧安装根目录、新目录完整且会话检查通过的情况。它不要求虚假的 `--sessions-ended` 声明，返回 `rollback_available:false`。记录旧配置用于审计，但拒绝将恢复损坏入口称为软件回退。普通升级仍要求保留前一个完整安装。

### 已安装 Skill 的精确清理

```sh
/absolute/node24 /absolute/new-install/dist/src/cli.js maintenance skills-plan /absolute/host/skills /absolute/old-install /private/skills-plan.json
/absolute/node24 /absolute/new-install/dist/src/cli.js maintenance skills-apply /private/skills-plan.json
```

只识别 `.deveco-tool-host.json` 声明属于指定旧安装、且匹配 `provenance/installed-skill-fingerprints.json` 的副本或链接。修改过的文件、额外空目录、链接目标变化及未知来源均保留。断开的原有链接只删除链接本身。执行前再次核对文件身份与摘要；中断记录支持同一计划继续，第三种内容拒绝，用户维护的 Skill 不受影响。
