# HdsNavigation 组件功能逻辑规格

> HDS (UI Design Kit) 组件。对应 ArkUI 基础组件 `Navigation`（基础 Reference 待建，见 [TODO.md P1](../TODO.md)）。当项目已接入 `@kit.UIDesignKit`，优先使用 HdsNavigation 以获得官方标题栏动态模糊、滚动联动和 6.1 材质效果。
> 华为官方原文：[../../../hds参考文档/中文文档/HdsNavigation.md](../../../hds参考文档/中文文档/HdsNavigation.md)；迁移模式摘要见 [../../../hds参考文档/references/migration-patterns.md](../../../hds参考文档/references/migration-patterns.md)。

## 1. 功能定位

HdsNavigation 是 HDS 路由导航的根视图容器，一般作为 Page 页面的根容器使用，内部默认包含**标题栏 + 内容区 + 工具栏**三段区域。

相比原生 `Navigation`，HdsNavigation 额外提供：

- 标题栏随内容区滚动的**动态模糊**样式（COMMON_BLUR / GRADUAL_BLUR / GRADIENT_BLUR）
- `bindToScrollable` / `bindToNestedScrollable` 把内容滚动容器和标题栏绑定，获得更优的动态显隐
- 4 种标题栏模式：FREE（随内容缩放）/ FULL（固定大标题）/ MINI（固定小标题）/ MODAL（半模态）
- 分栏（Split）下的导航栏宽度范围、拖拽条等能力
- 6.1 开始的 Badge 图标菜单、应用内多窗入口等

**起始版本**：5.1.0 (API 18)，6.0.0 (API 20) 大量新增属性。

## 2. 典型场景

- 单 Page 应用的根容器：HdsNavigation + NavPathStack + HdsNavDestination 组成声明式路由
- 列表/图文详情页：内容可滚动，标题栏需要随滚动产生模糊/渐隐
- 一级首页：标题栏菜单带消息数 Badge（如"云空间 99+"）
- 平板/折叠屏：mode(NavigationMode.Auto) 自适应单双栏
- 半模态卡片：`titleMode(HdsNavigationTitleMode.MODAL)` + `bindSheet` 组合

## 3. 状态声明

```typescript
import {
  HdsNavigation,
  HdsNavigationTitleMode,
  ScrollEffectType,
  HdsNavigationMenuContentOptions
} from '@kit.UIDesignKit'
import { LengthMetrics } from '@kit.ArkUI'

@Entry
@Component
struct NavPage {
  @Provide('pageInfos') pageInfos: NavPathStack = new NavPathStack()

  private scroller: Scroller = new Scroller()

  @State titleMode: HdsNavigationTitleMode = HdsNavigationTitleMode.FREE
  @State unreadCount: number = 0
  @State isNavBarHidden: boolean = false
  @State currentMode: NavigationMode = NavigationMode.Auto
}
```

> - `pageInfos` 用 `@Provide` 下发，子 HdsNavDestination 可以 `@Consume` 拿到同一个栈。
> - `titleMode` 是枚举类型，不要用 `'FREE' | 'FULL'` 联合字面量（违反 ArkTS 语法限制第 5 条）。
> - `scroller` 作为普通成员声明，不加 `@State`（控制器对象不需要触发刷新）。

## 4. 事件与交互逻辑

### 路由压栈：跳转到详情页

```typescript
Button('查看详情')
  .onClick((): void => {
    this.pageInfos.pushPath({ name: 'detail', param: 'item-123' })
  })
```

### 标题栏菜单点击 + 异步刷新消息数

```typescript
private buildMenu(): HdsNavigationMenuContentOptions {
  return {
    value: [
      {
        content: {
          label: 'notification',
          icon: $r('sys.symbol.bell'),
          isEnabled: true,
          action: (): void => {
            this.openNotificationPage()
          }
        },
        badge: {
          count: this.unreadCount
        }
      }
    ],
    maxCount: 3
  }
}

private openNotificationPage(): void {
  this.unreadCount = 0
  this.pageInfos.pushPath({ name: 'notification' })
}
```

### 导航栏/模式切换事件

