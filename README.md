# deveco-tool

本目录是本机使用的 DevEco Code 能力整理仓库。当前已原样提取 DevEco Code v0.1.5 的四个 Skill，共 129 个 Skill 文件，包含 ArkTS 参考资料、工程模板和运行时诊断脚本；DevEco 环境自定义配置 Skill 未纳入。

## 统一 MCP

可以把多个 Skill 脚本注册在一个 MCP 服务里。本仓库的 `src/server.mjs` 采用白名单脚本注册表，当前通过一个 `deveco_script` 工具调度以下脚本：

- `copy_template`、`detect_sdk`
- `collect_hilog`、`fetch_faultlog`
- `jscrash_report`、`parse_jscrash_log`、`probe_faultlogger`

同一个 stdio MCP 入口还代理了 CodeGenie UI/构建工具、ArkTS 知识检索、ArkTS LSP、ArkTS 静态检查和 HDC 日志工具，不需要为每一组能力启动独立 MCP。

## 本地运行

```bash
npm install
npm run doctor
npm run scripts
npm run mcp
```

MCP 工具按来源分为：

- 统一脚本入口：`deveco_script_catalog`、`deveco_script`；脚本参数可以通过 `args` 对象传入，也可以通过 `argv` 数组原样传给上游脚本。
- 项目和环境：`switch_cwd`、`init_project_path`、`deveco_doctor`。
- 登录和知识：`deveco_login`、`deveco_logout`、`deveco_status`、`arkts_knowledge_search`。登录会兼容读取 `~/.deveco-knowledge-mcp/auth.json`，旧 MCP 本身不会被修改或迁移。
- ArkTS 语言服务：官方兼容入口 `lsp`（支持 `goToDefinition`、`findReferences`、`hover`、`documentSymbol`、`workspaceSymbol`、`goToImplementation`、`prepareCallHierarchy`、`incomingCalls`、`outgoingCalls`），以及易用的独立入口 `find_references`、`go_to_definition`、`get_hover`、`list_symbols`、`find_call_hierarchy`。位置参数均为 1-based；首次调用时按当前项目启动本地 `@arkts/language-server`。
- ArkTS 和设备诊断：`arkts_check`、`hdc_log`。`hdc_log` 支持 `list_devices`、`collect`、`clear` 三种操作；`clear` 会清空设备日志缓冲区，应在确认后调用。
- CodeGenie 代理：`start_app`、`get_app_ui_tree`、`check_cpp_files`、`verify_ui`、`get_ui_verification_log`、`perform_ui_action`、`check_ets_files`、`build_project`、`save_ui_screenshot`。这些工具由固定版本的 `@deveco-codegenie/mcp` 子进程提供。

可用工具数量会随 CodeGenie 包是否能启动而变化；本机当前完整列表为 26 个工具。

### 直接调用示例

```json
{
  "name": "deveco_script",
  "arguments": {
    "script": "parse_jscrash_log",
    "args": { "logFile": "/tmp/jscrash.log", "source": "file" }
  }
}
```

```json
{
  "name": "switch_cwd",
  "arguments": { "project_path": "/path/to/MyHarmonyProject" }
}
```

## Skill 来源

Skill 来源为 DevEco Code v0.1.5 的 `packages/opencode/resources/skills`，具体提交和许可证信息见 `provenance/`。当前四个目录保持上游原样，没有针对 Claude、Codex 或 Cursor 做改写；DevEco 环境自定义配置 Skill 已排除。

`src/` 是本仓库新增的适配层：它只注册白名单脚本、连接本地语言服务和代理已安装的 CodeGenie MCP，不会把旧的 `deveco-knowledge-mcp` 或旧 ArkTS LSP MCP 复制进来。客户端配置也不会被自动改写；迁移时只需把 stdio MCP 指向：

```text
node /Users/dreamlike/DreamLike/deveco_tool/src/server.mjs
```
