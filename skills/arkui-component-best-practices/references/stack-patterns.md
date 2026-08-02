# Stack 层叠与堆叠模式

## 什么时候使用

当用户提到以下需求时优先使用本模式：

- 堆叠效果、层叠效果、卡片堆叠
- Swiper 堆叠、卡片轮播、下一张卡片露出
- 上下滑切换卡片、左右滑切换卡片
- 多个组件重叠、遮罩层、背景图覆盖、角标覆盖
- Stack 内子组件位置不对、被裁剪、层级混乱

来源示例：

- 华为开发者文档《Stack组件实现Swiper堆叠动画效果》
- 华为开发者文档《如何调整Stack容器内子组件的位置》
- 华为开发者文档《Stack组件中子组件超出边界显示问题》
- 华为开发者文档《如何解决Stack组件下子组件高度与层级问题》
- 本地语料：`downloads/arkui-component-articles/markdown/other/259-news-v1_2-ts_52-0000002371749641.md`
- 原文链接：https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_52-0000002371749641

## 核心判断

普通 `Swiper` 适合轮播切换，但不适合直接做“卡片互相压住、露出下一张”的视觉层级。遇到堆叠卡片效果时，优先使用 `Stack` 自己控制层级和偏移，再用手势模拟切换。

## 推荐结构

- `Stack`：承载层叠卡片。
- `ForEach`：渲染每张卡片。
- `currentIndex`：当前卡片索引，作为单一状态源。
- `getImgCoefficients(index)`：计算某张卡片相对当前卡片的位置。
- `getOffset(index)`：根据相对位置计算露出的偏移量。
- `zIndex`：控制当前卡片在最上层，邻近卡片在次层。
- `PanGesture`：处理横向或纵向滑动。
- `animateTo`：把 `currentIndex` 的改变放进动画闭包。

## 纵向堆叠

适合“底部露出下一张卡片，上下滑切换”的效果。

关键点：

- 卡片偏移用 `offset({ x: 0, y })`。
- 手势用 `PanGesture({ direction: PanDirection.Vertical })`。
- 根据 `event.offsetY < 0` 判断向上/向下切换。
- 容器高度要给足，让被露出的卡片有显示空间。

代码骨架：

```ts
@Component
export struct SwiperStackComponent {
  @Link currentIndex: number;
  @Prop swiperData: Resource[];

  private halfCount: number = 1;
  private animationDuration: number = 300;

  getCoefficient(index: number): number {
    const coefficient = this.currentIndex - index;
    const abs = Math.abs(coefficient);
    if (abs <= this.halfCount) {
      return coefficient;
    }

    const length = this.swiperData.length;
    const wrapOffset = length - abs;
    if (wrapOffset <= this.halfCount) {
      return coefficient > 0 ? -wrapOffset : wrapOffset;
    }

    return 0;
  }

  getOffset(index: number): number {
    let coefficient = this.getCoefficient(index);
    if (Math.abs(coefficient) !== 1) {
      return 0;
    }
    if (coefficient === 1) {
      coefficient = -1;
    }
    return -(50 * coefficient);
  }

  switchCard(forward: boolean): void {
    this.getUIContext().animateTo({ duration: this.animationDuration }, () => {
      const length = this.swiperData.length;
      const next = forward ? this.currentIndex + 1 : this.currentIndex - 1 + length;
      this.currentIndex = next % length;
    });
  }

  build() {
    Stack() {
      ForEach(this.swiperData, (imageSrc: Resource, index: number) => {
        Stack({ alignContent: Alignment.Bottom }) {
          Image(imageSrc)
            .objectFit(ImageFit.Cover)
            .width('100%')
            .height('100%')
            .borderRadius(8)
        }
        .offset({ x: 0, y: this.getOffset(index) })
        .zIndex(index === this.currentIndex ? 2 : 1 - Math.abs(this.getCoefficient(index)))
        .width(310)
        .height(index === this.currentIndex ? 180 : 130)
        .borderRadius(8)
        .shadow(ShadowStyle.OUTER_DEFAULT_SM)
        .backgroundColor(Color.White)
      })
    }
    .width('100%')
    .height(200)
    .alignContent(Alignment.Center)
    .gesture(
      PanGesture({ direction: PanDirection.Vertical })
        .onActionStart((event: GestureEvent) => {
          this.switchCard(event.offsetY < 0);
        })
    )
  }
}
```

## 横向堆叠

适合“右侧露出下一张卡片，左右滑切换”的效果。

把纵向方案改成：

```ts
.offset({ x: this.getOffset(index), y: 0 })
.gesture(
  PanGesture({ direction: PanDirection.Horizontal })
    .onActionStart((event: GestureEvent) => {
      this.switchCard(event.offsetX < 0);
    })
)
```

横向空间通常更紧，偏移距离可以从 `50` 调小到 `20` 或按卡片宽度比例计算。

## 常见坑

- 只用 `Swiper` 往往做不出卡片互相覆盖和露出下一张的层级效果。
- `offset` 只负责位置，不负责前后层级；层级必须用 `zIndex` 控制。
- `currentIndex` 改变要放进 `animateTo`，否则切换会突然跳变。
- 横向和纵向不要只改手势方向，还要同步改偏移轴和方向判断。
- 如果卡片数量较多，只让当前卡、相邻卡保持高层级，其余卡片降低 `zIndex` 或隐藏，避免层级混乱。
- Stack 子组件需要越界可见时，要同时检查父容器尺寸、裁剪行为、外层布局是否限制显示区域。
- 子组件四角分布时，优先用 `Stack({ alignContent })` 搭配子组件自身 `align`/`position` 语义，而不是靠大量硬编码偏移碰运气。

## 回答用户时应包含

1. 为什么这里用 `Stack` 而不是普通 `Swiper`。
2. `currentIndex` 如何驱动卡片偏移和层级。
3. 横向/纵向切换分别改哪些地方。
4. 一份可直接改资源和尺寸的 ArkTS 代码。
