# Tabs / Navigation 页签导航模式

这是旧的大类概览入口。具体问题优先读取：

- `tabs-patterns.md`：Tabs、TabContent、TabBar、页签预加载和生命周期。
- `navigation-routing-patterns.md`：Navigation、NavDestination、NavPathStack、路由传参与返回。

## 什么时候使用

当用户提到以下需求时优先读本文件：

- `Tabs` 页签切换、TabBar 自定义、页签索引持久化、TabContent 预加载
- Tabs 与 List/Scroll 嵌套滑动冲突、TabContent 切换后布局变化
- `Navigation` 页面跳转、返回参数、标题栏不生效、启动页、白屏
- `NavDestination` 嵌套 Tabs、子页面动态调整公共组件样式

来源示例：

- 《Tabs页面Navigation路由跳转的实现方式》
- 《TabContent预加载问题》
- 《Navigation传参返回参数形式差异的问题》
- 《Navigation自定义标题栏不生效问题如何修改》
- 检索更多：`node scripts/search-practices.mjs Tabs`、`Navigation`

## Tabs 模式

把页签索引当作单一状态源：

```ts
@State currentIndex: number = 0;
private tabsController: TabsController = new TabsController();
```

典型结构：

```ts
Tabs({ controller: this.tabsController }) {
  TabContent() {
    ListPage()
  }
  .tabBar('列表')

  TabContent() {
    DetailPage()
  }
  .tabBar('详情')
}
.onChange((index: number) => {
  this.currentIndex = index;
})
```

实践要点：

- `currentIndex` 用于持久化、恢复、联动；不要让 TabBar 文案和内容页各自维护索引。
- TabContent 是否预加载要按业务决定：需要保留子页面状态时允许预加载；需要节省资源时懒初始化子内容。
- Tabs 与纵向滚动组件嵌套时，横向切换和纵向滚动要有明确方向边界。
- 自定义 TabBar 时，选中态、禁用态、未读徽标不要散落在每个 TabContent 里。

## Navigation 模式

页面跳转优先围绕 `NavPathStack` 设计：

```ts
@State pathStack: NavPathStack = new NavPathStack();

Navigation(this.pathStack) {
  HomePage({ pathStack: this.pathStack })
}
```

跳转时传递明确参数对象：

```ts
this.pathStack.pushPath({
  name: 'DetailPage',
  param: { id: item.id }
});
```

实践要点：

- 路由名、参数结构、返回值结构要集中定义，避免页面间传匿名对象。
- 从子页面返回数据时，先确认项目使用的是 `pop` 参数、事件回调，还是共享状态；不要混用。
- 自定义标题栏不生效时，先查 `Navigation` 模式、`NavDestination` 标题配置位置和页面层级。
- 启动页/过渡页白屏时，优先查数据加载时机、默认页面占位、Navigation 首屏是否已经有可渲染内容。

## Tabs 与 Navigation 组合

常见组合是底部或顶部 Tabs 作为一级结构，每个 Tab 内部拥有自己的导航栈。复杂应用中不要让所有 Tab 共用一个全局栈，除非产品明确要求跨 Tab 返回。

推荐拆法：

- 一级：`Tabs` 管理主业务区。
- 二级：每个 Tab 内部用独立 `Navigation/NavPathStack`。
- 共享：用户信息、主题、全局弹窗通过外层状态或服务传递。

如果需求是“从某个 TabContent 跳到目标页面”，先判断目标页属于当前 Tab 栈、另一个 Tab 栈，还是全局页面，再决定切换 tab 或 push route。

## 常见坑

- TabContent 切换时布局跳动，通常是不同页根节点高度、外层约束或懒加载占位不一致。
- 页签索引持久化后恢复失败，常见原因是恢复索引早于 Tabs 构建或数据源尚未加载。
- Navigation 更新全局变量时机不对，要区分 push 前、目标页 aboutToAppear、返回回调三类时机。
- 嵌套路由白屏时，不要只查目标页代码；同时查 `NavDestination` 注册和初始 pathStack。

## 回答用户时应包含

1. 页签状态或路由栈由谁持有。
2. 页面切换、返回、持久化各自在哪个事件里做。
3. Tabs 和滚动/Navigation 组合时的层级图。
4. 必要的 ArkTS 骨架代码和生命周期注意点。
