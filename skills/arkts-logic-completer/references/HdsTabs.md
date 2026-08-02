# HdsTabs 组件功能逻辑规格

> HDS (UI Design Kit) 组件。对应 ArkUI 基础组件 `Tabs`（基础 Reference 尚未单独落地，迁移摘要见资料目录 [../../../hds参考文档/references/components.md](../../../hds参考文档/references/components.md) 的 HdsTabs 一节）。
> 华为官方原文：[../../../hds参考文档/中文文档/HdsTabs.md](../../../hds参考文档/中文文档/HdsTabs.md)。
> HdsTabs 继承自 `Tabs`，**子组件仍为 `TabContent`**（不需要改为 HdsTabContent），但**控制器必须换成 `HdsTabsController`**。

## 1. 功能定位

HdsTabs 是 HDS 版本的 Tabs 容器，通常作为 Page 根容器或大区块容器使用。相比原生 `Tabs`，它额外提供：

- 分割线样式：常显 / 常隐 / 跟手渐变（`DividerMode.VISIBLE / NONE / FOLLOW_SCROLL`）
- 渐变模糊样式：`barBackgroundStyle({ maskColor, maskHeight })` 实现页签栏内容过渡渐隐
- 半屏居中布局：`barMode(ExtendBarMode.HALF_SCREEN_FIXED)`，侧边栏场景（平板/折叠屏）下页签整体居中
- 出血图标：`.tabBar(bleedIconStyle((): void => this.builder()))` 让图标可溢出 TabBar
- 控制器滚动绑定：`HdsTabsController.bindScroller(index, scroller)` 让分割线/模糊效果跟手跟上内容滚动

**起始版本**：6.0.0 (API 20)。TV 设备暂不支持。

## 2. 典型场景

- App 底部导航：4-5 个底部页签（首页/发现/消息/我的），配合 `BottomTabBarStyle`
- 一级页面顶部标签：横向 Tabs，搭配可滚动内容 + 跟手分割线
- 侧边栏：`vertical(true)` + `HALF_SCREEN_FIXED`，平板/展开折叠屏用
- 沉浸页图片叠加：`barOverlap(true)` + `barBackgroundStyle` 让页签栏浮在图片上做渐变模糊

## 3. 状态声明

```typescript
import {
  HdsTabs,
  HdsTabsController,
  DividerMode,
  ExtendBarMode
} from '@kit.UIDesignKit'
import { SymbolGlyphModifier } from '@kit.ArkUI'

@Entry
@Component
struct TabsPage {
  private controller: HdsTabsController = new HdsTabsController()
  private feedScroller: Scroller = new Scroller()
  private discoverScroller: Scroller = new Scroller()

  @State currentIndex: number = 0
  @State dividerMode: DividerMode = DividerMode.FOLLOW_SCROLL
}
```

> - `controller` / 两个 `Scroller` 都是普通成员，不要加 `@State`。
> - `dividerMode` 是枚举，不要写成 `'VISIBLE' | 'NONE' | 'FOLLOW_SCROLL'` 联合字面量（ArkTS 硬红线）。
> - `currentIndex` 用 `@State` 是因为要和 TabBar 双向绑定、与业务联动。

## 4. 事件与交互逻辑

### 启动时绑定 scroller，让 TabBar 知道当前页签滚动状态

```typescript
aboutToAppear(): void {
  this.controller.bindScroller(0, this.feedScroller)
  this.controller.bindScroller(1, this.discoverScroller)
}

aboutToDisappear(): void {
  this.controller.unbindScroller(this.feedScroller)
  this.controller.unbindScroller(this.discoverScroller)
}
```

### 页签切换 + 上报埋点

```typescript
HdsTabs({ controller: this.controller }) {
  // TabContent 定义见第 7 节
}
  .onChange((index: number): void => {
    this.currentIndex = index
    this.reportTabSwitch(index)
  })
  .onTabBarClick((index: number): void => {
    // 点击式切换（含键盘方向键）
  })
  .onContentWillChange((from: number, to: number): boolean => {
    // 返回 false 可以拦截切换（如未保存表单警示）
    return true
  })
```

### 用户按钮控制分割线模式

```typescript
Button('跟手分割线')
  .onClick((): void => {
    this.dividerMode = DividerMode.FOLLOW_SCROLL
  })
Button('隐藏分割线')
  .onClick((): void => {
    this.dividerMode = DividerMode.NONE
  })
```

## 5. 数据结构

```typescript
interface TabDef {
  key: string
  label: string
  icon: Resource
}

// 列表项数据
interface FeedItem {
  id: string
  title: string
}

// 点击上报埋点
interface TrackEvent {
  name: string
  params: Record<string, string>
}
```

## 6. 联动说明

### TabBar ↔ TabContent

- 点击或横向滑动 TabContent → 触发 `.onChange(index)` → 更新 `@State currentIndex`
- `controller.changeIndex(i)` → 命令式切换（常用于 deep link）

### 滚动联动

