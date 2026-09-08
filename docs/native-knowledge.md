# 本地文档和知识

使用 `harmony_knowledge`，默认 `source:local`，不安装或注入官方 Skill。`kind:rules` 查询规则、案例和示例；`kind:docs` 查询发布包中的官方文档。只有显式 `source:cloud, action:search` 才访问网络，使用独立的 CodeGenie 认证。

## 文档目录和分页

`action:catalog, kind:docs` 同时返回六个目录名称、中文标题、完整文档数量和一页文档条目。`catalog` 可为 `all` 或下列名称：

| 名称 | 目录 |
| --- | --- |
| harmonyos-guides | 开发指南 |
| harmonyos-references | API参考 |
| best-practices | 最佳实践 |
| harmonyos-faqs | FAQ |
| harmonyos-releases | 版本说明 |
| harmonyos-roadmap | 变更预告 |

`catalog` 同样适用于本地文档检索。无效目录，或将目录筛选用于规则、云端、正文读取，都会在参数边界被拒绝。

`action:search` 使用 `query`。本地文档查询最多接受 12 个空白分隔词；超过数量时明确拒绝。词按字面值构造 FTS 条件，标题包含查询全文的结果优先，再按文档 ID 稳定排序。目录条件同时用于标题和全文检索，去重、计数及分页在 SQLite 中完成。

目录和检索默认每页 50/20 条，最大 100 条；`offset` 为条目偏移，返回 `total` 和 `next_offset`。正文通过 `action:read, id:docs:<document_id>` 读取，默认 16384、最多 65536 个 UTF-16 代码单元；正文偏移使用相同单位。规则目录和检索也支持条目分页。没有恢复旧 CLI 的文本/JSON 输出分支或旧工具名称。

数据库以只读方式直接打开发布资源，正文按需从固定归档读取，单篇解压上限 8 MiB。资源版本、摘要与许可证在 `provenance/resources.json`，目录名称/顺序适配点在 `src/core/doc-catalog.ts`；相关上游源码变化映射到资源和目录检索回归。运行时不下载最新文档执行代码。

## 当前证据

`test/native-resources.test.ts` 使用真实发布资源验证六目录及数量、跨页无重复、中文与 API 查询、限定目录、正文拼接、未知 ID、特殊查询字符和规则分页；`test/native-reports.test.ts` 验证正文与条目不同的输入限额。

2026-09-08，本机全量回归 178 项通过，证据 `/private/tmp/deveco-native-regression-node26-20260908-21/evidence.json`。随后提交 `6f206053873ac962707ba8c9c8c4cde098abe278` 的 [CI 34161610703](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34161610703) 完成 Node 22/24 × macOS/Windows/Linux 六组验证，每组 182 项通过；文档资源筛选、分页和参数契约已计入。对应迁移项可按这组证据完成验收。这不包含真实云端登录/检索，也不声称复现官方 CLI 的完整排序算法或所有 SDK 文档版本。

后续已通过 Chrome 独立 CodeGenie 登录和真实云端查询。云端结果内联最多 16384 个 UTF-16 代码单元，更大内容由 `artifact.artifact_id` 引用，通过 `workflow_run` 的 `action:read_artifact` 读取。制品偏移和上限使用字节，内容以 Base64 返回；客户端应先拼接字节再解码 UTF-8，避免在分页边界拆坏中文字符。

2026-09-08 的完整制品验收读取了 1,393,331 字节、43 页，校验内联前缀和严格 UTF-8 解码，并在 Worker 和 MCP 进程重启后核对原制品完整摘要。原始证据为 `~/Library/Application Support/DevEcoMCP/acceptance/20260908-codegenie-artifacts-1/evidence.json`，十项通过。两次独立云端检索的全文可能不同，不把相同问题视为结果永远相同。此项不覆盖服务端过期错误、异常响应和性能 P95，详见 `docs/native-authentication.md`。
