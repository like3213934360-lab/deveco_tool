# Dialog 弹出框功能逻辑规格

## 1. 功能定位

Dialog 是弹出框组件，用于在当前页面上方以模态窗口形式展示需要用户关注或确认的信息。当需要中断用户当前操作流程、请求确认或展示重要提示时使用。

## 2. 典型场景

- 操作确认弹框（删除、退出、重置等不可逆操作的二次确认）
- 信息提示弹框（权限申请、协议同意、版本更新通知）
- 列表选择弹框（语言切换、排序方式选择）
- 加载等待弹框（网络请求、文件上传下载进度提示）
- 自定义内容弹框（表单填写、输入验证、富内容展示）

## 3. 状态声明

```typescript
// 通用弹框控制
@State isDialogVisible: boolean = false

// 自定义弹框场景
@State dialogInputText: string = ''
@State dialogResult: string = 'idle'  // 'idle' | 'confirmed' | 'cancelled'

// 列表选择弹框
@State selectedIndex: number = -1

// 勾选确认弹框
@State isChecked: boolean = false
```

## 4. 事件与交互逻辑

### 场景一：高级 AlertDialog（确认删除）

```typescript
import { AlertDialog } from '@kit.ArkUI'

dialogControllerAlert: CustomDialogController = new CustomDialogController({
  builder: AlertDialog({
    primaryTitle: '确认删除',
    content: '删除后数据不可恢复，确定继续？',
    primaryButton: {
      value: '取消',
      action: (): void => {
        console.info('cancel clicked')
      }
    },
    secondaryButton: {
      value: '删除',
      role: ButtonRole.ERROR,
      action: (): void => {
        this.doDelete()
      }
    }
  })
})
```

### 场景二：SelectDialog（列表选择）

```typescript
import { SelectDialog } from '@kit.ArkUI'

dialogControllerSelect: CustomDialogController = new CustomDialogController({
  builder: SelectDialog({
    title: '选择语言',
    selectedIndex: this.selectedIndex,
    confirm: {
      value: '取消',
      action: (): void => {}
    },
    radioContent: [
      { title: '简体中文', action: (): void => { this.selectedIndex = 0 } },
      { title: 'English', action: (): void => { this.selectedIndex = 1 } },
      { title: '日本語', action: (): void => { this.selectedIndex = 2 } }
    ]
  })
})
```

### 场景三：LoadingDialog（加载等待）

```typescript
import { LoadingDialog } from '@kit.ArkUI'

dialogControllerLoading: CustomDialogController = new CustomDialogController({
  builder: LoadingDialog({
    content: '正在加载，请稍候...'
  })
})

async fetchData(): Promise<void> {
  this.dialogControllerLoading.open()
  try {
    await this.loadRemoteData()
  } finally {
    this.dialogControllerLoading.close()
  }
}
```

### 场景四：自定义 CustomDialog

```typescript
@CustomDialog
struct InputDialog {
  @Link inputValue: string
  controller?: CustomDialogController
  confirm: () => void = () => {}

  build() {
    Column({ space: 16 }) {
      Text('请输入备注').fontSize(20)
      TextInput({ placeholder: '备注内容', text: this.inputValue })
        .onChange((value: string): void => {
          this.inputValue = value
        })
      Row({ space: 12 }) {
        Button('取消')
          .onClick((): void => {
            if (this.controller) {
              this.controller.close()
            }
          })
        Button('确定')
          .onClick((): void => {
            if (this.controller) {
              this.confirm()
              this.controller.close()
            }
          })
      }
    }.padding(24)
  }
}
```

## 5. 数据结构

```typescript
interface DialogButtonConfig {
  value: string
  action: () => void
  fontColor?: ResourceColor
  background?: ResourceColor
  role?: ButtonRole
  buttonStyle?: ButtonStyleMode
}

interface SelectItem {
  title: string
  action: () => void
}

interface DialogConfig {
  title: string
  content: string
  primaryButton?: DialogButtonConfig
  secondaryButton?: DialogButtonConfig
  alignment?: DialogAlignment
  autoCancel?: boolean
}
```

## 6. 联动说明

- 按钮点击触发危险操作 → AlertDialog 弹出确认 → 用户确认后执行
- 网络请求开始 → LoadingDialog.open() → 请求结束 → LoadingDialog.close()
- 设置项点击 → SelectDialog 弹出选项列表 → 选择后更新设置值
- 勾选"不再提示" → ConfirmDialog 中 isChecked 联动 → 后续跳过弹框
- 页面销毁时 aboutToDisappear → 将 dialogController 置 null 避免泄漏

## 7. 完整代码示例

