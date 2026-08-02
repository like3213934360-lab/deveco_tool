# HdsActionBar 组件功能逻辑规格

> HDS (UI Design Kit) 组件,**@ComponentV2** 装饰器,仅 Stage 模型可用。
> 华为官方原文:[../../../hds参考文档/中文文档/HdsActionBar.md](../../../hds参考文档/中文文档/HdsActionBar.md)
> 对应 ArkUI 无直接基础组件,可理解为"带展开/收起动效 + 模糊背板的多按钮操作区",常出现在录音/拍照/视频等场景的浮层操作栏。

## 1. 功能定位

一组圆形按钮的操作区容器,由 4 部分组成:

- **主按钮**(`primaryButton`,可选):支持 baseIcon/altIcon 双状态切换
- **起始按钮组**(`startButtons`,0~N 个圆形按钮)
- **终止按钮组**(`endButtons`,0~N 个圆形按钮)
- **背板**(由 `actionBarStyle` 控制:高度/背景色/模糊/内边距/水平或垂直)

关键能力:

- 有主按钮时,**展开/收起动画**自动生效(`isExpand` 控制,配合 `$isExpand` 双向绑定)
- 主按钮图标可通过 `isPrimaryIconChanged` 切换 base ↔ alt(录制/播放场景)
- 主按钮支持 `primaryButtonBuilder`(CustomBuilder)做复杂定制,此时必须同步设 `primaryButtonBuilderWidth`
- 模糊策略 `blurStrategy`(来自 HdsNavigation 的 `BlurStrategy`):ADAPTIVE / ALWAYS_ON / ALWAYS_OFF

**起始版本**:6.0.0 (API 20)。

## 2. 典型场景

- 录音/录像中的"开始-暂停-停止"圆形操作栏
- 聊天输入区上方的快捷操作(表情/相机/相册/语音)
- 图片编辑器底部工具条(裁剪/滤镜/贴纸/保存)
- 浮动播控(上一曲/播放/下一曲/更多)

## 3. 状态声明

```typescript
import {
  HdsActionBar,
  ActionBarButton,
  ActionBarStyle
} from '@kit.UIDesignKit'

@Entry
@ComponentV2
struct RecorderPage {
  @Local isExpand: boolean = true
  @Local isPrimaryIconChanged: boolean = false
  @Local primaryHoverTips: ResourceStr = '开始录制'
}
```

> - 必须使用 `@ComponentV2` + `@Local`,**不能用 `@Component` + `@State`**(HdsActionBar 的 `@Event/@Param` 是 V2 体系)。
> - `ActionBarButton` 和 `ActionBarStyle` 都是**类**,通过 `new XxxOptions` 构造,不是对象字面量。
> - 不要把 `primaryHoverTips` 类型写成 `string`,应当用 `ResourceStr`(兼容 `$r(...)`)。

## 4. 事件与交互逻辑

### 主按钮点击触发展开/收起 + 图标切换

```typescript
primaryButton: new ActionBarButton({
  baseIcon: $r('sys.symbol.plus'),
  altIcon: $r('sys.symbol.play_fill'),
  onClick: () => {
    this.isExpand = !this.isExpand
    this.isPrimaryIconChanged = !this.isPrimaryIconChanged
    this.primaryHoverTips = this.isPrimaryIconChanged ? '暂停' : '开始'
  }
})
```

### 双向绑定展开状态

```typescript
HdsActionBar({
  isExpand: this.isExpand,
  $isExpand: (v: boolean) => { this.isExpand = v }
})
```

> `$isExpand` 是 `@Event` 装饰器的回调,命名必须以 `$` 开头,和 `isExpand` 成对出现。**不要**把逻辑写在它里面——它仅做回写,业务逻辑应该写在 `onClick` 里。

### 非主按钮(start/end)的 onClick

每个 `ActionBarButton` 构造参数里都可独立设 `onClick`、`enabled`、`hoverTips`、`accessibilityText`。禁用单个按钮不影响整体展开/收起。

## 5. 数据结构

