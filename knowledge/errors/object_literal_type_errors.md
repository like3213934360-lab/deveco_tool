# Object Literal Type Declaration Error

`arkts-no-obj-literals-as-types` 禁止把匿名对象形状写作类型，例如 `(): { width: number; height: number }`。`type Size = { ... }` 仍然是对象字面量类型，不能绕过限制。

使用命名接口或类；SDK 已定义的结构优先使用 SDK 类型。

```typescript
interface WindowSize {
  width: number;
  height: number;
}
function getSize(): WindowSize {
  return { width: 100, height: 200 };
}
```

`UIAbilityContext` 不是 `WindowStage`，也没有 `windowStage` 属性。调用方持有 `WindowStage` 时可使用其 `getMainWindowSync()`；只有 Context 时可 `await window.getLastWindow(context)`，再读取窗口属性。

[完整示例](deveco://knowledge/arkts-error-fixes/examples/ObjectLiteralTypeError)
