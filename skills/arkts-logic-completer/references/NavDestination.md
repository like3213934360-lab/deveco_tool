# NavDestination 组件功能逻辑规格

> 原生 ArkUI 容器组件，无需独立 `import`（全局构造函数）。
> 官方原文：[ts-basic-components-navdestination.md](../../../docs/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ts-basic-components-navdestination.md)。容器 + 路由栈见 [Navigation.md](Navigation.md)，HDS 版见 [HdsNavDestination.md](HdsNavDestination.md)。

## 1. 功能定位

`NavDestination` 是 **`Navigation` 子页面的根容器**，从 API 10 起支持。它的主要作用：

- 做 `Navigation.navDestination(builder)` 分派出的**唯一根节点**
- 承载子页自己的 `title` / `toolbarConfiguration` / `systemBarStyle` 等（会覆盖父 Navigation 对应属性）
- 提供**完整生命周期**：`onWillAppear` → `onReady` → `onWillShow` → `onShown` → `onWillHide` → `onHidden` → `onWillDisappear`
- 提供**返回键拦截** `onBackPressed`（返 `true` 拦截）
- 提供**滚动联动 titleBar 显隐**：`bindToScrollable(Array<Scroller>)`
- 提供 **DIALOG 模式**：`mode(NavDestinationMode.DIALOG)` 透明层叠，不遮盖下层（常用于 Sheet 风格子页）

**三类 NavDestination 辨析**：

| 名称 | 来源 | 定位 |
|------|------|------|
| **`NavDestination`**（本文件） | 原生全局容器 | 路由子页根容器 |
| `HdsNavDestination` | `@kit.UIDesignKit` | **继承自 `NavDestination`**，补 HDS 6.1 动态模糊标题栏 / 页面级 toolBar / 悬浮栏。见 [HdsNavDestination.md](HdsNavDestination.md) |
| `NavDestinationContext` | `Navigation` 提供的**上下文对象** | `onReady` 回调参数，里面有 `pathInfo` / `pathStack` / `navDestinationId` |

## 2. 典型场景

- **详情页**：从列表 push 进来的 Detail，用 `onShown` 埋点，`onBackPressed` 做脏检查
- **表单编辑页**：`onBackPressed` 拦截返回键，弹出"确认放弃"确认框
- **沉浸式内容页**：`hideTitleBar(true)` + `systemBarStyle` 改状态栏颜色
- **Sheet 风格半浮层子页**：`mode(NavDestinationMode.DIALOG)`，不销毁下层 NavDestination
- **滚动联动**：`bindToScrollable([listScroller])`，List 上滑 titleBar 自动隐藏
- **页面返回传值**：在 `onReady` 里拿 `context.pathStack`，业务事件里 `pathStack.pop(result)`

## 3. 状态声明

```typescript
import { NavPathStack, NavPathInfo } from '@kit.ArkUI'

@Component
export struct DetailPage {
  @Consume('pathStack') pathStack: NavPathStack
  @State isLoading: boolean = false
  @State hasUnsavedChanges: boolean = false
  private listScroller: Scroller = new Scroller()
  private itemId: number = 0

  build() {
    NavDestination() {
      List({ scroller: this.listScroller }) {
        // 列表内容
      }
    }
    .title('详情页')
    .hideBackButton(false)
    .bindToScrollable([this.listScroller])
    .onReady((context: NavDestinationContext): void => {
      this.itemId = context.pathInfo.param as number
    })
    .onBackPressed((): boolean => {
      if (this.hasUnsavedChanges) {
        this.showConfirm()
        return true    // 拦截返回键
      }
      return false
    })
  }

  private showConfirm(): void { /* ... */ }
}
```

> - `@Consume('pathStack')` 从父 `Navigation` 的 `@Provide('pathStack')` 里拿路由栈，**不要**自己 `new NavPathStack()`。
> - `listScroller` 是普通成员（命令式对象），**不要**加 `@State`。
> - `NavDestination` 的 `build()` 里**只能有一个根 `NavDestination`**，不能多根。
> - `onBackPressed` 必须标注**返回值类型 `(): boolean =>`**（ArkTS 硬红线：箭头函数显式类型）。

## 4. 事件与交互逻辑

### 生命周期时序（必记）

```
入栈 push：  onWillAppear → onReady → onWillShow → onShown → onActive
出栈 pop：   onWillHide → onHidden → onInactive → onWillDisappear
```