```typescript
HdsNavigation(this.pageInfos) {
  // ...
}
  .onNavBarStateChange((isVisible: boolean): void => {
    this.isNavBarHidden = !isVisible
  })
  .onNavigationModeChange((mode: NavigationMode): void => {
    this.currentMode = mode
  })
  .onTitleModeChange((mode: HdsNavigationTitleMode): void => {
    this.titleMode = mode
  })
```

### 滚动联动：内容滚动时标题栏动态显隐

```typescript
HdsNavigation(this.pageInfos) {
  Scroll(this.scroller) {
    Column() {
      Blank().height(138)
      ForEach(this.dataList, (row: FeedItem): void => {
        FeedCard({ data: row })
      }, (row: FeedItem): string => row.id)
    }
  }
  .scrollBar(BarState.Off)
  .edgeEffect(EdgeEffect.Spring)
}
  .bindToScrollable([this.scroller])
  .dynamicHideTitleBar({
    hideTitleArea: true,
    hideBottomBuilder: false,
    hideStatusBar: false,
    mode: HideMode.SCROLL_UP_TO
  })
```

> 注意：`dynamicHideTitleBar` 在 `HdsNavigationTitleMode.MODAL` 下不生效。

## 5. 数据结构

```typescript
// 路由参数（pushPath 时传入，自定义业务字段必须用 interface 兜底）
interface RouteArg {
  itemId: string
  source?: string
}

// 列表数据（用于内容区 ForEach）
interface FeedItem {
  id: string
  title: string
  coverUrl: string
}

// 标题栏菜单按钮的业务描述（转换成 HdsNavigationIconOptions 之前）
interface MenuAction {
  key: string
  label: string
  icon: Resource
  badgeCount: number
  onTap: () => void
}
```

## 6. 联动说明

### 内容滚动 ↔ 标题栏

- `bindToScrollable([scroller])` → 内容区向上滚 → 标题栏按 `scrollEffectOpts` 渐显模糊
- `dynamicHideTitleBar({ mode: HideMode.SCROLL_UP_TO })` → 滚到固定距离后标题栏整体隐藏
- `onTitleModeChange` → 当 `titleMode` 为 FREE 时，拿到 FULL→MINI 的实时回调，用于联动子组件

### 路由栈 ↔ 页面状态

- `pageInfos.pushPath({ name, param })` → 触发 `navDestination` Builder → 渲染对应 HdsNavDestination
- `pageInfos.pop()` → 回到上一页（系统手势返回也走同一路径）
- 子页面用 `@Consume('pageInfos') pageInfos` 拿到同一个栈

### 分栏模式 ↔ 布局

- `mode(NavigationMode.Auto)` → 宽屏自动切 Split，窄屏自动切 Stack
- `onNavigationModeChange` → 回调里根据 Split/Stack 调整列表布局（如主从视图）
- `navBarWidth` / `navBarWidthRange` / `minContentWidth` 协同决定分栏比例

### 菜单消息 ↔ 业务状态

- 业务层消息数 → `@State unreadCount` → `menu.value[i].badge.count`
- 点击图标 → `content.action` → 清零 + 跳转

## 7. 完整代码示例

