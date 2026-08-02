# MultiWindowEntryInAPP 组件功能逻辑规格

> HDS (UI Design Kit) 组件。**特殊形态**:本身不是通用业务组件,而是"应用内多窗入口"——一个会启动新窗口的 icon 按钮。
> 华为官方原文:[../../../hds参考文档/中文文档/MultiWindowEntryInAPP.md](../../../hds参考文档/中文文档/MultiWindowEntryInAPP.md)
> 装饰器:普通 `@Component`(V1)。无子组件。

## 1. 功能定位

承载**单应用多窗口并行**逻辑。点击这个组件,会把指定的 `UIAbility`(必须是本应用内的)以分屏/全景多窗形式打开。

- 单窗参数:`want`(含 bundleName / moduleName / abilityName,**三项必填**,**必须属于当前应用**)
- 可选文本标题(`isShowSubtitle`)
- 样式定制(icon 颜色/粗细/大小/背景 + subtitle TextModifier)
- **设备限制**:只有满足条件的设备形态才可交互,其他形态下"不响应点击"

**起始版本**:6.0.0 (API 20)。

### 支持全景多窗的设备形态

- 双折叠:展开态
- 三折叠:双屏态、三屏态的横屏态
- 平板:横屏态

其他形态(Phone 竖屏、折叠屏合态、TV…)下组件**不可交互**。

## 2. 典型场景

- 文件管理 App:点击"新窗口打开"把选中文件夹以另一个窗口并排打开
- 笔记 App:同时编辑两条笔记
- 办公套件:左侧文档 + 右侧参考资料
- 邮箱:并排看两封邮件

## 3. 状态声明

```typescript
import {
  MultiWindowEntryInAPP,
  MultiWindowEntryInAPPParams
} from '@kit.UIDesignKit'
import { Want } from '@kit.AbilityKit'
import { TextModifier } from '@kit.ArkUI'

@Entry
@Component
struct DocumentPage {
  @State textModifier: TextModifier = new TextModifier()

  private want: Want = {
    bundleName: 'com.example.myapplication',
    moduleName: 'entry',
    abilityName: 'EditorAbility'
  }
}
```

> - `want` 是**普通成员**,不需要 `@State`。
> - `bundleName / moduleName / abilityName` **三项必填**,且必须指向**当前应用**的 UIAbility,否则点击无响应。
> - 不支持跨应用打开窗口。

## 4. 事件与交互逻辑

### 点击 = 打开窗口

用户在支持的设备形态下点击本组件,系统会:

1. 若当前已是多窗场景 → 将新 UIAbility 加入现有多窗栈
2. 否则 → 与当前窗口组成分屏或进入全景多窗

开发者**无需手动处理跳转**。

### 不支持 onClick 事件

```typescript
MultiWindowEntryInAPP({ want: this.want })
  .onClick(() => { /* ❌ 不支持 */ })
```

文档明确:"**该组件暂不支持 onClick 事件,如要监听点击请使用 onTouch 事件**"。

### 不支持百分比尺寸

```typescript
.size({ width: '50%', height: 48 })   // ❌
.size({ width: 48, height: 48 })      // ✅
```

`width` / `height` / `size` 暂不支持百分比,用固定值(vp/lpx)。

### 不支持无障碍文本/描述属性

文档明确"该组件暂不支持 `accessibilityDescription` / `accessibilityText` 属性"。需要无障碍时目前只能通过父容器补偿。

## 5. 数据结构

### MultiWindowEntryInAPPParams

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `want` | `Want` | **是** | 含 bundleName/moduleName/abilityName |
| `isShowSubtitle` | `boolean` | 否(默认 `false`) | 是否显示默认文本标题 |
| `multiWindowEntryInAPPStyle` | `MultiWindowEntryInAPPStyle` | 否 | 样式定制 |

### MultiWindowEntryInAPPStyle

| 字段 | 类型 | 说明 |
|------|------|------|
| `iconOptions` | `MultiWindowEntryInAPPIconOptions` | 图标样式 |
| `subtitleOptions` | `MultiWindowEntryInAPPSubtitleOptions` | 文本标题样式 |

### MultiWindowEntryInAPPIconOptions

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `iconColor` | `ResourceColor` | `$r('sys.color.font_primary')` | 图标颜色 |
| `iconWeight` | `number \| FontWeight \| string` | `400` | 粗细,100-900(100 为步长);支持 `Bold/Medium/Regular` 字符串 |
| `iconSize` | `number \| string \| Resource` | `24 * 24 vp` | 图标尺寸,**不支持百分比** |
| `backgroundColor` | `ResourceColor` | `$r('sys.color.comp_background_tertiary')` | 背景色 |

