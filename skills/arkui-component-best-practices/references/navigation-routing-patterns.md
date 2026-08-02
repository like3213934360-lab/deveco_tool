# Navigation / NavDestination 路由模式

## 什么时候使用

用户提到这些问题时读本文件：

- `Navigation` 页面跳转、启动页、路由动画
- `NavDestination` 子页面、嵌套路由、标题栏
- `NavPathStack` push/pop、传参、返回参数
- 页面白屏、返回指定页面、侧滑返回无响应

页签切换读 `tabs-patterns.md`。

## 状态模型

```ts
@State pathStack: NavPathStack = new NavPathStack();
```

路由栈是页面跳转的核心状态。路由名、参数、返回值结构要集中定义。

## 推荐骨架

```ts
Navigation(this.pathStack) {
  HomePage({ pathStack: this.pathStack })
}
.navDestination((name: string, param: object) => {
  if (name === 'DetailPage') {
    DetailPage({ id: (param as DetailParam).id })
  }
})
```

跳转：

```ts
this.pathStack.pushPath({
  name: 'DetailPage',
  param: { id: item.id }
});
```

## 实践要点

- 页面名称建议集中成常量或枚举，避免字符串散落。
- 传参对象要有结构，不要传匿名大对象。
- 返回参数先确认项目使用 pop 参数、回调还是共享状态，不要混用。
- 自定义标题栏不生效时，查配置位置、Navigation 模式和 NavDestination 层级。
- 启动页/白屏先查初始 route、占位 UI、数据加载时机。

## 常见坑

- push 前修改全局变量，目标页读取时机不确定；优先通过 param 或明确状态源。
- 嵌套 Navigation 栈混用，会导致返回路径和标题栏异常。
- 侧滑返回无响应，可能被 bindSheet、手势区域或页面层级拦截。
- 返回指定页面时，不要连续盲目 pop，应该根据 pathStack 状态设计清晰路径。

## 回答用户时应包含

1. pathStack 谁持有，是否跨 Tab。
2. 路由名、参数、返回值结构。
3. 标题栏、动画、白屏或侧滑问题的排查点。
4. 必要的 push/pop ArkTS 骨架。
