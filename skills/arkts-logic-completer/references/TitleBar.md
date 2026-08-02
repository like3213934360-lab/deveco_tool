# TitleBar 组件功能逻辑规格

## 1. 功能定位

TitleBar 是标题栏系列组件，包含三种变体：
- **ComposeTitleBar**：普通标题栏，支持标题、头像（可选）和副标题（可选），可配置右侧菜单图标。
- **EditableTitleBar**：编辑型标题栏，适用于多选/编辑界面，采用左叉右勾形式，左侧可配 Back/Cancel 按钮。
- **SelectTitleBar**：下拉菜单标题栏，包含下拉菜单用于页面切换，可配置返回键和右侧菜单。

三者均用于页面顶部导航区域，需从 `'@kit.ArkUI'` 导入，仅可在 Stage 模型下使用。

## 2. 典型场景

### ComposeTitleBar
- 普通页面标题（标题 + 副标题）
- 带头像的个人主页标题栏
- 带右侧操作图标的标题栏（分享、搜索、更多）

### EditableTitleBar
- 多选编辑界面（左侧取消 + 右侧确认保存）
- 内容编辑页面（左侧返回 + 右侧保存）
- 带头像的编辑标题栏

### SelectTitleBar
- 相册分类切换（所有照片/本地/储存卡）
- 邮箱账号切换（下拉选择 + 右侧操作）
- 带消息标记的页面切换

## 3. 状态声明

```typescript
import {
  ComposeTitleBar, ComposeTitleBarMenuItem,
  EditableTitleBar, EditableLeftIconType, EditableTitleBarMenuItem,
  SelectTitleBar, SelectTitleBarMenuItem,
  Prompt
} from '@kit.ArkUI'

// ComposeTitleBar 右侧菜单项（通常为固定配置）
private composeMenuItems: Array<ComposeTitleBarMenuItem> = [
  {
    value: $r('sys.media.ohos_ic_public_edit'),
    isEnabled: true,
    action: (): void => { Prompt.showToast({ message: '编辑' }) }
  }
]

// EditableTitleBar 状态
@State editMenuItems: Array<EditableTitleBarMenuItem> = []

// SelectTitleBar 状态
@State selectedIndex: number = 0
```

## 4. 事件与交互逻辑

### ComposeTitleBar：标题 + 右侧菜单

```typescript
import { ComposeTitleBar, Prompt, ComposeTitleBarMenuItem } from '@kit.ArkUI'

private menuItems: Array<ComposeTitleBarMenuItem> = [
  {
    value: $r('sys.media.ohos_ic_public_edit'),
    isEnabled: true,
    action: (): void => { Prompt.showToast({ message: '编辑' }) }
  },
  {
    value: $r('sys.media.ohos_ic_public_remove'),
    isEnabled: true,
    action: (): void => { Prompt.showToast({ message: '删除' }) }
  }
]

ComposeTitleBar({
  title: '我的页面',
  subtitle: '副标题描述',
  menuItems: this.menuItems
})
```

### ComposeTitleBar：带头像

```typescript
ComposeTitleBar({
  title: '用户昵称',
  subtitle: '个性签名',
  item: {
    isEnabled: true,
    value: $r('sys.media.ohos_app_icon')
  },
  menuItems: this.menuItems
})
```

### EditableTitleBar：编辑页面（取消 + 保存）

```typescript
import { EditableTitleBar, EditableLeftIconType, Prompt } from '@kit.ArkUI'

EditableTitleBar({
  leftIconStyle: EditableLeftIconType.Cancel,
  title: '编辑文章',
  onCancel: (): void => {
    Prompt.showToast({ message: '已取消编辑' })
  },
  onSave: (): void => {
    this.saveContent()
    Prompt.showToast({ message: '已保存' })
  }
})
```

### EditableTitleBar：带返回和自定义右侧图标

```typescript
EditableTitleBar({
  leftIconStyle: EditableLeftIconType.Back,
  title: '编辑页面',
  subtitle: '副标题',
  menuItems: [
    {
      value: $r('sys.media.ohos_ic_public_remove'),
      isEnabled: true,
      action: (): void => {
        Prompt.showToast({ message: '自定义操作' })
      }
    }
  ],
  isSaveIconRequired: true,
  onCancel: (): void => {
    this.getUIContext()?.getRouter()?.back()
  },
  onSave: (): void => {
    this.saveData()
  }
})
```

