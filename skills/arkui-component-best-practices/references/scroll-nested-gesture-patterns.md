# Scroll / Nested Gesture 嵌套滚动手势模式

## 什么时候使用

用户提到这些问题时读本文件：

- `Scroll` 嵌套 `List`、`Tabs`、`Swiper`
- Tabs 和滚动组件嵌套滑动冲突
- Swiper 嵌套 Scroll、List 嵌套 Grid 的滚动边界
- 滑动方向冲突、边缘弹性、滚动位置恢复

普通列表刷新读 `list-lazy-refresh-patterns.md`；Grid 拖拽读 `grid-drag-layout-patterns.md`。

## 核心判断

先确定“谁是滚动主语”：

- 页面纵向长内容：通常是 `Scroll` 或 `List`，二选一。
- 数据列表：优先 `List`，不要无条件再包 `Scroll`。
- 横向页切：`Tabs` 或 `Swiper` 负责横向，纵向内容负责纵向。
- 局部滚动表格：Scroll 可以包内部内容，但要明确高度边界。

## 状态模型

```ts
@State currentTab: number = 0;
@State scrollOffset: number = 0;
@State gestureLocked: boolean = false;
```

复杂嵌套滚动要保存方向、位置和当前页，不要让多个组件在回调里互相改状态。

## 实践要点

- 横向和纵向手势同时存在时，先按方向拆职责。
- 外层 Scroll 和内层 List 都能滚动时，先去掉一个，除非确实需要嵌套。
- Tab 与 List 联动时，`currentTab` 和列表可见索引互相更新要防止循环触发。
- Swiper 内部有可点击子组件时，滑动期间应屏蔽点击或记录拖动态。
- 滚动位置恢复要用 controller/状态保存，不能假设组件重建后还在原位置。

## 常见坑

- List 包 Scroll 导致 List 展示不全或只显示一屏。
- Tabs 与纵向滚动抢手势，通常是方向边界和嵌套层级没设计。
- Swiper 嵌套 Scroll 时，横向滑动与纵向滚动需要明确各自响应区域。
- 在滚动回调里频繁 setState 会造成卡顿，应节流或只保存关键位置。

## 回答用户时应包含

1. 当前页面唯一或主要滚动主语是谁。
2. 横向/纵向手势如何分配。
3. 哪些状态需要保存以恢复位置或联动。
4. 如何避免回调循环和点击误触。
