# Toast 轻提示功能逻辑规格

## 1. 功能定位

Toast 是轻量级提示组件，通过 promptAction.showToast() 在屏幕上短暂显示一段文字信息后自动消失。当需要对用户操作进行非阻塞性反馈（成功、失败、提醒）时使用。

## 2. 典型场景

- 操作成功反馈（保存成功、复制成功、收藏成功）
- 操作失败提示（网络异常、权限不足、操作失败）
- 状态提醒（请先登录、请填写完整信息）
- 功能限制提示（已达上限、功能暂不可用）

## 3. 状态声明

```typescript
// Toast 本身无需状态管理，但触发场景常与以下状态关联
@State isLoading: boolean = false
@State operationResult: string = 'idle'  // 'idle' | 'success' | 'error'
```

## 4. 事件与交互逻辑

### 场景一：基础 Toast 提示

```typescript
import { promptAction } from '@kit.ArkUI'

Button('保存')
  .onClick((): void => {
    this.saveData()
    promptAction.showToast({
      message: '保存成功',
      duration: 2000
    })
  })
```

### 场景二：带底部偏移的 Toast

```typescript
import { promptAction } from '@kit.ArkUI'

Button('添加购物车')
  .onClick((): void => {
    this.addToCart()
    promptAction.showToast({
      message: '已加入购物车',
      duration: 2000,
      bottom: 120
    })
  })
```

### 场景三：异步操作结果反馈

```typescript
import { promptAction } from '@kit.ArkUI'

async submitForm(): Promise<void> {
  if (!this.validateForm()) {
    promptAction.showToast({ message: '请填写完整信息', duration: 2000 })
    return
  }
  this.isLoading = true
  try {
    await this.doSubmit()
    promptAction.showToast({ message: '提交成功', duration: 2000 })
  } catch (e) {
    promptAction.showToast({ message: '提交失败，请重试', duration: 3000 })
  } finally {
    this.isLoading = false
  }
}
```

### 场景四：通过 UIContext 调用（推荐方式）

```typescript
import { promptAction } from '@kit.ArkUI'

Button('复制')
  .onClick((): void => {
    this.copyToClipboard()
    const uiContext = this.getUIContext()
    const prompt = uiContext.getPromptAction()
    prompt.showToast({
      message: '已复制到剪贴板',
      duration: 1500
    })
  })
```

## 5. 数据结构

```typescript
interface ToastConfig {
  message: string | Resource
  duration?: number
  bottom?: string | number
  showMode?: ToastShowMode
  alignment?: Alignment
  offset?: { dx: number | string; dy: number | string }
}
```

## 6. 联动说明

- 按钮点击 → 执行操作 → 根据结果 showToast 不同消息
- 网络请求失败 → showToast 错误提示 + 按钮恢复可点击
- 表单校验不通过 → showToast 提醒 + 聚焦到第一个错误字段
- 列表项删除成功 → showToast 反馈 + 列表刷新
- Toast 不阻塞用户操作，适合与其他交互同时进行

## 7. 完整代码示例

