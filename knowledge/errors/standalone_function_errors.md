# 独立函数中的 UI Context

独立函数没有组件的 `this.getUIContext()`。由组件取得 Context、检查是否存在，然后显式传入函数。

```typescript
import { window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

export async function getAvoidArea(context: common.UIAbilityContext): Promise<window.AvoidArea> {
  const currentWindow = await window.getLastWindow(context);
  return currentWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
}
```

组件内先取 `this.getUIContext().getHostContext()` 并检查 `undefined`。只有确定宿主为 UIAbility 时才使用相应 Context 类型。调用方 `await` 上述函数并处理异常；SDK Promise 拒绝及同步窗口 API 异常都会正常传播，不能用遗漏 `try/catch` 的回调包装造成永久 pending。

[示例](deveco://knowledge/arkts-error-fixes/examples/StandaloneFunctionError)
[多个窗口操作](deveco://knowledge/arkts-error-fixes/examples/StandaloneFunctionContext)
