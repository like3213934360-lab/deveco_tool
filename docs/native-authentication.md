# 原生认证与云端只读验收

更新：2026-09-08。新 MCP 通过 `harmony_auth` 直接完成浏览器认证，运行时不启动官方 CLI 或 CodeGenie 子 MCP。开发者服务与知识服务使用不同的 provider、应用 ID 和加密凭据。华为授权页面显示的应用名称仍由华为服务决定；页面中的“DevEco CLI”“DevEco Code”不表示本地启动了这些程序。

## 本次发现与修复

1. **POST 回调遗漏。** 旧的新架构实现只接收 GET，但官方当前回调支持 URL 编码的 POST 表单。已增加有界表单读取，保留 nonce 常量时间校验，并验证回环 Host、方法、路径、内容类型与重复参数。表单最大 64 KiB，请求读取最长 10 秒；失败请求不消费有效登录，重复成功回调不再次交换 Token。
2. **浏览器结果页显示失败。** POST 修复后，后台已完成登录，但受控 Chrome 对原来的纯文本回调页仍显示 `ERR_BLOCKED_BY_CLIENT`。改为真实 HTML 状态页及准确的 Content-Type 后，Chrome 正常显示。错误响应同样声明类型；页面不含 Token、nonce 或账号标识，设置 no-store、no-referrer 和限制性 CSP。页面只说明“回调已接收”，最终认证结果仍以 MCP 状态为准。没有更改浏览器安全设置。此结果证明本次显示问题已解决，不据此推断所有同名 Chrome 错误的原因。
3. **设备清单字段错误。** 真实云端响应使用 `totalCount`，实现误读 `total`，导致三个团队的设备查询均报参数校验失败。按实际协议修正，并检查分页重复、空页未完成、数量变化和超出声明总数。非法远程清单返回 `SIGN_CLOUD_RESPONSE_INVALID`，不再误报为用户参数错误。不兼容读取错误的旧字段。

取消授权现在立即返回 `LOGIN_CANCELLED`，无需等待五分钟超时。`harmony_auth.status` 的 `callback` 只记录 received/rejected/accepted 和固定拒绝代码，不记录请求正文、URL 或凭据。这些字段用于区分请求未送达、参数被拒绝和回调已接收；不能代替 `logged_in` 判断。

协议对照使用本机安装的官方 CLI 1.3.1 回调及设备查询代码；仅用于开发核对，不加入新运行依赖。行为回归见 `test/native-auth.test.ts`、`test/native-cloud-inventory.test.ts`。

2026-09-09 对照冻结旧版的登出竞争回归，补齐两个边界：本实例登出立即中止该 provider 的刷新请求，其他实例登出通过每 200 ms 的凭据修订核对中止请求；迟到响应仍须通过修订核对才能保存。并发强制刷新在共享 SQLite 租约内比较排队前后的密文字节，复用刚完成的刷新结果；后续独立强制刷新仍会访问服务。取消一个排队请求不取消其他调用，关闭认证服务会先中止刷新并等待清理，然后清除内存密钥。

本机 Node24 的 12 项认证专项回归已通过，包含 developer/codegenie 两个 provider 的本地和对等实例登出、并发强制刷新、独立取消及关闭清理。这里使用可控云端响应验证竞争窗口，不属于真实过期 Token 的云端验收。当前完整快照回归和三平台复验仍待完成。

## 真实验证结果

下列最终成功证据的运行文件 SHA-256 均为 `a98fa378c5fe9aa447f1ae02c02bf4a245e990eed6160599fe3efb9c75dad3e4`。运行环境为 macOS arm64、Node 24.14.1，使用 `native-stage.ts` 创建的干净原生目录，已安装依赖中没有官方 CLI、子 MCP 或 Skill。验证走实际编译后的 MCP stdio → Worker → 认证/云端服务路径。

