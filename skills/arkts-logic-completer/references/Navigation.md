# Navigation 组件功能逻辑规格

> 原生 ArkUI 容器组件，无需独立 `import`（全局构造函数）；`NavPathStack` 在 `@kit.ArkUI` 里，**需要** import。
> 官方原文：[ts-basic-components-navigation.md](../../../docs/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ts-basic-components-navigation.md)（5000+ 行）。子页根容器见 [NavDestination.md](NavDestination.md)，HDS 版见 [HdsNavigation.md](HdsNavigation.md)。

## 1. 功能定位

`Navigation` 是**应用主导航容器**，从 API 8 起支持，API 10+ 起才是"**路由栈驱动**"的现代形态：

- 一个 `Navigation` 绑定一个 **`NavPathStack`**（路由栈对象）
- 子页面通过 `navDestination(builder)` 属性声明如何按名字构造 `NavDestination` 页面
- `NavPathStack.pushPath / pop / replacePath / setInterception` 完成路由行为
- 同时提供 **标题栏 / 工具栏 / 菜单 / 分栏** 能力，与路由一体

**三类 Navigation 辨析（别混淆）**：

| 名称 | 来源 | 定位 |
|------|------|------|
| **`Navigation`**（本文件） | 原生全局容器 | 容器 API 的完整基础能力，路由栈 + titleBar + toolBar |
| `HdsNavigation` | `@kit.UIDesignKit` | **继承自 `Navigation`**，补 HDS 6.1 动态模糊标题栏、滚动联动、双标题样式。见 [HdsNavigation.md](HdsNavigation.md) |
| `@ohos.router` | `@kit.ArkUI` 的 `router` 命名空间 | **旧的命令式路由 API**，与 `Navigation` 互不兼容，新代码**不建议**用 |

> **边界约定**：本文只讲 `Navigation` 容器 + `NavPathStack` 路由栈。子页面生命周期 / 返回键拦截 / 系统转场 → 查 [NavDestination.md](NavDestination.md)。`toolbar()` 属性填的 `ToolbarItem` 也由本文覆盖（它是 Navigation 自己的 API，不是 `Toolbar` 组件）。

## 2. 典型场景

- **多层页面路由**：从首页 push 到详情 push 到编辑页，再按返回键 pop 一级一级回来
- **Split 分栏应用**：平板 / 折叠屏 `mode(NavigationMode.Auto)`，宽屏自动左右栏，手机自动单栏
- **返回拦截**：表单脏检查（有未保存改动时按返回键先弹确认），见 `NavDestination.onBackPressed`
- **全局登录拦截**：`setInterception({ willShow: ... })` 在路由切换前判断权限
- **页面间传值**：`pushPathByName(name, param, onPop)` 入栈传参 + 出栈接收结果

## 3. 状态声明

```typescript
import { NavPathStack, NavPathInfo, PopInfo } from '@kit.ArkUI'

@Entry
@Component
struct HomePage {
  @Provide('pathStack') pathStack: NavPathStack = new NavPathStack()

  build() {
    Navigation(this.pathStack) {
      // Navigation 首页内容（navBar 区域）
      Column() {
        Button('进入详情').onClick((): void => {
          this.pathStack.pushPath({ name: 'DetailPage', param: 123 } as NavPathInfo)
        })
      }
    }
    .title('首页')
    .titleMode(NavigationTitleMode.Full)
    .navDestination(this.destinationMap)
    .mode(NavigationMode.Auto)
  }

  @Builder
  destinationMap(name: string, param: Object) {
    if (name === 'DetailPage') {
      DetailPage({ id: param as number })
    } else if (name === 'EditPage') {
      EditPage()
    }
  }
}
```

> - `pathStack` 用 `@Provide('pathStack')` 让子页面可用 `@Consume('pathStack')` 接到路由栈（子页面 push/pop 时不用自己 new）。
> - `new NavPathStack()` 作为 `private` / `@Provide` 成员，**不要**加 `@State`。
> - `navDestination` 的 `@Builder` 只能**一个根节点**；builder 里用 `if/else if` 分派，不要 `switch`（ArkTS 中 `@Builder` 对 switch 支持有限，if/else 更稳）。
> - **不要**用 `'DetailPage' | 'EditPage'` 联合字面量作 `@State` 字段（ArkTS 硬红线，见 [SKILL.md §5](../SKILL.md)）。