### SelectTitleBar：下拉菜单切换

```typescript
import { SelectTitleBar, Prompt, SelectTitleBarMenuItem } from '@kit.ArkUI'

SelectTitleBar({
  options: [
    { value: '所有照片' },
    { value: '本地（设备）' },
    { value: '云端' }
  ],
  selected: this.selectedIndex,
  onSelected: (index: number): void => {
    this.selectedIndex = index
    this.loadAlbum(index)
  },
  subtitle: 'example@example.com',
  menuItems: [
    {
      value: $r('sys.media.ohos_ic_public_edit'),
      isEnabled: true,
      action: (): void => { Prompt.showToast({ message: '编辑' }) }
    }
  ],
  hidesBackButton: false,
  badgeValue: 5
})
```

## 5. 数据结构

```typescript
// ComposeTitleBar 菜单项
interface ComposeTitleBarMenuItemConfig {
  value: ResourceStr
  isEnabled?: boolean
  action?: () => void
  label?: ResourceStr
}

// EditableTitleBar 菜单项
interface EditableTitleBarMenuItemConfig {
  value: ResourceStr
  isEnabled?: boolean
  action?: () => void
  label?: ResourceStr
}

// EditableTitleBar 样式选项（API 12+）
interface EditableTitleBarOptionsConfig {
  backgroundColor?: ResourceColor
  backgroundBlurStyle?: BlurStyle
  safeAreaTypes?: Array<SafeAreaType>
  safeAreaEdges?: Array<SafeAreaEdge>
}

// SelectTitleBar 菜单项
interface SelectTitleBarMenuItemConfig {
  value: ResourceStr
  isEnabled?: boolean
  action?: () => void
  label?: ResourceStr
}
```

## 6. 联动说明

### ComposeTitleBar
- 右侧 `menuItems` 的 `action` → 执行对应操作（分享/搜索/编辑）
- `item` 配置头像 → 一般用于个人信息页面
- 不支持通用属性和通用事件

### EditableTitleBar
- `leftIconStyle` 为 Cancel → 点击左侧触发 `onCancel` 回调
- `leftIconStyle` 为 Back → 点击左侧触发 `onCancel` 回调（API 12+ 统一）
- 右侧勾号 → 触发 `onSave` 回调 → 保存数据并退出编辑
- `isSaveIconRequired: false` → 隐藏右侧保存按钮
- `options.backgroundBlurStyle` → 设置标题栏背景模糊效果

### SelectTitleBar
- 下拉菜单选中 → `onSelected(index)` → 切换页面内容
- `badgeValue` > 0 → 显示消息红点数字标记
- `hidesBackButton: true` → 隐藏左侧返回箭头（通常用于一级页面）

## 7. 完整代码示例

```typescript
import {
  ComposeTitleBar, ComposeTitleBarMenuItem,
  EditableTitleBar, EditableLeftIconType,
  SelectTitleBar, SelectTitleBarMenuItem,
  Prompt
} from '@kit.ArkUI'

@Entry
@Component
struct TitleBarDemo {
  @State currentView: string = 'compose' // 'compose' | 'editable' | 'select'
  @State selectedAlbum: number = 0

  private composeMenu: Array<ComposeTitleBarMenuItem> = [
    {
      value: $r('sys.media.ohos_ic_public_edit'),
      isEnabled: true,
      action: (): void => {
        this.currentView = 'editable'
      }
    }
  ]

  private selectMenu: Array<SelectTitleBarMenuItem> = [
    {
      value: $r('sys.media.ohos_ic_public_edit'),
      isEnabled: true,
      action: (): void => {
        Prompt.showToast({ message: '编辑相册' })
      }
    }
  ]

  build() {
    Column() {
      if (this.currentView === 'compose') {
        ComposeTitleBar({
          title: '我的相册',
          subtitle: '共 128 张',
          menuItems: this.composeMenu
        })
      } else if (this.currentView === 'editable') {
        EditableTitleBar({
          leftIconStyle: EditableLeftIconType.Cancel,
          title: '选择照片',
          onCancel: (): void => {
            this.currentView = 'compose'
          },
          onSave: (): void => {
            Prompt.showToast({ message: '已保存选择' })
            this.currentView = 'compose'
          }
        })
      } else {
        SelectTitleBar({
          options: [
            { value: '所有照片' },
            { value: '本地' },
            { value: '云端' }
          ],
          selected: this.selectedAlbum,
          onSelected: (index: number): void => {
            this.selectedAlbum = index
          },
          menuItems: this.selectMenu,
          hidesBackButton: true
        })
      }

      // 内容区占位
      Column() {
        Text('内容区域')
          .fontSize(18)
          .fontColor('#999')
      }
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
      .width('100%')

      Row({ space: 16 }) {
        Button('普通标题栏')
          .onClick((): void => { this.currentView = 'compose' })
        Button('编辑标题栏')
          .onClick((): void => { this.currentView = 'editable' })
        Button('下拉标题栏')
          .onClick((): void => { this.currentView = 'select' })
      }
      .padding(16)
    }
    .width('100%')
    .height('100%')
  }
}
```

