# Tabs / TabContent 页签模式

## 什么时候使用

用户提到这些问题时读本文件：

- `Tabs` 页签切换、索引持久化、自定义 TabBar
- `TabContent` 预加载、生命周期、切换后布局变动
- Tabs 与 List/Scroll 嵌套滑动
- SegmentButton 页签与 Tabs 页不匹配

页面路由和返回参数读 `navigation-routing-patterns.md`。

## 状态模型

```ts
@State currentIndex: number = 0;
private tabsController: TabsController = new TabsController();
```

`currentIndex` 是页签唯一状态源。TabBar 展示、内容页、持久化都从它推导。

## 推荐骨架

```ts
Tabs({ controller: this.tabsController }) {
  TabContent() {
    ListPage()
  }
  .tabBar('列表')

  TabContent() {
    MinePage()
  }
  .tabBar('我的')
}
.index(this.currentIndex)
.onChange((index: number) => {
  this.currentIndex = index;
})
```

## 实践要点

- 索引持久化要等 Tabs 和数据源准备好后再恢复。
- TabContent 是否预加载由业务决定：保状态就预加载，省资源就懒加载。
- 自定义 TabBar 的选中态、禁用态、徽标都由 `currentIndex` 和数据状态推导。
- Tabs 嵌套滚动时，横向切换归 Tabs，纵向滚动归 List/Scroll。

## 常见坑

- TabContent 切换时布局变动，常见原因是各页根节点高度或占位不一致。
- SegmentButton 与 Tabs 不匹配，通常是两个索引状态没有统一。
- 生命周期触发不符合预期时，先确认预加载和页面保活策略。
- 在 `onChange` 里再驱动 controller 跳转，容易循环触发。

## 回答用户时应包含

1. currentIndex 由谁持有。
2. 是否需要预加载和状态保留。
3. 自定义 TabBar 与内容页如何同步。
4. Tabs 与滚动组件的手势边界。
