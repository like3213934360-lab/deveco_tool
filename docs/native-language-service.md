# 原生语言服务契约与验收

`lsp` 提供 `hover / definition / implementation / references / diagnostics`，直接启动选中 SDK 的 ace-server；C++ 通过 `check_cpp_files` 使用真实编译数据库启动 clangd。

## 输入和生命周期

- `file` 接受工程相对路径或绝对路径，现有路径经过 realpath 归一化，中文、空格和路径别名不会重复打开同一文件。
- `line / character` 统一为从零开始的 UTF-16 位置；旧工具的一基位置不保留。字符不能超过该行实际内容，CRLF 只算一次换行，末尾空行允许字符 0。
- 每份文档最多 4 MiB，异步分块读取；内容、SHA-256 与文件变更检查基于同一打开句柄，读取期间变化返回 `LSP_FILE_CHANGED`。
- 每次请求刷新已打开文档，已删除的依赖发送 didClose，修改后发送递增版本 didChange。忽略错误 URI 和过期版本的诊断。
- 会话按工程、配置、SDK/入口身份复用，最多 4 个服务、每服务 128 个文档；请求串行化，排队取消不让后续请求越过在途请求。空闲服务 5 分钟释放。
- 查询以 20 秒为默认整体期限，取消发送 JSON-RPC cancellation；关闭等待本服务拥有的子进程退出。Windows 后代进程的完整确认仍有独立验收缺口。

## 输出边界

输入和第三方响应都经过 Zod 校验。初始化声明不支持操作时返回 `LSP_CAPABILITY_UNAVAILABLE`；服务器选择非 UTF-16 编码返回 `LSP_POSITION_ENCODING_UNSUPPORTED`；畸形响应返回 `LSP_INVALID_RESPONSE`。请求超出文件范围返回 `LSP_INVALID_POSITION`。

悬停的 `null`、`{ "contents": [] }` 都是合法空结果，不作为执行失败。定义与实现保留 Location/LocationLink，引用支持 `includeDeclaration`，并在要求去除声明时核对语义定义位置。语言诊断标注 `checkKind: language-server`、`compilationVerified: false`。

## 证据

- `test/native-lsp.test.ts`：四组边界测试，覆盖实现链接、同文件路径、UTF-16/换行/空文件、无结果/无能力/畸形响应、变更后诊断及非法通知。
- `test/native-runtime.test.ts`：Unicode 文件同步、两种定义格式的声明过滤、LRU、排队取消。
- `test/native-toolchain.test.ts`：SDK 更新后的会话身份失效。
- `/private/tmp/deveco-native-sdk-20260908-4/evidence.json`：真实 Studio 26.0.0.821 / SDK 26.0.0.105 上四种查询、空 Hover、非法位置、ArkTS/C++ 诊断通过。此前 `...-3` 在空结果测试中把合法空数组误判失败，已修正测试；实现未把空数组误判为错误。

跨模块、其他 SDK/平台的实证和最终性能门槛尚需补齐。[LSP 官方规范](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)是协议语义参考，不能代替 SDK 实测。
