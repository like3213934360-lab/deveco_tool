# 未使用变量警告

先确认回调签名，再删除不需要的尾部参数或使用下划线表达有意忽略。下划线是否抑制警告取决于具体检查器，不能修复错误类型。

`Scroll.onDidScroll` 回调前两个参数是 `xOffset: number`、`yOffset: number`；目标 SDK 支持的滚动状态位于后续参数，不应把第二个参数标成 `ScrollState`。

```typescript
@Entry
@Component
struct ScrollExample {
  @State offsetY: number = 0;
  build() {
    Column() {
      Text(`本次纵向滚动量: ${this.offsetY}`)
      Scroll() {
        Column() {
          Text('顶部')
          Blank().height(1000)
          Text('底部')
        }
      }
      .height(300)
      .onDidScroll((_xOffset: number, yOffset: number) => {
        this.offsetY = yOffset;
      })
    }
  }
}
```

同一组件只注册一次该事件，重复链式注册不能当作两个独立监听器。ArkTS 1.1 不以对象解构重命名来消除警告。删除未使用变量时保留必要副作用：`const unused = updateCache()` 应改为 `updateCache()`，只有确认调用本身无用时才一起删除。

[示例](deveco://knowledge/arkts-error-fixes/examples/UnusedVariableWarning)
