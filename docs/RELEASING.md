# GitHub 发布与交付

版本升级的交付终点是经过核验的 GitHub Release。推送 `main`、修改 `package.json` 或 CI 通过都不能替代发布；npm 发布和宿主 MCP 重载单独记录。

## 自动流程

1. 同步 `package.json` / `package-lock.json` 的稳定版本，补齐 `CHANGELOG.md` 和 `docs/UPGRADE-<版本>.md` 的逐项验收。运行所需测试；涉及 SDK 行为时保留真实 SDK 证据。
2. 推送到 `main`。现有 `ci` 必须在该提交上通过：三个系统 × Node 22/24 的六项测试及上游对齐门禁，不接受跳过项。
3. `release` 工作流随成功的 `ci` 自动触发。它只处理本仓库 `main` 的 push，重新检查远程 HEAD、CI 提交、所有任务、版本、更新日志和验收文档。
4. 新版本自动创建 tag 和 Release，明确设置 Latest；回读发布状态、tag 实际提交和 Latest，再输出 `verified-release` 制品回执。失败时工作流报错，不能宣称交付完成。
5. 核对回执后更新 TODO 和交付总结，附上提交、CI、Release 链接。后续同版本文档提交继续验证既有 Release，不移动 tag；运行文件有变化必须升级版本。

`release` 工作流不改变测试环境，不运行 npm 发布，不重启用户宿主，也不导入上游 CLI。仅发布任务拥有 `contents: write`；PR、定时检查和其他分支不能触发发布。并发发布串行执行，过期提交明确失败，避免覆盖新版 Latest。

用户明确要求仅推送、暂不发布时，推送前暂停 `release` 工作流，保留发布 TODO 为未完成；获准发布后恢复工作流并执行同一发布门禁。自动化不能覆盖用户明确指定的交付范围。

## 核验与恢复

在干净且与远程 `main` 一致的 checkout 内，使用该提交对应的 CI run ID：

```sh
# 只读核验：没有 Release、Latest 不符或证据不完整时非零退出
node tools/release.mjs --run <CI_RUN_ID> --check

# 自动发布工作流失败后，修复原因并重跑该工作流；也可在本地执行同一门禁
node tools/release.mjs --run <CI_RUN_ID>
```

本地命令使用 `gh` 当前登录，GitHub Actions 使用任务令牌。现有 tag 指向错误、草稿、预发布、版本倒退、同版本运行代码变化都明确拒绝；不会删除或移动 tag，不会静默改成其他版本。网络或权限错误直接失败，不当成“版本不存在”。

最终核验区分当前 `main` 与不可变的发布提交：文档可以继续前进，Release 仍指向原先通过 CI 的提交。回执同时记录两者及各自 CI。实际运行的 MCP 版本必须通过重载后的 `doctor.server.build_id` 单独证明。

实现依据：[GitHub workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)、[Release API](https://docs.github.com/en/rest/releases/releases)。