```typescript
import { promptAction } from '@kit.ArkUI'

interface TodoItem {
  id: number
  title: string
  done: boolean
}

@Entry
@Component
struct ToastDemoPage {
  @State todoList: TodoItem[] = [
    { id: 1, title: '完成项目报告', done: false },
    { id: 2, title: '回复客户邮件', done: false },
    { id: 3, title: '更新文档', done: true }
  ]
  @State newTodo: string = ''
  @State nextId: number = 4

  showToast(msg: string, duration: number = 2000): void {
    promptAction.showToast({
      message: msg,
      duration: duration,
      bottom: 80
    })
  }

  addTodo(): void {
    const title = this.newTodo.trim()
    if (title.length === 0) {
      this.showToast('请输入待办事项内容')
      return
    }
    if (this.todoList.length >= 10) {
      this.showToast('待办事项已达上限（10条）')
      return
    }
    const item: TodoItem = { id: this.nextId, title: title, done: false }
    this.todoList.push(item)
    this.nextId++
    this.newTodo = ''
    this.showToast('添加成功')
  }

  toggleDone(id: number): void {
    const item = this.todoList.find((t: TodoItem): boolean => t.id === id)
    if (item) {
      item.done = !item.done
      this.todoList = [...this.todoList]
      this.showToast(item.done ? '已完成' : '已取消完成', 1500)
    }
  }

  deleteTodo(id: number): void {
    const idx = this.todoList.findIndex((t: TodoItem): boolean => t.id === id)
    if (idx >= 0) {
      this.todoList.splice(idx, 1)
      this.showToast('已删除')
    }
  }

  build() {
    Column({ space: 16 }) {
      Text('待办清单')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)

      Row({ space: 8 }) {
        TextInput({ placeholder: '输入待办事项', text: this.newTodo })
          .layoutWeight(1)
          .onChange((value: string): void => {
            this.newTodo = value
          })
          .onSubmit((): void => {
            this.addTodo()
          })
        Button('添加')
          .onClick((): void => {
            this.addTodo()
          })
      }
      .width('100%')

      ForEach(this.todoList, (item: TodoItem) => {
        Row() {
          Checkbox()
            .select(item.done)
            .onChange((checked: boolean): void => {
              this.toggleDone(item.id)
            })
          Text(item.title)
            .fontSize(16)
            .decoration({ type: item.done ? TextDecorationType.LineThrough : TextDecorationType.None })
            .fontColor(item.done ? '#999' : '#333')
            .layoutWeight(1)
          Text('×')
            .fontSize(20)
            .fontColor('#FF4444')
            .onClick((): void => {
              this.deleteTodo(item.id)
            })
        }
        .width('100%')
        .padding(12)
        .borderRadius(8)
        .backgroundColor('#F5F5F5')
      })

      if (this.todoList.length === 0) {
        Text('暂无待办事项')
          .fontColor('#999')
          .margin({ top: 40 })
      }
    }
    .width('100%')
    .padding(24)
  }
}
```

## 8. 反面示例

```typescript
// ❌ 没有导入 promptAction，直接调用会报错
// 必须 import { promptAction } from '@kit.ArkUI'
promptAction.showToast({ message: 'test' })

// ❌ 用 Toast 展示需要用户确认的重要信息
// Toast 会自动消失，重要信息应使用 Dialog
promptAction.showToast({ message: '数据将被永久删除' })
// 应使用 AlertDialog 让用户确认

// ❌ duration 设置过短，用户来不及阅读
promptAction.showToast({
  message: '操作失败，请检查网络连接后重试',
  duration: 500  // 500ms 太短
})

// ❌ 连续快速弹出多个 Toast，信息被覆盖
for (let i = 0; i < 5; i++) {
  promptAction.showToast({ message: `消息${i}` })
  // 后面的 Toast 会覆盖前面的
}

// ❌ 在 showInSubWindow 为 true 的弹窗中使用 Toast
// Toast 在子窗模式的弹窗中可能行为异常
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `import { promptAction } from '@kit.ArkUI'` | 导入模块 |
| `promptAction.showToast(options)` | 显示 Toast 提示 |
| `options.message: string \| Resource` | 提示文本内容（必填） |
| `options.duration: number` | 显示时长（ms），范围 [1500, 10000]，默认 1500 |
| `options.bottom: string \| number` | 距离屏幕底部的距离，默认系统自适应 |
| `options.showMode: ToastShowMode` | 显示模式（API 11+） |
| `ToastShowMode.DEFAULT` | 默认模式，显示在应用内 |
| `ToastShowMode.TOP_MOST` | 显示在应用之上 |
| `options.alignment: Alignment` | Toast 对齐方式（API 12+） |
| `options.offset: { dx, dy }` | Toast 位置偏移（API 12+） |
| `UIContext.getPromptAction().showToast(options)` | 推荐的调用方式，通过 UIContext 获取 |
| `options.backgroundColor: ResourceColor` | 背景颜色（API 12+） |
| `options.textColor: ResourceColor` | 文本颜色（API 12+） |
| `options.backgroundBlurStyle: BlurStyle` | 背景模糊效果（API 12+） |

> **注意**：Toast duration 范围为 [1500, 10000]ms，超出范围取边界值。Toast 是非阻塞的轻提示，不适合展示需要用户确认的重要信息。推荐使用 `this.getUIContext().getPromptAction().showToast()` 方式调用。
