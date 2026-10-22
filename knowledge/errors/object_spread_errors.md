# Object Spread Errors

ArkTS 1.1 不支持对象展开表达式。为结果添加类型注解不能使 `{ ...source }` 合法；数组展开和对象展开是不同规则。

使用命名接口并逐字段复制。嵌套对象需要独立复制时也逐字段构造，不能误称为自动深拷贝。

```typescript
interface Address {
  city: string;
}
interface User {
  name: string;
  address: Address;
}
function renameUser(source: User, name: string): User {
  return { name: name, address: { city: source.address.city } };
}
```

只需共享嵌套对象时可写 `address: source.address`，但修改该对象会影响共享它的引用。新增字段后需同步维护复制函数。
