# Shape 绘制组件模式

## 什么时候使用

当用户提到以下需求时读本文件：

- `Circle`、`Polygon`、`Polyline`
- 简单几何图形、折线、多边形、圆形状态指示
- 用 ArkUI 内置绘制组件实现轻量图形

复杂自由绘制或 Canvas 已被当前语料排除，不在本 skill 覆盖范围内。

来源示例：

- Circle、Polygon、Polyline 相关实践文章
- 检索更多：`node scripts/search-practices.mjs Circle`

## 组件判断

| 图形 | 组件 |
|---|---|
| 圆、点、圆形进度背景 | `Circle` |
| 多边形区域 | `Polygon` |
| 折线、路径线段 | `Polyline` |

## 实践要点

- 先确定坐标系和容器尺寸，再写点位。
- 绘制组件只负责图形本身，文字、角标、按钮建议用外层 Stack 组合。
- 动态图形用状态驱动点位或尺寸变化，动画只包裹必要状态。
- 图形命中区域可能小于视觉期望，交互时在外层加稳定点击容器。

## 骨架

```ts
Stack() {
  Circle()
    .width(12)
    .height(12)
    .fill(this.active ? Color.Green : Color.Gray)

  Text(this.label)
    .offset({ x: 18, y: 0 })
}
```

## 常见坑

- 图形看不到时，先查父容器宽高，再查 stroke/fill。
- 点位写死后在不同屏幕比例下变形，应用比例或容器尺寸计算。
- 图形与文本组合时，不要让文本撑开绘制区域；外层布局负责排版。

## 回答用户时应包含

1. 需要哪种图形组件。
2. 容器尺寸和坐标系。
3. 图形状态如何由业务状态推导。
4. 是否需要外层 Stack/Row 承载文本和交互。