```typescript
import {
  HdsNavigation,
  HdsNavigationTitleMode,
  HdsNavigationMenuContentOptions,
  ScrollEffectType,
  HideMode
} from '@kit.UIDesignKit'
import { LengthMetrics } from '@kit.ArkUI'

interface FeedItem {
  id: string
  title: string
  summary: string
}

interface RouteArg {
  itemId: string
}

@Entry
@Component
struct HomePage {
  @Provide('pageInfos') pageInfos: NavPathStack = new NavPathStack()

  private scroller: Scroller = new Scroller()

  @State feedList: FeedItem[] = []
  @State unreadCount: number = 0
  @State isLoading: boolean = false

  aboutToAppear(): void {
    this.loadFeeds()
  }

  private loadFeeds(): void {
    this.isLoading = true
    setTimeout((): void => {
      const list: FeedItem[] = []
      for (let i = 0; i < 20; i++) {
        list.push({
          id: `id_${i}`,
          title: `条目 ${i + 1}`,
          summary: '摘要文案'
        })
      }
      this.feedList = list
      this.unreadCount = 5
      this.isLoading = false
    }, 300)
  }

  private openDetail(id: string): void {
    const arg: RouteArg = { itemId: id }
    this.pageInfos.pushPath({ name: 'detail', param: arg })
  }

  private buildMenu(): HdsNavigationMenuContentOptions {
    return {
      value: [
        {
          content: {
            label: 'bell',
            icon: $r('sys.symbol.bell'),
            isEnabled: true,
            action: (): void => {
              this.unreadCount = 0
              this.pageInfos.pushPath({ name: 'notification' })
            }
          },
          badge: {
            count: this.unreadCount
          }
        }
      ],
      maxCount: 3
    }
  }

  build() {
    HdsNavigation(this.pageInfos) {
      if (this.isLoading && this.feedList.length === 0) {
        Column() {
          LoadingProgress().width(32).height(32)
          Text('加载中...').margin({ top: 8 }).fontColor('#999')
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      } else {
        Scroll(this.scroller) {
          Column() {
            Blank().height(138)
            ForEach(this.feedList, (row: FeedItem): void => {
              Column() {
                Text(row.title).fontSize(16).fontWeight(FontWeight.Medium)
                Text(row.summary).fontSize(14).fontColor('#666').margin({ top: 4 })
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding(16)
              .onClick((): void => {
                this.openDetail(row.id)
              })
            }, (row: FeedItem): string => row.id)
          }
        }
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.Spring)
      }
    }
    .titleBar({
      style: {
        scrollEffectOpts: {
          enableScrollEffect: true,
          scrollEffectType: ScrollEffectType.COMMON_BLUR,
          blurEffectiveStartOffset: LengthMetrics.vp(0),
          blurEffectiveEndOffset: LengthMetrics.vp(20)
        }
      },
      content: {
        title: { mainTitle: '首页', subTitle: '最新内容' },
        menu: this.buildMenu()
      }
    })
    .titleMode(HdsNavigationTitleMode.FREE)
    .mode(NavigationMode.Auto)
    .bindToScrollable([this.scroller])
    .dynamicHideTitleBar({
      hideTitleArea: true,
      hideBottomBuilder: false,
      hideStatusBar: false,
      mode: HideMode.SCROLL_UP_TO
    })
    .navDestination((name: string, pageInfos: Object): void => {
      // 按 name 路由到不同 HdsNavDestination（此处示意）
    })
  }
}
```

**ArkTS 合规检查清单**：
- [x] 箭头函数参数和返回值都有显式类型标注（`(row: FeedItem): void`、`(row: FeedItem): string`）
- [x] 没有对象展开运算符；`RouteArg` 对象用具名 interface 构造
- [x] 没有 `get` 访问器；`buildMenu()` 是普通方法调用时加 `()`
- [x] `@State titleMode` 用枚举 `HdsNavigationTitleMode` 而非 `'FREE' | 'FULL'` 联合字面量
- [x] `FeedItem` / `RouteArg` / `MenuAction` 都有 interface 定义

## 8. 反面示例

```typescript
// ❌ 缺少 NavPathStack，路由能力失效
HdsNavigation() {
  // 子组件
}

// ❌ @State 用联合字面量而非枚举（编译报错）
@State titleMode: 'FREE' | 'FULL' = 'FREE'

// ❌ 直接对 menu 对象展开（arkts-no-spread）
const menuConfig = { ...this.baseMenu, value: [newItem] }

// ❌ bindToScrollable 的 scroller 必须与内部 Scroll 实际控制器一致，否则动效不生效
HdsNavigation(this.pageInfos) {
  Scroll(new Scroller()) { /* ... */ }   // 新实例
}
  .bindToScrollable([this.scroller])     // 传的却是另一个 scroller

// ❌ titleMode 为 MODAL 时还配 dynamicHideTitleBar（配置被静默忽略）
HdsNavigation()
  .titleMode(HdsNavigationTitleMode.MODAL)
  .dynamicHideTitleBar({ hideTitleArea: true })

// ❌ menu.badge.count 为负数（不显示标记，容易让调用方误以为功能坏了）
{ badge: { count: -1 } }

// ❌ recoverable 配了但没设置 id（接口无效）
HdsNavigation().recoverable(true)
// 应该配合 .id('home_nav') 使用

// ❌ 忘记在父组件用 @Provide 下发 pageInfos，子 HdsNavDestination 里 @Consume 拿不到栈
```

