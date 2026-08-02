# List / Grid / Scroll 列表网格滚动模式

这是旧的大类概览入口。具体问题优先读取：

- `list-lazy-refresh-patterns.md`：List、LazyForEach、Refresh、ListItem、加载更多。
- `grid-drag-layout-patterns.md`：Grid、GridItem、合并单元格、拖拽网格。
- `scroll-nested-gesture-patterns.md`：Scroll、嵌套滑动、滚动手势冲突。

## 什么时候使用

当用户提到以下需求时优先读本文件：

- 长列表、列表展示不全、列表滑动翻页、上拉加载、下拉刷新
- `LazyForEach` 渲染异常、列表数据更新后 UI 不刷新、列表项错位
- List 拖拽排序、拖拽到边缘继续滚动、List 与 Tab 联动
- Grid 九宫格、动态行列数、合并单元格、GridItem 拖拽交换
- Scroll 嵌套滑动、Tabs 和滚动组件抢手势、滚动位置恢复

来源示例：

- 《实现List下拉刷新和上拉加载更多》
- 《List组件通过拖拽改变排序》
- 《如何使用Grid单元格实现合并布局》
- 《如何解决Tabs和滚动组件的嵌套滑动问题》
- 检索更多：`node scripts/search-practices.mjs List`、`Grid`、`Scroll`

## 组件选择

| 场景 | 首选组件 | 关键点 |
|---|---|---|
| 普通长列表 | `List + ForEach/LazyForEach` | 稳定 key、数据源单一、列表高度明确 |
| 大数据或频繁增删 | `List + LazyForEach` | 数据源通知、稳定 id、避免整表重建 |
| 下拉刷新/加载更多 | `Refresh + List` 或 List 底部状态项 | `refreshing`、`loadingMore`、空态/错误态分开 |
| 拖拽排序 | `List/ListItem + 手势/拖拽事件` | 拖拽态、目标索引、提交排序三段式 |
| 网格/宫格 | `Grid + GridItem` | `columnsTemplate`、间距、item 固定比例 |
| 合并单元格 | `GridItem` 行列跨度能力 | 先建网格模型，再映射到 item |
| 纯滚动容器 | `Scroll` | 只有一个滚动主语，避免多层抢手势 |

## 推荐结构

列表类问题先把数据和 UI 状态拆清楚：

```ts
interface RowData {
  id: string;
  title: string;
}

@State items: RowData[] = [];
@State refreshing: boolean = false;
@State loadingMore: boolean = false;
@State activeIndex: number = 0;
```

渲染时用稳定 key：

```ts
List() {
  ForEach(this.items, (item: RowData) => {
    ListItem() {
      Row() {
        Text(item.title)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width('100%')
    }
  }, (item: RowData) => item.id)
}
.width('100%')
.height('100%')
```

## 长列表与刷新

- 列表容器必须有明确高度；展示不全通常先查父容器高度、`layoutWeight`、外层 Scroll。
- 下拉刷新和上拉加载不要共用一个布尔值：`refreshing` 表示顶部刷新，`loadingMore` 表示底部追加。
- 加载更多建议用底部 `ListItem` 表达 `loading / noMore / error`，不要在滚动回调里连续触发请求。
- 数据追加时保留旧数组语义清晰；如果使用懒数据源，确保通知插入、删除、更新的位置。

## 拖拽排序

拖拽排序不要只改 UI 偏移。推荐拆成：

1. `draggingId`：当前拖拽项。
2. `hoverIndex`：当前悬停目标。
3. `commitMove(from, to)`：手势结束后提交数组顺序。

常见坑：

- 拖拽时 item 位置偏移，多半是手势坐标和列表滚动偏移没有统一。
- 拖到边缘不能继续移动，需要在接近边缘时触发列表滚动或扩大可拖拽区域。
- GridItem 包含图片时，图片自身长按/拖动行为可能抢事件，需要让拖拽手势挂在外层 item 上。

## Grid 布局

Grid 先确定“格子模型”，再写 UI：

```ts
Grid() {
  ForEach(this.items, (item: RowData) => {
    GridItem() {
      Text(item.title)
    }
  }, (item: RowData) => item.id)
}
.columnsTemplate('1fr 1fr 1fr')
.rowsGap(8)
.columnsGap(8)
```

实践要点：

- 动态行列数改变时，同时更新 `columnsTemplate`/`rowsTemplate` 和容器高度策略。
- 九宫格图标类布局优先固定 item 宽高或 `aspectRatio(1)`，避免文字变长把网格撑乱。
- 合并单元格先在数据里表达 row/column 跨度；不要靠嵌套多个 Grid 假装合并。

## Scroll 与嵌套滑动

- 页面里尽量只有一个主要滚动容器；List 已经能滚动时，不要再无条件包一层 `Scroll`。
- Tabs + List/Scroll 时，明确横向手势归 Tabs，纵向手势归列表。
- 需要 Tab 与 List 联动时，维护 `currentTab` 和 `currentListIndex`，避免两个组件互相在回调里循环更新。
- 需要恢复滚动位置时，用 controller/索引状态保存，不要依赖组件重建后的默认位置。

## 回答用户时应包含

1. 当前场景应该由哪个组件负责滚动或布局。
2. 数据源、加载态、拖拽态分别是什么。
3. 父容器尺寸和 item key 如何保证稳定。
4. 一个小代码骨架，避免直接复制长篇文章。
