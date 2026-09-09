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

DevEco Studio 与独立 CLT 是两种可选的工具链环境。已有可用 Studio 的用户不需要为日常使用再安装 CLT；下面的独立下载只用于核实声明支持的 CLT 布局及跨平台兼容性，放在隔离测试目录，不改写现有 Studio 或全局 PATH。下载成功也不等于兼容性验收通过。

2026-09-09 在用户完成[华为官方下载页](https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos)个人账号登录后，读取 CLT 26.0.0.821 的三份安装包信息。以下摘要分别由对应平台条目的 SHA-256 复制按钮取得，不用下载文件自身计算的值充当官方预期值。

| 安装包 | 官方 SHA-256 |
| --- | --- |
| Mac ARM | `d53802c52d3d0a6a0836333c9e8f2bb73d9f6753d1658185539e2659c46df1ad` |
| Windows x64 | `18b66e8d7c7eabe6d29c40888492cb0d29d90490ad4f6c0deb3468a709a486bd` |
| Linux x64 | `58da7359019e9360a8bb82da0cd1d3b3b26fedc338379f257849f2162e3ac1fc` |

手动工作流 `.github/workflows/native-clt-acceptance.yml` 在 Windows/Linux 的 GitHub 托管 runner 上，按固定版本和上述摘要校验独立官方包，配置隔离 `DEVECO_CONFIG` 与 JDK 21，运行当前 `native-sdk-acceptance`、`native-checker-acceptance`、`native-lint-acceptance` 三个入口。MCP 使用 Node24；SDK 子工具使用包内 Node。SDK 入口不传设备目标，仅查询模拟器库存，不启动模拟器或部署应用。

官方签名下载 URL 保存在 `DEVECO_CLT_2600821_WINDOWS_URL`、`DEVECO_CLT_2600821_LINUX_URL` 两个仓库 Actions secret 中，不写入仓库及验收制品；链接失效时从同一官方版本重新取得。工作流只上传包摘要/准备结果及三个原始验收 JSON，不上传 SDK 包、状态数据库、测试密钥或认证资料。此入口独立于基础六组 CI，不改变上游接收或发布条件；准备工作流和下载包本身不证明真实 SDK 验收通过。

首轮 [Actions 34316076813](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34316076813) 绑定提交 `df602089741e77c275e5fd1e1754df86baa00e0f`。Linux 作业 `102352464776` 在官方下载阶段收到 HTTP 503，`clt-source.json` 为 `verified:false`，三个真实 SDK 检查均未执行；依赖安装及编译已通过。失败报告保留在该次 Linux 制品中，不据此判断 SDK 功能或 Linux 兼容性。Windows 作业及后续复验需分别以其终态报告为准。

该轮 Windows 作业 `102352464631` 已结束，官方包摘要匹配；当前候选 `85a5e037` / `c9fc32c4` 的独立 ArkTS 13 项和 Linter 6 项通过并关闭。综合 SDK 24 项中 14 项通过、10 项失败，报告为 `passed:false`、`completed:false`、`closed:true`、`unchanged:true`。LSP 六项及 API 扫描两项报告组件不可用，API 版本目录因缺失相应字段而断言失败；这些结果不能写成 CLT 已具备 Studio 全部能力。

另一项实际失败是空模拟器库存返回 `[Empty]\r\n`，原实现直接解析 JSON 而报错。修复仅在 `-list` 返回精确 `[Empty]` 且 stderr 为空时识别空库存，其他异常、截断及图像查询不使用这一规则。隔离回归先以旧编译代码复现同一解析错误，再以修改代码通过；未覆盖正在采样的仓库 dist。当时完整编译、三平台回归及 Windows 原生复验尚未完成；修复版结果见下文。三份 Windows 报告保存在 `preparation/clt-platform-26.0.0.821-20260909-1/windows-attempt-1`，SDK、ArkTS、Linter 的 SHA-256 分别为 `b455db57fca05846b2ff0d7eceb92bdcacb4d790333378c954d3a392e3711545`、`bd398626dd2ce27be5def4202c57356bdc120cbcfddd0106a73d15959fbcf9c4`、`fd6ebeef38945464bda9fa7cf1f49d166849754cc49549596422581745c40f0c`。

