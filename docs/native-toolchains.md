# 原生工具链配置

`DEVECO_CONFIG` 指向严格校验的 JSON 文件。`studio` 与 `clt` 只能配置一个；项目目标 API 从工程模型读取，不根据工具链版本直接排除旧 API 工程。

```json
{
  "clt": "/absolute/command-line-tools",
  "java_home": "/absolute/jdk",
  "default_project": "/absolute/project"
}
```

Studio 使用其自带 Node、JBR 和 SDK。CLT 使用 `tool/node`、`ohpm`、`hvigor`、`sdk`、`arkts-lsp`、`emulator` 下的组件；现代 ArkTS 入口要求 `out/standardIndex/index.js`，没有该组件时报告能力不可用，不启动另一种旧协议。

Code Linter 按安装类型检查原生 JS 入口：CLT 的 `codelinter/index.js`、`codelinter/run/index.js`、`tool/codelinter/bin/codelinter.js`、`tool/codelinter/codelinter.js`；Studio 的 `plugins/codelinter/run/index.js`、`plugins/codelinter/index.js`、`tools/codelinter/bin/codelinter.js`、`tools/codelinter/codelinter.js`。候选必须为文件，目录不会被误报为可执行组件。

`java_home` 是 JDK 根目录，要求包含 `bin/java` 或 Windows 的 `bin/java.exe`。显式配置优先于自带 JBR。CLT 未配置时读取标准 `JAVA_HOME`，再检查 PATH 中的绝对目录；无有效 JDK 时签名等依赖 Java 的操作报告能力不可用。错误的显式 JDK 路径直接报错，不悄悄切到另一套 JDK。Node/Java 命令使用参数数组，不把工程路径、文字或参数拼成 shell。

CLT 的 `version.txt`、SDK/组件清单、入口文件身份以及 JDK `release` 元数据参与工具链指纹。同一路径内更换版本会使新语言服务请求选择新的会话身份，并阻止旧任务使用变更后的工具链恢复；不会在每次请求时递归散列整个 SDK。

路径对照来源为锁定的官方 deveco-cli `08c2f57ffbe83c817d64a728a17971872dd9ddcf` 的 `src/toolchain/tool-provider.ts`，只有路径和调用协议作为参考，不加载该 CLI 运行代码。验收用 `test/native-toolchain.test.ts` 检查本平台文件布局、JDK 优先级、更新失效、文件类型与参数边界。三平台运行测试通过不等于三平台上的真实 SDK 已验收；目前真实 SDK 证据来自 macOS Studio 26.0.0.821 / SDK 26.0.0.105。
