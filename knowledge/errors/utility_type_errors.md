# Utility Type Errors

ArkTS 1.1 只支持部分 TypeScript 工具类型，不应声称包括 `Partial<T>` 在内的所有工具类型均不可用。遇到 `arkts-no-utility-types` 时以目标 SDK 规则为准，使用显式命名结构或具体函数签名替代不支持的类型计算。

函数类型可用类型别名，例如 `type ClickHandler = (event: ClickEvent) => void`。不要替换成 `Function`、调用签名接口或不匹配的 `Object[]`。

```typescript
export class Debouncer {
  private timer: number = -1;
  schedule(action: () => void, delayMs: number): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = -1;
      action();
    }, delayMs);
  }
  cancel(): void {
    if (this.timer !== -1) {
      clearTimeout(this.timer);
      this.timer = -1;
    }
  }
}
```

每次调用先取消上次计时才是防抖；生命周期结束时调用 `cancel()`。有参数的回调应明确参数类型，例如 `(x: number, y: number) => number`，不编造泛型参数转发。

[示例](deveco://knowledge/arkts-error-fixes/examples/UtilityTypeError)
