# Code 每日发布工作流评审（2026-09-12）

官方 [deveco-code](https://gitcode.com/openharmony-sig/deveco-code) develop 于本轮复核时为 `7b9b68c2f65e25d6a91f13d47d5b75622aacfe20`。与当前锁 `aeb4536e56d1bfe8b5a0ff3bb02acb99f3523f2a` 相比只有一项变化：新增 75 行 `.gitcode/workflows/publish-daily.yml`；工具、Skill、语言服务和 SDK 调用源码没有变化。

已逐行读取新增文件。它定时构建上游宿主，使用 Node 22 和 Bun 1.4.2，生成 `0.0.0-daily-YYYYMMDD` 版本，以 `@deveco` scope 发布 npm 包。依赖 GitCode 发布环境及上游 npm 凭据，不是新增给 MCP 用户使用的工具或工作流。

依据现有 `code-host-gitcode` 映射，此路径属于上游仓库发布设施，明确排除于 MCP 产品移植；本产品继续使用自己的 TypeScript 构建、证据门禁和正式 Release 流程。没有复制或执行上游发布脚本，也没有新增排除规则。

官方 Git 对象差异和候选生成器均确认仅此一个文件，候选状态为 `requires_release_validation`。私有评审和适配计划位于 `preparation/remaining-code-review-20260912-1/` 与 `preparation/remaining-code-adaptation-20260912-1/`；尚未应用或接受，当前上游锁没有前进。后续仍须完成当前 Code 基线检查与正式接受凭证，不能以本文件代替验收。

同次复核 CLI develop 仍为 `87c360b05848132c06c6ea120e078619b9ef4634`，沿用已完成的[启动检查差异评审](upstream-cli-startup-review.md)。
