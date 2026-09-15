---
name: gitcode-pr
description: 按仓库 DEV-WORKFLOW.md 完成 DevEco Code 的 GitCode 推送、上游 Issue/PR 关联及 CI 触发。仅当用户明确要求推送到 GitCode、创建或更新 GitCode PR、关联 GitCode Issue 或触发 GitCode CI 时使用。仅创建本地 commit 且不需要推送或 PR 时不使用。所有 GitCode API 操作通过 gitcode CLI 完成，无需 MCP。功能分支基于父仓库目标分支创建，推送到 origin，不验证 Fork 关系。
---

# DevEco Code GitCode 提交流程

使用中文与用户沟通。按顺序执行门禁；任一门禁失败，立即停止依赖它的操作。

**目标分支**：从用户指令中提取目标分支名（如 `develop`、`master`）。未指定时使用 `question` 工具询问用户。确定后在后续步骤中使用，记为 `<target_branch>`。

## 0. CLI 与 Token 门禁

触发本 skill 后，验证 `gitcode` CLI 已安装并认证。CLI 自动读取执行环境中已配置的 `GITCODE_TOKEN`。不得从 Git remote URL 提取 Token，也不得在对话中回显 Token。该方式兼容 SSH 和 HTTPS clone。

```bash
gitcode auth status
```

- 输出包含 `Logged in` 且退出码为 0：门禁通过。
- 未登录或命令失败：停止，告知用户需在执行环境中配置 `GITCODE_TOKEN`（如写入 `~/.zshenv`）或运行 `gitcode auth login`。
- `gitcode` 命令不存在：按下方安装说明安装后重试。
- 不得修改 remote URL、索取 Token 或以其他方式获取 Token。

### CLI 安装（命令不存在时）

安装文档：https://atomgit.com/gitcode-cli/cli#安装 。推荐只保留一个全局安装渠道提供 `gc`/`gitcode` 命令。

已安装 Node.js/npm 时优先使用官方 npm bootstrap（安装平台二进制到全局 bin 目录）：

```bash
npx --yes --ignore-scripts --registry=https://registry.npmjs.org --@gitcode-cli:registry=https://registry.npmjs.org @gitcode-cli/cli@latest install
gitcode version
```

无 Node.js 的 macOS/Linux 可用 Homebrew（同时提供 gc 与 gitcode，自动配置 shell 补全）：

```bash
brew install gitcode-cli/homebrew-tap/gc
```

注意：

- 不要用 `npm i @gitcode-cli/cli` 安装，那只会写入当前项目 node_modules，不会更新 PATH 中的 gitcode。
- 安装或升级后可用 `gitcode doctor install` 离线检查实际命令来源与 PATH 候选。
- Windows PowerShell 中使用 `gitcode` 而非 `gc`（后者被内置 Get-Content 别名占用）。

## 1. 仓库与规则门禁

通过 Token 门禁后，仅执行只读检查，直至本节全部通过：

1. 定位仓库根目录，完整读取当前版本的 `DEV-WORKFLOW.md`；不得依赖记忆、摘要、历史会话或旧版本。
2. 确认 `origin`、工作区、暂存区和 Git 用户身份；保留无关的已暂存、未暂存和未跟踪文件。
3. 提取并应用分支命名、Commit 标题与正文、提交粒度、必做检查及 Issue/PR 流程。
4. 按当前指令优先级执行：系统、开发者及适用的 `AGENTS.md` 高于本 skill；本 skill 的固定约束高于 `DEV-WORKFLOW.md` 的普通约定。

`DEV-WORKFLOW.md` 缺失、无法完整读取、含义不明确或规则冲突时，列出相关原文与影响并请求用户裁决。门禁通过前不得切换或创建分支、暂存、提交、推送、创建 Issue/PR，或执行其他写操作。

## 固定约束

- 父项目：`openharmony-sig/deveco-code`
- 父项目 URL：`https://gitcode.com/openharmony-sig/deveco-code.git`
- 分支基线和 PR 目标：父项目 `<target_branch>`（默认 `develop`，由用户指定或询问）
- 推送目标：`origin`；不得验证或推断其 Fork 关系，不得向父项目推送
- 所有 GitCode API 操作通过 `gitcode` CLI 完成，仓库参数统一用 `-R openharmony-sig/deveco-code`；脚本中调用时附加 `--no-interactive --no-update-check`

## 2. 基线与分支

1. 运行：

   ```bash
   git fetch --no-tags https://gitcode.com/openharmony-sig/deveco-code.git refs/heads/<target_branch>
   ```

2. 运行 `git switch --create <feature_branch> FETCH_HEAD` 并验证起点。不得复用、重置或覆盖同名本地分支。

允许 Git 保留不冲突的未提交改动。切换失败时停止；不得 stash、丢弃、覆盖、merge、rebase、reset 或强制切换。

## 3. 提交与推送

1. 只暂存用户确认的路径；不得使用 `git add -A`。
2. 按 `DEV-WORKFLOW.md` 完成必做检查并生成 Commit 标题与正文。
3. 使用 Git 用户身份生成 `Signed-off-by`；允许存在 `Co-authored-by`。
4. 保持仓库 hooks 启用，使用 `git commit -s`，不得默认绕过 hook。
5. 验证提交内容、trailers 和签名后，运行 `git push --set-upstream origin <feature_branch>`。

