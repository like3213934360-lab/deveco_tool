# 原生工具链配置

`DEVECO_CONFIG` 指向严格校验的 JSON 文件。`studio` 与 `clt` 只能配置一个；项目目标 API 从工程模型读取，不根据工具链版本直接排除旧 API 工程。

创建工程时，`project_create.sdk_version` 选择实际安装的编译 SDK；`target_api` 单独指定应用的目标行为 API，`compatible_api` 指定允许安装的最低设备 API。目标 API 默认取所选 SDK，最低兼容 API 默认取目标 API；必须满足最低兼容 API ≤ 目标 API ≤ 编译 SDK API。生成的 `compileSdkVersion` 和工具模型版本仍来自实际 SDK，不下载或升级工具链。例如 SDK 26 可提交 `sdk_version: "26"`、`target_api: 24`、`compatible_api: 22`；具体版本组合和模板能力由实际 SDK 同步、构建验证。已有工程的三个版本字段分别读取，未提交创建工作流时不会改写它们。

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

工程、SDK 和现有文件的同步规范化使用 `fs.realpathSync.native`，与异步 `fs.promises.realpath` 保持一致。Windows 8.3 短路径、目录 junction 及完整路径必须得到同一个工程身份和资源键；不能仅做字符串 `resolve` 或混用保留短别名的实现。尚不存在的输出路径先规范化已存在的父目录。

2026-09-08 的 CI `34160484334` 在 Windows Node 22/24 均暴露两处短路径断言失败；原始记录保存在 `/private/tmp/deveco-ci-34160484334-win24`。随后统一原生规范化，并增加工程/工具链别名身份回归，同时让模拟 SDK 目录满足真实存在检查。原始失败记录保留；当前 main `bc68e0c` 的 [CI `34304363980`](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34304363980) 中，Windows Node 22/24 各 351 项适用回归已通过。该轮 CI 整体仍因上游接收凭证未刷新而失败，路径回归通过不扩大为 Windows 真实 SDK 验收通过。

路径对照来源为锁定的官方 deveco-cli `08c2f57ffbe83c817d64a728a17971872dd9ddcf` 的 `src/toolchain/tool-provider.ts`，只有路径和调用协议作为参考，不加载该 CLI 运行代码。验收用 `test/native-toolchain.test.ts` 检查本平台文件布局、JDK 优先级、更新失效、文件类型与参数边界。三平台运行测试通过不等于三平台上的真实 SDK 已验收；目前真实 SDK 证据来自 macOS Studio 26.0.0.821 / SDK 26.0.0.105。

## 独立 CLT 的实际平台验收

2026-09-09 在用户完成[华为官方下载页](https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos)个人账号登录后，读取 CLT 26.0.0.821 的三份安装包信息。以下摘要分别由对应平台条目的 SHA-256 复制按钮取得，不用下载文件自身计算的值充当官方预期值。

| 安装包 | 官方 SHA-256 |
| --- | --- |
| Mac ARM | `d53802c52d3d0a6a0836333c9e8f2bb73d9f6753d1658185539e2659c46df1ad` |
| Windows x64 | `18b66e8d7c7eabe6d29c40888492cb0d29d90490ad4f6c0deb3468a709a486bd` |
| Linux x64 | `58da7359019e9360a8bb82da0cd1d3b3b26fedc338379f257849f2162e3ac1fc` |

手动工作流 `.github/workflows/native-clt-acceptance.yml` 在 Windows/Linux 的 GitHub 托管 runner 上，按固定版本和上述摘要校验独立官方包，配置隔离 `DEVECO_CONFIG` 与 JDK 21，运行当前 `native-sdk-acceptance`、`native-checker-acceptance`、`native-lint-acceptance` 三个入口。MCP 使用 Node24；SDK 子工具使用包内 Node。SDK 入口不传设备目标，仅查询模拟器库存，不启动模拟器或部署应用。

官方签名下载 URL 保存在 `DEVECO_CLT_2600821_WINDOWS_URL`、`DEVECO_CLT_2600821_LINUX_URL` 两个仓库 Actions secret 中，不写入仓库及验收制品；链接失效时从同一官方版本重新取得。工作流只上传包摘要/准备结果及三个原始验收 JSON，不上传 SDK 包、状态数据库、测试密钥或认证资料。此入口独立于基础六组 CI，不改变上游接收或发布条件；准备工作流和下载包本身不证明真实 SDK 验收通过。
