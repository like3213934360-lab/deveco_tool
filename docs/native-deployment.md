# 原生构建和包集合部署

执行协议为 `native-3`，没有旧单包参数别名或历史状态解码器。

`workflow_run.start` 的 `app_deploy` 输入示例：

```json
{
  "action": "start",
  "workflow": "app_deploy",
  "request_key": "install-review-1",
  "input": {
    "packages": [
      { "path": "/absolute/entry-signed.hap" },
      { "path": "/absolute/shared-signed.hsp" }
    ],
    "target": "device-id",
    "app": {
      "bundle_name": "com.example.app",
      "module": "entry",
      "ability": "EntryAbility"
    }
  }
}
```

每个包可提供 `sha256`。提交时顺序流式复制 1–64 个包到任务制品，固定摘要；等待设备租约后重新校验。部分捕获失败会释放此前的临时副本，并发重复提交会释放未绑定的副本。包集合必须属于同一应用版本、模块名称不重复、类型和扩展名一致，并且能唯一定位启动 Ability。

单包直接调用 HDC。多个包传输到本次操作独占的设备目录后，通过一次 `bm install -p` 安装，使 HAP/HSP 依赖同时可用。不会把多个主机路径传给 HDC 后误记成一次原子安装。传输未确认时不开始安装；安装和启动各自保存操作回执。丢失启动回执后恢复不会再次安装。安装命令状态不明时保留设备临时目录并记录待清理事件，等待核对。

`project_build` 默认根据任务选择模块类型：`assembleHap` 选择 entry/feature，`assembleHar` 选择 har，`assembleHsp` 选择 shared。显式指定不支持任务的模块会报错。HAR 由 Hvigor 按依赖编译，不作为设备安装包。

`build_deploy_verify` 构建所选 HAP，从实际编译包的 `module.json` 读取共享依赖，继续构建本产品的 HSP 及其传递依赖，随后捕获签名包。外部共享 bundle 或缺少本产品源码的依赖会明确报错；不推测其安装状态。

本机真实 SDK 的四模块（entry/feature/HAR/HSP）、双产品验证包括默认任务筛选和 HSP 依赖补全。它没有执行签名或设备安装，多包设备安装与业务最终断言仍须单独验收。
