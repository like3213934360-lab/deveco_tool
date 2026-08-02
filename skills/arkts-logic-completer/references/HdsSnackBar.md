# HdsSnackBar 组件功能逻辑规格

> HDS (UI Design Kit) 组件。**非声明式**——HdsSnackBar 是一个**通过类实例调用 `.show()` / `.dismiss()` 触发**的命令式弹窗,类似 `promptAction.showToast`,**不在 build() 里写**。
> 华为官方原文:[../../../hds参考文档/中文文档/HdsSnackBar.md](../../../hds参考文档/中文文档/HdsSnackBar.md)
> 对应 ArkUI 原生能力:`promptAction.showToast` / `promptAction.showDialog`,但 HdsSnackBar 提供图标+标题+内容+操作按钮的结构化非模态弹层。

## 1. 功能定位

简短通知的**非模态**弹窗,支持:

- 图标区(`SnackBarIconOptions`:支持 Image 和 SymbolGlyph)
- 内容区(标题 + 内容双行文本)
- 操作区(5 种预设操作样式,见第 5 节 `SnackBarOperationType`)
- 样式(宽度、背景色、背板模糊、定时消失时间、键盘避让、焦点链、主题、返回键拦截)
- 生命周期:`show()` 弹出,`dismiss()` 主动关闭,或 `duration` 到期自动消失

**起始版本**:6.0.0 (API 20)。

## 2. 典型场景

- 保存成功/失败的轻量反馈(带"撤销"按钮)
- 网络异常提示(带"重试"按钮,带右箭头跳转到网络设置)
- 资料已收藏 + 高亮按钮"查看收藏夹"
- 常驻通知(`duration: -1`):等待用户操作才消失

## 3. 状态声明

```typescript
import {
  HdsSnackBar,
  SnackBarIconOptions,
  SnackBarMessageOptions,
  SnackBarOperationOptions,
  SnackBarStyleOptions,
  SnackBarOperationType
} from '@kit.UIDesignKit'

@Entry
@ComponentV2
struct PageWithToast {
  private uiContext: UIContext = this.getUIContext()
  private snackBar: HdsSnackBar = new HdsSnackBar(this.uiContext)

  @Local lastMessage: string = ''
}
```

> - `snackBar` 是**普通成员**,不加 `@State` / `@Local`(UI 不依赖它的变化)。
> - 每个页面通常只需要 **1 个** HdsSnackBar 实例;多次 `show()` 之间要自己判断是否 `dismiss()`。
> - `uiContext` 从 `this.getUIContext()` 获取,**只能在 `aboutToAppear` 之后获取**,类属性初始化时读写没问题因为 ArkUI 的 getUIContext 绑定时机。

## 4. 事件与交互逻辑

### 弹出

```typescript
const icon: SnackBarIconOptions = {
  icon: $r('sys.symbol.checkmark_circle'),
  iconType: SnackBarIconType.SMALL
}
const message: SnackBarMessageOptions = {
  title: '已保存',
  content: '修改已同步至云端'
}
const operation: SnackBarOperationOptions = {
  operationType: SnackBarOperationType.TEXT_WITH_CLOSE,
  content: '撤销',
  textButtonId: 'undoBtn',
  onContentClick: () => {
    this.undo()
  },
  onCloseButtonClick: () => {
    this.snackBar.dismiss()
  }
}
const style: SnackBarStyleOptions = {
  duration: 5000
}

this.snackBar.show(icon, message, operation, style)
```

### operationType 和回调对应关系(**重点**,容易写错)

| operationType | 生效回调 | 失效回调 |
|---------------|---------|---------|
| `TEXT_ONLY` | `onContentClick` | onCloseButtonClick / onArrowClick |
| `CLOSE_BUTTON_ONLY` | `onCloseButtonClick` | onContentClick / onArrowClick |
| `TEXT_WITH_ARROW` | `onArrowClick`(点击热区是**整个 SnackBar**) | onContentClick / onCloseButtonClick |
| `TEXT_WITH_CLOSE` | `onContentClick` + `onCloseButtonClick` | onArrowClick |
| `HIGHLIGHT_TEXT_WITH_CLOSE` | `onContentClick` + `onCloseButtonClick`;**`highlightBackBoardColor` 生效** | onArrowClick |

> **TEXT_WITH_ARROW 特殊**:点击热区是整个 SnackBar,不要再额外设 `onContentClick`。

### 自动消失时间

`SnackBarStyleOptions.duration`(ms):
- **> 0**:到期自动消失
- **<= 0**:常驻,必须用户点击或 `dismiss()` 才关闭
- **默认**:5000ms

### 返回键/左滑拦截