## 9. API 速查

### 构造与基础属性

| API | 说明 |
|-----|------|
| `HdsNavigation(pathInfos?: NavPathStack)` | 创建导航根容器，`pathInfos` 为路由栈；不传则无法使用声明式路由 |
| `.titleBar(options?: HdsNavigationTitleBarOptions)` | 配置标题栏的 padding / style / content |
| `.titleMode(value: HdsNavigationTitleMode)` | 标题模式：FREE / FULL / MINI / MODAL，默认 FREE |
| `.toolbarConfiguration(value, options?)` | 底部工具栏（ToolbarItem 数组或 CustomBuilder）|
| `.hideTitleBar(hide, animated?)` | 隐藏标题栏，可配动画 |
| `.hideToolBar(hide, animated?)` | 隐藏工具栏 |
| `.hideBackButton(value)` | 仅 `HdsNavigationTitleMode.MINI` 下生效 |
| `.hideNavBar(value)` | 隐藏整个导航栏（连同内容区占位）|
| `.mode(value: NavigationMode)` | Stack / Split / Auto；默认 Auto |
| `.navBarWidth(value)` / `.navBarWidthRange(...)` / `.minContentWidth(...)` | 分栏布局相关（API 18）|

### 滚动联动与样式（API 20+）

| API | 说明 |
|-----|------|
| `.bindToScrollable(scrollers: Array<Scroller>)` | 绑定内容滚动容器，标题栏联动显隐与模糊（API 20）|
| `.bindToNestedScrollable(scrollers: Array<NestedScrollInfo>)` | 嵌套滚动场景下的绑定（API 20）|
| `.dynamicHideTitleBar(value: DynamicHideParams)` | 标题栏动态隐藏，支持 SCROLL_UP / SCROLL_UP_TO / SCROLL_DOWN 等模式（API 20）|
| `.enableDragBar(isEnabled)` | 分栏场景拖拽条开关（API 20）|
| `.enableModeChangeAnimation(isEnabled)` | 单双栏切换动效开关（API 20）|
| `.systemBarStyle(original, scrollEffect)` | 配合滚动的状态栏样式（API 18）|
| `.recoverable(value)` | 页面栈可恢复（需配合 `.id()`）（API 18）|
| `.customNavContentTransition(delegate)` | 自定义转场动画（API 20）|
| `.navDestination(builder)` | 根据 name 构造 HdsNavDestination（API 18）|

### 事件

| API | 说明 |
|-----|------|
| `.onNavBarStateChange(callback: Callback<boolean>)` | 导航栏显隐回调 |
| `.onNavigationModeChange(callback: Callback<NavigationMode>)` | 单双栏切换回调 |
| `.onTitleModeChange(callback: Callback<HdsNavigationTitleMode>)` | 仅在 FREE 模式下，标题从 FULL→MINI 的回调（API 20）|

### 关键枚举

| 枚举 | 取值 | 典型场景 |
|------|------|--------|
| `HdsNavigationTitleMode` | FREE / FULL / MINI / MODAL | 列表页用 FREE；一级页面用 FULL；子页用 MINI；卡片浮层用 MODAL |
| `ScrollEffectType` | COMMON_BLUR / GRADUAL_BLUR / GRADIENT_BLUR | 非沉浸/沉浸切换/沉浸式页面三种模糊等级 |
| `HideMode` | SCROLL_UP / SCROLL_UP_TO / SCROLL_DOWN / SCROLL_UP_TO_BLEND_SCROLL_UP | 动态隐藏策略 |

> **迁移提示**：从 `Navigation` 平替到 `HdsNavigation` 通常只需换组件名和导入源（`@kit.UIDesignKit`），路由栈、NavPathStack、子组件 HdsNavDestination 的用法保持一致；但要注意 `toolbarConfiguration` 下 `SymbolGlyphModifier` 不支持 `fontSize` / `effectStrategy` / `symbolEffect` 属性修改图标大小/动效。
