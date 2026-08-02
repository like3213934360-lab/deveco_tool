# List / LazyForEach / Refresh 列表刷新模式

## 什么时候使用

用户提到这些问题时读本文件：

- `List` 展示不全、长列表、列表分页、可见索引
- `LazyForEach` 渲染、数据变更、截图只截第一个 ListItem
- 下拉刷新、上拉加载更多、底部 loading/noMore/error
- `ListItem`、`ListItemGroup`、分组、吸顶、滑动菜单

网格拖拽读 `grid-drag-layout-patterns.md`；嵌套滑动和手势冲突读 `scroll-nested-gesture-patterns.md`。

## 状态模型

```ts
@State items: RowData[] = [];
@State refreshing: boolean = false;
@State loadingMore: boolean = false;
@State noMore: boolean = false;
@State visibleIndex: number = 0;
```

数据、刷新态、加载态、可见索引分开维护。不要用一个 `loading` 同时表示刷新和加载更多。

## 推荐结构

```ts
Refresh({ refreshing: $$this.refreshing }) {
  List() {
    ForEach(this.items, (item: RowData) => {
      ListItem() {
        Row() {
          Text(item.title)
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
      }
    }, (item: RowData) => item.id)

    ListItem() {
      Text(this.noMore ? '没有更多' : '加载中')
    }
  }
  .onReachEnd(() => {
    this.loadMore();
  })
}
.onRefreshing(() => {
  this.reload();
})
```

## 实践要点

- List 父容器必须有明确高度，展示不全先查外层 Column/Scroll/`layoutWeight`。
- `ForEach`/`LazyForEach` 必须提供稳定 key，避免输入、滚动位置或动画状态被重建。
- 刷新时替换数据，加载更多时追加数据；两类行为不要混在同一个函数里。
- 分组列表使用 `ListItemGroup` 时，组 key 和 item key 都要稳定。
- 可见索引、滚动位置恢复、列表联动都应保存成状态，不要依赖组件重建后的默认位置。

## 常见坑

- 下拉刷新还没结束就追加数据，会出现刷新动画和列表位置跳动。
- `LazyForEach` 数据源更新但没有通知，UI 看起来“不刷新”。
- 截图、测量或定位 ListItem 时，只处理已渲染可见项会漏掉懒渲染项。
- List 外再包 Scroll，容易造成展示不全或滚动主语不清。

## 回答用户时应包含

1. 列表数据源和 key 怎么设计。
2. 刷新、加载更多、空态、错误态如何拆分。
3. 父容器高度和滚动主语。
4. 必要的 ArkTS 骨架代码。
