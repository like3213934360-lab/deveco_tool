# HdsListItem 组件功能逻辑规格

> HDS (UI Design Kit) 组件,**@Component** 装饰器(V1 体系,注意与其他 HDS 组件的 V2 体系区别)。
> 华为官方原文:[../../../hds参考文档/中文文档/HdsListItem.md](../../../hds参考文档/中文文档/HdsListItem.md)
> 对应 ArkUI 基础组件 `ListItem`。HdsListItem 是 ListItem 的封装,**必须**作为 `List` 的直接子组件使用。
> 配套组件:[HdsListItemCard.md](HdsListItemCard.md)。

## 1. 功能定位

列表单项容器,组合了:

- **内容区**:`hdsListItemCard`(HdsListItemCardOptions) 或 `customItemBuilder`(CustomBuilder,优先级更高)
- **横滑操作区**:`swipeActionOptions`,支持 HDS 封装的 `HdsSwipeActionOptions`(推荐)和原生 `SwipeActionOptions`
  - 左滑可显示 1~4 个图标按钮(3 个普通 + 1 个删除按钮,或自定义)
  - 删除按钮支持全删(`fullDeleteOptions.isFullDelete = true`,滑动超过阈值自动删除)
- **属性修饰**:`listItemModifier`(API 21+),沿用 ListItem 的通用属性

**起始版本**:6.0.0 (API 20)。TV 设备行为异常。

## 2. 典型场景

- 通讯录/邮件列表:左滑显示"置顶/存档/删除"
- 备忘录列表:左滑"分享/复制/删除",带自动删除
- 通知中心:单条可左滑清除
- 设置项列表:配合 HdsListItemCard 承载(优先级说明见下)

## 3. 状态声明

```typescript
import { HdsListItem } from '@kit.UIDesignKit'
import { SymbolGlyphModifier, promptAction, TextModifier } from '@kit.ArkUI'

@Entry
@Component
struct NoteList {
  @State dataSource: LazyDataSource<NoteItem> = new LazyDataSource()

  aboutToAppear(): void {
    for (let i = 0; i < 20; i++) {
      this.dataSource.pushItem(new NoteItem(`Note ${i}`))
    }
  }
}

class NoteItem {
  constructor(public data: string) {}
}
```

> - **用 V1**(`@Component` + `@State`),因为 HdsListItem 是 V1 装饰的。
> - 数据源推荐 `LazyDataSource<T> implements IDataSource`(官方样例里有完整实现,见第 7 节)。
> - `HdsListItem` **必须**写在 `List { LazyForEach(...) { HdsListItem({...}) } }` 里;不能用 ForEach(数据大时性能爆炸) ,也不能单独放在 Column 里。

## 4. 事件与交互逻辑

### customItemBuilder vs hdsListItemCard 优先级

同时设置时 **`customItemBuilder` 生效**、`hdsListItemCard` 被忽略。业务选其一:

- 快速落地简单列表项 → `hdsListItemCard`,用 HDS 规范样式
- 完全自定义 UI → `customItemBuilder`,丢弃规范样式

### HdsSwipeActionOptions(推荐)

```typescript
swipeActionOptions: {
  icons: [
    { icon: ..., backgroundColor: Color.Green, onAction: () => {...} },
    { icon: ..., backgroundColor: Color.Orange, onAction: () => {...} }
  ],
  deleteIconOptions: {
    backgroundColor: Color.Red,
    iconColor: Color.White,
    onAction: () => { /* 手动点击删除按钮 */ }
  },
  fullDeleteOptions: {
    isFullDelete: true,
    onFullDeleteAction: () => { /* 滑动距离触发阈值,自动删除 */ }
  }
}
```

- `icons`:除删除按钮外最多 **3 个**(总计 4 个按钮:3 普通 + 1 删除)。
- **`deleteIconOptions.onAction`**:用户手动点"删除"按钮的回调。
- **`fullDeleteOptions.onFullDeleteAction`**:滑动越过阈值自动触发的回调。**两者语义不同**:前者点击、后者滑动。
- 删除动画:通常在回调里用 `animateTo({ duration: 350 }, () => { this.dataSource.deleteItem(item) })` 让 LazyForEach 同步收起。

### icon 类型

`SwipeIconType = SymbolGlyphModifier | ImageOptions`

- SymbolGlyph 方式:`new SymbolGlyphModifier($r('sys.symbol.share')).fontColor([Color.Red]).fontSize(16)`
- Image 方式:`{ image: $r('app.media.xx'), modifier: new ImageModifier()... }`

### 原生 SwipeActionOptions 逃生门

若需要自绘左右滑区域,可以传原生 `SwipeActionOptions`(ListItem 的原生结构),这时 HDS 样式规范不再生效,由业务自行实现。

