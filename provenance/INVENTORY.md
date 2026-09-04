# 当前资产清单

`manifest.json` 是机器可读的唯一清单；本文件说明各层职责。

## 选用的官方 Skill（5 个）

| Skill | 文件构成 | 主要用途 |
|---|---:|---|
| `arkts-error-fixes` | `SKILL.md`、`references/`、`assets/` | ArkTS 编译错误和类型问题 |
| `arkts-grammar-standards` | `SKILL.md`、`references/` | ArkTSLinter、语法与 ArkUI 结构规则 |
| `arkts-runtime-fix` | `SKILL.md`、`references/`、`scripts/` | JS crash、faultlogger、Hilog 诊断 |
| `deveco-cli` | `SKILL.md` | DevEco CLI 命令使用规范 |
| `deveco-create-project` | `SKILL.md`、`FILES.md`、`scripts/` | ArkTS 工程创建 |

这 5 个目录与 DevEco Code `v0.1.11` 固定提交中的对应 Skill 目录逐字节一致；本地只额外维护
`skills/INDEX.md` 作为索引。上游第 6 个 `customize-deveco` 因只服务于 DevEco Code 自身配置而未纳入当前产品范围。

## 注册脚本（7 个）

| Skill | 脚本 ID |
|---|---|
| `deveco-create-project` | `copy_template`、`detect_sdk` |
| `arkts-runtime-fix` | `collect_hilog`、`fetch_faultlog`、`jscrash_report`、`parse_jscrash_log`、`probe_faultlogger` |

这些入口由 `src/script-registry.mjs` 以静态白名单公开，不允许执行任意路径或 Shell 文本。

## MCP（45 个工具）

统一入口是 `src/server.mjs`。工具按项目上下文、认证和知识、语言服务、诊断、构建部署、
设备 UI、模拟器及 SDD 文档分组；完整名称和数量见 `manifest.json` 的 `mcp.toolGroups`。

## SDD 工作流

`commands/` 包含 `spec-specify`、`spec-plan`、`spec-tasks`、`spec-implement`、`spec-verify`，
`templates/` 包含对应的规范、计划和任务模板。这些是本仓库保留的历史 DevEco Code 提取与适配资产，
不属于当前官方内置 Skill 目录。

## 不再分发的 Skill

此前的派生 Skill、未发布分支 Skill 以及 `HarmonyOS_Skills/harmonyos-agent-skills` 内容均已删除。
安装器只会发现并安装上表中的官方 Skill，不再区分 core/extended 内容来源。
