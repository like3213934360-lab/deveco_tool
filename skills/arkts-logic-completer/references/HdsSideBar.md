# HdsSideBar 组件功能逻辑规格

> HDS (UI Design Kit) 组件,**@ComponentV2** 装饰器,仅 Stage 模型可用。
> 华为官方原文:[../../../hds参考文档/中文文档/HdsSideBar.md](../../../hds参考文档/中文文档/HdsSideBar.md)
> 对应 ArkUI 基础组件 `SideBarContainer`(Side/Overlay/Auto 容器),HdsSideBar 在其基础上增加窗口焦点时的模糊、内容区蒙层、自适应隐藏等 HDS 规范效果。

## 1. 功能定位

支持显示/隐藏的侧边栏容器,**左右分栏**:

- **侧边栏区**(`sideBarPanelBuilder`,必填,CustomBuilder):通常放菜单/目录/分类
- **内容区**(`contentPanelBuilder`,必填,CustomBuilder):主内容
- 支持嵌入(Embed)/悬浮(Overlay)/自适应(Auto)三种容器类型
- 支持拖拽分割线改宽度,拖到最小宽度时可自动隐藏(`autoHide`)
- 窗口获焦时侧边栏自带模糊效果(`isSideBarBlur`,可关)
- 悬浮模式可选"内容区蒙层"(`contentAreaMask`)

**起始版本**:6.0.0 (API 20)。

## 2. 典型场景

- 平板/展开折叠屏的左侧目录树 + 右侧详情(文件管理、备忘录、邮箱)
- 笔记 App 的"文件夹列表 + 笔记详情"三栏简化版
- 配置中心类应用的"设置分类 + 右侧子设置"

## 3. 状态声明

```typescript
import { HdsSideBar } from '@kit.UIDesignKit'

@Entry
@ComponentV2
struct Workspace {
  @Local isShowSidebar: boolean = true

  @Builder
  SideBarPanel() {
    Column() { Text('菜单') }
  }

  @Builder
  ContentPanel() {
    Column() { Text('主内容') }
  }

  @BuilderParam sideBarBuilder: () => void = this.SideBarPanel
  @BuilderParam contentBuilder: () => void = this.ContentPanel
}
```

> - 使用 `@ComponentV2` + `@Local`,不能用 `@State`。
> - **必须**声明两个 `@BuilderParam` 并用 `this.xxx` 赋初值——HdsSideBar 构造参数 `sideBarPanelBuilder` / `contentPanelBuilder` 要求是 `@BuilderParam` 回调,不能直接传 `this.SideBarPanel`。
> - 显隐状态用 `@Local`,通过 `$isShowSideBar` 回写。

## 4. 事件与交互逻辑

### 双向绑定显隐

```typescript
HdsSideBar({
  isShowSideBar: this.isShowSidebar,
  $isShowSideBar: (v: boolean) => {
    this.isShowSidebar = !v   // 照华为官方示例原文取反回写,否则按钮失灵
  }
})
```

> **务必取反回写**:华为官方示例(`hds参考文档/中文文档/HdsSideBar.md` 第 122-123 行)就写的 `this.isShowSidebar = !isShowSidebar`。
>
> **语义理解(推荐倾向)**:官方参数表把 `$isShowSideBar` 标为 `@Event`,其回调参数 `v: boolean` 是**组件在点击那一瞬回传的当前 `isShowSideBar` 值**(= 点击**前**的状态),**不是**"组件已经帮你切换好的新值"。组件的设计是把决定权交给使用方:"看到当前是什么,自己决定翻成什么"。对于"点一次按钮应该让侧边栏翻转"这种最常见场景,就写 `isShowSidebar = !v`。这也解释了为什么这个字段用 `$` 前缀而不是 `onChange` —— 它是**双向绑定的回写回调**,不是单向的变化通知。
>
> **反例(会让按钮失灵)**:`$isShowSideBar: (v: boolean) => { this.isShowSidebar = v }` —— 把当前值原封不动写回去,外部 `isShowSidebar` 永远不变,按钮看起来就没反应。
>
> **等价写法(效果相同,择一即可)**:
> - `$isShowSideBar: (v: boolean) => { this.isShowSidebar = !v }` —— 官方示例写法,**推荐**(溯源性最好)
> - `$isShowSideBar: () => { this.isShowSidebar = !this.isShowSidebar }` —— 忽略参数,直接用当前字段翻转;也对,但丢掉了"组件回传当前值"的语义
> - `$isShowSideBar: (v) => !v` —— 箭头函数隐式返回;本 Skill **禁用**这种无类型标注的箭头(见 SKILL.md §3 硬约束),务必显式 `(v: boolean) => { ... }`

### 侧边栏宽度自适应隐藏

