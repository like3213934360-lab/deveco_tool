# Grid / GridItem 拖拽与网格布局模式

## 什么时候使用

用户提到这些问题时读本文件：

- `Grid` 九宫格、宫格、动态行列数、合并单元格
- `GridItem` 拖拽、交换位置、拖到边缘、拉伸放大
- List 嵌套 Grid 做分类展示
- 图标长按震动拖动、从一个 Grid 拖到另一个 Grid

普通长列表读 `list-lazy-refresh-patterns.md`；滚动冲突读 `scroll-nested-gesture-patterns.md`。

## 状态模型

```ts
@State items: GridItemData[] = [];
@State draggingId: string = '';
@State hoverIndex: number = -1;
@State columns: number = 3;
```

拖拽排序至少区分：正在拖哪个、悬停到哪、什么时候提交新顺序。

## 推荐结构

```ts
Grid() {
  ForEach(this.items, (item: GridItemData, index: number) => {
    GridItem() {
      Column() {
        Image(item.icon)
          .width(32)
          .height(32)
        Text(item.title)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width('100%')
      .aspectRatio(1)
    }
  }, (item: GridItemData) => item.id)
}
.columnsTemplate('1fr 1fr 1fr')
.columnsGap(8)
.rowsGap(8)
```

## 实践要点

- 宫格布局先确定列数、间距、item 比例，再写内容。
- 动态行列数变化时，同时更新 `columnsTemplate` 和容器高度策略。
- 合并单元格要在数据模型里表达跨度，不要靠嵌套多个 Grid 伪造。
- 拖拽手势挂在外层 item，避免 Image 或子组件抢事件。
- 拖到边缘继续滚动时，需要监听位置并驱动外层滚动，不是只改 item offset。

## 常见坑

- GridItem 内图片长按/拖动导致无法交换位置，通常是子组件事件抢占。
- item 文本太长导致网格高度不一致，应限制行数和固定 item 高度或比例。
- 拖拽时只改变视觉位置但没有提交数组顺序，刷新后会回弹。
- 动态修改行列后高度没有自适应，要重新计算容器约束。

## 回答用户时应包含

1. 网格模型：列数、间距、item 尺寸、key。
2. 拖拽状态：draggingId、hoverIndex、commitMove。
3. 是否涉及跨 Grid、边缘滚动或合并单元格。
4. 一个稳定布局的 ArkTS 骨架。
