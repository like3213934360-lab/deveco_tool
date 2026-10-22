# TitleButtonRect Type Errors

`getTitleButtonRect()` 返回 `window.TitleButtonRect`，不要将其直接当作 `window.Rect`，也不要编造 `left: 0, top: 0` 冒充实际位置。字段及设备支持范围以目标 SDK 声明为准。

```typescript
import { window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

export async function readTitleButtonRect(context: common.UIAbilityContext): Promise<window.TitleButtonRect> {
  const currentWindow = await window.getLastWindow(context);
  return currentWindow.getTitleButtonRect();
}
```

该异步函数将窗口获取失败和同步读取异常都转为拒绝；调用方需捕获。不要在 SDK 回调内调用可能抛错的方法，却遗漏外层 Promise 的 `reject()` 路径。

[示例](deveco://knowledge/arkts-error-fixes/examples/TitleButtonRectTypeError)
