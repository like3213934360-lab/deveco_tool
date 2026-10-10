# v1.4.5 USB 真机工具验收

2026-10-10，继续使用用户选定的 USB HUAWEI Pura 80 Pro（LMR-AL00、API 26），逐项核对实际 `tools/list` 的 **15 个工具、102 个 action**。结果为 **80 项有真实成功证据、10 项受环境或测试对象限制、12 项尚未验证**。这不等于 102 项全部通过，也不代表所有参数组合、设备形态和模型都已覆盖。

本轮 11 个阶段共 **72 个用例通过、0 失败**，包含只读拒绝、取消后拒绝恢复、真实编译错误和实际启动崩溃等负例。最初脚本失败记录仍保留；下方解释修正原因，没有改产品代码或降低验收标准。`hot_reload.apply/reset` 的两项成功证据引用上一轮**同版本、同 USB 真机**的两轮原生验收，不冒充本轮重测。

## 运行来源与边界

- Codex App 原生 MCP 实际执行 doctor、新建工程、创建签名 profile、定点 LSP 复核；其余批量验收通过真实 stdio MCP 进程执行，使用现有 SDK、登录状态和指定 USB 设备。不是 mock，也不是模型拟调用方案。
- 原生与 stdio 均为 v1.4.5，build ID `44db485182694c582ba2e60e94a09673edf6dfbe12b555810c8dbe3c4cab9193`；运行代码对应发布提交 `ed0649aa03183c9824d3a38f49bd56cb30f116c2`。DevEco 26.0.0.821、SDK 26.0.0.105。
- 只修改本轮专用应用 `com.devecomcp.audit145` 的测试源码、数据库和安装状态。没有切换至网络连接或模拟器，没有修改系统设置、SDK、输入法偏好、宿主配置和原测试断言。复用用户指定团队的现有证书，不删除证书腾出配额。
- 最终恢复测试源码，卸载本轮专用应用，停止测试热重载 daemon，清理本轮设备传输文件；原生 `record_status` 为 idle。上一轮 `com.devecomcp.physical145` 仍在，未修改。
- [逐项 JSON 证据](evidence/v1.4.5-usb-full-audit.json)包含 action 来源、72 项结果、实际调用日志哈希、fixture 和脚本哈希。原始设备日志、签名材料、截图和视频保留在私有 `.scratch/physical-audit/`，不上传 GitHub。

## 全量 action 清单

“通过”表示表中对应路径实际成功，不把宿主或云端操作说成手机 API；“受限”表示当前环境无法覆盖，仍明确区分直接失败和未调用；“未验证”保持待办。

| 工具 | 真实通过 | 环境或对象限制 | 未验证 |
| --- | --- | --- | --- |
| doctor | 环境检查（无 action） | — | — |
| project | info、create、sync、build、clean | — | — |
| run | build_run、deploy、launch、stop、uninstall | — | — |
| job | wait、status、list、cancel、resume、read | — | — |
| code | check、lint、api_scan、api_versions、lsp、lsp_restart | — | — |
| device | list、info、log、shell、sqlite、send、recv | — | — |
| ui | observe、screenshot、tree、find、act、assert、windows、perf、visual、layout、record_start、record_stop、record_status、test_start、test_step、review、test_finish、test_log、test_export | — | — |
| ui_flow | list、show、record、stop、replay、delete | — | — |
| diagnose | crash、build | — | — |
| knowledge | search、read、catalog、status | — | update 的实际更新、rollback |
| skills | list、read、search | — | export、install_mcp、init、install、uninstall |
| auth | status、teams | — | login、logout、import |
| sign | sign、verify、certificates、devices、register_device、keypair、csr、profile_create | auto、certificate_create | delete_certificate、profile_delete |
| emulator | list、images、license_view（宿主只读） | start、stop、create、delete、install_image、remove_image、license、scenario（模拟器专用） | — |
| hot_reload | apply、reset（上一轮同机原生）；stop_daemon（本轮） | — | — |

`knowledge.update(check=true)` 实际通过且安装版本未变，不能代替下载替换的验收。已有登录不退出或覆盖；Skill 存放和更新由用户管理，本轮没有指定写入其配置。没有删除现有用户证书或 profile。新生成的 IDE 签名 profile 未返回可用于云端删除的 profile ID，因此不宣称 `profile_delete` 成功。

`sign.auto` 上一轮同机、同团队实际返回证书配额错误 205389872；`certificate_create` 本轮没有直接调用，仅根据相同配额条件列为受限。八项模拟器操作不适用于 USB 真机测试对象，不意味着这些 MCP 功能故障。原模拟器缺少视频编码器的正常能力边界不受真机成功影响。

