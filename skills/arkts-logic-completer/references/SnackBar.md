# SnackBar 消息通知栏功能逻辑规格

## 1. 功能定位

SnackBar 是轻量级消息提示模式，通过 promptAction 的 showToast/openCustomDialog 实现，用于在页面底部或顶部短暂展示操作反馈或提示信息。

## 2. 典型场景

- 操作成功/失败后的 Toast 提示（如"保存成功"）
- 网络异常提示（"网络连接失败，请重试"）
- 撤销操作提示（"已删除，点击撤销"）
- 数据加载完成提示（"已加载 20 条新数据"）

## 3. 状态声明

```typescript
// SnackBar 通常不需要持久状态，通过 API 调用即时显示
// 如果需要控制显示队列或防重复，可声明：
@State isShowingSnack: boolean = false

// 自定义 SnackBar 的内容
@State snackMessage: string = ''
@State snackType: string = 'info' // 'success' | 'error' | 'info'
```

装饰器选择：
- `@State`：自定义 SnackBar 的显示/隐藏状态
- 多数情况直接调用 promptAction API，无需状态声明

## 4. 事件与交互逻辑

### showToast 基本用法

```typescript
import { promptAction } from '@kit.ArkUI'

promptAction.showToast({
  message: '保存成功',
  duration: 2000,
  bottom: 80
})
```

### 通过 UIContext 调用（推荐）

```typescript
this.getUIContext().getPromptAction().showToast({
  message: '操作完成',
  duration: 2000
})
```

### 自定义 SnackBar 样式（使用 CustomDialog）

```typescript
this.getUIContext().getPromptAction().openCustomDialog(this.snackBuilder, {
  alignment: DialogAlignment.Bottom,
  offset: { dx: 0, dy: -80 },
  autoCancel: true,
  isModal: false
})
```

## 5. 数据结构

```typescript
interface SnackBarOptions {
  message: string
  duration: number
  type: string       // 'success' | 'error' | 'info'
  actionLabel?: string
  onAction?: () => void
}

interface ToastConfig {
  message: string
  duration: number
  bottom?: number
}
```

## 6. 联动说明

- 网络请求失败 → 显示错误提示 Toast
- 表单提交成功 → 显示成功提示并延时关闭/跳转
- 列表项删除 → 显示带"撤销"按钮的 SnackBar
- 多条消息排队 → 当前提示消失后再显示下一条

## 7. 完整代码示例

```typescript
@Entry
@Component
struct SnackBarDemo {
  @State lastAction: string = ''
  @State showCustomSnack: boolean = false
  @State snackMessage: string = ''

  showToast(message: string): void {
    this.getUIContext().getPromptAction().showToast({
      message: message,
      duration: 2000,
      bottom: 80
    })
  }

  showSuccessToast(): void {
    this.showToast('保存成功')
    this.lastAction = '保存'
  }

  showErrorToast(): void {
    this.showToast('网络连接失败，请检查网络设置')
    this.lastAction = '网络错误'
  }

  @Builder
  customSnackBar() {
    Row() {
      Text(this.snackMessage)
        .fontColor(Color.White)
        .fontSize(14)
        .layoutWeight(1)
      Button('撤销')
        .fontColor('#FFCC00')
        .backgroundColor(Color.Transparent)
        .onClick((): void => {
          this.undoDelete()
          this.showCustomSnack = false
        })
    }
    .width('90%')
    .padding({ left: 16, right: 8, top: 12, bottom: 12 })
    .borderRadius(8)
    .backgroundColor('#323232')
  }

  undoDelete(): void {
    this.showToast('已撤销删除')
    this.lastAction = '撤销'
  }

  build() {
    Column() {
      Text('SnackBar 示例').fontSize(24).margin({ bottom: 24 })
      Text('上次操作: ' + this.lastAction)
        .margin({ bottom: 24 })

      Button('成功提示')
        .margin({ bottom: 12 })
        .onClick((): void => {
          this.showSuccessToast()
        })

      Button('错误提示')
        .margin({ bottom: 12 })
        .onClick((): void => {
          this.showErrorToast()
        })

      Button('删除项目（带撤销）')
        .margin({ bottom: 12 })
        .onClick((): void => {
          this.snackMessage = '项目已删除'
          this.showCustomSnack = true
          this.lastAction = '删除'
        })

      if (this.showCustomSnack) {
        Column() {
          this.customSnackBar()
        }
        .position({ x: '5%', y: '85%' })
        .width('100%')
      }
    }
    .width('100%')
    .height('100%')
    .padding(16)
    .justifyContent(FlexAlign.Center)
  }
}
```

## 8. 反面示例

```typescript
// ❌ duration 设置为 0 或负数，Toast 不会显示或行为异常
promptAction.showToast({ message: 'test', duration: 0 })

// ❌ 在非 UI 线程调用 promptAction，导致崩溃
// promptAction 必须在 UI 上下文中调用

// ❌ 频繁调用 showToast 导致消息堆叠，用户无法阅读
for (let i = 0; i < 10; i++) {
  promptAction.showToast({ message: '消息' + i.toString() })
}

// ❌ 使用 promptAction 但没有导入模块
// 应 import { promptAction } from '@kit.ArkUI'
// 或通过 this.getUIContext().getPromptAction() 获取
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `promptAction.showToast({ message, duration?, bottom? })` | 显示 Toast 提示 |
| `this.getUIContext().getPromptAction().showToast(...)` | 通过 UIContext 显示 Toast（推荐） |
| `message: string \| Resource` | 提示文本 |
| `duration: number` | 显示时长（ms），范围 1500-10000 |
| `bottom: number \| string` | 距底部距离 |
| `promptAction.showDialog({ title, message, buttons })` | 显示对话框 |
| `promptAction.openCustomDialog(builder, options)` | 打开自定义弹窗 |
| `DialogAlignment.Bottom / Top / Center` | 弹窗对齐方式 |
| `import { promptAction } from '@kit.ArkUI'` | 导入模块 |
