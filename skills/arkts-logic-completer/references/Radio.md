# Radio 组件功能逻辑规格

## 1. 功能定位

Radio 是单选框组件，用于在一组互斥选项中选择其一。当界面需要用户从多个选项中做出唯一选择时使用。

## 2. 典型场景

- 性别选择（男 / 女 / 其他）
- 支付方式选择（微信 / 支付宝 / 银行卡）
- 配送方式（快递 / 自取）
- 问卷调查中的单选题

## 3. 状态声明

```typescript
// 当前选中项的值
@State selectedValue: string = 'option1'

// 选项列表（数据驱动）
@State options: RadioOption[] = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' }
]
```

## 4. 事件与交互逻辑

### onChange 核心事件

同组 Radio（相同 group）只有一个能被选中，切换时触发 onChange：

```typescript
Radio({ value: 'male', group: 'gender' })
  .checked(this.selectedValue === 'male')
  .onChange((isChecked: boolean): void => {
    if (isChecked) {
      this.selectedValue = 'male'
    }
  })
```

### 数据驱动渲染

```typescript
ForEach(this.options, (option: RadioOption) => {
  Row() {
    Radio({ value: option.value, group: 'gender' })
      .checked(this.selectedValue === option.value)
      .onChange((isChecked: boolean): void => {
        if (isChecked) {
          this.selectedValue = option.value
        }
      })
    Text(option.label)
  }
})
```

## 5. 数据结构

```typescript
interface RadioOption {
  value: string
  label: string
  disabled?: boolean
}
```

## 6. 联动说明

- Radio 选中变化 → 更新表单中对应字段的值
- 不同 Radio 选中 → 展示不同子表单内容（如选择"其他"后出现文本输入框）
- Radio 选中结果 → 影响提交按钮的可用状态
- 同组 Radio 互斥：选中一个自动取消其他

## 7. 完整代码示例

```typescript
interface RadioOption {
  value: string
  label: string
}

@Entry
@Component
struct PaymentSelectPage {
  @State selectedPayment: string = 'wechat'
  @State paymentOptions: RadioOption[] = [
    { value: 'wechat', label: '微信支付' },
    { value: 'alipay', label: '支付宝' },
    { value: 'bank', label: '银行卡' }
  ]

  build() {
    Column({ space: 16 }) {
      Text('选择支付方式')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .width('100%')
        .padding({ left: 16, top: 16 })

      ForEach(this.paymentOptions, (option: RadioOption) => {
        Row() {
          Radio({ value: option.value, group: 'payment' })
            .checked(this.selectedPayment === option.value)
            .onChange((isChecked: boolean): void => {
              if (isChecked) {
                this.selectedPayment = option.value
              }
            })
          Text(option.label)
            .fontSize(16)
            .margin({ left: 8 })
        }
        .width('100%')
        .padding({ left: 16, top: 12, bottom: 12 })
      })

      Divider().margin({ top: 16 })

      Text('当前选择：' + this.selectedPayment)
        .fontSize(14)
        .fontColor('#666666')
        .padding(16)

      Button('确认支付')
        .width('90%')
        .height(48)
        .onClick((): void => {
          console.info('支付方式：' + this.selectedPayment)
        })
    }
  }
}
```

## 8. 反面示例

```typescript
// ❌ 没有设置 group，多个 Radio 不互斥
Radio({ value: 'A' })
Radio({ value: 'B' })

// ❌ checked 写死 true，无法切换
Radio({ value: 'A', group: 'g1' }).checked(true)

// ❌ onChange 里没有判断 isChecked，会在取消选中时也更新状态
Radio({ value: 'A', group: 'g1' })
  .onChange((isChecked: boolean) => {
    this.selected = 'A'  // 应先判断 isChecked === true
  })

// ❌ 没有用 @State 管理 selectedValue，切换后 UI 不刷新
let selected = 'A'
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Radio({ value: string, group: string })` | 创建单选框，value 是当前值，group 用于分组互斥 |
| `indicatorType: RadioIndicatorType` | 选中样式：TICK（勾选，默认）/ DOT（圆点）/ CUSTOM（API 12+） |
| `.checked(boolean)` | 设置选中状态，支持 $$ 双向绑定（API 10+） |
| `.radioStyle(RadioStyle)` | 自定义选中/非选中颜色（API 10+） |
| `.onChange((isChecked: boolean) => void)` | 选中状态变化回调 |
| `.enabled(boolean)` | 是否可交互 |
