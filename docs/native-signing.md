# 原生签名与设备验收

核心重构已合入 main。本页按日期记录的设备、Profile 和签名结果保留各自历史身份；当前宿主已安装候选并确认 Codex 应用内重连，Developer/CodeGenie 重新登录与云端只读复验分别通过 9/10 项。2026-09-09 的真实证书创建中断试验被个人团队证书配额拒绝，尚未到达中断窗口；失败任务去重及重启后状态保留另有 4 项通过记录。当前证据及剩余范围见[完成清单](native-completion.md)。

更新：2026-09-08。使用用户明确选择的个人开发者团队，已通过专用证书、调试 Profile、本地签名及验签、真实部署、中文输入录制/重放和两次连续设备热补丁。本机证据限 macOS arm64、Node 24.14.1、Studio 26.0.0.821 / SDK 26.0.0.105、API 26 真机；不代表所有平台、签名类型或发布门槛均通过。

## 签名接口

`inspect / verify / certificates / devices` 是只读调用；其他签名动作（包括 configure）先返回 `run_id`。可提供稳定的 `request_key` 防止重复提交；相同 key 的输入变化会拒绝。随后调用：

```json
{ "action": "status", "run_id": "返回的任务UUID", "wait_ms": 20000 }
```

这是 `workflow_run` 的参数。只有状态为 `succeeded` 才读取 `result.execute_native_operation`；超过 16 KiB 的结果通过 `result_artifact` 分页读取。`needs_input / interrupted` 要核对原任务，再以受限 `resume_input: { "action": "recheck" }` 请求复查，不能重新提交替代任务。


`app_signature` 的云端动作要求显式 `team_id`，通过 `harmony_auth.teams` 查询；认证使用 developer provider。不会按名称猜测团队，也不会混用知识服务 Token。

- `certificate_create`：校验 CSR，在所选团队创建专用证书，保存远程 ID 与下载摘要。
- `profile_create`：默认使用现代 IDE 的 `test` 调试 Profile 协议。该接口可能只返回下载地址而没有远程 ID，此时返回 `remote_deletion_available:false`，不能伪造 ID 或宣称可删除。显式 `kind:real` 仍要求返回 ID，本次未完成其成功验收。
- `sign`：直接使用 SDK 签名工具，支持显式参数或读取指定产品的签名配置。
- `verify`：提供 SDK 必需的证书链/Profile 输出参数，在有预算的私有临时目录中提取两份结果，检查非空，返回 SHA-256 后清理。验收核对了 HAP 内的 Profile 与云端下载文件完全一致。
- `configure`：从 `file` 指定的私密 JSON 描述文件读取材料和密码，在 `output` 指定的新目录生成完整 Hvigor 签名材料，以 `options.name`（1–64 个英文字母或数字）新建配置并选中当前产品。描述文件、输出目录或名称格式不合法时，公开接口在创建 Worker 和持久化任务之前拒绝请求。目录和配置名称均不得已存在；其他配置与产品保留。

`configure` 描述文件字段为 `keystoreFile`、`keystorePwd`、`keyAlias`、`keyPwd`、`appCertFile`、`profileFile`、可选 `signAlg`（默认 `SHA256withECDSA`）。相对输入路径相对于描述文件目录解析。文件只在本地创建，不把真实密码贴入对话、命令行或 Git。

```json
{
  "action": "configure",
  "project_path": "/absolute/project",
  "product": "default",
  "file": "/private/signing-input.json",
  "output": "/private/new-signing-directory",
  "options": { "name": "Personal" }
}
```

生成目录含密钥库、证书、Profile，以及 `material/fd`、`material/ac`、`material/ce`。采用当前 Hvigor 的 PBKDF2/AES-GCM 格式，密码以密文写入 `build-profile.json5`。材料和密文放在一起可以解密，保密性依赖文件权限，不能当成远端密钥托管。目录/文件创建权限为 0700/0600，Windows 按系统 ACL 管理。

配置写入使用工程租约，并拒绝配置已变化或存在 hot watch 的工程。先准备材料，再原子写入配置；提交前失败清理本次拥有的目录。若配置提交的持久化结果不确定，保留材料供核对，避免删除已经被配置引用的文件。该操作进入固定内部持久化任务；它不增加公开工作流目录。云端接口没有结果查询依据的场景仍只会安全暂停。

## 验收入口与证据

