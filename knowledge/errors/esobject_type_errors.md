# ESObject Type Errors

避免把动态模块、JSON 或未约束数据当作 `any`、`unknown` 或虚构的 `ESModule` 类型。优先使用 SDK 声明提供的静态导入和具体类型。

```typescript
import { display } from '@kit.ArkUI';

export function defaultDisplayWidth(): number {
  const currentDisplay: display.Display = display.getDefaultDisplaySync();
  return currentDisplay.width;
}
```

需要动态导入时，在 `async` 函数中 `await import(...)`，并将 `await` 放在实际处理拒绝的 `try` 内；仅围住一个未等待的 Promise 无法捕获异步失败。模块导出类型以当前 SDK 声明为准，不要为模块编造类名。解析外部数据须按预期结构验证字段，类型断言不会执行运行时校验。