## 5. 数据结构

### HdsListItem 构造参数

| 参数 | 类型 | 装饰器 | 必填 | 说明 |
|------|------|--------|------|------|
| `customItemBuilder` | `CustomBuilder` | `@BuilderParam` | 否 | 自定义项内容(优先级最高) |
| `hdsListItemCard` | `HdsListItemCardOptions` | — | 否 | HDS 规范卡片内容 |
| `swipeActionOptions` | `HdsSwipeActionOptions \| SwipeActionOptions` | — | 否 | 横滑按钮 |
| `listItemModifier` | `ListItemModifier` | — | 否 | API 21+ ListItem 样式修饰 |

### HdsSwipeActionOptions

| 字段 | 类型 | 说明 |
|------|------|------|
| `icons` | `Array<SwipeIconConfigurations>` | 普通按钮,最多 3 个 |
| `deleteIconOptions` | `DeleteIconOptions` | 删除按钮 |
| `fullDeleteOptions` | `FullDeleteOptions` | 全删配置 |

### SwipeIconConfigurations

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `icon` | `SwipeIconType` | **是** | `SymbolGlyphModifier \| ImageOptions` |
| `iconOptions` | `IconOptions` | 否 | 可用性/无障碍 |
| `backgroundColor` | `ResourceColor` | 否 | 背景 |
| `onAction` | `SwipeActionCallback` | 否 | 点击回调 |

### DeleteIconOptions

| 字段 | 类型 | 说明 |
|------|------|------|
| `backgroundColor` | `ResourceColor` | 按钮背景 |
| `iconColor` | `ResourceColor` | 图标颜色 |
| `iconOptions` | `IconOptions` | 可用性/无障碍 |
| `onAction` | `SwipeActionCallback` | 手动点击回调 |

### FullDeleteOptions

| 字段 | 类型 | 默认 | 说明 |
|------|------|-----|------|
| `isFullDelete` | `boolean` | `false` | 是否启用"滑过阈值自动删除" |
| `onFullDeleteAction` | `SwipeActionCallback` | — | 自动删除时触发 |

### IconOptions

| 字段 | 类型 | 默认 | 说明 |
|------|------|-----|------|
| `enable` | `boolean` | `true` | 是否可点击 |
| `accessibilityText` / `accessibilityDescription` / `accessibilityLevel` | — | — | 无障碍三件套 |

## 6. 联动说明

- **必须**在 `List` 内使用,通常配 `LazyForEach` + `IDataSource`。
- 与 `HdsListItemCard` 配合时,优先在 `hdsListItemCard` 里描述三区(prefix/text/suffix),避免用 `customItemBuilder` 重造。
- 删除动画:推荐 `animateTo({ duration: 350 }, () => this.dataSource.deleteItem(item))`,让 LazyForEach 做过渡。
- `List.onDidScroll` / `onScrollIndex` 与 HdsListItem 横滑无干扰,但同时做纵向滚动 + 横滑时注意手势冲突(默认已处理)。
- 和 `HdsNavigation.bindToScrollable` 联动:把 `List` 的 `Scroller` 传给 HdsNavigation,让标题栏动态模糊跟滚动。

## 7. 完整代码示例

