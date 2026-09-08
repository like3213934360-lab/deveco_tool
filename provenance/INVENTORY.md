# 当前资产与运行入口

本仓库仅运行编译后的原生 TypeScript MCP。入口为 `dist/src/cli.js`；`src`、`scripts`、`test` 为严格 TypeScript，HarmonyOS 工程夹具及原生设备库按各自格式保留。

- 25 个公开工具与 8 个公开工作流：`src/core/contracts.ts`、`src/core/catalog.ts`。
- 内部固定任务：UI 流程、录制、签名变更、热重载准备/应用和模拟器变更，共用 LangGraph 与 SQLite；不是公开的任意脚本执行器。
- 资源：`resources/knowledge.json`、规则和案例、工程模板、文档、Hypium 原生组件。每份资源均列入 `resources.json`，保留来源与摘要。
- 上游更新：`upstream-lock.json` 固定来源，`upstream-mapping.json` 指定适配/排除与检查目标；候选使用检测、审阅、应用、验收和发布门禁。
- 迁移审计：`baseline-capabilities.json` 保存旧能力契约，`migration-matrix.json` 记录每个参数和动作的替代或删除理由。归类完成不等于验收通过。
- 安装清理：`installed-skill-fingerprints.json` 仅保存旧安装器输出的摘要；维护工具同时要求本项目安装记录，拒绝删除用户改过的副本或改变目标的链接。

旧 CLI、子 MCP、Skill 定义、安装器、脚本注册和兼容启动入口已退出当前运行图。历史来源锁与缺陷记录用于追溯，不加载旧执行引擎。
