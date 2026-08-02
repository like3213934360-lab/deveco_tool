# HdsNavDestination 组件功能逻辑规格

> HDS (UI Design Kit) 组件。**必须配合 `HdsNavigation` 使用**，作为路由子页的根节点。对应 ArkUI 基础组件 `NavDestination`。
> 华为官方原文：[../../../hds参考文档/中文文档/HdsNavDestination.md](../../../hds参考文档/中文文档/HdsNavDestination.md)
> 父容器文档：[HdsNavigation.md](HdsNavigation.md)

## 1. 功能定位

HdsNavDestination 是子页面的根容器,承担"页面级"职责:

- 页面级标题栏(`titleBar` / `hideTitleBar` / `hideBackButton`)
- 页面级工具栏(`toolbarConfiguration` / `hideToolBar`)
- 页面生命周期(`onShown` / `onHidden` / `onWillAppear` / `onWillDisappear` / `onReady` / `onBackPressed` / `onActive` / `onInactive`)
- 标题栏随内容滚动的动态模糊/显隐(`bindToScrollable` / `dynamicHideTitleBar`)
- 系统状态栏联动(`systemBarStyle`,对应 original / scrollEffect 两套)
- 转场动画(`systemTransition` / `customTransition`)
- 栈恢复(`recoverable`,冷启动自动恢复页面栈)

**起始版本**:5.1.0 (API 18)。6.0.0 (API 20) 起推荐使用 `bindToScrollable`。

## 2. 典型场景

- 详情页根容器(文章、商品、设置项)
- 表单页(登录、编辑资料),标题栏 + 工具栏 + 输入区
- 沉浸式图片/视频详情页(标题栏随滚动显隐 + 动态模糊)
- 半模态式菜单页(`titleMode(HdsNavDestinationTitleMode.MODAL)`)

## 3. 状态声明

```typescript
import { HdsNavDestination, ScrollEffectType } from '@kit.UIDesignKit'
import { LengthMetrics } from '@kit.ArkUI'

@Component
struct DetailPage {
  private scroller: Scroller = new Scroller()

  @State title: string = '详情'
  @State menuBadgeCount: number = 0

  aboutToAppear(): void {}
}
```

> - `scroller` 是普通成员,用来绑定 `bindToScrollable`,**不要**加 `@State`。
> - 不需要自己维护"是否可见"——用生命周期回调即可。
> - 不要给 HdsNavDestination 设置 `width` / `height` / `position`,会破坏动态模糊。

## 4. 事件与交互逻辑

### 生命周期顺序(必须记牢)

```
onWillAppear → onReady → onWillShow → onShown
                                        ↓
                                    (页面可见 / 激活)
                                        ↓
                  onWillHide  →  onHidden  →  onWillDisappear
```

- `onReady(ctx: NavDestinationContext)`:即将构建子组件时触发,**只会触发一次**,适合做"基于路由参数拉数据"的初始化。`ctx.pathInfo.param` 里能拿到 `pushPathByName` 传入的参数。
- `onShown` / `onHidden`:页面显示/隐藏,会在 push/pop 过程中多次触发,不要在里面做大计算。
- `onActive` / `onInactive`(API 21):处于栈顶且无遮挡时才是 active,**弹窗遮挡会进入 inactive**。适合"暂停视频"、"暂停音频"这种行为。
- `onBackPressed: () => boolean`:返回 true 表示拦截返回键。**不要**和自定义返回按钮的 onClick 同时重写导航栈,会冲突。

### 拉取路由参数的标准写法

```typescript
.onReady((ctx: NavDestinationContext) => {
  const param = ctx.pathInfo.param as Record<string, Object>
  if (param) {
    this.title = param['title'] as string
  }
})
```

### 标题栏随滚动动态隐藏

```typescript
HdsNavDestination() {
  Scroll(this.scroller) {
    Column() { /* ... */ }
  }
}
.bindToScrollable([this.scroller])
.dynamicHideTitleBar({ /* DynamicHideParams 见 HdsNavigation.md */ })
```

## 5. 数据结构

- `HdsNavigationTitleBarOptions`:和 HdsNavigation 的 `titleBar` 同一类型,见 [HdsNavigation.md 第 5 节](HdsNavigation.md)。
- `NavDestinationMode`(枚举,来自 `@ohos.arkui`):
  - `STANDARD`(默认):标准模式。
  - `DIALOG`:对话框模式,透明背景,不压栈。
