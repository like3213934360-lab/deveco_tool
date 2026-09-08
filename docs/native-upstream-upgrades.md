# 上游候选适配与发布

原生 MCP 只读取安装包中锁定的代码和资源。检测、下载、分类、适配、检查与发布由维护工具及 CI 执行，运行中的 MCP 不动态执行上游代码。

## 检测和草稿

```sh
node dist/scripts/upstream-prepare.js deveco-code /absolute/new-candidate
node dist/scripts/upstream.js gate deveco-code /absolute/new-candidate/candidate.json
node dist/scripts/upstream.js pr deveco-code /absolute/new-candidate/candidate.json --dispatch-validation
```

检测固定源锁中的观察引用，下载只供读取的裸 Git 对象，输出 detection.json、candidate.json 和 UPGRADE.md；未变化不建空候选。`gate` 对未映射变化退出 2，对待适配候选退出 1。PR 命令需要 `gh` 认证及 `GH_REPO`，只准备候选草稿，不自动合并。相同报告复用已有 PR，响应丢失时核对远程状态。迁移尚未合并时可用 `--base codex/native-typescript-runtime`。

## 编写并应用适配

保留一份包含基线与候选提交的裸 Git 仓库，生成可审阅的适配目录：

```sh
node dist/scripts/upstream.js fetch deveco-code /absolute/new-source.git
node dist/scripts/upstream-adapt.js prepare /absolute/new-source.git /absolute/new-candidate/candidate.json /absolute/new-adaptation
```

`prepare` 重新计算 Git 差异及摘要，防止报告与源码不符。目录中的 review-template.json 列出每项上游变化、目标文件及当前摘要。维护者据此编写 plan.json，保留 format、candidate、reviews、files，去掉辅助字段 baseline_targets。

每项 review 使用 `adapted / unchanged / excluded`，必须写明审阅者、理由及对应目标。每项本地文件变更包含 path、before_sha256、after_sha256、content；content 指向适配目录内的准备文件。新增文件的 before 为 null，删除文件的 after 为 null 且不提供 content。不能借候选修改框架依赖、接受标记或恢复 Skill、旧脚本入口。

知识资源可先在独立目录生成：

```sh
node dist/scripts/knowledge-import.js /absolute/new-source.git /absolute/candidate-source.json /absolute/new-knowledge-bundle
```

candidate-source.json 使用源锁同样的 source 结构并固定候选 commit/tree/version。输出资源、完整资源清单和 knowledge-changes.json；将有变化的资源作为适配文件纳入 plan。源版本、出处、内容摘要与跨引用一并生成，不覆盖活动资源。项目模板和调用协议仍需按变化语义实现，工具不能保证自然语言自动转换正确。

```sh
node dist/scripts/upstream-adapt.js apply /absolute/new-adaptation /absolute/new-adaptation/plan.json
```

应用前核对全部目标和准备字节，写入 adaptation.json 后逐项发布。中断后同一计划可继续；遇到第三种文件内容报冲突。上游源锁在这个阶段保持原版本。

## 初始基线评审

每个锁定来源都必须先建立初始基线，不允许仅改 `acceptance: verified`。基线准备核对官方 origin 和锁定 commit/tree，只读 Git 对象，不执行上游脚本。

```sh
node dist/scripts/upstream-adapt.js baseline-prepare deveco-code /absolute/source.git /private/baseline-plan.json
node dist/scripts/upstream-adapt.js baseline-apply /private/baseline-plan.json
```

逐条检查模板中的 mapping rule，填写真实审阅者与具体语义理由。计划绑定映射、全部原生目标文件及所需测试。两个来源均要完成；实施变更后应重新准备尚未接收的基线，不能复用目标摘要已变化的评审。全部实现完成、统一检查报告可用后再接收：

```sh
node dist/scripts/upstream-adapt.js baseline-accept deveco-code /private/baseline-evidence.json
```

源锁自身由凭证中的前后完整语义状态单独绑定，避免接收更新锁时产生自引用文件摘要。候选必须从已接收基线延伸。接收先写凭证再推进源锁，中断后原计划、原始报告及凭证摘要一致时可继续；报告路径不会进入公开凭证。

## 统一检查后接受候选

完成计划要求的检查，编写 evidence.json：

```json
{
  "checks": [
    {
      "check": "test/native-upstream.test.ts",
      "report": "/absolute/new-regression/evidence.json",
      "sha256": "原始报告的64位小写SHA256"
    }
  ]
}
```

每项必须指向真正执行了该文件的通过报告。工具核对运行代码、全部编译文件、依赖锁、资源清单和源锁的摘要；不能用旧报告或只有 passed 字段的手写结果替代。原始报告保留在本地；接收器仅将五项代码/依赖/资源身份摘要、实际执行的检查名和原始报告摘要写入白名单凭证，不复制原报告、私密路径、设备 ID 或凭据。