| 验证 | 结果 | 原始证据 |
| --- | --- | --- |
| Chrome 开发者登录 | 9 项通过；有效 POST 回调、三个团队的证书/设备清单、Worker 重启、服务器进程重启、重启后清单、provider 分离与关闭 | `~/Library/Application Support/DevEcoMCP/acceptance/20260908-browser-4/evidence.json` |
| 已保存开发者凭据 | 9 项通过；从前次加密状态重新启动 MCP，且开发者登录不能用于云端知识请求 | `~/Library/Application Support/DevEcoMCP/acceptance/20260908-developer-persistence-1/evidence.json` |
| Chrome CodeGenie 登录与知识查询 | 9 项通过；独立浏览器登录、真实云端查询、两种重启、重启后查询及 developer 未登录 | `~/Library/Application Support/DevEcoMCP/acceptance/20260908-codegenie-1/evidence.json` |
| 云端知识完整制品 | 10 项通过；从已有加密状态启动 MCP，按字节分页读取真实大结果，重启后读取原制品并核对完整摘要 | `~/Library/Application Support/DevEcoMCP/acceptance/20260908-codegenie-artifacts-1/evidence.json` |
| Node 24 全量回归 | 220 通过，0 失败、0 跳过 | `~/Library/Application Support/DevEcoMCP/acceptance/20260908-auth-regression-node24-1/evidence.json` |
| Node 26 开发环境回归 | 220 通过，0 失败、0 跳过；不替代 Node 22/24 发布矩阵 | `~/Library/Application Support/DevEcoMCP/acceptance/20260908-auth-regression-node26-2/evidence.json` |
| Node 22/24 三平台 CI | 六组各 220 项通过、0 跳过；各 10 项干净编译包安装检查通过；Windows 两组各连续 20 轮进程压力通过 | [CI 34176653392，提交 8ec532b](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34176653392)；下载证据位于 `~/Library/Application Support/DevEcoMCP/acceptance/ci-34176653392` |

原始失败记录同目录下保留：`20260908-browser-1`、`20260908-browser-2` 是登录超时；`20260908-browser-3` 已接收 POST 并保持认证，但设备清单字段校验失败。前两轮没有回调计数，不能据此断言网络请求完全没有到达。新的计数及分阶段证据避免这种归因歧义。

开发者清单初次/重启后整轮约 518/547 ms，CodeGenie 查询约 2740/2624 ms，MCP 握手约 85–86 ms。这只是两次真实观察，包含云端网络耗时，不是 P95 性能验收或浏览器扫码耗时。

补充验证中，第一次云端结果为 1,393,331 字节、969,276 个 UTF-16 代码单元，通过 43 页读取完整内容，严格 UTF-8 解码后与内联前缀匹配。原制品在两种重启后保持相同 SHA-256。再次查询返回的完整内容不同，验证没有要求两次云端检索相同，只核对同一已保存制品没有改变。证据只保存长度、页数和摘要。

本轮只读取账号、团队、证书和设备清单并查询知识，未创建/删除云端证书、Profile、注册设备或安装签名包。独立签名工程和本地密钥已准备，见 `docs/native-signing.md`。云端变更、完整签名部署、过期凭据真实刷新、不同平台浏览器行为仍需独立验收；不能把本轮认证通过计作签名能力全部完成。

## 复现

先准备新的原生验证目录并安装锁定依赖、编译。以下命令在该目录运行，证据目录必须尚不存在：

```sh
node dist/scripts/native-auth-mcp-acceptance.js /absolute/new-developer-evidence developer
node dist/scripts/native-auth-mcp-acceptance.js /absolute/new-codegenie-evidence codegenie
# 重用已有加密状态，只读复查，不重新发起浏览器登录：
node dist/scripts/native-auth-mcp-acceptance.js /absolute/new-restart-evidence developer /absolute/prior-evidence/state
```

首次运行只输出公开登录入口及一次性 nonce，由浏览器完成授权；不要记录回调 URL、临时 Token 或认证响应。证据只保存检查结果、计数、摘要和运行文件身份。凭据保存在专用 state 目录内，不提交 Git。五分钟未完成回调则本轮失败，需要重新发起登录，旧 nonce 不复用。

登录启动也纳入同进程合并：并发调用共用一个回调端口，登出和关闭会中止并等待尚在建立的监听器；关闭后不再接受新登录。新增双提供者各十个并发调用及启动期间登出/关闭回归，当前认证专项共 16 项通过。旧实现曾可复现两个并发调用产生两个端口。冻结版本 `native-6-login-lifecycle-dev-10` 已通过完整 349 项回归；实际 MCP 补充驱动通过两提供者各十个并发调用、真实 POST 取消与监听器关闭，以及未缩短的五分钟回调超时。此范围不包含真实过期云端凭据和 Windows/Linux 浏览器行为。


浏览器启动失败现在在待登录状态中返回 `browser_status: "manual_required"`、错误码和仍有效的 `login_url`，用户可以直接在 MCP 所在电脑打开地址；失败不关闭五分钟回调窗口。`open_browser:false` 也明确返回手动打开状态，完成/注销后不再返回旧链接。旧版 `deveco_login` 的 APP_ID 为 1008，应迁移到 `provider:codegenie`；旧 `wait_ms` 已删除，登录不是工作流，不能指向 `workflow_run.wait_ms`。此修正后的最终冻结版本仍需验收。
