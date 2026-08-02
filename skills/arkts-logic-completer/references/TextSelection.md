# TextSelection 文本选择功能逻辑规格

## 1. 功能定位

TextSelection 是文本选择交互模式，基于 TextArea / RichEditor 的选择功能实现，用于支持用户选中文本进行复制、剪切、自定义操作等交互场景。

## 2. 典型场景

- 文本编辑器中的选中/全选/复制操作
- 富文本编辑中的选区格式化（加粗、变色等）
- 阅读器中的文本选择与标注
- 搜索高亮与选中跳转

## 3. 状态声明

```typescript
// TextArea 控制器
private textAreaController: TextAreaController = new TextAreaController()

// RichEditor 控制器
private richEditorController: RichEditorController = new RichEditorController()

// 文本内容
@State textContent: string = ''

// 选中范围
@State selectionStart: number = 0
@State selectionEnd: number = 0

// 是否有选中文本
@State hasSelection: boolean = false
```

装饰器选择：
- `@State`：文本内容和选区信息
- 控制器不需装饰器，作为 private 成员即可

## 4. 事件与交互逻辑

### TextArea 文本选择

```typescript
TextArea({ text: this.textContent, controller: this.textAreaController })
  .copyOptions(CopyOptions.LocalDevice)
  .onTextSelectionChange((start: number, end: number): void => {
    this.selectionStart = start
    this.selectionEnd = end
    this.hasSelection = start !== end
  })
  .onChange((value: string): void => {
    this.textContent = value
  })
```

### RichEditor 选区与格式化

```typescript
RichEditor({ controller: this.richEditorController })
  .onSelect((value: RichEditorSelection): void => {
    this.selectionStart = value.selection[0]
    this.selectionEnd = value.selection[1]
    this.hasSelection = this.selectionStart !== this.selectionEnd
  })
  .copyOptions(CopyOptions.LocalDevice)
```

### 程序化控制选区

```typescript
// 全选
this.textAreaController.setTextSelection(0, this.textContent.length)

// 选中指定范围
this.richEditorController.setSelection(start, end)
```

## 5. 数据结构

```typescript
interface SelectionRange {
  start: number
  end: number
}

interface TextFormatStyle {
  fontWeight?: FontWeight
  fontColor?: ResourceColor
  fontSize?: number
  decoration?: TextDecorationType
}
```

## 6. 联动说明

- 文本选中 → 弹出系统/自定义菜单（复制、剪切、粘贴）
- 选中文本变化 → 更新工具栏按钮状态（加粗、斜体等）
- 程序化选区 → 搜索关键词高亮定位
- 选中 + 格式化操作 → 修改选区内文本样式

## 7. 完整代码示例

```typescript
@Entry
@Component
struct TextSelectionDemo {
  @State content: string = '这是一段示例文本，请尝试长按选中部分文字进行复制或其他操作。ArkUI 提供了丰富的文本编辑能力。'
  @State selectionInfo: string = '未选中'
  @State hasSelection: boolean = false
  private controller: TextAreaController = new TextAreaController()

  build() {
    Column() {
      Text('文本选择示例').fontSize(20).fontWeight(FontWeight.Bold).margin({ bottom: 16 })

      TextArea({ text: this.content, controller: this.controller })
        .height(200)
        .fontSize(16)
        .copyOptions(CopyOptions.LocalDevice)
        .onTextSelectionChange((start: number, end: number): void => {
          if (start !== end) {
            this.selectionInfo = '选中范围: ' + start.toString() + ' - ' + end.toString()
            this.hasSelection = true
          } else {
            this.selectionInfo = '未选中'
            this.hasSelection = false
          }
        })
        .onChange((value: string): void => {
          this.content = value
        })
        .margin({ bottom: 16 })

      Text(this.selectionInfo)
        .fontColor(this.hasSelection ? '#007DFF' : '#999999')
        .margin({ bottom: 16 })

      Row({ space: 12 }) {
        Button('全选')
          .onClick((): void => {
            this.controller.setTextSelection(0, this.content.length)
          })

        Button('选中前10字')
          .onClick((): void => {
            let endPos: number = Math.min(10, this.content.length)
            this.controller.setTextSelection(0, endPos)
          })

        Button('取消选择')
          .onClick((): void => {
            let pos: number = this.content.length
            this.controller.setTextSelection(pos, pos)
          })
      }
      .margin({ bottom: 16 })

      Text('字符数: ' + this.content.length.toString())
        .fontColor('#999999')
    }
    .width('100%')
    .height('100%')
    .padding(16)
  }
}
```

## 8. 反面示例

```typescript
// ❌ copyOptions 设为 None，用户无法选中和复制文本
TextArea({ text: this.content })
  .copyOptions(CopyOptions.None)

// ❌ 没有创建 controller 就调用 setTextSelection
// private controller: TextAreaController  // 忘记初始化
this.controller.setTextSelection(0, 10)  // controller 为 undefined

// ❌ onTextSelectionChange 中直接操作重耗时的业务逻辑
.onTextSelectionChange((start: number, end: number): void => {
  this.fetchAnnotationsFromServer(start, end) // 高频回调中不应做网络请求
})

// ❌ RichEditor 中 onSelect 回调参数用错
.onSelect((value: RichEditorSelection): void => {
  // value.selection 是 [number, number] 元组
  this.start = value.selection  // 错误，应取 value.selection[0]
})
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `TextArea({ text, controller? })` | 创建多行输入框 |
| `RichEditor({ controller })` | 创建富文本编辑器 |
| `.copyOptions(CopyOptions)` | 控制复制粘贴能力：None / InApp / LocalDevice / CROSS_DEVICE |
| `.onTextSelectionChange((start, end) => void)` | TextArea 选区变化回调 |
| `RichEditor.onSelect((value: RichEditorSelection) => void)` | RichEditor 选区回调 |
| `TextAreaController.setTextSelection(start, end)` | 程序化设置选区 |
| `RichEditorController.setSelection(start, end)` | 程序化设置富文本选区 |
| `RichEditorController.updateSpanStyle(...)` | 更新选区内文本样式 |
| `.bindSelectionMenu(spanType, builder, responseType)` | RichEditor 自定义选择菜单 |
| `.enablePreviewText(boolean)` | 启用输入预览文本 |
