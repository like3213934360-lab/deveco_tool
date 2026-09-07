# 设备清单与属性证据

`device_info list:true` 只列出可访问的 HDC 标识，不接受同时提供会被忽略的 `target`。`device_info target:<id>` 查询精确目标；省略目标时必须恰好有一个可访问设备。旧 CLI 的工程工作目录、文本表格输出及设备名称别名选择不保留。

清单和所有设备操作的目标捕获使用同一个解析器。空清单与 `[Empty]` 返回空数组，重复标识去重；明确 `unauthorized/offline` 的条目不用于自动选择。超过 256 行、未知状态/字段、控制字符或截断清单明确失败。不能从截断输出中选中“唯一可见”的设备，也不能在指定设备断连后改用另一设备。

属性在固定目标上通过一次带远端退出回执的 `param get` 获取，保留结构化 `properties`，并提供 `serial/name/kind/device_type/os_version`。模拟器名称优先使用设备提供的 `ohos.qemu.hvd.name`，其次使用产品名称/型号。缺失名称、类型或版本使用 `null`，不把序列号伪装成设备名称。`complete`、`missing_properties`、`truncated` 表明六项基础属性的完整性；同一属性出现矛盾值时明确拒绝。

`kind_source:device_property` 表示设备声明了模拟器名称。缺少该字段时，`kind` 延续上游按本机回环地址判断的展示语义，但显式标记 `transport_address_heuristic`；它不能作为判断真实硬件或模拟器的强证明。传感器、签名和部署验收不能仅依赖这个字段。

`test/native-device-info.test.ts` 覆盖多设备、重复/未授权/离线、截断/异常清单、断连不回退、缺失型号/版本、模拟器名称、属性矛盾以及远端失败不报告成功。真实设备证据由 `scripts/native-device-readonly.ts` 记录，跨平台 HDC/SDK 与真实多设备仍需各自证据，不将 Node 夹具验证当作全平台 SDK 验证。

2026-09-08，本机全量 189 项通过（`/private/tmp/deveco-native-regression-node26-20260908-26/evidence.json`）。真实设备只读复验 12 项通过（`/private/tmp/deveco-native-device-readonly-20260908-5/evidence.json`），设备名称 HUAWEI Pura 80 Pro、API 26 (Release)、六项基础属性完整；没有安装、点击、输入或应用启动。
