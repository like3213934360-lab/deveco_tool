# HdsListItemCard 组件功能逻辑规格

> HDS (UI Design Kit) 组件。**数据驱动**的列表卡片,用"三区结构 + 类实例"的方式声明项内容,避免开发者重复实现列表行样式。
> 华为官方原文:[../../../hds参考文档/中文文档/HdsListItemCard.md](../../../hds参考文档/中文文档/HdsListItemCard.md) —— 完整 1400+ 行规格。
> 宿主容器:[HdsListItem.md](HdsListItem.md)。通常 `HdsListItem.hdsListItemCard` 字段接受的就是 `HdsListItemCardOptions`。

## 1. 功能定位

HDS 规范的列表卡片。三区结构:

- **A 区(`prefixItem`,列表左侧)**:图片/图标/徽标/开关/切换按钮/单选/勾选 等 8 种预设元素
- **B 区(`textItem`,列表中间)**:主标题 + 副标题 + 描述三行文本,每行支持左/右各 2 个 Symbol 图标(共 4 个),或 `customBuilder` 完全自定义
- **C 区(`suffixItem`,列表右侧)**:图标/开关/角标+箭头/箭头/文本+箭头/切换按钮/单选/勾选 等多种预设,或 `customBuilder`

以及:

- 卡片高宽、圆角、背景色、与屏幕左右边距、悬浮圆角
- `onClick` 整行点击回调
- `accessibilityOptions` 无障碍
- 支持 `HdsListItemCard` 独立使用(包在自定义 Column/List 里)或被 `HdsListItem.hdsListItemCard` 引用

**起始版本**:6.0.0 (API 20)。TV 设备行为异常。

## 2. 典型场景

- 设置项列表(图标 + 标题 + 右侧开关 / 右侧箭头)
- 通讯录(头像 + 姓名 + 右侧电话 icon)
- 通知列表(左徽标 + 标题+副标题+描述 + 右侧角标数字)
- 选择列表(左侧单选 + 标题 + 右侧说明)

## 3. 状态声明

```typescript
import {
  HdsListItemCard,
  IconSize,
  PrefixImage,
  PrefixIcon,
  SuffixIcon,
  SuffixSwitch,
  SuffixBadgeAndArrow
} from '@kit.UIDesignKit'
import { ImageModifier, TextModifier, promptAction } from '@kit.ArkUI'

@Entry
@Component
struct SettingsList {
  @State airplaneMode: boolean = false
  @State unreadCount: number = 9
}
```

> - **V1 体系**:用 `@Component` + `@State`。
> - A/C 区的每种元素都是**类**,必须 `new PrefixIcon({...})` / `new SuffixSwitch({...})`,不能用对象字面量。
> - B 区 `textItem` 是**对象字面量**(`TextItemOptions`),不是类。

## 4. 事件与交互逻辑

### 整行点击

```typescript
HdsListItemCard({
  textItem: { primaryText: { text: '用户协议' } },
  suffixItem: new SuffixArrow({}),
  onClick: () => { this.router.push('agreement') }
})
```

### 右侧 Switch 状态回调

```typescript
suffixItem: new SuffixSwitch({
  isCheck: this.airplaneMode,
  selectColor: '#0A59F7',
  onChange: (v: boolean) => {
    this.airplaneMode = v
  }
})
```

注意 `isCheck` 是**初始值**,运行时状态由组件内部维护,业务通过 `onChange` 感知。如果需要外部强制切换,需要重建整个 `HdsListItemCardOptions` 对象(重新 `new SuffixSwitch`),并通过 `@State` 让 ArkUI 感知到引用变化。

### 左侧单独可点

某些 Prefix 元素(如 `PrefixImage`、`PrefixIcon`)构造器接受 `ImageClickOptions`:

```typescript
new PrefixImage({
  image: $r('app.media.avatar'),
  modifier: new ImageModifier().width(46).height(46).borderRadius(23),
  onClick: () => { /* 单独点头像 */ }
})
```