所有验收使用未安装官方 CLI、CodeGenie 子 MCP 或 Skill 的独立原生验证目录。目录一经编译验收不再修改，记录实际运行文件、锁文件和资源摘要。

```sh
node dist/scripts/native-signing-prepare.js /absolute/new-preparation-directory
node dist/scripts/native-signing-acceptance.js /absolute/signing-evidence /absolute/preparation /absolute/auth-state TEAM_NAME STAGE
node dist/scripts/native-canary-ui-acceptance.js /absolute/new-ui-evidence /absolute/preparation /absolute/signing-evidence /absolute/auth-state
node dist/scripts/native-hot-device-acceptance.js /absolute/new-hot-evidence /absolute/preparation /absolute/signing-evidence /absolute/auth-state
```

签名阶段依次为 `preflight`、`certificate`、`profile`、`sign`、`verify`、`deploy`、`configure`。测试脚本保留 `debug_profile` 阶段，只用于本轮已记录失败并经过远端核对的验收恢复；它不是 MCP 的兼容入口。清理阶段为 `profile_delete` 和 `certificate_delete`。脚本在变更前写入私有操作记录，阻止无核对重复执行；部署立即保存 LangGraph run_id。清理按已登记的精确远程 ID 进行，不要求工程构建输出仍与最初未签名 HAP 相同。

原始证据根目录：`~/Library/Application Support/DevEcoMCP/acceptance/`。私有操作记录和签名描述文件不提交 Git。准备目录在 `~/Library/Caches/DevEcoMCP/acceptance-projects/20260908-signing-1`。

| 证据 | 结果与范围 |
| --- | --- |
| `20260908-signing-1` | 个人团队选择、已登记设备匹配、专用证书、调试 Profile、HAP 签名/验签和部署通过；未新登记设备。签名 HAP SHA-256 为 `1ff2e87062d1ac7f332356b748256fcf3a552810e7a6b7d5dde833e5c4658c33` |
| `20260908-canary-ui-5/evidence.json` | 16 项通过：实际 MCP/Worker 传输、签名 Profile 身份、录制、中文输入、点击、最终断言、保存、MCP 关闭/重启、持久化流程摘要、重放及截图；截图仅为辅助证据 |
| `20260908-hot-device-1/evidence.json` | 10 项通过：签名 watch 基线、初始断言、两次 HQF 应用及文字断言、截图、watch 停止、源码恢复、关闭。两次补丁均保持应用 PID，版本为 2000000/2000001 |
| `20260908-signing-regression-5/evidence.json` | 226 项回归通过、0 跳过；含材料生成、其他配置保留、拒绝重复目录/名称、GCM 篡改拒绝、取消、旧工程上下文、活跃 watch 拒绝和损坏私密 JSON 不回显密码 |

UI 运行摘要为 `9013fe230df8872061a7f2a707c542f9f3e2551a1e38bdb13791e26dde4691c8`。随后增加配置生成能力，配置/热补丁运行摘要为 `4e3f8d2b8b1f13eb7ac84237d377c3576e4ddf365021be2fd80ad2a03ff7a14b`；不把不同快照描述为同一份二进制。

真机验收之后补充热重载与录制的协调检查，运行摘要为 `348c98d51d8593704d1b32bec8e7a4645d6071c9ad5bd2b4349c53894c3df7b4`。本机 `20260908-signing-regression-6/evidence.json` 的 227 项回归通过，包括另一个 Node 进程在构建期间创建录制、安装前重新核对、补丁拒绝、其他设备隔离与 watch 清理；SDK/设备操作在这项竞争回归中使用模拟实现，没有再次操作手机。

首轮 [CI 34180595865](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34180595865) 验证提交 `957a84b`：macOS/Linux × Node 22/24 四组各 226 项通过，Windows 两组各 225 项通过、1 项失败，两组进程压力检查仍各 20 轮通过。失败是新增 Profile 测试使用 `RUNNER~1` 短路径作为期望值，而生产代码返回规范化长路径；测试改为与生产边界一致的 `realpathSync.native`，没有放宽文件内容和摘要断言。六组原始证据下载保存在 `ci-34180595865`，失败不由后续成功覆盖。