### MultiWindowEntryInAPPSubtitleOptions

| 字段 | 类型 | 说明 |
|------|------|------|
| `modifier` | `TextModifier` | 标题文本修饰器 |

## 6. 联动说明

- 只能打开"本应用"里的 UIAbility。若业务想跨应用打开,使用 `want` + 系统 startAbility,不要用这个组件。
- 设备形态判断:在不支持的形态下,组件不可交互但仍占位。业务上建议通过 `deviceInfo.deviceType` / `windowStage.getMainWindow().getWindowProperties()` 等接口判断,动态决定是否显示这个入口。
- 与 `HdsNavigation` 共存:通常放在标题栏右上角 menu 或内容区右上角浮层。
- 与 `TextModifier`:通过 `subtitleOptions.modifier = this.textModifier.fontColor(...)` 动态调整标题样式。

## 7. 完整代码示例

> 文档详情页右上角"新窗口打开"按钮,点击后用另一窗口打开 `EditorAbility`。

```typescript
import {
  MultiWindowEntryInAPP
} from '@kit.UIDesignKit'
import { Want } from '@kit.AbilityKit'
import { TextModifier } from '@kit.ArkUI'

@Entry
@Component
struct DocumentPage {
  @State textModifier: TextModifier = new TextModifier()

  private want: Want = {
    bundleName: 'com.example.myapplication',
    moduleName: 'entry',
    abilityName: 'EditorAbility',
    parameters: { docId: 'abc123' }
  }

  build() {
    Stack({ alignContent: Alignment.TopEnd }) {
      Column() {
        Text('文档正文 ...')
          .fontSize(18)
          .padding(24)
      }
      .width('100%')
      .height('100%')

      MultiWindowEntryInAPP({
        want: this.want,
        isShowSubtitle: true,
        multiWindowEntryInAPPStyle: {
          iconOptions: {
            iconSize: 24,
            iconColor: $r('sys.color.font_primary'),
            iconWeight: FontWeight.Normal,
            backgroundColor: $r('sys.color.comp_background_tertiary')
          },
          subtitleOptions: {
            modifier: this.textModifier.fontColor(Color.Black).fontSize(12)
          }
        }
      })
        .size({ width: 48, height: 48 })
        .margin({ top: 12, right: 12 })
    }
    .width('100%')
    .height('100%')
  }
}
```

## 8. 反面示例

### 错 1:跨应用 want

```typescript
private want: Want = {
  bundleName: 'com.other.app',   // ❌ 不是本应用
  moduleName: 'entry',
  abilityName: 'SomeAbility'
}
```

组件会静默不响应。正解:只传本应用的 ability 入口。

### 错 2:用 onClick 想拦截点击

```typescript
MultiWindowEntryInAPP({ want: this.want })
  .onClick(() => { /* ❌ 不触发 */ })
```

应该用 `onTouch` 监听手指按下,或者在点击前通过条件渲染让它隐藏。

### 错 3:百分比尺寸

```typescript
.size({ width: '100%', height: 48 })   // ❌
```

不支持百分比。

### 错 4:不做设备形态判断

在 Phone 竖屏上仍显示这个按钮,用户看到了但点不动。推荐做法:

```typescript
if (this.isLandscapeOrFoldExpanded) {
  MultiWindowEntryInAPP({ ... })
}
```

依靠 `mediaQuery` / `windowSizeChangeCallback` 判断设备形态后再显示。

### 错 5:want 字段缺失

```typescript
private want: Want = {
  abilityName: 'EditorAbility'   // 缺 bundleName / moduleName
}
```

三项必填,缺一不可。

## 9. API 速查

| 符号 | 说明 |
|------|------|
| `MultiWindowEntryInAPP(params: MultiWindowEntryInAPPParams)` | 构造 |
| `params.want` | `Want`,必填,需含 bundleName/moduleName/abilityName |
| `params.isShowSubtitle` | `boolean`,默认 false |
| `params.multiWindowEntryInAPPStyle` | 样式对象 |
| `iconOptions` | `{ iconColor, iconWeight, iconSize, backgroundColor }` |
| `subtitleOptions` | `{ modifier: TextModifier }` |
| 点击事件 | **不支持 onClick,可用 onTouch** |
| 尺寸 | **不支持百分比**,用 vp/lpx |
| 无障碍 | **不支持** accessibilityText / accessibilityDescription |
| 支持设备形态 | 双折叠展开、三折叠双/三屏横、平板横屏 |

**记忆锚点**:本应用 UIAbility + `onTouch`(不是 onClick) + 固定尺寸(不是 %) + 设备形态判断。