### ActionBarButton 核心字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `baseIcon` | `ResourceStr` | 初始图标(非主按钮时,即它的固定图标) |
| `altIcon` | `ResourceStr` | 切换后图标,**仅主按钮生效** |
| `width` | `LengthMetrics` | 圆形按钮宽度,不支持 percent |
| `backgroundColor` | `ColorMetrics` | 按钮背景 |
| `iconFillColor` | `ColorMetrics` | 图标颜色 |
| `iconSize` | `LengthMetrics` | 图标大小 |
| `shadowStyle` | `ShadowOptions \| ShadowStyle` | 默认 `ShadowStyle.OUTER_DEFAULT_LG` |
| `enabled` | `boolean` | 单按钮是否可用 |
| `onClick` | `Callback<void>` | 点击回调 |
| `hoverTips` | `ResourceStr` | 鼠标悬浮提示文字(PC/平板) |
| `accessibilityText` / `accessibilityDescription` / `accessibilityLevel` | — | 无障碍三件套 |
| `id` | `string` | 走焦 id,也用于 `promptAction.openPopup` 绑定 |

### ActionBarStyle 核心字段

| 字段 | 默认值 | 说明 |
|------|-------|------|
| `height` | — | 背板高度 |
| `backgroundColor` | — | 背板背景色 |
| `backgroundBlurStyle` | `BlurStyle.COMPONENT_REGULAR` | 背板模糊 |
| `innerSpace` | — | 主按钮与 start/end 按钮间距 |
| `startSpace` / `endSpace` | — | start/end 按钮到背板边框的距离 |
| `enabled` | `true` | false 会让**所有**按钮禁用 |
| `isHorizontal` | `true` | false 竖排 |
| `isPrimaryIconChanged` | `false` | true 显示 altIcon |

### BlurStrategy(来自 HdsNavigation)

`ADAPTIVE`(默认,根据系统主题自适应) / `ALWAYS_ON` / `ALWAYS_OFF`。

## 6. 联动说明

- **`primaryButtonBuilder` 与 `primaryButton` 二选一**,同时设 builder 优先级更高,但必须同步给 `primaryButtonBuilderWidth`,否则布局异常。
- 和 `HdsNavDestination.toolbarConfiguration` 不互斥,可以共存(一个是"页面级工具栏",一个是"浮层操作栏")。
- 设 `actionBarStyle.enabled = false` 相当于全局禁用,**比** `ActionBarButton.enabled = false` **优先级高**。
- 无主按钮(`primaryButton` 为 undefined 且 `primaryButtonBuilder` 为 undefined)时,**展开/收起动画不生效**,`isExpand` 无视觉变化。

### 与 HdsToolBar 的区别(避免误用)

