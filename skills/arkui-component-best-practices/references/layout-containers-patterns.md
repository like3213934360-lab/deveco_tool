# Flex / RelativeContainer 布局容器模式

## 什么时候使用

当用户提到以下需求时读本文件：

- `Flex` 自适应、换行、主轴/交叉轴对齐
- `RelativeContainer` 相对定位、依赖布局、锚点关系
- `ColumnSplit` 分栏、可拖拽区域、侧栏宽度
- 基础布局容器与 Row/Column/Stack/List/Grid 的选择

Row/Column 原子布局仍见 `text-image-video-patterns.md`；层叠覆盖见 `stack-patterns.md`。

来源示例：

- Flex 布局与换行相关实践
- RelativeContainer 相对布局实践
- ColumnSplit 分栏实践
- 检索更多：`node scripts/search-practices.mjs Flex`

## 组件判断

| 需求 | 推荐组件 |
|---|---|
| 简单横向/纵向 | `Row` / `Column` |
| 自动换行、弹性分布 | `Flex` |
| 多节点相对约束 | `RelativeContainer` |
| 层叠覆盖 | `Stack` |
| 网格行列 | `Grid` |
| 可滚动列表 | `List` |
| 分栏拖拽 | `ColumnSplit` |

## Flex

Flex 适合一组 item 在有限空间内自适应排列：

```ts
Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
  ForEach(this.tags, (tag: string) => {
    Text(tag)
      .padding({ left: 8, right: 8, top: 4, bottom: 4 })
  })
}
.width('100%')
```

实践要点：

- 先定主轴方向，再定是否换行。
- 标签、按钮、筛选项一类内容要给最小宽度和间距。
- Flex 不适合表达严格二维表格；那应使用 Grid。

## RelativeContainer

RelativeContainer 适合多个子组件互相依赖位置：

- 给关键子组件稳定 id。
- 用锚点关系描述相对位置。
- 避免链式依赖过长，否则一处变化会影响整块布局。

如果只是覆盖角标，Stack 更简单；如果只是水平排列，Row 更简单。

## ColumnSplit

- 分栏宽度需要最小/最大边界。
- 拖拽改变宽度时，不要让内容每一帧做重计算。
- 侧栏折叠、展开、拖拽宽度建议拆成独立状态。

## 常见坑

- 用 Flex 做严格九宫格会出现最后一行对齐不稳定，Grid 更合适。
- RelativeContainer 中 id 或依赖关系写错，会表现为子组件位置不确定。
- 分栏布局里文本过长要处理溢出，否则会挤压拖拽区域。

## 回答用户时应包含

1. 为什么选 Flex/RelativeContainer/ColumnSplit，而不是 Row/Column/Grid/Stack。
2. 主轴、换行、锚点、分栏边界如何定义。
3. 子组件尺寸和文本溢出如何约束。
