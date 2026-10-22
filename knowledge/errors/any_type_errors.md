# Explicit Types Instead of Any or Unknown

使用具体类型、命名接口或受约束的泛型，不使用 `any`、`unknown`、匿名对象类型掩盖不确定的数据。

```typescript
interface Address {
  city: string;
}
interface User {
  name: string;
  address: Address;
}
function label(user: User): string {
  return `${user.name}: ${user.address.city}`;
}
function identity<T>(value: T): T {
  return value;
}
function format(value: string | number): string {
  return typeof value === 'string' ? value : value.toString();
}
type ClickHandler = (event: ClickEvent) => void;
type TouchHandler = (event: TouchEvent) => void;
```

`ClickEvent`、`TouchEvent` 是接口，不是运行时构造器，不能用于 `instanceof`。分别为 `onClick`、`onTouch` 提供对应类型的回调。复杂对象的类型应来自已知 API 或经验证的数据协议，不靠强制转换宣称安全。
