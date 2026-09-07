# 上游候选与升级门禁

原生服务运行时只读取发布包中的锁定资源。候选检测与适配由维护工具和 CI 执行，不在 MCP 运行期间下载执行上游代码。

## 本地复现

```sh
node dist/scripts/upstream-prepare.js deveco-code /absolute/new-candidate-directory
node dist/scripts/upstream.js gate deveco-code /absolute/new-candidate-directory/candidate.json
node dist/scripts/upstream.js pr deveco-code /absolute/new-candidate-directory/candidate.json --dispatch-validation
```

第一步读取锁定观察引用，下载只供检查的裸 Git 仓库，固定候选提交、计算分类差异，输出 detection.json、candidate.json 和 UPGRADE.md，然后删除临时裸仓库。未变化时只输出检测记录，不创建空候选。`gate` 在存在未映射变化时退出 2，待人工适配评审时退出 1，不能把报告生成视为发布通过。

第三步需要已配置的 `gh` 认证和 `GH_REPO=owner/repository`。它核对来源、基线、映射和报告摘要，仅在 `codex/upstream-...` 分支添加两个评审文件并创建草稿 PR，不推进正在使用的源锁、不自动合并。相同报告重复调用复用已有 PR（包括已关闭的 PR）；远程写入回执丢失时核对分支和 PR 状态，避免重建或覆盖已有内容。

默认基于仓库默认分支。迁移尚未合并时，可追加 `--base codex/native-typescript-runtime`，在新架构分支上验证候选。分支身份包含目标分支摘要，创建提交和 PR 时核对同一个基线；已有 PR 被手动改到别的分支时明确报冲突，不复用错误的候选。

## CI 和评审

`.github/workflows/upstream-candidates.yml` 每日或手动检测 deveco-code/deveco-cli；候选工作流准备原生验证目录后安装锁定依赖，创建草稿并请求 `native-ci.yml` 验证。维护者 gh 认证的真实创建和显式调度已验证；定时任务的 GITHUB_TOKEN 创建权限仍需在该工作流实际触发时确认。

`upstream-gate.ts` 验证候选摘要和映射，未映射变化明确失败。只有人工适配、检查并更新锁定提交/树及 verified 标记后，候选门禁才允许通过；迁移、真实 SDK、设备和性能的正式发布门槛另外检查。`upstream-scope.ts` 阻止同一次升级既修改 LangGraph/MCP/SQLite 等框架版本又修改官方源锁、映射或资源；首次建立源锁的迁移提交不作为框架升级。

保持升级顺序：检测 → 摘要校验/分类 → 人工判断受影响能力 → 草稿改动 → 契约和平台/性能验证 → 评审适配 → 更新锁并发布。框架升级和官方工具链升级分开提交。自然语言新要求必须人工映射，不能自动宣称已正确转换为工作流。

`test/native-upstream-pr.test.ts` 覆盖 GitHub 父树保留、只添加报告、幂等、回执丢失、摘要冲突、指定目标分支和升级分离。

## 2026-09-08 远程集成记录

真实上游候选 `325aff05706b9b04a9816a987e9672dda991c630` 分类出 66 个文件变化，报告摘要 `a0c2a97d2e1cb1e6a11e0ef734d656ec461d69b75f0a0415815c16c4918eb6a0`。以开发分支为目标创建了 [草稿 PR #1](https://github.com/like3213934360-lab/deveco_tool/pull/1)，候选提交 `9f96d3b0ed044d94cf2c37bb9412a74e0c2467ed` 只新增 candidate.json 和 UPGRADE.md；第二次相同调用复用原 PR，返回 deduplicated。

显式调度得到 [CI 34157304486](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34157304486)。六组完整回归通过；五组随后被 `UPSTREAM_REVIEW_REQUIRED` 按预期拦截。Windows Node 24 在额外压力检查第 8 轮出现恢复测试等待状态超时，尚未进入候选门禁；该失败需独立定位，不能把整个 CI 标为通过。原始证据保存在开发机 `/private/tmp/deveco-ci-34157304486-win24`。

当前状态仍为 requires_adapter_review，活动源锁和发布资源未推进。真实候选创建、幂等和调度已证实；候选通过评审后的合并发布、定时令牌权限和完整升级回退不在这次结果范围内。