```sh
node dist/scripts/upstream-adapt.js accept deveco-code /absolute/evidence.json
node dist/scripts/upstream-gate.js
```

接受记录绑定适配计划、原始报告和锁定 Git 对象，再推进源锁。手工把 acceptance 改成 verified 不能替代适配与证据。后续完整 Release 仍须通过迁移、平台、SDK、设备、性能、升级与回退门槛。

## 自动化与发布

`.github/workflows/upstream-candidates.yml` 每日或手动检测两项官方来源，根目录 `npm ci` 安装锁定依赖并编译，创建候选草稿。令牌能否在实际仓库创建 PR 由仓库权限决定，工作流失败会保留错误；不能把一次个人认证调用当成定时令牌的权限证明。

`.github/workflows/native-ci.yml` 运行 macOS/Windows/Linux × Node 22/24 基础矩阵和安装检查。`upstream-scope.ts` 将框架版本升级与官方适配分开，初次建立源锁不视为普通升级。

`.github/workflows/release.yml` 只接受同一仓库、同一最终提交的成功工作流中的 release-evidence 制品。发布门禁核对六组回归和安装、43 项功能/升级范围、固定直接能力的原始性能样本以及一小时 SDK/LSP/UI/watch 长稳。随后重新封装并核对分发摘要，经 release 环境发布到不可覆盖的版本标签。缺少或版本不匹配的证据明确阻断；不会因为生成候选包就发布正式版。

### 将本地验收交给发布工作流

准备私有证据目录中的 `release.json`，逐项引用已通过且对应最终编译身份的原始报告、验收附件和分发目录。先在本地执行全部门禁，再生成有文件清单和摘要的证据 ZIP：

```sh
node dist/scripts/release-evidence.js prepare /private/final-evidence/release.json /private/release-evidence.zip
```

打包器仅收集 manifest 引用的文件，不递归复制测试目录、状态库或凭据。证据中的日志、设备标识和路径仍须在上传前审阅；原始私有报告不能作为公开 Release 附件。可将审阅后的 ZIP 上传为本仓库专用**草稿** Release 的附件，记录 asset ID 和工具返回的 SHA-256。此草稿仅用于认证传输，不作为软件发布，也不替代门禁。

在最终提交上手动运行 `.github/workflows/release-evidence.yml`，提供该 asset ID 和 SHA-256。工作流从同一仓库下载，拒绝摘要变化、路径穿越、链接、重复路径和超限 ZIP，并重新执行全部发布门禁。只有通过后才生成 `release-evidence` Actions 制品；随后把该成功 run ID 交给 `release.yml`。证据制品的读取权限遵循仓库 Actions 设置，公开仓库尤其需要检查内容。发布流程只公开软件包、摘要和字段白名单验收凭证。

## 历史候选

2026-09-08 曾针对 deveco-code 提交 `325aff05706b9b04a9816a987e9672dda991c630` 创建[草稿 PR #1](https://github.com/like3213934360-lab/deveco_tool/pull/1)。当时报告 66 项变化，65 项为不进入本 MCP 的宿主/构建内容，另有 CHANGELOG 的版本记录。旧报告摘要和旧 CI 仅证明当时的检测/草稿链路；本批映射及门禁已变化，需要重新计算并完成适配验收。

上述 66 项候选变化已逐项审查、受控应用并经映射检查接收，现已归入 `325aff05706b9b04a9816a987e9672dda991c630` 基线，原候选及评审凭证保存在 `provenance/upstream-review-history/deveco-code/`。CHANGELOG 的 v0.1.12 记录不改变原生 MCP 协议或资源语义，其余项为映射明确排除的上游宿主实现。

2026-09-08，编译摘要 `90b34d88` 的新鲜报告完成 code 基线 10 项、CLI 基线 25 项映射检查接收；CLI 仍锁定 `08c2f57ffbe83c817d64a728a17971872dd9ddcf`。两项来源的 `upstream-gate` 通过，接收器明确返回 `release_ready: false`：上游映射验证通过不等于完整迁移、性能、长稳或正式发布通过。定时工作流的实际权限和最终提交的发布门禁仍需分别验证。

### 后续评审轮次

已验收的候选进入下一次升级前，先在当前锁定提交上重新 `baseline-prepare`、逐规则评审，再执行 `baseline-refresh PLAN`。此命令将上一轮基线及已接受候选原样归档到 `provenance/upstream-review-history/`，以摘要日志恢复中断的目录移动，然后发布新的待验收基线。它不会把旧报告当作新版本验收，也不会越过尚未接受的候选。尚未验收的基线因实现修复而变化时，同一命令保留旧评审并更新基线，保留正在适配的候选。新基线仍须使用当前编译身份的报告执行 `baseline-accept`。
