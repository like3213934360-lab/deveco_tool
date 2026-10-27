# 鸿蒙测试执行要点

以下适用于 ArkTS／Stage 工程，Hypium 指 `@ohos/hypium`。

## 1. 运行环境与目录

- **Local Test**：在主机运行，测试放在模块 `src/test`；不支持直接测试系统 API 和 C/C++，命令行暂不支持 Linux。
- **Instrument Test**：测试放在模块 `src/ohosTest/ets/test`，编译签名后在真机／模拟器运行。涉及 HSP 等依赖时，需要安装相应依赖包。
- 新增 `*.test.ets` 后，在对应 `List.test.ets` 中导入并调用测试套函数。
- 普通测试复用生成入口；自定义 TestAbility 时，补充配套 TestRunner，并按需配置测试模块的 `mainElement`、`abilities` 和 `pages`。

## 2. Hypium

- `@ohos/hypium` 配置在 `oh-package.json5` 的 `devDependencies`，沿用项目兼容版本。
- `describe` 回调必须同步；`it` 的第二个参数是分类标签，`0` 表示未设置，不是超时时间。
- 异步用例可使用无 `done` 参数的 `async` 函数，等待操作和 Promise 断言；使用 `done` 时，在异步工作及断言完成后调用，并让异常使测试失败。
- `beforeEach/afterEach` 作用于当前套件；需要外层钩子覆盖嵌套套件用例时，可用 `1.0.25+` 的 `beforeEachIt/afterEachIt`。
- 结构比较用 `assertDeepEquals`，同步异常用 `assertThrowError`，Promise 拒绝用并等待 `assertPromiseIsRejected*`。
- 数据驱动：在 `Hypium.hypiumTest` 前通过 `Hypium.setData` 注入数据，用例参数为 `(done, data)`；仅放置 `data.json` 不会自动注入。

## 3. 官方 Mock

- **import Mock** 支持 API 11+ Stage 工程的 Local／Instrument Test。在 `src/mock` 编写替身，在 `src/mock/mock-config.json5` 映射模块名到 `source`；`source` 相对模块根目录。本地模块映射键为相对 `ets` 的路径，须带 `.ets` 后缀。
- 本地模块可用项目已有的 `hamock/hypium` Mock 接口或 import Mock；系统 API 对象不能用 Hypium 函数级 Mock，应使用 import Mock。
- Hypium `MockKit.clear(对象)` 还原该对象被 Mock 的方法，`ignoreMock` 恢复指定方法或属性；`clearAll()` 仅清理数据和内存，**不会还原方法**。

## 4. UI 测试

- 在 Hypium 用例内从 `@kit.TestKit` 导入 `Driver`、`ON`、`abilityDelegatorRegistry`。启动目标 Ability 后，使用 `Driver.create()` 查找控件、执行操作并断言结果。
- UiTest API 不支持并发调用，逐次 `await`；页面变化后重新查找控件。
- `waitForComponent` 无匹配时可能返回 `undefined`；`waitForIdle` 需检查返回值为 `true`。页面空闲不代表业务完成，仍需断言目标结果。
- 首次使用时按需启用设备测试能力：`hdc -n shell param set persist.ace.testmode.enabled 1`；执行前选定目标设备。

## 5. 执行与报告

- 在工程根目录使用匹配的工具链：`hvigorw test` 运行 Local Test，`hvigorw onDeviceTest` 运行 Instrument Test；`hdc shell aa test` 仅启动已安装测试包的 runner。
- Hvigor 用 `module` 指定模块，`scope` 筛选 `测试套名#用例名` 或测试套名；`aa test` 使用实际测试模块、runner 和 `class` 等筛选参数。
- `aa test -s timeout` 单位为 ms，默认 5000；`-w` 是测试运行时间，不能混用。
- `onDeviceTest` 当前文档仅支持 `default` product；非默认 product 需核对工具支持。`aa test` 不支持 release 签名应用，这与 Release 构建模式不同。
- 检查本次报告的实际用例及 `Pass`、`Failure`、`Error`、`Ignore` 和跳过原因，不能只看退出码。Hypium `1.0.25` 的 `OHOS_REPORT_STATUS_CODE: 0` 也可能表示跳过，最终 `OHOS_REPORT_CODE: 0` 也可能伴随非零 `Error`。
- Hvigor 测试任务的 `coverage` 默认开启；需要覆盖率时确认被测生产文件参与统计，报告路径以本次工具输出为准。性能比较保持插桩、构建模式和设备条件一致。

## 6. 专项：按需使用

- **PerfTest（API 20+）**：明确指标、阈值、迭代次数和超时；`resetCode` 按复位需要提供。`actionCode/resetCode` 成功时调用 `finish(true)`，失败时调用 `finish(false)`；Hypium 总超时需容纳多轮执行和复位。
- PerfTest 接口串行调用：创建 → `await run()` → `getMeasureResult` → 检查有效样本与阈值，已创建对象在 `finally` 中 `destroy()`。`roundValues` 的 `-1` 表示采集失败且被统计值剔除，需报告失败轮次并检查有效样本数量。指标针对指定应用进程，场景指标需满足相应触发条件。
- **C++／NAPI**：Instrument Test 可通过 ArkTS／JS 调用 Node-API 拉起测试 so，生成目录不自带 C++ 测试框架，按项目选用。
