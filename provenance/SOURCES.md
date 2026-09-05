# 来源与同步记录

## DevEco Code 官方 Skill

- 上游仓库：<https://gitcode.com/openharmony-sig/deveco-code>
- 上游目录：`packages/opencode/resources/skills/`
- 分支：`develop`
- 标签 / 包版本：`v0.1.11` / `1.17.9`
- 固定提交：`b5911d2ad6daa66d4ca1bd673a9be260da19e1db`
- 上游许可：MIT；仓库声明见 `NOTICE.deveco-code`
- 本地提交锁：`provenance/deveco-code-v0.1.11.commit`
- 官方文件摘要：`provenance/deveco-code-v0.1.11.skills.sha256`

上游目录包含 6 个内置 Skill；本仓库按当前产品范围完整同步其中 5 个项目开发 Skill：

- `arkts-error-fixes`
- `arkts-grammar-standards`
- `arkts-runtime-fix`
- `deveco-cli`
- `deveco-create-project`

未同步的 `customize-deveco` 用于配置 DevEco Code 自身的 Agent、Skill、插件、MCP 和权限，
不属于 deveco-tool 面向 HarmonyOS 项目开发的能力范围。

上游构建脚本明确只把 `packages/opencode/resources/skills/` 嵌入产品作为默认 Skill。
仓库根目录的 `.agents/skills/gitcode-pr`、`.opencode/skills/effect` 以及测试 fixture 属于仓库开发或测试配置，
不是 DevEco Code 随产品交付的内置 Skill，因此不纳入本包。

同步规则是以上游目录为准做镜像删除，因此上游没有的本地 Skill 不会继续保留。除
`skills/INDEX.md` 是本仓库的目录索引外，保留的五个目录中的文件均不叠加本地补丁。可用下面的命令验证：

```bash
cd /path/to/deveco_tool
shasum -a 256 -c provenance/deveco-code-v0.1.11.skills.sha256
```

`src/script-adapters/` 是 MCP 的本地执行适配层，不改变上述官方文件摘要。
`copy-template.mjs` 保留官方 Skill 的参数和结果格式，直接展开
`@deveco/deveco-cli@1.3.1/templates/application`，避免其命令行入口对中文、空格目录的限制；
模板展开、图标处理参照同版本 `dist/cli.js` 的 create 实现（MIT，Huawei Device Co., Ltd.）。
`sdk.mjs` 共用网关的 Studio/CLT 路径和官方 API 映射；`runtime.mjs` 共用 HDC 执行器，
修正设备失败判定、Faultlogger 命令参数及设备日历时间解析。代码中的许可声明随适配器保留。

## 旧版 DevEco Code 提取资产

本仓库的 SDD 命令、模板，以及一部分 MCP 适配实现早于本次 Skill 同步，仍保留原有历史来源锁，
不能误写成来自 `v0.1.11`：

- `v0.1.5`：`537543c5732d03b7ba9bbe6082e3380677a520fb`
- `v0.1.6`：`ab476cafd27e6418cca35257a456baa1b8cba391`

这些资产已经过宿主中立化和本仓库功能修复，不承诺与最新版上游逐字节一致。具体职责见
`provenance/INVENTORY.md` 和各源码中的 `LOCAL PATCH` 注释。

## DevEco CLI 与 MCP 依赖

实际 npm 版本以 `package-lock.json` 为准。`@deveco/deveco-cli` 提供构建、运行、Linter、文档、
设备、模拟器、UI、签名和认证入口；本仓库通过 `src/` 中的适配层默认提供 40 个 MCP 工具；SDD 和兼容模式另见 `manifest.json`。

## 已移除来源

`HarmonyOS_Skills/harmonyos-agent-skills` 和此前由 DevEco agent prompt、未发布分支或本地规则派生的
Skill 已从 `skills/` 删除。它们不再出现在 `manifest.json`、脚本注册表、安装清单或许可范围中。
历史内容仍可通过本仓库 Git 历史恢复，但不是当前版本的一部分。
