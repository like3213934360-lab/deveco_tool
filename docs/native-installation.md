# 编译产物安装与升级验证

当前生成的是安装验收候选包，`private: true`；迁移、设备及性能发布门槛仍须完成，不能将此包当成正式 Release。包中只包含编译后的原生运行模块、已核对出处的资源、生产依赖锁、许可证和本说明。不会携带 TypeScript 编译器、官方 CLI、CodeGenie 子 MCP、Skill 安装程序、开发测试或旧启动入口。

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

## 用户切换步骤

1. 在旧版中结束或取消任务，停止热重载与 LSP 会话。
2. 保留前一个完整安装目录和本次安装的版本、ZIP SHA-256、Node 版本及启动配置记录。将新版解压到另一个目录，校验后执行 `npm ci --omit=dev`。
3. 使用新版配置 JSON 设置非默认工具链位置，通过 `DEVECO_CONFIG` 指向该文件；状态目录可使用 `DEVECO_STATE_DIR`。清除旧环境变量配置。
4. 将宿主 command 设为该机器的 Node 绝对路径，args 设为新版 `/absolute/installation/dist/src/cli.js`。没有旧路径转发。
5. 新版认证需重新登录，不导入旧凭据格式。保留用户 UI 流程文件并通过新版校验；不加载旧任务引擎或旧内存任务。
6. 运行 `node dist/src/cli.js doctor`，再执行创建、构建、设备及既有 UI 流程验收。安装检查只证明基础运行、资源和持久化可用，不代替这些专项验证。
7. 依据可核对的本项目安装记录清理其安装的官方 Skill；用户自行维护的 Skill 不属于自动删除范围。

回退时先结束新版任务和会话，再将宿主切回前一个完整安装目录及对应配置；按其 Node 版本重新安装依赖。执行协议不同的版本使用独立状态目录，历史报告导出为静态文件，不用旧引擎解码新版任务。软件回退不会撤销工程修改、签名、安装或设备输入。当前步骤不自动改写宿主配置、不自动删除 Skill，也不发布 Release。
