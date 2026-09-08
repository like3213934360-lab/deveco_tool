# 原生签名验收

更新：2026-09-08。当前完成本地准备和云端只读认证；云端证书、Profile 变更及签名部署尚未验收。浏览器与认证证据见 `docs/native-authentication.md`。

## 可复现的本地准备

在干净原生验证目录中执行：

```sh
node dist/scripts/native-signing-prepare.js /absolute/new-preparation-directory
```

`native-signing-prepare.ts` 根据实际 SDK 元数据，用项目创建和构建工作流生成独立工程，校验未签名 HAP 的包名、模块和 Ability，再调用 SDK 签名工具生成密钥与 CSR。目录必须尚不存在，应用包名及云端候选资源名称带随机标识。此步骤不需要选择团队，也不操作云端或设备。

工程包含状态文字、中文输入框、确认按钮和回显文字，各有稳定组件 ID，供签名部署后的 UI 输入、最终断言、流程录制和热重载验证复用。

输出包括：

- `prepared.json`：包身份、工程路径、CSR 摘要和未签名制品。
- `evidence.json`：实际编译产物身份和六项执行结果。
- `validation.p12`、`validation.csr`：加密密钥库与公开证书请求。
- `signing.private.json`：本地签名密码、别名和密钥库路径，权限为 0600；不属于可共享证据，不提交 Git、不打印到日志。

## 本次准备结果

原始证据位于 `~/Library/Caches/DevEcoMCP/acceptance-projects/20260908-signing-1/evidence.json`，macOS arm64、Node 24.14.1，运行文件摘要为 `a98fa378c5fe9aa447f1ae02c02bf4a245e990eed6160599fe3efb9c75dad3e4`。

创建、构建、包身份校验、密钥、CSR 和关闭六项通过。专用包名为 `com.deveco.mcpacceptance.a65188f22`，证书/Profile 候选名称为 `MCPValidation65188f22`。未签名 HAP 为 24,545 字节，SHA-256 为 `b1b564e96a8423b2e667b340e47bae8c0e094156229ffa3d27c490858934994c`。这只证明本地准备成功。

## 剩余执行顺序

1. 明确选择账号下的团队；在该团队读取证书和设备清单，核对专用名称未被占用、连接设备与已登记 UDID 的对应关系。
2. 以本地 CSR 创建专用证书，记录远程 ID 与证书摘要；为专用包和目标设备创建调试 Profile，保存操作回执。收到不明确的副作用结果时先核对远程状态，不盲目重试。
3. 使用本地私密文件中的参数签名 HAP，验证证书、Profile 和最终包身份；通过部署工作流安装、启动并核对应用状态。
4. 在专用应用验证中文输入、最终断言、流程录制/重放及签名热补丁；签名成功或截图不能替代这些结果。
5. 根据本轮创建的精确资源 ID 清理专用云端 Profile、证书和设备上的专用应用，核对结果。若目标设备尚未登记，先明确登记的长期影响；当前没有设备删除入口，不承诺自动撤销登记。

现有项目和账号内其他签名资源不用于这一专用工程。本次尚未执行上述云端变更及设备步骤，仍受迁移发布门槛约束。
