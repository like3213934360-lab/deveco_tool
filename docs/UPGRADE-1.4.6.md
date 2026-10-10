# v1.4.6 剩余验收、登录修复与模型复验

2026-10-10，继续使用用户指定的 USB Pura 80 Pro（API 26）、个人签名团队和现有 DevEco 26.0.0.821 / SDK 26.0.0.105。补齐 Skill 写入、登录、知识库更新回滚、模拟器生命周期、折叠形态和 C++ LSP 验收，发现并修复登录状态及取消竞态。运行代码变化升级为 v1.4.6。

结合 [v1.4.5 真机验收](PHYSICAL-AUDIT-1.4.5.md)，15 个工具、102 个 action **累计 97 项有真实成功路径、2 项云端配额受限、3 项有效对象路径仍未验证**。这是逐 action 的累计证据，不代表本次在 v1.4.6 重跑全部旧用例，也不代表所有参数组合或所有模型都通过。详见[脱敏逐项证据](evidence/v1.4.6-remaining.json)。

## 修复与原因

- **登录状态**：原 `login_pending` 依赖“尚无旧凭据”，已有会话时新登录会错误显示不在等待。现按当前登录尝试的真实状态报告；旧会话仍有效与新登录尚未完成可以同时为真。原生 v1.4.5 已实际复现，v1.4.6 浏览器 SSO 多轮验证。
- **登录生命周期**：原逻辑复用已结束尝试的关闭回调地址；旧尝试的延时清理可能删掉新的尝试。现只复用正在等待的尝试，清理严格核对对象身份。
- **注销竞态**：原注销只关闭回调服务，已发出的换取令牌请求仍可能保存凭据。现取消该尝试的 HTTP 请求，等待其结束后删除凭据。延迟 HTTP 回归测试证明迟到令牌不能恢复登录。
- **成功声明**：浏览器回调原来在校验令牌前显示成功，现仅显示已收到、正在验证；工具说明要求 `login_pending=false`、`logged_in=true` 且无 error，不能只凭旧登录状态下结论。
- **模型说明**：明确 review 先取图、看图后提交真实 review_id，首次不带 outcome；在 hdc_port 字段重复整数范围及非法值先澄清要求。保留所有 action、默认值、参数约束与流程说明；其他修改为等义短句，原 36 KB 门禁不变。工具元数据 36,845 字节、公共说明 1,737 字节；字节数不是 token 数。

没有新增降级、隐式切换设备/模型/实现、自动 Skill 分发或 Windows NTLM。单测原有本地 HTTP mock 用来确定性验证竞态，不替代真实服务验收。

## 实际验收与恢复

| 范围 | 证据及边界 |
| --- | --- |
| Skill 写入 | 用户指定 `.scratch/remaining-audit/skills` 下独立目录；3 个内置 Skill 全部文件哈希一致；Codex/OpenCode 项目注册保留原条目、幂等、force；init、市场实际下载/安装/卸载及重复卸载拒绝。最终构建 7/7；全局宿主配置哈希未变。Codex CLI 能读取配置不等于 Codex 模型验收 |
| 登录 | 最终构建 3/3：已有会话的新登录仍 pending、注销后重新浏览器 SSO 登录、已完成尝试可立即新建、超过旧清理期限新尝试仍在、developer 凭据未变；有效 codegenie 会话已恢复 |
| 知识库 | 原生及候选 stdio 两轮实际下载更新、搜索/读取、回滚；原版本目录、指针与内容哈希恢复。不是仅 check=true；使用明确的官方上游源文件，不把注册表错误当成功 |
| 模拟器 | 两轮创建新折叠实例、原 API 26 镜像冷启动、实际屏幕尺寸随折叠改变、运行中删除拒绝、停止离线、删除；第二轮 8/8。单 name 与 names 单元素启动结果等价。license 仅证明已接受时的幂等，不冒充首次接受 |
| 镜像 | 原生实际下载此前未安装的 API 24 kidwearable 镜像（900,994,357 字节），确认 installed 后移除，恢复未安装状态；未替换原测试镜像 |
| 折叠布局 | 最终候选构建真实创建 foldable/widefold/triplefold，7 个状态全部检查通过，每态 12–14 个控件，保留截图和树；自动停止删除本轮实例，原有 7 个实例元数据相同 |
| C++ LSP | 最终构建 11/11 检查：声明、引用、文档/工作区符号、诊断、补全、签名、incoming、虚函数实现、outgoing 明确拒绝及源码恢复。直接请求 SDK clangd 同样对 outgoing 返回 method not found，属 SDK 不支持；无替代算法。旧证据另有 hover/definition |
| 参数等价 | 原 MCP 实际证明 tree 缺省 depth 与 0、静态检查相对/绝对路径、模拟器 name 与单元素 names 等价；这些独立证据不改写模型严格评分 |
| 本地检查 | typecheck；186/186 单测、失败/跳过均 0；上游 491 项，374 full / 74 host / 43 skip，未决、部分、失效均 0；握手中位 106 ms，空闲 RSS 72 MB，10 秒 CPU 不变 |