## 8. 反面示例

```typescript
// ❌ ComposeTitleBar 入参传 undefined 会崩溃
ComposeTitleBar(undefined)

// ❌ EditableTitleBar 没有设置 onSave，点击保存无响应
EditableTitleBar({
  leftIconStyle: EditableLeftIconType.Cancel,
  title: '编辑'
  // 缺少 onSave 回调
})

// ❌ SelectTitleBar 未设置 options，下拉菜单无内容
SelectTitleBar({
  options: [],  // 空数组，无意义
  selected: 0
})

// ❌ 在标题栏上设置通用属性，可能不生效
ComposeTitleBar({ title: '标题' })
  .backgroundColor(Color.Red)  // 不建议

// ❌ menuItems 的 isEnabled 为 false 却期望点击有响应
ComposeTitleBar({
  title: '标题',
  menuItems: [{
    value: $r('sys.media.ohos_ic_public_edit'),
    isEnabled: false,  // 禁用状态
    action: (): void => { /* 不会触发 */ }
  }]
})

// ❌ SelectTitleBar badgeValue 传负数，标记不显示
SelectTitleBar({
  options: [{ value: 'A' }],
  selected: 0,
  badgeValue: -1  // 不显示
})
```

## 9. API 速查

### ComposeTitleBar

| API | 说明 |
|-----|------|
| `ComposeTitleBar({ title, subtitle?, item?, menuItems? })` | 创建普通标题栏 |
| `title` | 标题（必填） |
| `subtitle` | 副标题 |
| `item` | 左侧头像配置 |
| `menuItems` | 右侧菜单项目数组，每项含 value/isEnabled/action |

### EditableTitleBar

| API | 说明 |
|-----|------|
| `EditableTitleBar({ leftIconStyle, title, ... })` | 创建编辑型标题栏 |
| `leftIconStyle` | 左侧按钮类型：EditableLeftIconType.Back / Cancel |
| `title` | 标题（必填） |
| `subtitle` | 副标题（API 12+） |
| `imageItem` | 左侧头像（API 12+） |
| `menuItems` | 右侧自定义菜单项 |
| `isSaveIconRequired` | 是否显示右侧保存按钮，默认 true（API 12+） |
| `onSave` | 保存按钮回调 |
| `onCancel` | 左侧按钮（返回/取消）回调 |
| `options` | 标题栏样式（背景色/模糊/安全区域，API 12+） |
| `contentMargin` | 外边距（API 12+） |

### SelectTitleBar

| API | 说明 |
|-----|------|
| `SelectTitleBar({ selected, options, ... })` | 创建下拉菜单标题栏 |
| `selected` | 当前选中项索引（@Prop） |
| `options` | 下拉菜单项数组 |
| `menuItems` | 右侧菜单项目数组 |
| `subtitle` | 子标题 |
| `badgeValue` | 消息标记数字，≤0 不显示，最大 99 |
| `hidesBackButton` | 是否隐藏返回箭头，默认 false |
| `onSelected` | 选中项回调 |

> **注意**：三种标题栏都不支持通用属性和通用事件。入参不可为 undefined。所有标题栏组件仅可在 Stage 模型下使用，需从 `'@kit.ArkUI'` 导入。
