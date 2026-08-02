# ModalSheet 半模态页面功能逻辑规格

## 1. 功能定位

ModalSheet（半模态页面）通过 bindSheet 属性实现，从底部弹出覆盖部分页面的面板，用于展示详情、筛选表单或确认操作等不需要全屏跳转的场景。

## 2. 典型场景

- 商品详情的规格选择面板
- 分享面板（分享到微信/微博/复制链接）
- 评论输入面板（从底部弹出）
- 筛选/排序面板（多挡位高度切换）

## 3. 状态声明

```typescript
// 半模态显示状态（必须用 $$ 双向绑定）
@State isSheetVisible: boolean = false

// 半模态高度
@State sheetHeight: number = 300

// 业务数据（如选中的规格）
@State selectedSpec: string = ''
```

装饰器选择：
- `@State` + `$$`：isShow 必须用 `$$this.isSheetVisible` 双向绑定，确保拖拽关闭同步状态
- `@State`：面板内部的表单/选择数据

## 4. 事件与交互逻辑

### bindSheet 绑定与关闭

```typescript
Button('打开面板')
  .onClick((): void => {
    this.isSheetVisible = true
  })
  .bindSheet($$this.isSheetVisible, this.sheetBuilder(), {
    height: SheetSize.MEDIUM,
    dragBar: true,
    showClose: true,
    title: { title: '选择规格', subtitle: '请选择商品属性' },
    onWillAppear: (): void => {
      console.info('Sheet onWillAppear')
    },
    onDisappear: (): void => {
      console.info('Sheet onDisappear')
      this.onSheetClosed()
    }
  })
```

### onWillDismiss 拦截关闭

```typescript
.bindSheet($$this.isSheetVisible, this.sheetBuilder(), {
  onWillDismiss: (action: DismissSheetAction): void => {
    if (action.reason === DismissReason.SLIDE_DOWN) {
      action.dismiss()
    }
  }
})
```

## 5. 数据结构

```typescript
interface SheetConfig {
  title: string
  subtitle?: string
  height: number
  detents?: number[]
  showClose: boolean
}

interface SpecOption {
  label: string
  value: string
  available: boolean
}
```

## 6. 联动说明

- 按钮点击 → isSheetVisible = true → 半模态面板弹出
- 面板内选择操作 → 更新父页面数据（通过 @State 或回调）
- 拖拽关闭 → $$ 双向绑定自动同步 isSheetVisible = false
- 多挡位 detents → 手势滑动切换面板高度
- 键盘弹出 → 通过 keyboardAvoidMode 避让

## 7. 完整代码示例

```typescript
interface SpecOption {
  label: string
  value: string
}

@Entry
@Component
struct ModalSheetDemo {
  @State isSheetVisible: boolean = false
  @State selectedColor: string = ''
  @State selectedSize: string = ''
  @State quantity: number = 1

  private colors: SpecOption[] = [
    { label: '黑色', value: 'black' },
    { label: '白色', value: 'white' },
    { label: '蓝色', value: 'blue' }
  ]
  private sizes: SpecOption[] = [
    { label: 'S', value: 's' },
    { label: 'M', value: 'm' },
    { label: 'L', value: 'l' },
    { label: 'XL', value: 'xl' }
  ]

  @Builder
  sheetContent() {
    Column() {
      Text('颜色').fontSize(16).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.colors, (item: SpecOption) => {
          Text(item.label)
            .padding({ left: 16, right: 16, top: 8, bottom: 8 })
            .borderRadius(20)
            .backgroundColor(this.selectedColor === item.value ? '#007DFF' : '#F5F5F5')
            .fontColor(this.selectedColor === item.value ? Color.White : Color.Black)
            .margin({ right: 8, bottom: 8 })
            .onClick((): void => {
              this.selectedColor = item.value
            })
        })
      }

      Text('尺码').fontSize(16).fontWeight(FontWeight.Bold).margin({ top: 16, bottom: 8 })
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.sizes, (item: SpecOption) => {
          Text(item.label)
            .padding({ left: 16, right: 16, top: 8, bottom: 8 })
            .borderRadius(20)
            .backgroundColor(this.selectedSize === item.value ? '#007DFF' : '#F5F5F5')
            .fontColor(this.selectedSize === item.value ? Color.White : Color.Black)
            .margin({ right: 8, bottom: 8 })
            .onClick((): void => {
              this.selectedSize = item.value
            })
        })
      }

      Row() {
        Text('数量').fontSize(16)
        Blank()
        Button('-')
          .onClick((): void => {
            if (this.quantity > 1) {
              this.quantity--
            }
          })
        Text(this.quantity.toString()).margin({ left: 12, right: 12 })
        Button('+')
          .onClick((): void => {
            this.quantity++
          })
      }
      .width('100%')
      .margin({ top: 16 })

      Button('确认')
        .width('100%')
        .margin({ top: 24 })
        .onClick((): void => {
          this.isSheetVisible = false
        })
    }
    .padding(16)
    .width('100%')
  }

  build() {
    Column() {
      Text('商品详情').fontSize(24).margin({ bottom: 16 })
      if (this.selectedColor.length > 0) {
        Text('已选: ' + this.selectedColor + ', ' + this.selectedSize + ' x' + this.quantity.toString())
          .margin({ bottom: 16 })
      }
      Button('选择规格')
        .onClick((): void => {
          this.isSheetVisible = true
        })
        .bindSheet($$this.isSheetVisible, this.sheetContent(), {
          height: SheetSize.MEDIUM,
          dragBar: true,
          showClose: true,
          title: { title: '商品规格' },
          onDisappear: (): void => {
            console.info('Sheet closed')
          }
        })
    }
    .width('100%')
    .height('100%')
    .padding(16)
  }
}
```

## 8. 反面示例

```typescript
// ❌ isShow 没用 $$ 双向绑定，拖拽关闭后状态不同步
@State isShow: boolean = false
Button('open').bindSheet(this.isShow, this.builder(), {})
// 应使用 $$this.isShow

// ❌ builder 内容直接写 undefined，半模态无法显示
.bindSheet($$this.isShow, undefined, {})

// ❌ 宿主节点还没挂载就设置 isShow = true，半模态不生效
aboutToAppear(): void {
  this.isShow = true  // 此时节点尚未上树
}
// 应在 onAppear 中设置

// ❌ detents 设置了 FIT_CONTENT 又同时设置了 detentSelection
.bindSheet($$this.isShow, this.builder(), {
  detents: [SheetSize.FIT_CONTENT],
  detentSelection: SheetSize.MEDIUM  // FIT_CONTENT 时 detentSelection 无效
})
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `.bindSheet(isShow, builder, options?)` | 绑定半模态页面，isShow 支持 $$ 双向绑定 |
| `SheetSize.MEDIUM` | 高度为窗口 60% |
| `SheetSize.LARGE` | 高度接近窗口高度 |
| `SheetSize.FIT_CONTENT` | 高度自适应内容 |
| `options.height` | 半模态高度 |
| `options.detents` | 多挡位高度，最多 3 个 |
| `options.dragBar` | 是否显示拖拽条 |
| `options.showClose` | 是否显示关闭按钮 |
| `options.title` | 标题 `{ title, subtitle? }` |
| `options.preferType` | 弹窗样式：SheetType.BOTTOM / CENTER / POPUP |
| `options.onWillDismiss` | 关闭前拦截回调 |
| `options.onAppear / onDisappear` | 显示/消失回调 |
| `options.maskColor` | 背景蒙层颜色 |
| `options.backgroundColor` | 面板背景色 |