- `HdsNavDestinationTitleMode`(枚举,API 20+):
  - `MINI = 100`:标题栏 56vp,动态显隐生效。
  - `MODAL = 101`:半模态,背板 64vp,上 padding 8vp,**不支持动态显隐**。
- `NavDestinationActiveReason`:`TRANSITION` / `CONTENT_COVER` / `SHEET` / `DIALOG` / 等,用于区分是"切页"导致的 inactive 还是"弹窗遮挡"。
- `NavigationSystemTransitionType`:`DEFAULT` / `NONE` / `TITLE` / `CONTENT` / `FADE` / `EXPLODE` / `SLIDE_RIGHT` / `SLIDE_BOTTOM`。

## 6. 联动说明

- **必须**作为 HdsNavigation 的直接子节点渲染(不是 `build()` 里静态放,而是通过 `navDestination: NavPathInfo => NavDestination 构造` 在 HdsNavigation 上注册)。
- `recoverable(true)` 只在 HdsNavigation 也设置了 `recoverable(true)` 时生效。
- `systemBarStyle` 的 `scrollEffectStyle` 只有在 titleBar 配了 `scrollEffectOpts.enableScrollEffect = true` 时才会被触发。
- 多个 `Scroller` 绑同一页时(比如嵌套 List),用 `bindToNestedScrollable`,避免彼此顶撞。
- 与 `HdsActionBar` / `HdsSnackBar` 共存时,注意 onInactive 回调会在弹层遮挡时触发,**不要在 onHidden 里释放资源**(弹窗遮挡时 onHidden 不触发,但业务可能期望暂停)。

## 7. 完整代码示例

> 详情页:路由参数回显 + 标题栏动态模糊 + 工具栏 + 返回拦截。通常作为 HdsNavigation `navDestination` 构造器里的 `@Component`;这里为了让示例可单独读,用 `@Entry` 标注,实际挂入 HdsNavigation 时去掉 `@Entry` 即可。

```typescript
import {
  HdsNavDestination,
  ScrollEffectType
} from '@kit.UIDesignKit'
import {
  LengthMetrics,
  NavDestinationContext
} from '@kit.ArkUI'

interface DetailParam {
  id: string
  title: string
}

@Entry
@Component
export struct DetailPage {
  private scroller: Scroller = new Scroller()

  @State title: string = ''
  @State content: string = ''
  @State hasUnsavedChanges: boolean = false

  build() {
    HdsNavDestination() {
      Scroll(this.scroller) {
        Column({ space: 16 }) {
          Blank().height(56)
          Text(this.content)
            .fontSize(16)
            .padding({ left: 16, right: 16 })
          ForEach([1, 2, 3, 4, 5, 6, 7, 8], (i: number) => {
            Image($r('app.media.startIcon'))
              .width('100%')
              .height(200)
          })
        }
      }
      .edgeEffect(EdgeEffect.Spring)
      .scrollBar(BarState.Off)
    }
    .titleBar({
      padding: {
        start: LengthMetrics.vp(2),
        end: LengthMetrics.vp(2)
      },
      style: {
        scrollEffectOpts: {
          enableScrollEffect: true,
          scrollEffectType: ScrollEffectType.COMMON_BLUR,
          blurEffectiveStartOffset: LengthMetrics.vp(0),
          blurEffectiveEndOffset: LengthMetrics.vp(20)
        }
      },
      content: {
        title: { mainTitle: this.title },
        menu: {
          value: [{
            content: {
              label: '分享',
              icon: 'resources/base/media/startIcon.png',
              isEnabled: true,
              action: () => {
                console.info('share tap')
              }
            }
          }]
        }
      }
    })
    .bindToScrollable([this.scroller])
    .hideBackButton(false)
    .onReady((ctx: NavDestinationContext) => {
      const p = ctx.pathInfo.param as DetailParam
      if (p) {
        this.title = p.title
        this.content = `详情页 id=${p.id}`
      }
    })
    .onBackPressed(() => {
      if (this.hasUnsavedChanges) {
        return true
      }
      return false
    })
    .onInactive((reason?: NavDestinationActiveReason) => {
      console.info('paused, reason=' + reason)
    })
  }
}
```

## 8. 反面示例

下面是一组常见坑,都标了 ❌,请与正例对照着读。