```typescript
import { HdsListItem } from '@kit.UIDesignKit'
import { promptAction, SymbolGlyphModifier, TextModifier } from '@kit.ArkUI'

@Entry
@Component
struct NoteListPage {
  @State dataSource: LazyDataSource<NoteItem> = new LazyDataSource()
  private scroller: Scroller = new Scroller()

  aboutToAppear(): void {
    for (let i = 0; i < 20; i++) {
      this.dataSource.pushItem(new NoteItem(`笔记 ${i + 1}`))
    }
  }

  build() {
    Column() {
      List({ space: 10, scroller: this.scroller }) {
        LazyForEach(this.dataSource, (item: NoteItem) => {
          HdsListItem({
            hdsListItemCard: {
              textItem: {
                primaryText: {
                  text: item.data,
                  modifier: new TextModifier().fontSize(16)
                }
              }
            },
            swipeActionOptions: {
              icons: [
                {
                  icon: new SymbolGlyphModifier($r('sys.symbol.share')).fontSize(18),
                  backgroundColor: '#4CAF50',
                  onAction: () => {
                    promptAction.openToast({ message: `分享 ${item.data}` })
                  }
                },
                {
                  icon: new SymbolGlyphModifier($r('sys.symbol.plus_square_on_square')).fontSize(18),
                  backgroundColor: '#FFB300',
                  onAction: () => {
                    promptAction.openToast({ message: `复制 ${item.data}` })
                  }
                }
              ],
              deleteIconOptions: {
                backgroundColor: '#E53935',
                iconColor: Color.White,
                onAction: () => {
                  this.getUIContext()?.animateTo({ duration: 350 }, () => {
                    this.dataSource.deleteItem(item)
                  })
                }
              },
              fullDeleteOptions: {
                isFullDelete: true,
                onFullDeleteAction: () => {
                  this.getUIContext()?.animateTo({ duration: 350 }, () => {
                    this.dataSource.deleteItem(item)
                  })
                  promptAction.openToast({ message: '已自动删除' })
                }
              }
            }
          })
        }, (item: NoteItem) => item.data)
      }
      .scrollBar(BarState.Off)
      .width('100%')
      .height('100%')
      .margin(10)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0D182431')
  }
}

class NoteItem {
  constructor(public data: string) {}
}

export class LazyDataSource<T> implements IDataSource {
  private elements: T[] = []
  private listeners: Set<DataChangeListener> = new Set()

  public totalCount(): number { return this.elements.length }
  public getData(index: number): T { return this.elements[index] }

  public pushItem(item: T): void {
    this.elements.push(item)
    this.listeners.forEach(l => l.onDataAdd(this.elements.length - 1))
  }

  public deleteItem(item: T): void {
    const i = this.elements.indexOf(item)
    if (i < 0) return
    this.elements.splice(i, 1)
    this.listeners.forEach(l => l.onDataDelete(i))
  }

  public registerDataChangeListener(l: DataChangeListener): void { this.listeners.add(l) }
  public unregisterDataChangeListener(l: DataChangeListener): void { this.listeners.delete(l) }
}
```

## 8. 反面示例

### 错 1:不在 List 里使用

```typescript
Column() {
  HdsListItem({ hdsListItemCard: {...} })   // ❌
}
```

HdsListItem 本质是 ListItem,只能作为 `List` 的子节点。外面必须套 `List { LazyForEach {...} }`。

### 错 2:同时给 customItemBuilder 和 hdsListItemCard

```typescript
HdsListItem({
  customItemBuilder: () => { this.myRow() },
  hdsListItemCard: { textItem: {...} }
})
```

customItemBuilder 优先级高,hdsListItemCard 不生效。要么统一用其中之一。

### 错 3:onAction 和 onFullDeleteAction 不对称

```typescript
deleteIconOptions: { onAction: () => deleteIt() },
fullDeleteOptions: { isFullDelete: true }   // 忘了 onFullDeleteAction
```

`isFullDelete: true` 但没提供 `onFullDeleteAction`,自动触发时没有数据删除逻辑,视觉上回弹,体验差。**两者要成对写**。

### 错 4:SwipeIcon 用原始 ImageSource 字符串

```typescript
icons: [{ icon: 'resources/base/media/x.png' }]   // ❌
```

`icon` 类型是 `SwipeIconType = SymbolGlyphModifier | ImageOptions`,不能直传字符串路径。

### 错 5:删除时不走 animateTo,直接 deleteItem

会瞬移收起,用户体验差,且 LazyForEach 不会做过渡动画。正解:`animateTo({ duration: 350 }, () => this.dataSource.deleteItem(item))`。

### 错 6:把 HdsListItem 用在 @ComponentV2 里

HdsListItem 是 V1(`@Component`)。在 V2 里用不报错,但 `@Local` + HdsListItem 时,`textItem.primaryText.text` 指向 `@Local` 状态变化不会同步 UI。推荐在 V1 页面里使用;V2 页面中则通过 `@Builder` 桥接一层 V1 子组件。

## 9. API 速查

| 符号 | 类型/签名 | 说明 |
|------|---------|------|
| `HdsListItem` | `@Component` | V1 装饰器,必须在 List 内 |
| `customItemBuilder` | `CustomBuilder` | 自定义项,优先级最高 |
| `hdsListItemCard` | `HdsListItemCardOptions` | HDS 规范三区,见 HdsListItemCard.md |
| `swipeActionOptions` | `HdsSwipeActionOptions \| SwipeActionOptions` | 横滑操作 |
| `listItemModifier` | `ListItemModifier` | API 21+ |
| `SwipeActionCallback` | `() => void` | 横滑回调签名 |
| `SwipeIconType` | `SymbolGlyphModifier \| ImageOptions` | 图标类型联合 |
| `icons.length` | `<= 3` | 普通按钮数量上限 |
| `fullDeleteOptions.isFullDelete` | `boolean` | 默认 false |

**记忆锚点**:V1 装饰器;`LazyForEach + IDataSource`;`icons`(≤3) + `deleteIconOptions` + `fullDeleteOptions`;删除用 `animateTo + deleteItem`。
