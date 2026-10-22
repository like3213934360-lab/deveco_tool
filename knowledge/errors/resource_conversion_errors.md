# Resource 类型转换

`$r(...)` 返回资源引用，不能直接赋值给 `string` 或 `number`。支持 `ResourceStr`、`Resource` 的 UI 属性可直接接收引用；业务代码需要实际值时使用资源管理器。

```typescript
import { common } from '@kit.AbilityKit';

export async function readString(context: common.Context | undefined, id: number): Promise<string> {
  if (context === undefined) {
    throw new Error('Context is unavailable');
  }
  return await context.resourceManager.getString(id);
}
export function readNumber(context: common.Context | undefined, id: number): number {
  if (context === undefined) {
    throw new Error('Context is unavailable');
  }
  return context.resourceManager.getNumber(id);
}
export async function readStringByName(context: common.Context, name: string): Promise<string> {
  return await context.resourceManager.getStringByName(name);
}
```

`getString()`、`getStringByName()` 的 Promise 重载需要等待，`getNumber()` 返回数值。资源 ID / 名称必须由当前工程提供，失败应显式处理，不能用断言或无关默认值伪装为读取成功。

[示例](deveco://knowledge/arkts-error-fixes/examples/ResourceConversionError)
