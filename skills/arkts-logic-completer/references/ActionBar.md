# ActionBar 底部操作栏功能逻辑规格

## 1. 功能定位

ActionBar 是底部操作栏模式，基于 ToolBar 高级组件实现，用于在页面底部展示针对当前内容的操作按钮（如确认、取消、删除等），适合需要主/次操作按钮的场景。

## 2. 典型场景

- 表单页底部的"提交 / 重置"双按钮
- 详情页底部的"收藏 / 加入购物车 / 立即购买"操作栏
- 多选列表底部的"全选 / 删除 / 移动"批量操作
- 编辑页底部的"保存 / 取消"操作按钮

## 3. 状态声明

```typescript
// 操作栏可见性
@State showActionBar: boolean = true

// 按钮禁用状态
@State isSubmitEnabled: boolean = false

// 多选模式下的选中数量
@State selectedCount: number = 0

// 操作栏按钮列表
@State toolbarList: ToolBarOptions = new ToolBarOptions()

// 激活态索引
@State activeIndex: number = -1
```

装饰器选择：
- `@State`：页面内部操作栏状态
- `@Prop`：父组件单向传入按钮配置
- `@Link`：与父组件双向同步选中态

## 4. 事件与交互逻辑

### ToolBarOption.action 点击事件

每个操作按钮通过 action 回调处理点击：

```typescript
import { ToolBar, ToolBarOptions, ItemState } from '@kit.ArkUI'

this.toolbarList.push({
  content: '提交',
  icon: $r('sys.media.ohos_ic_public_ok'),
  action: (): void => {
    if (!this.isSubmitEnabled) {
      return
    }
    this.handleSubmit()
  },
  state: this.isSubmitEnabled ? ItemState.ACTIVATE : ItemState.DISABLE
})
```

### 按钮状态联动

```typescript
// 表单校验通过后启用提交按钮
onFormValidChange(isValid: boolean): void {
  this.isSubmitEnabled = isValid
  this.rebuildToolbar()
}
```

## 5. 数据结构

```typescript
interface ActionBarItem {
  label: string
  icon: Resource
  action: () => void
  enabled: boolean
}

interface ActionBarConfig {
  items: ActionBarItem[]
  activeIndex: number
  visible: boolean
}
```

## 6. 联动说明

- 表单校验状态变化 → 主操作按钮 enable/disable 切换
- 多选列表选中数量变化 → 批量操作按钮文案更新（如"删除(3)"）
- 滚动到底部 → ActionBar 从隐藏变为显示（可选动画）
- 主操作完成 → ActionBar 隐藏或页面跳转

## 7. 完整代码示例

```typescript
import { ToolBar, ToolBarOptions, ItemState } from '@kit.ArkUI'

interface FormData {
  name: string
  phone: string
}

@Entry
@Component
struct ActionBarDemo {
  @State formData: FormData = { name: '', phone: '' }
  @State isSubmitEnabled: boolean = false
  @State toolbarList: ToolBarOptions = new ToolBarOptions()

  aboutToAppear(): void {
    this.rebuildToolbar()
  }

  rebuildToolbar(): void {
    this.toolbarList = new ToolBarOptions()
    this.toolbarList.push({
      content: '重置',
      icon: $r('sys.media.ohos_ic_public_restore'),
      action: (): void => {
        this.formData = { name: '', phone: '' }
        this.isSubmitEnabled = false
        this.rebuildToolbar()
      },
      state: ItemState.ENABLE
    })
    this.toolbarList.push({
      content: '提交',
      icon: $r('sys.media.ohos_ic_public_ok'),
      action: (): void => {
        console.info('提交表单: ' + this.formData.name)
      },
      state: this.isSubmitEnabled ? ItemState.ACTIVATE : ItemState.DISABLE
    })
  }

  validateForm(): void {
    this.isSubmitEnabled = this.formData.name.length > 0 && this.formData.phone.length >= 11
    this.rebuildToolbar()
  }

  build() {
    Column() {
      Column() {
        TextInput({ placeholder: '请输入姓名' })
          .onChange((value: string): void => {
            this.formData = { name: value, phone: this.formData.phone }
            this.validateForm()
          })
          .margin({ bottom: 16 })

        TextInput({ placeholder: '请输入手机号' })
          .type(InputType.PhoneNumber)
          .onChange((value: string): void => {
            this.formData = { name: this.formData.name, phone: value }
            this.validateForm()
          })
      }
      .padding(16)
      .layoutWeight(1)

      ToolBar({
        toolBarList: this.toolbarList,
        activateIndex: this.isSubmitEnabled ? 1 : -1
      })
    }
    .width('100%')
    .height('100%')
  }
}
```

## 8. 反面示例

```typescript
// ❌ 直接修改 ToolBarOptions 数组元素而不重建，UI 不刷新
this.toolbarList[0].state = ItemState.DISABLE

// ❌ action 回调没有判断 state，禁用按钮仍可执行操作
this.toolbarList.push({
  content: '删除',
  action: (): void => { this.deleteAll() },
  state: ItemState.DISABLE
})

// ❌ 超过 5 个按钮未做收纳处理，导致"更多"子项自动出现但逻辑未覆盖
// ToolBar 底部最多显示 5 个入口，超过则自动收纳到"更多"

// ❌ 使用对象展开运算符（ArkTS 不支持）
// let newItem = { ...oldItem, state: ItemState.ENABLE }
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `ToolBar({ toolBarList, activateIndex?, controller? })` | 创建底部工具栏，最多显示 5 个按钮 |
| `ToolBarOptions` | 工具栏列表，继承 Array\<ToolBarOption\>，@Observed |
| `ToolBarOption.content` | 按钮文本（ResourceStr） |
| `ToolBarOption.icon` | 按钮图标（Resource） |
| `ToolBarOption.action` | 点击回调 `() => void` |
| `ToolBarOption.state` | 按钮状态：ItemState.ENABLE / DISABLE / ACTIVATE |
| `ToolBarModifier.height(LengthMetrics)` | 自定义工具栏高度（默认 56vp） |
| `ToolBarModifier.backgroundColor(ResourceColor)` | 自定义背景色 |
| `ToolBarModifier.stateEffect(boolean)` | 是否显示按压态效果 |
| `import { ToolBar, ToolBarOptions, ItemState } from '@kit.ArkUI'` | 导入模块 |