## 4. 事件与交互逻辑

### 路由 push / pop（最高频）

```typescript
// 入栈：对象式传参
this.pathStack.pushPath({ name: 'DetailPage', param: { id: 123 } } as NavPathInfo)

// 入栈：按名字传参 + 接收返回值
this.pathStack.pushPathByName('DetailPage', { id: 123 }, (popInfo: PopInfo): void => {
  // 子页面 pop(result) 时这里会拿到 popInfo.result
  console.info('返回结果：' + JSON.stringify(popInfo.result))
})

// 入栈：返 Promise，可 catch 错误码 100005（builder 未注册）/ 100006（页面不存在）
this.pathStack.pushDestination({ name: 'DetailPage', param: 1 } as NavPathInfo)
  .catch((err: Error): void => {
    console.error('push 失败: ' + err.message)
  })

// 出栈：普通出栈（从子页面调用即返回首页方向）
this.pathStack.pop()

// 出栈：带 result，会触发之前 push 时注册的 onPop 回调
this.pathStack.pop({ saved: true })

// 一键回首页（清空整个栈）
this.pathStack.clear()
```

### 替换栈顶（不新增历史）

```typescript
this.pathStack.replacePath({ name: 'LoginPage' } as NavPathInfo)
// 用于"登录成功后替换当前登录页"，避免按返回键回到登录页
```

### 跳转拦截（类似全局路由守卫）

```typescript
aboutToAppear(): void {
  this.pathStack.setInterception({
    willShow: (
      from: NavDestinationContext | NavBar,
      to: NavDestinationContext | NavBar,
      operation: NavigationOperation,
      isAnimated: boolean
    ): void => {
      // 在 willShow 里可以直接操作 pathStack 改变目标，当前帧生效
      if (typeof to !== 'string' && to.pathInfo.name === 'OrderPage' && !this.isLoggedIn()) {
        this.pathStack.pop()                               // 先把 OrderPage 弹掉
        this.pathStack.pushPath({ name: 'LoginPage' } as NavPathInfo)
      }
    }
  })
}
```

### 标题栏模式变化事件（Free 模式）

```typescript
Navigation(this.pathStack) { /* ... */ }
  .title('标题')
  .titleMode(NavigationTitleMode.Free)
  .onTitleModeChange((mode: NavigationTitleMode): void => {
    // Free 模式下，滚动到顶变 Full / 滚动不在顶变 Mini 时触发
    console.info('当前标题模式：' + mode)
  })
```

### 分栏状态变化（双栏 Split 显隐）

```typescript
.onNavBarStateChange((isVisible: boolean): void => {
  // Split 模式下，navBar 区域显示/隐藏时触发
})
.onNavigationModeChange((mode: NavigationMode): void => {
  // Auto 模式下宽高变化导致 Stack ↔ Split 切换时触发（比如折叠屏展开）
})
```

## 5. 数据结构 / 关键参数

### 构造重载

| 形态 | 签名 | 说明 |
|------|------|------|
| API 8 | `Navigation()` | 最老形态，**不推荐新代码用** |
| **API 10+（推荐）** | `Navigation(pathInfos: NavPathStack)` | 绑定路由栈 |
| API 20+ | `Navigation(pathInfos: NavPathStack, homeDestination: HomePathInfo)` | 指定一个 NavDestination 作为首页 |

### 核心属性速览

