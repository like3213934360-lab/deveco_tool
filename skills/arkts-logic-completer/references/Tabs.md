# Tabs 组件功能逻辑规格

> 原生 ArkUI 容器组件，无需独立 `import`（内置全局可用）。
> 官方原文：[docs/zh-cn/.../ts-container-tabs.md](../../../docs/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ts-container-tabs.md)（3000+ 行），本文按 9 节模板压缩到"日常 80% 场景"。

## 1. 功能定位

`Tabs` 是通过页签进行内容视图切换的**容器组件**，每个页签对应一个 `TabContent` 子组件。从 API 7 起支持，**无需 `import`**，直接作为全局 UI 构造函数使用。

**三类"Tabs"辨析（别混淆）**：

| 名称 | 来源 | 定位 | 查哪份 |
|------|------|------|-------|
| **`Tabs`**（本文件） | 原生 ArkUI 全局容器 | 容器 API 的完整基础能力 | 本文 |
| `HdsTabs` | `@kit.UIDesignKit` | **继承自 `Tabs`**，额外提供 6.1 分割线跟手 / 渐变模糊 / 半屏居中 | [HdsTabs.md](HdsTabs.md) |
| `BottomTab` / `SubTab` | 基于 `Tabs + TabContent` 的**业务组合模式** | 底部主导航 / 子页签两类场景化组合 | [BottomTab.md](BottomTab.md) / [SubTab.md](SubTab.md) |

**边界约定**：本文只讲 `Tabs` 容器本身的 API / 属性 / 事件 / 控制器。底部主导航的业务写法（未读角标、跨页持久化、`BottomTabBarStyle.of()` 用法）→ 查 `BottomTab.md`；子页签场景 → 查 `SubTab.md`；HDS 6.1 特性 → 查 `HdsTabs.md`。

## 2. 典型场景

- 应用顶部横向标签：内容分类（"热门/关注/推荐"），可配 `BarMode.Scrollable` 支持多页签横滑
- 应用底部 4-5 个主页签：业务写法走 [BottomTab.md](BottomTab.md)，本文只讲容器本身
- 文本编辑器多文档切换：`TabsController` 控制切换 + `onContentWillChange` 做"有未保存改动时拦截切换"
- 平板 / 折叠屏侧栏：`vertical(true)` + `barPosition(BarPosition.Start)`

## 3. 状态声明

```typescript
@Entry
@Component
struct TabsPage {
  @State currentIndex: number = 0
  @State barMode: BarMode = BarMode.Fixed
  private controller: TabsController = new TabsController()

  build() {
    Tabs({ barPosition: BarPosition.Start, index: $$this.currentIndex, controller: this.controller }) {
      // TabContent 子组件
    }
  }
}
```