hook、检查、提交验证或推送失败时停止后续流程。

## 4. Issue 与 PR

1. 查询 `<feature_branch>` → `<target_branch>` 的开放 PR：

   ```bash
   gitcode pr list -R openharmony-sig/deveco-code --state open --head <feature_branch> --base <target_branch> --json --no-interactive --no-update-check
   ```

   返回非空数组时复用，不重复创建。

2. 不存在时，按提交类型选择上游 Issue 模板（含标题前缀和必填字段映射）：

   | commit type | 模板文件 | 标题前缀 | body 必填字段 |
   |---|---|---|---|
   | `feat` | `feature-request.yml` | `[Feature]` | 功能描述、使用场景/解决的问题 |
   | `fix` | `bug-report.yml` | `[Bug]` | 问题描述、预期行为、实际行为、复现步骤、DevEco Code 版本、操作系统、终端 |
   | `docs` | `document.yml` | `[Document]` | 改进建议描述、使用的分支信息 |
   | `refactor` | `refactor.yml` | `[Refactor]` | 代码重构描述、代码重构涉及内容与验证、DevEco Code 版本 |
   | `chore` | `document.yml` | `[Document]` | 改进建议描述、使用的分支信息 |
   | `test` | `refactor.yml` | `[Refactor]` | 代码重构描述、代码重构涉及内容与验证、DevEco Code 版本 |
   | `perf` | `refactor.yml` | `[Refactor]` | 代码重构描述、代码重构涉及内容与验证、DevEco Code 版本 |
   | `style` | `refactor.yml` | `[Refactor]` | 代码重构描述、代码重构涉及内容与验证、DevEco Code 版本 |
   | `build` | `document.yml` | `[Document]` | 改进建议描述、使用的分支信息 |
   | `ci` | `document.yml` | `[Document]` | 改进建议描述、使用的分支信息 |
   | 其他 | `refactor.yml` | `[Refactor]` | 代码重构描述、代码重构涉及内容与验证、DevEco Code 版本 |

3. 优先使用 `.gitcode/ISSUE_TEMPLATE/`，其次使用 `.github/ISSUE_TEMPLATE/`。读取所选模板的 YAML，按其字段 `label` 逐项生成 body：用 commit 信息填入必填字段，选填字段有内容则填、无则省略。不得使用模板中不存在的字段名。每个字段格式为 `### <label>\n\n<内容>`，末尾附检查清单（所有项勾选 `[x]`）。缺失的版本/系统信息写 `未提供`。
4. 创建 Issue（body 从 stdin 读取，`--json` 便于提取编号）：

   ```bash
   echo "$ISSUE_BODY" | gitcode issue create -R openharmony-sig/deveco-code --title "$ISSUE_TITLE" --body-file - --json --no-interactive --no-update-check
   ```

   从 JSON 响应的 `number` 字段提取 Issue 编号。

5. 创建 PR，body 中包含 `Closes #<issue_number>` 以自动关联。根据 commit type 自动勾选 "Type of change" 选项：
   - `feat` → `[x] New feature`
   - `fix` → `[x] Bug fix`
   - `docs` → `[x] Documentation`
   - `refactor` → `[x] Refactor / code improvement`
   - 其他类型 → `[x] Refactor / code improvement`

   跨仓库 PR 用 `--fork` 指定 origin 仓库（从 origin remote URL 提取 `<owner>/<repo>`）：

   ```bash
   ORIGIN_REPO=$(git remote get-url origin | sed -n 's|.*[:/]\([^/]*/[^/]*\)\.git$|\1|p; s|.*[:/]\([^/]*/[^/]*\)$|\1|p')
   echo "$PR_BODY" | gitcode pr create -R openharmony-sig/deveco-code --fork "$ORIGIN_REPO" --head <feature_branch> --base <target_branch> --title "$PR_TITLE" --body-file - --json --no-interactive --no-update-check
   ```

   从 JSON 响应的 `number` 字段提取 PR 编号。

6. 验证关联：

   ```bash
   gitcode pr issues <PR_NUMBER> -R openharmony-sig/deveco-code --json --no-interactive --no-update-check
   ```

   返回列表中包含目标 Issue 编号即关联成功。

模板、创建或关联验证失败时停止。

## 5. CI 构建

仅处理本次新建的 PR：

1. 创建 PR 后立即查询评论；之后每 30 秒查询一次，最多等待 3 分钟。

   ```bash
   gitcode pr comments <PR_NUMBER> -R openharmony-sig/deveco-code --json --no-interactive --no-update-check
   ```

2. 仅接受作者 `user.login` 为 `openharmony_ci` 且正文 `body` 包含 `感谢提交 Pull Requests` 的评论。
3. 评论出现后，若认证用户尚未发送正文精确等于 `start build` 的评论，则发送一次：

   ```bash
   gitcode pr comment <PR_NUMBER> -R openharmony-sig/deveco-code --body "start build" --no-interactive --no-update-check
   ```

4. 等待超时不得发送构建指令。

## 结果报告

报告 Token 验证状态、基线哈希、本地分支起点、提交、hooks、推送分支、Issue/PR、关联、CI 评论及构建指令状态。失败时同时报告停止阶段、原因和相关路径。