| 属性 | 类型 | 场景 |
|------|------|------|
| `title` | `ResourceStr \| CustomBuilder \| NavigationCommonTitle \| NavigationCustomTitle` | 标题内容，常用 `'文字'` 或 `{ main, sub } as NavigationCommonTitle` |
| `titleMode` | `NavigationTitleMode`: `Free` / `Full` / `Mini` | 标题样式，默认 `Free`（随滚动缩小） |
| `menus` | `Array<NavigationMenuItem> \| CustomBuilder` | 右上角菜单，竖屏最多 3 个图标 |
| `toolbarConfiguration` | `Array<ToolbarItem> \| CustomBuilder` | 底部工具栏，均分显示，最多 5 个图标 |
| `hideTitleBar` / `hideToolBar` / `hideBackButton` / `hideNavBar` | `boolean`（第二参 `animated`，API 13+） | 各种隐藏 |
| `mode` | `NavigationMode`: `Stack` / `Split` / `Auto` | 显示模式，默认 `Auto`（宽 ≥ 600vp 分栏） |
| `navBarWidth` / `navBarPosition` | `Length` / `NavBarPosition.Start\|End` | 分栏模式下 navBar 宽度 / 位置 |
| `navBarWidthRange` | `[Dimension, Dimension]` | 分割线可拖拽范围 |
| `minContentWidth` | `Dimension` | 内容区最小宽度，默认 360vp |
| `backButtonIcon` | `string \| PixelMap \| Resource \| SymbolGlyphModifier` | 自定义返回图标 |
| `systemBarStyle` | `Optional<SystemBarStyle>` | 状态栏样式（浅色 / 深色） |
| `navDestination` | `(name: string, param: unknown) => void`（Builder） | **路由表构造器**，按 name 分派 |
| `recoverable` | `boolean`（API 14+） | 是否参与状态恢复 |

### 枚举速查

**`NavigationMode`**：

| 值 | 说明 |
|----|------|
| `Stack` | 单栏，子页面覆盖首页 |
| `Split` | 分栏，左 navBar 右 content（分割线可拖） |
| `Auto`（默认） | 宽 ≥ 600vp → `Split`，否则 `Stack`（自折叠屏 / 平板适配首选） |

**`NavigationTitleMode`**：

| 值 | 说明 |
|----|------|
| `Free`（默认 0） | 随滚动缩小；满屏滚动组件时标题从大变小 |
| `Full`（1） | 固定大标题；只有主标题 112vp / 主 + 副 138vp |
| `Mini`（2） | 固定小标题；统一 56vp |

**`LaunchMode`**（API 12+，`NavigationOptions.launchMode`）：

| 值 | 行为 |
|----|------|
| `STANDARD`（默认） | 正常 push / replace |
| `MOVE_TO_TOP_SINGLETON` | 同名已存在则移到栈顶，否则正常 push |
| `POP_TO_SINGLETON` | 同名已存在则弹出其上所有页面，否则正常 push |
| `NEW_INSTANCE` | 强制创建新实例，不复用 |

### `NavPathInfo`（API 10+）

```typescript
new NavPathInfo(
  name: string,                          // 子页面名，必须和 navDestination(builder) 分派的 name 匹配
  param: unknown,                        // 参数，builder 里用 `param` 接
  onPop?: Callback<PopInfo>,             // 子页面 pop(result) 时触发，result 在 popInfo.result
  isEntry?: boolean                      // 是否作为入口页面（全局返回不拦截）
)
```

### `PopInfo`（API 11+）

```typescript
interface PopInfo {
  info: NavPathInfo     // 当前页面信息（系统填充）
  result: Object        // 子页面 pop(result) 时传入的数据
}
```

### `NavPathStack` 路由方法速览

| 方法 | 签名 | 用途 |
|------|------|------|
| `pushPath` | `(info: NavPathInfo, options?: NavigationOptions \| boolean)` | 主力入栈 |
| `pushPathByName` | `(name: string, param: Object, onPop?: Callback<PopInfo>, animated?: boolean)` | 按名入栈 + 返回回调 |
| `pushDestination` | `(info: NavPathInfo, options?: NavigationOptions \| boolean) => Promise<void>` | 入栈失败走 `.catch`，错误码 100005/100006 |
| `replacePath` | `(info: NavPathInfo, options?: NavigationOptions \| boolean)` | 替换栈顶 |
| `pop` | `(result?: Object, animated?: boolean) => NavPathInfo \| undefined` | 栈顶出栈 + 返 result |
| `popToName` | `(name: string, result?: Object, animated?: boolean) => number` | 回退到指定页 |
| `popToIndex` | `(index: number, result?: Object, animated?: boolean)` | 回退到指定索引 |
| `clear` | `(animated?: boolean)` | 清空整个栈 |
| `moveToTop` / `moveIndexToTop` | 同名 | 把指定页移到栈顶 |
| `removeByName` / `removeByIndexes` / `removeByNavDestinationId` | 多种删除 | 按名 / 索引 / id 删除栈中页面 |
| `size` | `() => number` | 当前栈深 |
| `getAllPathName` | `() => Array<string>` | 所有页名 |
| `getParamByName` / `getParamByIndex` | 同名 | 拿参数 |
| `disableAnimation` | `(value: boolean)` | 全局禁用转场动画 |
| `setInterception` | `(interception: NavigationInterception)` | 全局拦截器 |
| `getParent` | `() => NavPathStack \| null` | 嵌套 Navigation 时获取父栈 |

