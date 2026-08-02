# Toolbar 组件功能逻辑规格

## 1. 功能定位

本文的 `ToolBar` = **`@ohos.arkui.advanced.ToolBar`**（ArkUI 高级组件，从 `@kit.ArkUI` 导入），对应官方文档 [`docs/zh-cn/.../ohos-arkui-advanced-ToolBar.md`](../../../docs/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ohos-arkui-advanced-ToolBar.md)。它是工具栏组件，用于在界面底部展示针对当前界面内容的操作选项：底部最多显示 5 个入口，超过则自动收纳入"更多"子项中。每个子项支持图标、文本、状态（启用/禁用/激活）及点击事件。

> **三义性辨析（别混淆）**：HarmonyOS 生态中至少有 3 个名字相近的"工具栏"概念，务必区分：
>
> | 名称 | 来源 | 本 Skill 状态 | 识别特征 |
> |------|------|-------------|---------|
> | **`ToolBar`**（本文件） | `@kit.ArkUI`（`@ohos.arkui.advanced.ToolBar`，高级组件） | ✅ 收录 | 导入 `import { ToolBar, ToolBarOptions, ItemState } from '@kit.ArkUI'`；独立组件；底部 5 入口 + `TabsController`；用 `@ObjectLink` 的 `ToolBarOptions` 喂数据 |
> | `HdsToolBar` | `@kit.UIDesignKit` | ❌ 不收录（L3 禁区） | 顶部悬浮工具栏，**内部 API**，见 [SKILL.md §6](../SKILL.md#6-api-必须可在官方网站找到权威性优先级)。用户代码出现时不要保留或套字段 |
> | `Navigation.toolbar()` / `NavDestination.toolbarConfiguration()` | 通用属性（不是独立组件） | —— | `Navigation` / `NavDestination` 上的**属性方法**，不是独立组件；参数是一组工具按钮配置。若要用，查 `Navigation` / `NavDestination` 文档 |
>
> **选型口诀**：
> - 用户想要"**底部多操作栏**（剪切/复制/粘贴/分享）" → `ToolBar`（本文件）
> - 用户想要"**顶部沉浸式悬浮栏**" → 目前无对外方案，**不要**写 `HdsToolBar`
> - 用户在 `Navigation` / `NavDestination` 里想挂工具栏 → 用组件自带的 `.toolbar()` / `.toolbarConfiguration()` 属性，不用本组件



## 2. 典型场景

- 文本编辑器底部工具栏（剪切/复制/粘贴/全选）
- 文件管理器底部操作栏（分享/移动/删除/重命名）
- 图片查看器底部工具栏（编辑/收藏/分享/删除/更多）
- 内容详情页底部操作栏（收藏/评论/转发）

## 3. 状态声明

```typescript
import { ToolBar, ToolBarOptions, ItemState } from '@kit.ArkUI'

// 工具栏列表（@Observed 数组，需在 aboutToAppear 中初始化）
@State toolBarList: ToolBarOptions = new ToolBarOptions()

// 当前激活项索引，-1 表示无激活
@State activateIndex: number = -1

// 工具栏控制器（必传但不控制子项）
private controller: TabsController = new TabsController()
```

## 4. 事件与交互逻辑

### 场景一：基础工具栏

```typescript
aboutToAppear(): void {
  this.toolBarList.push({
    content: '剪切',
    icon: $r('sys.media.ohos_ic_public_share'),
    action: (): void => {
      this.handleCut()
    }
  })
  this.toolBarList.push({
    content: '复制',
    icon: $r('sys.media.ohos_ic_public_copy'),
    action: (): void => {
      this.handleCopy()
    }
  })
  this.toolBarList.push({
    content: '粘贴',
    icon: $r('sys.media.ohos_ic_public_paste'),
    action: (): void => {
      this.handlePaste()
    },
    state: ItemState.ACTIVATE
  })
}

ToolBar({
  toolBarList: this.toolBarList,
  activateIndex: 2,
  controller: this.controller
})
```

### 场景二：部分禁用

```typescript
this.toolBarList.push({
  content: '粘贴',
  icon: $r('sys.media.ohos_ic_public_paste'),
  action: (): void => {},
  state: ItemState.DISABLE
})
```

### 场景三：自定义工具栏样式（API 13+）

```typescript
import { ToolBar, ToolBarOptions, ToolBarModifier, DividerModifier, LengthMetrics } from '@kit.ArkUI'

private toolBarModifier: ToolBarModifier = new ToolBarModifier()
  .height(LengthMetrics.vp(52))
  .backgroundColor(Color.Transparent)
  .stateEffect(false)

@State dividerModifier: DividerModifier = new DividerModifier().height(0)

ToolBar({
  toolBarList: this.toolBarList,
  activateIndex: 0,
  controller: this.controller,
  toolBarModifier: this.toolBarModifier,
  dividerModifier: this.dividerModifier
})
```

### 场景四：Symbol 图标（API 13+）

```typescript
import { SymbolGlyphModifier } from '@kit.ArkUI'

this.toolBarList.push({
  content: '收藏',
  icon: $r('sys.media.ohos_ic_public_share'),
  action: (): void => {},
  state: ItemState.ACTIVATE,
  toolBarSymbolOptions: {
    normal: new SymbolGlyphModifier($r('sys.symbol.ohos_star'))
      .fontColor([Color.Gray]),
    activated: new SymbolGlyphModifier($r('sys.symbol.ohos_star'))
      .fontColor([Color.Orange])
  }
})
```

## 5. 数据结构

```typescript
// 工具栏子项配置
interface ToolBarItemConfig {
  content: ResourceStr
  action?: () => void
  icon?: Resource
  state?: ItemState               // ENABLE(1) | DISABLE(2) | ACTIVATE(3)
  iconColor?: ResourceColor
  activatedIconColor?: ResourceColor
  textColor?: ResourceColor
  activatedTextColor?: ResourceColor
  toolBarSymbolOptions?: ToolBarSymbolConfig
}

// Symbol 图标配置
interface ToolBarSymbolConfig {
  normal?: SymbolGlyphModifier
  activated?: SymbolGlyphModifier
}

// 工具栏样式（API 13+）
// ToolBarModifier 链式调用:
//   .height(LengthMetrics)
//   .backgroundColor(ResourceColor)
//   .padding(LengthMetrics)      仅 item < 5 个时生效
//   .stateEffect(boolean)        按压态效果
```

## 6. 联动说明

- `toolBarList` 是 @Observed 数组，通过 `push` 在 `aboutToAppear` 中添加子项
- `activateIndex` 设为某个索引 → 该子项呈现激活态高亮样式
- 子项 `state` 为 `ItemState.DISABLE` → 变灰不可点击
- 子项 `state` 为 `ItemState.ACTIVATE` → 呈现激活态颜色
- 子项超过 5 个 → 前 4 个显示，第 5 个变为"更多"入口，点击弹出剩余选项
- `toolBarSymbolOptions` 有传入时 `icon` 不生效
- `toolBarModifier.padding` 仅在子项数量 < 5 时生效
- 不建议在 ToolBar 上设置通用属性和通用事件

## 7. 完整代码示例

```typescript
import { ToolBar, ToolBarOptions, ToolBarModifier, ItemState, LengthMetrics, Prompt } from '@kit.ArkUI'

@Entry
@Component
struct ToolBarDemo {
  @State toolBarList: ToolBarOptions = new ToolBarOptions()
  @State activateIndex: number = -1
  private controller: TabsController = new TabsController()

  aboutToAppear(): void {
    this.toolBarList.push({
      content: '收藏',
      icon: $r('sys.media.ohos_ic_public_share'),
      action: (): void => {
        this.activateIndex = 0
        Prompt.showToast({ message: '已收藏' })
      }
    })
    this.toolBarList.push({
      content: '评论',
      icon: $r('sys.media.ohos_ic_public_copy'),
      action: (): void => {
        this.activateIndex = 1
        Prompt.showToast({ message: '打开评论' })
      }
    })
    this.toolBarList.push({
      content: '分享',
      icon: $r('sys.media.ohos_ic_public_paste'),
      action: (): void => {
        Prompt.showToast({ message: '分享成功' })
      }
    })
    this.toolBarList.push({
      content: '删除',
      icon: $r('sys.media.ohos_ic_public_remove'),
      action: (): void => {
        Prompt.showToast({ message: '已删除' })
      },
      state: ItemState.ENABLE
    })
  }

  build() {
    Column() {
      Column() {
        Text('文章详情页')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .padding(24)

        Text('这里是文章正文内容区域，工具栏固定在底部。')
          .fontSize(16)
          .padding({ left: 24, right: 24 })
          .fontColor('#666')
      }
      .layoutWeight(1)
      .width('100%')

      ToolBar({
        toolBarList: this.toolBarList,
        activateIndex: this.activateIndex,
        controller: this.controller
      })
    }
    .width('100%')
    .height('100%')
  }
}
```

## 8. 反面示例

```typescript
// ❌ 直接用数组字面量而非 new ToolBarOptions()
@State toolBarList: ToolBarOptions = [
  { content: '剪切', action: (): void => {} }
]  // ToolBarOptions 继承 Array 但需通过 new 创建

// ❌ 忘记在 aboutToAppear 中初始化 toolBarList
@State toolBarList: ToolBarOptions = new ToolBarOptions()
build() {
  ToolBar({
    toolBarList: this.toolBarList,  // 空列表，工具栏无内容
    controller: this.controller
  })
}

// ❌ 没有传 controller 参数
ToolBar({
  toolBarList: this.toolBarList
  // 缺少 controller，编译报错
})

// ❌ 禁用态子项设置了 action 但期望能点击
this.toolBarList.push({
  content: '粘贴',
  state: ItemState.DISABLE,
  action: (): void => { this.paste() }  // 禁用态不会触发 action
})

// ❌ 工具栏上设置通用属性
ToolBar({ ... })
  .backgroundColor(Color.White)  // 不建议，应使用 toolBarModifier

// ❌ toolBarSymbolOptions 和 icon 同时设置，icon 不生效
this.toolBarList.push({
  content: '收藏',
  icon: $r('sys.media.ohos_ic_public_share'),     // 不生效
  toolBarSymbolOptions: {
    normal: new SymbolGlyphModifier($r('sys.symbol.ohos_star'))
  }
})
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `ToolBar({ toolBarList, activateIndex?, controller, dividerModifier?, toolBarModifier? })` | 创建底部工具栏 |
| `ToolBarOptions` | 工具栏选项数组（@Observed，继承 Array），需 `new` 创建后 `push` |
| `ToolBarOption.content` | 子项文本（必填） |
| `ToolBarOption.icon` | 子项图标 |
| `ToolBarOption.action` | 子项点击事件 |
| `ToolBarOption.state` | 子项状态：ItemState.ENABLE / DISABLE / ACTIVATE |
| `ToolBarOption.iconColor` | 图标颜色（API 13+） |
| `ToolBarOption.activatedIconColor` | 激活态图标颜色（API 13+） |
| `ToolBarOption.textColor` | 文本颜色（API 13+） |
| `ToolBarOption.activatedTextColor` | 激活态文本颜色（API 13+） |
| `ToolBarOption.toolBarSymbolOptions` | Symbol 图标配置（API 13+） |
| `activateIndex` | 激活态子项索引，-1 表示无激活 |
| `ToolBarModifier.height(LengthMetrics)` | 工具栏高度，默认 56vp（API 13+） |
| `ToolBarModifier.backgroundColor(ResourceColor)` | 工具栏背景色（API 13+） |
| `ToolBarModifier.padding(LengthMetrics)` | 左右内边距，仅 item < 5 时生效（API 13+） |
| `ToolBarModifier.stateEffect(boolean)` | 是否显示按压态效果（API 13+） |
| `DividerModifier` | 分割线样式修饰器（API 13+） |

> **注意**：ToolBar 底部最多显示 5 个入口，超过自动收纳。ToolBarOptions 需通过 `new ToolBarOptions()` 创建并在 `aboutToAppear` 中 `push` 初始化。不支持通用属性和通用事件，样式通过 ToolBarModifier 定制。该组件仅可在 Stage 模型下使用，需从 `'@kit.ArkUI'` 导入。