修复后的 [CI 34181035610](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34181035610) 验证提交 `0fc8c2b`：macOS/Windows/Linux × Node 22/24 六组各 227 项通过、0 跳过，各 10 项干净编译包安装检查通过，Windows 两组各 20 轮进程压力检查通过。六组证据已下载至 `ci-34181035610` 并逐项核对，运行摘要均为上述 `348c98d…`，与本机 `20260908-signing-regression-8/evidence.json` 及性能复测一致。CI 验证基础运行和模拟 SDK/设备回归，不代表在 Windows/Linux 完成了真实工具链、云端签名或手机验收。

同版本目录与离线 UI 查询复测记录见 `docs/native-ui-performance.md`；单独保留首次查询加载成本，没有把已缓存查询或下列两次设备样本代替完整性能门槛。

本轮单次 watch 基线 5.55 秒，两次热补丁分别 1.67/1.50 秒，最终 UI 断言另计约 1 秒。这是专用小工程的单次耗时，不是 P95 性能门槛或旧版对比。

## 本轮发现与修复

1. 调试 Profile 默认误用 `real` 路由；对照官方自动签名调用改为 `test`，实际下载成功。此前请求失败记录保留，最早一次未保存 HTTP 状态，不反推其具体原因。
2. 成功调试 Profile 响应可能没有 `id`，旧校验误报参数错误；按测试 Profile 语义接受并明确不可按 ID 删除。每次不明确结果先核对个人团队完整列表，再决定后续操作。
3. SDK `verify-app` 缺少必需输出参数导致失败；补齐并核对提取摘要与私有目录清理。
4. 真实 UiTest 的应用窗口根为 `root`，之前只识别 `WindowScene`，导致录制入口等待失败；统一浅层窗口识别，并拒绝把深层普通 `root` 控件当窗口。
5. UiTest 点击成功返回 `No Error`，之前被非空输出判断误报失败；现在仅接受空标准输出或完整成功短语，混合错误及异常标准错误仍失败。物理动作成功但回执误判的旧录制已取消，没有盲目重复点击。
6. 云端 HTTP 错误现在保留状态和请求/下载阶段，及时取消失败响应流，不保存授权 URL、响应正文或 Token。
7. 热重载入口遗漏了持久化录制检查，可能在录制期间安装或应用补丁；现在取得设备租约后重新核对录制状态，覆盖构建期间新开始录制的竞争窗口。停止 watch 仍可执行。

早期 UI 验收的窗口失败、成功回执误判和其他任务切换手机前台造成的定位失败均保留在 `20260908-canary-ui-1` 至 `-4`。成功结果来自独立的 `-5`，没有覆盖旧证据。

## 清理与剩余门槛

专用应用已卸载，并通过成功、未截断的完整应用清单确认包名不存在，结果保存在 `20260908-hot-device-1/cleanup.json`。专用证书已按记录的精确 ID 删除，随后读取个人团队完整证书清单确认 ID 不存在。调试 Profile 未返回远程 ID，清理标记为不适用，没有调用 Profile 删除接口。私有本地材料仅作验收追溯保留，不作为用户业务工程签名配置。

仍需覆盖真实签名操作中断后的外部状态核对、过期认证刷新、更多签名类型、多包部署、其他 SDK/设备平台及完整性能采样。根包已使用 `dist/src/cli.js`，旧源码入口已删除；当前宿主配置升级、新安装及应用内重连已确认。历史通过不等于当前版本的全部场景已验收，未经用户认可的 5% 相对性能阈值不作为发布阻断。

## 多模块热补丁验收

`hot_reload.start` 可选择 entry、feature、shared 模块。新 watch 构建并安装完整的签名 HAP/HSP 集合；所依赖的应用 HSP 必须包含在模块选择中。HAR 改动传播到消费模块，模块根目录中的 ArkTS 文件也参与检测。后续 HQF 保留本次 watch 累计改动，并为整组分配相同版本号；撤回某个源文件的修改不会丢弃其他已应用修改。

已通过的隔离多模块签名夹具可复用以下检查。最后一个参数的设备 UDID 必须与原个人签名准备一致；脚本操作界面并在结束时恢复它修改的三个源文件。

```sh
node dist/scripts/native-hot-multimodule-acceptance.js /absolute/new-hot-evidence /absolute/passed-multimodule-evidence /absolute/signing-preparation /absolute/signing-evidence DEVICE_ID
```

同组 HQF 的版本字段约束参见[华为打包工具说明](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/packing-tool)。当前真机范围仍为上述 macOS/Node24/SDK26 环境，详见完成清单。
