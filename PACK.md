# deveco-tool 能力包

本仓库由三层组成：

- `skills/`：从 DevEco Code 官方内置 Skill 中选用的 5 个项目开发 Skill。
- `commands/` 与 `templates/`：宿主中立的 SDD 五阶段工作流。
- `src/server.mjs`：统一 stdio MCP 服务，固定 40 个工具。

机器可读清单以 `manifest.json` 为准，工具说明和运行依赖以 `README.md` 为准。

## 官方 Skill

当前 Skill 完整同步自
[`openharmony-sig/deveco-code`](https://gitcode.com/openharmony-sig/deveco-code) 的
`packages/opencode/resources/skills/`：

| Skill | 主要用途 |
|---|---|
| `arkts-error-fixes` | ArkTS 编译错误修复 |
| `arkts-grammar-standards` | ArkTS 和 ArkUI 语法规范 |
| `arkts-runtime-fix` | JS crash、faultlogger 和 Hilog 诊断 |
| `deveco-cli` | DevEco CLI 使用规范 |
| `deveco-create-project` | ArkTS 工程创建 |

固定版本为 `v0.1.11`，提交为
`b5911d2ad6daa66d4ca1bd673a9be260da19e1db`。保留的 5 个 Skill 目录保持上游原始内容；本仓库只额外维护
`skills/INDEX.md`。上游 `customize-deveco` 面向 DevEco Code 自身配置，不属于当前产品范围，因此不分发；非官方、派生和其他仓库来源的 Skill 同样不再分发。

## 安装

安装 MCP 依赖：

```bash
npm install
npm run doctor
npm run mcp
```

安装 Skill 到普通目录：

```bash
node scripts/install.mjs --dest <目标目录>
```

安装到支持的宿主发现目录：

```bash
node scripts/install-host.mjs --host claude
node scripts/install-host.mjs --host codex
node scripts/install-host.mjs --host all
```

安装器保留 `--profile core|full` 参数作为兼容入口，但当前不存在 extended 层，两种 profile 都只安装上述 5 个官方 Skill。

## Skill 脚本

`deveco_script` 仅允许调用 `src/script-registry.mjs` 中登记的 7 个脚本：

- 工程创建：`copy_template`、`detect_sdk`
- 运行时诊断：`collect_hilog`、`fetch_faultlog`、`jscrash_report`、`parse_jscrash_log`、`probe_faultlogger`

白名单只指向官方 Skill 自带脚本；删除 Skill 后对应入口也会从注册表移除。

## 宿主策略

源 Skill 不因 Claude/Codex 的元数据格式而被修改。`scripts/install-host.mjs` 在安装副本或旁路元数据中应用：

- `deveco-create-project` 禁止隐式调用，因为它会创建目录并写入工程树。
- 实际依赖 deveco-tool MCP 的 Skill 会在 Codex 元数据中声明 `dependencies.tools`。
- 其他内容保留官方 `SKILL.md` 原文。

## MCP 接入

MCP 固定提供 40 个工具。工程切换使用 `switch_cwd`。工具数及清单见 `manifest.json`。

`scripts/install.mjs --print-mcp` 输出单个服务的 JSON 配置项；`scripts/install-host.mjs --host claude|codex --print-mcp` 输出对应宿主的配置片段。两种安装方式连接同一套 MCP 接口。

## SDD 命令

```text
/spec-specify -> /spec-plan -> /spec-tasks -> /spec-implement -> /spec-verify
```

这些命令和模板是历史适配资产，不属于 DevEco Code 当前的内置 Skill 目录。它们仍使用 MCP 中的
`arkts_knowledge_search`、`arkts_check`、`build_project` 和 `start_app` 等工具，文档由宿主的文件工具读写。

## 来源与许可

- 最新官方 Skill 提交、旧资产历史来源和同步规则：`provenance/SOURCES.md`
- 当前资产分层清单：`provenance/INVENTORY.md`
- DevEco Code 上游第三方声明：`NOTICE.deveco-code`
- 本仓库许可边界：`LICENSE`

DevEco Code 采用 MIT 许可。官方 Skill 内 10 个文件另带 Apache-2.0 和 Huawei 文件头，这些文件头保持原样并优先适用。