> - `currentIndex` 用 `@State` + `$$` 双向绑定，避免"点击页签或滑动切换后外部状态不同步"。
> - `controller` 用 `private` 成员，**不要**加 `@State` —— TabsController 是命令式对象，不参与响应式。
> - `barMode` 作为动态切换"布局模式"时才需要 `@State`；固定模式可省略。
> - **不要**把 `BarMode` 写成 `'Fixed' | 'Scrollable'` 联合字面量（ArkTS 硬红线，见 [SKILL.md §5](../SKILL.md#5-state-不支持联合字面量类型)）。

## 4. 事件与交互逻辑

### `onChange`：页签切换完成后回调

```typescript
Tabs({ ... }) { /* ... */ }
  .onChange((index: number) => {
    this.currentIndex = index
    // 联动业务：埋点、切换时拉取对应页数据...
  })
```

**触发时机**（官方原文 §事件）：
1. 手势滑动 `TabContent` 切换后（动画结束时）
2. `TabsController.changeIndex()` 调用后
3. `index` 状态变量变化后
4. 点击 `TabBar` 页签切换后

> **自定义 TabBar 联动延迟**：如果使用自定义页签（不是 `BottomTabBarStyle` / `SubTabBarStyle`），在 `onChange` 里联动会有延迟。官方建议改用 `onAnimationStart` 刷新当前索引（[示例 3](../../../docs/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ts-container-tabs.md#示例3自定义页签切换联动)）。

### `onTabBarClick`：区分"点击切换 vs 滑动切换"

```typescript
.onTabBarClick((index: number) => {
  // 只在点击 TabBar 页签时触发，滑动切换不触发
  // 用法：统计点击行为 / 拦截第 i 个 tab 的点击等
})
```

### `onContentWillChange`：切换拦截（常用场景）

```typescript
.onContentWillChange((currentIndex: number, comingIndex: number): boolean => {
  if (this.hasUnsavedChanges && currentIndex === 0) {
    this.showConfirmDialog()
    return false   // 返回 false 阻止切换
  }
  return true
})
```

类型签名：`(currentIndex: number, comingIndex: number) => boolean`。**返回 false 就能拦截**；返回 true 放行。适用场景：表单脏检查、权限校验、未完成流程提示。

### 控制器命令式切换

```typescript
// 任何业务事件里都可以直接调用
this.controller.changeIndex(2)    // 跳到第 3 个页签
```

> - `changeIndex` 带切换动画，若要关闭动画设置 `.animationDuration(0)`。
> - 传入值越界（`< 0` 或 `>= TabContent 数量`）会回落到 0。

### 预加载（性能优化）

```typescript
aboutToAppear(): void {
  // 建议在 onAppear 生命周期里
  try {
    this.controller.preloadItems([1, 2])   // 预加载第 2、3 个页签
  } catch (err) {
    // TabsController 未绑定 Tabs 时会抛 JS 异常
  }
}
```

> `preloadItems` 只能在 `Tabs` 已创建后调用。**首次预加载推荐放在 `onAppear` / `aboutToAppear`**；放在 `constructor` 里会抛异常。

## 5. 数据结构 / 关键参数

### 构造参数 `TabsOptions`（API 15+）

| 参数 | 类型 | 默认 | 必填 | 说明 |
|------|------|------|------|------|
| `barPosition` | `BarPosition` | `Start` | 否 | 页签位置 |
| `index` | `number` | `0` | 否 | 当前页签索引；**支持 `$$` 双向绑定**（API 10+） |
| `controller` | `TabsController` | — | 否 | 控制器，不支持多 Tabs 共用一个 controller |
| `barModifier` | `CommonModifier` | — | 否 | TabBar 通用属性动态 modifier（API 15+） |

### `BarPosition` 枚举

| 值 | `vertical(true)` | `vertical(false)` |
|----|------------------|-------------------|
| `Start`（默认 0） | 页签位于容器**左**侧 | 页签位于容器**顶**部 |
| `End`（1） | 页签位于容器**右**侧 | 页签位于容器**底**部（**底部导航常用**） |

### `BarMode` 枚举（页签布局）

| 值 | 说明 |
|----|------|
| `Fixed`（默认） | 均分布局，所有页签等宽占满 TabBar |
| `Scrollable` | 按实际长度布局，总宽超出 TabBar 时可横向滑动 |

### 核心属性速览

| 属性 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `vertical` | `boolean` | `false` | 是否纵向 Tab（侧栏） |
| `scrollable` | `boolean` | `true` | 是否允许**滑动页面切换**（底部 Tab 常配 `false`） |
| `barMode` | `BarMode` | `Fixed` | 页签布局模式 |
| `barWidth` / `barHeight` | `Length` | 自适应 | TabBar 宽高 |
| `animationDuration` | `number` | `300`ms | 切换动画时长，设 `0` 关闭动画 |
| `divider` | `DividerStyle` | — | TabBar 与 TabContent 之间的分割线（API 10+） |
| `fadingEdge` | `boolean` | `true` | 可滑动模式下两端渐隐（API 10+） |
| `barOverlap` | `boolean` | `false` | TabBar 背景是否叠加在 TabContent 之上（API 10+） |
| `barBackgroundColor` | `ResourceColor` | — | TabBar 背景色（API 10+） |
| `barBackgroundBlurStyle` | `BlurStyle` 或 `{ blurStyle, BackgroundBlurStyleOptions }` | — | TabBar 背景模糊（API 11+/18+） |
| `barGridAlign` | `BarGridColumnOptions` | — | TabBar 栅格对齐（API 10+） |

### `TabsController` 方法速览

| 方法 | 签名 | 说明 |
|------|------|------|
| `changeIndex` | `(value: number) => void` | 切换到指定页签，越界回落 0 |
| `preloadItems` | `(indices: Optional<Array<number>>) => Promise<void>` | 预加载子节点（API 12+） |
| `setTabBarTranslate` | `(translate: TranslateOptions) => void` | TabBar 平移距离（API 13+） |
| `setTabBarOpacity` | `(opacity: number) => void` | TabBar 透明度（API 13+） |

## 6. 联动说明

### 与 `TabContent` 的配合

`Tabs` 的唯一合法子组件是 [`TabContent`](../../../docs/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ts-container-tabcontent.md)，也支持 `if/else` / `ForEach` 包一层 `TabContent`。**不要**塞其他容器（`Column` / `Row` 等）作为直接子组件。

```typescript
Tabs() {
  TabContent() {
    // 页签内容
  }.tabBar('页签 1')

  TabContent() { /* ... */ }.tabBar('页签 2')
}
```

> 详细 `TabContent` 的 `.tabBar()` 参数（文本 / 图标 / `SubTabBarStyle` / `BottomTabBarStyle`）见官方 `ts-container-tabcontent.md` 或 [BottomTab.md](BottomTab.md) / [SubTab.md](SubTab.md)。

### 与 `Swiper` 在"底部 Tab + 轮播首页"场景的配合（eval 用例 5）

首页 Tab 内嵌一个 `Swiper` 做图片轮播 —— 两个组件**独立运作**，`Swiper` 的 `index` 与 `Tabs` 的 `index` **互不干扰**。若需要外部联动（如 tab 切到其他页时暂停轮播），通过 `onChange` 判断 `index` 后手动 `swiperController.stopAnimation()`。

### 与 `HdsTabs` 的选型与切换

`HdsTabs` **继承自 `Tabs`**，所以不是"二选一"，而是"要不要用 HDS 6.1 额外能力"。速选表：

| 触发条件（命中任一） | 选择 |
|---------------------|------|
| 需要兼容 **API < 20** 设备 / 需要 **TV 设备** | **`Tabs`**（HdsTabs 起始 API 20，TV 不支持） |
| 需要 **分割线跟手渐变** / **TabBar 渐变模糊过渡** / **半屏居中** / **出血图标** | **`HdsTabs`** |
| 其他（默认、简单业务页、不引 Kit 依赖） | **`Tabs`** |

三条典型场景的直接结论：

- App **底部 4-5 个主页签** → `Tabs` + `BottomTabBarStyle`，业务写法查 [BottomTab.md](BottomTab.md)
- **内容页顶部横向 Tab + 长列表**（滑 List 时 TabBar 要跟手渐变）→ `HdsTabs`，HDS 6.1 招牌场景
- 低版本设备适配 / 工具类应用 → `Tabs`

> 完整决策优先级表（P0 硬约束 / P1 视觉 / P2 代码成本）+ 避免误区见 [hds-migration.md §1.5](patterns/hds-migration.md#15-hdstabs-vs-tabs-选型决策)。

业务已确定要迁到 HDS 版时，三步走：

1. `Tabs` → `HdsTabs`、`TabsController` → `HdsTabsController`（只改主组件，见 [hds-migration.md §2](patterns/hds-migration.md#2-只改主组件铁律--不要给所有东西加-hds-前缀)）
2. `TabContent` / `BottomTabBarStyle` / `SubTabBarStyle` **保持不变**
3. 额外可用 HDS 6.1 三件套：`barOverlap(true)` + `divider({ mode: DividerMode.FOLLOW_SCROLL })` + `barFloatingStyle({ ... })`

## 7. 完整代码示例

### 示例 A：顶部 Scrollable Tab + 控制器命令式切换

```typescript
@Entry
@Component
struct ScrollableTabs {
  @State currentIndex: number = 0
  private controller: TabsController = new TabsController()
  private titles: string[] = ['推荐', '热门', '关注', '订阅', '社区', '商城', '资讯']

  build() {
    Column() {
      Row() {
        Button('跳到"社区"')
          .onClick((): void => {
            this.controller.changeIndex(4)
          })
      }
      .padding(12)

      Tabs({
        barPosition: BarPosition.Start,
        index: $$this.currentIndex,
        controller: this.controller
      }) {
        ForEach(this.titles, (title: string, i: number) => {
          TabContent() {
            Text(`${title} 内容区`)
              .width('100%')
              .height('100%')
              .textAlign(TextAlign.Center)
          }.tabBar(title)
        }, (title: string, i: number): string => title)
      }
      .barMode(BarMode.Scrollable)
      .animationDuration(200)
      .onChange((index: number) => {
        this.currentIndex = index
      })
      .onContentWillChange((currentIndex: number, comingIndex: number): boolean => {
        if (comingIndex === 5 && !this.isLoggedIn()) {
          this.showLoginPrompt()
          return false   // 未登录拦截切换到"商城"
        }
        return true
      })
    }
    .width('100%')
    .height('100%')
  }

  private isLoggedIn(): boolean { return true }
  private showLoginPrompt(): void { /* ... */ }
}
```

### 示例 B：纵向 Tab（侧栏场景，平板/折叠屏常见）

```typescript
Tabs({ barPosition: BarPosition.Start }) {
  TabContent() { /* 首页 */ }.tabBar(SubTabBarStyle.of('首页'))
  TabContent() { /* 消息 */ }.tabBar(SubTabBarStyle.of('消息'))
  TabContent() { /* 我的 */ }.tabBar(SubTabBarStyle.of('我的'))
}
.vertical(true)
.barWidth(120)
.barMode(BarMode.Fixed)
.divider({ strokeWidth: 0.5, color: 0x1A000000 })
```

### 示例 C：切换拦截 + 预加载

```typescript
@Entry
@Component
struct EditorTabs {
  @State currentIndex: number = 0
  @State hasUnsavedChanges: boolean = false
  private controller: TabsController = new TabsController()

  aboutToAppear(): void {
    // 启动即预加载索引 1、2（后台编辑器场景）
    try {
      this.controller.preloadItems([1, 2])
    } catch (err) {
      // TabsController 未绑定时会抛异常，捕获忽略
    }
  }

  build() {
    Tabs({ controller: this.controller }) {
      TabContent() { /* 编辑器 1 */ }.tabBar('文档 1')
      TabContent() { /* 编辑器 2 */ }.tabBar('文档 2')
      TabContent() { /* 编辑器 3 */ }.tabBar('文档 3')
    }
    .onContentWillChange((currentIndex: number, comingIndex: number): boolean => {
      if (this.hasUnsavedChanges) {
        // 通过 showDialog 异步询问用户，这里先拦截
        this.askSaveBeforeSwitch(comingIndex)
        return false
      }
      return true
    })
  }

  private askSaveBeforeSwitch(targetIndex: number): void { /* ... */ }
}
```

## 8. 反面示例

### ❌ 把 `Column` 直接塞进 Tabs

```typescript
// 错误：Tabs 的唯一合法子是 TabContent
Tabs() {
  Column() { Text('页 1') }   // ← 报错 / 不渲染
  Column() { Text('页 2') }
}
```

### ❌ 箭头函数不带类型标注

```typescript
// 错误：违反 SKILL.md §3
.onChange((index) => {          // ← 缺 number 类型
  this.currentIndex = index
})

// 正确
.onChange((index: number) => {
  this.currentIndex = index
})
```

### ❌ 用联合字面量做 `barMode` 状态

```typescript
// 错误：违反 SKILL.md §5
@State barMode: 'Fixed' | 'Scrollable' = 'Fixed'

// 正确：用枚举本身
@State barMode: BarMode = BarMode.Fixed
```

### ❌ 一个 TabsController 控制多个 Tabs

```typescript
// 错误：官方文档明确规定"不支持一个 TabsController 控制多个 Tabs 组件"
private sharedController: TabsController = new TabsController()
// 两处都用 this.sharedController → 运行时行为未定义
```

### ❌ 在 constructor 里调 preloadItems

```typescript
// 错误：Tabs 还没创建，会抛 JS 异常
constructor() {
  super()
  this.controller.preloadItems([1, 2])   // ← 崩
}

// 正确：在 aboutToAppear / onAppear 里
aboutToAppear(): void {
  try { this.controller.preloadItems([1, 2]) } catch (err) { }
}
```

## 9. API 速查

### 构造

| 接口 | 签名 | 说明 |
|------|------|------|
| `Tabs` | `(options?: TabsOptions)` | 容器构造，`TabsOptions` 见 §5 |
| `BarPosition` | 枚举 `Start`（0）/ `End`（1） | 位置 |
| `BarMode` | 枚举 `Fixed` / `Scrollable` | 布局模式 |

### 高频属性（按使用频率排序）

| 属性 | 类型 | 场景 |
|------|------|------|
| `barPosition` | `BarPosition` | 顶/底/左/右四向（与 `vertical` 组合） |
| `vertical` | `boolean` | 横/纵方向 |
| `scrollable` | `boolean` | 是否允许手势滑动切换（底部 Tab 常设 `false`） |
| `barMode` | `BarMode` | `Fixed` 均分 / `Scrollable` 可滚 |
| `animationDuration` | `number` | 切换动画 ms；`0` 关闭 |
| `divider` | `DividerStyle` | 分割线 |
| `barOverlap` | `boolean` | TabBar 叠加在 TabContent 之上 |
| `barBackgroundColor` / `barBackgroundBlurStyle` | `ResourceColor` / `BlurStyle` | 背景 |

### 核心事件

| 事件 | 签名 | 说明 |
|------|------|------|
| `onChange` | `(index: number) => void` | 切换**完成后** |
| `onTabBarClick` | `(index: number) => void` | 仅点击触发，不含滑动 |
| `onAnimationStart` | `OnTabsAnimationStartCallback` | 切换动画开始（自定义 TabBar 联动首选） |
| `onAnimationEnd` | `OnTabsAnimationEndCallback` | 切换动画结束 |
| `onContentWillChange` | `(currentIndex: number, comingIndex: number) => boolean` | **切换拦截**，返回 false 阻止切换 |
| `onSelected` / `onUnselected` | `(index: number) => void` | 页签选中 / 取消（API 18+） |

### `TabsController` 常用方法

| 方法 | 签名 | 用途 |
|------|------|------|
| `changeIndex` | `(value: number) => void` | 命令式跳页 |
| `preloadItems` | `(indices: Optional<Array<number>>) => Promise<void>` | 预加载（API 12+，必须 Tabs 创建后调用） |
| `setTabBarTranslate` | `(translate: TranslateOptions) => void` | TabBar 平移（API 13+） |
| `setTabBarOpacity` | `(opacity: number) => void` | TabBar 透明度（API 13+） |

**记忆锚点**：
- 容器本体 API **不用 import**，`TabsController` 也一样，都是全局构造
- `index` 支持 `$$` 双向绑定；`controller` 是普通成员，不加 `@State`
- 切换 = 四种触发源（手势 / 控制器 / index 修改 / 点击）都进 `onChange`
- 拦截 = `onContentWillChange` 返 `false`
- HDS 版见 [HdsTabs.md](HdsTabs.md)，业务组合见 [BottomTab.md](BottomTab.md) / [SubTab.md](SubTab.md)
