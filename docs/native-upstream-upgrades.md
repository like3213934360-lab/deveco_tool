# 上游候选与升级门禁

原生服务运行时只读取发布包中的锁定资源。候选检测与适配由维护工具和 CI 执行，不在 MCP 运行期间下载执行上游代码。

## 本地复现

```sh
node dist/scripts/upstream-prepare.js deveco-code /absolute/new-candidate-directory
node dist/scripts/upstream.js gate /absolute/new-candidate-directory/candidate.json
node dist/scripts/upstream.js pr deveco-code /absolute/new-candidate-directory/candidate.json --dispatch-validation
```

第一步读取锁定观察引用，下载只供检查的裸 Git 仓库，固定候选提交、计算分类差异，输出 detection.json、candidate.json 和 UPGRADE.md，然后删除临时裸仓库。未变化时只输出检测记录，不创建空候选。`gate` 在存在未映射变化时退出 2，待人工适配评审时退出 1，不能把报告生成视为发布通过。

第三步需要已配置的 `gh` 认证和 `GH_REPO=owner/repository`。它核对来源、基线、映射和报告摘要，仅在 `codex/upstream-...` 分支添加两个评审文件并创建草稿 PR，不推进正在使用的源锁、不自动合并。相同报告重复调用复用已有 PR（包括已关闭的 PR）；远程写入回执丢失时核对分支和 PR 状态，避免重建或覆盖已有内容。

## CI 和评审

`.github/workflows/upstream-candidates.yml` 每日或手动检测 deveco-code/deveco-cli；候选工作流准备原生验证目录后安装锁定依赖，创建草稿并请求 `native-ci.yml` 验证。尚未在远程端到端验证；仓库 Actions 的 PR 创建权限也需在集成验收中确认。

`upstream-gate.ts` 验证候选摘要和映射，未映射变化明确失败。只有人工适配、检查并更新锁定提交/树及 verified 标记后，候选门禁才允许通过；迁移、真实 SDK、设备和性能的正式发布门槛另外检查。`upstream-scope.ts` 阻止同一次升级既修改 LangGraph/MCP/SQLite 等框架版本又修改官方源锁、映射或资源；首次建立源锁的迁移提交不作为框架升级。

保持升级顺序：检测 → 摘要校验/分类 → 人工判断受影响能力 → 草稿改动 → 契约和平台/性能验证 → 评审适配 → 更新锁并发布。框架升级和官方工具链升级分开提交。自然语言新要求必须人工映射，不能自动宣称已正确转换为工作流。

`test/native-upstream-pr.test.ts` 覆盖 GitHub 父树保留、只添加报告、幂等、回执丢失、摘要冲突和升级分离。当前已对真实上游候选 `325aff05706b9b04a9816a987e9672dda991c630` 分类出 66 个文件变化，状态 requires_adapter_review；没有据此推进运行资源或创建远程候选 PR。