此时 A 区点击不会触发整行 `onClick`。

### B 区 customBuilder 优先级

`TextItemOptions.customBuilder` 优先级**高于**其他字段。同时设置 primaryText + customBuilder 时,只渲染 customBuilder。

## 5. 数据结构

### HdsListItemCardOptions(**最核心**)

| 字段 | 类型 | 说明 |
|------|------|------|
| `prefixItem` | `PrefixItem` | A 区元素(见下方类列表) |
| `textItem` | `TextItemOptions` | B 区对象(见下方) |
| `suffixItem` | `SuffixItem` | C 区元素(见下方类列表) |
| `onClick` | `OnClickCallback` | 整行点击 |
| `cardHeight` / `cardWidth` | `Dimension` | 不支持 Percentage |
| `cardBackgroundColor` | `ResourceColor` | — |
| `cardBorderRadius` | `Dimension` | — |
| `cardPrefixMargin` / `cardSuffixMargin` | `Dimension` | 距屏幕左/右的边距 |
| `hoverBorderRadius` | `Dimension` | 悬浮态圆角 |
| `enable` | `boolean` | 默认 true |
| `cardId` | `string` | — |
| `accessibilityOptions` | `AccessibilityOptions` | 无障碍 |

### A 区类(`PrefixItem` 的子类)

| 类 | 构造参数 | 说明 |
|----|---------|------|
| `PrefixImage` | `ImageClickOptions` | 可点击 Image |
| `PrefixIcon` | `PrefixIconOptions` | Icon(支持 IconSize 枚举) |
| `PrefixBadge` | `BadgeOptions` | 徽标 |
| `PrefixSwitch` | `CheckOptions` | 开关 |
| `PrefixToggleButton` | `ToggleButtonOptions` | 切换按钮 |
| `PrefixRadio` | `RadioOptions` | 单选 |
| `PrefixCheckbox` | `CheckboxOptions` | 勾选 |
| `PrefixCustom` | `{ customBuilder: CustomBuilder }` | 完全自定义 |

### B 区 `TextItemOptions`

```typescript
{
  primaryText?: TextOptions
  primaryPrefixSymbol?: TextSymbolGlyphOptions   // 主标题左第一个图标
  primaryPrefixSubSymbol?: TextSymbolGlyphOptions // 主标题左第二个(需第一个存在)
  primarySuffixSymbol?: TextSymbolGlyphOptions   // 主标题右第一个
  primarySuffixSubSymbol?: TextSymbolGlyphOptions

  secondaryText?: TextOptions
  secondaryPrefixSymbol / secondaryPrefixSubSymbol / secondarySuffixSymbol / secondarySuffixSubSymbol?: TextSymbolGlyphOptions

  description?: TextOptions
  descriptionPrefixSymbol / descriptionPrefixSubSymbol / descriptionSuffixSymbol / descriptionSuffixSubSymbol?: TextSymbolGlyphOptions

  customBuilder?: CustomBuilder   // 优先级最高
}
```

`TextOptions` 通常是 `{ text: ResourceStr, modifier?: TextModifier }`。

### C 区类(`SuffixItem` 的子类)

| 类 | 构造参数 | 说明 |
|----|---------|------|
| `SuffixIcon` | `ImageClickOptions` | 右侧可点 Icon |
| `SuffixArrow` | `ArrowOptions` | 右箭头 |
| `SuffixSwitch` | `CheckOptions` | 开关 |
| `SuffixToggleButton` | `ToggleButtonOptions` | 切换按钮 |
| `SuffixRadio` | `RadioOptions` | 单选 |
| `SuffixCheckbox` | `CheckboxOptions` | 勾选 |
| `SuffixTextAndArrow` | `{ text, arrow }` | 文本 + 箭头 |
| `SuffixBadgeAndArrow` | `BadgeOptions`, `ArrowOptions` | 角标 + 箭头 |
| `SuffixCustom` | `{ customBuilder: CustomBuilder }` | 完全自定义 |