## 关键效果证据

| 范围 | 实际验证 |
| --- | --- |
| SDK 与代码能力 | 同步、签名 HAP 构建、clean；ArkTS hover、definition、declaration、implementation、references、symbols、workspace_symbols、diagnostics、completion、signature、双向 call_hierarchy；真实 C++ 编译及 hover/definition；LSP restart |
| 生命周期 | 完整构建安装与页面断言、已有 HAP 部署后 then_flow；stop 后 pidof 为空，launch 后存在新进程；自动模式基线建立后严格要求 path=relaunch，HAP 哈希和 mtime、设备 installTime/updateTime 均不变 |
| 设备数据 | 65,536 字节随机文件双向传输 SHA-256 一致；SQLite 独立写入、读取和只读 DELETE 拒绝后记录仍在；日志时间窗与 cursor follow；完整 artifact 读取 |
| UI 操作 | 点击、双击、长按、swipe、fling、drag、scroll；鼠标点击、双击、长按、拖动、滚轮；mouse_move 额外用真实 onHover 的 entered/exited 页面断言证明效果；中英文、空格、引号和特殊字符输入、type、append、back；批量操作与最终断言 |
| 流程与视觉 | 流程录制、列举、读取、连续两轮回放及快照一致；删除后确认不存在。视觉基线先一致，点击后实际不同且有差异图，再更新基线后恢复一致 |
| 引导 | 原 `test/e2e/onboarding-page.ets` 原样安装至真机；三步引导自动完成，默认 theme=system 保留，orders=0，业务“下一步”未被误点；测试导出保留同样的引导记录 |
| 测试与人工视觉判断 | 实际 test_start/step；宿主查看返回截图后提交绑定图片 SHA-256 的判定；finish/log/export 与截图文件核对。缺失控件的负例使测试会话真实失败 |
| 诊断与任务 | 实际编译错误及源码诊断，修复测试源码后 resume 同一个失败 job 成功；运行任务取消后拒绝恢复；专用应用真实启动崩溃，LAUNCH_FAILED、设备 faultlog、Index.ets 源码和完整报告相互对应 |
| 签名 | 团队证书/设备查询和已有设备注册匹配；本地 PKCS#12 可解析、CSR 通过密码学签名验证；真实 SDK unsigned HAP 独立签名并验证包名，安装启动成功 |
| 录屏 | 最后一轮 MP4 为 217,268 字节、H.264、862×1920、68 帧、5.333 秒；ffprobe 逐帧统计，FFmpeg `-v error -xerror` 严格解码通过。服务 ACTIVE 没有被当作视频取回成功 |

性能验收要求真实 composer 帧数据、P95 和 FPS，不要求把应用跑成“永不卡顿”。两次真实采样分别为：447 帧、97.5 FPS、P95 16.67 ms、31 个卡顿帧（6.95%，minor_jank）；298 帧、108 FPS、P95 8.54 ms、13 个卡顿帧（4.38%，smooth）。两份结果都保留，不用后一次覆盖前一次。layout 检查 15 个控件；折叠屏 forms 未在真机冒测。

## 首次失败的根因

本轮未确认新的 MCP 运行代码缺陷；以下为验收脚本问题，原始失败日志保留，修正后的相关阶段已实际重跑。

- 返回字段误读（如 emulators、references），或向 action 传入不适用参数；无效请求被 MCP 明确拒绝。按现有工具契约修正调用，没有把错误当成功。
- completion 位置落在标识符前，SDK 正确返回空候选；定位到调用位置后，严格验证 `leaf(n: number): number`。真实 SDK 和原生 MCP 定点调用相互印证。
- EC 密钥库被无依据的 1,000 字节阈值误判。改用 OpenSSL 实际解析 PKCS#12、验证 CSR 签名，验证强度提高。
- 签名阶段复跑复用了已存在的输出文件，MCP 正确返回 CONFLICT、拒绝覆盖；改为每轮独立输出文件并复测，旧签名产物保留。
- 录制保存流程要求显式目标断言，最初未提供；补齐 Welcome 断言后验证录制、回放和部署后回放。
- 手动 `hot_reload=true` 和自动运行模式维护不同基线；首次自动运行完整部署是预期行为。通过真实自动运行建立前置状态，再严格核对不构建、不安装。
- 跳过安装的协议返回是 `installed:null`，不是 undefined；按真实契约修正精确断言，同时用包文件和设备安装时间独立证明没有重装。

## 复现与验收脚本

