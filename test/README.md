# 测试运行指南

这是当前测试入口的唯一说明。历史验收中的旧命令只适用于其来源提交；删除与覆盖对应关系见 [治理映射](../docs/TEST-GOVERNANCE.md)。目录规则见 [AGENTS.md](../AGENTS.md)。不以测试/产品行数比例决定删减，不安装工具、更换模型、模拟器镜像或签名配置来让测试通过。

## 分层与入口

在仓库根目录执行，使用现有 Node >=22.18 和 `npm ci` 安装的开发依赖。TypeScript/JSDoc 检查公共传输、媒体、提示统计与提供商采集模块；目录门禁检查全部测试语法、静态引用及 E2E 未定义符号。没有新编译链或运行依赖。

| 命令 | 范围 / 条件 |
| --- | --- |
| `npm run typecheck` | 产品及公共模块静态检查 |
| `npm test` | 构建 + 全部离线 unit/integration；并发 4，不连 SDK、设备或模型，不含外部 FFmpeg 套件 |
| `npm run test:unit` | 独立规则及纯逻辑；某些规则夹具包含临时文件 |
| `npm run test:integration` | MCP、进程、数据库、打包、模型采集/评分的离线回归 |
| `npm run test:media` | 已安装 ffmpeg/ffprobe 的真实生成与严格解码；缺少命令直接失败 |
| `npm run test:e2e` | 现有 SDK 的新模板、Kit、增量 HAR/HSP 构建；仅在专用证据目录创建工程 |
| `npm run test:sdk` | 指定现有专用工程的 ArkTS/C++、编译、lint、API 扫描、30 模块 × 6 设备类型解析 |
| `npm run test:device` | 指定 USB 真机及专用应用：设备、手势、流程、任务、引导、崩溃、生命周期；最后卸载专用应用 |
| `npm run test:recording` | 指定设备全新录制、取回、严格解码、最终 idle；不改变原视频 |
| `npm run test:video -- /absolute/video.mp4 /absolute/new-receipt.json` | 只读检查已有视频，回执排他创建 |
| `npm run test:prompts -- --snapshot /absolute/new-snapshot.json` | 实际 tools/list 与 instructions 字节/字符统计，不声称是 token 数 |
| `npm run bench` | 握手、空闲 CPU/RSS、提示说明门限；需要 POSIX ps，预算不变 |
| `npm run upstream:sync -- --json` | 当前上游清单与本地独立能力映射；需要 Git/network |
| `npm run test:model -- --host codex --suite discovery --out /absolute/new-run` | 真实 Codex CLI 的拟调用方案；不代表调用执行，不替代 Codex App 验收 |
| `npm run test:model -- --host opencode --model provider/id --suite live --cases /absolute/cases.json --out /absolute/new-run` | 明确选择宿主/原模型的真实调用验收；遵守用户指定的模型与模态范围 |
| `npm run test:models -- --out /absolute/new-matrix --rounds 2 --models provider/id,...` | 明确授权后才运行所选 OpenCode 免费模型矩阵；先核对当前目录中的工具调用、模态和费用，不自动降级/替换模型 |
| `npm run test:model-report -- /absolute/private-run /absolute/new-summary.json` | 从真实证据生成脱敏摘要 |

模型 `live-cases.mjs`、`workflow-cases.mjs` 是场景生成器，`proxy.mjs` 和 `capture.mjs` 由评测器加载。分别运行 `node test/model/live-cases.mjs <existing-project> <target> <new-cases.json>` 或 `node test/model/workflow-cases.mjs project|ui|ui-text <dedicated-project> <explicit-target> <new-artifacts-directory> <new-cases.json>` 生成输入；这些操作本身不算模型验收。保留拟调用、实际请求/响应、任务终态、模型模态和宿主版本的区别。每次有写入的试验独占新的制品目录，前一轮结束并清理本轮对象后才能继续；模型能力目录不能代替服务端实际可用性验证。

## 真实验收条件与作用范围

所有 E2E 要求显式绝对 `E2E_DIR`，每个测试独占新目录；调用日志、图片哈希、初始化/构建身份及制品留在此处，失败也保留。`E2E_PROJECT` 必须为 bundle 前缀 `com.devecomcp.` 的专用工程，保持现有签名；`E2E_TARGET` 必须是用户选定的设备。USB app 套件拒绝网络连接及模拟器，不自动选择设备。普通 SDK 模板与录屏不依赖专用应用。运行前先 `npm run build`；操作同一工程或设备的真实验收必须串行。

```sh
export E2E_DIR=/absolute/private-evidence
export E2E_PROJECT=/absolute/existing-dedicated-app
export E2E_TARGET=explicit-usb-serial
npm run test:sdk
npm run test:recording
# 其他能力套件：只显式运行需要的文件，不能对 test/e2e 使用通配符。
node --test --test-concurrency=1 test/e2e/hotreload.test.mjs
```

需要创建完整夹具时，在新专用模板工程调用 `makeApp(project)`（`test/support/project.mjs` 导出）：它添加手势、调用链、接口、C++ 和 SQLite 建表，不配置签名。仅复用既有夹具时不得重新运行。源码变更测试恢复自己修改的源文件；构建目录、测试数据库/安装和日志属于专用测试对象。历史原视频、私有日志和截图不得随测试代码删除。