- `controller.bindScroller(i, scroller)` → HdsTabs 能感知当前 tab 对应内容的滚动进度
- 内容滚动 → 根据 `DividerMode.FOLLOW_SCROLL`，分割线在内容超过页签栏时渐显
- `barBackgroundStyle` 开启 + `barOverlap(true)` → 内容背景透过渐变模糊叠到页签栏上

### 页签样式切换

- `.tabBar(new BottomTabBarStyle(icon, text))` → 官方底部页签样式（无需自定义 Builder）
- `.tabBar(new SubTabBarStyle(text))` → 顶部页签样式
- `.tabBar(bleedIconStyle((): void => this.customBuilder()))` → 出血图标，图标可超出 TabBar 高度

### 半屏居中

- `vertical(true)` + `.barMode(ExtendBarMode.HALF_SCREEN_FIXED)` → 侧边 TabBar 居中 1/2 屏，常用于平板

## 7. 完整代码示例

```typescript
import {
  HdsTabs,
  HdsTabsController,
  DividerMode
} from '@kit.UIDesignKit'
import { SymbolGlyphModifier } from '@kit.ArkUI'

interface FeedItem {
  id: string
  title: string
}

@Entry
@Component
struct MainTabsPage {
  private controller: HdsTabsController = new HdsTabsController()
  private feedScroller: Scroller = new Scroller()
  private discoverScroller: Scroller = new Scroller()

  @State currentIndex: number = 0
  @State feedList: FeedItem[] = []
  @State dividerMode: DividerMode = DividerMode.FOLLOW_SCROLL

  aboutToAppear(): void {
    this.controller.bindScroller(0, this.feedScroller)
    this.controller.bindScroller(1, this.discoverScroller)
    this.loadFeeds()
  }

  aboutToDisappear(): void {
    this.controller.unbindScroller(this.feedScroller)
    this.controller.unbindScroller(this.discoverScroller)
  }

  private loadFeeds(): void {
    const list: FeedItem[] = []
    for (let i = 0; i < 30; i++) {
      list.push({ id: `f_${i}`, title: `条目 ${i + 1}` })
    }
    this.feedList = list
  }

  @Builder
  private buildFeed(scroller: Scroller) {
    List({ scroller: scroller }) {
      ForEach(this.feedList, (item: FeedItem): void => {
        ListItem() {
          Text(item.title).width('100%').padding(16)
        }
      }, (item: FeedItem): string => item.id)
    }
    .width('100%')
    .height('100%')
  }

  build() {
    HdsTabs({ controller: this.controller }) {
      TabContent() {
        this.buildFeed(this.feedScroller)
      }
      .tabBar(new BottomTabBarStyle(
        new SymbolGlyphModifier($r('sys.symbol.house_fill')),
        '首页'
      ))

      TabContent() {
        this.buildFeed(this.discoverScroller)
      }
      .tabBar(new BottomTabBarStyle(
        new SymbolGlyphModifier($r('sys.symbol.compass')),
        '发现'
      ))

      TabContent() {
        Text('消息列表').width('100%').textAlign(TextAlign.Center)
      }
      .tabBar(new BottomTabBarStyle(
        new SymbolGlyphModifier($r('sys.symbol.bell')),
        '消息'
      ))

      TabContent() {
        Text('我的').width('100%').textAlign(TextAlign.Center)
      }
      .tabBar(new BottomTabBarStyle(
        new SymbolGlyphModifier($r('sys.symbol.person_fill')),
        '我的'
      ))
    }
    .barPosition(BarPosition.End)
    .vertical(false)
    .barOverlap(true)
    .divider({
      mode: this.dividerMode,
      style: { color: '#33000000', strokeWidth: 1 }
    })
    .onChange((index: number): void => {
      this.currentIndex = index
    })
    .onTabBarClick((index: number): void => {
      if (index === this.currentIndex) {
        this.feedScroller.scrollEdge(Edge.Top)
      }
    })
    .onContentWillChange((from: number, to: number): boolean => {
      return true
    })
    .width('100%')
    .height('100%')
  }
}
```

**ArkTS 合规检查清单**：
- [x] 箭头函数参数和返回值都有显式类型标注（`(index: number): void`、`(item: FeedItem): string`）
- [x] 没有对象展开运算符
- [x] 没有 `get` 访问器；`loadFeeds()` / `buildFeed()` 都是普通方法
- [x] `@State dividerMode` 用枚举 `DividerMode` 而非联合字面量
- [x] `FeedItem` / `TabDef` 等自定义类型都有 interface

## 8. 反面示例

