# 原生语言服务契约与验收

`lsp` 提供 `hover / definition / implementation / references / diagnostics / documentSymbol / workspaceSymbol / prepareCallHierarchy / incomingCalls / outgoingCalls`。默认 `language=arkts` 启动选中 SDK 的 ace-server；`language=cpp` 使用已构建目标的编译数据库启动 SDK clangd，`check_cpp_files` 提供 C++ 诊断入口。

## 输入和生命周期

- `file` 接受工程相对路径或绝对路径，现有路径经过 realpath 归一化，中文、空格和路径别名不会重复打开同一文件。
- `line / character` 统一为从零开始的 UTF-16 位置；旧工具的一基位置不保留。字符不能超过该行实际内容，CRLF 只算一次换行，末尾空行允许字符 0。
- 文档符号与工作区符号不需要位置；`workspaceSymbol` 使用 `query`，空查询请求有界的全部结果。`file` 仍用于选择工程中的文档及服务。
- 调用层次先使用当前位置准备可选项；`item_index` 默认为 0。入调用/出调用会基于当前源码重新准备项目，避免使用变更前的过期调用项。
- 每份文档最多 4 MiB，异步分块读取；内容、SHA-256 与文件变更检查基于同一打开句柄，读取期间变化返回 `LSP_FILE_CHANGED`。
- 每次请求刷新已打开文档，已删除的依赖发送 didClose，修改后发送递增版本 didChange。忽略错误 URI 和过期版本的诊断。
- 会话按工程、配置、SDK/入口身份复用，最多 4 个服务、每服务 128 个文档；请求串行化，排队取消不让后续请求越过在途请求。空闲服务 5 分钟释放。
- 查询以 20 秒为默认整体期限，取消发送 JSON-RPC cancellation；关闭等待本服务拥有的子进程退出。Windows 受管进程退出已通过 Node 22/24 各 20 轮检查；真实 Windows LSP 仍需单独验证。

- 每会话日志预留 16 MiB，纳入共享存储预算；超过预算会关闭会话，确认进程退出后清理目录。SDK 内部 worker 可能不遵循 ERROR 参数，容量不能只靠日志级别控制。详见 `docs/native-storage.md`。

## 输出边界

输入和第三方响应都经过 Zod 校验。初始化声明不支持操作时返回 `LSP_CAPABILITY_UNAVAILABLE`；服务器选择非 UTF-16 编码返回 `LSP_POSITION_ENCODING_UNSUPPORTED`；畸形响应返回 `LSP_INVALID_RESPONSE`。请求超出文件范围返回 `LSP_INVALID_POSITION`。

悬停的 `null`、`{ "contents": [] }` 都是合法空结果，不作为执行失败。定义与实现保留 Location/LocationLink，引用支持 `includeDeclaration`，并在要求去除声明时核对语义定义位置。语言诊断标注 `checkKind: language-server`、`compilationVerified: false`。

当前本机 SDK 26 的 ArkTS 服务未声明文档符号、工作区符号和调用层次能力，这五项均明确返回 `LSP_CAPABILITY_UNAVAILABLE`。SDK clangd 实测支持文档符号、工作区符号、准备调用层次和入调用；出调用返回 method-not-found，MCP 同样明确报告不支持。接口覆盖这些操作不代表每个 SDK 服务都能执行它们，也不会用文本搜索或空数组代替不支持结果。

## 证据

0.3.0 候选的当前证据为持久化目录 `native-7-sdk-final-lock-20260910-1`、`native-7-symbol-final-lock-20260910-1` 和 `native-7-multimodule-final-lock-20260910-1`：SDK 集成 26 项、多模块 45 项均通过，新增操作逐项记录实际支持与不支持结果。对应运行时 `7777d47a…`、编译摘要 `077ef53f…`。下面列出的旧提交和临时目录仅保留历史上下文；早期临时原始文件现已丢失。

- `test/native-lsp.test.ts`：四组边界测试，覆盖实现链接、同文件路径、UTF-16/换行/空文件、无结果/无能力/畸形响应、变更后诊断及非法通知。
- `test/native-runtime.test.ts`：Unicode 文件同步、两种定义格式的声明过滤、LRU、排队取消。
- `test/native-toolchain.test.ts`：SDK 更新后的会话身份失效。
- `/private/tmp/deveco-native-sdk-20260908-6/evidence.json`：真实 Studio 26.0.0.821 / SDK 26.0.0.105 上四种查询、空 Hover、非法位置、ArkTS/C++ 诊断通过。此前 `...-3` 在空结果测试中把合法空数组误判失败，已修正测试；实现未把空数组误判为错误。

当前 `cc3cdfd1` / `680bf03b` 已完成本机 Studio 多产品/目标/模块的 45 项验收，报告为本机 `acceptance/20260909-main-studio-cc3cdfd1-1/multimodule/evidence.json`，详情见[工具链记录](native-toolchains.md)。其他 SDK/平台的实证及完整性能采样仍需补齐；未经用户认可的 5% 相对 P95 阈值已撤销，不作为发布阻断。[LSP 官方规范](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)是协议语义参考，不能代替 SDK 实测。
