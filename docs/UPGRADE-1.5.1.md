# v1.5.1 Windows 并发首次启动修复

v1.5.0 已发布后，文档提交 `6d49c063ce9f2538121e40fbf655a2d6977790f8` 的 [CI 38704541589](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38704541589) 六项成功，Windows/Node 22 的真实双进程首次启动用例失败：两个构建器写各自 immutable generation 后竞争替换 `dist/current.json`，Windows rename 返回 EPERM，导致一个 MCP 无法启动。保留原失败日志，没有重试 CI 来筛选成功，也没有缩减并发或改变 Windows 权限。运行构建工具发生变化，依仓库规则升至 1.5.1，保留 v1.5.0 的不可变 tag。

## 修复与契约

- 构建器在 `dist/.build-lock` 内记录 PID/时间并独占生成与发布；等待现有构建后重新校验源码指纹、版本和完整输出哈希，有效则复用该代。同源并发调用只发布一代，避免冗余 pointer 替换；正常 MCP 已构建启动仍直接走原校验路径。
- 启动桥内容相同则不替换；缺失的桥在锁内恢复。损坏/缺失/过期构建仍重建；权限和 I/O 错误继续失败。编译异常保留原 pointer 并释放锁，运行中的旧代不删除。
- 等待锁最多 30 秒，超时输出锁位置及恢复方法。进程被杀导致的残留锁不按年龄自动偷取：先读取 owner.json 并确认对应构建进程已停止，再人工删除该锁目录。它是运行依赖加载前的构建引导锁，不是 SDK 工程/设备的 job 资源锁。

## 验收与边界

复用原 `test/integration/runtime.test.mjs`，把并发首次启动增强为四个实际 MCP 进程，验证版本、JSON-RPC、完整哈希、单代发布、锁清理、同代复用及启动桥恢复；原损坏产物、失败不发布、跨版本旧代、npm 包无源码运行等断言保留。类型检查及完整离线回归 **276/276** 通过，16.153 s；npm pack dry-run 311 文件、约 1.5 MB。单独用 node 启动测试时，已有 npm 打包用例因缺 npm_execpath 找不到 Homebrew npm，5/6；保留此调用错误，并改用仓库已登记的 npm test 完整通过，未安装或调整环境。结果见 [脱敏证据](evidence/v1.5.1-acceptance.json)。

最终源码构建为 `7647cd93c31bdbb6efc3050cad6ea5cad845bc68c459526a389d5febcb66dbbd`。新独立 MCP 通过真实 DevEco SDK doctor 与指定 USB Pura 80 Pro 的 device info；域实现未变，不把 1.5.0 的业务验收改写成 1.5.1 重跑。工程测试、verify、基线、场景和卡片的实际记录仍见 [1.5.0 说明](UPGRADE-1.5.0.md)。

以下限制继续保留：SDK 仪器覆盖率 JSON 生成不稳定且最终复测失败；真实模型 2/10 完成、8/10 宿主审批阻塞；性能因排除区间为 inconclusive；其他卡片宿主与精确运行时源码映射未验收或未支持。原生 Codex App 仍为 1.4.10/c2c74b0a，没有宿主重启或 npm 发布。

GitHub 提交、七项 CI、自动 release、不可变 tag、Latest 及回执将单独核验后记录于 TODO 与发布回执。

体量变化：构建工具 +36/-4 行，原 runtime 用例 +11/-4 行，没有新增长期测试入口或运行依赖。