`pressBackCallback: () => void` — 弹窗出现后,左滑屏幕时触发。可用于"左滑先关闭 SnackBar 再返回上一页"。

### 焦点链(大屏设备)

- `SnackBarStyleOptions.nextFocusId`:SnackBar 走焦到下一个组件
- `SnackBarOperationOptions.textButtonId / cancelButtonId / arrowButtonId`:给操作区按钮设 id,供外部 `nextFocus({ forward: ... })` 接进来

## 5. 数据结构

### SnackBarIconOptions

| 字段 | 类型 | 说明 |
|------|------|------|
| `icon` | `ResourceStr` | 图标资源,支持 SymbolGlyph 和 Image |
| `iconType` | `SnackBarIconType` | `SMALL=0`(默认) / `NORMAL=1` |
| `iconModifier` | `ImageModifier` | Image 样式修饰 |
| `iconSymbolModifier` | `SymbolGlyphModifier` | SymbolGlyph 样式修饰(示例见下) |

**`iconSymbolModifier` 典型构造**(链式调用,**同一个** `SymbolGlyphModifier` 实例上可叠加 `fontSize` / `fontColor` / `renderingStrategy` 等):

```typescript
import { SymbolGlyphModifier } from '@kit.ArkUI'

const icon: SnackBarIconOptions = {
  icon: $r('sys.symbol.checkmark_circle_fill'),
  iconSymbolModifier: new SymbolGlyphModifier($r('sys.symbol.checkmark_circle_fill'))
    .fontSize(24)
    .fontColor('#4CAF50')
}
```

> 构造样板来源:`hds参考文档/references/other-components.md` 第 172-176 行(HDS 开发人员版)。`SymbolGlyphModifier` **不是**从 `@kit.UIDesignKit` 导入,而是从 `@kit.ArkUI`。

### SnackBarMessageOptions

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | `ResourceStr` | 标题 |
| `titleColor` | `ColorMetrics` | 标题色 |
| `content` | `ResourceStr` | 内容文本 |
| `contentColor` | `ColorMetrics` | 内容色 |

### SnackBarOperationOptions(根据 operationType 选择字段)

| 字段 | 类型 | 生效条件 |
|------|------|---------|
| `operationType` | `SnackBarOperationType` | 必填 |
| `content` | `ResourceStr` | `TEXT_*`、`HIGHLIGHT_*`  时用作按钮文字 |
| `contentColor` | `ColorMetrics` | 同上 |
| `onContentClick` | `Callback<void>` | 见第 4 节表 |
| `onCloseButtonClick` | `Callback<void>` | `CLOSE_*`、`TEXT_WITH_CLOSE`、`HIGHLIGHT_*` |
| `onArrowClick` | `Callback<void>` | `TEXT_WITH_ARROW` 专用 |
| `arrowColor` | `ColorMetrics[]` | 仅 `TEXT_WITH_ARROW` |
| `highlightBackBoardColor` | `ColorMetrics` | 仅 `HIGHLIGHT_TEXT_WITH_CLOSE` |
| `textButtonId` / `cancelButtonId` / `arrowButtonId` | `string` | 走焦 id |
| `contentAccessibilityText` / `closeButtonAccessibilityText` + Description | — | 无障碍 |

### SnackBarStyleOptions

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `width` | `LengthMetrics` | — | — |
| `backgroundColor` | `ColorMetrics` | — | — |
| `backgroundBlurStyle` | `BlurStyle` | — | 背板模糊 |
| `duration` | `number` | `5000` | ms,<=0 常驻 |
| `keyboardUpAvoidHeight` / `keyboardDownAvoidHeight` | `LengthMetrics` | — | 键盘避让 |
| `nextFocusId` | `string` | — | 走焦 |
| `theme` / `themeColorMode` | `Theme \| CustomTheme` / `ThemeColorMode` | — | 主题 |
| `pressBackCallback` | `Callback<void>` | — | 左滑拦截 |
| `blurStrategy` | `BlurStrategy` | `ADAPTIVE` | 模糊策略(见 HdsNavigation) |

### 枚举

- `SnackBarOperationType`:`TEXT_ONLY=0` / `CLOSE_BUTTON_ONLY=1` / `TEXT_WITH_ARROW=2` / `TEXT_WITH_CLOSE=3` / `HIGHLIGHT_TEXT_WITH_CLOSE=4`
- `SnackBarIconType`:`SMALL=0` / `NORMAL=1`

## 6. 联动说明