```typescript
// ❌ 仍在用原生 TabsController（和 HdsTabs 不兼容，编译报错或运行时异常）
private controller: TabsController = new TabsController()

// ❌ 把 TabContent 改成 "HdsTabContent"（没有这个组件）
HdsTabs() {
  HdsTabContent() { /* ... */ }
}

// ❌ @State 用联合字面量
@State dividerMode: 'VISIBLE' | 'NONE' = 'VISIBLE'

// ❌ 忘了 bindScroller，导致分割线 FOLLOW_SCROLL 不跟手
HdsTabs({ controller: this.controller }) {
  TabContent() {
    List({ scroller: this.listScroller }) { /* ... */ }
  }
}
// 缺：aboutToAppear 里 this.controller.bindScroller(0, this.listScroller)

// ❌ barOverlap 未开就想看渐变模糊（barBackgroundStyle 不生效）
HdsTabs()
  .barBackgroundStyle({ maskColor: Color.Orange, maskHeight: 80 })
  // 缺 .barOverlap(true)

// ❌ HALF_SCREEN_FIXED 用在横向 Tabs（规则要求 vertical(true) 且 BottomTabBarStyle）
HdsTabs()
  .vertical(false)
  .barMode(ExtendBarMode.HALF_SCREEN_FIXED)

// ❌ TV 设备上调用（该组件在 TV 无效果）
// 要在代码里用 deviceInfo 判断当前设备，避免 TV 上走空逻辑

// ❌ 用 SymbolGlyphModifier 时修改 fontSize（不支持，样式不生效）
new SymbolGlyphModifier($r('sys.symbol.house_fill')).fontSize(32)
```

## 9. API 速查

### 构造与控制器

| API | 说明 |
|-----|------|
| `HdsTabs(options?: HdsTabsOptions)` | 创建容器；`options.controller` 传 `HdsTabsController` |
| `HdsTabsController()` | 控制器，继承自 `TabsController`，`.changeIndex(i)` 切换页签 |
| `controller.bindScroller(index, scroller, parentScroller?)` | 绑定内容区滚动器，让 TabBar 感知滚动（API 20）|
| `controller.unbindScroller(scroller)` | 解绑（一般在 `aboutToDisappear`）|

### 布局与样式

| API | 说明 |
|-----|------|
| `.vertical(boolean)` | 横向/纵向 TabBar，默认 false |
| `.barPosition(BarPosition)` | `Start` 顶部（默认）/ `End` 底部 |
| `.scrollable(boolean)` | 是否允许滑动切换，默认 true |
| `.barWidth(Length)` / `.barHeight(Length)` | TabBar 尺寸 |
| `.animationDuration(number)` | 切换动画时长 ms，`BottomTabBarStyle` 下默认 0 |
| `.barOverlap(boolean)` | TabBar 是否浮在 TabContent 之上并模糊 |
| `.barBackgroundColor(ResourceColor)` | TabBar 底色 |
| `.barBackgroundBlurStyle(BlurStyle, options?)` | TabBar 背景模糊 |
| `.barBackgroundEffect(BackgroundEffectOptions)` | 更精细的背景效果（模糊半径/亮度/饱和度）|
| `.barMode(HdsBarMode, options?)` | `BarMode.Fixed / Scrollable` 或 `ExtendBarMode.HALF_SCREEN_FIXED` |
| `.divider(Optional<HdsDividerStyle>)` | 分割线样式 `{ mode, style }` |
| `.barBackgroundStyle(Optional<HdsTabsBackgroundStyle>)` | 渐变模糊 `{ maskColor, maskHeight }`（需配合 barOverlap + barPosition.End）|
| `.blurStrategy(BlurStrategy)` | 模糊策略 ADAPTIVE/ENABLE/DISABLE |

### 事件

| API | 说明 |
|-----|------|
| `.onChange(Callback<number>)` | 切换后触发，参数为新 index |
| `.onTabBarClick(Callback<number>)` | TabBar 点击（不含滑动）|
| `.onAnimationStart(OnTabsAnimationStartCallback)` | 切换动画开始 |
| `.onAnimationEnd(...)` | 结束回调（继承自 Tabs）|
| `.onContentWillChange(OnTabsContentWillChangeCallback)` | 即将切换，返回 false 可拦截 |

### 关键枚举

| 枚举 | 取值 | 典型场景 |
|------|------|--------|
| `DividerMode` | VISIBLE / NONE / FOLLOW_SCROLL | 分割线三种行为，默认 FOLLOW_SCROLL |
| `ExtendBarMode` | HALF_SCREEN_FIXED (100) | 侧边栏半屏居中（需 vertical + BottomTabBarStyle）|
| `HdsBarMode` | `ExtendBarMode \| BarMode` | `barMode` 参数类型 |

### 出血图标与自定义 TabBar

| API | 说明 |
|-----|------|
| `.tabBar(new BottomTabBarStyle(icon, text))` | 官方底部样式，无需自写 @Builder |
| `.tabBar(new SubTabBarStyle(text))` | 顶部样式 |
| `.tabBar(bleedIconStyle((): void => this.builder()))` | 出血图标（@Builder 出血效果）|

> **迁移要点**：
> 1. `Tabs` → `HdsTabs`、`TabsController` → `HdsTabsController`、子组件 `TabContent` 保持不变；
> 2. 导入改为 `'@kit.UIDesignKit'`；使用图标必须额外从 `'@kit.ArkUI'` 导入 `SymbolGlyphModifier`；
> 3. `BottomTabBarStyle` / `SubTabBarStyle` 不要改名；
> 4. 如果用到分割线跟手或渐变模糊，必须在 `aboutToAppear` 里 `bindScroller`。