- `onReady((context: NavDestinationContext) => void)` —— **唯一能拿到 `pathStack` / `pathInfo.param` 的时机**，整个页面生命周期里只触发一次（重建除外）
- `onShown(Callback<VisibilityChangeReason>)` —— 每次页面变可见都触发（包括从后台返回、从 DIALOG 下方返回栈顶）
- `onHidden(Callback<VisibilityChangeReason>)` —— 对称 onShown
- `onWillAppear / onWillShow / onWillHide / onWillDisappear` —— 转场动画开始**前**触发，在这里改路由栈**当前帧就生效**
- `onActive / onInactive`（API 17+）—— "激活态"变化（栈顶 + 上层无弹窗遮挡才算激活）；DIALOG 模式**只触发 onActive / onInactive**，不触发 onShown/onHidden

### 返回键拦截 `onBackPressed`

```typescript
.onBackPressed((): boolean => {
  if (this.hasUnsavedChanges) {
    this.showSaveDialog()
    return true        // 拦截：不自动 pop
  }
  return false         // 放行：自动 pop
})
```

> 返回键来源包括：系统导航手势、标题栏返回键、键盘 Escape、`pathStack.pop()` 自身。

### 滚动联动 `bindToScrollable`

```typescript
build() {
  NavDestination() {
    List({ scroller: this.listScroller }) {
      // ...
    }
  }
  .title('资讯')
  .bindToScrollable([this.listScroller])
  // 上滑 List 自动隐藏 titleBar 和 toolBar；下滑或滑到顶部恢复
}
```

> 生效条件：titleBar 或 toolBar 本来就可见（没被 `hideTitleBar(true)`）。支持 `List` / `Scroll` / `Grid` / `WaterFlow`。嵌套滚动用 `bindToNestedScrollable`。

### 子页返回传值

```typescript
// 业务事件里：把结果传回 push 方
.onClick((): void => {
  this.pathStack.pop({ id: this.selectedId, saved: true })
})
```

父页面拿到结果的两种方式：

1. **对象式**：push 时在 `NavPathInfo` 构造函数传 `onPop`
2. **按名式**：`pushPathByName(name, param, onPop)` 的第三参

```typescript
this.pathStack.pushPathByName('DetailPage', 1, (popInfo: PopInfo): void => {
  const result = popInfo.result as Record<string, Object>
  // result.id / result.saved
})
```

### `onReady` 里拿路由上下文

```typescript
.onReady((context: NavDestinationContext): void => {
  this.itemId = context.pathInfo.param as number
  // 也可以 context.pathStack.pushPath(...) 发起二次跳转
  // 或 context.pathStack.size() 判断栈深
})
```

## 5. 数据结构 / 关键参数

### 构造

`NavDestination()` —— 无参构造。**只能作为 `Navigation.navDestination(builder)` 分派出的唯一根节点**，不能当普通容器直接使用。

### 核心属性速览

| 属性 | 类型 | 场景 |
|------|------|------|
| `title` | `string \| CustomBuilder \| NavDestinationCommonTitle \| NavDestinationCustomTitle \| Resource` | 子页标题，可覆盖父 Navigation |
| `hideTitleBar` / `hideToolBar` / `hideBackButton` | `boolean`（可选第二参 `animated`，API 13+/15+） | 隐藏对应栏 |
| `toolbarConfiguration` | `Array<ToolbarItem> \| CustomBuilder` | 子页独立工具栏（覆盖父 Navigation 的） |
| `menus` | `Array<NavigationMenuItem> \| CustomBuilder` | 子页右上角菜单 |
| `mode` | `NavDestinationMode`: `STANDARD` / `DIALOG` | 标准 / 透明层叠（**不支持动态修改**） |
| `systemBarStyle` | `Optional<SystemBarStyle>` | 子页状态栏样式 |
| `systemTransition` | `NavigationSystemTransitionType` | 系统转场动画：`DEFAULT` / `NONE` / `TITLE` / `CONTENT` / `FADE` / `EXPLODE` / `SLIDE_RIGHT` / `SLIDE_BOTTOM` |
| `bindToScrollable` | `Array<Scroller>` | 滚动联动 titleBar/toolBar 显隐 |
| `bindToNestedScrollable` | `Array<NestedScrollInfo>` | 嵌套滚动联动 |
| `recoverable` | `Optional<boolean>` | 应用异常退出后恢复（需 Navigation 也开启） |
| `preferredOrientation` | `Optional<Orientation>` | 页面方向 |
| `enableStatusBar` / `enableNavigationIndicator` | `Optional<boolean>`（API 19+） | 状态栏 / 导航条显隐 |

### 枚举速查

**`NavDestinationMode`**（API 11+）：

