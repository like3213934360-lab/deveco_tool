# Counter 组件功能逻辑规格

## 1. 功能定位

Counter 是计数器组件，提供增加或减少的计数操作。当界面需要用户通过加减按钮调整数值时使用。

## 2. 典型场景

- 购物车中商品数量的增减
- 表单中数字字段的步进调整（如人数、份数）
- 设置页中的数值配置（如字体大小、音量等级）
- 分页器中的页码切换

## 3. 状态声明

```typescript
// 单个计数器
@State count: number = 0

// 带上下限的计数器
@State quantity: number = 1
private minVal: number = 1
private maxVal: number = 99

// 购物车场景——多个商品各自计数
@State cartItems: CartItem[] = [
  { name: '商品A', price: 29, quantity: 1 },
  { name: '商品B', price: 59, quantity: 2 }
]
```

装饰器选择：
- `@State`：页面内部状态
- `@Prop`：父组件单向传入（如列表中每个计数器项）
- `@Link`：父子双向同步

## 4. 事件与交互逻辑

### onInc(event: VoidCallback) / onDec(event: VoidCallback)

两个核心事件，分别在点击加/减按钮时触发：

```typescript
Counter() {
  Text(this.quantity.toString())
}
.onInc((): void => {
  // 1. 边界检查
  if (this.quantity < this.maxVal) {
    this.quantity++
  }
})
.onDec((): void => {
  // 1. 边界检查
  if (this.quantity > this.minVal) {
    this.quantity--
  }

  // 2. 联动逻辑（按需）
  if (this.quantity === this.minVal) {
    this.showDeleteConfirm = true
  }
})
```

### enableInc / enableDec 属性

根据当前值动态禁用按钮：

```typescript
Counter() {
  Text(this.quantity.toString())
}
.enableInc(this.quantity < this.maxVal)
.enableDec(this.quantity > this.minVal)
.onInc((): void => { this.quantity++ })
.onDec((): void => { this.quantity-- })
```

## 5. 数据结构

```typescript
// 购物车商品模型
interface CartItem {
  name: string       // 商品名称
  price: number      // 单价
  quantity: number   // 数量
}
```

## 6. 联动说明

- Counter 增减 → 更新总价显示（如购物车合计）
- Counter 到达下限 → 弹出删除确认弹窗
- Counter 到达上限 → 禁用增加按钮（enableInc(false)）
- Counter 值变化 → 触发父组件回调更新汇总数据

## 7. 完整代码示例

```typescript
interface CartItem {
  name: string
  price: number
  quantity: number
}

@Entry
@Component
struct ShoppingCartPage {
  @State cartItems: CartItem[] = [
    { name: '蓝牙耳机', price: 199, quantity: 1 },
    { name: '手机壳', price: 39, quantity: 2 },
    { name: '充电线', price: 25, quantity: 1 }
  ]

  getTotalPrice(): number {
    let total: number = 0
    for (let i = 0; i < this.cartItems.length; i++) {
      total += this.cartItems[i].price * this.cartItems[i].quantity
    }
    return total
  }

  build() {
    Column({ space: 12 }) {
      Text('购物车')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .width('100%')
        .padding(16)

      ForEach(this.cartItems, (item: CartItem, index: number): void => {
        Row() {
          Column() {
            Text(item.name).fontSize(16)
            Text('¥' + item.price.toString()).fontSize(14).fontColor('#FF6600')
          }
          .alignItems(HorizontalAlign.Start)
          .width('50%')

          Counter() {
            Text(item.quantity.toString())
              .fontSize(16)
          }
          .enableInc(item.quantity < 99)
          .enableDec(item.quantity > 1)
          .onInc((): void => {
            if (item.quantity < 99) {
              let updated: CartItem = {
                name: item.name,
                price: item.price,
                quantity: item.quantity + 1
              }
              this.cartItems[index] = updated
            }
          })
          .onDec((): void => {
            if (item.quantity > 1) {
              let updated: CartItem = {
                name: item.name,
                price: item.price,
                quantity: item.quantity - 1
              }
              this.cartItems[index] = updated
            }
          })
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .padding({ left: 16, right: 16 })
      })

      Divider().margin({ top: 12, bottom: 12 })

      Row() {
        Text('合计：')
          .fontSize(18)
        Text('¥' + this.getTotalPrice().toString())
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FF6600')
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
      .padding({ right: 16 })
    }
    .width('100%')
    .height('100%')
  }
}
```

## 8. 反面示例

```typescript
// ❌ 没有监听 onInc/onDec，点击加减按钮没有任何反应
Counter() {
  Text('0')
}

// ❌ 没有声明 @State，onInc 里赋值不会触发 UI 更新
let count = 0
Counter() {
  Text(count.toString())
}
.onInc(() => { count++ })
.onDec(() => { count-- })

// ❌ 没有做边界检查，数值可能变成负数或超大值
@State val: number = 0
Counter() { Text(this.val.toString()) }
.onInc(() => { this.val++ })
.onDec(() => { this.val-- })

// ❌ 使用对象展开运算符更新数组项（ArkTS 禁止 spread）
// this.cartItems[index] = { ...item, quantity: item.quantity + 1 }
// 应逐字段赋值
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Counter() { 子组件 }` | 创建计数器，子组件一般为 Text 显示数值 |
| `.onInc(callback: VoidCallback)` | 点击增加按钮时触发 |
| `.onDec(callback: VoidCallback)` | 点击减少按钮时触发 |
| `.enableInc(boolean)` | 增加按钮的启用/禁用（API 10+） |
| `.enableDec(boolean)` | 减少按钮的启用/禁用（API 10+） |
| `.enabled(boolean)` | 整体是否可交互（通用属性） |