`autoHide = true`(默认) 时,用户把分割线往内拖到 `minSideBarWidth` 以下,侧边栏会自动隐藏,同时触发 `onChange(false)`。

### onChange 触发时机

三类情况:
1. `showSideBar` 属性被外部改变
2. `showSideBar` 的自适应行为触发(窗口尺寸变化导致自动收起)
3. 分割线拖拽触发 autoHide

### sideBarContainerType 行为差异

- `AUTO`(默认):大屏嵌入、小屏悬浮
- `Embed`:嵌入,侧边栏和内容区并列显示(主内容收窄)
- `Overlay`:悬浮,侧边栏浮在内容上方(主内容不缩窄)

## 5. 数据结构

| 参数 | 类型 | 默认 | 必填 | 说明 |
|------|------|-----|------|-----|
| `sideBarPanelBuilder` | `CustomBuilder` | — | 是(`@Require @BuilderParam`) | 侧边栏内容构造器 |
| `contentPanelBuilder` | `CustomBuilder` | — | 是(`@Require @BuilderParam`) | 主内容构造器 |
| `isShowSideBar` | `boolean` | `true` | 否 | 是否显示侧边栏 |
| `$isShowSideBar` | `Callback<boolean>` | — | 否 | 显隐回写 |
| `minSideBarWidth` | `Length` | `200vp` | 否 | 侧边栏最小宽度 |
| `maxSideBarWidth` | `Length` | `280vp` | 否 | 侧边栏最大宽度 |
| `sideBarWidth` | `Length` | `240vp` | 否 | 初始宽度 |
| `minContentWidth` | `Length` | `360vp` | 否 | 内容区最小显示宽度 |
| `sideBarColor` | `ResourceColor` | `Transparent` | 否 | 侧边栏背景色 |
| `contentColor` | `ResourceColor` | `Transparent` | 否 | 内容区背景色 |
| `autoHide` | `boolean` | `true` | 否 | 拖到最小宽度以下自动隐藏 |
| `isSideBarBlur` | `boolean` | `true` | 否 | 获焦时侧边栏是否模糊 |
| `sideBarPosition` | `SideBarPosition` | `Start` | 否 | 侧边栏位置(Start/End) |
| `sideBarContainerType` | `SideBarContainerType` | `AUTO` | 否 | 嵌入/悬浮/自适应 |
| `contentAreaMask` | `boolean` | `true` | 否 | 悬浮场景下内容区是否加蒙层 |
| `onChange` | `Callback<boolean>` | — | 否 | 显隐变化事件 |

## 6. 联动说明

- 常与 `HdsSideMenu` 组合使用:`sideBarPanelBuilder` 内放 HdsSideMenu。
- 与 `HdsNavigation` 可同层使用——一般是 HdsSideBar 在**最外层**,侧边栏放目录,内容区放 `NavPathStack + HdsNavigation` 做路由。
- `sideBarContainerType = Overlay` + `contentAreaMask = true` 时,点击蒙层会触发收起(behavior 默认由容器处理)。
- 外部按钮控制显隐:通常在页面 Stack 顶层放一个小按钮,点击翻转 `isShowSidebar`,让 `isShowSideBar` 受控。

## 7. 完整代码示例

```typescript
import { HdsSideBar } from '@kit.UIDesignKit'

@Entry
@ComponentV2
struct FolderList {
  @Local isShowSidebar: boolean = true
  @Local selectedFolder: string = '全部'

  @Builder
  SideBarPanel() {
    Column({ space: 8 }) {
      Text('文件夹').fontSize(14).fontColor(Color.Gray)
      ForEach(['全部', '收藏', '最近删除'], (name: string) => {
        Text(name)
          .width('100%')
          .height(44)
          .padding({ left: 16 })
          .backgroundColor(this.selectedFolder === name ? '#E6E6E6' : Color.Transparent)
          .onClick(() => { this.selectedFolder = name })
      })
    }
    .width('100%')
    .height('100%')
    .padding(16)
  }

  @Builder
  ContentPanel() {
    Column() {
      Text(`${this.selectedFolder} 下的笔记`)
        .fontSize(20)
    }
    .width('100%')
    .height('100%')
    .padding(24)
  }

  @BuilderParam sideBarBuilder: () => void = this.SideBarPanel
  @BuilderParam contentBuilder: () => void = this.ContentPanel

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Button() {
        SymbolGlyph(this.isShowSidebar ? $r('sys.symbol.open_sidebar') : $r('sys.symbol.close_sidebar'))
          .fontSize(24)
          .fontColor([$r('sys.color.ohos_id_color_titlebar_icon')])
          .hitTestBehavior(HitTestMode.None)
      }
      .id('sidebar_toggle')
      .backgroundColor($r('sys.color.ohos_id_color_button_normal'))
      .width(32)
      .height(32)
      .zIndex(1)
      .margin({ top: 10, left: 10 })
      .onClick(() => { this.isShowSidebar = !this.isShowSidebar })

      HdsSideBar({
        sideBarPanelBuilder: (): void => { this.sideBarBuilder() },
        contentPanelBuilder: (): void => { this.contentBuilder() },
        sideBarContainerType: SideBarContainerType.AUTO,
        minSideBarWidth: 180,
        maxSideBarWidth: 320,
        sideBarWidth: 240,
        isShowSideBar: this.isShowSidebar,
        $isShowSideBar: (v: boolean) => { this.isShowSidebar = !v }
      })
    }
  }
}
```