| 值 | 行为 |
|----|------|
| `STANDARD`（默认 0） | 标准页，入栈覆盖下层 |
| `DIALOG`（1） | **透明层叠**，不遮盖下层，下层**不触发 onHidden**，只触发 `onInactive`。适用于 Sheet / 弹窗式子页 |

**`NavigationSystemTransitionType`**（API 14+）：

| 值 | 说明 |
|----|------|
| `DEFAULT`（默认） | 系统默认（水平滑入） |
| `NONE` | 无动画 |
| `TITLE` / `CONTENT` | 只动 titleBar / 只动内容区 |
| `FADE` / `EXPLODE` / `SLIDE_RIGHT` / `SLIDE_BOTTOM` | 渐变 / 中心缩放 / 右滑入 / 底滑入 |

### 核心事件签名

| 事件 | 签名 |
|------|------|
| `onShown` | `Callback<VisibilityChangeReason>`（API 10+；API 21+ 起带入参） |
| `onHidden` | `Callback<VisibilityChangeReason>` |
| `onWillAppear` | `Callback<void>` |
| `onWillShow` / `onWillHide` / `onWillDisappear` | `Callback<void>` |
| `onBackPressed` | `() => boolean`（返 true 拦截） |
| `onReady` | `Callback<NavDestinationContext>`（**唯一拿 pathStack 时机**） |
| `onResult` | `Optional<Callback<ESObject>>`（本页被 pop(result) 时触发） |
| `onActive` / `onInactive` | `Optional<Callback<NavDestinationActiveReason>>`（API 17+） |

### `NavDestinationContext`

```typescript
interface NavDestinationContext {
  pathInfo: NavPathInfo              // 当前页路由项（含 name / param / onPop / navDestinationId）
  pathStack: NavPathStack            // 所在 Navigation 的路由栈（等价于 @Consume('pathStack')）
  navDestinationId?: string          // 系统生成的全局唯一 id
  getConfigInRouteMap(): RouteMapConfig | undefined   // 系统路由表里的配置
}
```

## 6. 联动说明

### 与 `Navigation` 的配合

`NavDestination` **必须**被 `Navigation.navDestination(builder)` 分派，单独使用无效。典型分派写法：

```typescript
// Navigation 侧
Navigation(this.pathStack) { /* 首页 */ }
  .navDestination(this.destinationMap)

@Builder
destinationMap(name: string, param: Object) {
  if (name === 'DetailPage') {
    DetailPage()
  } else if (name === 'EditPage') {
    EditPage()
  }
}

// 每个子页面组件都以 NavDestination 作为 build() 唯一根
```

容器 / 路由栈 / 拦截器见 [Navigation.md](Navigation.md)。

### 与滚动容器 `bindToScrollable`

- 支持 `List` / `Scroll` / `Grid` / `WaterFlow`
- **titleBar 或 toolBar 必须可见**（没 hide 掉）才能联动
- 一个 NavDestination 可以绑定多个 scroller（任一滚动都触发动画）
- 嵌套滚动用 `bindToNestedScrollable([{ parent: outerScroller, child: innerScroller } as NestedScrollInfo])`

### 与 `HdsNavDestination` 的切换

`HdsNavDestination` **继承自 `NavDestination`**，所以本文所有 API 在 HDS 版上都生效。业务要迁到 HDS 版时：

1. `NavDestination` → `HdsNavDestination`（只改主组件）
2. 其他（`NavPathStack` / `Navigation` 容器 / `ToolbarItem`）**保持不变**
3. 额外可用 HDS 6.1：页面级 `titleBar({ ... })` / `toolBar({ ... })` 带动态模糊、悬浮栏