```typescript
// ❌ 在 HdsNavDestination 上直接设置布局属性(会让动态模糊/标题栏高度异常)
HdsNavDestination() { /* ... */ }
  .width('100%')
  .height(500)
  .position({ x: 0, y: 100 })
// 正解:让 HdsNavigation / HdsNavDestination 自动占满父容器,内部用 Scroll / Column 控制内容。

// ❌ 在 onShown 里做重初始化 —— onShown 每次 push/pop 回到页面都会触发
.onShown(() => {
  this.fetchDetail(this.id)
})
// 正解:"只拉一次"用 onReady;"每次回到页面刷新"才用 onShown,并自己做 diff。

// ❌ 用联合字面量当 titleMode —— ArkTS @State 不支持联合字面量
// @State mode: 'mini' | 'modal' = 'mini'
// 正解:用 HdsNavDestinationTitleMode 枚举
// @State mode: HdsNavDestinationTitleMode = HdsNavDestinationTitleMode.MINI

// ❌ 直接在 @Entry 页面里写 HdsNavDestination —— 会报"必须作为 HdsNavigation 的 NavDestination 使用"
// @Entry @Component struct Index { build() { HdsNavDestination() { /* ... */ } } }
// 正解:在 HdsNavigation 的 navDestination 构造器里返回 HdsNavDestination。

// ❌ systemBarStyle 只传一个参数(滚动生效后状态栏会看不清)
HdsNavDestination() { /* ... */ }
  .systemBarStyle({ statusBarContentColor: '#000000' })
// 正解:两个参数都必填 —— (originalStyle, scrollEffectStyle)
HdsNavDestination() { /* ... */ }
  .systemBarStyle(
    { statusBarContentColor: '#000000' },
    { statusBarContentColor: '#FFFFFF' }
  )
```

## 9. API 速查

| 属性/事件 | 类型签名 | 起始版本 | 说明 |
|----------|---------|---------|------|
| `titleBar` | `(options?: HdsNavigationTitleBarOptions)` | 5.1.0 | 页面级标题栏(完整选项见 HdsNavigation.md) |
| `hideTitleBar` | `(hide: boolean, animated?: boolean)` | 5.1.0 | 显隐标题栏 |
| `hideBackButton` | `(value: boolean)` | 5.1.0 | 返回键显隐 |
| `mode` | `(value: NavDestinationMode)` | 5.1.0 | STANDARD / DIALOG |
| `titleMode` | `(value: HdsNavDestinationTitleMode)` | 6.0.0 | MINI(100) / MODAL(101) |
| `toolbarConfiguration` | `(items: Array<ToolbarItem> \| CustomBuilder, opts?)` | 5.1.0 | 底部工具栏 |
| `hideToolBar` | `(hide: boolean, animated?: boolean)` | 5.1.0 | 显隐工具栏 |
| `ignoreLayoutSafeArea` | `(types?: Array<LayoutSafeAreaType>, edges?: Array<LayoutSafeAreaEdge>)` | 5.1.0 | 扩展到非安全区 |
| `systemBarStyle` | `(originalStyle, scrollEffectStyle)` | 5.1.0 | 状态栏样式,两参必填 |
| `recoverable` | `(recoverable: Optional<boolean>)` | 5.1.0 | 冷启动恢复 |
| `dynamicHideTitleBar` | `(value: DynamicHideParams)` | 6.0.0 | 滚动动态显隐,需配 bindToScrollable |
| `bindToScrollable` | `(scrollers: Array<Scroller>)` | 6.0.0 | 绑定可滚动容器 |
| `bindToNestedScrollable` | `(scrollers: Array<NestedScrollInfo>)` | 6.0.0 | 绑定嵌套滚动 |
| `systemTransition` | `(type: NavigationSystemTransitionType)` | 6.0.0 | 系统转场 |
| `customTransition` | `(delegate: NavDestinationTransitionDelegate)` | 6.0.0 | 自定义转场 |
| `onShown` / `onHidden` | `Callback<void>` | 5.1.0 | 显/隐回调(会多次触发) |
| `onReady` | `Callback<NavDestinationContext>` | 5.1.0 | 构建前,只触发一次,读路由参数用 |
| `onWillAppear` / `onWillDisappear` | `Callback<void>` | 5.1.0 | 挂载/卸载前 |
| `onWillShow` / `onWillHide` | `Callback<void>` | 5.1.0 | 显隐前 |
| `onBackPressed` | `Callback<void, boolean>` | 6.0.0 | 返回 true 拦截 |
| `onActive` / `onInactive` | `Optional<Callback<NavDestinationActiveReason>>` | 6.0.1 | 激活/失活(弹窗遮挡触发 inactive) |
