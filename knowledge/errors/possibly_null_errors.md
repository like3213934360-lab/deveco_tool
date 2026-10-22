# Possibly Null or Undefined Errors

检查可空值后再访问。导入模块名与局部变量使用不同名称，避免 `let display = display...` 或 `let window = await window...` 遮蔽模块。

```typescript
import { display, window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

function displayWidth(current: display.Display | null): number {
  return current === null ? 0 : current.width;
}
async function windowWidth(context: common.UIAbilityContext | undefined): Promise<number> {
  if (context === undefined) {
    throw new Error('UIAbility context is unavailable');
  }
  const currentWindow = await window.getLastWindow(context);
  return currentWindow.getWindowProperties().windowRect.width;
}
```

`display.getDefaultDisplaySync()` 返回 `display.Display`，失败可能抛异常；不要凭空将所有 SDK 返回值视为可空。`getHostContext()` 可能返回 `undefined`，类型断言不能代替实际检查。可选属性也应检查 `undefined` 或使用 `??` 提供符合业务含义的默认值。
