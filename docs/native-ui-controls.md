# 原生 UI 操作与显示器定位

`ui_control` 接收 `operation`。`click`、`doubleClick`、`longClick`、`swipe`、`fling`、`drag`、`dircFling`、`keyEvent`、`inputText` 均由同一个原生服务执行。返回 `commandAccepted` 只说明命令被接受，业务结果需通过 `verify_ui` 或保存流程的最终断言检查。

## 选择器与百分比

选择器必须唯一；`limit:1` 不会隐藏多个匹配。控件所属显示器自动传给 UiTest；显式 `display_id` 与选择器不一致会失败。同一窗口 ID 出现在多个显示器时，应提供显示器编号。

百分比可以相对于一个控件，或显式指定的窗口。两个轴均从左上角开始，范围 0–100，100 会收敛到最后一个可操作像素。坐标不会通过旧版的隐式滑块内缩修改；需要避开边缘时明确选择例如 5–95 的端点。

```json
{
  "operation": {
    "action": "drag",
    "selector": {"key": "slider", "displayId": 1},
    "gesture": {
      "fromXPercent": 5, "fromYPercent": 50,
      "toXPercent": 95, "toYPercent": 50,
      "velocity": 600
    }
  }
}
```

控件未出现在 UI 树中时，可将 `selector` 换成 `window:{"bundle_name":"com.example.app"}`，相对于唯一可见应用窗口操作。窗口可用 `id` 指定。点操作使用 `point:{"xPercent":50,"yPercent":50}`；无百分比字段的选择器点操作使用控件中心。绝对坐标使用 `x/y/x2/y2`，不与选择器或百分比混用。

## 原生参数

- `velocity` 只用于手势，范围 200–40000。`step_length` 只用于 fling；端点式 fling 表示像素步长，方向式 dircFling 的原生位置参数实际表示采样次数。指定显示器时补齐中间的缺省位置参数，避免把显示器当速度或按键。
- `keys` 接受一个 `Home`、`Back`、`Power`，或最多三个数字键码。数字组合键指定显示器时补齐原生空键位；命名键不与其他键混用。
- UiTest 坐标必须为正 int32。手势距离限制为 1–32767 像素，避免原生整数距离运算溢出；步长不能大于手势距离。
- 中文、换行和 Unicode 文字通过 Hypium 的粘贴调用输入，目标点保留 `displayId`。文本不会拼进 shell。
- 当前原生 uiInput 的干净回执为空；它可能在退出码为 0 时打印错误。因此非空回执仍按动作失败处理，不根据退出码假定成功。

## 录制和验证边界

录制与执行使用同一次快照解析的坐标。无效参数在写入待执行记录之前失败。百分比动作保存为应用窗口百分比并标记 `fragile`，fling 步长保留；它不会在重放时被改成控件中心。语义点操作仍保存选择器，输入文字保存为变量。

保存流程的坐标重放要求唯一的应用窗口；没有可验证的唯一窗口时停止，不猜测另一显示器。多窗口跨显示器的持久化路径尚未通过真实设备验收。

回归证据见 `test/native-ui-control.test.ts`、`test/native-recording.test.ts`、`test/native-flow.test.ts`。参数位置已与本机设备帮助及 OpenHarmony [ui_input.cpp](https://github.com/openharmony/testfwk_arkxtest/blob/8adb157959c4d2c1b72d96ee2963cebdf53237d1/uitest/input/ui_input.cpp)、[ui_action.h](https://github.com/openharmony/testfwk_arkxtest/blob/8adb157959c4d2c1b72d96ee2963cebdf53237d1/uitest/core/ui_action.h) 核对；这不等于所有设备版本或实际多显示器操作均已验证。
