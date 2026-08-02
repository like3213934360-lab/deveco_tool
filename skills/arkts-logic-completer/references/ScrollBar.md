# ScrollBar 组件功能逻辑规格

## 1. 功能定位

ScrollBar 是滚动条组件，用于配合可滚动组件（List、Grid、Scroll、WaterFlow 等）使用，通过共享 Scroller 控制器实现联动滚动。当需要自定义滚动条样式或在特定位置展示独立滚动条时使用。

## 2. 典型场景

- 长列表自定义滚动条（颜色、宽度、圆角）
- Stack 布局中在可滚动组件右侧叠加独立滚动条
- 嵌套滚动场景中将内层滚动偏移传递给外层
- 无子节点时使用系统默认滚动条样式（API 12+）
- 横向滚动组件配合横向 ScrollBar

## 3. 状态声明

```typescript
// Scroller 必须与可滚动组件共享同一实例
private scroller: Scroller = new Scroller()

// 列表数据源
@State dataList: number[] = []

// 滚动条颜色（API 20+，无子节点时生效）
@State barColor: ColorMetrics = ColorMetrics.rgba(24, 35, 48, 0.4)
```

## 4. 事件与交互逻辑

ScrollBar 本身无独立事件，交互逻辑通过与 Scroller 绑定的可滚动组件间接体现：

### 场景一：基础联动

```typescript
Stack({ alignContent: Alignment.End }) {
  List({ space: 10, scroller: this.scroller }) {
    ForEach(this.dataList, (item: number) => {
      ListItem() {
        Text(`Item ${item}`)
          .height(60)
          .width('100%')
          .textAlign(TextAlign.Center)
          .backgroundColor('#F1F3F5')
          .borderRadius(12)
      }
    }, (item: number): string => item.toString())
  }
  .scrollBar(BarState.Off)

  ScrollBar({ scroller: this.scroller, direction: ScrollBarDirection.Vertical, state: BarState.Auto }) {
    Text()
      .width(8)
      .height(80)
      .borderRadius(4)
      .backgroundColor('#66182431')
  }
  .width(8)
}
```

### 场景二：嵌套滚动（API 14+）

```typescript
ScrollBar({ scroller: this.listScroller })
  .position({ right: 0 })
  .enableNestedScroll(true)
  .scrollBarColor(this.barColor)
```

## 5. 数据结构

```typescript
// ScrollBar 构造参数
interface ScrollBarConfig {
  scroller: Scroller
  direction?: ScrollBarDirection  // Vertical | Horizontal
  state?: BarState               // Auto | On | Off
}
```

## 6. 联动说明

- ScrollBar 与可滚动组件通过 **同一个 Scroller 实例** 绑定，方向必须一致
- ScrollBar 与可滚动组件仅支持 **一对一** 绑定
- 可滚动组件需设置 `.scrollBar(BarState.Off)` 关闭自身滚动条以避免重复
- 嵌套滚动时 `enableNestedScroll(true)` 将偏移先传给内层，再根据嵌套优先级传递给外层
- 无子节点时（API 12+）显示默认样式滚动条，可用 `scrollBarColor` 设置颜色
- ScrollBar 主轴方向不设大小时取父组件 maxSize，若父级也是可滚动组件建议显式指定

## 7. 完整代码示例

```typescript
import { ColorMetrics } from '@kit.ArkUI'

@Entry
@Component
struct ScrollBarDemo {
  private scroller: Scroller = new Scroller()
  @State items: number[] = []
  @State barColor: ColorMetrics = ColorMetrics.rgba(24, 35, 48, 0.4)

  aboutToAppear(): void {
    for (let i = 0; i < 30; i++) {
      this.items.push(i)
    }
  }

  build() {
    Column() {
      Stack({ alignContent: Alignment.End }) {
        Scroll(this.scroller) {
          Column({ space: 8 }) {
            ForEach(this.items, (item: number) => {
              Text(`Item ${item}`)
                .width('90%')
                .height(56)
                .backgroundColor('#F1F3F5')
                .borderRadius(12)
                .fontSize(16)
                .textAlign(TextAlign.Center)
            }, (item: number): string => item.toString())
          }
          .width('100%')
          .padding({ right: 16 })
        }
        .scrollBar(BarState.Off)
        .scrollable(ScrollDirection.Vertical)
        .width('100%')
        .height('100%')

        ScrollBar({
          scroller: this.scroller,
          direction: ScrollBarDirection.Vertical,
          state: BarState.Auto
        })
          .scrollBarColor(this.barColor)
          .width(8)
      }
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
```

## 8. 反面示例

```typescript
// ❌ ScrollBar 和可滚动组件使用不同的 Scroller，无法联动
private scrollerA: Scroller = new Scroller()
private scrollerB: Scroller = new Scroller()
Scroll(this.scrollerA) { ... }
ScrollBar({ scroller: this.scrollerB })

// ❌ ScrollBar 方向与可滚动组件方向不一致
Scroll(this.scroller) { ... }
  .scrollable(ScrollDirection.Horizontal)
ScrollBar({ scroller: this.scroller, direction: ScrollBarDirection.Vertical })

// ❌ 没有关闭可滚动组件自带的滚动条，导致两个滚动条同时出现
Scroll(this.scroller) { ... }  // 默认 scrollBar 为 Auto
ScrollBar({ scroller: this.scroller })

// ❌ ScrollBar 父级是可滚动组件却未指定主轴大小，可能导致无穷大
Scroll() {
  ScrollBar({ scroller: this.listScroller })  // 高度可能撑满
}

// ❌ 一个 Scroller 同时绑定多个 ScrollBar，不支持一对多
ScrollBar({ scroller: this.scroller })
ScrollBar({ scroller: this.scroller })
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `ScrollBar({ scroller, direction?, state? })` | 创建滚动条组件，通过 Scroller 与可滚动组件绑定 |
| `ScrollBarDirection.Vertical` | 纵向滚动条 |
| `ScrollBarDirection.Horizontal` | 横向滚动条 |
| `BarState.Auto` | 自动显隐（默认） |
| `BarState.On` | 常驻显示 |
| `BarState.Off` | 隐藏 |
| `.enableNestedScroll(boolean)` | 是否支持嵌套滚动（API 14+），默认 false |
| `.scrollBarColor(ColorMetrics)` | 无子节点时滚动条滑块颜色（API 20+） |

> **注意**：ScrollBar 与可滚动组件必须共享同一个 Scroller 实例且方向一致，仅支持一对一绑定。API 12+ 无子节点时支持默认样式滚动条。