使用 `project.create` 创建全新的专用工程（bundle 前缀 `com.devecomcp.`），执行 `node test/audit/physical-fixture.mjs /absolute/new/project`。脚本沿用仓库手势、调用链、接口和 C++ fixture，只增加启动建表；数据库记录由 MCP 单独写入。该 recipe 在另一个新工程生成的七个文件已与实测工程逐项哈希比对一致。

由设备和证书所有者指定签名团队、有效证书、密钥及 profile，仅配置新工程。不要把私钥或密码写进公共日志。运行环境需具备 SDK、OpenSSL、ffprobe、ffmpeg 和当前已登录的服务。

```sh
export AUDIT_TARGET='<用户选定的 USB 序列号>'
export AUDIT_PROJECT='/absolute/new/project'
export AUDIT_DIR='/absolute/private/evidence'
export AUDIT_TEAM='<用户选定的团队 ID>'
node test/audit/physical.mjs host
node test/audit/physical.mjs sdk
node test/audit/physical.mjs device
node test/audit/physical.mjs gestures
node test/audit/physical.mjs flows
node test/audit/physical.mjs review
```

`review` 后须实际查看 `pending-review.json` 指向的图片，再写 `review-decision.json`，包含相同 test_id、review_id、image_sha256、outcome 和具体 reason。脚本不会自动批准截图；图片、会话或判定不一致均失败。之后依次运行 `review_finish`、`signing`、`jobs`、`variants`、`lifecycle`。最后阶段会卸载该专用应用。任何阶段失败均记录并非零退出，不以后续用例成功掩盖失败；每轮独立保存完整 trace。

## TODO

后续 [v1.4.6 补验](UPGRADE-1.4.6.md)已补齐其中 Skill、登录、知识库实际更新回滚、模拟器和 C++ 主要路径，并独立记录 OpenCode 结果。以下保留 v1.4.5 当时的证据状态，当前累计清单以新版文档为准。

- [x] 从实际 tools/list 核对 15 个工具、102 个 action，记录三类状态及来源。
- [x] 72 个最终用例实际通过；真实 UI、数据、诊断、视频和负例证据完整。
- [x] 初始失败逐项查因并复测；保存旧 trace，不放宽断言、不改系统环境。
- [x] typecheck、184/184 单测（失败/跳过均为 0）、上游门禁通过；491 项中 374 full / 74 host / 43 skip，未决/失效均为 0。
- [x] bench 通过：握手中位数 95 ms，空闲 RSS 71 MB，10 秒 CPU 不变；15 工具 36,848 字节、公共说明 1,737 字节。
- [x] 保持 v1.4.5：仅新增测试与证据，运行产物未变，不重发或移动已有 tag。
- [x] 验收提交 `2dddc85a4911d3def6442bfbd27943cd549e57b5` 已推送，七项 CI 全部成功；release 工作流与本地只读核验回执一致，v1.4.5 仍为 Latest。
- [ ] 12 项未验证操作：按上表保留，不将只读检查或未操作当成真实成功。
- [ ] 受限签名路径：证书配额具备后再验证 auto / certificate_create，不删除现有材料制造条件。
- [ ] 模拟器专用动作另按原模拟器环境验收，不用 USB 真机替代。
- [ ] OpenCode v1.4.5 真实模型复验；本轮 stdio 调用不证明其模型选择和连续工具调用效果。Claude 不在适配范围。
- [ ] 其他机型、Windows/Linux 真实 SDK、C++ 其他 LSP 操作、折叠屏等形态及音频/麦克风录制，尚无本轮证据。

## 交付回执

- 验收提交：[2dddc85a4911d3def6442bfbd27943cd549e57b5](https://github.com/like3213934360-lab/deveco_tool/commit/2dddc85a4911d3def6442bfbd27943cd549e57b5)，远程 main 与本地 SHA 一致。
- [CI 38055424573](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38055424573)：三个系统 × Node 22/24 的六项测试和上游门禁全部成功，无跳过任务。
- [release 38055487962](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38055487962) 成功；下载的 verified-release 与 `node tools/release.mjs --run 38055424573 --check` 输出逐字节相同，见[公开回执](evidence/v1.4.5-usb-release.json)。
- [v1.4.5 Release](https://github.com/like3213934360-lab/deveco_tool/releases/tag/v1.4.5) 保持 Latest，tag 仍指向 `ed0649aa03183c9824d3a38f49bd56cb30f116c2`。本次没有 npm 发布或宿主重启；当前原生 doctor 独立确认的版本与构建 ID 见上文。

本节是验收提交完成后回填的文档；后续同版本文档提交仍须完成自身全部 CI 和既有 Release 核验，不能复用旧提交的 CI 作为最终交付证明。
