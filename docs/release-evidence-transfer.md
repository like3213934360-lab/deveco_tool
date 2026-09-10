# 发布证据传递

本流程替代草稿 Release asset 和临时公开 prerelease 中转。正式发布仍由 `release.yml` 的 `release` environment 控制；证据导入没有 Release/tag 写权限。

公开仓库的 Actions artifact 不是秘密存储：登录且具有仓库读取权限的用户可下载。因此仅传输 AES-256-GCM 密文；解密密钥不放入 archive、artifact、命令参数或日志。参见 [GitHub artifact 下载权限](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)。

```mermaid
flowchart LR
  A[本地最终报告与分发目录] --> B[release gate + 白名单文件清单]
  B --> C[证据 ZIP + SHA-256]
  C --> D[AES-GCM 加密 + 密文摘要]
  D --> E[专用临时 runner 导入精确文件]
  E --> F[不可变密文 artifact 保留 7 天]
  F --> G[托管 runner 解密 解包 重新 gate]
  G --> H[成功运行的六项精确选择值]
  H --> I[release gate 核对运行 身份 文件 摘要]
  I --> J[同次运行的分发 ZIP + acceptance receipt]
  J --> K[release environment 正式发布]
```

## 一次性配置

管理员需要配置以下环境；此维护变更不会自动创建 runner、secret、环境或远端运行。

1. `release-evidence-import`：只允许默认分支，启用环境保护。配置变量 `RELEASE_EVIDENCE_INBOX` 为专用 runner 的绝对目录。
2. 专用 Linux x64 临时 runner：标签 `release-evidence`，预装 Node 24，运行器至少 2.329.0 并保持受支持更新。限制 runner group 只服务受信任的导入工作流；禁止 PR 作业、共享开发机、SDK、设备连接、云凭据和解密密钥。必须每次作业后销毁整个实例和 inbox，包括取消、失联或强制停止。导入 job 不 checkout、不安装项目依赖，只读取一个经摘要寻址的密文文件，随后调用官方 upload-artifact Action。
3. `release-evidence`：只允许默认分支，启用环境保护，将本地保管的 32 字节密钥以 64 位小写十六进制存为 `RELEASE_EVIDENCE_KEY` secret。该环境用于托管 runner 的验证和正式 gate。
4. `release`：保留正式发布审批。只有 publish job 有 `contents: write`，该 job 不安装 npm 依赖。

完整提交 SHA 固定 Action；`setup-node` 的自动 package-manager cache 显式关闭。任何 workflow_dispatch 输入都经环境变量传入，不直接拼入脚本。分支、仓库与工作流身份校验不能代替 runner/environment 的配置隔离。参见 [GitHub Actions 安全配置](https://docs.github.com/en/actions/reference/security/secure-use)。

## 每次提交的操作

使用受支持 Node 22/24。准备 `/private/final-evidence/release.json`，引用最终编译身份的六矩阵回归/安装、专项验收、性能、长稳和分发目录。原有 scope 只适用于其声明版本；本轮的 maintenance-scope 不是发布授权。

```sh
npm ci
npm run build
node dist/scripts/release-evidence.js prepare /private/final-evidence/release.json /private/evidence.zip
```

`prepare` 先执行完整 release gate，再打包 manifest 闭集；不递归复制状态库、凭据、相邻日志。它返回 ZIP 摘要，并写入 `.sha256` 文件。仍需审阅报告中的业务内容。

从本地秘密管理器将同一密钥注入 `RELEASE_EVIDENCE_KEY` 环境变量，然后执行：

```sh
node dist/scripts/release-evidence.js encrypt /private/evidence.zip /private/evidence.enc "$EVIDENCE_SHA256"
unset RELEASE_EVIDENCE_KEY
```

命令仅返回明文和密文摘要。不要把密钥值写进终端历史、仓库或工作流输入。将**密文**通过管理员管理的安全通道放入临时 runner 的 `INBOX/<最终提交完整 SHA>/<transfer_sha256>.enc`。inbox 必须随该临时实例销毁。工作流不提供通用远程文件上传服务，也不要求长期 PAT。

在默认分支的同一最终提交上派发 `release-evidence.yml`，提供 `transfer_sha256`、`evidence_sha256`。导入后，托管 runner 下载精确 artifact ID、核对密文摘要、认证解密、核对 ZIP 摘要、逐项安全解包并执行 release gate。只有全部成功才在运行摘要中输出：

| release.yml 输入 | 绑定内容 |
| --- | --- |
| `evidence_run` | 已成功的 release-evidence workflow_dispatch run ID |
| `evidence_attempt` | 该运行的成功 attempt |
| `evidence_artifact_id` | 此 attempt 上传的不可变 artifact ID |
| `evidence_artifact_digest` | artifact 服务外层 ZIP 的 SHA-256 |
| `transfer_sha256` | artifact 内 evidence.enc 文件的 SHA-256 |
| `evidence_sha256` | 解密后证据 ZIP 的 SHA-256 |

三个摘要对应不同字节，不能互换。`release.yml` 校验仓库与 head_repository 的 ID/名称、默认分支、最终 SHA、工作流路径、事件、成功状态、run/attempt，以及 artifact 的 ID、精确名称 `release-input-<run>-<attempt>`、摘要、未过期状态和所属运行。不存在“最新”选择或名称通配下载。

正式 gate 再执行 upstream/release 检查并生成分发 ZIP、`.sha256`、白名单 `acceptance.json`。publish 只下载自己 gate job 输出的 artifact ID；独立核对三文件集合、普通文件类型、ZIP 摘要、receipt 摘要、版本及通过状态，然后才调用正式 Release API。已有版本拒绝覆盖。

## 失败、取消和保留

| 路径 | 确定行为 |
| --- | --- |
| 导入前失败/取消 | 无 artifact，后续 job 不运行；临时 runner 由外部生命周期销毁 |
| 上传后验证失败/取消 | 仅有密文 artifact，最长保留 7 天；失败/取消运行不允许被 release gate 接受 |
| 解密/解包失败 | 认证或全部内容 hash 校验失败时不发布文件；中途写入失败删除本次创建的解包目录，保留既有目录及链接 |
| 验证成功 | 摘要中给出六项输入；明文 ZIP、解包目录和 gate receipt 由 `always()` 清理 |
| gate 失败/取消 | publish 依赖失败而停止；明文同样清理；不会创建中转 Release/tag |
| runner 硬终止/失联 | `always()` 无法保证执行，依靠托管 VM 销毁或管理员配置的临时 runner 销毁；远端只残留到期自动删除的密文 |
| 正式发布成功 | 只公开受门禁验证的软件 ZIP、摘要和白名单凭证；内部 accepted-release artifact 同样保留 7 天 |

需要重试时使用新临时 runner，并“重新运行所有作业”或新建 dispatch。只重跑失败 job 会使 run attempt 与旧导入 artifact 名称不同，后续 gate 将拒绝它。超过 7 天应重新导入和验证；不要绕过过期检查。

本流程不创建任何临时 Release 或 tag，因此中转成功、失败和取消均无公开资产需要手工清理。正式发布步骤是唯一的远端发布操作；若其 API 响应中断，应先只读核对最终版本和资产，禁止盲目覆盖或删除已有版本。此情形不使用临时 prerelease 作为补救。

自动回归见 `native-release-evidence`、`native-distribution` 和 `native-release-transfer`：归档路径/类型/大小/CRC/清单/hash、部分写入清理、GCM 篡改/密钥失败、精确运行选择、同次 gate 产物核对，以及工作流的只读权限、保留期、清理步骤和不可变 Action 固定。
