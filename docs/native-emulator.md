# 原生模拟器协议与许可证

实例、镜像和许可证写操作及所有场景先持久化任务并返回 `run_id`，用 `workflow_run.status` 读取最终结果。停止实例和场景必须给出 `target`；运行实例的 `config.ini` 中名称、UUID、instancePath 必须匹配。SDK 将端口写为 `notset` 时，仅允许回环 HDC 地址，并通过设备参数 `ohos.qemu.hvd.name` 核对原生实例名；已配置的端口必须与目标一致，不能用设备数量推断归属。捕获期间配置变化或名称不符会拒绝操作。实际设备锁与其他 UI 操作共用，库存变更另持有模拟器全局租约。

`emulator_manage` 直接调用所选工具链的模拟器组件。实例使用清单中的精确 `name`；创建、启动、停止、删除均核对执行后的清单，不接受旧 `all` 或 `names` 批量隐式选择。删除正在运行的实例会失败。镜像使用 `images / image_install / image_uninstall`，安装/卸载要求 `device_type` 与唯一版本；不隐式下载镜像或接受许可证。

`emulator_scenario` 将方向、折叠、电池、GPS 和传感器请求转为组件参数数组。无关字段、缺失值、范围或精度不符在参数边界拒绝。GPS 经纬度分别限制为 ±180/±90、最多八位小数；海拔 ±10000、两位小数；方位 0–359.99、两位小数。光照/湿度/温度最多一位小数；步数 0–100000、心率 0–255，均为整数。现代组件帮助声明的步数上限为 100000，旧 CLI 的 10000 上限不保留。

场景执行要求组件版本至少 7，并在 `-help` 中找到具体命令及传感器选项。本机 26.0.0.400 未声明湿度和温度选项，明确返回 `EMULATOR_CAPABILITY_UNAVAILABLE`。有限的单条协议缓存以可执行文件身份和捕获命令为键，避免每次重复启动版本/帮助探测。原生命令必须返回 `Scenario simulation success.`，混有失败信息或没有正向回执时不计成功。`commandAccepted:true` 仅表示组件接受命令，`stateVerified:false` 明确保留应用实际感知验收边界。

## 许可证

`license_view` 只读当前组件目录中的 `agreement/HarmonyOS_Software_Service_Agreement.txt` 与 `agreement/HarmonyOS_SDK_Agreement.txt`。每份文件最多 1 MiB，返回 SHA-256、字节数、制品引用和接受状态；全文通过制品分页读取。组合 `license_sha256` 固定所审阅的两份文本。缺失文件明确不可用，不使用捆绑的旧协议替代。

`license_accept` 要求显式提供当前 `license_sha256`。摘要变化时拒绝，不执行原生命令；摘要相符才调用 `Emulator -license accept`，并只读核对对应组件版本的 `.emu_config` 中两项均为 `agree`。已有相同协议接受状态可返回 `unchanged:true`。只看到退出码 0 或成功文字不能代替配置核对。本项目不自行写入这些接受字段，也不在启动或镜像安装过程中默认接受协议。

现代组件配置位于 Windows `%LOCALAPPDATA%/Huawei/Emulator<major>.<minor>`、macOS `~/Library/Caches/Huawei/Emulator<major>.<minor>`、Linux `$XDG_CACHE_HOME/Huawei/Emulator<major>.<minor>`（未设置时使用 `~/.cache`）。当前识别原生 `key:value` 协议，歧义字段明确拒绝，不引入旧 JSON/INI 兼容解码器。

### 探测副作用记录

2026-09-08 核查原生 `Emulator -license` 时发现，它在用户选择拒绝后仍重写配置为 `disagree`。本次手动协议探测已触发该行为，探测前没有保存原值，因此不能判断原有接受标志是否改变，也没有擅自改为接受。新 `license_view` 不调用这个交互命令。

原生帮助和安装资源为协议依据，适配映射在 `provenance/upstream-mapping.json`。不执行官方 CLI 的直接配置写入或捆绑协议实现。

## 当前验证与历史记录

当前运行/编译身份 `cc3cdfd1` / `a3763ec3` 的 [CI `34330094583`](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34330094583) 六组平台适用回归已通过，包括模拟器协议与生命周期回归；整轮 CI 仍受上游接收门禁阻止。相同身份的已有专用模拟器完成 MCP 图片/报告协议 8 项；外层关闭后通过新的 Runtime 确认实例停止，记录在 `20260909-main-emulator-visual-579449e-1`。此前 `bc68e0c` 驱动关闭后查询数据库的失败报告原样保留。

随后在原有专用实例及预装观察应用完成电量 31/80 实际感知、UI 捕获与场景共用设备租约、派发前取消无操作记录及无应用副作用、原值恢复，共 12 项；光照经真实 MCP/Worker 和 SensorServiceKit 回调验证并恢复原值，5 项通过。记录在 `20260909-main-emulator-effects-22cc66c-1` 的 `battery/evidence.json`、`light/evidence.json`；外层 7 项确认原生实例身份、应用准备与恢复，关闭后再次确认实例停止。三份报告均 completed/closed/unchanged/passed，摘要见[完成清单](native-completion.md)。未新增下载、实例或安装，未触碰物理手机。

`test/native-emulator-protocol.test.ts` 验证参数前置拒绝、精确命令、能力探测、缓存复用、失败回执、协议文件限额/缺失、摘要变化、接受结果不明、重复接受去重和查看时配置字节/mtime 不变。接受写入只在测试夹具内模拟。`test/native-emulator.test.ts` 验证受管启动器与清单共同确认退出。

真实组件只读验收 7 项通过：`/private/tmp/deveco-native-emulator-readonly-20260908-1/evidence.json`，记录实际编译摘要及 SDK 身份。覆盖清单、已安装镜像、两份实际协议全文与摘要、稳定复读、旧摘要拒绝、配置字节/mtime 不变和关闭。复现命令为 `node dist/scripts/native-emulator-readonly.js /absolute/new-evidence`。

上述证据不包含真实协议接受、镜像下载/卸载或其他平台真实模拟器。电量、光照与同一目标 UI 的派发前竞争/取消已有当前专项证据；不能扩大为全部场景或传感器通过。原生命令派发后的取消结果、组件异常恢复及更多场景效果仍待验证；当前镜像的湿度和环境温度不可用记录保留。