## 6. 联动说明

### 与 `NavDestination` 的配合（子页面）

```typescript
// 在 destinationMap 分派里，或直接在 .ets 文件里声明一个组件
@Component
export struct DetailPage {
  @Consume('pathStack') pathStack: NavPathStack

  build() {
    NavDestination() {
      Button('返回首页').onClick((): void => {
        this.pathStack.pop({ saved: true })      // 带 result 返回
      })
    }
    .title('详情页')
    .onBackPressed((): boolean => {
      // 返回 true 表示拦截系统返回键（不会自动 pop）
      return false
    })
  }
}
```

子页面完整 API（`onShown` / `onWillAppear` / `onBackPressed` / `bindToScrollable` / `mode(DIALOG)` 等）见 [NavDestination.md](NavDestination.md)。

### 与 `HdsNavigation` 的选型与切换

`HdsNavigation` **继承自 `Navigation`**，所以不是"二选一"，而是"要不要 HDS 6.1 的动态模糊标题栏 / 滚动联动"。速选表：

| 触发条件（命中任一） | 选择 |
|---------------------|------|
| 需要兼容 **API < 20** 设备 / **TV 设备** | **`Navigation`** |
| 需要**动态模糊标题栏**（滚动时 titleBar 背景从透明渐变为模糊）/ **双标题样式**（Free 模式的大小切换增强动效） | **`HdsNavigation`** |
| 其他（默认、简单业务页、不引 Kit 依赖） | **`Navigation`** |

