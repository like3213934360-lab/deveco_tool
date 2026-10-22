# Function Return Type Errors

返回对象时使用命名接口或 SDK 类型，不能以内联对象类型作为返回注解。跨函数或复杂分支推断不足时，显式声明返回类型。

```typescript
interface WindowInfo {
  width: number;
  height: number;
}
function getWindowInfo(): WindowInfo {
  return { width: 100, height: 200 };
}
function getLabel(value: number): string {
  return value > 0 ? 'positive' : 'non-positive';
}
async function getLabelAsync(value: number): Promise<string> {
  return getLabel(value);
}
```

无返回值的函数使用 `void`；异步无返回值函数使用 `Promise<void>`。为数组元素定义命名类型，不要把 `Array<{ ... }>` 当作修复方案。
