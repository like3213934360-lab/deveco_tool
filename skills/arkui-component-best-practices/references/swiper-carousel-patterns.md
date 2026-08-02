# Swiper 轮播与滑动切换模式

## 什么时候使用

当用户提到以下需求时读本文件：

- `Swiper` 轮播、自动播放、禁止切换、指示器、自定义切换效果
- 滑动 Swiper 时误触子组件点击事件
- Swiper 图片居中、宽高适配、当前页状态同步
- 模拟 Swiper 或需要替代 Swiper 默认交互

堆叠卡片轮播请优先读 `stack-patterns.md`，因为那类效果需要 `Stack` 控制层级。

来源示例：

- 《滑动Swiper组件时如何不触发子组件的点击事件》
- 《如何保持Swiper中图片居中效果》
- 《屏蔽Swiper组件切换效果》
- 《模拟实现Swiper》
- 检索更多：`node scripts/search-practices.mjs Swiper`

## 组件选择

| 场景 | 推荐方向 |
|---|---|
| 普通轮播 | `Swiper + SwiperController + onChange` |
| 只展示不允许滑动 | 禁用切换能力或拦截手势，保留当前索引 |
| 自定义指示器 | 外部 Row/ForEach 渲染 indicator，由 `currentIndex` 驱动 |
| 滑动误触点击 | 区分 pan 状态和 click 状态，滑动结束前屏蔽点击 |
| 卡片层叠 | 转到 `stack-patterns.md` |

## 状态模型

```ts
@State currentIndex: number = 0;
@State isDragging: boolean = false;
private swiperController: SwiperController = new SwiperController();
```

推荐让 `currentIndex` 成为唯一页码状态。指示器、按钮可用态、当前内容说明都从它推导。

## 常用骨架

```ts
Column() {
  Swiper(this.swiperController) {
    ForEach(this.items, (item: BannerItem) => {
      Image(item.src)
        .width('100%')
        .height(180)
        .objectFit(ImageFit.Cover)
    }, (item: BannerItem) => item.id)
  }
  .index(this.currentIndex)
  .onChange((index: number) => {
    this.currentIndex = index;
  })

  Row({ space: 6 }) {
    ForEach(this.items, (_: BannerItem, index: number) => {
      Circle()
        .width(index === this.currentIndex ? 16 : 6)
        .height(6)
    })
  }
}
```

## 常见坑

- 轮播页内容高度不一致会导致切换时跳动；给 Swiper 和每个页项稳定尺寸。
- Swiper 内部图片居中问题通常是 `ImageFit`、图片容器宽高、页项对齐共同导致。
- 滑动和点击冲突时，不要只在子组件 `onClick` 里判断；需要在 Swiper 或外层手势中记录拖动态。
- 业务只想展示某一页时，不要把 Swiper 当作静态容器；可以直接渲染当前项。
- 自动播放、手动切换、接口刷新同时存在时，更新 `items` 后要校正 `currentIndex`，避免越界。

## 回答用户时应包含

1. 是否真需要 Swiper，还是 Stack/List/单页渲染更合适。
2. `currentIndex`、拖动态、数据源如何维护。
3. 指示器或自定义控制区如何从状态推导。
4. 滑动点击冲突、尺寸跳动、图片居中的处理点。
