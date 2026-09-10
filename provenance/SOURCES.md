# 来源与升级

当前运行依赖以根目录 `package-lock.json` 为准，允许的直接依赖列在 `native-dependencies.json`。官方 CLI 和 CodeGenie 子 MCP 均不作为运行依赖。

## 资源与协议来源

`resources.json` 逐文件记录源路径、源摘要、本地摘要和变换说明。知识索引 `resources/knowledge.json` 另保存适用范围、源提交、摘要及关联条目。

- DevEco Code：`https://gitcode.com/openharmony-sig/deveco-code`，固定提交见 `upstream-lock.json`。6 个内置 Skill 将工程过程和规则组织为 MCP 可读取的知识与持久化引导工作流；所有内容随 MCP 分发，不安装客户端 Skill。连接 MCP 的 AI 客户端负责推理、源码编辑和实际视觉判断。
- DevEco CLI：锁定源码用于审阅底层协议与原生检查行为，检查规则按本仓库类型、范围和进程边界适配；模板和本地文档来自资源清单指定的 npm 资产包，许可证保留在 `resources/licenses`。运行服务直接驱动实际 SDK。
- Hypium：原生设备组件来源、版本、摘要见资源清单，许可见 `NOTICE.hypium`。
- 本仓库：工程规则、资源索引和界面资源的自有部分按 MIT 许可交付。

## 更新路径

维护工具先检测并固定候选提交，再生成分类报告和草稿 PR。`upstream-adapt` 对每条变更要求映射和审阅理由，核对前后摘要后应用代码/资源改动。`knowledge-import` 只生成新目录中的候选资源和删除清单；不会就地镜像覆盖。映射检查通过后提交当前编译版本的实际证据，才能接受新的源锁。

未映射变化、文件变更冲突、缺少适配、证据失败或版本不一致均阻断接受和发布。自然语言要求仍需代码适配与评审，不保证自动翻译成正确工作流。框架升级和官方工具链升级分别提交。

## 历史记录

`deveco-code-v0.1.5.commit`、`deveco-code-v0.1.6.commit`、`deveco-code-v0.1.11.commit` 及旧 Skill 摘要文件仅用于 Git 历史追溯。旧目录已删除，这些摘要不是当前树的安装清单，不应对当前目录执行旧的 Skill 镜像校验或安装命令。