详见 [hds-migration.md §2](patterns/hds-migration.md#2-只改主组件铁律--不要给所有东西加-hds-前缀) 和 [HdsNavDestination.md](HdsNavDestination.md)。

### 与 `@Consume / @Provide`

父 `Navigation` 写 `@Provide('pathStack') pathStack: NavPathStack`，子页 `NavDestination` 所在组件写 `@Consume('pathStack') pathStack: NavPathStack`。**不要**在子组件里再 `new NavPathStack()`（会得到一个孤立的栈，pop/push 都无效）。

## 7. 完整代码示例

### 示例 A：最小可运行 Demo（NavDestination 必须被 Navigation 分派）

> `NavDestination` 不能单独做 `@Entry`，必须由父 `Navigation.navDestination(builder)` 分派。下面给出完整可运行的三件套：`@Entry` Navigation 容器 + 分派 Builder + 子页 NavDestination。

```typescript
import { NavPathStack, NavPathInfo, PopInfo } from '@kit.ArkUI'

@Entry
@Component
struct AppShell {
  @Provide('pathStack') pathStack: NavPathStack = new NavPathStack()

  build() {
    Navigation(this.pathStack) {
      Column({ space: 12 }) {
        Button('查看详情 ID=42').onClick((): void => {
          this.pathStack.pushPathByName('DetailPage', 42, (popInfo: PopInfo): void => {
            const r = popInfo.result as Record<string, Object>
            console.info('拿到返回值: saved=' + r.saved)
          })
        })
      }
      .padding(16)
    }
    .title('首页')
    .navDestination(this.destinationMap)
  }

  @Builder
  destinationMap(name: string, param: Object) {
    if (name === 'DetailPage') {
      DetailPage()
    }
  }
}

@Component
struct DetailPage {
  @Consume('pathStack') pathStack: NavPathStack
  @State itemId: number = 0

  build() {
    NavDestination() {
      Column({ space: 12 }) {
        Text('详情 ID: ' + this.itemId).fontSize(24)
        Button('保存并返回').onClick((): void => {
          this.pathStack.pop({ id: this.itemId, saved: true })
        })
      }
      .padding(16)
    }
    .title('详情')
    .onReady((context: NavDestinationContext): void => {
      this.itemId = context.pathInfo.param as number
    })
  }
}
```

> 后续示例 B / C 聚焦 `NavDestination` 自身的属性/事件（返回拦截、滚动联动、DIALOG 模式），**省略父 `Navigation` 壳**，实际落地时参照示例 A 套一层即可。

### 示例 B：滚动联动 + 返回拦截

```typescript
@Component
export struct FeedPage {
  @Consume('pathStack') pathStack: NavPathStack
  @State hasUnsavedDraft: boolean = false
  private listScroller: Scroller = new Scroller()

  build() {
    NavDestination() {
      List({ scroller: this.listScroller, space: 8 }) {
        ForEach([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], (i: number) => {
          ListItem() {
            Text('第 ' + i + ' 条')
              .padding(12)
              .width('100%')
          }
        }, (i: number): string => i.toString())
      }
      .width('100%')
      .height('100%')
    }
    .title('资讯流')
    .titleMode(NavigationTitleMode.Full)
    .bindToScrollable([this.listScroller])
    .onBackPressed((): boolean => {
      if (this.hasUnsavedDraft) {
        this.showDraftDialog()
        return true
      }
      return false
    })
    .onShown((): void => {
      // 每次页面可见时埋点
    })
  }

  private showDraftDialog(): void { /* ... */ }
}
```

### 示例 C：DIALOG 模式（Sheet 风格子页，不遮盖下层）

```typescript
@Component
export struct ShareSheet {
  @Consume('pathStack') pathStack: NavPathStack

  build() {
    NavDestination() {
      Column({ space: 12 }) {
        Text('分享到').fontSize(20).margin({ top: 24 })
        Row({ space: 20 }) {
          Button('微信')
          Button('微博')
          Button('链接')
        }
        Button('取消').onClick((): void => {
          this.pathStack.pop()
        }).margin({ top: 24 })
      }
      .width('100%')
      .backgroundColor('#F5F5F5')
      .borderRadius({ topLeft: 16, topRight: 16 })
      .alignItems(HorizontalAlign.Center)
    }
    .mode(NavDestinationMode.DIALOG)
    .hideTitleBar(true)
    .systemTransition(NavigationSystemTransitionType.SLIDE_BOTTOM)
  }
}
```

> DIALOG 模式下，**下层页面不会触发 `onHidden`**，只触发 `onInactive`。在下层页监听"半浮层出现"时应该用 `onInactive` 而不是 `onHidden`。

## 8. 反面示例

### ❌ `NavDestination` 作为普通容器用

```typescript
// 错误：NavDestination 只能被 Navigation.navDestination(builder) 分派
@Entry
@Component
struct SomePage {
  build() {
    NavDestination() {           // ← 不能在 @Entry 里直接用
      Text('xxx')
    }
  }
}

// 正确：@Entry 用 Navigation 作为根，子页才是 NavDestination
```

### ❌ `onBackPressed` 箭头函数不带类型标注

```typescript
// 错误：违反 SKILL.md §3
.onBackPressed(() => {
  return true
})

// 正确
.onBackPressed((): boolean => {
  return true
})
```

### ❌ 在子组件里 `new NavPathStack()`

```typescript
// 错误：孤立的栈，push/pop 都不会影响真实路由
@Component
struct DetailPage {
  private pathStack: NavPathStack = new NavPathStack()   // ← 错的

  build() {
    NavDestination() { /* ... */ }
  }
}

// 正确：从父 Provide 取
@Component
struct DetailPage {
  @Consume('pathStack') pathStack: NavPathStack

  build() {
    NavDestination() { /* ... */ }
  }
}
```

### ❌ 用 `@State` 存 `Scroller`

```typescript
// 错误：Scroller 是命令式对象，加 @State 只会浪费一次响应式开销
@State listScroller: Scroller = new Scroller()

// 正确：普通成员
private listScroller: Scroller = new Scroller()
```

### ❌ DIALOG 模式下监听 `onHidden` 判断下层是否被遮挡

```typescript
// 错误：DIALOG 模式下层 NavDestination 不触发 onHidden，只触发 onInactive
.onHidden((): void => {
  // 此处永远不会在"被半浮层盖住"时触发
})

// 正确：改用 onInactive
.onInactive((reason: NavDestinationActiveReason): void => {
  if (reason === NavDestinationActiveReason.SHEET) { /* ... */ }
})
```

### ❌ 动态修改 `mode(NavDestinationMode.DIALOG)`

```typescript
// 错误：官方明确"不支持动态修改"
@State currentMode: NavDestinationMode = NavDestinationMode.STANDARD
// ...
.mode(this.currentMode)
Button('切换模式').onClick((): void => {
  this.currentMode = NavDestinationMode.DIALOG     // ← 不生效
})
```

## 9. API 速查

### 构造

| 接口 | 签名 | 说明 |
|------|------|------|
| `NavDestination` | `()` | 无参构造，只能作为 `navDestination(builder)` 分派的根 |

### 高频属性

| 属性 | 类型 |
|------|------|
| `title` | `string \| CustomBuilder \| NavDestinationCommonTitle \| NavDestinationCustomTitle \| Resource` |
| `mode` | `NavDestinationMode`: `STANDARD` / `DIALOG`（不支持动态修改） |
| `hideTitleBar` / `hideToolBar` / `hideBackButton` | `boolean`（可选 animated） |
| `toolbarConfiguration` | `Array<ToolbarItem> \| CustomBuilder` |
| `menus` | `Array<NavigationMenuItem> \| CustomBuilder` |
| `systemBarStyle` | `Optional<SystemBarStyle>` |
| `systemTransition` | `NavigationSystemTransitionType` |
| `bindToScrollable` | `Array<Scroller>` |
| `bindToNestedScrollable` | `Array<NestedScrollInfo>` |

### 核心事件（生命周期 + 交互）

| 事件 | 签名 | 关键点 |
|------|------|-------|
| `onWillAppear` | `Callback<void>` | 挂载前，改栈当前帧生效 |
| `onReady` | `Callback<NavDestinationContext>` | **唯一拿 pathStack/param 时机**，只触发一次 |
| `onWillShow` / `onShown` | `Callback<void>` / `Callback<VisibilityChangeReason>` | 显示前/已显示 |
| `onWillHide` / `onHidden` | 同 | 隐藏前/已隐藏 |
| `onWillDisappear` | `Callback<void>` | 卸载前（转场动画开始前） |
| `onBackPressed` | `() => boolean` | **返 true 拦截返回键** |
| `onResult` | `Optional<Callback<ESObject>>` | 被 pop(result) 时触发 |
| `onActive` / `onInactive` | `Optional<Callback<NavDestinationActiveReason>>` | 激活态变化（DIALOG 场景主用） |

### `NavDestinationContext` 关键字段

| 字段 | 类型 | 用途 |
|------|------|------|
| `pathInfo` | `NavPathInfo` | 拿 `pathInfo.param` 接参数 |
| `pathStack` | `NavPathStack` | 做二次跳转 / 查看栈深 |
| `navDestinationId` | `string` | 全局唯一 id（API 12+） |

**记忆锚点**：

- 生命周期:`onReady` 一次性拿上下文 → `onShown/onHidden` 每次可见 → `onBackPressed` 拦返回
- DIALOG 模式 ≠ 普通 Sheet，它走 **onActive/onInactive 而非 onShown/onHidden**
- 滚动联动一行搞定：`.bindToScrollable([this.scroller])`
- 子页面**总是** `@Consume('pathStack')`，**永远不要** `new NavPathStack()` 重建
- HDS 升级见 [HdsNavDestination.md](HdsNavDestination.md),容器见 [Navigation.md](Navigation.md)