## 8. 反面示例

### 错 1:不用 @BuilderParam 做中转

```typescript
HdsSideBar({
  sideBarPanelBuilder: this.SideBarPanel   // ❌ 直接传 @Builder
})
```

`sideBarPanelBuilder` 的类型是 `CustomBuilder`,HdsSideBar 要求通过 `@BuilderParam` 中转才能正确 this 绑定。正解:

```typescript
@BuilderParam sideBarBuilder: () => void = this.SideBarPanel
// ...
sideBarPanelBuilder: (): void => { this.sideBarBuilder() }
```

### 错 2:用 @Component + @State

HdsSideBar 是 V2,必须 `@ComponentV2` + `@Local`,否则编译报错"类型 @State 的属性传给 @Param 参数"。

### 错 3:把 contentAreaMask 当遮罩颜色用

```typescript
contentAreaMask: '#80000000'   // ❌
```

它是 `boolean`,不是颜色。想改蒙层颜色需要在 Overlay 场景下自己 Stack 一个 Rect 覆盖内容区。

### 错 4:minContentWidth 比 minSideBarWidth 还小

窗口变窄时会同时触发自适应隐藏 + 内容区收窄,布局发抖。请保证 `minContentWidth > minSideBarWidth * 1.2` 左右的缓冲。

### 错 5:在 @Builder 里直接 return Text

```typescript
@Builder
SideBarPanel() {
  return Text('x')   // ❌ @Builder 不支持 return
}
```

@Builder 函数体内直接写 UI 元素,不能使用 return 语句返回组件。

## 9. API 速查

> 下列参数 / 事件完全对齐华为官方原文参数表(`hds参考文档/中文文档/HdsSideBar.md` 第 28-45 行),**没有额外接口**。完整默认值和说明见第 5 节数据结构表。

### 构造 & 高频参数

| API / 参数 | 类型 / 默认值 | 说明 |
|-----------|--------------|------|
| `HdsSideBar({ ... })` | 构造接口,返回值 `void` | 必须是 `@ComponentV2` 里调用,15 个参数见官方接口签名 |
| `isShowSideBar` | `boolean`,默认 `true` | 是否显示侧边栏(`@Param`,常与 `$isShowSideBar` 组成双向绑定) |
| `$isShowSideBar` | `Callback<boolean>`(`@Event`) | 内置控制按钮点击后的回写回调,**官方示例用 `!v` 取反回写**(见第 4 节说明) |
| `sideBarContainerType` | `SideBarContainerType`,默认 `AUTO` | 显示类型:`AUTO` / `Embed` / `Overlay`(参数名与类型名都要写对) |
| `sideBarPosition` | `SideBarPosition`,默认 `Start` | 侧边栏位置:`Start`(左) / `End`(右) |

### Builder 插槽(必填)

| 构造器属性 | 类型 | 必填 | 说明 |
|-----------|------|:---:|------|
| `sideBarPanelBuilder` | `CustomBuilder` (`@Require @BuilderParam`) | ✅ | 侧栏内容构造器,通常放 `HdsSideMenu` / `List` |
| `contentPanelBuilder` | `CustomBuilder` (`@Require @BuilderParam`) | ✅ | 主内容构造器,通常放 `Navigation + NavPathStack` |

### 事件 / 回调

| 事件 | 类型 | 触发时机 |
|------|------|--------|
| `onChange` | `Callback<boolean>`(`@Param`) | 显/隐切换时触发,三种来源:属性值变化 / 自适应行为 / 拖拽触发 autoHide |
| `$isShowSideBar` | `Callback<boolean>`(`@Event`) | 组件自带控制按钮点击后回调,示例用 `!v` 回写以维持双向绑定 |

**记忆锚点**:
- V2 组件 → `@ComponentV2` + `@Local`(不是 `@State`)
- 两个 Panel → 都走 `@BuilderParam` 中转
- 参数名是 `sideBarContainerType`(小驼峰),类型名是 `SideBarContainerType`(大驼峰),**都不叫 `type` / `HdsSideBarContainerType`**
- 只有一个事件叫 `onChange`,**没有 `onDragStart` / `onDragReleased`;没有 `barMaxNum`**(这些在上一轮补表时被误加,已删除)
