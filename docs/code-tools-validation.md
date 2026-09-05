# 代码检查与语言服务修复验证

日期：2026-09-05。范围：`arkts_check`、`check_ets_files`、`code_lint`、`api_compat_check`、`lsp`、`find_references`、`go_to_definition`、`get_hover`、`check_cpp_files`。

## 修复与对应证据

| 问题 | 修复 | 回归验证 |
| --- | --- | --- |
| lint 的 `path:"--fix"` 会越过 `fix:false` 修改整个项目 | 把位置参数转换为工程下的绝对路径，API 文件位置参数同样处理 | 真实目录 `--fix/` 检查后，范围外文件逐字节未变；显式自动修复仍生效 |
| CLI 更新提示污染 LSP stdout，初始化超时 | 只在协议子进程关闭更新通知和调试输出 | 保留宿主更新设置，默认环境下真实 LSP 启动成功 |
| 已打开依赖文件修改后 hover 仍显示旧类型 | 每次查询前同步已打开文件；删除文件发送 didClose；保持缓存数量、字节数和调用期限 | 磁盘改动 number→string 后，直接查询 consumer 得到 string；协议测试覆盖删除和版本递增 |
| `includeDeclaration:false` 仍返回声明 | 使用官方 definition 位置过滤引用，统一比较 URI 编码 | 中文空格路径下接口声明、实现声明和调用共 3 项，排除声明后仅剩调用；覆盖 Location、LocationLink |
| 官方 CLI 将无 API 变更误判为缺少报告错误 | 捕获明确的扫描成功与无变更标记，只适配这类已证实的 CLI 1.3.1 错误 | 21→22 返回 count=0 并写出空报告；17→18 的 backToTop 检出 1 项；无效版本、扫描失败及截断日志仍失败 |
| 非 Git 增量 lint 没执行却报告成功 | 识别 stdout/stderr 中的官方未执行结果，返回 MCP 错误 | 未初始化 Git 时拒绝；建立临时 Git 并修改受跟踪文件后检出 prefer-const |
| 注释和字符串触发资源规则误报 | SDK ArkTS AST 识别真实 `$r` 调用 | 注释、普通字符串和模板文本不报错；多行调用及模板表达式中的实际调用继续检查 |
| 页面检查写死 entry/main_pages | 共用模块发现逻辑，读取所属模块的 `$profile:` | 改名为 features/phone 后缺失页面被检出；自定义 profile 和单模块布局正常 |

同时收紧 `check_ets_files`：空数组在 MCP schema 层拒绝。整工程预检新增 `.ts` 及模块根源码入口覆盖，排除 `.d.ts`/`.d.ets` 和 Hvigor 构建脚本；真实 `.ts` 类型错误可检出。`compilationVerified:false` 保持不变。

## 验证方式

- `test/code-tools.test.mjs`：10 项回归，涵盖命令参数、错误分类、空报告、模块布局、MCP 参数、LSP 启动环境、依赖同步、引用过滤与资源 AST。资源 AST 用例需要官方 SDK，其余可在三种操作系统运行。
- `test/code-tools.integration.test.mjs`：4 组真实 MCP 集成，涵盖上述 9 个工具；使用独立临时工程，清理 MCP 子进程和测试工程。C++ 通过真实 clangd 验证正确源码和编辑后的错误诊断，测试预置编译数据库。
- 现有整仓测试包含 LSP 缓存限制、超时、重启、接口契约、打包及安装检查。CI 在 Linux/Node 22、24 运行整仓测试，在 macOS、Windows/Node 22、24 运行可移植专项。

运行：

```sh
node --test --test-concurrency=1 test/code-tools.test.mjs test/code-tools.integration.test.mjs
npm test
```

本机：macOS arm64，DevEco Studio 26.0.0.821，官方 CLI 1.3.1，CodeGenie MCP 1.1.11，Node 24.14.1、22.23.2。新增 14 项测试已通过真实 SDK 环境验证。

| 检查 | 结果 |
| --- | --- |
| Node 22 整仓测试 | 237 项：229 通过、8 项设备测试按条件跳过、0 失败 |
| Node 24 整仓测试 | 237 项：229 通过、8 项设备测试按条件跳过、0 失败 |
| 最终代码工具专项（Node 24） | 14 通过、0 跳过、0 失败，包含接口实现声明过滤的补充回归 |
| `git diff --check` | 通过 |

远程矩阵结果以该提交对应的 GitHub Actions CI 为准，SDK 集成测试在无 SDK 的 runner 上明确跳过。

## 实际限制

- SDK/LSP/clangd 实测环境为 macOS。Windows/Linux 的 CI 验证可移植适配逻辑，没有对应原生 SDK 或设备验证证据。
- 当前 Hvigor 对工程根目录有字符限制；中文根目录会在 compileNative 前返回 `00306003 Specification Limit Violation`。API 兼容扫描保留该真实错误；其集成用例使用含空格的英文目录。ArkTS、LSP 和 C++ 集成用例使用中文空格目录。
- C++ 本轮未覆盖自动生成编译数据库、复杂 CMake/NDK 工程。未穷举所有 FA/Stage 布局、SDK 版本或 CPU 架构。
- 静态预检通过不能代替项目构建；Linter/C++ 工具执行成功也不表示诊断列表为空。不能承诺任意操作系统、任意工程均可运行。
