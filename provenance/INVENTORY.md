# DevEco 能力清单

## 原始 Skill

以下目录均从 DevEco Code v0.1.5 原样复制，合计 130 个文件；`diff -qr` 已验证与上游提取目录一致。

| Skill | 文件数 | 内容 |
| --- | ---: | --- |
| `arkts-error-fixes` | 65 | 30 个 ArkTS 错误示例、对应参考说明和 Skill 使用说明 |
| `arkts-grammar-standards` | 8 | ArkTS/ArkUI 规则、Kit API 速查、配方和 TS→ArkTS 改写参考 |
| `arkts-runtime-fix` | 21 | JS/ArkTS 崩溃模式、faultlogger/hilog 诊断参考和 5 个运行时脚本 |
| `customize-deveco` | 1 | DevEco 自定义配置 Skill |
| `deveco-create-project` | 35 | HarmonyOS 工程模板、工程文件清单和 `copy-template`/`detect-sdk` 脚本 |

脚本目录中的可调用脚本已经进入统一白名单：

`copy_template`、`detect_sdk`、`collect_hilog`、`fetch_faultlog`、`jscrash_report`、`parse_jscrash_log`、`probe_faultlogger`。

## 统一 MCP 工具

### 本仓库适配层

`deveco_script_catalog`、`deveco_script`、`switch_cwd`、`init_project_path`、`deveco_doctor`、`deveco_login`、`deveco_logout`、`deveco_status`、`arkts_knowledge_search`、`arkts_check`、`hdc_log`。

### ArkTS LSP

`lsp`（9 个官方操作：`goToDefinition`、`findReferences`、`hover`、`documentSymbol`、`workspaceSymbol`、`goToImplementation`、`prepareCallHierarchy`、`incomingCalls`、`outgoingCalls`），以及兼容旧 ArkTS LSP MCP 的：

`find_references`、`go_to_definition`、`get_hover`、`list_symbols`、`find_call_hierarchy`。

### CodeGenie MCP 代理

`start_app`、`get_app_ui_tree`、`check_cpp_files`、`verify_ui`、`get_ui_verification_log`、`perform_ui_action`、`check_ets_files`、`build_project`、`save_ui_screenshot`。

CodeGenie 的 `init_project_path` 由本仓库的统一项目上下文入口管理，因此不重复注册子进程同名工具。

当前 CodeGenie 正常启动时，统一服务共暴露 26 个工具；如果 CodeGenie 包缺失，其他本地工具仍可以使用。

DevEco Code 内部的 `debug_exit` 会话调试工具没有迁移；CodeGenie 的同名 `init_project_path` 也没有重复暴露，而是统一由本服务的项目上下文管理。
