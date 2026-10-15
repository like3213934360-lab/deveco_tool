# v1.4.10 MCP 契约与调用可靠性修复

2026-10-15，基线 `e63da2f96a60029aecc4b06a222f0a3f2d11fba1`。按项目级 mcp-builder 的协议、参数、错误、上下文和验证要求审查后完成八项修复；保留独立 stdio MCP，没有引入 SDK 框架、运行依赖或自动 Skill 分发。用户提供的 DSH 实测报告是修复输入，本页的新版验收均另行执行。

## 八项问题与覆盖

| 问题 | 根因修复 | 正式回归 |
| --- | --- | --- |
| 注解低估写操作和外部交互 | code/knowledge 不再标为只读；openWorld 按工具能力声明，默认 true，仅 code/diagnose 为 false | integration/server 的实际 tools/list 全量检查 |
| 只读 shell 允许写参数 | 区分纯查询程序与兼具读写能力的程序；后者仅接受明确查询形式，先校验再解析设备 | unit/domains、integration/server；真机只读契约 |
| 模拟器丢弃退出码 | 非零退出和终止信号直接失败，额外识别退出 0 的 SDK 错误；移除掩盖失败的列表重试/停止预检吞错 | integration/emulator、lifecycle、start-create |
| 无效文件列表扩大检查范围 | 省略 files 才扫描工程；显式空列表或任一无效成员原子拒绝；不混合 ArkTS/TypeScript 和 C/C++ | unit/efficiency、integration/server、真实 checker 范围验收 |
| 签名误将 product 当配置名 | 共用产品选择，沿 product.signingConfig 查材料；配置缺失、字段不全、解密失败分别报告，不自动创建新材料 | integration/signing、sign-auto；真实 SDK phone→debug 签名/验签 |
| 诊断截断且范围易误读 | 保留根文件数，新增有界 scope 统计；全部诊断保存 report_artifact；构建预检保留该报告 | integration/jobs；真实 61 条额外文件诊断及分页/grep |
| 声明未实现的旧协议 | 只声明 2025-06-18；其他请求协商到该版本，不再声称支持要求批处理的旧协议 | integration/protocol，协商/批处理拒绝/后续连接可用 |
| 调用信封错误被吞成默认输入 | 在调用前验证 name 和 arguments 类型；未知工具返回 -32602；工具字段错误仍为可纠正的 isError 结果 | integration/protocol、server |

协议依据：[2025-03-26 批处理要求](https://modelcontextprotocol.io/specification/2025-03-26/basic#batching)、[2025-06-18 版本协商](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#version-negotiation)、[工具错误边界](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling)。仅支持旧协议的客户端需要升级或拒绝本服务器协商结果；没有添加兼容转发层。

## 已确认的易用性问题

- SQLite 使用 `db=app.db` 时必须同时传 bundle 和实际 module（如 default）；省略 module 在设备调用前说明修复方法。绝对 db 路径仍可使用，完整引用后不会被空格拆成 sqlite 参数；失败报告实际路径。
- 签名支持工程引用或完整显式材料。DevEco 自动签名可能让构建成功，但不会因此让 MCP 获得工程内未声明的材料；错误不再把 `sign auto` 说成唯一补救，不擅自改工程或创建云资源。
- 模拟器 scenario 使用实例 name；创建前按真实 SDK 规则校验 1–60 位 ASCII 字母、数字、空格、下划线和加号，不允许连字符或空白名。
- deveco/atomcode/dsh 的 Skill 支持与 MCP 注册支持分开说明，未支持的注册宿主得到手动配置提示。没有凭空新增 DSH 配置适配。
- knowledge 的可更新提示不是缺陷，本轮未更新用户知识库。按用户要求提交 `.agents/skills/mcp-builder/`，仅由用户管理项目级 Skill，不纳入运行时分发。

## 本地验收

环境为 macOS、Node v26.0.0、DevEco Studio 26.0.0.821、SDK 26.0.0.105（API 26），只读设备检查使用用户的 USB Pura 80 Pro。SDK 构建复用已有专用 FullProbe 工程；检查器另建专用夹具；不改用户应用、签名配置或知识库。

本地明细及构建指纹见 [脱敏证据](evidence/v1.4.10-local.json)。原始日志、初始化/工具列表和 MCP 调用记录留在忽略的 `.scratch/release-1.4.10-20261015/`。首次离线运行因提示语精简破坏既有指导约束失败，恢复关键说明后保留原断言与 36 KiB 预算通过；原失败日志保留。

| 检查 | 本轮结果 |
| --- | --- |
| typecheck、build、npm pack dry-run | 通过；打包 295 项，不含项目级 Skill，不执行 npm 发布 |
| 离线回归 | 256/256，失败/取消/跳过均 0，16.229 s；基线 235 项、16.076 s |
| SDK / LSP / C++ 与模板工程 | 31/31 + 19/19；26.417 s + 29.281 s |
| 最终构建契约验收 | 3/3，4.077 s：61 条诊断完整读取、真机只读参数、phone→debug 实际签名及验签 |
| 性能与提示说明 | 握手中位 93 ms；空闲 RSS 71 MB、10 秒 CPU 不变；15 工具、tools/list 36,832 字节（上限 36,864） |
| 上游门禁 | 503 项：374 full / 83 host / 46 skip；partial、undecided、invalid、stale、新提交均 0 |

没有删除既有用例或调整测试门限。新增三个按能力命名的离线集成文件，扩展既有协议、任务、纯规则和真实验收套件，全部通过现有 Node 测试入口执行，见 [测试指南](../test/README.md)。

## 上游与未验证边界

上游新增条目按实际源码审查。CLI clean 新增的 modules 与 hvigor execution mode 不映射到现有 buildMode；本 MCP 的 clean 保持整产品清理，不暗中扩展为模块清理。

已审查 Code 到 `f535194ff`、CLI 到 `78b122b`。上游图片比较和 UI 组件识别实际调用宿主另配的视觉模型，归宿主视觉/文件能力，不冒充当前像素比较的覆盖；文本模型不具备该能力。D2A Skill 依赖宿主控制器、Anchor/Pixso 等，仍由用户管理，不自动导入。逐提交审查和边界见 `tools/upstream/decisions.json`。

本轮未重跑完整 DSH/其他宿主模型自主调用、模拟器镜像增删、云签名创建删除、热重载、媒体与全量 UI 套件。离线模拟器退出状态回归和 SDK 名称校验不能代替完整模拟器生命周期验收。历史云配额、镜像、性能和 Windows 原子写入问题仍保持原记录。

GitHub 发布、npm 发布、宿主重载分别核验。本轮不执行 npm 发布或重启宿主；独立 stdio 的新版通过不代表已打开的 Codex App/DSH 已加载新版。

## GitHub 交付

按 [发布流程](RELEASING.md) 推送后，继续核对全部 CI、release 工作流、不可变 tag、Latest 和 verified-release 回执；完成后回填本节和 TODO。最终文档提交的独立 CI/回执链接列在交付回复，避免自引用提交循环。