同一提交的第二次运行只重试 Linux，作业 `102355362860` 已完成：包摘要匹配，独立 ArkTS 13 项和 Linter 6 项通过并关闭，综合 SDK 仍为 14/24 项通过且整体失败。LSP/API 的九项与 Windows 同类；模拟器则因缺少 `libpulse.so.0` 在启动时退出 127，尚未执行库存查询。工作流随后为临时 Linux runner 增加 Ubuntu 的 [libpulse0](https://packages.ubuntu.com/en/noble/libs/libpulse0)，并保存官方包内的顶层目录和语言服务/API 扫描入口清单，以便区分未提供组件与路径发现错误；这些准备变更仍待实际复验。Linux 三份报告位于同目录下的 `linux-attempt-2`，SDK、ArkTS、Linter 的 SHA-256 分别为 `004b0eddc94277cbea02e9683f167c8040678d6d36f7ba61f0292eec5c834765`、`3ae36669e1af074d581a922bb85dfe4d8420000a317dfb748881f76e41630a24`、`a0a381076ff80bd015761001aa75fba9d35e1f2dbe3e3a5521673dd9d39ce6ff`。第一次 HTTP 503 报告保留。

### 修复版的终态结果（2026-09-09）

提交 `ddec5d8` 的运行摘要为 `cc3cdfd12b284fc5e85e657dac863a6cde184b18369844d9bf52336b3f903310`，编译摘要为 `680bf03b1d0f8d0c9403861be551d4d9bd8d8e727d44cb4df68f75d9517d27b6`。以下原始报告均已按这两个身份核对。

| 环境 | 综合 SDK | 独立 ArkTS | Linter | 模拟器库存 |
| --- | --- | --- | --- | --- |
| macOS ARM64 / Studio 26.0.0.821 | 24/24 通过 | 13/13 通过 | 6/6 通过 | 通过 |
| macOS ARM64 / 独立 CLT 26.0.0.821 | 15/24 通过，整体失败 | 13/13 通过 | 6/6 通过 | 通过 |
| Windows x64 / 独立 CLT 26.0.0.821 | 15/24 通过，整体失败 | 13/13 通过 | 6/6 通过 | 空库存通过，原解析错误已复验 |
| Linux x64 / 独立 CLT 26.0.0.821 | 14/24 通过，整体失败 | 13/13 通过 | 6/6 通过 | 缺少 libEGL.so.1，进程退出 127 |

Windows/Linux 来自 [Actions 34317583335](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34317583335)。三平台官方 CLT 包均通过官方 SHA-256 校验，包内未发现当前协议要求的语言服务入口 `out/standardIndex/index.js` 或 API 扫描入口 `api-change-scan.js`。九项 LSP/API 检查未通过，不将其删除或改写为成功。这里确认的是该官方版本的组件边界，不泛化为所有 CLT 版本都缺少这些组件。

Linux 已补充 libpulse0，随后暴露缺少 libEGL.so.1。下一轮临时 runner 增加 Ubuntu 的 [libegl1](https://packages.ubuntu.com/noble/libegl1)，并在已验证官方包解压后保存 Emulator 的 ldd 输出，以一次检查其余动态库缺口。工作流新增平台选择，仅重试 Linux；准备变更不是复验成功证据。

本机 Studio 同版另有多产品/多模块 45/45 项通过。四个入口均未提交设备目标，未进行真机安装或热补丁。本机原始报告位于 `acceptance/20260909-main-studio-cc3cdfd1-1`，Mac CLT 位于 `acceptance/20260909-main-clt-mac-ddec5d8-1`，远程原始报告位于 `preparation/clt-platform-26.0.0.821-20260909-1/fix-run-34317583335`（均相对于本机 DevEcoMCP 数据目录）。

| Studio 原始报告 | SHA-256 |
| --- | --- |
| checker/evidence.json | `b2bb98b0991454ebf26283e1d021e38b410c16f3e9a4a8980e731ef0e7243e17` |
| lint/evidence.json | `2ccc66d96444c69b0073ae9d7f97ff15ed67ff41de18631467d71bf06c990e62` |
| multimodule/evidence.json | `189d8d17144687a0a40fdf144be79e92d3e72cea7df04a98ec54c569f33b3bc7` |
| sdk/evidence.json | `47bbb57018e78a1846e2a3ddcc4631fd6d77fa5492eb609fa349686fbe25cc9a` |