```typescript
import { AlertDialog, LoadingDialog } from '@kit.ArkUI'

@Entry
@Component
struct DialogDemoPage {
  @State itemList: string[] = ['文件A', '文件B', '文件C']
  @State deleteTarget: string = ''

  private deleteDialogController: CustomDialogController | null = null

  loadingDialogController: CustomDialogController = new CustomDialogController({
    builder: LoadingDialog({
      content: '正在删除...'
    })
  })

  aboutToDisappear(): void {
    this.deleteDialogController = null
    this.loadingDialogController = null as CustomDialogController
  }

  // 每次打开前重建 controller，确保 content 使用当前值
  showDeleteConfirm(name: string): void {
    this.deleteTarget = name
    this.deleteDialogController = new CustomDialogController({
      builder: AlertDialog({
        primaryTitle: '确认删除',
        content: '确定删除「' + name + '」？删除后不可恢复。',
        primaryButton: {
          value: '取消',
          action: (): void => {}
        },
        secondaryButton: {
          value: '删除',
          role: ButtonRole.ERROR,
          action: (): void => {
            this.removeItem(name)
          }
        }
      }),
      alignment: DialogAlignment.Bottom
    })
    this.deleteDialogController.open()
  }

  removeItem(name: string): void {
    this.loadingDialogController.open()
    setTimeout((): void => {
      const idx = this.itemList.indexOf(name)
      if (idx >= 0) {
        this.itemList.splice(idx, 1)
      }
      this.loadingDialogController.close()
    }, 1000)
  }

  build() {
    Column({ space: 12 }) {
      Text('文件管理')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)

      ForEach(this.itemList, (item: string) => {
        Row() {
          Text(item).fontSize(16).layoutWeight(1)
          Button('删除')
            .fontColor(Color.Red)
            .backgroundColor(Color.Transparent)
            .onClick((): void => {
              this.showDeleteConfirm(item)
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 12, bottom: 12 })
        .borderRadius(8)
        .backgroundColor('#F5F5F5')
      })

      if (this.itemList.length === 0) {
        Text('暂无文件').fontColor('#999').margin({ top: 40 })
      }
    }
    .width('100%')
    .padding(24)
  }
}
```

## 8. 反面示例

```typescript
// ❌ 没有在 aboutToDisappear 中置 null，可能导致内存泄漏
// dialogController: CustomDialogController = new CustomDialogController({...})
// 页面销毁后 controller 仍被引用

// ❌ 在页面构建过程中直接 open()，弹框位置和形状会异常
// aboutToAppear() { this.dialogController.open() }

// ❌ 危险操作直接执行，没有弹出确认弹框
Button('删除全部')
  .onClick((): void => {
    this.deleteAll()  // 用户误触直接清空
  })

// ❌ LoadingDialog 没有在 finally 中关闭，请求失败后弹框永远显示
Button('加载')
  .onClick(async (): Promise<void> => {
    this.loadingDialog.open()
    await this.fetchData()
    this.loadingDialog.close()  // 如果 fetchData 抛出异常则不会执行
  })

// ❌ CustomDialog 内使用 @Prop 监听数据变化，应使用 @Link 或 @Consume
@CustomDialog
struct BadDialog {
  @Prop value: string  // @Prop 在弹框场景下不会同步更新
}

// ❌ 在类属性初始化时用模板字符串引用 @State，content 永远是初始值
deleteDialogController: CustomDialogController = new CustomDialogController({
  builder: AlertDialog({
    content: `确定删除「${this.deleteTarget}」？`  // this.deleteTarget 在此处固定为 ''
  })
})
// ✅ 应在每次 open 前重建 controller，或使用 @CustomDialog + @Link 传递动态值
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `CustomDialogController(options)` | 创建自定义弹窗控制器 |
| `.open()` | 显示弹窗 |
| `.close()` | 关闭弹窗 |
| `TipsDialog({...})` | 带图形的提示弹出框（API 10+） |
| `SelectDialog({...})` | 列表选择弹出框（API 10+） |
| `ConfirmDialog({...})` | 信息确认弹出框（API 10+） |
| `AlertDialog({...})` | 操作确认弹出框（API 10+） |
| `LoadingDialog({...})` | 进度加载弹出框（API 10+） |
| `CustomContentDialog({...})` | 自定义内容弹出框（API 12+） |
| `PopoverDialog({...})` | 跟手弹出框（API 14+） |
| `autoCancel: boolean` | 点击遮障层是否关闭弹窗，默认 true |
| `alignment: DialogAlignment` | 弹窗对齐方式，默认 DialogAlignment.Default |
| `offset: Offset` | 弹窗位置偏移 |
| `isModal: boolean` | 是否模态窗口，默认 true（API 11+） |
| `onWillDismiss: Callback<DismissDialogAction>` | 关闭拦截回调（API 12+） |
| `cornerRadius: Dimension \| BorderRadiuses` | 背板圆角，默认 32vp（API 10+） |
| `backgroundColor: ResourceColor` | 背板颜色（API 10+） |

> **注意**：高级 Dialog 组件（TipsDialog 等）需从 `@kit.ArkUI` 导入；CustomDialogController 仅在作为 @CustomDialog struct 的成员变量时有效；页面销毁时务必将 controller 置 null。