`@kit.UIDesignKit` 里有个名字相近的 `HdsToolBar`(顶部悬浮工具栏) —— 它**尚未对外开放,本 Skill 不收**(参考 [SKILL.md 硬约束 §6](../SKILL.md#6-api-必须可在官方网站找到权威性优先级))。

用户代码中若出现 `HdsToolBar`:**不要**在输出里保留或使用它,也**不要**把 `HdsActionBar` 的字段套到 `HdsToolBar` 上。识别口诀:"**底栏操作** → `HdsActionBar`",顶栏沉浸需求暂用原生 `Navigation` / `HdsNavigation` 的 `titleBar` 配置替代。

## 7. 完整代码示例

> 录音 App 的底部操作栏:左侧"计时器",右侧"录音",中间主按钮 = 开始/暂停。

```typescript
import {
  HdsActionBar,
  ActionBarButton,
  ActionBarStyle
} from '@kit.UIDesignKit'

@Entry
@ComponentV2
struct RecorderPage {
  @Local isExpand: boolean = true
  @Local isPrimaryIconChanged: boolean = false
  @Local primaryHoverTips: ResourceStr = '开始'

  build() {
    Column() {
      HdsActionBar({
        startButtons: [
          new ActionBarButton({
            baseIcon: $r('sys.symbol.stopwatch_fill'),
            hoverTips: '计时',
            onClick: () => {
              console.info('timer tap')
            }
          })
        ],
        endButtons: [
          new ActionBarButton({
            baseIcon: $r('sys.symbol.mic_fill'),
            hoverTips: '录音',
            onClick: () => {
              console.info('mic tap')
            }
          })
        ],
        primaryButton: new ActionBarButton({
          baseIcon: $r('sys.symbol.plus'),
          altIcon: $r('sys.symbol.play_fill'),
          hoverTips: this.primaryHoverTips,
          onClick: () => {
            this.isExpand = !this.isExpand
            this.isPrimaryIconChanged = !this.isPrimaryIconChanged
            this.primaryHoverTips = this.isPrimaryIconChanged ? '暂停' : '开始'
          }
        }),
        actionBarStyle: new ActionBarStyle({
          isPrimaryIconChanged: this.isPrimaryIconChanged
        }),
        isExpand: this.isExpand,
        $isExpand: (v: boolean) => { this.isExpand = v }
      })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(0xF1F3F5)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }
}
```

## 8. 反面示例

### 错 1:用 @Component + @State

```typescript
@Component
struct Wrong {
  @State isExpand: boolean = true
  build() {
    HdsActionBar({ isExpand: this.isExpand })
  }
}
```

HdsActionBar 是 V2 组件,所有 `@Param / @Event` 参数需要在 V2 容器里传。用 V1 会得到 TypeError。正解:`@ComponentV2` + `@Local`。

### 错 2:对象字面量当 ActionBarButton 传入

```typescript
startButtons: [{
  baseIcon: $r('sys.symbol.stopwatch_fill')
}]
```

`startButtons` 要的是 `Array<ActionBarButton>`,**必须是类实例**。对象字面量在 ArkTS 下会报"类型不兼容"。正解:`[new ActionBarButton({ baseIcon: ... })]`。

### 错 3:主按钮用 primaryButtonBuilder 不给宽度

```typescript
HdsActionBar({
  primaryButtonBuilder: () => { this.myPrimary() }
  // 缺 primaryButtonBuilderWidth,导致布局塌陷
})
```

必须同步 `primaryButtonBuilderWidth: LengthMetrics.vp(64)`。

### 错 4:在 `$isExpand` 里写业务逻辑

```typescript
$isExpand: (v: boolean) => {
  this.isExpand = v
  this.startRecording()   // ❌ 把业务写这里
}
```

`$isExpand` 只负责状态回写,业务逻辑(开始录制)应该放在主按钮的 `onClick` 里。因为 `$isExpand` 还会被系统在其他路径触发(键盘导航、无障碍),放业务会导致重复执行。

### 错 5:把枚举写成字面量字符串

```typescript
actionBarStyle: new ActionBarStyle({
  backgroundBlurStyle: 'COMPONENT_REGULAR'   // ❌
})
```

应当用枚举 `BlurStyle.COMPONENT_REGULAR`。

## 9. API 速查

### HdsActionBar 构造参数

| 参数 | 类型 | 装饰器 | 默认 | 说明 |
|------|------|--------|------|------|
| `primaryButton` | `ActionBarButton` | `@Param` | — | 主按钮 |
| `primaryButtonBuilder` | `CustomBuilder` | `@BuilderParam` | — | 自定义主按钮,优先级高于 primaryButton |
| `primaryButtonBuilderWidth` | `LengthMetrics` | `@Param` | — | primaryButtonBuilder 启用时必填 |
| `startButtons` | `Array<ActionBarButton>` | `@Param` | — | 起始位置按钮组 |
| `endButtons` | `Array<ActionBarButton>` | `@Param` | — | 终止位置按钮组 |
| `actionBarStyle` | `ActionBarStyle` | `@Param` | — | 样式对象 |
| `isExpand` | `boolean` | `@Param` | `false` | 展开状态 |
| `$isExpand` | `Callback<boolean>` | `@Event` | — | 展开状态回写 |
| `blurStrategy` | `BlurStrategy` | `@Param` | `ADAPTIVE` | 模糊策略 |

### ActionBarButton 构造器字段(见第 5 节表格)

### ActionBarStyle 构造器字段(见第 5 节表格)

**快速记忆**:`new ActionBarButton({...})` + `new ActionBarStyle({...})` + `@ComponentV2` + `@Local` + `$isExpand` 双向 = 跑通 HdsActionBar 的 5 件事。
