# DevEco Code 官方 Skill 清单

本目录从 DevEco Code 官方仓库随产品发布的 6 个内置 Skill 中保留 5 个项目开发 Skill。文件来自
[`openharmony-sig/deveco-code`](https://gitcode.com/openharmony-sig/deveco-code) 的
`packages/opencode/resources/skills/`，版本为 `v0.1.11`，固定提交为
`b5911d2ad6daa66d4ca1bd673a9be260da19e1db`。

| Skill | 用途 |
|---|---|
| `arkts-error-fixes` | ArkTS 编译错误和类型不匹配问题的修复参考 |
| `arkts-grammar-standards` | ArkTSLinter、ArkTS 语法和 ArkUI 结构约束 |
| `arkts-runtime-fix` | ArkTS/JavaScript 崩溃、faultlogger 和 Hilog 诊断 |
| `deveco-cli` | DevEco CLI 的设备、模拟器、签名、UI 和 Skill 管理命令 |
| `deveco-create-project` | 使用官方脚本创建 ArkTS Stage 模型工程 |

上游 `customize-deveco` 只用于配置 DevEco Code 自身，按当前产品范围不再分发。表中的 5 个 Skill 保持上游原始内容，不在 `skills/` 内叠加本地补丁。来源与逐目录校验方法见
[`provenance/SOURCES.md`](../provenance/SOURCES.md)。
