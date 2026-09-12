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
- 查询以 20 秒为默认整体期限，取消发送 JSON-RPC cancellation；关闭等待本服务拥有的子进程退出。Windows 受管进程退出由 Node 22/24 CI 及各 20 轮压力测试验证，当前结果见下一版本执行记录；真实 Windows LSP 仍需单独验证。

- 每会话日志预留 16 MiB，纳入共享存储预算；超过预算会关闭会话，确认进程退出后清理目录。SDK 内部 worker 可能不遵循 ERROR 参数，容量不能只靠日志级别控制。详见 `docs/native-storage.md`。

## 输出边界

输入和第三方响应都经过 Zod 校验。一般语言按初始化能力声明检查；ArkTS 的五项符号/调用查询使用有界的实际请求兼容探测，因为当前 SDK 的声明与处理器不一致。`LSP_CAPABILITY_UNAVAILABLE.details` 区分本地能力声明拒绝与实际 JSON-RPC `-32601` 响应，前者不能证明服务没有该功能。服务器选择非 UTF-16 编码返回 `LSP_POSITION_ENCODING_UNSUPPORTED`；畸形响应返回 `LSP_INVALID_RESPONSE`。请求超出文件范围返回 `LSP_INVALID_POSITION`。

悬停的 `null`、`{ "contents": [] }` 都是合法空结果，不作为执行失败。定义与实现保留 Location/LocationLink，引用支持 `includeDeclaration`，并在要求去除声明时核对语义定义位置。语言诊断标注 `checkKind: language-server`、`compilationVerified: false`。

诊断按服务声明选择拉取或推送：声明 `diagnosticProvider` 时，在同步已打开文件后发送 `textDocument/diagnostic`，要求完整报告；未声明时等待 `publishDiagnostics`。结果包含 `diagnostic_transport: pull | push`。拉取请求每次要求新报告，不复用依赖变更前的 resultId；错误、超时、无依据的 unchanged 或 null 报告不会转换为空诊断。当前 SDK 26 在受控探测中不发送诊断通知，却能拉取到类型错误及修复后的空报告；旧实现仅等待推送，存在 `DIAGNOSTICS_TIMEOUT` 缺陷。协议参考为 [Microsoft 的诊断客户端实现](https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common/diagnostic.ts)，具体可用性以本机原始请求及公共 MCP 验收为准。

0.3.0 将 SDK 26 的 ArkTS 能力声明当成最终支持结论，提前拒绝了上述五项查询。2026-09-11 原始协议审计已证明五项处理器实际存在；下一版本候选通过公共 MCP 对真实 ArkTS 服务验证了非空结果、LF/CRLF、UTF-16、多次跨文件调用和重启，扩展用例及最终发布身份状态见[剩余能力进度](remaining-release-progress.md)。SDK clangd 的出调用仍需单独记录实际 `method-not-found`，不能用 C++ 的支持情况替代 ArkTS 验收。

ArkTS 边界先规范化已知协议字段中的绝对路径为文件 URI，再校验结构；不改写 `item.data`。SDK 将跨文件出调用的调用点偏移按被调用文件映射，候选通过同一服务的反向入调用，以调用者 URI、选择范围及调用数一致性校正。无法取得一致语义关系时返回 `LSP_CALL_RANGE_UNVERIFIED`，并保留原始范围，不能猜测行号或按名称搜索来制造调用关系。

SDK 的类方法出调用还会重复列出同一个属性访问表达式。候选对跨文件或有重复坐标的关系查询反向入调用，要求调用者身份一致、调用点数量与原始总数或原始不同坐标数一致，才采用反向报告的精确方法名范围。原始四条重复范围会保留在证据中，不能仅删除重复项便声称坐标已正确。

扩展审计还发现，命名箭头函数的 SDK `range` 只覆盖表达式，`selectionRange` 指向表达式前面的变量名。候选只在同一文档的符号查询确认完全相同的变量名选择范围、各坐标均在当前文档边界内时，合并变量名和函数表达式的包围范围；保留 `extentEvidence.originalRange`，不移动名称或调用点坐标。无法确认时返回 `LSP_CALL_EXTENT_UNVERIFIED`。其他畸形范围和 C++ 的严格结构校验保持不变。上述扩展、拉取诊断、取消和重启已由 `native-7-remaining-lsp-mcp-20260911-7` 真实公共 MCP 验证；最终发布包须另行核验。

## 证据

0.3.0 的历史证据位于持久化目录 `native-7-sdk-final-lock-20260910-4`、`native-7-symbol-final-lock-20260910-4` 和 `native-7-multimodule-final-lock-20260910-4`。其中 SDK 集成 26 项、多模块 45 项的通过结果不代表 ArkTS 五项新增操作已执行：旧符号验收把部分本地拒绝记成不支持，相关证据分类已列为待修复缺陷。历史运行时为 `5e5aa855…`、编译摘要 `4c6668ee…`；不能用它们证明候选改动已通过。下面旧提交和临时目录也仅保留历史上下文；早期临时原始文件现已丢失。

- `test/native-lsp.test.ts`：四组边界测试，覆盖实现链接、同文件路径、UTF-16/换行/空文件、无结果/无能力/畸形响应、变更后诊断及非法通知。
- `test/native-runtime.test.ts`：Unicode 文件同步、两种定义格式的声明过滤、LRU、排队取消。
- `test/native-toolchain.test.ts`：SDK 更新后的会话身份失效。
- `/private/tmp/deveco-native-sdk-20260908-6/evidence.json`：真实 Studio 26.0.0.821 / SDK 26.0.0.105 上四种查询、空 Hover、非法位置、ArkTS/C++ 诊断通过。此前 `...-3` 在空结果测试中把合法空数组误判失败，已修正测试；实现未把空数组误判为错误。

当前 `cc3cdfd1` / `680bf03b` 已完成本机 Studio 多产品/目标/模块的 45 项验收，报告为本机 `acceptance/20260909-main-studio-cc3cdfd1-1/multimodule/evidence.json`，详情见[工具链记录](native-toolchains.md)。其他 SDK/平台的实证及完整性能采样仍需补齐；未经用户认可的 5% 相对 P95 阈值已撤销，不作为发布阻断。[LSP 官方规范](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)是协议语义参考，不能代替 SDK 实测。