> 完整决策优先级 + 避免误区见 [hds-migration.md §1.6](patterns/hds-migration.md#16-hdsnavigation-vs-navigation-选型决策)。

业务要迁到 HDS 版时：

1. `Navigation` → `HdsNavigation`（只改主组件），见 [hds-migration.md §2](patterns/hds-migration.md#2-只改主组件铁律--不要给所有东西加-hds-前缀)
2. `NavPathStack` / `NavPathInfo` / `NavDestination` / `ToolbarItem` **保持不变**
3. 额外可用 HDS 6.1 三件套：`barOverlap(true)` + 动态模糊标题栏 + 双样式

### 与 `router`（旧 API）的边界

- 新代码**始终**用 `Navigation + NavPathStack`
- 旧代码遗留 `router.pushUrl / router.back` 时**不要混用**（两个路由栈是独立的，混用会导致返回键行为错乱）
- 迁移路径：整个模块改成 `Navigation` 容器后，把 `router.pushUrl(url)` 全改成 `pathStack.pushPath({ name })`

## 7. 完整代码示例

### 示例 A：最小可运行的 push / pop + 返回值

```typescript
import { NavPathStack, NavPathInfo, PopInfo } from '@kit.ArkUI'

@Entry
@Component
struct HomePage {
  @Provide('pathStack') pathStack: NavPathStack = new NavPathStack()
  @State selectedId: number = 0

  build() {
    Navigation(this.pathStack) {
      Column({ space: 12 }) {
        Text('首页').fontSize(24)
        Text('最后选择：' + this.selectedId)
        Button('选择一个 ID').onClick((): void => {
          this.pathStack.pushPathByName(
            'PickerPage',
            undefined,
            (popInfo: PopInfo): void => {
              this.selectedId = popInfo.result as number
            }
          )
        })
      }
      .padding(16)
    }
    .title('应用')
    .titleMode(NavigationTitleMode.Mini)
    .mode(NavigationMode.Stack)
    .navDestination(this.destinationMap)
  }

  @Builder
  destinationMap(name: string, param: Object) {
    if (name === 'PickerPage') {
      PickerPage()
    }
  }
}

@Component
struct PickerPage {
  @Consume('pathStack') pathStack: NavPathStack

  build() {
    NavDestination() {
      List() {
        ForEach([1, 2, 3, 4, 5], (id: number) => {
          ListItem() {
            Text('ID ' + id).padding(12)
          }.onClick((): void => {
            this.pathStack.pop(id)   // 返回值
          })
        }, (id: number): string => id.toString())
      }
    }
    .title('选择 ID')
  }
}
```

### 示例 B：登录拦截（setInterception）+ 菜单 + 底部工具栏

```typescript
@Entry
@Component
struct AppShell {
  @Provide('pathStack') pathStack: NavPathStack = new NavPathStack()
  @State isLoggedIn: boolean = false

  aboutToAppear(): void {
    this.pathStack.setInterception({
      willShow: (
        from: NavDestinationContext | NavBar,
        to: NavDestinationContext | NavBar,
        operation: NavigationOperation,
        isAnimated: boolean
      ): void => {
        if (typeof to !== 'string' && to.pathInfo.name === 'OrderPage' && !this.isLoggedIn) {
          this.pathStack.pop()
          this.pathStack.pushPath({ name: 'LoginPage' } as NavPathInfo)
        }
      }
    })
  }

  build() {
    Navigation(this.pathStack) {
      Column() {
        Button('订单中心').onClick((): void => {
          this.pathStack.pushPath({ name: 'OrderPage' } as NavPathInfo)
        })
      }
    }
    .title({ main: '首页', sub: '欢迎' } as NavigationCommonTitle)
    .titleMode(NavigationTitleMode.Full)
    .menus([
      {
        value: '搜索',
        icon: $r('app.media.ic_search'),
        action: (): void => { /* ... */ }
      } as NavigationMenuItem,
      {
        value: '设置',
        icon: $r('app.media.ic_settings'),
        action: (): void => { /* ... */ }
      } as NavigationMenuItem
    ])
    .toolbarConfiguration([
      { value: '首页', icon: $r('app.media.ic_home'), action: (): void => { } } as ToolbarItem,
      { value: '我的', icon: $r('app.media.ic_mine'), action: (): void => { } } as ToolbarItem
    ])
    .mode(NavigationMode.Auto)
    .navDestination(this.destinationMap)
  }

  @Builder
  destinationMap(name: string, param: Object) {
    if (name === 'OrderPage') {
      OrderPage()
    } else if (name === 'LoginPage') {
      LoginPage()
    }
  }
}
```

### 示例 C：LaunchMode.MOVE_TO_TOP_SINGLETON（单例页，避免重复入栈）

```typescript
// 点击"个人中心"时，如果栈里已经有 ProfilePage，就把它移到栈顶而不是新建
this.pathStack.pushPath(
  { name: 'ProfilePage' } as NavPathInfo,
  { launchMode: LaunchMode.MOVE_TO_TOP_SINGLETON, animated: true } as NavigationOptions
)
```

## 8. 反面示例

### ❌ 在 `aboutToAppear` 里直接调 `pushDestination`

```typescript
// 错误：官方明确提示"不建议在 aboutToAppear 中使用栈操作"
// 此时页面未构建完成，会白屏或跳转失败
aboutToAppear(): void {
  this.pathStack.pushDestination({ name: 'LoginPage' } as NavPathInfo)   // ← 可能崩
}

// 正确：在 onAppear / onPageShow 或用户事件里
onPageShow(): void {
  if (!this.isLoggedIn) {
    this.pathStack.pushPath({ name: 'LoginPage' } as NavPathInfo)
  }
}
```

### ❌ 箭头函数不带类型标注

```typescript
// 错误：违反 SKILL.md §3
this.pathStack.pushPathByName('DetailPage', 1, (popInfo) => {      // ← popInfo 缺类型
  console.info(popInfo.result)
})

// 正确
this.pathStack.pushPathByName('DetailPage', 1, (popInfo: PopInfo): void => {
  console.info(popInfo.result as string)
})
```

### ❌ 用联合字面量做 `mode` 状态

```typescript
// 错误：违反 SKILL.md §5
@State navMode: 'Stack' | 'Split' | 'Auto' = 'Auto'

// 正确：用枚举本身
@State navMode: NavigationMode = NavigationMode.Auto
```

### ❌ `Navigation` 和 `@ohos.router` 混用

```typescript
// 错误：Navigation 有自己的 NavPathStack，router 是独立命名空间
// 两者的路由栈互不感知，会导致按返回键时行为错乱
this.pathStack.pushPath({ name: 'DetailPage' } as NavPathInfo)
router.back()     // ← 不会弹掉刚 push 的 DetailPage，会回到 router 的上一页
```

### ❌ `navDestination` Builder 里多个根节点

```typescript
// 错误：官方明确要求"builder 下只能有一个根节点"
@Builder
destinationMap(name: string, param: Object) {
  Text('顶部提示')                          // ← 多出来的根节点
  if (name === 'DetailPage') {
    DetailPage()
  }
}

// 正确：总是一个 NavDestination 作为根
@Builder
destinationMap(name: string, param: Object) {
  if (name === 'DetailPage') {
    DetailPage()
  } else if (name === 'EditPage') {
    EditPage()
  }
}
```

### ❌ 把 `NavPathStack` 放 `@State`

```typescript
// 错误：NavPathStack 是命令式对象，本身不需要响应式
@State pathStack: NavPathStack = new NavPathStack()

// 正确：普通成员 + @Provide 让子页面 @Consume 拿到
@Provide('pathStack') pathStack: NavPathStack = new NavPathStack()
```

## 9. API 速查

### 构造

| 接口 | 签名 | 说明 |
|------|------|------|
| `Navigation` | `(pathInfos?: NavPathStack, home?: HomePathInfo)` | 推荐带 `NavPathStack` 形态 |
| `NavPathStack` | `new NavPathStack()` | 路由栈，`@kit.ArkUI` 导出 |
| `NavPathInfo` | `(name, param, onPop?, isEntry?)` | 路由项 |

### 高频属性

| 属性 | 类型 |
|------|------|
| `title` | `ResourceStr \| NavigationCommonTitle \| NavigationCustomTitle \| CustomBuilder` |
| `titleMode` | `NavigationTitleMode`: `Free` / `Full` / `Mini` |
| `menus` | `Array<NavigationMenuItem> \| CustomBuilder` |
| `toolbarConfiguration` | `Array<ToolbarItem> \| CustomBuilder` |
| `mode` | `NavigationMode`: `Stack` / `Split` / `Auto` |
| `navBarWidth` / `navBarPosition` | `Length` / `NavBarPosition` |
| `hideTitleBar` / `hideToolBar` / `hideNavBar` / `hideBackButton` | `boolean`（第二参 animated） |
| `navDestination` | `(name: string, param: unknown) => void`（Builder） |
| `systemBarStyle` | `Optional<SystemBarStyle>` |

### 核心事件

| 事件 | 签名 | 说明 |
|------|------|------|
| `onTitleModeChange` | `(mode: NavigationTitleMode) => void` | Free 模式下滚动触发 |
| `onNavBarStateChange` | `(isVisible: boolean) => void` | Split 模式下 navBar 显隐 |
| `onNavigationModeChange` | `(mode: NavigationMode) => void` | Auto 模式下 Stack ↔ Split |

### `NavPathStack` 常用方法

| 方法 | 签名 | 用途 |
|------|------|------|
| `pushPath` | `(info: NavPathInfo, options?: NavigationOptions \| boolean)` | 主力入栈 |
| `pushPathByName` | `(name, param, onPop?, animated?)` | 按名入栈 |
| `pushDestination` | `(info, options?) => Promise<void>` | 异步入栈，可 catch |
| `replacePath` | `(info, options?)` | 替换栈顶 |
| `pop` | `(result?, animated?) => NavPathInfo \| undefined` | 栈顶出栈 |
| `popToName` | `(name, result?, animated?) => number` | 回退到指定页 |
| `clear` | `(animated?)` | 清空栈 |
| `setInterception` | `(interception: NavigationInterception)` | 全局路由拦截 |
| `size` | `() => number` | 栈深 |
| `getAllPathName` | `() => Array<string>` | 所有页名 |

**记忆锚点**：

- 现代写法 = `Navigation(pathStack)` + `navDestination(builder)` + `pathStack.pushPath`
- 子页面用 `@Consume('pathStack')` 拿到栈，**不要** `new NavPathStack()` 再拿一个
- 返回值用 `pushPathByName` 的 `onPop` 回调 **或** `NavPathInfo` 构造函数的 `onPop` 参数
- 拦截用 `setInterception({ willShow })`，是**类似 Vue/React Router 的全局守卫**
- 新代码别碰 `@ohos.router`;子页面生命周期见 [NavDestination.md](NavDestination.md)
