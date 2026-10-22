# Display Listener Type Errors

监听归属和回调类型由 SDK 声明决定：

| 事件 | 注册对象 | 回调参数 |
| --- | --- | --- |
| add / remove / change | `display` 模块 | `number`（显示屏 ID） |
| foldStatusChange | `display` 模块 | `display.FoldStatus` |
| captureStatusChange | `display` 模块 | `boolean` |
| availableAreaChange | 对应 `display.Display` 实例 | `display.Rect` |

`on()` 返回 `void`，不是监听器 ID。保留原回调和原实例，使用相同对象注销。

```typescript
import { display } from '@kit.ArkUI';

export function observeDisplayChanges(callback: (id: number) => void): () => void {
  display.on('change', callback);
  return (): void => { display.off('change', callback); };
}
export function observeAvailableArea(current: display.Display,
  callback: (area: display.Rect) => void): () => void {
  current.on('availableAreaChange', callback);
  return (): void => { current.off('availableAreaChange', callback); };
}
```

调用方在生命周期结束时调用返回的清理函数。折叠状态和截屏状态事件需同时核对目标 SDK API 版本和设备能力。

[示例](deveco://knowledge/arkts-error-fixes/examples/DisplayListenerTypeError)