### 枚举 `IconSize`

用于 `PrefixIcon` 的 `iconSize`,语义化尺寸:`SYSTEM_ICON`、`SMALL_ICON`、`DEFAULT_ICON` 等(具体枚举值请参照官方原文)。

## 6. 联动说明

- **标准组合**:`List { LazyForEach { HdsListItem({ hdsListItemCard: {...} }) } }`。
- 纯展示(无横滑、无行点击)列表直接用 `HdsListItemCard` 放进 `ListItem { HdsListItemCard({...}) }` 也可以,但推荐走 HdsListItem 以获得规范的卡片间距/hover 样式。
- 与 `@State` 联动时,**类实例作为 suffixItem/prefixItem 的值不会触发刷新**;必须重新 `new` 一个。例如改 Switch 状态:

  ```typescript
  // 外部需要主动切换时
  this.airplaneMode = !this.airplaneMode
  this.suffixItem = new SuffixSwitch({
    isCheck: this.airplaneMode,
    onChange: (v) => { this.airplaneMode = v }
  })
  ```

  更实用的做法:让 Switch 自己管理状态,业务只听 `onChange`。
- 与 HdsNavigation:HdsListItemCard 的 onClick 里调用 `navPathStack.pushPathByName(...)` 做路由。
- 与 HdsSnackBar:长按/点击后弹 SnackBar 反馈。

## 7. 完整代码示例

> 设置页:头像+用户名,若干带开关的选项,带角标的"消息中心"。

```typescript
import {
  HdsListItemCard,
  IconSize,
  PrefixImage,
  PrefixIcon,
  SuffixIcon,
  SuffixSwitch,
  SuffixBadgeAndArrow
} from '@kit.UIDesignKit'
import { ImageModifier, TextModifier, promptAction } from '@kit.ArkUI'

@Entry
@Component
struct SettingsList {
  @State wifiOn: boolean = true
  @State bluetoothOn: boolean = false
  @State unread: number = 9

  build() {
    Column() {
      List({ space: 6 }) {
        ListItem() {
          HdsListItemCard({
            prefixItem: new PrefixImage({
              image: $r('app.media.startIcon'),
              modifier: new ImageModifier().width(60).height(60).borderRadius(30)
            }),
            textItem: {
              primaryText: { text: '张三' },
              secondaryText: { text: 'HarmonyOS 账号' },
              description: { text: 'zhangsan@huawei.com' }
            },
            suffixItem: new SuffixIcon({
              iconValue: { symbol: $r('sys.symbol.chevron_right') }
            }),
            onClick: () => { promptAction.openToast({ message: '进入个人中心' }) }
          })
        }

        ListItem() {
          HdsListItemCard({
            prefixItem: new PrefixIcon({
              iconSize: IconSize.SYSTEM_ICON,
              iconValue: { symbol: $r('sys.symbol.wifi') }
            }),
            textItem: {
              primaryText: { text: 'Wi-Fi' }
            },
            suffixItem: new SuffixSwitch({
              isCheck: this.wifiOn,
              onChange: (v: boolean) => { this.wifiOn = v }
            })
          })
        }

        ListItem() {
          HdsListItemCard({
            prefixItem: new PrefixIcon({
              iconSize: IconSize.SYSTEM_ICON,
              iconValue: { symbol: $r('sys.symbol.dot_radiowaves_left_and_right') }
            }),
            textItem: {
              primaryText: { text: '蓝牙' }
            },
            suffixItem: new SuffixSwitch({
              isCheck: this.bluetoothOn,
              onChange: (v: boolean) => { this.bluetoothOn = v }
            })
          })
        }

        ListItem() {
          HdsListItemCard({
            prefixItem: new PrefixIcon({
              iconSize: IconSize.SYSTEM_ICON,
              iconValue: { symbol: $r('sys.symbol.bell') }
            }),
            textItem: {
              primaryText: {
                text: '消息中心',
                modifier: new TextModifier().fontSize(16)
              }
            },
            suffixItem: new SuffixBadgeAndArrow(
              { badgeValue: this.unread, badgeColor: '#E53935', textColor: Color.White },
              { color: '#999999' }
            ),
            onClick: () => {
              this.unread = 0
              promptAction.openToast({ message: '进入消息中心' })
            }
          })
        }
      }
      .width('100%')
      .height('100%')
    }
    .backgroundColor('#F5F5F5')
    .height('100%')
  }
}
```