最终运行构建 ID：`a5f40b0c097887e8512d777956597e565eaa6babec72de4899befa0baa9ec226`。各真实 stdio 进程通过 initialize/doctor 或不可变 entry 固定来源；中间版本模型结果另列，不能转记为最终版本通过。发布时 Codex App 原生仍是 v1.4.5，随后用户自行重启；下方单独记录重启后的原生验收。

## 用户重启后的 Codex App 原生验收

2026-10-10，开始及结束两次原生 doctor 均确认 v1.4.6 和上述构建 ID。仍使用指定 USB 真机、原 SDK、个人团队和原 FullProbe 测试工程。当前对话由模型实际选择并执行 **78 次原生 MCP 调用，覆盖 15 个工具入口**；不是独立 stdio，也不是拟调用计划。它是带现有对话上下文的代表性流程，不是重新跑完 102 个 action 或与 OpenCode 完全同条件的盲测。详见[脱敏调用与检查证据](evidence/v1.4.6-codex-native.json)。

- **登录修复**：旧会话有效时新尝试仍为 pending；注销后凭据状态为未登录，真实浏览器登录恢复成功。完成的尝试可重新发起，等待 76,976 ms 后新尝试仍为同一尝试；最后再次浏览器登录，`logged_in=true`、`login_pending=false`，developer 登录仍有效。
- **工具与真机**：工程信息、知识库 catalog/status/search/read、Skill list/read、团队证书只读查询、模拟器清单、SDK TextInput hover、任务等待及报告读取通过。实际构建、安装、启动和 Hello World 断言通过；点击后 Welcome 断言通过；批量点击与中文输入、保存流程、补齐返回的必填变量后回放成功。原 tree/find/assert 顺序连续 3 轮、9 次调用通过，不能据此关闭旧 HDC 超时 TODO。
- **视觉与录屏**：review 首次只取图，模型实际查看返回图片后提交真实 review_id 和具体理由，finish/export 无失败或悬而未决的 review。MP4 实际取回 1,188,179 字节，H.264 862×1920、191 帧、39.018 秒，另有 AAC 音轨；只证明音轨可解码，不证明麦克风或声音内容符合预期。原 MP4 的 PTS 严格递增；FFmpeg 默认输出时间基 1001/60000 取整产生 10 处重复 DTS，退出码虽为 0 仍保留错误日志。使用 `-enc_time_base demux -fps_mode passthrough` 保留源时间基 1/90000 后视频严格解码无报错，AAC 独立严格解码也无报错，原文件 SHA-256 不变；没有重编码、修改原文件或忽略错误。工具 seconds 为录制会话经过时间，媒体时长以 ffprobe 为准。
- **reset 与清理**：原始基线包覆盖安装返回 `method=restore_baseline_packages`、`patch_version=0`，重新启动与页面断言通过。本轮未先启用补丁，不冒充一次新的“已启用补丁撤销”验收。最终卸载本轮专用应用、删除新增流程、录屏 idle、原流程和 7 个模拟器清单相同，登录已恢复；没有更改测试源码、SDK 或宿主配置。

**不记首轮全通过**：78 次调用中 72 次返回正常结果，5 次模型请求被拒绝，1 次 diagnose 查询明确返回最近 5 分钟没有该应用崩溃报告（预期缺少对象，不是成功取回崩溃报告）。5 次错误分别为 test_step/review 两次漏 target、test_step 混入 assert、replay 漏 input1、launch 混入 wait；纠正后原失败仍保留。源码 action 参数表严格拒绝跨动作字段，test_step 用顶层 visible/hidden，launch 不接受 wait；test_id 不会绕过多设备选择，流程输入默认抽成必填变量。合并工具 schema 与各 action 参数表的差异仍可能误导模型，不能只因纠正后成功就称模型可靠性已解决。

另发现自然语言 plan 的分句显示问题：`uitest.checklist` 把版本号 `v1.4.6` 中的句点也当句末，生成了碎片清单；原计划全文、实际步骤及最终断言仍保留。根因已定位，当前版本未修复，列入 TODO；没有改写原失败输入来冒充通过。

## OpenCode 多轮真实模型

见 [模型验收与根因](MODEL-AUDIT-1.4.6.md)和[逐轮脱敏结果](evidence/v1.4.6-models.json)。拟调用方案与真实 tools/call 分开；模型自称完成不是验收证据。所有原始失败、首次错误后纠正、超时和提供商错误均保留，未修改评分、超时门限或测试环境。文本模型不要求看图，也不据此宣称视觉判定通过。

## 尚不能勾选