- 与 `HdsNavDestination` 共存:弹出 SnackBar 会触发宿主 `onInactive`(reason = SHEET/DIALOG),需要的话可以在 onInactive 里暂停视频播放。
- 多个 SnackBar 不要同时弹,推荐每次 `show()` 前先 `dismiss()` 上一次。
- 不要把 SnackBar 的 `show()` 放在 `build()` / `@Builder` 里——它是命令式 API,应在 `onClick` / `aboutToAppear` / 业务回调里调用。
- `this.getUIContext()` 在 `@ComponentV2` 的类属性初始化阶段也能用;若是 V1 组件,建议在 `aboutToAppear()` 内延迟初始化。

## 7. 完整代码示例

> "保存成功"+"撤销"按钮 + 常驻(点击关闭或撤销才消失),并与外部按钮共享焦点。

```typescript
import {
  HdsSnackBar,
  SnackBarIconOptions,
  SnackBarMessageOptions,
  SnackBarOperationOptions,
  SnackBarStyleOptions,
  SnackBarOperationType
} from '@kit.UIDesignKit'

@Entry
@ComponentV2
struct SavePanel {
  private uiContext: UIContext = this.getUIContext()
  private snackBar: HdsSnackBar = new HdsSnackBar(this.uiContext)

  private icon: SnackBarIconOptions = {
    icon: $r('sys.symbol.checkmark_circle')
  }
  private message: SnackBarMessageOptions = {
    title: '已保存',
    content: '草稿已同步至云端'
  }
  private operation: SnackBarOperationOptions = {
    operationType: SnackBarOperationType.TEXT_WITH_CLOSE,
    content: '撤销',
    textButtonId: 'undoBtn',
    onContentClick: () => {
      console.info('undo tap')
      this.snackBar.dismiss()
    },
    onCloseButtonClick: () => {
      this.snackBar.dismiss()
    }
  }
  private style: SnackBarStyleOptions = {
    duration: -1,
    nextFocusId: 'saveBtn'
  }

  build() {
    Column({ space: 12 }) {
      Blank().height(200)
      Button('保存')
        .id('saveBtn')
        .onClick(() => {
          this.snackBar.show(this.icon, this.message, this.operation, this.style)
        })

      Button('关注')
        .nextFocus({ forward: 'undoBtn' })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(0xF1F3F5)
  }
}
```

## 8. 反面示例

### 错 1:在 build() 内直接调用 show()

```typescript
build() {
  this.snackBar.show(...)   // ❌ build 会在渲染时反复执行
  Column() {}
}
```

应当放在事件回调里触发。

### 错 2:TEXT_WITH_ARROW 再加 onContentClick

```typescript
operationType: SnackBarOperationType.TEXT_WITH_ARROW,
onContentClick: () => { ... }   // ❌ 不生效
onArrowClick: () => { ... }
```

TEXT_WITH_ARROW 的点击热区是**整个 SnackBar**,只需 `onArrowClick`。

### 错 3:TEXT_ONLY 想要关闭按钮

TEXT_ONLY 不带关闭按钮。需要"文字 + ×"时用 `TEXT_WITH_CLOSE`。

### 错 4:多次 show() 不 dismiss

第二次 `show()` 前没有 `dismiss()` 上一个,会看到两个 SnackBar 堆叠,焦点错乱。正确做法:

```typescript
this.snackBar.dismiss()   // 先关掉上一个
this.snackBar.show(...)
```

### 错 5:duration 填字符串

```typescript
duration: '5000'   // ❌
```

必须是 `number`,单位 ms。

### 错 6:把 highlightBackBoardColor 用在错误 operationType 上

`highlightBackBoardColor` 只在 `HIGHLIGHT_TEXT_WITH_CLOSE` 下生效,其他 type 下写了也没用。

## 9. API 速查

| 符号 | 签名/类型 | 说明 |
|------|----------|------|
| `HdsSnackBar` | `class` | 通过 `new HdsSnackBar(uiContext)` 构造 |
| `.show(icon, message, operation, style?)` | `void` | 弹出 |
| `.dismiss()` | `void` | 主动关闭 |
| `SnackBarOperationType` | enum | TEXT_ONLY(0) / CLOSE_BUTTON_ONLY(1) / TEXT_WITH_ARROW(2) / TEXT_WITH_CLOSE(3) / HIGHLIGHT_TEXT_WITH_CLOSE(4) |
| `SnackBarIconType` | enum | SMALL(0) / NORMAL(1) |
| `duration` | `number` | ms,<=0 常驻,默认 5000 |
| `pressBackCallback` | `Callback<void>` | 左滑/返回拦截 |
| `textButtonId / cancelButtonId / arrowButtonId` | `string` | 走焦 id |

**记忆锚点**:`new HdsSnackBar(uiContext)` → 构造 4 个 Options(icon/message/operation/style) → `.show()` / `.dismiss()` / duration=-1 常驻。