## 8. 反面示例

### 错 1:用对象字面量替代 Prefix/Suffix 类

```typescript
prefixItem: { icon: $r('sys.symbol.wifi') }   // ❌
```

`prefixItem` 是 `PrefixItem`(抽象类),必须 `new` 对应子类:`new PrefixIcon({ iconValue: { symbol: ... } })`。

### 错 2:suffixItem 里绑 @State,期望外部改变生效

```typescript
@State switchOn: boolean = false

suffixItem: new SuffixSwitch({
  isCheck: this.switchOn,
  onChange: (v) => { this.switchOn = v }
})
```

`SuffixSwitch` 是类实例,`isCheck` 只作**初始值**。之后改 `this.switchOn` 不会反向推回组件。如需外部强制切换,得重新 `new SuffixSwitch(...)` 并让 ArkUI 感知引用变化(比如把整个 `HdsListItemCardOptions` 放在 `@State` 里,修改后替换对象)。

### 错 3:cardHeight / cardWidth 用百分比

```typescript
cardHeight: '100%'   // ❌ 不支持
```

明确"不支持使用 Percentage",改用 vp/lpx/fp 固定值。

### 错 4:B 区只设置 Sub 图标不设主图标

```typescript
textItem: {
  primaryText: { text: '标题' },
  primaryPrefixSubSymbol: { ... }   // 主图标不存在
}
```

文档明确"仅在对应 Prefix/Suffix Symbol 存在时才显示"。没配第一个图标,第二个图标不会渲染。

### 错 5:同时配 customBuilder 和其他字段

```typescript
textItem: {
  primaryText: { text: '主' },
  customBuilder: () => { this.myText() }   // 会屏蔽上面
}
```

customBuilder 优先级最高,同时写等于"只渲染 customBuilder 分支"。

### 错 6:在 TV 上部署并期望 hover/focus 效果一致

官方已标注 TV 设备行为异常(获焦态/悬停态不放大、获焦背板颜色不变),属于已知限制。

## 9. API 速查

| 符号 | 说明 |
|------|------|
| `HdsListItemCard(options: HdsListItemCardOptions)` | 根组件 |
| `HdsListItemCardOptions` | 顶层配置(三区 + 布局 + 点击 + 无障碍) |
| `PrefixItem` 子类 | PrefixImage / PrefixIcon / PrefixBadge / PrefixSwitch / PrefixToggleButton / PrefixRadio / PrefixCheckbox / PrefixCustom |
| `SuffixItem` 子类 | SuffixIcon / SuffixArrow / SuffixSwitch / SuffixToggleButton / SuffixRadio / SuffixCheckbox / SuffixTextAndArrow / SuffixBadgeAndArrow / SuffixCustom |
| `TextItemOptions` | B 区对象,含 `primary/secondary/description` 三行文本 + 每行 4 个 Symbol + `customBuilder` |
| `IconSize` | `PrefixIcon.iconSize` 用枚举 |
| `ImageClickOptions` | A/C 区可点击 Image/Icon 通用参数 |
| `AccessibilityOptions` | 行级无障碍 |
| 点击优先级 | Prefix/Suffix 自身 onClick > 整行 onClick |
| customBuilder 优先级(B区) | customBuilder > primary/secondary/description + 图标 |

**记忆锚点**:三区结构 + 每区都是"类实例" + `HdsListItem.hdsListItemCard` 引用它 + 状态变更用"重建对象"或让组件自管。