- `auth.import`：真实旧库没有凭据行，实际调用仅返回 `imported:[]`，当前两种 provider 凭据哈希未变。有效旧凭据迁移仍未验证，不人工造旧凭据冒充现场迁移。
- `sign.auto` / `certificate_create`：实际云端拒绝 205389872，账户证书配额已满；后者本轮直接调用并确认清单未变。没有删除旧证书腾配额。
- `delete_certificate` / `profile_delete`：没有可丢弃、确定归本轮所有的云端对象；IDE profile 创建返回下载地址而非可删除的 AGC profile ID。不猜 ID、不删除用户材料。
- UI 查询的一次 HDC 30 秒超时：保留失败，单独跟踪诊断；恢复成功不能证明原失败根因已解决。
- 已启动 clangd 的文件刚改动后 implementation 曾返回空；绕过 MCP 直接向原 SDK clangd 发送 didChange + implementation，独立复现立即返回空、200 ms 后返回实现位置，磁盘源码未变。最终用例在启动 LSP 前准备完整 fixture，严格断言不变；不宣称 SDK 索引即时完成。
- 其他真机、Windows/Linux 实际 SDK、录屏音频/麦克风、首次 license 接受未验证。模拟器无视频编码器保持正常环境限制。

## 复现

沿用 [原真机 fixture](PHYSICAL-AUDIT-1.4.5.md#复现与验收脚本)，显式设置 `AUDIT_DIR`、`AUDIT_PROJECT`、`AUDIT_TARGET`。运行 `node test/audit/remaining.mjs <phase>`；支持 skills、auth、knowledge、emulator、equivalence、cpp。skills 还必须设置用户选定的绝对 `AUDIT_SKILLS`，否则写入前失败。auth 需要现有有效浏览器登录且会注销、重新登录 codegenie；knowledge 需要实际联网更新；emulator 创建专用临时实例。不要把这些变更环境的验收误作只读 smoke。

脚本保存每次 initialize、逐调用 trace 和用例结果；历史失败保留。OpenCode 修改其专用项目配置补充 `$schema` 是宿主行为，已分别验证宿主加载前后 MCP 注册幂等。C++ fixture 始终恢复原始字节。首次扩写说明触发原 36 KB 门禁，改为等义简写后通过，未提高上限；旧 review 描述断言更新为更严格的两阶段契约断言。服务器单测新增失败时也关闭客户端的清理钩子，断言没有删除或放宽。一次缺失 AUDIT_SKILLS 的启动在写入前拒绝，补齐用户已指定的目录后重跑成功。

## TODO

- [x] 剩余 Skill、登录、知识库真实更新回滚、模拟器生命周期/镜像路径补验；成功、限制和未验证逐项区分。
- [x] 登录根因修复及真实 SSO、多轮回归；补全模型关键操作说明。
- [x] C++ 和 7 个折叠状态实测；保留 SDK 能力及索引时序边界。
- [x] 本地类型、186 项单测、性能、上游门禁通过。
- [x] OpenCode 76 轮全部执行完成：48 轮拟调用、22 轮免费模型基础实际调用、6 轮最终 USB 调用；失败保留，未宣称全通过。
- [x] HDC 原 tree/find/assert 顺序连续复核 10 轮（30 个 UI 调用）通过，最大 1,136 ms；原失败仍保留。卸载本轮 audit145 应用，旧 physical145 仍在、原 7 个模拟器元数据不变、有效登录已保留。
- [x] 发布提交 `080de85dd14bad1f44dee2ff58a91df0d30c7e80` 已推送；七项 CI 全部成功；release 工作流、tag、Release、Latest 及本地只读回执一致。
- [ ] 原 HDC 超时具体根因：空输出且未捕获对应设备日志，暂不能确定；后续成功不等于已修复。
- [ ] 有效旧凭据迁移、云端配额具备后的创建、专用云端对象删除验收。
- [ ] 所有免费模型可靠完成全部工具场景：当前证据不满足，不能称为全绿。
- [x] 用户重启后两次原生 doctor 确认 v1.4.6；完成 78 次原生调用、15 个工具入口的代表性复验，保留 5 次模型错误，不宣称全部 action 或首轮全通过。
- [ ] 明确各 action 的字段适用范围、会话设备与流程必填变量提示，再验证模型首次调用可靠性；不放宽服务端校验。
- [ ] 自然语言 plan 分句保留版本号中的句点；当前清单碎片问题根因已定位，尚未修复。
- [ ] 其他机型、跨系统真实 SDK、录屏音频及首次 license 接受。

## GitHub 交付回执

发布提交 `080de85dd14bad1f44dee2ff58a91df0d30c7e80` 的 [CI 七项任务](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38059988470)全部成功，[自动 release 工作流](https://github.com/like3213934360-lab/deveco_tool/actions/runs/38060072753)成功。已下载 `verified-release` 制品，并与干净 checkout 中 `node tools/release.mjs --run 38059988470 --check` 输出逐字节比对一致；[公开回执](evidence/v1.4.6-release.json)记录 tag、发布提交和 CI。

[v1.4.6 Release](https://github.com/like3213934360-lab/deveco_tool/releases/tag/v1.4.6)已发布且为 Latest；tag 指向上述发布提交。同版本文档回执提交不移动 tag，也不重发 Release；其自身 CI 和 release 核验须另外完成。

没有执行 npm 发布。用户重启后的 Codex App 原生已确认 v1.4.6，实际验收证据见上文；它与此前独立 stdio 及 OpenCode 结果分别记录。本次后续提交仅补充文档与证据，不改变运行产物或既有 tag。
