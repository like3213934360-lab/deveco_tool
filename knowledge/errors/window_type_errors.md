# Window API Type Errors

`window.getLastWindow(context)` 有 `Promise<window.Window>` 重载，可以正常使用 `await`；传入回调才选择返回 `void` 的重载。不要把一般类型错误归咎于 async/await。

```typescript
import { window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

export async function readWindowSize(context: common.UIAbilityContext): Promise<window.Size> {
  const currentWindow = await window.getLastWindow(context);
  const rect = currentWindow.getWindowProperties().windowRect;
  return { width: rect.width, height: rect.height };
}
```

调用前检查可选 Context。`async` 函数中同步读取窗口属性抛错会使 Promise 拒绝，调用方应处理该拒绝；不要再套一层没有异常保护的回调式 `new Promise`。

监听 `windowSizeChange` 使用 `window.Size`，监听 `avoidAreaChange` 使用 `window.AvoidAreaOptions`（含 `type` 和 `area`）。保留原窗口与回调并在结束时 `off()`；异步获取窗口晚于组件销毁时，不应继续注册。

[完整示例](deveco://knowledge/arkts-error-fixes/examples/WindowTypeError)
