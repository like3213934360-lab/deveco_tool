# 来源与许可记录

## DevEco Code Skills

- 来源：`https://gitcode.com/openharmony-sig/deveco-code.git`
- 版本：`v0.1.5`
- 提取路径：`packages/opencode/resources/skills`
- 提取提交：见 `deveco-code-v0.1.5.commit`
- 提取范围：`arkts-error-fixes`、`arkts-grammar-standards`、`arkts-runtime-fix`、`deveco-create-project`
- 文件数量：129（排除 `customize-deveco` 环境自定义配置 Skill）

DevEco Code 仓库主体采用 MIT；其中 Huawei 工具和脚本文件保留各自的 Apache-2.0 文件头。复制和分发时必须保留原文件头，并继续维护第三方声明。

## 统一 MCP 适配层依赖

- `@modelcontextprotocol/sdk@1.29.0`：统一 stdio MCP 协议服务和 CodeGenie 子进程客户端。
- `@deveco-codegenie/mcp@1.1.11`：固定版本的 CodeGenie MCP 子进程；其平台包由 npm 按当前平台安装。
- `@arkts/language-server@1.3.10`：本地 ArkTS LSP；通过 `vscode-jsonrpc` 和 `vscode-uri` 连接。
- `src/upstream/arkts-check.cjs`：从 DevEco Code v0.1.5 `packages/opencode/src/tool/arkts-check.cjs` 提取，保留原文件内容。
- `src/upstream/arkts-check.txt`、`src/upstream/hdc-log.txt`、`src/upstream/lsp.txt`、`src/upstream/switch-cwd.txt`：对应官方工具说明原文。
- `src/hdc-log.mjs`：按 DevEco Code v0.1.5 `packages/opencode/src/tool/hdc_log.ts` 的公开行为实现 Node 适配层。
- `src/lsp.mjs`：新的统一 LSP 适配层；操作格式参考本机旧 `deveco-arkts-lsp` 项目，但没有复制旧 MCP 入口或客户端配置。

完整的 npm 锁定版本见 `package-lock.json`；各依赖的许可证和版权文件位于 `node_modules` 安装包内。

## 参考项目

`/Users/dreamlike/DreamLike/deveco-knowledge-mcp` 仅作为认证和知识检索实现参考，不复制其旧 MCP 入口，也不自动修改任何现有客户端配置。