| 按能力执行的文件 | 额外条件及影响 |
| --- | --- |
| `e2e/project.test.mjs` | 真实 SDK；专用新工程，无设备 |
| `e2e/sdk.test.mjs` | 原完整夹具与签名；临时改 C++ 后逐字恢复 |
| `e2e/checker.test.mjs` | `--test-name-pattern='checker (violations|legal)'` 独立编译正反例；`checker runtime claims` 另需明确的原模拟器（新模板不配置真机签名），安装/卸载专用应用 |
| `e2e/device.test.mjs` | 完整夹具及指定 USB 真机，`E2E_HDC` 为现有 SDK HDC 绝对路径，仅用于清理本轮传输文件（MCP shell 为只读）；会构建、安装、写专用 SQLite、交互、卸载；不能把单独运行后续依赖步骤称为整套通过 |
| `e2e/hotreload.test.mjs` | 完整夹具；热补丁、显式覆盖基线 reset、独立数据标记、多轮时限、依赖改变后部署；恢复源文件 |
| `e2e/ui.test.mjs` | 完整夹具已安装；批量负例、超时、视觉稳定性/损坏基线、滚动性能和失效流程；只删除本轮命名的基线/流程 |
| `e2e/soak.test.mjs` | 完整夹具、POSIX ps/lsof；100 次操作及 20 次部署，原 RSS/进程/句柄/临时文件/输出预算。采样包含宿主临时目录，同机其他测试也必须暂停，不能并行运行离线套件 |
| `e2e/process.test.mjs` | POSIX、真实 SDK；仅 SIGKILL 本轮 MCP/检查器/LSP 子进程，验证任务恢复与无遗留子进程 |
| `e2e/services.test.mjs` | 原登录、知识库、SDK 和 USB；只读服务清单、检索和账号团队查询 |
| `e2e/signing.test.mjs` | `E2E_TEAM`；列出现有签名对象、在证据目录生成密钥/CSR、验证 HAP，不改变工程签名 |
| `e2e/sign-cloud.test.mjs` | `E2E_TEAM`、已登记 `E2E_TARGET`、`E2E_HDC` 与实际云配额；HDC 只读 UDID 独立核对登记，MCP shell 白名单不变。新建唯一证书与 IDE profile，OpenSSL 验证 profile 签名、bundle 和设备，仅删除本轮证书。IDE profile 不返回控制台 ID，控制台 profile 删除需另行授权的专用对象及独立确认，此套件不冒充覆盖；无配额时失败，不借用用户证书兜底 |
| `e2e/cloud.test.mjs` | 原 CodeGenie 登录及联网；来源标签、域名、制品完整性与独立文档重合率；不可判定来源单独记未验证 |
| `e2e/skills.test.mjs` | 用户指定 `E2E_SKILLS` 绝对目录、`E2E_HOST=codex` 或 `opencode`（无默认两宿主循环）；专用目录内 export/install/uninstall/init，原全局配置哈希不变 |
| `e2e/auth.test.mjs` | 显式 `DEVECO_STATE_DIR` 与原浏览器登录；注销/重登录 CodeGenie，其他 provider 凭据哈希不变；需用户参与，不混入普通测试 |
| `e2e/knowledge.test.mjs` | 显式 `DEVECO_STATE_DIR` 及其已安装 KB；联网更新并回滚，校验原内容哈希；不替用户准备/重置知识库 |
| `e2e/emulator.test.mjs` | `--test-name-pattern='^emulator$'` 加明确 `E2E_IMAGE`，须已有 foldable 镜像；创建本轮实例，折叠、停止、删除并比对既有实例；license 会接受条款，须在授权范围内 |
| 同文件 `emulator image lifecycle` | 明确 `E2E_DEVICE_TYPE`、`E2E_IMAGE`、`E2E_ALLOW_IMAGE_WRITE=1`；仅在授权镜像安装/删除测试时使用。拒绝删除既有镜像；无未安装的适用镜像时记录前置条件阻塞 |
| `e2e/review.test.mjs` | 分开运行 `--test-name-pattern='^capture$'` 与 `'^finish$'`。宿主必须先实际查看 capture 图片；finish 要求 `E2E_REVIEW` 目录及 `E2E_DECISION` JSON（test_id、review_id、image_sha256、outcome、reason），不会自动批准 |

`node --test --test-name-pattern='<pattern>' --test-concurrency=1 <file>` 的过滤范围必须记录，未选场景不能计为通过。测试失败/清理失败均非零退出；超时只发送取消并失败，不重放操作。外部条件缺失直接失败/阻塞，不静默跳过；“环境不支持”要有设备/工具原始证据，不能代替功能通过。

## 证据与发布

公开脱敏结果在 `docs/evidence/`；私有 `E2E_DIR` 含源代码、截图、视频及云端资料，禁止整体提交。回执与原视频排他创建，不覆盖旧证据。FFmpeg 严格检查的原理见 [媒体检查](../docs/RECORDING-CHECK.md)。本轮范围和未验证项见 [v1.4.8](../docs/UPGRADE-1.4.8.md)，发布遵循 [RELEASING](../docs/RELEASING.md)。发布成功不证明 Codex App 已重载或模型已重新验收。
